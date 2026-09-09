// Prevents a console window opening alongside the app on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;

use tauri::{Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::{CommandEvent, CommandChild};
use tauri_plugin_shell::ShellExt;

/// The bundled server process, kept so it can be stopped when the app exits.
///
/// The application is a Node server — every route is server-rendered and it
/// uses native modules — so the desktop app runs that same server on a
/// loopback port rather than reimplementing it as a static frontend. This
/// shell's whole job is: start it, wait for it, show it, stop it.
struct Sidecar(Mutex<Option<CommandChild>>);

fn main() {
    tauri::Builder::default()
        // A second launch focuses the existing window instead of starting a
        // second server against the same database.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Sidecar(Mutex::new(None)))
        .setup(|app| {
            // The window appears immediately showing a splash, so launching
            // feels like a native application rather than a wait on localhost.
            WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::App("index.html".into()),
            )
            .title("Website Generator")
            .inner_size(1180.0, 820.0)
            .min_inner_size(360.0, 560.0)
            .resizable(true)
            .center()
            .build()?;

            let resources = app
                .path()
                .resource_dir()
                .map_err(|e| format!("resource directory unavailable: {e}"))?;
            // User data lives in the OS profile (%APPDATA% on Windows), never
            // beside the executable in Program Files.
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("data directory unavailable: {e}"))?;
            std::fs::create_dir_all(&data_dir).ok();

            let script = resources.join("sidecar").join("launch.mjs");

            // The sidecar binary is the Node runtime shipped with the app, so
            // the user never installs Node themselves.
            let (mut rx, child) = app
                .shell()
                .sidecar("wg-node")?
                .args([
                    script.to_string_lossy().as_ref(),
                    "--resources",
                    resources.to_string_lossy().as_ref(),
                    "--data-dir",
                    data_dir.to_string_lossy().as_ref(),
                ])
                .spawn()?;

            app.state::<Sidecar>().0.lock().unwrap().replace(child);

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            let text = String::from_utf8_lossy(&line).trim().to_string();
                            if let Some(url) = text.strip_prefix("WG_READY ") {
                                if let Some(w) = handle.get_webview_window("main") {
                                    // Navigate the existing window to the local
                                    // server: one webview, no second process.
                                    if let Ok(parsed) = url.trim().parse() {
                                        let _ = w.navigate(parsed);
                                    }
                                }
                            } else if let Some(reason) = text.strip_prefix("WG_FAILED ") {
                                if let Some(w) = handle.get_webview_window("main") {
                                    let _ = w.emit("wg://failed", reason.to_string());
                                }
                            }
                        }
                        CommandEvent::Stderr(line) => {
                            // The server's own logging; useful when diagnosing
                            // an installation, noise otherwise.
                            eprintln!("{}", String::from_utf8_lossy(&line).trim_end());
                        }
                        CommandEvent::Error(err) => {
                            if let Some(w) = handle.get_webview_window("main") {
                                let _ = w.emit("wg://failed", err);
                            }
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to start Website Generator")
        .run(|app, event| {
            // Never leave the server running after the window closes.
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                if let Some(child) = app.state::<Sidecar>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}
