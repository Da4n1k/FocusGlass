//! Умная блокировка отвлекающих приложений.
//!
//! На Windows отслеживает активное окно через `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)`
//! и сообщает оверлею его границы и признак «отвлекатель» (по списку шаблонов,
//! сравниваемых с именем процесса и заголовком окна). Оверлей затемняет только
//! прямоугольник такого окна. На других ОС монитор не запускается.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::overlay::PixelRect;

pub const EVENT_FOREGROUND_WINDOW: &str = "foreground-window";

const MAX_PATTERNS: usize = 64;
const MAX_PATTERN_CHARS: usize = 64;

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

/// Сведения об активном окне для фронтенда.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForegroundWindowInfo {
    /// Имя исполняемого файла в нижнем регистре, например `telegram.exe`.
    pub exe: String,
    pub title: String,
    pub is_distractor: bool,
    pub matched_pattern: Option<String>,
    /// Границы окна в физических пикселях экрана; `None` для свёрнутого окна.
    pub screen_rect: Option<PixelRect>,
    /// Те же границы относительно окна оверлея (заполняется перед отправкой).
    pub overlay_rect: Option<PixelRect>,
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
///
/// Шаблоны ожидаются нормализованными (`normalize_patterns`). Сравнение — по
/// вхождению подстроки без учёта регистра: `telegram` совпадёт и с `telegram.exe`,
/// и с вкладкой браузера «Telegram Web — Mozilla Firefox».
pub fn classify(exe: &str, title: &str, patterns: &[String]) -> Option<String> {
    let exe = exe.to_lowercase();
    let title = title.to_lowercase();
    patterns
        .iter()
        .find(|p| !p.is_empty() && (exe.contains(p.as_str()) || title.contains(p.as_str())))
        .cloned()
}

