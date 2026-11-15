use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    let is_windows_target = env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows");

    if is_windows_target {
        if let Ok(manifest_dir) = env::var("CARGO_MANIFEST_DIR") {
            let manifest_path = PathBuf::from(&manifest_dir);
            let dll_src = manifest_path.join("vendor").join("neurosdk2-x64.dll");
            if !dll_src.is_file() && cfg!(windows) {
                let fetch_script = manifest_path
                    .parent()
                    .map(|root| root.join("scripts").join("fetch-neurosdk2.ps1"));
                if let Some(script) = fetch_script.filter(|p| p.is_file()) {
                    let _ = Command::new("powershell")
                        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
                        .arg(&script)
                        .status();
                }
            }
        }
    }

    tauri_build::build();

    if is_windows_target {
        println!("cargo:rerun-if-changed=vendor/neurosdk2-x64.dll");
        if let (Ok(manifest_dir), Ok(out_dir)) =
            (env::var("CARGO_MANIFEST_DIR"), env::var("OUT_DIR"))
        {
            let dll_src = PathBuf::from(manifest_dir)
                .join("vendor")
                .join("neurosdk2-x64.dll");
            if dll_src.is_file() {
                if let Some(target_profile_dir) = PathBuf::from(out_dir).ancestors().nth(3) {
                    let dll_dst = target_profile_dir.join("neurosdk2-x64.dll");
                    let _ = fs::copy(&dll_src, &dll_dst);
                }
            }
        }
    }
}
