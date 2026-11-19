//! Умная блокировка отвлекающих приложений.
//!
//! На Windows отслеживает активное окно (`SetWinEventHook(EVENT_SYSTEM_FOREGROUND)`)
//! и видимые окна в порядке Z-order (`EnumWindows`), вычисляя незаслонённые
//! прямоугольники окон-отвлекателей (в том числе в split-screen рядом с рабочим окном,
//! никогда не перекрывая активную IDE/документ поверх них).
//! Также предоставляет список запущенных программ для выбора в настройках.

use std::collections::HashSet;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::overlay::PixelRect;

pub const EVENT_FOREGROUND_WINDOW: &str = "foreground-window";

const MAX_PATTERNS: usize = 64;
const MAX_PATTERN_CHARS: usize = 64;
const MIN_VISIBLE_REGION_PX: f64 = 48.0;

const KNOWN_BROWSERS: &[&str] = &[
    "chrome.exe",
    "msedge.exe",
    "firefox.exe",
    "opera.exe",
    "brave.exe",
    "vivaldi.exe",
    "yandex.exe",
    "browser.exe",
    "arc.exe",
];

const BROWSER_TITLE_SUFFIXES: &[&str] = &[
    "google chrome",
    "microsoft edge",
    "mozilla firefox",
    "opera",
    "brave",
    "vivaldi",
    "яндекс браузер",
    "yandex browser",
    "arc",
];

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DistractionConfig {
    pub enabled: bool,
    pub patterns: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DistractionStatus {
    /// Поддерживается ли отслеживание активного окна в этой сборке/ОС.
    pub supported: bool,
    pub enabled: bool,
    pub patterns: Vec<String>,
}

/// Видимая незаслонённая область окна-отвлекателя (поддерживает и split-screen).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DistractorRegion {
    pub exe: String,
    pub title: String,
    pub matched_pattern: String,
    pub screen_rect: PixelRect,
    pub overlay_rect: Option<PixelRect>,
}

/// Элемент списка открытых пользовательских окон для выбора в настройках.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningWindowInfo {
    pub exe: String,
    pub title: String,
    pub is_distractor: bool,
    pub matched_pattern: Option<String>,
    pub suggested_pattern: String,
    pub is_browser: bool,
}

/// Сведения об активном окне и всех видимых незаслонённых отвлекателях для фронтенда.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForegroundWindowInfo {
    /// Имя исполняемого файла в нижнем регистре, например `telegram.exe`.
    pub exe: String,
    pub title: String,
    pub is_distractor: bool,
    pub matched_pattern: Option<String>,
    /// Границы активного окна в физических пикселях экрана; `None` для свёрнутого окна.
    pub screen_rect: Option<PixelRect>,
    /// Те же границы относительно окна оверлея (заполняется перед отправкой).
    pub overlay_rect: Option<PixelRect>,
    /// Все видимые (не перекрытые рабочими окнами) области окон-отвлекателей.
    #[serde(default)]
    pub distractor_regions: Vec<DistractorRegion>,
}

/// Снимок одного видимого окна в Z-order (сверху вниз).
#[derive(Debug, Clone, PartialEq)]
pub struct WindowSnapshot {
    pub exe: String,
    pub title: String,
    pub rect: PixelRect,
    pub is_self: bool,
}

#[derive(Default)]
pub struct DistractionState {
    config: Mutex<DistractionConfig>,
    last: Mutex<Option<ForegroundWindowInfo>>,
}

impl DistractionState {
    pub fn config(&self) -> AppResult<DistractionConfig> {
        Ok(self
            .config
            .lock()
            .map_err(|_| AppError::LockPoisoned("distraction config"))?
            .clone())
    }

    pub fn set_config(&self, config: DistractionConfig) -> AppResult<DistractionStatus> {
        let normalized = DistractionConfig {
            enabled: config.enabled,
            patterns: normalize_patterns(config.patterns),
        };
        *self
            .config
            .lock()
            .map_err(|_| AppError::LockPoisoned("distraction config"))? = normalized.clone();
        Ok(DistractionStatus {
            supported: cfg!(windows),
            enabled: normalized.enabled,
            patterns: normalized.patterns,
        })
    }

    pub fn last(&self) -> AppResult<Option<ForegroundWindowInfo>> {
        Ok(self
            .last
            .lock()
            .map_err(|_| AppError::LockPoisoned("foreground window"))?
            .clone())
    }

