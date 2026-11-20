//! Native Wayland backdrop blur. No screen capture, input, or GTK changes.
//!
//! The compositor owns the blur kernel: ext-background-effect has no radius control.
//! Do not confuse this with shader-controlled Liquid Glass/refraction.

use std::fs::File;
use std::io::Write;
use std::os::fd::AsFd;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crossbeam_channel::{Receiver, Sender, bounded};
use wayland_client::{
    Connection, Dispatch, Proxy, QueueHandle, WEnum, delegate_noop,
    protocol::{wl_buffer, wl_compositor, wl_output, wl_registry, wl_shm, wl_shm_pool, wl_surface},
};
use wayland_protocols::ext::background_effect::v1::client::{
    ext_background_effect_manager_v1 as effects, ext_background_effect_surface_v1 as effect,
};
use wayland_protocols_wlr::layer_shell::v1::client::{
    zwlr_layer_shell_v1 as shell, zwlr_layer_surface_v1 as layer,
};

use crate::commands::LinuxBlurStatus as Status;
use crate::error::{AppError, AppResult};

const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(2);
const TICK: Duration = Duration::from_millis(50);

#[derive(Default)]
struct Target {
    active: bool,
    updated: Option<Instant>,
    preview_until: Option<Instant>,
}

/// A latest-value mailbox, not an unbounded queue of stale telemetry frames.
pub struct LinuxBlur {
    target: Arc<Mutex<Target>>,
    status: Arc<Mutex<Status>>,
    wake: Sender<()>,
}

impl LinuxBlur {
    pub fn start() -> Self {
        let enabled = backend_enabled(
            std::env::var("FOCUSGLASS_WAYLAND_BLUR").ok().as_deref(),
            std::env::var_os("WAYLAND_DISPLAY").is_some(),
        );
        Self::start_enabled(enabled)
    }

    fn start_enabled(enabled: bool) -> Self {
        let target = Arc::new(Mutex::new(Target::default()));
        let status = Arc::new(Mutex::new(Status {
            linux: true,
            enabled,
            available: false,
            requested: false,
            active: false,
            mapped_outputs: 0,
            message: if enabled {
                "Connecting to Wayland"
            } else {
                "Wayland unavailable or FOCUSGLASS_WAYLAND_BLUR=0"
            }
            .into(),
        }));
        let (wake, receiver) = bounded(1);
        if enabled {
            let target = Arc::clone(&target);
            let worker_status = Arc::clone(&status);
            if let Err(error) = thread::Builder::new()
                .name("focusglass-wayland-blur".into())
                .spawn(move || {
                    if let Err(error) = run(target, &worker_status, receiver) {
                        set_status(&worker_status, false, error.to_string());
                    }
                })
            {
                set_status(&status, false, format!("Cannot start blur worker: {error}"));
            }
        }
        Self {
            target,
            status,
            wake,
        }
    }

    pub fn status(&self) -> AppResult<Status> {
        self.status
            .lock()
            .map(|s| s.clone())
            .map_err(|_| AppError::LockPoisoned("Linux blur status"))
    }

    pub fn update(&self, opacity: f64, blur_px: f64) -> AppResult<()> {
        if !opacity.is_finite()
            || !blur_px.is_finite()
            || !(0.0..=0.95).contains(&opacity)
            || !(0.0..=32.0).contains(&blur_px)
        {
            return Err(AppError::InvalidArgument("invalid Linux blur frame".into()));
        }
        let mut target = self
            .target
            .lock()
            .map_err(|_| AppError::LockPoisoned("Linux blur target"))?;
        target.active = should_blur(opacity, blur_px);
        target.updated = Some(Instant::now());
        let _ = self.wake.try_send(());
        Ok(())
    }

    pub fn preview(&self) -> AppResult<()> {
        let status = self.status()?;
        if !status.available {
            return Err(wayland_error(status.message));
        }
        let mut target = self
            .target
            .lock()
            .map_err(|_| AppError::LockPoisoned("Linux blur target"))?;
        // A fixed deadline independent of regular telemetry/zero-value heartbeats.
        target.preview_until = Some(Instant::now() + Duration::from_secs(3));
        let _ = self.wake.try_send(());
        Ok(())
    }

