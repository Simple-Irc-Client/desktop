require("update-electron-app")({
  repo: "Simple-Irc-Client/desktop",
  updateInterval: "1 hour",
  logger: require("electron-log"),
});