    #[cfg_attr(not(windows), allow(dead_code))]
    fn replace_last(&self, info: Option<ForegroundWindowInfo>) -> AppResult<()> {
        *self
            .last
            .lock()
            .map_err(|_| AppError::LockPoisoned("foreground window"))? = info;
        Ok(())
    }
}

/// Приводит пользовательский список шаблонов к каноническому виду.
pub fn normalize_patterns(patterns: Vec<String>) -> Vec<String> {
    let mut result: Vec<String> = Vec::new();
    for pattern in patterns {
        let cleaned: String = pattern
            .trim()
            .to_lowercase()
            .chars()
            .take(MAX_PATTERN_CHARS)
            .collect();
        if cleaned.is_empty() || result.contains(&cleaned) {
            continue;
        }
        result.push(cleaned);
        if result.len() == MAX_PATTERNS {
            break;
        }
    }
    result
}

/// Возвращает первый шаблон, совпавший с именем процесса или заголовком окна.
pub fn classify(exe: &str, title: &str, patterns: &[String]) -> Option<String> {
    let exe = exe.to_lowercase();
    let title = title.to_lowercase();
    patterns
        .iter()
        .find(|p| !p.is_empty() && (exe.contains(p.as_str()) || title.contains(p.as_str())))
        .cloned()
}

pub fn is_browser_exe(exe: &str) -> bool {
    let lower = exe.trim().to_lowercase();
    KNOWN_BROWSERS.contains(&lower.as_str())
}

/// Подбирает удобный шаблон для 1-клик добавления программы/вкладки в отвлекатели.
/// Для браузеров берёт домен/название сайта из заголовка вкладки (чтобы не блокировать весь браузер),
/// для остальных приложений — имя процесса без `.exe`.
pub fn suggest_pattern(exe: &str, title: &str) -> (String, bool) {
    let lower_exe = exe.trim().to_lowercase();
    let is_browser = is_browser_exe(&lower_exe);

    if is_browser {
        let normalized_title = title
            .replace(" — ", "\x1f")
            .replace(" – ", "\x1f")
            .replace(" - ", "\x1f")
            .replace(" | ", "\x1f");
        let parts: Vec<String> = normalized_title
            .split('\x1f')
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty())
            .collect();

        let filtered: Vec<&String> = parts
            .iter()
            .filter(|seg| {
                !BROWSER_TITLE_SUFFIXES
                    .iter()
                    .any(|suffix| seg.as_str() == *suffix || seg.ends_with(suffix))
            })
            .collect();

        if let Some(candidate) = filtered.last() {
            let trimmed: String = candidate.chars().take(MAX_PATTERN_CHARS).collect();
            if !trimmed.is_empty() {
                return (trimmed, true);
            }
        }
    }

    let stem = lower_exe
        .strip_suffix(".exe")
        .unwrap_or(&lower_exe)
        .trim()
        .to_string();
    let fallback = if stem.is_empty() {
        title.trim().to_lowercase()
    } else {
        stem
    };
    (fallback.chars().take(MAX_PATTERN_CHARS).collect(), is_browser)
}

/// Вычитает прямоугольник `occluder` (окно выше по Z-order) из `target`,
/// возвращая до 4 непересекающихся видимых полос.
pub fn subtract_rect(target: PixelRect, occluder: PixelRect) -> Vec<PixelRect> {
    let tx1 = target.x;
    let ty1 = target.y;
    let tx2 = target.x + target.width;
    let ty2 = target.y + target.height;

    let ox1 = occluder.x;
    let oy1 = occluder.y;
    let ox2 = occluder.x + occluder.width;
    let oy2 = occluder.y + occluder.height;

    let ix1 = tx1.max(ox1);
    let iy1 = ty1.max(oy1);
    let ix2 = tx2.min(ox2);
    let iy2 = ty2.min(oy2);

    // Нет пересечения — весь target остаётся видимым.
    if ix1 >= ix2 || iy1 >= iy2 {
        return vec![target];
    }

    let mut pieces = Vec::with_capacity(4);
    // Верхняя полоса
    if iy1 > ty1 {
        pieces.push(PixelRect {
            x: tx1,
            y: ty1,
            width: tx2 - tx1,
            height: iy1 - ty1,
        });
    }
    // Нижняя полоса
    if iy2 < ty2 {
        pieces.push(PixelRect {
            x: tx1,
            y: iy2,
            width: tx2 - tx1,
            height: ty2 - iy2,
        });
    }
    // Левая полоса между iy1 и iy2
    if ix1 > tx1 {
        pieces.push(PixelRect {
            x: tx1,
            y: iy1,
            width: ix1 - tx1,
            height: iy2 - iy1,
        });
    }
    // Правая полоса между iy1 и iy2
    if ix2 < tx2 {
        pieces.push(PixelRect {
            x: ix2,
            y: iy1,
            width: tx2 - ix2,
            height: iy2 - iy1,
        });
    }

    pieces
        .into_iter()
        .filter(|r| r.width >= MIN_VISIBLE_REGION_PX && r.height >= MIN_VISIBLE_REGION_PX)
        .collect()
}

