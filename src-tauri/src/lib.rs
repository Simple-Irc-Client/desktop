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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let smoke = is_smoke_test();
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
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
