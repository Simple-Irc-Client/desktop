import { app, BrowserWindow, Menu, session } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// Smoke-test mode. When the CI runner launches the packaged app with
// SMOKE_TEST=1 in the environment, we install extra instrumentation that
// turns the app into a self-terminating health check: any uncaught error
// during startup fails fast, and a successful first window load exits
// the process cleanly. In normal user runs this flag is absent and none
// of the smoke-test code paths execute.
//
// The runner that drives this lives at scripts/smoke-test.js and looks
// for two line-based sentinels on stdout/stderr:
//   - SMOKE_TEST_READY  on stdout  -> the app started and rendered OK
//   - SMOKE_TEST_ERROR  on stderr  -> the app crashed; runner fails fast
// Keep those strings in sync with the runner.
const SMOKE_TEST = process.env.SMOKE_TEST === "1";

if (SMOKE_TEST) {
  // Catch any main-process exception that would otherwise be swallowed
  // by Electron's default handler and leave the app running in a broken
  // state. Print the SMOKE_TEST_ERROR sentinel so the runner can fail
  // immediately without waiting for the overall timeout.
  process.on("uncaughtException", (err) => {
    console.error("SMOKE_TEST_ERROR uncaughtException:", err?.stack || err);
    app.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("SMOKE_TEST_ERROR unhandledRejection:", reason?.stack || reason);
    app.exit(1);
  });
}

const started = require("electron-squirrel-startup");
const { updateElectronApp } = require("update-electron-app");

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Load the IRC backend server in the main process (not as a preload script)
require(path.join(__dirname, "irc-network.cjs"));

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    title: "Simple Irc Client",
    icon: path.join(__dirname, "icons", "app_icon.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  // Block navigation away from the app
  mainWindow.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });

  // Block popup windows
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: "deny" };
  });

  // On macOS without an Edit menu, Cmd+C/V/X/A may not reach the renderer.
  // Handle them natively via before-input-event.
  if (process.platform === "darwin") {
    mainWindow.webContents.on("before-input-event", (event, input) => {
      if (input.meta && input.type === "keyDown") {
        switch (input.key) {
          case "c":
            mainWindow.webContents.copy();
            event.preventDefault();
            break;
          case "v":
            mainWindow.webContents.paste();
            event.preventDefault();
            break;
          case "x":
            mainWindow.webContents.cut();
            event.preventDefault();
            break;
          case "a":
            mainWindow.webContents.selectAll();
            event.preventDefault();
            break;
        }
      }
    });
  }

  // and load the index.html of the app.
  mainWindow.loadFile(path.join(__dirname, "index.html"));

  if (SMOKE_TEST) {
    // Happy path: the renderer finished loading index.html without the
    // main process crashing. Print the ready sentinel and then tear the
    // app down with a short delay so any synchronous errors that fire
    // immediately after load (e.g. during preload-bound IPC wiring)
    // still have a chance to propagate to the uncaughtException handler
    // before we exit 0.
    mainWindow.webContents.once("did-finish-load", () => {
      console.log("SMOKE_TEST_READY");
      setTimeout(() => app.exit(0), 500);
    });

    // Fail path: the window failed to load the HTML at all (bad path,
    // bundler output missing, etc.). did-fail-load doesn't throw, so
    // without this listener the app would just sit there until the
    // runner's overall timeout.
    mainWindow.webContents.once("did-fail-load", (_e, code, desc) => {
      console.error(`SMOKE_TEST_ERROR did-fail-load: ${code} ${desc}`);
      app.exit(1);
    });

    // Fail path: the renderer process itself crashed (OOM, segfault,
    // killed by the OS). This is the only signal the main process gets
    // for a renderer crash — uncaughtException won't fire for it because
    // the failure is out-of-process.
    mainWindow.webContents.on("render-process-gone", (_e, details) => {
      console.error(`SMOKE_TEST_ERROR render-process-gone: ${details.reason}`);
      app.exit(1);
    });
  }

  // Open the DevTools.
  // mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", () => {
  // Deny all permission requests except clipboard
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      callback(permission === "clipboard-read" || permission === "clipboard-sanitized-write");
    }
  );

  createWindow();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

// hide menu
Menu.setApplicationMenu(false);

// updates
// Skipped under SMOKE_TEST because the auto-updater hits the network to
// check GitHub releases, which is both noisy in CI logs and irrelevant
// to the question the smoke test is answering ("does the app start?").
if (!SMOKE_TEST) {
  updateElectronApp();
}