    pub fn stop(&self) -> AppResult<()> {
        let mut target = self
            .target
            .lock()
            .map_err(|_| AppError::LockPoisoned("Linux blur target"))?;
        *target = Target::default();
        let _ = self.wake.try_send(());
        Ok(())
    }
}

fn backend_enabled(setting: Option<&str>, has_wayland_display: bool) -> bool {
    setting != Some("0") && (has_wayland_display || setting == Some("1"))
}

fn should_blur(opacity: f64, blur_px: f64) -> bool {
    opacity > 0.0 && blur_px > 0.0
}

fn target_is_live(target: &Target, now: Instant) -> bool {
    target.preview_until.is_some_and(|deadline| now < deadline)
        || (target.active
            && target
                .updated
                .is_some_and(|t| now.saturating_duration_since(t) < HEARTBEAT_TIMEOUT))
}

fn set_status(status: &Mutex<Status>, available: bool, message: String) {
    eprintln!("[FocusGlass Wayland blur] {message}");
    if let Ok(mut status) = status.lock() {
        status.available = available;
        if !available {
            status.active = false;
            status.mapped_outputs = 0;
        }
        status.message = message;
    }
}

type WorkerResult<T> = AppResult<T>;

fn wayland_error(error: impl std::fmt::Display) -> AppError {
    AppError::WaylandBlur(error.to_string())
}

fn run(
    target: Arc<Mutex<Target>>,
    status: &Mutex<Status>,
    receiver: Receiver<()>,
) -> WorkerResult<()> {
    let connection = Connection::connect_to_env().map_err(wayland_error)?;
    let mut queue = connection.new_event_queue();
    let qh = queue.handle();
    connection.display().get_registry(&qh, ());
    let mut state = WaylandState::default();
    // First roundtrip discovers globals; second receives manager capabilities.
    queue.roundtrip(&mut state).map_err(wayland_error)?;
    queue.roundtrip(&mut state).map_err(wayland_error)?;
    if state.compositor.is_none()
        || state.shm.is_none()
        || state.shell.is_none()
        || state.effects.is_none()
    {
        return Err(wayland_error(
            "Requires wl_compositor, wl_shm, zwlr_layer_shell_v1 and ext_background_effect_manager_v1",
        ));
    }
    let mut last_capability = None;
    loop {
        if receiver.recv_timeout(TICK) == Err(crossbeam_channel::RecvTimeoutError::Disconnected) {
            return Ok(());
        }
        let active = {
            let target = target
                .lock()
                .map_err(|_| AppError::LockPoisoned("Linux blur target"))?;
            target_is_live(&target, Instant::now())
        };
        if last_capability != Some(state.blur_supported) {
            set_status(
                status,
                state.blur_supported,
                if state.blur_supported {
                    "Native compositor blur available; radius is compositor-controlled"
                } else {
                    "Compositor does not advertise the blur capability; keeping existing dimming"
                }
                .into(),
            );
            last_capability = Some(state.blur_supported);
        }
        state.reconcile(active && state.blur_supported, &qh);
        if let Some(error) = state.error.take() {
            return Err(wayland_error(error));
        }
        // Only this isolated worker can block on a compositor, never the EEG/UI thread.
        queue.roundtrip(&mut state).map_err(wayland_error)?;
        if let Ok(mut status) = status.lock() {
            status.requested = active;
            status.mapped_outputs = state.surfaces.iter().filter(|s| s.buffer.is_some()).count();
            status.active = status.mapped_outputs > 0;
        }
    }
}

#[derive(Default)]
struct WaylandState {
    compositor: Option<wl_compositor::WlCompositor>,
    shm: Option<wl_shm::WlShm>,
    shell: Option<shell::ZwlrLayerShellV1>,
    effects: Option<effects::ExtBackgroundEffectManagerV1>,
    blur_supported: bool,
    outputs: Vec<(u32, wl_output::WlOutput)>,
    surfaces: Vec<Surface>,
    error: Option<String>,
}

struct Surface {
    output: u32,
    surface: wl_surface::WlSurface,
    layer: layer::ZwlrLayerSurfaceV1,
    effect: effect::ExtBackgroundEffectSurfaceV1,
    buffer: Option<wl_buffer::WlBuffer>,
    size: (u32, u32),
}

