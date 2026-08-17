#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly APP_NAME="SmartReader"
readonly BUNDLE_IDENTIFIER="com.smartreader.app"
readonly BUILT_APP="${PROJECT_ROOT}/src-tauri/target/release/bundle/macos/${APP_NAME}.app"
readonly TAURI_CLI="${PROJECT_ROOT}/node_modules/.bin/tauri"

INSTALL_DIR="${SMARTREADER_INSTALL_DIR:-/Applications}"
TEMP_DIR=""
DESTINATION_APP=""
BACKUP_APP=""
INSTALLED_NEW_APP=false

usage() {
  cat <<'EOF'
Usage: ./scripts/build-install-macos.sh [--install-dir <directory>]

Build the SmartReader macOS app bundle and install it locally.

Options:
  --install-dir <directory>  Install directory (default: /Applications)
  -h, --help                 Show this help

Environment:
  SMARTREADER_INSTALL_DIR    Alternative way to set the install directory
EOF
}

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

verify_app_bundle() {
  local app_path="$1"
  local identifier

  [[ -d "${app_path}" ]] || fail "App bundle not found: ${app_path}"
  [[ -f "${app_path}/Contents/Info.plist" ]] || fail "Info.plist not found in ${app_path}"

  identifier="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "${app_path}/Contents/Info.plist")"
  [[ "${identifier}" == "${BUNDLE_IDENTIFIER}" ]] || fail "Unexpected bundle identifier: ${identifier}"

  find "${app_path}/Contents/MacOS" -type f -perm -111 -print -quit | grep -q . \
    || fail "Executable not found in ${app_path}"
}

verify_code_signature() {
  local app_path="$1"

  codesign --verify --deep --strict --verbose=2 "${app_path}" \
    || fail "Code signature verification failed for ${app_path}"
}

cleanup() {
  local exit_code=$?

  trap - EXIT INT TERM

  if [[ ${exit_code} -ne 0 && "${INSTALLED_NEW_APP}" == true && -n "${DESTINATION_APP}" ]]; then
    rm -rf "${DESTINATION_APP}"
  fi

  if [[ ${exit_code} -ne 0 && -n "${BACKUP_APP}" && -e "${BACKUP_APP}" ]]; then
    mv "${BACKUP_APP}" "${DESTINATION_APP}"
    printf 'Previous SmartReader installation was restored.\n' >&2
  fi

  if [[ -n "${TEMP_DIR}" && -d "${TEMP_DIR}" ]]; then
    rm -rf "${TEMP_DIR}"
  fi

  exit "${exit_code}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-dir)
      [[ $# -ge 2 ]] || fail "--install-dir requires a directory"
      INSTALL_DIR="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown option: $1"
      ;;
  esac
done

[[ "$(uname -s)" == "Darwin" ]] || fail "This script can only run on macOS"
[[ "${INSTALL_DIR}" == /* ]] || fail "Install directory must be an absolute path"
[[ -x "${TAURI_CLI}" ]] || fail "Tauri CLI is missing; run 'bun install' first"

require_command bun
require_command cargo
require_command codesign
require_command ditto

printf 'Building %s for macOS...\n' "${APP_NAME}"
(
  cd "${PROJECT_ROOT}"
  "${TAURI_CLI}" build --bundles app
)

verify_app_bundle "${BUILT_APP}"

mkdir -p "${INSTALL_DIR}"
[[ -w "${INSTALL_DIR}" ]] || fail "Install directory is not writable: ${INSTALL_DIR}"

DESTINATION_APP="${INSTALL_DIR}/${APP_NAME}.app"
TEMP_DIR="$(mktemp -d "${INSTALL_DIR}/.smartreader-install.XXXXXX")"
BACKUP_APP="${TEMP_DIR}/${APP_NAME}.previous.app"
readonly STAGED_APP="${TEMP_DIR}/${APP_NAME}.app"

trap cleanup EXIT INT TERM

printf 'Staging %s...\n' "${DESTINATION_APP}"
ditto "${BUILT_APP}" "${STAGED_APP}"
verify_app_bundle "${STAGED_APP}"

printf 'Applying a local ad hoc code signature...\n'
codesign --force --deep --sign - "${STAGED_APP}"
verify_code_signature "${STAGED_APP}"

if [[ -e "${DESTINATION_APP}" ]]; then
  mv "${DESTINATION_APP}" "${BACKUP_APP}"
fi

mv "${STAGED_APP}" "${DESTINATION_APP}"
INSTALLED_NEW_APP=true
verify_app_bundle "${DESTINATION_APP}"
verify_code_signature "${DESTINATION_APP}"

if [[ -e "${BACKUP_APP}" ]]; then
  rm -rf "${BACKUP_APP}"
fi

INSTALLED_NEW_APP=false
printf 'Installed %s successfully.\n' "${DESTINATION_APP}"
printf 'The app was not launched.\n'
