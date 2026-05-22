#!/usr/bin/env bash

# Build a local macOS DMG through the project's existing npm/Tauri scripts.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TARGET_DIR="${PROJECT_ROOT}/src-tauri/target"
BUILD_MODE="release"
BUILD_SCRIPT="desktop:build:dmg"

usage() {
  echo "Usage: $0 [--debug]"
  echo
  echo "Options:"
  echo "  --debug, -d    Build a debug DMG with npm run desktop:build:debug:dmg"
  echo "  --help, -h     Show this help message"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --debug|-d)
      BUILD_MODE="debug"
      BUILD_SCRIPT="desktop:build:debug:dmg"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "DMG packaging is only available on macOS." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to build the DMG, but it was not found in PATH." >&2
  exit 1
fi

cd "${PROJECT_ROOT}"

if [[ ! -d "${PROJECT_ROOT}/node_modules" ]]; then
  echo "node_modules is missing. Installing project dependencies with npm install..."
  npm install
fi

echo "Building SmartReader web assets..."
npm run build

echo "Building ${BUILD_MODE} macOS DMG..."
npm run "${BUILD_SCRIPT}"

echo
echo "DMG output:"
if [[ ! -d "${TARGET_DIR}" ]]; then
  echo "No Tauri target directory was found under ${TARGET_DIR}." >&2
  exit 1
fi

DMG_FILES="$(find "${TARGET_DIR}" -path "*/${BUILD_MODE}/bundle/dmg/*.dmg" -type f -print | sort)"
if [[ -z "${DMG_FILES}" ]]; then
  echo "No ${BUILD_MODE} DMG was found under ${TARGET_DIR}." >&2
  exit 1
fi

echo "${DMG_FILES}"
