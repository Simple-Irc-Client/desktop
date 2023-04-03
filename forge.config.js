const path = require('path');
const fs = require('fs');

module.exports = {
  packagerConfig: {
    executableName: "Simple Irc Client",
    icon: './src/icons/app_icon',
    ignore: [
      "\\.github",
      "core",
      "network",
      ".gitignore",
      "forge.config.js",
      "local-create.sh",
      "local-remove.sh",
      "README.md",
    ],
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        setupIcon: "./src/icons/app_icon.ico",
      },
    },
    {
      name: "@electron-forge/maker-deb",
      config: {
        options: {
          name: "simple-irc-client",
          icon: "./src/icons/app_icon.png",
          homepage: "https://simpleircclient.com",
          categories: ["Network"],
          description: "Cross platform simple IRC client",
          productDescription: "Cross platform simple IRC client",
          productName: "Simple Irc Client",
          section: "comm",
          maintainer: "Simple Irc Client Team",
        },
      },
    },
    {
      name: "@electron-forge/maker-rpm",
      config: {
        options: {
          name: "simple-irc-client",
          icon: "./src/icons/app_icon.png",
          homepage: "https://simpleircclient.com",
          categories: ["Network"],
          description: "Cross platform simple IRC client",
          productDescription: "Cross platform simple IRC client",
          productName: "Simple Irc Client",
        },
      },
    },
  ],
  publishers: [
    {
      name: "@electron-forge/publisher-github",
      config: {
        repository: {
          owner: "Simple-Irc-Client",
          name: "desktop",
        },
      },
    },
  ],
  hooks: {
    packageAfterCopy: async (config, buildPath, electronVersion, platform, arch) => {
      fs.cpSync("./src/irc-network.js", `${buildPath}/src/irc-network.js`);
    }
  }
};