/// Запускает отслеживание активного окна. `on_change` вызывается при каждой смене
/// состояния; `None` означает «затемнять нечего» (монитор выключен).
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
    use std::time::Duration;

    use crossbeam_channel::{Receiver, RecvTimeoutError, Sender, bounded};
    use windows::Win32::Foundation::{CloseHandle, HWND, RECT};
    use windows::Win32::Graphics::Dwm::{DWMWA_EXTENDED_FRAME_BOUNDS, DwmGetWindowAttribute};
    use windows::Win32::System::Threading::{
        OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
        QueryFullProcessImageNameW,
    };
    use windows::Win32::UI::Accessibility::{HWINEVENTHOOK, SetWinEventHook};
    use windows::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, EVENT_SYSTEM_FOREGROUND, GetForegroundWindow, GetMessageW,
        GetWindowRect, GetWindowTextW, GetWindowThreadProcessId, IsIconic, MSG,
        TranslateMessage, WINEVENT_OUTOFCONTEXT,
    };
    use windows::core::PWSTR;

    use super::{DistractionState, ForegroundWindowInfo, classify};
    use crate::error::{AppError, AppResult};
    use crate::overlay::PixelRect;

    /// Как часто перепроверять границы активного окна (перемещение/ресайз), мс.
    const REFRESH_INTERVAL: Duration = Duration::from_millis(200);

    /// Канал «хук -> рабочий поток». WinEvent-колбэк не принимает пользовательских
    /// данных, поэтому отправитель лежит в статике.
    static FOREGROUND_TX: OnceLock<Sender<isize>> = OnceLock::new();

    unsafe extern "system" fn on_foreground_event(
        _hook: HWINEVENTHOOK,
        _event: u32,
        hwnd: HWND,
        _id_object: i32,
        _id_child: i32,
        _event_thread: u32,
        _event_time: u32,
    ) {
        if let Some(tx) = FOREGROUND_TX.get() {
            // Переполненный канал не страшен: рабочий поток всё равно опрашивает окно.
            let _ = tx.try_send(hwnd.0 as isize);
        }
    }

    pub fn spawn<F>(state: Arc<DistractionState>, on_change: F) -> AppResult<()>
    where
        F: Fn(Option<ForegroundWindowInfo>) + Send + 'static,
    {
        let (tx, rx) = bounded::<isize>(32);
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

    /// Поток с очередью сообщений: `WINEVENT_OUTOFCONTEXT` доставляет события только
    /// в поток, который вызвал `SetWinEventHook` и качает сообщения.
    fn run_hook_loop() {
        // SAFETY: колбэк — `extern "system"` функция со статическим временем жизни;
        // хук живёт до завершения процесса вместе с этим потоком.
        let hook = unsafe {
            SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND,
                EVENT_SYSTEM_FOREGROUND,
                None,
                Some(on_foreground_event),
                0,
                0,
                WINEVENT_OUTOFCONTEXT,
            )
        };
        if hook.is_invalid() {
            eprintln!("[FocusGlass] SetWinEventHook failed; falling back to polling only");
            return;
        }

        let mut message = MSG::default();
        // SAFETY: `message` — валидная структура на стеке этого потока.
        while unsafe { GetMessageW(&mut message, None, 0, 0) }.as_bool() {
            // SAFETY: сообщение получено из очереди этого же потока.
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
        loop {
            let hwnd = match rx.recv_timeout(REFRESH_INTERVAL) {
                Ok(raw) => HWND(raw as *mut core::ffi::c_void),
                // SAFETY: функция без параметров, возвращает дескриптор или null.
                Err(RecvTimeoutError::Timeout) => unsafe { GetForegroundWindow() },
                Err(RecvTimeoutError::Disconnected) => return,
            };

            let Ok(config) = state.config() else { return };
            let current = if config.enabled && !hwnd.is_invalid() {
                inspect(hwnd, &config.patterns)
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

    fn inspect(hwnd: HWND, patterns: &[String]) -> Option<ForegroundWindowInfo> {
        let mut pid = 0u32;
        // SAFETY: `pid` — валидный указатель на время вызова.
        let thread_id = unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        if thread_id == 0 {
            return None;
        }

        let mut title_buf = [0u16; 512];
        // SAFETY: буфер передаётся срезом, длина контролируется обёрткой.
        let title_len = unsafe { GetWindowTextW(hwnd, &mut title_buf) };
        let title = String::from_utf16_lossy(&title_buf[..usize::try_from(title_len).unwrap_or(0)]);

        let exe = process_exe_name(pid).unwrap_or_default();
        // Собственные окна FocusGlass никогда не считаются отвлекателями.
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
        })
    }

    fn process_exe_name(pid: u32) -> Option<String> {
        // SAFETY: запрашиваем минимальные права; дескриптор закрываем ниже.
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
        let mut buf = [0u16; 1024];
        let mut len = u32::try_from(buf.len()).unwrap_or(u32::MAX);
        // SAFETY: `buf` и `len` валидны; `len` обновляется фактической длиной пути.
        let result = unsafe {
            QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len)
        };
        // SAFETY: дескриптор получен из OpenProcess выше и больше не используется.
        let _ = unsafe { CloseHandle(handle) };
        result.ok()?;

        let path = String::from_utf16_lossy(&buf[..usize::try_from(len).ok()?]);
        Path::new(&path)
            .file_name()
            .map(|name| name.to_string_lossy().to_lowercase())
    }

    fn window_rect(hwnd: HWND) -> Option<PixelRect> {
        // SAFETY: проверка состояния окна по дескриптору, без указателей.
        if unsafe { IsIconic(hwnd) }.as_bool() {
            return None;
        }

        let mut rect = RECT::default();
        // Видимые границы без невидимой рамки ресайза; иначе затемнение «вылезает».
        // SAFETY: передаём указатель на RECT и его точный размер.
        let dwm = unsafe {
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                (&raw mut rect).cast(),
                u32::try_from(size_of::<RECT>()).unwrap_or(0),
            )
        };
        if dwm.is_err() {
            // SAFETY: `rect` — валидная структура на стеке.
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
}
