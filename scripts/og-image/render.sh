#!/usr/bin/env bash
#
# Render scripts/og-image/og-image.svg → public/og-image.png.
#
# The PNG is committed to the repo; this script only needs to run when the
# source SVG changes. Output target: 1200x630 (standard Open Graph), <50 KB.
#
# Dependencies (macOS):
#   brew install librsvg pngquant
#
# Recipe:
#   1. rsvg-convert: rasterize the SVG to a 1200x630 PNG at full quality.
#   2. pngquant:     palette-quantize to shrink the file ~3x with no visible
#                    loss for a flat-color hero like this one.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SRC="$SCRIPT_DIR/og-image.svg"
OUT="$REPO_ROOT/public/og-image.png"
TMP="$(mktemp -t og-image-raw).png"
trap 'rm -f "$TMP"' EXIT

command -v rsvg-convert >/dev/null || { echo "rsvg-convert not found — brew install librsvg" >&2; exit 1; }
command -v pngquant     >/dev/null || { echo "pngquant not found — brew install pngquant"     >&2; exit 1; }

echo "Rasterizing $SRC → 1200x630 PNG..."
rsvg-convert --width=1200 --height=630 --background-color=none "$SRC" --output "$TMP"

echo "Optimizing with pngquant..."
pngquant --quality=80-95 --speed=1 --force --output "$OUT" "$TMP"

bytes=$(stat -f%z "$OUT" 2>/dev/null || stat -c%s "$OUT")
printf "Wrote %s (%d bytes / %.1f KB)\n" "$OUT" "$bytes" "$(echo "scale=1; $bytes / 1024" | bc)"
