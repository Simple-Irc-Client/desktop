#!/bin/bash
# Bootstrap local development by cloning the renderer and the Rust IRC crate
# as siblings of this repo, then building the renderer once so `tauri dev` /
# `tauri build` have a populated core/dist to load.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -d core ]; then
  git clone git@github.com:Simple-Irc-Client/core.git
fi

if [ ! -d network-rs ]; then
  git clone git@github.com:Simple-Irc-Client/network-rs.git
fi

cd core
pnpm install
pnpm build
