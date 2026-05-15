// Prevents additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK renders through FreeType, which applies "stem darkening" to
    // glyphs by default — this is what makes the Linux desktop build look
    // bolder than the Chromium-based Electron build. Disabling it across the
    // CFF/autofitter/Type1 drivers matches Chromium's lighter weight. Must be
    // set before GTK/WebKitGTK (and thus FreeType) initialize. Respects an
    // existing FREETYPE_PROPERTIES so the user can still override.
    #[cfg(target_os = "linux")]
    if std::env::var_os("FREETYPE_PROPERTIES").is_none() {
        // SAFE: single-threaded — runs before Tauri/GTK spawn any threads.
        unsafe {
            std::env::set_var(
                "FREETYPE_PROPERTIES",
                "cff:no-stem-darkening=1 autofitter:no-stem-darkening=1 \
                 type1:no-stem-darkening=1 t1cid:no-stem-darkening=1",
            );
        }
    }

    simple_irc_client_lib::run()
}
