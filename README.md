# Simple Irc Client

[![Release](https://img.shields.io/github/actions/workflow/status/Simple-Irc-Client/desktop/release-tauri.yml?label=release)](https://github.com/Simple-Irc-Client/desktop/actions/workflows/release-tauri.yml)
[![GitHub Release](https://img.shields.io/github/v/release/Simple-Irc-Client/desktop)](https://github.com/Simple-Irc-Client/desktop/releases)
[![License](https://img.shields.io/badge/license-AGPLv3-orange)](https://github.com/Simple-Irc-Client/desktop/blob/main/LICENSE)
[![Downloads](https://img.shields.io/github/downloads/Simple-Irc-Client/desktop/total)](https://github.com/Simple-Irc-Client/desktop/releases)
[![Tauri](https://img.shields.io/badge/tauri-v2-24C8DB)](https://tauri.app/)

Simple IRC Client is an open source project that provides a minimalist IRC client for users who don't need all the bells and whistles of a full-featured IRC client.

![App Screenshot](./screenshot.png)

## Download

Latest release can be downloaded from [here](https://github.com/Simple-Irc-Client/desktop/releases).

### System requirements

- **Windows** — Windows 10 or later. The installer ships the WebView2 runtime if it isn't already present.
- **macOS** — macOS 12 (Monterey) or later. Uses the system WKWebView; nothing to install.
- **Linux** — `libwebkit2gtk-4.1-0` is required. It's preinstalled on Ubuntu 24.04+, Debian 12+, Fedora 40+, and Arch. On Ubuntu 22.04 install it from universe:

  ```bash
  sudo apt install libwebkit2gtk-4.1-0
  ```

  On Fedora-based distros:

  ```bash
  sudo dnf install webkit2gtk4.1
  ```

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

### macOS code signing & notarization

`release-tauri.yml` reuses the same five GitHub secrets that the previous Electron release workflow used. As long as they're set on the repo, the macOS build is signed and notarized automatically; when they're absent, an unsigned `.dmg` is produced instead.

| Secret | What it is |
|---|---|
| `CERTIFICATE_P12` | Base64 of the "Developer ID Application" `.p12` (cert + private key) |
| `CERTIFICATE_PASSWORD` | Password set when the `.p12` was exported |
| `APPLE_API_KEY_P8` | Base64 of the App Store Connect API `.p8` key file |
| `APPLE_API_KEY_ID` | 10-character Key ID for that `.p8` |
| `APPLE_API_ISSUER_ID` | Issuer UUID from App Store Connect → Users and Access → Integrations |

The workflow decodes `APPLE_API_KEY_P8` to a temp file at runtime and maps the rest into `tauri-action`'s expected env names (`APPLE_CERTIFICATE`, `APPLE_API_KEY`, `APPLE_API_ISSUER`, etc.) — no rename is needed in the GitHub Secrets UI.

## Contributing

If you find a bug or would like to contribute to the project, please open an issue or submit a pull request on GitHub.

## License

This project is licensed under the [Affero General Public License version 3 (AGPLv3)](https://github.com/Simple-Irc-Client/desktop/blob/main/LICENSE).

## Authors

- [Piotr Łuczko](https://www.github.com/piotrluczko)
- [Dariusz Markowicz](https://www.github.com/dmarkowicz)
