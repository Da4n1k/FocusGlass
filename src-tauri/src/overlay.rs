//! Управление окнами оверлея FocusGlass.
//!
//! Поддерживает две платформенные архитектуры:
//! - Windows (основная): единое полноэкранное окно `overlay` со сквозным режимом,
//!   динамическим hit-test для плавающего HUD и захватом экрана для размытия (`screen_blur`).
//! - Linux / прочие ОС: по одному прозрачному click-through окну `overlay-0`, `overlay-1`
//!   на каждый монитор при наличии композитора (через `gtk::gdk::Screen::is_composited`),
//!   или безопасный fallback на внутристраничный оверлей в окне `main`.

use std::sync::atomic::Ordering;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::commands::{ensure_click_through_allowed, RestoreShortcutState};
use crate::error::{AppError, AppResult};

pub const MAIN_LABEL: &str = "main";
pub const OVERLAY_LABEL: &str = "overlay";
pub const OVERLAY_LABEL_PREFIX: &str = "overlay-";

pub const EVENT_OVERLAY_FRAME: &str = "overlay-frame";
pub const EVENT_CLICK_THROUGH: &str = "click-through-changed";
pub const EVENT_OVERLAY_ENABLED: &str = "overlay-enabled-changed";
pub const EVENT_DASHBOARD_SHOWN: &str = "dashboard-shown";
pub const EVENT_QUIT_REQUESTED: &str = "quit-requested";
pub const EVENT_BACKEND_ERROR: &str = "backend-error";

/// Аргументы WebView2. Должны совпадать с `additionalBrowserArgs` окна `main` в
/// `tauri.conf.json`: окна делят один браузерный процесс. Отключаем троттлинг
/// таймеров, иначе БОС-движок в скрытом окне `main` замедлится до 1 Гц.
#[cfg_attr(not(windows), allow(dead_code))]
pub const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows";

/// Порог включения размытия экрана, px (гистерезис: выключение ниже `BLUR_OFF_PX`).
pub const BLUR_ON_PX: f64 = 4.0;
pub const BLUR_OFF_PX: f64 = 2.0;

// ---------------------------------------------------------------------------
// Общая геометрия и реестр оверлейных окон (Linux multi-monitor + Windows info)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OverlaySpec {
    pub label: String,
    pub rect: Rect,
}

/// По одному оверлею на каждый пригодный монитор; мониторы нулевого размера пропускаются.
pub fn plan_overlays(monitors: &[Rect]) -> Vec<OverlaySpec> {
    monitors
        .iter()
        .filter(|rect| rect.width > 0 && rect.height > 0)
        .enumerate()
        .map(|(index, rect)| OverlaySpec {
            label: format!("{OVERLAY_LABEL_PREFIX}{index}"),
            rect: *rect,
        })
        .collect()
}

#[derive(Debug, Clone, Default)]
pub struct OverlayRegistry {
    pub labels: Vec<String>,
    pub composited: bool,
    pub unified_hud: bool,
}

#[derive(Default)]
pub struct OverlayState(pub Mutex<OverlayRegistry>);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayInfo {
    pub count: usize,
    pub composited: bool,
    pub unified_hud: bool,
}

impl From<&OverlayRegistry> for OverlayInfo {
    fn from(registry: &OverlayRegistry) -> Self {
        Self {
            count: registry.labels.len(),
            composited: registry.composited,
            unified_hud: registry.unified_hud,
        }
    }
}

#[cfg(target_os = "linux")]
fn display_is_composited() -> bool {
    gtk::gdk::Screen::default()
        .map(|screen| screen.is_composited())
        .unwrap_or(false)
}

#[cfg(not(target_os = "linux"))]
#[cfg_attr(windows, allow(dead_code))]
fn display_is_composited() -> bool {
    true
}

