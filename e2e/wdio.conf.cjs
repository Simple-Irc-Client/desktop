// THROWAWAY: WebdriverIO harness for verifying the custom context-menu Paste
// action inside the real Tauri webview on Linux + Windows. macOS runs an
// in-app synthetic equivalent via scripts/smoke-test.js --mode=paste because
// tauri-driver can't drive WKWebView. Remove `desktop/e2e/` and the
// `e2e` script + `@wdio/*` devDeps in package.json once the Electron → Tauri
// migration verification window closes.
//
// Talks to tauri-driver, which we spawn in onPrepare. tauri-driver wraps:
//   • WebKitWebDriver  on Linux (apt: webkit2gtk-driver)
//   • msedgedriver.exe on Windows (preinstalled on windows-latest runners)
// The Tauri WebDriver guide is the source of truth for prerequisites.

const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

const TAURI_DRIVER_PORT = 4444;

const binaryPath = process.env.TAURI_APP_PATH;
if (!binaryPath) {
  throw new Error('TAURI_APP_PATH is not set — point it at the packaged Tauri binary.');
}
const resolvedBinary = resolve(binaryPath);
if (!existsSync(resolvedBinary)) {
  throw new Error(`TAURI_APP_PATH does not exist: ${resolvedBinary}`);
}

let tauriDriver;

exports.config = {
  runner: 'local',
  framework: 'mocha',
  reporters: ['spec'],
  specs: ['./tests/**/*.spec.cjs'],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'wry',
      'tauri:options': { application: resolvedBinary },
    },
  ],
  hostname: '127.0.0.1',
  port: TAURI_DRIVER_PORT,
  logLevel: 'info',
  waitforTimeout: 30_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 3,
  mochaOpts: { ui: 'bdd', timeout: 90_000 },

  onPrepare: () => new Promise((resolveOnPrepare, rejectOnPrepare) => {
    tauriDriver = spawn('tauri-driver', ['--port', String(TAURI_DRIVER_PORT)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    tauriDriver.stdout.on('data', (d) => process.stdout.write(`[tauri-driver] ${d}`));
    tauriDriver.stderr.on('data', (d) => process.stderr.write(`[tauri-driver] ${d}`));
    tauriDriver.on('error', (err) => rejectOnPrepare(new Error(`failed to spawn tauri-driver: ${err.message}`)));
    tauriDriver.on('exit', (code, signal) => {
      if (code !== null && code !== 0) {
        // Surface early-exit visibly; WDIO would otherwise report a confusing
        // connection-refused error several seconds later.
        console.error(`tauri-driver exited unexpectedly (code=${code} signal=${signal})`);
      }
    });
    // tauri-driver needs a moment to bind its port. There's no readiness
    // signal on stdout, so we sleep briefly — WDIO's own connection retry
    // covers any remaining slack.
    setTimeout(resolveOnPrepare, 2_000);
  }),

  onComplete: () => {
    try {
      tauriDriver?.kill('SIGKILL');
    } catch {
      // Already gone — fine.
    }
  },
};
