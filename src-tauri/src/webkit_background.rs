//! Keep the dashboard's EEG/IPC timers running when hidden on Linux.
//! Tauri's background_throttling option is not implemented on Linux. Configure
//! documented WebKitFeature settings on this WebView only; no global env hacks,
//! silent audio, disabled watchdogs or changes to overlay WebViews.

use std::ffi::{CStr, c_char, c_int, c_uint, c_void};

use gtk::glib::object::ObjectType;
use libloading::Library;
use webkit2gtk::WebViewExt;

use crate::error::{AppError, AppResult};

const FEATURES: &[&str] = &[
    "DOMTimersThrottling",
    "HiddenPageDOMTimerThrottling",
    "HiddenPageDOMTimerThrottlingAutoIncreases",
    "PageVisibilityBasedProcessSuppression",
];

pub fn keep_processing(view: &webkit2gtk::WebView) -> AppResult<Vec<String>> {
    let settings = view
        .settings()
        .ok_or_else(|| failure("WebView settings unavailable"))?;
    // SAFETY: called by with_webview (or the GTK test loop) on the owning GTK
    // thread. The settings GObject stays alive throughout the synchronous call.
    unsafe { configure(settings.as_ptr().cast()) }
}

fn failure(message: impl std::fmt::Display) -> AppError {
    AppError::BackgroundProcessing(message.to_string())
}

