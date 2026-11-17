#!/usr/bin/env bash
# HTTPS for the dashboard with the server's own small certificate authority, renewed automatically.
# INSTALL-UBUNTU.md, section 12d.
#
#   sudo bash scripts/setup-local-https.sh conference.yourcompany.com    # first time (and to change the name)
#   sudo room-display-cert-renew                                          # what the monthly timer runs
#
# What it does:
#   1. Makes a certificate authority once (10 years), limited by a name constraint to the one DNS name, so its key
#      cannot be used to impersonate any other site. Its key never leaves /etc/ssl/room-display/ca (root only).
#   2. Issues the server certificate (397 days) and re-issues it when less than 60 days are left.
#   3. Installs deploy/nginx-https.conf with the name filled in (the old site file is backed up; rolled back if
#      nginx -t fails), and a systemd timer that runs the renewal monthly and reloads nginx after a renewal.
#   4. Copies the public root certificate to /etc/ssl/room-display/room-display-root-ca.crt. Install that file once
#      as a trusted root on each computer that opens the dashboard. The door tablets stay on plain http.
#
# For testing without root: ROOM_DISPLAY_SSL_DIR=/tmp/x NO_INSTALL=1 bash scripts/setup-local-https.sh name.example
set -euo pipefail

SSL_DIR="${ROOM_DISPLAY_SSL_DIR:-/etc/ssl/room-display}"
CA_DIR="$SSL_DIR/ca"
CONF_FILE="$SSL_DIR/hostname"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-available/m365-room-display}"
RENEW_BIN=/usr/local/sbin/room-display-cert-renew
RENEW_DAYS_LEFT=60
CERT_DAYS=397
CA_DAYS=3650
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

die() { echo "ERROR: $*" >&2; exit 1; }
say() { echo "== $*"; }

MODE=setup
[[ "$(basename "$0")" == room-display-cert-renew || "${1:-}" == --renew ]] && MODE=renew
[[ "${1:-}" == --renew ]] && shift

if [[ -z "${NO_INSTALL:-}" && "$(id -u)" != 0 ]]; then die "run with sudo"; fi
command -v openssl >/dev/null || die "openssl is not installed"

if [[ "$MODE" == setup ]]; then
  HOST="${1:-}"
  [[ -n "$HOST" ]] || die "give the DNS name, for example: sudo bash $0 conference.yourcompany.com"
else
  [[ -f "$CONF_FILE" ]] || die "$CONF_FILE is missing; run the setup first"
  HOST="$(cat "$CONF_FILE")"
