import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { PublisherGithub } from "@electron-forge/publisher-github";
import { cpSync } from "fs";

const config: ForgeConfig = {
  packagerConfig: {
    icon: "./build/icons/icon",
    ignore: [
      /\.github/,
      /build/,
      /core/,
      /network/,
      /\.gitignore/,
      /forge\.config\.js/,
      /forge\.config\.ts/,
      /local\-create\.sh/,
      /local\-remove\.sh/,
      /README\.md/,
    ],
    win32metadata: {
      ProductName: "Simple Irc Client",
      CompanyName: "Simple Irc Client",
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      // https://github.com/electron/forge/blob/main/packages/maker/squirrel/src/MakerSquirrel.ts
      iconUrl: "https://simpleircclient.pages.dev/favicon.ico",
      setupIcon: "./build/icons/icon.ico",
    }),
    new MakerDeb({
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
  publishers: [
    new PublisherGithub({
      repository: {
        owner: "Simple-Irc-Client",
        name: "desktop",
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
      cpSync("./src/irc-network.js", `${buildPath}/src/irc-network.js`);
    },
  },
};

export default config;
