mod irc;

use irc::commands::{irc_connect, irc_disconnect, irc_quit, irc_send};
use irc::state::IrcState;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;

/// CI smoke test mode. Drives the runner at scripts/smoke-test.js: the runner
/// spawns this binary with SMOKE_TEST=<mode> and decides pass/fail purely from
/// line-based sentinels on stdout/stderr.
#[derive(Clone, Copy, PartialEq)]
enum SmokeMode {
    Off,
    /// SMOKE_TEST=1 — the original ready-and-exit smoke test.
    Ready,
    /// SMOKE_TEST=paste — context-menu paste round-trip used on macOS, where
    /// tauri-driver can't drive WKWebView. Throwaway: delete this arm,
    /// `sic_paste_smoke_report`, and `PASTE_TEST_JS` after the verification
    /// window for the Electron → Tauri migration closes.
    Paste,
}

fn smoke_mode() -> SmokeMode {
    match std::env::var("SMOKE_TEST").as_deref() {
        Ok("1") => SmokeMode::Ready,
        Ok("paste") => SmokeMode::Paste,
        _ => SmokeMode::Off,
    }
}

fn install_smoke_test_panic_hook() {
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        eprintln!("SMOKE_TEST_ERROR panic: {info}");
        prev(info);
        std::process::exit(1);
    }));
}

/// THROWAWAY: result sink for the SMOKE_TEST=paste flow. The renderer drives
/// the round-trip and invokes this command with a sentinel line; we print it
/// and exit with the matching code. No-op outside paste smoke mode so a
/// runtime invoke from production frontend code can't kill the app.
#[tauri::command]
fn sic_paste_smoke_report(app: tauri::AppHandle, result: String) {
    if smoke_mode() != SmokeMode::Paste {
        return;
    }
    println!("{result}");
    let _ = std::io::Write::flush(&mut std::io::stdout());
    let exit_code = if result.starts_with("SMOKE_TEST_PASTE_OK") { 0 } else { 1 };
    // Brief grace window so the sentinel reaches the runner before app exit.
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(200));
        app.exit(exit_code);
    });
}

/// THROWAWAY: renderer-side driver for SMOKE_TEST=paste.
///
/// Seeds the clipboard via the same plugin the production paste path reads
/// from, then dispatches mousedown+contextmenu on the wizard nick input so
/// `GlobalInputContextMenu`'s document handler fires (including the
/// `mousedown button=2` selection-snapshot path), clicks the third menuitem
/// (Paste — locale-independent position), and asserts the input's value
/// matches the seeded token. Reports the verdict back via
/// `sic_paste_smoke_report`. Not loaded outside paste smoke mode.
const PASTE_TEST_JS: &str = r#"
(async () => {
  const report = (msg) => window.__TAURI_INTERNALS__.invoke('sic_paste_smoke_report', { result: msg });
  try {
    const token = 'tauri-paste-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    await window.__TAURI_INTERNALS__.invoke('plugin:clipboard-manager|write_text', { label: null, text: token });

    const waitFor = async (predicate, timeoutMs, label) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const result = predicate();
        if (result) return result;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('timeout waiting for ' + label);
    };

    const input = await waitFor(() => document.querySelector('#nick'), 20000, '#nick');
    input.focus();
    const rect = input.getBoundingClientRect();
    const cx = Math.round(rect.left + rect.width / 2);
    const cy = Math.round(rect.top + rect.height / 2);
    const eventInit = { bubbles: true, cancelable: true, button: 2, buttons: 2, clientX: cx, clientY: cy };
    input.dispatchEvent(new MouseEvent('mousedown', eventInit));
    input.dispatchEvent(new MouseEvent('contextmenu', eventInit));

    // Menu items render in fixed DOM order: Cut, Copy, Paste, Select All.
    // Position-based lookup avoids depending on the browser's UI locale.
    const items = await waitFor(() => {
      const list = document.querySelectorAll('[role="menuitem"]');
      return list.length >= 3 ? list : null;
    }, 5000, 'context menu items');
    items[2].click();

    await waitFor(() => input.value === token, 5000, 'input value to match token');
    report('SMOKE_TEST_PASTE_OK:' + token);
  } catch (e) {
    const msg = (e && e.message) ? e.message : String(e);
    report('SMOKE_TEST_PASTE_FAIL:' + msg);
  }
})();
"#;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let smoke = smoke_mode();
    if smoke != SmokeMode::Off {
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
            sic_paste_smoke_report,
        ]);

    match smoke {
        SmokeMode::Ready => {
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
        SmokeMode::Paste => {
            // Guard against on_page_load firing again (e.g. an in-app navigation
            // before the renderer reports back) — we only want to drive the
            // round-trip once per process.
            static INJECTED: AtomicBool = AtomicBool::new(false);
            builder = builder.on_page_load(|window, payload| {
                if !matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                    return;
                }
                if INJECTED.swap(true, Ordering::SeqCst) {
                    return;
                }
                println!("SMOKE_TEST_READY");
                let _ = std::io::Write::flush(&mut std::io::stdout());
                if let Err(e) = window.eval(PASTE_TEST_JS) {
                    eprintln!("SMOKE_TEST_ERROR eval failed: {e}");
                    std::process::exit(1);
                }
            });
        }
        SmokeMode::Off => {}
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
