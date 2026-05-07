# Simple Irc Client

[![Release](https://img.shields.io/github/actions/workflow/status/Simple-Irc-Client/desktop/release-tauri.yml?label=release)](https://github.com/Simple-Irc-Client/desktop/actions/workflows/release-tauri.yml)
[![GitHub Release](https://img.shields.io/github/v/release/Simple-Irc-Client/desktop)](https://github.com/Simple-Irc-Client/desktop/releases)
[![License](https://img.shields.io/badge/license-AGPLv3-orange)](https://github.com/Simple-Irc-Client/desktop/blob/main/LICENSE)
[![Downloads](https://img.shields.io/github/downloads/Simple-Irc-Client/desktop/total)](https://github.com/Simple-Irc-Client/desktop/releases)
[![Tauri](https://img.shields.io/badge/tauri-v2-24C8DB)](https://tauri.app/)

Simple IRC Client is an open source project that provides a minimalist IRC client for users who don't need all the bells and whistles of a full-featured IRC client.

![App Screenshot](./screenshot.png)

## Download

Latest release can be downloaded from [here](https://github.com/Simple-Irc-Client/desktop/releases)

## Building from source

The desktop app is a [Tauri v2](https://tauri.app/) shell that hosts the React renderer from [`core`](https://github.com/Simple-Irc-Client/core) and links the Rust IRC client from [`network-rs`](https://github.com/Simple-Irc-Client/network-rs).

Layout the three repos as siblings:

```
Simple-Irc-Client/
├── core/        # Vite + React renderer (built to core/dist/)
├── network-rs/  # Rust IRC protocol crate (sic-irc)
└── desktop/     # this repo — Tauri shell
```

Prerequisites: Rust (stable), Node 24+, pnpm 10+, plus the [Tauri Linux system deps](https://v2.tauri.app/start/prerequisites/#linux) on Linux.

```bash
# in core/
pnpm install && pnpm build

# in desktop/
pnpm install
pnpm tauri:dev      # dev loop with hot reload
pnpm tauri:build    # produce platform-native bundles
```

### Update signing (release builds only)

Releases are signed with an Ed25519 key so the in-app updater can verify them. When running `pnpm tauri:build` locally and the updater config is enabled, set:

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/sic.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
```

To skip updater artifacts entirely (when you don't have the key):

```bash
pnpm tauri build --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

CI publishes signed bundles automatically on tag pushes via `release-tauri.yml`.

## Contributing

If you find a bug or would like to contribute to the project, please open an issue or submit a pull request on GitHub.

## License

This project is licensed under the [Affero General Public License version 3 (AGPLv3)](https://github.com/Simple-Irc-Client/desktop/blob/main/LICENSE).

## Authors

- [Piotr Łuczko](https://www.github.com/piotrluczko)
- [Dariusz Markowicz](https://www.github.com/dmarkowicz)
