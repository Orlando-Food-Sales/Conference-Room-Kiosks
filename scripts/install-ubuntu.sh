#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR=${APP_DIR:-/opt/m365-room-display}
APP_USER=${APP_USER:-m365room}
NODE_VERSION=${NODE_VERSION:-26.13.0}
SOURCE_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

if [[ $EUID -ne 0 ]]; then echo "Run with sudo: sudo bash scripts/install-ubuntu.sh" >&2; exit 1; fi
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl xz-utils nginx openssl

node_ok=false
if command -v node >/dev/null 2>&1; then
  major=$(node -p 'Number(process.versions.node.split(".")[0])')
  [[ $major -ge 20 ]] && node_ok=true
fi
if [[ $node_ok != true ]]; then
  case "$(dpkg --print-architecture)" in amd64) arch=x64;; arm64) arch=arm64;; *) echo "Unsupported architecture: $(dpkg --print-architecture)" >&2; exit 1;; esac
  file="node-v${NODE_VERSION}-linux-${arch}.tar.xz"
  temp=$(mktemp -d); trap 'rm -rf "$temp"' EXIT
  curl --fail --location --proto '=https' --tlsv1.2 -o "$temp/$file" "https://nodejs.org/dist/v${NODE_VERSION}/$file"
  curl --fail --location --proto '=https' --tlsv1.2 -o "$temp/SHASUMS256.txt" "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"
  (cd "$temp" && grep "  $file$" SHASUMS256.txt | sha256sum -c -)
  mkdir -p /usr/local/lib/nodejs
  tar -xJf "$temp/$file" -C /usr/local/lib/nodejs
  for bin in node npm npx corepack; do ln -sfn "/usr/local/lib/nodejs/node-v${NODE_VERSION}-linux-${arch}/bin/$bin" "/usr/local/bin/$bin"; done
fi

id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"
if [[ $(realpath "$SOURCE_DIR") != $(realpath "$APP_DIR") ]]; then
  tar --exclude=.git --exclude=.env --exclude=config/rooms.json --exclude='*.zip' --exclude='*.tar.gz' -C "$SOURCE_DIR" -cf - . | tar -C "$APP_DIR" -xf -
fi
[[ -f "$APP_DIR/.env" ]] || cp "$APP_DIR/.env.example" "$APP_DIR/.env"
[[ -f "$APP_DIR/config/rooms.json" ]] || cp "$APP_DIR/config/rooms.example.json" "$APP_DIR/config/rooms.json"
if grep -q '^ADMIN_TOKEN=replace-' "$APP_DIR/.env"; then
  sed -i "s/^ADMIN_TOKEN=.*/ADMIN_TOKEN=$(openssl rand -hex 32)/" "$APP_DIR/.env"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod 750 "$APP_DIR" "$APP_DIR/config"
chmod 600 "$APP_DIR/.env" "$APP_DIR/config/rooms.json"
chmod +x "$APP_DIR/scripts/"*.sh

cp "$APP_DIR/deploy/m365-room-display.service" /etc/systemd/system/m365-room-display.service
cp "$APP_DIR/deploy/nginx.conf" /etc/nginx/sites-available/m365-room-display
ln -sfn /etc/nginx/sites-available/m365-room-display /etc/nginx/sites-enabled/m365-room-display
rm -f /etc/nginx/sites-enabled/default
nginx -t
sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && npm run check"
systemctl daemon-reload
systemctl enable --now nginx m365-room-display
sleep 2
curl --fail --silent --show-error http://127.0.0.1:3000/healthz
printf '\nInstalled successfully. Edit %s/.env and %s/config/rooms.json, then restart the service.\n' "$APP_DIR" "$APP_DIR"
