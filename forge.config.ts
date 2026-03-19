import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { MakerWix } from "@electron-forge/maker-wix";
import { MakerSnap } from "@electron-forge/maker-snap";
import { MakerDMG } from "@electron-forge/maker-dmg";

import { cpSync } from "fs";

const config: ForgeConfig = {
  packagerConfig: {
    appBundleId: "com.simpleircclient.desktop",
    icon: "./build/icons/icon",
    ignore: [
      /\.env/,
      /\.github/,
      /build/,
      /resources/,
      /core/,
      /network/,
      /built-deps/,
      /\.gitignore/,
      /forge\.config\.js/,
      /forge\.config\.ts/,
      /local-create\.sh/,
      /local-remove\.sh/,
      /README\.md/,
      /screenshot\.png/,
      /LICENSE/
    ],
    win32metadata: {
      ProductName: "Simple Irc Client",
      CompanyName: "Simple Irc Client",
    },
    ...(process.env.WINDOWS_CERTIFICATE_FILE
      ? {
          windowsSign: {
            certificateFile: process.env.WINDOWS_CERTIFICATE_FILE,
            certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD,
          },
        }
      : {}),
    ...(process.env.OSX_SIGN ? { osxSign: {} } : {}),
  },
  rebuildConfig: {},
  makers: [
    new MakerZIP({}, ["darwin"]),
    new MakerDMG({
      // dmg
      // https://github.com/electron/forge/blob/main/packages/maker/dmg/src/MakerDMG.ts
      icon: "./build/icons/icon.icns",
      name: "Simple Irc Client",
    }),
    new MakerSquirrel({
      // exe
      // https://github.com/electron/forge/blob/main/packages/maker/squirrel/src/MakerSquirrel.ts
      iconUrl: "https://simpleircclient.com/favicon.ico",
      setupIcon: "./build/icons/icon.ico",
    }),
    new MakerWix({
      // msi
      // https://github.com/electron/forge/blob/main/packages/maker/wix/src/Config.ts
      name: "Simple Irc Client",
      description: "Cross platform Simple Irc Client",
      icon: "./build/icons/icon.ico",
      manufacturer: "Simple Irc Client Team",
      ui: {
        chooseDirectory: true,
      },
    }),
    new MakerSnap({
      // snap
      options: {
        // https://github.com/electron/forge/blob/main/packages/maker/snap/src/Config.ts
        name: "simple-irc-client",
        summary: "Cross platform Simple Irc Client",
        description: "Cross platform Simple Irc Client",
        base: "core22",
        confinement: "strict",
        grade: "stable",
        categories: ["Network"],
        plugs: [
          "browser-support",
          "network",
          "desktop",
          "desktop-legacy",
          "x11",
          "wayland",
          "home",
          "audio-playback",
          "pulseaudio",
          "opengl",
        ],
      },
    }),
    new MakerDeb({
      // deb
      options: {
        // https://github.com/electron/forge/blob/main/packages/maker/deb/src/Config.ts
        name: "simple-irc-client",
        icon: "./build/icons/icon.png",
        homepage: "https://simpleircclient.com",
        categories: ["Network"],
        description: "Cross platform Simple Irc Client",
        productDescription: "Cross platform Simple Irc Client",
        productName: "Simple Irc Client",
        section: "comm",
        maintainer: "Simple Irc Client Team",
      },
    }),
    new MakerRpm({
      // rpm
      options: {
        // https://github.com/electron/forge/blob/main/packages/maker/rpm/src/Config.ts
        name: "simple-irc-client",
        icon: "./build/icons/icon.png",
        homepage: "https://simpleircclient.com",
        categories: ["Network"],
        description: "Cross platform Simple Irc Client",
        productDescription: "Cross platform Simple Irc Client",
        productName: "Simple Irc Client",
      },
    }),
  ],
  hooks: {
    packageAfterCopy: async (
      config,
      buildPath,
      electronVersion,
      platform,
      arch
    ) => {
      cpSync("./src/irc-network.cjs", `${buildPath}/src/irc-network.cjs`);
      cpSync("./src/preload.cjs", `${buildPath}/src/preload.cjs`);
    },
  },
};

export default config;