impl Drop for Surface {
    fn drop(&mut self) {
        self.effect.destroy();
        self.layer.destroy();
        self.surface.destroy();
        if let Some(buffer) = &self.buffer {
            buffer.destroy();
        }
    }
}

impl WaylandState {
    fn reconcile(&mut self, active: bool, qh: &QueueHandle<Self>) {
        if !active {
            self.surfaces.clear();
            return;
        }
        self.surfaces
            .retain(|s| self.outputs.iter().any(|(id, _)| *id == s.output));
        let (Some(compositor), Some(shell), Some(effects)) =
            (&self.compositor, &self.shell, &self.effects)
        else {
            return;
        };
        for (id, output) in &self.outputs {
            if self.surfaces.iter().any(|s| s.output == *id) {
                continue;
            }
            let surface = compositor.create_surface(qh, ());
            let input = compositor.create_region(qh, ());
            surface.set_input_region(Some(&input)); // Empty region: ALL pointer/touch input passes through.
            input.destroy();
            let layer = shell.get_layer_surface(
                &surface,
                Some(output),
                shell::Layer::Overlay,
                "focusglass-blur".into(),
                qh,
                *id,
            );
            layer.set_anchor(
                layer::Anchor::Top
                    | layer::Anchor::Bottom
                    | layer::Anchor::Left
                    | layer::Anchor::Right,
            );
            layer.set_size(0, 0);
            // Respect space reserved by panels/docks without reserving desktop space ourselves.
            // -1 deliberately covered that space too, blurring Plasma's taskbar.
            layer.set_exclusive_zone(0);
            layer.set_keyboard_interactivity(layer::KeyboardInteractivity::None);
            let effect = effects.get_background_effect(&surface, qh, ());
            self.surfaces.push(Surface {
                output: *id,
                surface,
                layer,
                effect,
                buffer: None,
                size: (0, 0),
            });
            if let Some(s) = self.surfaces.last() {
                s.surface.commit(); // Initial bufferless commit; wait for configure before drawing.
            }
        }
    }

    fn configure(
        &mut self,
        id: u32,
        width: u32,
        height: u32,
        qh: &QueueHandle<Self>,
    ) -> WorkerResult<()> {
        let Some(s) = self.surfaces.iter_mut().find(|s| s.output == id) else {
            return Ok(());
        };
        if width == 0 || height == 0 {
            return Err(wayland_error("Layer-shell supplied an empty output size"));
        }
        if s.size == (width, height) {
            return Ok(());
        }
        let shm = self
            .shm
            .as_ref()
            .ok_or_else(|| wayland_error("wl_shm unavailable"))?;
        let compositor = self
            .compositor
            .as_ref()
            .ok_or_else(|| wayland_error("wl_compositor unavailable"))?;
        let (file, length, stride) = glass_buffer(width, height)?;
        let pool = shm.create_pool(file.as_fd(), length, qh, ());
        let buffer = pool.create_buffer(
            0,
            width as i32,
            height as i32,
            stride,
            wl_shm::Format::Argb8888,
            qh,
            (),
        );
        pool.destroy();
        let region = compositor.create_region(qh, ());
        region.add(0, 0, width as i32, height as i32);
        s.effect.set_blur_region(Some(&region));
        region.destroy();
        s.surface.attach(Some(&buffer), 0, 0);
        s.surface.damage(0, 0, i32::MAX, i32::MAX);
        s.surface.commit();
        if let Some(old) = s.buffer.replace(buffer) {
            old.destroy();
        }
        s.size = (width, height);
        Ok(())
    }
}

/// Premultiplied translucent neutral veil, NOT a fabricated screenshot or shader blur.
/// A nonzero alpha also avoids compositor optimizations dropping a fully invisible surface.
fn glass_buffer(width: u32, height: u32) -> WorkerResult<(File, i32, i32)> {
    let length = u64::from(width) * u64::from(height) * 4;
    if width == 0 || height == 0 || width > 16384 || height > 16384 || length > 128 * 1024 * 1024 {
        return Err(wayland_error(
            "Wayland blur output exceeds the 128 MiB surface budget",
        ));
    }
    let mut file = tempfile::tempfile()?;
    let row: Vec<u8> = (0..width)
        .flat_map(|_| 0x04030303u32.to_ne_bytes())
        .collect();
    for _ in 0..height {
        file.write_all(&row)?;
    }
    Ok((file, length as i32, (width * 4) as i32))
}

