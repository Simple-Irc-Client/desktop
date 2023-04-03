const path = require('path');
const fs = require('fs');

module.exports = {
  packagerConfig: {
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
    "win32metadata":{
      "ProductName": "Simple Irc Client",
      "CompanyName": "Simple Irc Client",
    }
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        // https://github.com/electron/forge/blob/main/packages/maker/squirrel/src/MakerSquirrel.ts
        iconUrl: 'https://simpleircclient.com/favicon.ico',
        setupIcon: "./src/icons/app_icon.ico",
      },
    },
    {
      name: "@electron-forge/maker-deb",
      config: {
        options: {
          // https://github.com/electron/forge/blob/main/packages/maker/deb/src/Config.ts
          name: "simple-irc-client",
          icon: "./src/icons/app_icon.png",
          homepage: "https://simpleircclient.com",
          categories: ["Network"],
          description: "Cross platform Simple Irc Client",
          productDescription: "Cross platform Simple Irc Client",
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
          // https://github.com/electron/forge/blob/main/packages/maker/rpm/src/Config.ts
          name: "simple-irc-client",
          icon: "./src/icons/app_icon.png",
          homepage: "https://simpleircclient.com",
          categories: ["Network"],
          description: "Cross platform Simple Irc Client",
          productDescription: "Cross platform Simple Irc Client",
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