/// Вычисляет видимые (не перекрытые вышестоящими окнами) области всех окон-отвлекателей.
/// Ожидает `windows` в порядке Z-order от верхнего окна к нижнему.
pub fn compute_visible_distractor_regions(
    windows: &[WindowSnapshot],
    patterns: &[String],
) -> Vec<DistractorRegion> {
    if patterns.is_empty() {
        return Vec::new();
    }

    let mut occluders: Vec<PixelRect> = Vec::new();
    let mut regions: Vec<DistractorRegion> = Vec::new();

    for win in windows {
        if win.is_self
            || win.rect.width < MIN_VISIBLE_REGION_PX
            || win.rect.height < MIN_VISIBLE_REGION_PX
        {
            continue;
        }

        if let Some(matched) = classify(&win.exe, &win.title, patterns) {
            let mut pieces = vec![win.rect];
            for &occ in &occluders {
                let mut next = Vec::new();
                for piece in pieces {
                    next.extend(subtract_rect(piece, occ));
                }
                pieces = next;
                if pieces.is_empty() {
                    break;
                }
            }

            for visible in pieces {
                regions.push(DistractorRegion {
                    exe: win.exe.clone(),
                    title: win.title.clone(),
                    matched_pattern: matched.clone(),
                    screen_rect: visible,
                    overlay_rect: None,
                });
            }
        }

        occluders.push(win.rect);
    }

    regions
}

/// Формирует дедуплицированный список открытых окон для UI-выбора в настройках.
pub fn build_running_window_list(
    windows: &[WindowSnapshot],
    patterns: &[String],
) -> Vec<RunningWindowInfo> {
    let mut seen: HashSet<(String, String)> = HashSet::new();
    let mut result = Vec::new();

    for win in windows {
        if win.is_self || win.title.trim().is_empty() {
            continue;
        }
        let key = (win.exe.to_lowercase(), win.title.trim().to_string());
        if !seen.insert(key) {
            continue;
        }
        let matched = classify(&win.exe, &win.title, patterns);
        let (suggested_pattern, is_browser) = suggest_pattern(&win.exe, &win.title);
        result.push(RunningWindowInfo {
            exe: win.exe.clone(),
            title: win.title.clone(),
            is_distractor: matched.is_some(),
            matched_pattern: matched,
            suggested_pattern,
            is_browser,
        });
    }

    result
}

/// Возвращает список текущих открытых окон ОС для выбора отвлекателей в настройках.
#[cfg(windows)]
pub fn list_running_windows(state: &DistractionState) -> AppResult<Vec<RunningWindowInfo>> {
    let patterns = state.config()?.patterns;
    let snapshots = win::enumerate_visible_windows();
    Ok(build_running_window_list(&snapshots, &patterns))
}

#[cfg(not(windows))]
pub fn list_running_windows(_state: &DistractionState) -> AppResult<Vec<RunningWindowInfo>> {
    Ok(Vec::new())
}

/// Запускает отслеживание активного окна и видимых отвлекателей.
#[cfg(windows)]
pub fn spawn_monitor<F>(state: std::sync::Arc<DistractionState>, on_change: F) -> AppResult<()>
where
    F: Fn(Option<ForegroundWindowInfo>) + Send + 'static,
{
    win::spawn(state, on_change)
}

#[cfg(not(windows))]
pub fn spawn_monitor<F>(_state: std::sync::Arc<DistractionState>, _on_change: F) -> AppResult<()>
where
    F: Fn(Option<ForegroundWindowInfo>) + Send + 'static,
{
    Ok(())
}

#[cfg(windows)]
mod win {
    use std::path::Path;
    use std::sync::{Arc, OnceLock};
    use std::thread;
    use std::time::{Duration, Instant};

