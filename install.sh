#!/usr/bin/env bash
# Zaman Planlayıcı'yı sadece bu kullanıcı için kurar (sudo gerekmez).
#   ~/Applications/zaman-planlayici.AppImage
#   ~/.local/share/applications/zaman-planlayici.desktop  (uygulama menüsü)
#   ~/.local/share/icons/hicolor/512x512/apps/zaman-planlayici.png
set -euo pipefail
cd "$(dirname "$0")"

APPIMAGE=$(ls -t dist/zaman-planlayici-*.AppImage 2>/dev/null | head -1 || true)
if [ -z "$APPIMAGE" ]; then
  echo "dist/ içinde AppImage yok. Önce: npm run dist" >&2
  exit 1
fi

BIN_DIR="$HOME/Applications"
APPS_DIR="$HOME/.local/share/applications"
ICON_DIR="$HOME/.local/share/icons/hicolor/512x512/apps"
mkdir -p "$BIN_DIR" "$APPS_DIR" "$ICON_DIR"

install -m 755 "$APPIMAGE" "$BIN_DIR/zaman-planlayici.AppImage"
install -m 644 build/icon.png "$ICON_DIR/zaman-planlayici.png"

cat > "$APPS_DIR/zaman-planlayici.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Zaman Planlayıcı
Comment=Kategorili zaman planlayıcı ve takvim
Exec="$BIN_DIR/zaman-planlayici.AppImage" %U
Icon=zaman-planlayici
Terminal=false
Categories=Office;Calendar;
Keywords=takvim;planlayıcı;calendar;
StartupWMClass=zaman-planlayici
EOF

update-desktop-database "$APPS_DIR" 2>/dev/null || true
command -v kbuildsycoca6 >/dev/null && kbuildsycoca6 >/dev/null 2>&1 || true

echo "Kuruldu: $BIN_DIR/zaman-planlayici.AppImage"
echo "Uygulama menüsünde 'Zaman Planlayıcı' olarak görünür."