impl Dispatch<wl_registry::WlRegistry, ()> for WaylandState {
    fn event(
        state: &mut Self,
        registry: &wl_registry::WlRegistry,
        event: wl_registry::Event,
        _: &(),
        _: &Connection,
        qh: &QueueHandle<Self>,
    ) {
        match event {
            wl_registry::Event::Global {
                name,
                interface,
                version,
            } => match interface.as_str() {
                "wl_compositor" => {
                    state.compositor = Some(registry.bind(name, version.min(4), qh, ()))
                }
                "wl_shm" => state.shm = Some(registry.bind(name, 1, qh, ())),
                "zwlr_layer_shell_v1" => {
                    state.shell = Some(registry.bind(name, version.min(4), qh, ()))
                }
                "ext_background_effect_manager_v1" => {
                    state.effects = Some(registry.bind(name, 1, qh, ()))
                }
                "wl_output" => state
                    .outputs
                    .push((name, registry.bind(name, version.min(4), qh, ()))),
                _ => {}
            },
            wl_registry::Event::GlobalRemove { name } => {
                state.surfaces.retain(|s| s.output != name);
                state.outputs.retain(|(id, output)| {
                    if *id != name {
                        return true;
                    }
                    if output.version() >= 3 {
                        output.release();
                    }
                    false
                });
            }
            _ => {}
        }
    }
}

impl Dispatch<effects::ExtBackgroundEffectManagerV1, ()> for WaylandState {
    fn event(
        state: &mut Self,
        _: &effects::ExtBackgroundEffectManagerV1,
        event: effects::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        if let effects::Event::Capabilities { flags } = event {
            state.blur_supported = match flags {
                WEnum::Value(flags) => flags.contains(effects::Capability::Blur),
                WEnum::Unknown(bits) => bits & 1 != 0,
            };
        }
    }
}

impl Dispatch<layer::ZwlrLayerSurfaceV1, u32> for WaylandState {
    fn event(
        state: &mut Self,
        proxy: &layer::ZwlrLayerSurfaceV1,
        event: layer::Event,
        id: &u32,
        _: &Connection,
        qh: &QueueHandle<Self>,
    ) {
        match event {
            layer::Event::Configure {
                serial,
                width,
                height,
            } => {
                proxy.ack_configure(serial);
                if let Err(error) = state.configure(*id, width, height, qh) {
                    state.error = Some(error.to_string());
                }
            }
            layer::Event::Closed => {
                // Stop instead of repeatedly recreating a surface the compositor rejected.
                state.error = Some("Compositor closed a FocusGlass layer surface".into());
            }
            _ => {}
        }
    }
}