    use crossbeam_channel::{Receiver, RecvTimeoutError, Sender, bounded};
    use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, RECT};
    use windows::Win32::Graphics::Dwm::{
        DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS, DwmGetWindowAttribute,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
        QueryFullProcessImageNameW,
    };
    use windows::Win32::UI::Accessibility::{HWINEVENTHOOK, SetWinEventHook};
    use windows::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, EVENT_OBJECT_LOCATIONCHANGE, EVENT_SYSTEM_FOREGROUND,
        EVENT_SYSTEM_MOVESIZEEND, EVENT_SYSTEM_MOVESIZESTART, EnumWindows, GWL_EXSTYLE,
        GetClassNameW, GetForegroundWindow, GetMessageW, GetWindowLongW, GetWindowRect,
        GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, MSG, OBJID_WINDOW,
        TranslateMessage, WINEVENT_OUTOFCONTEXT, WS_EX_TOOLWINDOW,
    };
    use windows::core::{BOOL, PWSTR};

    use super::{
        DistractionState, ForegroundWindowInfo, WindowSnapshot, classify,
        compute_visible_distractor_regions,
    };
    use crate::error::{AppError, AppResult};
    use crate::overlay::PixelRect;

    /// Период фоновой перепроверки, если не было WinEvent (например, сменился заголовок вкладки).
    const REFRESH_INTERVAL: Duration = Duration::from_millis(200);
    /// Минимальный интервал между пересчётами Z-order при активном перетаскивании окна (~30 Гц).
    const MOVE_COALESCE_INTERVAL: Duration = Duration::from_millis(33);

    const IGNORED_CLASSES: &[&str] = &[
        "Progman",
        "WorkerW",
        "Shell_TrayWnd",
        "Shell_SecondaryTrayWnd",
        "Windows.UI.Core.CoreWindow",
    ];

    static FOREGROUND_TX: OnceLock<Sender<isize>> = OnceLock::new();

    unsafe extern "system" fn on_win_event(
        _hook: HWINEVENTHOOK,
        event: u32,
        hwnd: HWND,
        id_object: i32,
        id_child: i32,
        _event_thread: u32,
        _event_time: u32,
    ) {
        // Для LOCATIONCHANGE пропускаем внутренние элементы (курсор/скроллбар), оставляя только сами окна.
        if event == EVENT_OBJECT_LOCATIONCHANGE && (id_object != OBJID_WINDOW.0 || id_child != 0) {
            return;
        }
        if let Some(tx) = FOREGROUND_TX.get() {
            let payload = if event == EVENT_SYSTEM_FOREGROUND {
                hwnd.0 as isize
            } else {
                0
            };
            let _ = tx.try_send(payload);
        }
    }

    pub fn spawn<F>(state: Arc<DistractionState>, on_change: F) -> AppResult<()>
    where
        F: Fn(Option<ForegroundWindowInfo>) + Send + 'static,
    {
        let (tx, rx) = bounded::<isize>(64);
        FOREGROUND_TX.set(tx).map_err(|_| {
            AppError::InvalidArgument("foreground window monitor is already running".to_string())
        })?;

        thread::Builder::new()
            .name("focusglass-winevent-hook".to_string())
            .spawn(run_hook_loop)?;
        thread::Builder::new()
            .name("focusglass-foreground-worker".to_string())
            .spawn(move || run_worker(&rx, &state, &on_change))?;
        Ok(())
    }

    fn run_hook_loop() {
        let fg_hook = unsafe {
            SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND,
                EVENT_SYSTEM_FOREGROUND,
                None,
                Some(on_win_event),
                0,
                0,
                WINEVENT_OUTOFCONTEXT,
            )
        };
        let move_hook = unsafe {
            SetWinEventHook(
                EVENT_SYSTEM_MOVESIZESTART,
                EVENT_SYSTEM_MOVESIZEEND,
                None,
                Some(on_win_event),
                0,
                0,
                WINEVENT_OUTOFCONTEXT,
            )
        };
        let loc_hook = unsafe {
            SetWinEventHook(
                EVENT_OBJECT_LOCATIONCHANGE,
                EVENT_OBJECT_LOCATIONCHANGE,
                None,
                Some(on_win_event),
                0,
                0,
                WINEVENT_OUTOFCONTEXT,
            )
        };
        if fg_hook.is_invalid() && move_hook.is_invalid() && loc_hook.is_invalid() {
            eprintln!("[FocusGlass] SetWinEventHook failed; falling back to polling only");
            return;
        }

        let mut message = MSG::default();
        while unsafe { GetMessageW(&mut message, None, 0, 0) }.as_bool() {
            unsafe {
                let _ = TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
    }

    fn run_worker<F>(rx: &Receiver<isize>, state: &DistractionState, on_change: &F)
    where
        F: Fn(Option<ForegroundWindowInfo>),
    {
        let mut last_sent: Option<Option<ForegroundWindowInfo>> = None;
        let mut last_scan_at = Instant::now() - MOVE_COALESCE_INTERVAL;
        loop {
            let event_raw = match rx.recv_timeout(REFRESH_INTERVAL) {
                Ok(raw) => {
                    // Сливаем накопившиеся за пачку события перетаскивания в один скан.
                    let mut latest = raw;
                    while let Ok(next) = rx.try_recv() {
                        if next != 0 {
                            latest = next;
                        }
                    }
                    // Если перетаскивание шлёт 120 Гц LOCATIONCHANGE — ограничиваем до ~30 Гц.
                    if latest == 0 {
                        let since = last_scan_at.elapsed();
                        if since < MOVE_COALESCE_INTERVAL {
                            thread::sleep(MOVE_COALESCE_INTERVAL - since);
                            while let Ok(next) = rx.try_recv() {
                                if next != 0 {
                                    latest = next;
                                }
                            }
                        }
                    }
                    Some(latest)
                }
                Err(RecvTimeoutError::Timeout) => None,
                Err(RecvTimeoutError::Disconnected) => return,
            };

            let hwnd = match event_raw {
                Some(raw) if raw != 0 => HWND(raw as *mut core::ffi::c_void),
                _ => unsafe { GetForegroundWindow() },
            };
            last_scan_at = Instant::now();

            let Ok(config) = state.config() else { return };
            let current = if config.enabled {
                let visible = enumerate_visible_windows();
                let regions = compute_visible_distractor_regions(&visible, &config.patterns);
                let mut info = if !hwnd.is_invalid() {
                    inspect(hwnd, &config.patterns)
                } else {
                    None
                };
                match info.as_mut() {
                    Some(fg) => {
                        fg.distractor_regions = regions;
                    }
                    None if !regions.is_empty() => {
                        info = Some(ForegroundWindowInfo {
                            exe: String::new(),
                            title: String::new(),
                            is_distractor: false,
                            matched_pattern: None,
                            screen_rect: None,
                            overlay_rect: None,
                            distractor_regions: regions,
                        });
                    }
                    None => {}
                }
                info
            } else {
                None
            };

            if last_sent.as_ref() != Some(&current) {
                if state.replace_last(current.clone()).is_err() {
                    return;
                }
                on_change(current.clone());
                last_sent = Some(current);
            }
        }
    }

    struct EnumContext {
        self_pid: u32,
        windows: Vec<WindowSnapshot>,
    }

    unsafe extern "system" fn enum_windows_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        if lparam.0 == 0 {
            return BOOL(0);
        }
        let ctx = unsafe { &mut *(lparam.0 as *mut EnumContext) };

        if !unsafe { IsWindowVisible(hwnd) }.as_bool() || unsafe { IsIconic(hwnd) }.as_bool() {
            return BOOL(1);
        }
        if is_cloaked(hwnd) {
            return BOOL(1);
        }

        let ex_style = unsafe { GetWindowLongW(hwnd, GWL_EXSTYLE) } as u32;
        if (ex_style & WS_EX_TOOLWINDOW.0) != 0 {
            return BOOL(1);
        }

        let mut class_buf = [0u16; 128];
        let class_len = unsafe { GetClassNameW(hwnd, &mut class_buf) };
        let class_name =
            String::from_utf16_lossy(&class_buf[..usize::try_from(class_len).unwrap_or(0)]);
        if IGNORED_CLASSES.contains(&class_name.as_str()) {
            return BOOL(1);
        }

        let mut title_buf = [0u16; 512];
        let title_len = unsafe { GetWindowTextW(hwnd, &mut title_buf) };
        let title =
            String::from_utf16_lossy(&title_buf[..usize::try_from(title_len).unwrap_or(0)]);
        if title.trim().is_empty() {
            return BOOL(1);
        }

        let Some(rect) = window_rect(hwnd) else {
            return BOOL(1);
        };

        let mut pid = 0u32;
        let _ = unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        let exe = process_exe_name(pid).unwrap_or_default();

        ctx.windows.push(WindowSnapshot {
            exe,
            title,
            rect,
            is_self: pid == ctx.self_pid,
        });
        BOOL(1)
    }

    pub fn enumerate_visible_windows() -> Vec<WindowSnapshot> {
        let mut ctx = EnumContext {
            self_pid: std::process::id(),
            windows: Vec::with_capacity(32),
        };
        let ptr = (&raw mut ctx) as isize;
        let _ = unsafe { EnumWindows(Some(enum_windows_proc), LPARAM(ptr)) };
        ctx.windows
    }

    fn is_cloaked(hwnd: HWND) -> bool {
        let mut cloaked: u32 = 0;
        let res = unsafe {
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_CLOAKED,
                (&raw mut cloaked).cast(),
                u32::try_from(size_of::<u32>()).unwrap_or(4),
            )
        };
        res.is_ok() && cloaked != 0
    }

    fn inspect(hwnd: HWND, patterns: &[String]) -> Option<ForegroundWindowInfo> {
        let mut pid = 0u32;
        let thread_id = unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        if thread_id == 0 {
            return None;
        }

        let mut title_buf = [0u16; 512];
        let title_len = unsafe { GetWindowTextW(hwnd, &mut title_buf) };
        let title =
            String::from_utf16_lossy(&title_buf[..usize::try_from(title_len).unwrap_or(0)]);

        let exe = process_exe_name(pid).unwrap_or_default();
        let matched = if pid == std::process::id() {
            None
        } else {
            classify(&exe, &title, patterns)
        };

        Some(ForegroundWindowInfo {
            exe,
            title,
            is_distractor: matched.is_some(),
            matched_pattern: matched,
            screen_rect: window_rect(hwnd),
            overlay_rect: None,
            distractor_regions: Vec::new(),
        })
    }

    fn process_exe_name(pid: u32) -> Option<String> {
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
        let mut buf = [0u16; 1024];
        let mut len = u32::try_from(buf.len()).unwrap_or(u32::MAX);
        let result = unsafe {
            QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len)
        };
        let _ = unsafe { CloseHandle(handle) };
        result.ok()?;

        let path = String::from_utf16_lossy(&buf[..usize::try_from(len).ok()?]);
        Path::new(&path)
            .file_name()
            .map(|name| name.to_string_lossy().to_lowercase())
    }

    fn window_rect(hwnd: HWND) -> Option<PixelRect> {
        if unsafe { IsIconic(hwnd) }.as_bool() {
            return None;
        }

        let mut rect = RECT::default();
        let dwm = unsafe {
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                (&raw mut rect).cast(),
                u32::try_from(size_of::<RECT>()).unwrap_or(0),
            )
        };
        if dwm.is_err() {
            unsafe { GetWindowRect(hwnd, &mut rect) }.ok()?;
        }

        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        (width > 0 && height > 0).then(|| PixelRect {
            x: f64::from(rect.left),
            y: f64::from(rect.top),
            width: f64::from(width),
            height: f64::from(height),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn patterns(items: &[&str]) -> Vec<String> {
        normalize_patterns(items.iter().map(|s| (*s).to_string()).collect())
    }

    fn rect(x: f64, y: f64, width: f64, height: f64) -> PixelRect {
        PixelRect {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn matches_process_name_case_insensitively() {
        let list = patterns(&["Telegram", "discord"]);
        assert_eq!(
            classify("Telegram.exe", "Избранное", &list),
            Some("telegram".to_string())
        );
        assert_eq!(classify("code.exe", "main.rs — FocusGlass", &list), None);
    }

    #[test]
    fn matches_browser_tab_titles() {
        let list = patterns(&["youtube", "vk.com"]);
        assert_eq!(
            classify("chrome.exe", "Lo-fi beats - YouTube - Google Chrome", &list),
            Some("youtube".to_string())
        );
        assert_eq!(
            classify("firefox.exe", "Rust documentation — Mozilla Firefox", &list),
            None
        );
    }

    #[test]
    fn empty_pattern_list_matches_nothing() {
        assert_eq!(classify("telegram.exe", "Telegram", &[]), None);
        assert_eq!(classify("telegram.exe", "Telegram", &patterns(&["", "   "])), None);
    }

    #[test]
    fn normalization_trims_lowercases_dedups_and_limits() {
        assert_eq!(
            patterns(&["  Telegram ", "telegram", "", "DISCORD"]),
            vec!["telegram".to_string(), "discord".to_string()]
        );

        let many: Vec<String> = (0..200).map(|i| format!("app{i}")).collect();
        assert_eq!(normalize_patterns(many).len(), MAX_PATTERNS);

        let long = "x".repeat(500);
        assert_eq!(normalize_patterns(vec![long])[0].chars().count(), MAX_PATTERN_CHARS);
    }

    #[test]
    fn state_normalizes_config_and_reports_platform_support() {
        let state = DistractionState::default();
        let status = state
            .set_config(DistractionConfig {
                enabled: true,
                patterns: vec![" Steam ".to_string(), "steam".to_string()],
            })
            .expect("set config");
        assert!(status.enabled);
        assert_eq!(status.patterns, vec!["steam".to_string()]);
        assert_eq!(status.supported, cfg!(windows));
        assert_eq!(state.config().expect("config").patterns, vec!["steam".to_string()]);
        assert!(state.last().expect("last").is_none());
    }

    #[test]
    fn z_order_occlusion_never_covers_higher_work_window_but_blurs_split_screen_distractors() {
        let list = patterns(&["telegram", "youtube"]);

        // Scenario 1: Maximized IDE on top hides Telegram behind it -> 0 distractor regions
        let hidden = vec![
            WindowSnapshot {
                exe: "code.exe".to_string(),
                title: "main.rs - VS Code".to_string(),
                rect: rect(0.0, 0.0, 1920.0, 1080.0),
                is_self: false,
            },
            WindowSnapshot {
                exe: "telegram.exe".to_string(),
                title: "Telegram".to_string(),
                rect: rect(100.0, 100.0, 800.0, 600.0),
                is_self: false,
            },
        ];
        assert!(compute_visible_distractor_regions(&hidden, &list).is_empty());

        // Scenario 2: Split-screen IDE (left) + Telegram (right) -> ONLY Telegram is returned
        let split = vec![
            WindowSnapshot {
                exe: "focusglass.exe".to_string(),
                title: "FocusGlass Overlay".to_string(),
                rect: rect(0.0, 0.0, 1920.0, 1080.0),
                is_self: true,
            },
            WindowSnapshot {
                exe: "code.exe".to_string(),
                title: "main.rs - VS Code".to_string(),
                rect: rect(0.0, 0.0, 960.0, 1080.0),
                is_self: false,
            },
            WindowSnapshot {
                exe: "telegram.exe".to_string(),
                title: "Telegram".to_string(),
                rect: rect(960.0, 0.0, 960.0, 1080.0),
                is_self: false,
            },
        ];
        let regions = compute_visible_distractor_regions(&split, &list);
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].matched_pattern, "telegram");
        assert_eq!(regions[0].screen_rect, rect(960.0, 0.0, 960.0, 1080.0));

        // Scenario 3: Partial overlap by IDE on left half of a centered YouTube window
        let partial = vec![
            WindowSnapshot {
                exe: "code.exe".to_string(),
                title: "VS Code".to_string(),
                rect: rect(0.0, 0.0, 800.0, 1080.0),
                is_self: false,
            },
            WindowSnapshot {
                exe: "chrome.exe".to_string(),
                title: "Music - YouTube - Google Chrome".to_string(),
                rect: rect(400.0, 100.0, 1000.0, 700.0),
                is_self: false,
            },
        ];
        let partial_regions = compute_visible_distractor_regions(&partial, &list);
        assert_eq!(partial_regions.len(), 1);
        assert_eq!(partial_regions[0].screen_rect, rect(800.0, 100.0, 600.0, 700.0));
    }

    #[test]
    fn suggests_smart_tab_patterns_for_browsers_and_exe_stem_for_apps() {
        assert_eq!(
            suggest_pattern("chrome.exe", "Lo-fi beats - YouTube - Google Chrome"),
            ("youtube".to_string(), true)
        );
        assert_eq!(
            suggest_pattern("telegram.exe", "Избранное"),
            ("telegram".to_string(), false)
        );
        assert_eq!(
            suggest_pattern("msedge.exe", "Новости — ВКонтакте — Microsoft Edge"),
            ("вконтакте".to_string(), true)
        );
    }
}
