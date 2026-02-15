const { contextBridge, clipboard } = require("electron");

contextBridge.exposeInMainWorld("sicDesktop", {
  platform: process.platform,
  clipboard: {
    readText: () => clipboard.readText(),
    writeText: (text) => clipboard.writeText(text),
  },
});