fi
HOST="$(printf '%s' "$HOST" | tr 'A-Z' 'a-z')"
[[ "$HOST" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || die "not a DNS name: $HOST"

umask 077
mkdir -p "$CA_DIR"
chmod 755 "$SSL_DIR"; chmod 700 "$CA_DIR"

# 1. Certificate authority (once per name; a new name needs a new authority because of the name constraint).
if [[ -f "$CA_DIR/ca.crt" && "$(cat "$CA_DIR/name" 2>/dev/null)" != "$HOST" ]]; then
  [[ "$MODE" == setup ]] || die "the authority was made for another name"
  old="$CA_DIR.old-$(date +%Y%m%d-%H%M%S)"
  say "The name changed: keeping the old authority in $old and making a new one"
  mv "$CA_DIR" "$old"; mkdir -m 700 "$CA_DIR"
fi
if [[ ! -f "$CA_DIR/ca.key" || ! -f "$CA_DIR/ca.crt" ]]; then
  say "Making the certificate authority for $HOST ($CA_DAYS days)"
  openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$CA_DIR/ca.key"
  openssl req -x509 -new -key "$CA_DIR/ca.key" -sha256 -days "$CA_DAYS" \
    -subj "/O=Room Display/CN=Room Display local CA for $HOST" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "subjectKeyIdentifier=hash" \
    -addext "nameConstraints=critical,permitted;DNS:$HOST" \
    -out "$CA_DIR/ca.crt"
  printf '%s\n' "$HOST" > "$CA_DIR/name"
fi
install -m 644 "$CA_DIR/ca.crt" "$SSL_DIR/room-display-root-ca.crt"

# 2. Server certificate: issue when missing, for another name, or with less than RENEW_DAYS_LEFT days left.
need=""
if [[ ! -f "$SSL_DIR/cert.pem" || ! -f "$SSL_DIR/privkey.pem" ]]; then need="missing"
elif ! openssl x509 -in "$SSL_DIR/cert.pem" -noout -checkhost "$HOST" | grep -q "does match"; then need="other name"
elif ! openssl verify -CAfile "$CA_DIR/ca.crt" "$SSL_DIR/cert.pem" >/dev/null 2>&1; then need="other authority"
elif ! openssl x509 -in "$SSL_DIR/cert.pem" -noout -checkend $((RENEW_DAYS_LEFT * 86400)) >/dev/null; then need="due"
fi
renewed=""
if [[ -n "$need" ]]; then
  say "Issuing the server certificate for $HOST ($need, $CERT_DAYS days)"
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$tmp/privkey.pem"
  openssl req -new -key "$tmp/privkey.pem" -subj "/CN=$HOST" -out "$tmp/req.csr"
  cat > "$tmp/ext.cnf" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=serverAuth
subjectAltName=DNS:$HOST
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid
EOF
  openssl x509 -req -in "$tmp/req.csr" -CA "$CA_DIR/ca.crt" -CAkey "$CA_DIR/ca.key" -CAcreateserial \
    -CAserial "$CA_DIR/ca.srl" -sha256 -days "$CERT_DAYS" -extfile "$tmp/ext.cnf" -out "$tmp/cert.pem" 2>/dev/null
  openssl verify -CAfile "$CA_DIR/ca.crt" "$tmp/cert.pem" >/dev/null || die "the new certificate does not verify"
  install -m 644 "$tmp/cert.pem" "$SSL_DIR/cert.pem"
  cat "$tmp/cert.pem" "$CA_DIR/ca.crt" > "$tmp/fullchain.pem"
  install -m 644 "$tmp/fullchain.pem" "$SSL_DIR/fullchain.pem"
  install -m 600 "$tmp/privkey.pem" "$SSL_DIR/privkey.pem"
  renewed=1
else
  say "Server certificate is fine until $(openssl x509 -in "$SSL_DIR/cert.pem" -noout -enddate | cut -d= -f2)"
fi
printf '%s\n' "$HOST" > "$CONF_FILE"; chmod 644 "$CONF_FILE"

if [[ -n "${NO_INSTALL:-}" ]]; then say "NO_INSTALL set: skipped nginx and the timer"; exit 0; fi

# 3. nginx and the timer (setup only); the renewal just reloads nginx.
if [[ "$MODE" == setup ]]; then
  template="$SCRIPT_DIR/../deploy/nginx-https.conf"
  [[ -f "$template" ]] || die "missing $template"
  backup="$NGINX_SITE.before-https-$(date +%Y%m%d-%H%M%S)"
  [[ -f "$NGINX_SITE" ]] && cp -p "$NGINX_SITE" "$backup"
  sed -e "s/ROOMS_HOSTNAME/$HOST/g" "$template" > "$NGINX_SITE.new"
  grep -q "ssl_certificate .*$SSL_DIR/fullchain.pem" "$NGINX_SITE.new" || die "the nginx template does not use $SSL_DIR/fullchain.pem"
  chmod 644 "$NGINX_SITE.new"; mv "$NGINX_SITE.new" "$NGINX_SITE"
  if ! nginx -t 2>&1; then
    [[ -f "$backup" ]] && cp -p "$backup" "$NGINX_SITE"
    die "nginx -t failed; the old site file was put back"
  fi
  say "nginx site installed (old one: $backup)"

  install -m 755 "$0" "$RENEW_BIN"
  cat > /etc/systemd/system/room-display-cert-renew.service <<EOF
[Unit]
Description=Renew the room display's dashboard HTTPS certificate when it is due
[Service]
Type=oneshot
ExecStart=$RENEW_BIN
EOF
  cat > /etc/systemd/system/room-display-cert-renew.timer <<EOF
[Unit]
Description=Monthly check of the room display's dashboard HTTPS certificate
[Timer]
OnCalendar=monthly
RandomizedDelaySec=6h
Persistent=true
[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now room-display-cert-renew.timer >/dev/null
  say "Renewal timer on: $(systemctl show -p NextElapseUSecRealtime --value room-display-cert-renew.timer 2>/dev/null || true)"
  systemctl reload nginx
  say "nginx reloaded"
elif [[ -n "$renewed" ]]; then
  nginx -t >/dev/null 2>&1 && systemctl reload nginx && say "nginx reloaded with the new certificate"
fi

say "Done. Root certificate to install on the dashboard computers: $SSL_DIR/room-display-root-ca.crt"
say "Fingerprint: $(openssl x509 -in "$SSL_DIR/room-display-root-ca.crt" -noout -fingerprint -sha256 | cut -d= -f2)"
