#!/usr/bin/env bash
# КРАЙ / Edge Push — баннер 1024×500 для Google Play.
# Нужен ImageMagick с шрифтом DejaVu (кириллица). Скрипт идемпотентен.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v convert >/dev/null 2>&1; then
  echo "Нужен ImageMagick: convert" >&2
  exit 1
fi

mkdir -p store

convert -size 1024x500 gradient:'#141c2e-#070910' \
  -fill '#00e5ff' -draw 'rectangle 0,0 7,500' \
  \( icons/icon-512.png -resize 360x360 \) \
    -gravity northwest -geometry +58+70 -composite \
  -gravity northwest \
  -font DejaVu-Sans-Bold -pointsize 84 -fill '#e8edf7' \
    -annotate +470+120 'КРАЙ' \
  -fill '#00e5ff' -draw 'rectangle 470,225 700,229' \
  -font DejaVu-Sans-Bold -pointsize 30 -fill '#00e5ff' \
    -annotate +475+250 'EDGE PUSH' \
  -font DejaVu-Sans -pointsize 25 -fill '#8b96ad' \
    -annotate +475+315 'Пошаговая тактика непрямого боя' \
  -font DejaVu-Sans -pointsize 22 -fill '#ffb037' \
    -annotate +475+375 '10 уровней сложности · офлайн · без рекламы' \
  -define png:color-type=6 \
  store/feature-graphic.png

echo "store/feature-graphic.png: $(identify -format '%wx%h %b' store/feature-graphic.png)"
