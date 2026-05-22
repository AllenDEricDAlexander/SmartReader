#!/usr/bin/env bash

# Build local Tauri desktop installers for the current host platform.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TARGET_DIR="${PROJECT_ROOT}/src-tauri/target"
BUILD_MODE="release"
TARGET_ARG=""

usage() {
  echo "Usage: $0 <target> [--debug]"
  echo
  echo "Targets:"
  echo "  dmg       Build a macOS DMG. Must run on macOS."
  echo "  win       Build Windows NSIS and MSI installers. Must run on Windows."
  echo "  nsis      Build a Windows NSIS installer. Must run on Windows."
  echo "  msi       Build a Windows MSI installer. Must run on Windows."
  echo "  deb       Build a Linux DEB package. Must run on Linux."
  echo "  rpm       Build a Linux RPM package. Must run on Linux."
  echo "  linux     Build Linux DEB and RPM packages. Must run on Linux."
  echo "  all       Build the targets supported by the current host OS."
  echo "  help      Show this help message."
  echo
  echo "Options:"
  echo "  --debug, -d, debug    Build with Tauri debug settings."
  echo "  --help, -h            Show this help message."
  echo
  echo "Cross-platform boundary:"
  echo "  macOS DMG packaging should run on macOS, Windows installers should run on"
  echo "  Windows, and Linux DEB/RPM packages should run on Linux with the system"
  echo "  packaging tools installed."
}

host_os() {
  case "$(uname -s)" in
    Darwin)
      echo "macos"
      ;;
    Linux)
      echo "linux"
      ;;
    MINGW*|MSYS*|CYGWIN*)
      echo "windows"
      ;;
    *)
      if [[ "${OS:-}" == "Windows_NT" ]]; then
        echo "windows"
      else
        echo "unknown"
      fi
      ;;
  esac
}

require_command() {
  local command_name="$1"
  local install_hint="$2"

  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "${command_name} is required. ${install_hint}" >&2
    exit 1
  fi
}

require_host() {
  local expected_os="$1"
  local target_name="$2"
  local current_os="$3"

  if [[ "${current_os}" != "${expected_os}" ]]; then
    echo "${target_name} must be built on ${expected_os}; current host is ${current_os}." >&2
    case "${expected_os}" in
      macos)
        echo "Run this target on a macOS machine with Tauri's macOS bundler available." >&2
        ;;
      windows)
        echo "Run this target on a Windows machine with Tauri's Windows installer toolchain available." >&2
        ;;
      linux)
        echo "Run this target on a Linux machine with the required DEB/RPM packaging tools installed." >&2
        ;;
    esac
    exit 1
  fi
}

bundle_dir_for() {
  case "$1" in
    dmg|nsis|msi|deb|rpm)
      echo "$1"
      ;;
    *)
      echo "Unsupported bundle target: $1" >&2
      exit 1
      ;;
  esac
}

artifact_ext_for() {
  case "$1" in
    dmg)
      echo ".dmg"
      ;;
    nsis)
      echo ".exe"
      ;;
    msi)
      echo ".msi"
      ;;
    deb)
      echo ".deb"
      ;;
    rpm)
      echo ".rpm"
      ;;
    *)
      echo "Unsupported bundle target: $1" >&2
      exit 1
      ;;
  esac
}

