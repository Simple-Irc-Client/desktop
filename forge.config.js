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
          icon: "./src/icons/app_icon.png",
        },
      },
    },
    {
      name: "@electron-forge/maker-rpm",
      config: {
        options: {
          icon: "./src/icons/app_icon.png",
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
