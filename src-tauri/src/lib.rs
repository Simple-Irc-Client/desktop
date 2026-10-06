mod irc;

use std::io::Write;
use std::time::Duration;

use irc::commands::{irc_connect, irc_disconnect, irc_send};
use irc::state::IrcState;
use tauri::Manager;
use tauri::webview::PageLoadEvent;

/// With SMOKE_TEST=1 the app reports to scripts/smoke-test.js through stdout/stderr sentinels.
fn is_smoke_test() -> bool {
    std::env::var("SMOKE_TEST").as_deref() == Ok("1")
}

fn install_smoke_test_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        eprintln!("SMOKE_TEST_ERROR panic: {info}");
        previous(info);
        std::process::exit(1);
    }));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let smoke_test = is_smoke_test();
    if smoke_test {
        install_smoke_test_panic_hook();
    }

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(IrcState::default())
        .invoke_handler(tauri::generate_handler![
            irc_connect,
            irc_send,
            irc_disconnect
        ]);

    if smoke_test {
        builder = builder.on_page_load(|window, payload| {
            if matches!(payload.event(), PageLoadEvent::Finished) {
                println!("SMOKE_TEST_READY");
                let _ = std::io::stdout().flush();
                // Lets an error thrown right after load still surface as a panic before exiting
                let app = window.app_handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(500));
                    app.exit(0);
                });
            }
        });
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
