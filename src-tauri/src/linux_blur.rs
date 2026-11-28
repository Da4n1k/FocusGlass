//! Native GPU effect controller (KWin plugin / XComposite helper), with a
//! compositor-controlled Wayland layer-shell fallback (unsafe, explicit opt-in).

use std::fs::File;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::fd::AsFd;
use std::os::unix::fs::{FileTypeExt, MetadataExt};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
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
    preview_blur_px: Option<f64>,
    blur_px: f64,
    frozen: bool,
}

/// A latest-value mailbox, not an unbounded queue of stale telemetry frames.
pub struct LinuxBlur {
    target: Arc<Mutex<Target>>,
    status: Arc<Mutex<Status>>,
    wake: Sender<()>,
}

impl LinuxBlur {
    pub fn start(resource_dir: Option<PathBuf>) -> Self {
        let enabled = backend_enabled(
            std::env::var("FOCUSGLASS_WAYLAND_BLUR").ok().as_deref(),
            std::env::var_os("WAYLAND_DISPLAY").is_some() || std::env::var_os("DISPLAY").is_some(),
        );
        Self::start_worker(enabled, resource_dir, true)
    }

    #[cfg(test)]
    fn start_enabled(enabled: bool) -> Self {
        Self::start_worker(enabled, None, false)
    }

