#!/usr/bin/env bash
# Build flowix-cli (the standalone CLI sidecar) and copy the binary into
# `app/flowix-desktop/binaries/` so Tauri's externalBin can pick it up.
#
# Usage:
#   bash scripts/build-cli.sh              # release build, current host
#   bash scripts/build-cli.sh --debug      # debug build, current host
#   bash scripts/build-cli.sh --all        # build all 3 host triples into binaries/
#
# Side-effect:
# - writes `app/flowix-desktop/binaries/flowix-cli-<host-triple>` (with the right
#   extension on Windows, but Tauri will rename it on copy).
# - does NOT touch the workspace `target/` (cargo decides where to put it).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../app" && pwd)"
BINARIES_DIR="$APP_DIR/flowix-desktop/binaries"

PROFILE="release"
BUILD_ALL=0

for arg in "$@"; do
  case "$arg" in
    --debug) PROFILE="debug" ;;
    --all)   BUILD_ALL=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *) echo "unknown flag: $arg"; exit 2 ;;
  esac
done

# ── helpers ──────────────────────────────────────────────────────────
host_triple() {
  rustc -vV | sed -n 's|host: ||p'
}

# Tauri externalBin 期待: binaries/flowix-cli (无后缀)。 Windows 上仍用
# 同名 (Tauri 内部加 .exe), Unix 也不加后缀。
copy_to_binaries() {
  local host="$1"
  local src="$2"
  local ext=""
  if [[ "$host" == *windows* ]]; then
    ext=".exe"
  fi
  local dst="$BINARIES_DIR/flowix-cli-$host$ext"
  mkdir -p "$BINARIES_DIR"
  cp "$src" "$dst"
  echo "  → $dst"
}

# ── main ────────────────────────────────────────────────────────────
echo "▸ flowix-cli build (profile=$PROFILE)"

if [ "$BUILD_ALL" = "1" ]; then
  # CI 用 ── 三平台全编。
  for triple in \
    x86_64-unknown-linux-gnu \
    x86_64-apple-darwin \
    aarch64-apple-darwin \
    x86_64-pc-windows-msvc
  do
    host="$triple"
    echo "▸ build for $host"
    cargo build \
      --manifest-path "$APP_DIR/Cargo.toml" \
      --bin flowix-cli \
      --target "$triple" \
      --release
    bin_path="$APP_DIR/target/$triple/release/flowix-cli"
    [[ "$triple" == *windows* ]] && bin_path="${bin_path}.exe"
    copy_to_binaries "$host" "$bin_path"
  done
else
  host="$(host_triple)"
  echo "▸ host = $host"
  cargo build \
    --manifest-path "$APP_DIR/Cargo.toml" \
    --bin flowix-cli \
    "--$PROFILE"
  bin_path="$APP_DIR/target/$host/$PROFILE/flowix-cli"
  if [ ! -f "$bin_path" ]; then
    # Cargo 偶尔把 host-specific 输出放在 target/release/ 而不是 target/$host/release/
    bin_path="$APP_DIR/target/$PROFILE/flowix-cli"
  fi
  copy_to_binaries "$host" "$bin_path"
fi

echo "✓ done"
