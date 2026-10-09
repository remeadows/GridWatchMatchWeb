#!/usr/bin/env bash
# Converts the two main-menu art plates (ChatGPT, text-free, from Russ's Drive folder; see
# references/v2/SOURCES.md) into the shipping WebP files. They are plates, not Blender models:
# a rigged Tish does not exist. Run from the repository root; needs cwebp (brew install webp).
#   bash art/gridwatch-match/scripts/export_menu_plates.sh
set -euo pipefail
refs="art/gridwatch-match/references/v2"
out="public/assets/images/match-v2/menu"
mkdir -p "$out"
# The city is opaque and sits behind a scrim, so it takes a lower quality than Tish.
cwebp -quiet -q 78 -m 6 "$refs/GridWatch-Match-Rainy-City-Background-No-UI-v2.png" -o "$out/city.webp"
# Tish keeps her alpha; -alpha_q 100 keeps the cut-out edge exact.
cwebp -quiet -q 86 -m 6 -alpha_q 100 "$refs/GridWatch-Match-Tish-Foreground-Transparent-No-UI-v2.png" -o "$out/tish.webp"
ls -l "$out"
