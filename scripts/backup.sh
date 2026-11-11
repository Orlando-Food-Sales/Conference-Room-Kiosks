#!/usr/bin/env bash
set -Eeuo pipefail
BACKUP_DIR=${BACKUP_DIR:-/var/backups/m365-room-display}
STAMP=$(date -u +%Y%m%d-%H%M%S)
[[ $EUID -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }
mkdir -p "$BACKUP_DIR"
tar -czpf "$BACKUP_DIR/m365-room-display-v2-known-good-$STAMP.tar.gz" /opt/m365-room-display
cp -a /etc/systemd/system/m365-room-display.service "$BACKUP_DIR/m365-room-display-v2.service-$STAMP"
cp -a /etc/nginx/sites-available/m365-room-display "$BACKUP_DIR/m365-room-display-v2.nginx-$STAMP"
(cd "$BACKUP_DIR" && sha256sum "m365-room-display-v2-known-good-$STAMP.tar.gz" "m365-room-display-v2.service-$STAMP" "m365-room-display-v2.nginx-$STAMP" > "SHA256SUMS-v2-$STAMP" && sha256sum -c "SHA256SUMS-v2-$STAMP")
chown -R root:root "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"; find "$BACKUP_DIR" -type f -exec chmod 600 {} +
echo "Backup created in $BACKUP_DIR with timestamp $STAMP"
