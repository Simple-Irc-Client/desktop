mod irc;

use irc::commands::{irc_connect, irc_disconnect, irc_quit, irc_send};
use irc::state::IrcState;
use tauri::Manager;

/// CI smoke test mode. Drives the runner at scripts/smoke-test.js: the runner
/// spawns this binary with SMOKE_TEST=1 and decides pass/fail purely from
/// line-based sentinels on stdout/stderr.
fn is_smoke_test() -> bool {
    std::env::var("SMOKE_TEST").as_deref() == Ok("1")
}

fn install_smoke_test_panic_hook() {
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        eprintln!("SMOKE_TEST_ERROR panic: {info}");
        prev(info);
        std::process::exit(1);
    }));
}

// TEMPORARY — best-effort macOS repro harness for the DropdownMenuSub
// "closes right after opening" bug (see the submenu-guard breadcrumbs in
// core's dropdown-menu.tsx and the Sentry diagnostics they feed). Drives the
// runner at scripts/ui-probe-submenu-test.js: spawned with UI_PROBE_TEST=1,
// this prints the window's real on-screen position so the runner can move
// the actual OS pointer (not synthetic DOM events, which would bypass the
// suspected WKWebView pointer-event-delivery quirk entirely) over the probe
// page's submenu trigger and watch whether it stays open. Remove this,
// get_ui_probe_mode, ui_probe_log, core's src/UiProbeSubmenuPage.tsx and its
// wiring in index.tsx, and the CI workflow once the bug is diagnosed or
// ruled out on real hardware.
fn is_ui_probe_test() -> bool {
    std::env::var("UI_PROBE_TEST").as_deref() == Ok("1")
}

/// Tells the renderer (core's src/index.tsx) whether to mount the probe page
/// instead of the normal app.
#[tauri::command]
fn get_ui_probe_mode() -> bool {
    is_ui_probe_test()
}

/// The probe page's only channel back to the CI runner: Tauri commands run
/// in this process, so printing to its real stdout reaches the runner the
/// same way the smoke test's sentinels do.
#[tauri::command]
fn ui_probe_log(msg: String) {
    println!("UI_PROBE_EVENT: {msg}");
    let _ = std::io::Write::flush(&mut std::io::stdout());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let smoke = is_smoke_test();
    let ui_probe = is_ui_probe_test();
    if smoke {
        install_smoke_test_panic_hook();
    }

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(IrcState::new())
        .invoke_handler(tauri::generate_handler![
            irc_connect,
            irc_send,
            irc_quit,
            irc_disconnect,
            get_ui_probe_mode,
            ui_probe_log,
        ]);

    if smoke {
        builder = builder.on_page_load(|window, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                println!("SMOKE_TEST_READY");
                let _ = std::io::Write::flush(&mut std::io::stdout());
                // Brief grace window so any synchronous post-load error in the
                // renderer still has a chance to surface as a panic before exit.
                let app = window.app_handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    app.exit(0);
                });
            }
        });
    } else if ui_probe {
        builder = builder.on_page_load(|window, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                let win = window.window();
                match (win.inner_position(), win.scale_factor()) {
                    (Ok(pos), Ok(scale)) => {
                        println!("UI_PROBE_READY x={} y={} scale={scale}", pos.x, pos.y);
                    }
                    (pos, scale) => {
                        println!(
                            "UI_PROBE_ERROR failed to read window geometry: position={pos:?} scale={scale:?}"
                        );
                    }
                }
                let _ = std::io::Write::flush(&mut std::io::stdout());
            }
        });
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