    fn start_worker(enabled: bool, resource_dir: Option<PathBuf>, automatic_setup: bool) -> Self {
        let target = Arc::new(Mutex::new(Target::default()));
        let status = Arc::new(Mutex::new(Status {
            linux: true,
            enabled,
            available: false,
            requested: false,
            active: false,
            mapped_outputs: 0,
            backend: "detecting".into(),
            adjustable_radius: false,
            cursor_interaction: false,
            protected_windows: 0,
            frames: 0,
            message: if enabled {
                "Detecting native KDE / X11 effect backend"
            } else {
                "No graphical display or FOCUSGLASS_WAYLAND_BLUR=0"
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
                    let x11 = std::env::var("XDG_SESSION_TYPE").as_deref() == Ok("x11")
                        || std::env::var_os("WAYLAND_DISPLAY").is_none();
                    if !x11 && automatic_setup
                        && std::env::var("FOCUSGLASS_AUTO_INSTALL_KWIN").as_deref() != Ok("0")
                    {
                        if let Ok(mut s) = worker_status.lock() {
                            s.backend = "kwin-setup".into();
                            s.message = "Preparing KDE effect; installation may request administrator authorization".into();
                        }
                        if let Err(error) = prepare_kwin_effect(resource_dir.as_deref()) {
                            set_status(&worker_status, false, error.to_string());
                            return;
                        }
                    }
                    let native_socket = effect_socket_path();
                    let result = if x11 || native_socket.exists() {
                        run_native(target, &worker_status, receiver, x11, native_socket, resource_dir.as_deref())
                    } else if compositor_fallback_allowed(
                        std::env::var("FOCUSGLASS_UNSAFE_WAYLAND_BLUR_FALLBACK").ok().as_deref(),
                    ) {
                        if let Ok(mut s) = worker_status.lock() {
                            s.backend = "wayland-compositor-fallback".into();
                        }
                        run(target, &worker_status, receiver)
                    } else {
                        if let Ok(mut s) = worker_status.lock() {
                            s.backend = "native-effect-required".into();
                        }
                        Err(wayland_error(
                            "FocusGlass KWin effect is not loaded. Install the matching native/ plugin \
                             and enable it in KDE Desktop Effects. Fullscreen Wayland fallback is \
                             disabled because it also blurs the FocusGlass dashboard and HUD.",
                        ))
                    };
                    if let Err(error) = result {
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

    #[cfg(test)]
    pub fn update(&self, opacity: f64, blur_px: f64) -> AppResult<()> {
        self.update_frame(opacity, blur_px, false)
    }

    pub fn update_frame(&self, opacity: f64, blur_px: f64, frozen: bool) -> AppResult<()> {
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
        target.blur_px = blur_px;
        target.frozen = frozen;
        target.updated = Some(Instant::now());
        let _ = self.wake.try_send(());
        Ok(())
    }

    #[cfg(test)]
    pub fn preview(&self) -> AppResult<()> {
        self.preview_with_radius(None)
    }

    pub fn preview_with_radius(&self, blur_px: Option<f64>) -> AppResult<()> {
        if blur_px.is_some_and(|radius| !radius.is_finite() || radius <= 0.0 || radius > 32.0) {
            return Err(AppError::InvalidArgument(
                "invalid preview blur radius".into(),
            ));
        }
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
        target.preview_blur_px = blur_px;
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

fn compositor_fallback_allowed(setting: Option<&str>) -> bool {
    // Layer-shell cannot exclude another application's GTK windows or render
    // the shared particle wave. Never silently substitute it for the GPU effect.
    setting == Some("1")
}

fn prepare_kwin_effect(resource_dir: Option<&std::path::Path>) -> AppResult<()> {
    let mut candidates = Vec::new();
    if cfg!(debug_assertions) {
        candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../native/bundle"));
        candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../native/build"));
    }
    if let Some(root) = resource_dir {
        candidates.push(root.join("native"));
    }
    let directory = candidates
        .into_iter()
        .find(|root| root.join("focusglass-native-setup").is_file())
        .ok_or_else(|| {
            wayland_error(
                "The FocusGlass package does not contain its KDE setup helper. \
             Reinstall the matching Linux package; blur remains disabled.",
            )
        })?;
    let bundled = directory.join("focusglass.so");
    let plugin = if bundled.is_file() {
        bundled
    } else {
        directory.join("plugins/kwin/effects/plugins/focusglass.so")
    };
    let result = Command::new(directory.join("focusglass-native-setup"))
        .env("QT_FORCE_STDERR_LOGGING", "1")
        .arg("--ensure-kwin")
        .arg(plugin)
        .output()?;
    if !result.status.success() {
        return Err(wayland_error(format!(
            "Automatic KDE effect setup failed: {}",
            String::from_utf8_lossy(&result.stderr).trim()
        )));
    }
    Ok(())
}

fn validate_native_version(reply: &serde_json::Value) -> AppResult<()> {
    if reply["protocolVersion"].as_u64() != Some(2) {
        return Err(wayland_error(
            "Native FocusGlass effect version mismatch after setup. Blur remains disabled. \
             Restart FocusGlass; if this persists, install a matching FocusGlass update.",
        ));
    }
    Ok(())
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

fn effect_socket_path() -> PathBuf {
    if let Some(path) = std::env::var_os("FOCUSGLASS_EFFECT_SOCKET") {
        return path.into();
    }
    let display = std::env::var("WAYLAND_DISPLAY")
        .or_else(|_| std::env::var("DISPLAY"))
        .unwrap_or_default();
    let runtime = std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .unwrap_or_default();
    runtime.join(format!(
        "focusglass-effects-{}.sock",
        display.replace('/', "_")
    ))
}

struct Helper(Option<Child>, PathBuf);
impl Drop for Helper {
    fn drop(&mut self) {
        if let Some(child) = &mut self.0 {
            let _ = child.kill();
            let _ = child.wait();
            let _ = std::fs::remove_file(&self.1);
        }
    }
}

fn native_request(
    stream: &mut BufReader<UnixStream>,
    request: serde_json::Value,
) -> AppResult<serde_json::Value> {
    let mut bytes = serde_json::to_vec(&request).map_err(wayland_error)?;
    bytes.push(b'\n');
    stream.get_mut().write_all(&bytes)?;
    let mut reply = String::new();
    // Same-user socket, but still bound the response and read timeout.
    stream.by_ref().take(8192).read_line(&mut reply)?;
    let value: serde_json::Value = serde_json::from_str(&reply).map_err(wayland_error)?;
    if value["ok"] != true {
        return Err(wayland_error(
            value["error"].as_str().unwrap_or("Native effect failed"),
        ));
    }
    Ok(value)
}

fn run_native(
    target: Arc<Mutex<Target>>,
    status: &Mutex<Status>,
    receiver: Receiver<()>,
    x11: bool,
    socket: PathBuf,
    resource_dir: Option<&std::path::Path>,
) -> AppResult<()> {
    let mut helper = Helper(None, socket.clone());
    if x11 && UnixStream::connect(&socket).is_err() {
        if let Ok(metadata) = std::fs::symlink_metadata(&socket) {
            let uid = std::fs::metadata("/proc/self")?.uid();
            if !metadata.file_type().is_socket() || metadata.uid() != uid {
                return Err(wayland_error(
                    "Refusing to replace a non-socket or foreign-owned effect path",
                ));
            }
            std::fs::remove_file(&socket)?;
        }
        let mut candidates = Vec::new();
        if let Some(root) = resource_dir {
            candidates.push(root.join("native/focusglass-x11"));
        }
        if let Some(path) = std::env::var_os("FOCUSGLASS_X11_HELPER") {
            candidates.push(PathBuf::from(path));
        }
        if let Ok(exe) = std::env::current_exe()
            && let Some(parent) = exe.parent()
        {
            candidates.push(parent.join("focusglass-x11"));
        }
        candidates
            .push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../native/build/focusglass-x11"));
        candidates.push(PathBuf::from("/usr/local/bin/focusglass-x11"));
        candidates.push(PathBuf::from("/usr/bin/focusglass-x11"));
        let executable = candidates
            .into_iter()
            .find(|p| p.is_file())
            .ok_or_else(|| {
                wayland_error(
                    "X11 GPU helper is not installed. Build native/ or set FOCUSGLASS_X11_HELPER.",
                )
            })?;
        helper.0 = Some(
            Command::new(executable)
                .env("QT_QPA_PLATFORM", "xcb")
                .env_remove("WAYLAND_DISPLAY")
                .env("FOCUSGLASS_EFFECT_SOCKET", &socket)
                .env("FOCUSGLASS_PARENT_PID", std::process::id().to_string())
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .spawn()?,
        );
    }
    let started = Instant::now();
    let connection = loop {
        match UnixStream::connect(&socket) {
            Ok(connection) => break connection,
            Err(error) if started.elapsed() < Duration::from_secs(3) && helper.0.is_some() => {
                if let Some(child) = &mut helper.0
                    && let Some(exit) = child.try_wait()?
                {
                    return Err(wayland_error(format!(
                        "X11 helper exited: {exit}; check compositor and stderr"
                    )));
                }
                if receiver.recv_timeout(TICK)
                    == Err(crossbeam_channel::RecvTimeoutError::Disconnected)
                {
                    return Ok(());
                }
                let _ = error;
            }
            Err(error) => return Err(error.into()),
        }
    };
    connection.set_read_timeout(Some(Duration::from_secs(1)))?;
    connection.set_write_timeout(Some(Duration::from_secs(1)))?;
    let mut stream = BufReader::new(connection);
    let reply = native_request(&mut stream, serde_json::json!({"op":"status"}))?;
    validate_native_version(&reply)?;
    if let Ok(mut s) = status.lock() {
        s.backend = reply["backend"].as_str().unwrap_or("native-gpu").into();
        s.adjustable_radius = true;
        s.cursor_interaction = true;
    }
    set_status(
        status,
        true,
        "Native GPU blur + particle wave; application/HUD and panels excluded".into(),
    );
    let mut last_preview = None;
    loop {
        if receiver.recv_timeout(TICK) == Err(crossbeam_channel::RecvTimeoutError::Disconnected) {
            let _ = native_request(&mut stream, serde_json::json!({"op":"stop"}));
            return Ok(());
        }
        let (active, radius, frozen, preview, preview_radius) = {
            let target = target
                .lock()
                .map_err(|_| AppError::LockPoisoned("Linux blur target"))?;
            (
                target.active
                    && target
                        .updated
                        .is_some_and(|t| t.elapsed() < HEARTBEAT_TIMEOUT),
                target.blur_px / 2.0,
                target.frozen,
                target.preview_until,
                target.preview_blur_px.unwrap_or(16.0) / 2.0,
            )
        };
        if preview != last_preview {
            if preview.is_some_and(|p| p > Instant::now()) {
                native_request(
                    &mut stream,
                    serde_json::json!({"op":"preview","radius":preview_radius}),
                )?;
            } else if preview.is_none() {
                native_request(&mut stream, serde_json::json!({"op":"stop"}))?;
            }
            last_preview = preview;
        }
        let amount = if active { 1.0 } else { 0.0 };
        let reply = native_request(
            &mut stream,
            serde_json::json!({
                "op":"update", "amount":amount, "radius":radius, "frozen":frozen
            }),
        )?;
        if let Ok(mut s) = status.lock() {
            s.requested = active || preview.is_some_and(|p| p > Instant::now());
            s.active = reply["active"].as_bool().unwrap_or(false);
            s.mapped_outputs = usize::from(s.active);
            s.frames = reply["frames"].as_u64().unwrap_or(0);
            s.protected_windows = reply["protectedWindows"].as_u64().unwrap_or(0) as usize;
        }
    }
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
    fn compositor_fallback_cannot_silently_blur_the_controls() {
        assert!(!compositor_fallback_allowed(None));
        assert!(!compositor_fallback_allowed(Some("0")));
        assert!(!compositor_fallback_allowed(Some("true")));
        assert!(compositor_fallback_allowed(Some("1")));
    }

    #[test]
    fn outdated_native_effect_is_rejected_before_sending_blur_frames() {
        assert!(validate_native_version(&serde_json::json!({"ok":true})).is_err());
        assert!(validate_native_version(&serde_json::json!({"protocolVersion":1})).is_err());
        assert!(validate_native_version(&serde_json::json!({"protocolVersion":2})).is_ok());
    }

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
            ..Target::default()
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
    #[ignore = "launches native GPU blur; use only in an isolated graphical test session"]
    fn native_worker_preview_and_watchdog() -> WorkerResult<()> {
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
                Duration::from_secs(5)
            ),
            "{}",
            blur.status()?.message
        );
        assert!(blur.status()?.adjustable_radius);
        assert!(blur.preview_with_radius(Some(0.0)).is_err());
        blur.preview_with_radius(Some(24.0))?;
        assert!(
            wait_until(
                || blur.status().is_ok_and(|s| s.active && s.frames > 0),
                Duration::from_secs(2)
            ),
            "native preview never rendered"
        );
        // The production worker sends zero-radius updates during this preview.
        blur.update(0.0, 0.0)?;
        thread::sleep(Duration::from_millis(300));
        assert!(blur.status()?.active, "zero heartbeat cancelled preview");
        let connection = UnixStream::connect(effect_socket_path())?;
        connection.set_read_timeout(Some(Duration::from_secs(2)))?;
        let mut probe = BufReader::new(connection);
        let frame = native_request(&mut probe, serde_json::json!({"op":"status"}))?;
        assert_eq!(
            frame["radius"].as_f64(),
            Some(12.0),
            "preview ignored selected radius"
        );
        assert!(
            wait_until(
                || blur.status().is_ok_and(|s| !s.active),
                Duration::from_secs(5)
            ),
            "preview failed to expire"
        );
        blur.update(0.5, 16.0)?;
        assert!(
            wait_until(
                || blur.status().is_ok_and(|s| s.active),
                Duration::from_secs(1)
            ),
            "ordinary feedback did not activate"
        );
        assert!(
            wait_until(
                || blur.status().is_ok_and(|s| !s.active),
                Duration::from_secs(5)
            ),
            "stale telemetry was not cleared"
        );
        blur.stop()?;
        // Use the actual TypeScript engine and policy, not handwritten Rust
        // activation booleans, then feed their frames through this real worker.
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
        let output = Command::new("node")
            .args([
                "--import",
                "./tests/tsLoader.mjs",
                "scripts/linux/threshold-frames.ts",
            ])
            .current_dir(repo)
            .output()?;
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let frames: Vec<serde_json::Value> =
            serde_json::from_slice(&output.stdout).map_err(wayland_error)?;
        for frame in frames {
            let active = frame["active"].as_bool().expect("fixture active");
            blur.update(
                frame["opacity"].as_f64().expect("fixture opacity"),
                frame["blurPx"].as_f64().expect("fixture blur radius"),
            )?;
            assert!(
                wait_until(
                    || blur
                        .status()
                        .is_ok_and(|s| s.active == active && s.requested == active),
                    Duration::from_secs(2)
                ),
                "threshold frame failed: {frame}"
            );
            if active {
                thread::sleep(Duration::from_millis(500));
                let native = native_request(&mut probe, serde_json::json!({"op":"status"}))?;
                assert!(
                    native["amount"].as_f64().is_some_and(|a| a > 0.9),
                    "blur retained a sharp-scene blend: {native}"
                );
            }
            eprintln!(
                "PASS: TypeScript engine -> Rust worker -> GPU: {}",
                frame["name"]
            );
        }
        blur.stop()?;
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
