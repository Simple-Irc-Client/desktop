const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("sicDesktop", {
  platform: process.platform,
});
