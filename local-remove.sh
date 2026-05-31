#!/bin/bash
# Remove the sibling clones placed by local-create.sh.
set -euo pipefail

cd "$(dirname "$0")/.."
rm -rf core network-rs