unsafe fn configure(settings: *mut c_void) -> AppResult<Vec<String>> {
    type GetAll = unsafe extern "C" fn() -> *mut c_void;
    type Length = unsafe extern "C" fn(*mut c_void) -> c_uint;
    type Get = unsafe extern "C" fn(*mut c_void, c_uint) -> *mut c_void;
    type Id = unsafe extern "C" fn(*mut c_void) -> *const c_char;
    type Set = unsafe extern "C" fn(*mut c_void, *mut c_void, c_int);
    type Enabled = unsafe extern "C" fn(*mut c_void, *mut c_void) -> c_int;
    type Unref = unsafe extern "C" fn(*mut c_void);

    // Resolve at runtime: older WebKit installations must fail explicitly here,
    // not fail to load the entire application due to a missing new API symbol.
    // SAFETY: these are the public WebKitGTK 4.1 C ABI signatures.
    unsafe {
        let library = Library::new("libwebkit2gtk-4.1.so.0").map_err(failure)?;
        let all = library
            .get::<GetAll>(b"webkit_settings_get_all_features\0")
            .map_err(failure)?;
        let length = library
            .get::<Length>(b"webkit_feature_list_get_length\0")
            .map_err(failure)?;
        let get = library
            .get::<Get>(b"webkit_feature_list_get\0")
            .map_err(failure)?;
        let id = library
            .get::<Id>(b"webkit_feature_get_identifier\0")
            .map_err(failure)?;
        let set = library
            .get::<Set>(b"webkit_settings_set_feature_enabled\0")
            .map_err(failure)?;
        let enabled = library
            .get::<Enabled>(b"webkit_settings_get_feature_enabled\0")
            .map_err(failure)?;
        let unref = library
            .get::<Unref>(b"webkit_feature_list_unref\0")
            .map_err(failure)?;
        let features = all();
        if features.is_null() {
            return Err(failure("WebKit feature list unavailable"));
        }
        let mut disabled = Vec::new();
        let mut rejected = Vec::new();
        for index in 0..length(features) {
            let feature = get(features, index);
            if feature.is_null() {
                continue;
            }
            let identifier = id(feature);
            if identifier.is_null() {
                continue;
            }
            let identifier = CStr::from_ptr(identifier).to_string_lossy();
            if FEATURES.contains(&identifier.as_ref()) {
                set(settings, feature, 0);
                if enabled(settings, feature) == 0 {
                    disabled.push(identifier.into_owned());
                } else {
                    rejected.push(identifier.into_owned());
                }
            }
        }
        unref(features);
        for required in [
            "HiddenPageDOMTimerThrottling",
            "PageVisibilityBasedProcessSuppression",
        ] {
            if !disabled.iter().any(|id| id == required) {
                rejected.push(required.into());
            }
        }
        if !rejected.is_empty() {
            return Err(failure(format!(
                "WebKit cannot disable: {}",
                rejected.join(", ")
            )));
        }
        Ok(disabled)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gtk::prelude::*;
    use std::cell::RefCell;
    use std::process::Command;
    use std::rc::Rc;
    use std::thread;
    use std::time::{Duration, Instant};
    use webkit2gtk::{UserContentManager, UserContentManagerExt};

    #[test]
    #[ignore = "real GTK/WebKit window; run only in an isolated compositor session"]
    fn timers_and_blur_survive_minimize_and_hide() -> AppResult<()> {
        gtk::init().map_err(failure)?;
        let manager = UserContentManager::new();
        let view = webkit2gtk::WebView::builder()
            .user_content_manager(&manager)
            .build();
        if std::env::var("FOCUSGLASS_TEST_WEBKIT_BASELINE").as_deref() != Ok("1") {
            eprintln!(
                "Background features disabled: {:?}",
                keep_processing(&view)?
            );
        }
        let blur = Rc::new(crate::linux_blur::LinuxBlur::start());
        let samples = Rc::new(RefCell::new(Vec::<(Instant, bool)>::new()));
        for (name, hidden) in [("visibleTick", false), ("hiddenTick", true)] {
            let samples = Rc::clone(&samples);
            let blur = Rc::clone(&blur);
            assert!(manager.register_script_message_handler(name));
            manager.connect_script_message_received(Some(name), move |_, _| {
                samples.borrow_mut().push((Instant::now(), hidden));
                blur.update_frame(0.95, 16.0, false)
                    .expect("live IPC target");
            });
        }
        let window = gtk::Window::new(gtk::WindowType::Toplevel);
        window.set_title("FocusGlass background timer fixture");
        window.set_default_size(320, 240);
        window.add(&view);
        window.show_all();
        view.load_html(
            r#"<html><body>FocusGlass timer fixture<script>
            setInterval(() => window.webkit.messageHandlers[
                document.hidden ? 'hiddenTick' : 'visibleTick'].postMessage(1),16);
            </script></body></html>"#,
            Some("about:blank"),
        );
        fn pump(duration: Duration) {
            let deadline = Instant::now() + duration;
            while Instant::now() < deadline {
                while gtk::events_pending() {
                    gtk::main_iteration_do(false);
                }
                thread::sleep(Duration::from_millis(3));
            }
        }
        let started = Instant::now();
        while samples.borrow().len() < 10 && started.elapsed() < Duration::from_secs(8) {
            pump(Duration::from_millis(20));
        }
        assert!(blur.status()?.available, "{}", blur.status()?.message);
        assert!(samples.borrow().len() >= 10, "WebKit script never started");
        let mut report = Vec::new();
        let test_result = (|| -> AppResult<()> {
            for phase in ["minimized", "hidden"] {
                let start = samples.borrow().len();
                if phase == "minimized" {
                    window.iconify();
                    if blur.status()?.backend == "kwin-gpu" {
                        // GTK's iconify request can be ignored without an activation
                        // token. In this private test session use the WM's own
                        // minimize property, targeting only this test process.
                        use std::io::Write;
                        let mut script = tempfile::NamedTempFile::new()?;
                        write!(
                            script,
                            "workspace.windowList().forEach(w => {{ if (w.pid === {}) w.minimized = true; }});",
                            std::process::id()
                        )?;
                        let name = format!("focusglass-minimize-test-{}", std::process::id());
                        let loaded = Command::new("qdbus6")
                            .args([
                                "org.kde.KWin",
                                "/Scripting",
                                "org.kde.kwin.Scripting.loadScript",
                            ])
                            .arg(script.path())
                            .arg(&name)
                            .output()?;
                        assert!(
                            loaded.status.success(),
                            "{}",
                            String::from_utf8_lossy(&loaded.stderr)
                        );
                        let id = String::from_utf8_lossy(&loaded.stdout).trim().to_string();
                        assert!(
                            Command::new("qdbus6")
                                .args([
                                    "org.kde.KWin",
                                    &format!("/Scripting/Script{id}"),
                                    "org.kde.kwin.Script.run"
                                ])
                                .status()?
                                .success()
                        );
                        let _ = Command::new("qdbus6")
                            .args([
                                "org.kde.KWin",
                                "/Scripting",
                                "org.kde.kwin.Scripting.unloadScript",
                                &name,
                            ])
                            .status()?;
                    }
                } else {
                    window.hide();
                }
                pump(Duration::from_secs(5));
                let samples = samples.borrow();
                let ticks = &samples[start..];
                let hidden_count = ticks.iter().filter(|(_, hidden)| *hidden).count();
                let longest_gap = ticks
                    .windows(2)
                    .map(|w| w[1].0.duration_since(w[0].0))
                    .max()
                    .unwrap_or(Duration::from_secs(5));
                eprintln!(
                    "{phase}: ticks={}, hidden ticks={hidden_count}, max gap={longest_gap:?}, blur active={}",
                    ticks.len(),
                    blur.status()?.active
                );
                assert!(ticks.len() > 50, "{phase}: engine timers throttled");
                if phase == "hidden" {
                    assert!(
                        hidden_count > 50,
                        "hidden view was never genuinely backgrounded"
                    );
                }
                if blur.status()?.backend == "kwin-gpu" {
                    assert_eq!(
                        blur.status()?.protected_windows,
                        0,
                        "{phase}: hidden controls left a sharp hole"
                    );
                    if std::env::var_os("FOCUSGLASS_EFFECT_TEST_PROBE").is_some() {
                        use std::io::{BufRead, BufReader, Write};
                        let mut socket = std::os::unix::net::UnixStream::connect(
                            std::env::var("FOCUSGLASS_EFFECT_SOCKET").expect("isolated socket"),
                        )?;
                        socket.set_read_timeout(Some(Duration::from_secs(2)))?;
                        socket.write_all(b"{\"op\":\"status\"}\n")?;
                        let mut line = String::new();
                        BufReader::new(socket).read_line(&mut line)?;
                        let native: serde_json::Value =
                            serde_json::from_str(&line).map_err(failure)?;
                        assert_eq!(
                            native["diagnostics"]["protectedSamples"], 0,
                            "{phase}: shader still excluded pixels after minimize/hide: {native}"
                        );
                        assert!(
                            native["diagnostics"]["unprotectedChanged"]
                                .as_u64()
                                .is_some_and(|n| n > 100),
                            "{phase}: no actual background blur pixels changed: {native}"
                        );
                        eprintln!(
                            "{phase}: GPU masks empty, background pixels changed={}",
                            native["diagnostics"]["unprotectedChanged"]
                        );
                    }
                }
                assert!(
                    longest_gap < Duration::from_millis(500),
                    "{phase}: {longest_gap:?}"
                );
                assert!(
                    blur.status()?.active,
                    "{phase}: background IPC lost, blur cleared"
                );
                report.push(serde_json::json!({
                    "phase":phase,"ticks":ticks.len(),"hiddenTicks":hidden_count,
                    "maxGapMs":longest_gap.as_secs_f64()*1000.0,
                    "blurActive":blur.status()?.active,"protectedWindows":blur.status()?.protected_windows,
                }));
            }
            window.show_all();
            window.deiconify();
            pump(Duration::from_millis(300));
            assert!(blur.status()?.active, "restore interrupted feedback");
            if let Some(path) = std::env::var_os("FOCUSGLASS_WEBKIT_EVIDENCE") {
                std::fs::write(
                    path,
                    serde_json::to_vec_pretty(&serde_json::json!({
                        "phases":report,"restoredWithoutInterruption":true,
                    }))
                    .map_err(failure)?,
                )?;
            }
            Ok(())
        })();
        window.close();
        blur.stop()?;
        test_result
    }
}