delegate_noop!(WaylandState: ignore wl_compositor::WlCompositor);
delegate_noop!(WaylandState: ignore wl_surface::WlSurface);
delegate_noop!(WaylandState: ignore wl_shm::WlShm);
delegate_noop!(WaylandState: ignore wl_shm_pool::WlShmPool);
delegate_noop!(WaylandState: ignore wl_buffer::WlBuffer);
delegate_noop!(WaylandState: ignore wl_output::WlOutput);
delegate_noop!(WaylandState: ignore shell::ZwlrLayerShellV1);
delegate_noop!(WaylandState: ignore effect::ExtBackgroundEffectSurfaceV1);
delegate_noop!(WaylandState: ignore wayland_client::protocol::wl_region::WlRegion);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn positive_request_activates_without_a_second_radius_threshold() {
        assert!(should_blur(0.01, 0.1));
        assert!(should_blur(0.5, 4.0));
        assert!(!should_blur(0.5, 0.0));
        assert!(!should_blur(0.0, 32.0));
    }

    #[test]
    fn wayland_autostarts_unless_explicitly_disabled() {
        assert!(backend_enabled(None, true));
        assert!(!backend_enabled(None, false));
        assert!(!backend_enabled(Some("0"), true));
        assert!(backend_enabled(Some("1"), false));
    }

    #[test]
    fn preview_has_a_fixed_deadline_without_telemetry() {
        let now = Instant::now();
        let target = Target {
            preview_until: Some(now + Duration::from_secs(3)),
            ..Target::default()
        };
        assert!(target_is_live(&target, now));
        assert!(!target_is_live(&target, now + Duration::from_secs(3)));
    }

    #[test]
    fn missing_and_stale_heartbeats_clear_the_target() {
        let now = Instant::now();
        assert!(!target_is_live(&Target::default(), now));
        let mut target = Target {
            active: true,
            updated: Some(now),
            preview_until: None,
        };
        assert!(target_is_live(&target, now));
        assert!(!target_is_live(&target, now + HEARTBEAT_TIMEOUT));
        target.active = false;
        assert!(!target_is_live(&target, now));
    }

    /// Explicitly opt in: this briefly maps fullscreen noninteractive surfaces.
    /// Checks protocol acceptance, not perceived blur quality or physical input delivery.
    #[test]
    #[ignore = "requires a live Wayland compositor with layer-shell and background-effect"]
    fn wayland_smoke_maps_and_clears_all_outputs() -> WorkerResult<()> {
        let connection = Connection::connect_to_env().map_err(wayland_error)?;
        let mut queue = connection.new_event_queue();
        let qh = queue.handle();
        connection.display().get_registry(&qh, ());
        let mut state = WaylandState::default();
        queue.roundtrip(&mut state).map_err(wayland_error)?;
        queue.roundtrip(&mut state).map_err(wayland_error)?;
        assert!(state.blur_supported, "blur capability missing");
        assert!(state.shell.is_some(), "layer-shell missing");
        assert!(!state.outputs.is_empty(), "no outputs");
        for _ in 0..2 {
            state.reconcile(true, &qh);
            queue.roundtrip(&mut state).map_err(wayland_error)?; // configure -> buffer commit
            queue.roundtrip(&mut state).map_err(wayland_error)?; // server accepts buffer/effect
            assert!(state.error.is_none(), "{:?}", state.error);
            assert_eq!(state.surfaces.len(), state.outputs.len());
            assert!(state.surfaces.iter().all(|s| s.buffer.is_some()));
            state.reconcile(false, &qh);
            queue.roundtrip(&mut state).map_err(wayland_error)?;
            assert!(state.surfaces.is_empty());
        }
        Ok(())
    }

    #[test]
    #[ignore = "maps fullscreen blur for 3 seconds on a live Wayland compositor"]
    fn wayland_worker_preview_expires_without_telemetry() -> WorkerResult<()> {
        fn wait_until(predicate: impl Fn() -> bool, timeout: Duration) -> bool {
            let deadline = Instant::now() + timeout;
            while Instant::now() < deadline {
                if predicate() {
                    return true;
                }
                thread::sleep(Duration::from_millis(20));
            }
            false
        }

        let blur = LinuxBlur::start_enabled(true);
        assert!(
            wait_until(
                || blur.status().is_ok_and(|s| s.available),
                Duration::from_secs(3)
            ),
            "{}",
            blur.status()?.message
        );
        blur.preview()?;
        assert!(
            wait_until(
                || blur
                    .status()
                    .is_ok_and(|s| s.active && s.mapped_outputs > 0),
                Duration::from_secs(1),
            ),
            "worker never mapped the preview"
        );
        // Clearing normal EEG updates must not cancel the independent preview.
        blur.update(0.0, 0.0)?;
        assert!(blur.status()?.active);
        assert!(
            wait_until(
                || blur
                    .status()
                    .is_ok_and(|s| !s.active && s.mapped_outputs == 0),
                Duration::from_secs(4),
            ),
            "preview did not clear on deadline"
        );
        Ok(())
    }

    #[test]
    fn buffer_is_premultiplied_and_dimension_checked() {
        use std::io::{Read, Seek, SeekFrom};
        let (mut file, length, stride) = glass_buffer(2, 3).expect("buffer");
        assert_eq!((length, stride), (24, 8));
        file.seek(SeekFrom::Start(0)).expect("rewind");
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).expect("read");
        assert_eq!(bytes, 0x04030303u32.to_ne_bytes().repeat(6));
        assert!(glass_buffer(0, 2).is_err());
        assert!(glass_buffer(16384, 16384).is_err());
    }
}