print_artifacts() {
  local bundle_target="$1"
  local bundle_dir
  local artifact_ext
  local artifacts

  bundle_dir="$(bundle_dir_for "${bundle_target}")"
  artifact_ext="$(artifact_ext_for "${bundle_target}")"

  if [[ ! -d "${TARGET_DIR}" ]]; then
    echo "No Tauri target directory was found under ${TARGET_DIR}." >&2
    exit 1
  fi

  artifacts="$(find "${TARGET_DIR}" -path "*/${BUILD_MODE}/bundle/${bundle_dir}/*${artifact_ext}" -type f -print | sort)"
  if [[ -z "${artifacts}" ]]; then
    echo "No ${BUILD_MODE} ${bundle_target} artifact was found under ${TARGET_DIR}." >&2
    exit 1
  fi

  echo "${artifacts}"
}

run_tauri_build() {
  local bundle_target="$1"
  local tauri_args

  tauri_args=(run tauri -- build)
  if [[ "${BUILD_MODE}" == "debug" ]]; then
    tauri_args+=(--debug)
  fi
  tauri_args+=(--bundles "${bundle_target}")

  echo
  echo "Building ${BUILD_MODE} ${bundle_target} package..."
  echo "Tauri beforeBuildCommand will run npm run build."
  npm "${tauri_args[@]}"

  echo
  echo "${bundle_target} output:"
  print_artifacts "${bundle_target}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --debug|-d|debug)
      BUILD_MODE="debug"
      shift
      ;;
    --help|-h|help)
      usage
      exit 0
      ;;
    dmg|win|windows|nsis|msi|deb|rpm|linux|all)
      if [[ -n "${TARGET_ARG}" ]]; then
        echo "Only one target can be specified. Got '${TARGET_ARG}' and '$1'." >&2
        usage >&2
        exit 1
      fi
      TARGET_ARG="$1"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "${TARGET_ARG}" ]]; then
  usage >&2
  exit 1
fi

require_command "npm" "Install Node.js/npm and retry."

cd "${PROJECT_ROOT}"

if [[ ! -d "${PROJECT_ROOT}/node_modules" ]]; then
  echo "node_modules is missing. Installing project dependencies with npm install..."
  npm install
fi

CURRENT_OS="$(host_os)"
BUILD_TARGETS=()

case "${TARGET_ARG}" in
  dmg)
    require_host "macos" "DMG packaging" "${CURRENT_OS}"
    BUILD_TARGETS=(dmg)
    ;;
  win|windows)
    require_host "windows" "Windows installer packaging" "${CURRENT_OS}"
    BUILD_TARGETS=(nsis msi)
    ;;
  nsis|msi)
    require_host "windows" "${TARGET_ARG} packaging" "${CURRENT_OS}"
    BUILD_TARGETS=("${TARGET_ARG}")
    ;;
  deb)
    require_host "linux" "DEB packaging" "${CURRENT_OS}"
    require_command "dpkg-deb" "Install the distribution package tools, then retry."
    BUILD_TARGETS=(deb)
    ;;
  rpm)
    require_host "linux" "RPM packaging" "${CURRENT_OS}"
    require_command "rpmbuild" "Install rpm-build or the equivalent package, then retry."
    BUILD_TARGETS=(rpm)
    ;;
  linux)
    require_host "linux" "Linux packaging" "${CURRENT_OS}"
    require_command "dpkg-deb" "Install the distribution package tools, then retry."
    require_command "rpmbuild" "Install rpm-build or the equivalent package, then retry."
    BUILD_TARGETS=(deb rpm)
    ;;
  all)
    case "${CURRENT_OS}" in
      macos)
        BUILD_TARGETS=(dmg)
        echo "Skipping Windows installers: run './scripts/build-desktop.sh win' on Windows."
        echo "Skipping Linux packages: run './scripts/build-desktop.sh linux' on Linux."
        ;;
      windows)
        BUILD_TARGETS=(nsis msi)
        echo "Skipping macOS DMG: run './scripts/build-desktop.sh dmg' on macOS."
        echo "Skipping Linux packages: run './scripts/build-desktop.sh linux' on Linux."
        ;;
      linux)
        require_command "dpkg-deb" "Install the distribution package tools, then retry."
        require_command "rpmbuild" "Install rpm-build or the equivalent package, then retry."
        BUILD_TARGETS=(deb rpm)
        echo "Skipping macOS DMG: run './scripts/build-desktop.sh dmg' on macOS."
        echo "Skipping Windows installers: run './scripts/build-desktop.sh win' on Windows."
        ;;
      *)
        echo "Unsupported host OS for all: ${CURRENT_OS}." >&2
        exit 1
        ;;
    esac
    ;;
esac

for bundle_target in "${BUILD_TARGETS[@]}"; do
  run_tauri_build "${bundle_target}"
done
