// Prevents a console window opening alongside the app on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;

use serde_json::Value;
use tauri::{Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// The two child processes this shell owns, and the events waiting for a
/// window to display them.
///
/// The application is a Node server — every route is server-rendered and it
/// uses native modules — so the desktop app runs that same server on a
/// loopback port rather than reimplementing it as a static frontend. The shell
/// itself does four things: set the machine up on first launch, start the
/// server, show it, and stop everything on the way out.
#[derive(Default)]
struct Shell {
    /// The bundled application server. Killed when the app exits.
    server: Mutex<Option<CommandChild>>,
    /// First-launch setup. Answers to its questions are written to its stdin.
    setup: Mutex<Option<CommandChild>>,
    /// Setup starts before the webview finishes loading, so its first events
    /// are held here rather than lost — otherwise a fast machine would show a
    /// setup screen with the first steps missing.
    queued: Mutex<Vec<Value>>,
    ready: Mutex<bool>,
}

/// Send an event to the setup screen, or hold it until that screen is ready.
fn emit_setup(app: &tauri::AppHandle, payload: Value) {
    let shell = app.state::<Shell>();
    let ready = *shell.ready.lock().unwrap();
    if ready {
        let _ = app.emit("wg://setup", payload);
    } else {
        shell.queued.lock().unwrap().push(payload);
    }
}

/// The setup screen is listening: flush anything that happened before it was.
#[tauri::command]
fn setup_ready(app: tauri::AppHandle) {
    let shell = app.state::<Shell>();
    *shell.ready.lock().unwrap() = true;
    let queued: Vec<Value> = shell.queued.lock().unwrap().drain(..).collect();
    for event in queued {
        let _ = app.emit("wg://setup", event);
    }
}

/// An answer to a setup question — which model to install, or whether to retry.
#[tauri::command]
fn setup_answer(app: tauri::AppHandle, line: String) {
    let shell = app.state::<Shell>();
    let mut guard = shell.setup.lock().unwrap();
    if let Some(child) = guard.as_mut() {
        let _ = child.write(format!("{line}\n").as_bytes());
    }
}

/// Boot the bundled server and point the window at it.
///
/// Runs only after setup reports it is finished, so the server starts with the
/// model and design system already in place.
fn start_server(app: &tauri::AppHandle, resources: &std::path::Path, data_dir: &std::path::Path) {
    let script = resources.join("sidecar").join("launch.mjs");
    let spawned = app
        .shell()
        .sidecar("wg-node")
        .and_then(|cmd| {
            cmd.args([
                script.to_string_lossy().as_ref(),
                "--resources",
                resources.to_string_lossy().as_ref(),
                "--data-dir",
                data_dir.to_string_lossy().as_ref(),
            ])
            .spawn()
        });

    let (mut rx, child) = match spawned {
        Ok(pair) => pair,
        Err(err) => {
            let _ = app.emit("wg://failed", format!("The application service could not start: {err}"));
            return;
        }
    };
    app.state::<Shell>().server.lock().unwrap().replace(child);

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line).trim().to_string();
                    if let Some(url) = text.strip_prefix("WG_READY ") {
                        if let Some(w) = handle.get_webview_window("main") {
                            // Navigate the existing window to the local server:
                            // one webview, no second process.
                            if let Ok(parsed) = url.trim().parse() {
                                let _ = w.navigate(parsed);
                            }
                        }
                    } else if let Some(reason) = text.strip_prefix("WG_FAILED ") {
                        let _ = handle.emit("wg://failed", reason.to_string());
                    }
                }
                CommandEvent::Stderr(line) => {
                    // The server's own logging; useful when diagnosing an
                    // installation, noise otherwise.
                    eprintln!("{}", String::from_utf8_lossy(&line).trim_end());
                }
                CommandEvent::Error(err) => {
                    let _ = handle.emit("wg://failed", err);
                }
                _ => {}
            }
        }
    });
}

/// Run first-launch setup, then start the server.
///
/// The setup process decides for itself whether there is anything to do; on
/// every launch after the first it answers "already initialised" in a few
/// milliseconds and this goes straight on to starting the server.
fn start_setup(app: &tauri::AppHandle, resources: std::path::PathBuf, data_dir: std::path::PathBuf) {
    let script = resources.join("bootstrap").join("run.mjs");
    let spawned = app
        .shell()
        .sidecar("wg-node")
        .and_then(|cmd| {
            cmd.args([
                script.to_string_lossy().as_ref(),
                "--data-dir",
                data_dir.to_string_lossy().as_ref(),
                "--resources",
                resources.to_string_lossy().as_ref(),
            ])
            .spawn()
        });

    let (mut rx, child) = match spawned {
        Ok(pair) => pair,
        Err(err) => {
            let _ = app.emit("wg://failed", format!("Setup could not start: {err}"));
            return;
        }
    };
    app.state::<Shell>().setup.lock().unwrap().replace(child);

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut finished = false;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line);
                    for line in text.lines() {
                        if line.trim().is_empty() {
                            continue;
                        }
                        if let Ok(value) = serde_json::from_str::<Value>(line) {
                            let done = value.get("t").and_then(Value::as_str) == Some("done");
                            emit_setup(&handle, value);
                            if done && !finished {
                                finished = true;
                                start_server(&handle, &resources, &data_dir);
                            }
                        }
                    }
                }
                CommandEvent::Stderr(line) => {
                    eprintln!("[setup] {}", String::from_utf8_lossy(&line).trim_end());
                }
                CommandEvent::Terminated(status) => {
                    // Setup exiting without a "done" is a failure the user has
                    // to see, rather than a window that waits forever.
                    if !finished {
                        let _ = handle.emit(
                            "wg://failed",
                            format!(
                                "Setup stopped before it finished (code {}).",
                                status.code.unwrap_or(-1)
                            ),
                        );
                    }
                    handle.state::<Shell>().setup.lock().unwrap().take();
                }
                _ => {}
            }
        }
    });
}

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
        .manage(Shell::default())
        .invoke_handler(tauri::generate_handler![setup_ready, setup_answer])
        .setup(|app| {
            // The window appears immediately, showing setup or a splash, so
            // launching feels like a native application rather than a wait.
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Website Generator")
                .inner_size(1280.0, 860.0)
                .min_inner_size(880.0, 620.0)
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

            start_setup(&app.handle().clone(), resources, data_dir);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to start Website Generator")
        .run(|app, event| {
            // Never leave a child process running after the window closes.
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                let shell: tauri::State<Shell> = app.state();
                let server = shell.server.lock().unwrap().take();
                let setup = shell.setup.lock().unwrap().take();
                if let Some(child) = server {
                    let _ = child.kill();
                }
                if let Some(child) = setup {
                    let _ = child.kill();
                }
            }
        });
}
