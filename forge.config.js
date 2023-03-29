module.exports = {
  packagerConfig: {},
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        setupIcon: './src/icons/app_icon.ico',
      },
    },
    {
      name: "@electron-forge/maker-deb",
      config: {
        options: {
          icon: './src/icons/app_icon.png'
        }
      },
    },
    {
      name: "@electron-forge/maker-rpm",
      config: {
        options: {
          icon: './src/icons/app_icon.png'
        }
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
};
