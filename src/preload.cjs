const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sicDesktop", {
  platform: process.platform,
  clipboard: {
    readText: () => ipcRenderer.invoke("sic:clipboard:read"),
    writeText: (text) => ipcRenderer.send("sic:clipboard:write", text),
  },
});
