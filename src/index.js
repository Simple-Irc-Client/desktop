const { app, BrowserWindow, Menu } = require("electron");
const path = require("path");
const Sentry = require("@sentry/electron");

Sentry.init({ dsn: "https://3765d3209d984842b3e2bb456d19de12@o281310.ingest.sentry.io/1506513" });

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require("electron-squirrel-startup")) {
  app.quit();
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    title: "Simple Irc Client",
    icon: path.join(__dirname, "icons", "app_icon.png"),
    webPreferences: {
      nodeIntegration: true,
      preload: path.join(__dirname, "irc-network.js"), // https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
    },
  });

  // and load the index.html of the app.
  mainWindow.loadFile(path.join(__dirname, "index.html"));

  // Open the DevTools.
  // mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", createWindow);

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
require("update-electron-app")();