#[cfg_attr(windows, allow(dead_code))]
fn build_linux_overlay(app: &AppHandle, spec: &OverlaySpec) -> AppResult<()> {
    let window = WebviewWindowBuilder::new(
        app,
        &spec.label,
        WebviewUrl::App("overlay.html".into()),
    )
    .title("FocusGlass Overlay")
    .transparent(true)
    .decorations(false)
    .shadow(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focusable(false)
    .focused(false)
    .visible(true)
    .build()?;

    window.set_position(PhysicalPosition::new(spec.rect.x, spec.rect.y))?;
    window.set_size(PhysicalSize::new(spec.rect.width, spec.rect.height))?;
    window.set_ignore_cursor_events(true)?;
    window.hide()?;
    Ok(())
}

#[cfg_attr(windows, allow(dead_code))]
fn destroy_linux_overlays(app: &AppHandle) {
    for (label, window) in app.webview_windows() {
        if label.starts_with(OVERLAY_LABEL_PREFIX) {
            let _ = window.destroy();
        }
    }
}

#[cfg_attr(windows, allow(dead_code))]
fn create_linux_overlays(app: &AppHandle) -> AppResult<Vec<String>> {
    let monitors = app.available_monitors()?;
    let rects: Vec<Rect> = monitors
        .iter()
        .map(|monitor| Rect {
            x: monitor.position().x,
            y: monitor.position().y,
            width: monitor.size().width,
            height: monitor.size().height,
        })
        .collect();

    let mut labels = Vec::new();
    for spec in plan_overlays(&rects) {
        build_linux_overlay(app, &spec)?;
        labels.push(spec.label);
    }
    Ok(labels)
}

/// Создаёт покомпонентные окна `overlay-*` для Linux/X11/Wayland при наличии композитора.
#[cfg_attr(windows, allow(dead_code))]
pub fn init_linux_overlays(app: &AppHandle) -> OverlayRegistry {
    if !display_is_composited() {
        eprintln!("FocusGlass: display is not composited, using the in-page overlay fallback");
        return OverlayRegistry {
            labels: Vec::new(),
            composited: false,
            unified_hud: false,
        };
    }

    match create_linux_overlays(app) {
        Ok(labels) => OverlayRegistry {
            labels,
            composited: true,
            unified_hud: false,
        },
        Err(err) => {
            eprintln!(
                "FocusGlass: cannot create overlay windows ({err}), using the in-page overlay fallback"
            );
            destroy_linux_overlays(app);
            OverlayRegistry {
                labels: Vec::new(),
                composited: true,
                unified_hud: false,
            }
        }
    }
}

#[tauri::command]
pub fn get_overlay_info(state: State<'_, OverlayState>) -> AppResult<OverlayInfo> {
    let guard = state
        .0
        .lock()
        .map_err(|_| AppError::LockPoisoned("Overlay"))?;
    Ok(OverlayInfo::from(&*guard))
}

#[tauri::command]
pub fn set_overlay_visible(
    app: AppHandle,
    state: State<'_, OverlayState>,
    visible: bool,
) -> AppResult<()> {
    let (labels, unified_hud) = {
        let guard = state
            .0
            .lock()
            .map_err(|_| AppError::LockPoisoned("Overlay"))?;
        (guard.labels.clone(), guard.unified_hud)
    };

    if unified_hud {
        return Ok(());
    }

    for label in labels {
        let Some(window) = app.get_webview_window(&label) else {
            continue;
        };
        if visible {
            window.show()?;
            window.set_always_on_top(true)?;
            window.set_ignore_cursor_events(true)?;
        } else {
            window.hide()?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Единый полноэкранный оверлей и контроллер кадров (Windows + общий IPC)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DimmingScope {
    Fullscreen,
    Distractors,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SensorFlags {
    pub t3: bool,
    pub t4: bool,
    pub o1: bool,
    pub o2: bool,
}

/// Состояние БОС, которое окно `main` публикует для окна `overlay` (~15 Гц).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayFrame {
    pub opacity: f64,
    pub blur_px: f64,
    pub metric: f64,
    pub threshold: f64,
    pub mode: String,
    pub scope: DimmingScope,
    pub stream_active: bool,
    pub contact_ok: bool,
    pub artifact_frozen: bool,
    pub is_simulator: bool,
    pub paused: bool,
    pub hud_visible: bool,
    pub active_preset: String,
    pub sensors: SensorFlags,
    /// Заполняется Rust-ядром: размытие активно, оверлей может запрашивать снимки экрана.
    #[serde(default)]
    pub blur_active: bool,
}

impl OverlayFrame {
    /// Приводит числа к допустимым диапазонам; нечисловые значения отвергает.
    pub fn sanitized(mut self) -> AppResult<Self> {
        let numbers = [self.opacity, self.blur_px, self.metric, self.threshold];
        if numbers.iter().any(|n| !n.is_finite()) {
            return Err(AppError::InvalidArgument(
                "overlay frame contains non-finite numbers".to_string(),
            ));
        }
        self.opacity = self.opacity.clamp(0.0, 0.95);
        self.blur_px = self.blur_px.clamp(0.0, 32.0);
        self.metric = self.metric.clamp(0.0, 100.0);
        self.threshold = self.threshold.clamp(0.0, 100.0);
        Ok(self)
    }
}

/// Прямоугольник в физических пикселях.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct PixelRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl PixelRect {
    pub fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && y >= self.y && x < self.x + self.width && y < self.y + self.height
    }

    #[cfg_attr(not(windows), allow(dead_code))]
    pub fn translated(&self, dx: f64, dy: f64) -> Self {
        Self {
            x: self.x + dx,
            y: self.y + dy,
            ..*self
        }
    }
}

#[derive(Debug)]
pub struct UnifiedOverlayState {
    pub enabled: bool,
    /// `true` — HUD тоже пропускает клики (оверлей полностью «призрачный»).
    pub click_through: bool,
    /// Область HUD относительно окна оверлея; `None`, пока HUD скрыт.
    pub hud_rect: Option<PixelRect>,
    pub blur_active: bool,
    pub last_frame: Option<OverlayFrame>,
}

pub struct OverlayController(Mutex<UnifiedOverlayState>);

impl Default for OverlayController {
    fn default() -> Self {
        Self(Mutex::new(UnifiedOverlayState {
            enabled: true,
            click_through: false,
            hud_rect: None,
            blur_active: false,
            last_frame: None,
        }))
    }
}

impl OverlayController {
    pub fn with<R>(&self, f: impl FnOnce(&mut UnifiedOverlayState) -> R) -> AppResult<R> {
        let mut guard = self
            .0
            .lock()
            .map_err(|_| AppError::LockPoisoned("overlay state"))?;
        Ok(f(&mut guard))
    }
}

/// Нужно ли размытие экрана при данном кадре (с гистерезисом против мерцания).
pub fn blur_decision(currently_active: bool, frame: &OverlayFrame, overlay_enabled: bool) -> bool {
    if !overlay_enabled || frame.scope != DimmingScope::Fullscreen || frame.opacity <= 0.0 {
        return false;
    }
    if currently_active {
        frame.blur_px >= BLUR_OFF_PX
    } else {
        frame.blur_px >= BLUR_ON_PX
    }
}

/// Должен ли оверлей перехватывать мышь при данном положении курсора.
pub fn should_capture_cursor(
    click_through: bool,
    hud_rect: Option<PixelRect>,
    window_origin: (f64, f64),
    cursor: (f64, f64),
) -> bool {
    if click_through {
        return false;
    }
    hud_rect.is_some_and(|rect| {
        rect.translated(window_origin.0, window_origin.1)
            .contains(cursor.0, cursor.1)
    })
}

pub fn main_window(app: &AppHandle) -> AppResult<WebviewWindow> {
    app.get_webview_window(MAIN_LABEL)
        .ok_or(AppError::WindowNotFound(MAIN_LABEL))
}

pub fn overlay_window(app: &AppHandle) -> AppResult<WebviewWindow> {
    app.get_webview_window(OVERLAY_LABEL)
        .ok_or(AppError::WindowNotFound(OVERLAY_LABEL))
}

/// Сообщает фронтенду об ошибке, возникшей вне вызова команды (трей, хоткей, потоки).
pub fn report_error(app: &AppHandle, error: &AppError) {
    eprintln!("[FocusGlass] {error}");
    let _ = app.emit_to(MAIN_LABEL, EVENT_BACKEND_ERROR, error);
}

/// Создаёт единое окно оверлея поверх основного монитора (Windows).
#[cfg_attr(not(windows), allow(dead_code))]
pub fn create_overlay_window(app: &AppHandle) -> AppResult<WebviewWindow> {
    let monitor = app
        .primary_monitor()?
        .ok_or_else(|| AppError::InvalidArgument("no primary monitor detected".to_string()))?;
    let scale = monitor.scale_factor();
    let position = *monitor.position();
    let size = *monitor.size();

    let window = WebviewWindowBuilder::new(app, OVERLAY_LABEL, WebviewUrl::App("index.html".into()))
        .title("FocusGlass Overlay")
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .focusable(false)
        .visible(false)
        .position(
            f64::from(position.x) / scale,
            f64::from(position.y) / scale,
        )
        .inner_size(f64::from(size.width) / scale, f64::from(size.height) / scale)
        .additional_browser_args(BROWSER_ARGS)
        .build()?;

    // Логические координаты округляются — фиксируем точные физические.
    window.set_position(PhysicalPosition::new(position.x, position.y))?;
    window.set_size(PhysicalSize::new(size.width, size.height))?;
    window.set_ignore_cursor_events(true)?;
    window.show()?;
    Ok(window)
}

/// Принимает кадр БОС от окна `main`, пересылает его оверлею и управляет размытием.
pub fn publish_frame(app: &AppHandle, frame: OverlayFrame) -> AppResult<()> {
    let mut frame = frame.sanitized()?;
    let controller = app.state::<OverlayController>();
    let window = overlay_window(app)?;

    let (was_active, wanted) = controller.with(|state| {
        (
            state.blur_active,
            blur_decision(state.blur_active, &frame, state.enabled),
        )
    })?;

    let mut blur_error = None;
    let mut active = was_active;
    if wanted != was_active {
        // Перед первым снимком оверлей исключается из захвата экрана, иначе он
        // попал бы в собственный фон и затемнение накапливалось бы.
        match crate::screen_blur::set_capture_exclusion(&window, wanted) {
            Ok(()) => active = wanted,
            Err(error) => blur_error = Some(error),
        }
    }

    frame.blur_active = active;
    controller.with(|state| {
        state.blur_active = active;
        state.last_frame = Some(frame.clone());
    })?;
    window.emit_to(OVERLAY_LABEL, EVENT_OVERLAY_FRAME, &frame)?;
    blur_error.map_or(Ok(()), Err)
}

/// Переключает click-through оверлея (на Windows) или главного окна (на Linux).
pub fn set_click_through(app: &AppHandle, enabled: bool) -> AppResult<bool> {
    let shortcut_registered = app
        .try_state::<RestoreShortcutState>()
        .is_some_and(|s| s.0.load(Ordering::SeqCst));
    let has_tray = cfg!(windows) && app.try_state::<crate::tray::TrayItems>().is_some();
    ensure_click_through_allowed(enabled, shortcut_registered || has_tray)?;

    if let Ok(window) = overlay_window(app) {
        if enabled {
            window.set_ignore_cursor_events(true)?;
        }
    } else {
        main_window(app)?.set_ignore_cursor_events(enabled)?;
    }

    app.state::<OverlayController>()
        .with(|state| state.click_through = enabled)?;
    app.emit(EVENT_CLICK_THROUGH, enabled)?;
    crate::tray::sync(app);
    Ok(enabled)
}

pub fn set_overlay_enabled(app: &AppHandle, enabled: bool) -> AppResult<bool> {
    if let Ok(window) = overlay_window(app) {
        if enabled {
            window.show()?;
        } else {
            let blur_was_active = app
                .state::<OverlayController>()
                .with(|state| std::mem::replace(&mut state.blur_active, false))?;
            if blur_was_active {
                crate::screen_blur::set_capture_exclusion(&window, false)?;
            }
            window.hide()?;
        }
    }
    app.state::<OverlayController>()
        .with(|state| state.enabled = enabled)?;
    app.emit(EVENT_OVERLAY_ENABLED, enabled)?;
    crate::tray::sync(app);
    Ok(enabled)
}

/// Показывает панель управления и возвращает фокус окну `main`.
pub fn show_dashboard(app: &AppHandle) -> AppResult<()> {
    let window = main_window(app)?;
    window.unminimize()?;
    window.show()?;
    window.set_focus()?;
    app.emit_to(MAIN_LABEL, EVENT_DASHBOARD_SHOWN, ())?;
    Ok(())
}

/// Поток hit-test: делает HUD кликабельным, оставляя остальной оверлей сквозным.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn spawn_hit_test_thread(app: AppHandle) -> AppResult<()> {
    thread::Builder::new()
        .name("focusglass-overlay-hit-test".to_string())
        .spawn(move || {
            let mut applied_capture = false;
            loop {
                let Some(controller) = app.try_state::<OverlayController>() else {
                    return;
                };
                let snapshot = controller.with(|state| {
                    (state.enabled, state.click_through, state.hud_rect)
                });
                let Ok((enabled, click_through, hud_rect)) = snapshot else {
                    return;
                };

                let hud_is_interactive = enabled && !click_through && hud_rect.is_some();
                let wanted_capture = hud_is_interactive
                    && match hit_test(&app, click_through, hud_rect) {
                        Ok(capture) => capture,
                        Err(error) => {
                            report_error(&app, &error);
                            false
                        }
                    };

                if wanted_capture != applied_capture {
                    match overlay_window(&app)
                        .and_then(|w| Ok(w.set_ignore_cursor_events(!wanted_capture)?))
                    {
                        Ok(()) => applied_capture = wanted_capture,
                        Err(AppError::WindowNotFound(_)) => return,
                        Err(error) => report_error(&app, &error),
                    }
                }

                thread::sleep(Duration::from_millis(if hud_is_interactive {
                    40
                } else {
                    200
                }));
            }
        })?;
    Ok(())
}

#[cfg_attr(not(windows), allow(dead_code))]
fn hit_test(app: &AppHandle, click_through: bool, hud_rect: Option<PixelRect>) -> AppResult<bool> {
    let cursor = app.cursor_position()?;
    let origin = overlay_window(app)?.outer_position()?;
    Ok(should_capture_cursor(
        click_through,
        hud_rect,
        (f64::from(origin.x), f64::from(origin.y)),
        (cursor.x, cursor.y),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn monitor(x: i32, y: i32, width: u32, height: u32) -> Rect {
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    fn frame(opacity: f64, blur_px: f64, scope: DimmingScope) -> OverlayFrame {
        OverlayFrame {
            opacity,
            blur_px,
            metric: 40.0,
            threshold: 60.0,
            mode: "concentration".to_string(),
            scope,
            stream_active: true,
            contact_ok: true,
            artifact_frozen: false,
            is_simulator: true,
            paused: false,
            hud_visible: true,
            active_preset: "attention_drift".to_string(),
            sensors: SensorFlags {
                t3: true,
                t4: true,
                o1: true,
                o2: true,
            },
            blur_active: false,
        }
    }

    #[test]
    fn one_overlay_per_monitor_with_stable_labels() {
        let specs = plan_overlays(&[monitor(0, 0, 1920, 1080), monitor(1920, 0, 2560, 1440)]);
        assert_eq!(specs.len(), 2);
        assert_eq!(specs[0].label, "overlay-0");
        assert_eq!(specs[1].label, "overlay-1");
        assert_eq!(specs[1].rect, monitor(1920, 0, 2560, 1440));
    }

    #[test]
    fn monitors_left_of_or_above_the_origin_keep_their_negative_position() {
        let specs = plan_overlays(&[monitor(0, 0, 1920, 1080), monitor(-1280, -200, 1280, 1024)]);
        assert_eq!(specs[1].rect.x, -1280);
        assert_eq!(specs[1].rect.y, -200);
    }

    #[test]
    fn degenerate_monitors_are_skipped_without_leaving_label_gaps() {
        let specs = plan_overlays(&[
            monitor(0, 0, 0, 1080),
            monitor(0, 0, 1920, 1080),
            monitor(1920, 0, 1920, 0),
            monitor(1920, 0, 1280, 720),
        ]);
        let labels: Vec<&str> = specs.iter().map(|s| s.label.as_str()).collect();
        assert_eq!(labels, vec!["overlay-0", "overlay-1"]);
        assert_eq!(specs[1].rect, monitor(1920, 0, 1280, 720));
    }

    #[test]
    fn no_monitors_means_no_overlays() {
        assert!(plan_overlays(&[]).is_empty());
    }

    #[test]
    fn every_planned_label_matches_the_overlay_prefix() {
        for spec in plan_overlays(&[monitor(0, 0, 10, 10), monitor(10, 0, 10, 10)]) {
            assert!(spec.label.starts_with(OVERLAY_LABEL_PREFIX));
        }
    }

    #[test]
    fn overlay_info_reports_window_count_and_compositing() {
        let registry = OverlayRegistry {
            labels: vec!["overlay-0".to_string(), "overlay-1".to_string()],
            composited: true,
            unified_hud: false,
        };
        let info = OverlayInfo::from(&registry);
        assert_eq!(
            info,
            OverlayInfo {
                count: 2,
                composited: true,
                unified_hud: false,
            }
        );

        let json = serde_json::to_value(&info).expect("serialise");
        assert_eq!(json["count"], 2);
        assert_eq!(json["composited"], true);
        assert_eq!(json["unifiedHud"], false);
    }

    #[test]
    fn an_uncomposited_display_reports_zero_windows() {
        let info = OverlayInfo::from(&OverlayRegistry::default());
        assert_eq!(
            info,
            OverlayInfo {
                count: 0,
                composited: false,
                unified_hud: false,
            }
        );
    }

    #[test]
    fn blur_turns_on_at_threshold_and_off_with_hysteresis() {
        let below_on = frame(0.3, 3.0, DimmingScope::Fullscreen);
        let above_on = frame(0.3, 4.0, DimmingScope::Fullscreen);
        let below_off = frame(0.3, 1.9, DimmingScope::Fullscreen);

        assert!(!blur_decision(false, &below_on, true));
        assert!(blur_decision(false, &above_on, true));
        assert!(blur_decision(true, &below_on, true));
        assert!(!blur_decision(true, &below_off, true));
    }

    #[test]
    fn blur_is_never_used_without_dimming_or_in_distractor_scope() {
        assert!(!blur_decision(true, &frame(0.0, 16.0, DimmingScope::Fullscreen), true));
        assert!(!blur_decision(false, &frame(0.5, 16.0, DimmingScope::Distractors), true));
        assert!(!blur_decision(true, &frame(0.5, 16.0, DimmingScope::Fullscreen), false));
    }

    #[test]
    fn zero_blur_setting_disables_blur_entirely() {
        assert!(!blur_decision(false, &frame(0.7, 0.0, DimmingScope::Fullscreen), true));
    }

    #[test]
    fn cursor_capture_only_inside_hud_and_not_in_click_through() {
        let hud = Some(PixelRect {
            x: 1500.0,
            y: 20.0,
            width: 320.0,
            height: 200.0,
        });
        let origin = (0.0, 0.0);

        assert!(should_capture_cursor(false, hud, origin, (1600.0, 100.0)));
        assert!(!should_capture_cursor(false, hud, origin, (100.0, 100.0)));
        assert!(!should_capture_cursor(false, hud, origin, (1820.0, 100.0)));
        assert!(!should_capture_cursor(true, hud, origin, (1600.0, 100.0)));
        assert!(!should_capture_cursor(false, None, origin, (1600.0, 100.0)));
    }

    #[test]
    fn cursor_capture_accounts_for_monitor_origin() {
        let hud = Some(PixelRect {
            x: 100.0,
            y: 20.0,
            width: 320.0,
            height: 200.0,
        });
        let origin = (-1920.0, 0.0);
        assert!(should_capture_cursor(false, hud, origin, (-1700.0, 50.0)));
        assert!(!should_capture_cursor(false, hud, origin, (200.0, 50.0)));
    }

    #[test]
    fn frame_sanitizing_clamps_ranges_and_rejects_nan() {
        let clamped = frame(1.7, 99.0, DimmingScope::Fullscreen)
            .sanitized()
            .expect("finite frame");
        assert!((clamped.opacity - 0.95).abs() < f64::EPSILON);
        assert!((clamped.blur_px - 32.0).abs() < f64::EPSILON);

        let err = frame(f64::NAN, 1.0, DimmingScope::Fullscreen)
            .sanitized()
            .expect_err("NaN must be rejected");
        assert_eq!(err.kind(), "invalid_argument");
    }

    #[test]
    fn frame_uses_frontend_field_names() {
        let json = serde_json::to_value(frame(0.2, 3.0, DimmingScope::Distractors)).expect("json");
        assert_eq!(json["blurPx"], 3.0);
        assert_eq!(json["scope"], "distractors");
        assert_eq!(json["hudVisible"], true);
        assert_eq!(json["sensors"]["o2"], true);
    }
}
