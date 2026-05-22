#!/usr/bin/env bash

# Compatibility entry point for local macOS DMG builds.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" || "${1:-}" == "help" ]]; then
  echo "Usage: $0 [--debug]"
  echo
  echo "Options:"
  echo "  --debug, -d, debug    Build a debug DMG through scripts/build-desktop.sh"
  echo "  --help, -h            Show this help message"
  exit 0
fi

exec "${SCRIPT_DIR}/build-desktop.sh" dmg "$@"
