# Installation manual — new Ubuntu server

## 1. Deployment target

This procedure installs the v2.0.0 known-good application in `/opt/m365-room-display`, runs it as the unprivileged `m365room` account, publishes it through Nginx, and manages it with systemd. The release includes the confirmed compatibility fix for browsers that do not implement `crypto.randomUUID()`.

Tested during packaging with Node.js 24.22.1. The application declares Node.js 20 or later, the CI matrix covers Node.js 20/22/24/26, and the installer pins the current Node.js 26.13.0 LTS release. The application uses no third-party runtime packages.

## 2. Before you begin

Prepare:

- A new Ubuntu Server 22.04 or 24.04 LTS host with a static/reserved IP.
- A sudo-capable administrator account and working DNS/NTP.
- Outbound HTTPS access to `login.microsoftonline.com`, `graph.microsoft.com`, and `nodejs.org`.
- The Microsoft 365 room mailbox addresses and IANA time zones (for example, `America/New_York`).
- A Microsoft Entra administrator who can grant application permissions.

If the service will be reachable outside a trusted LAN, deploy HTTPS before using production credentials.

## 3. Prepare Ubuntu

```bash
sudo apt-get update
sudo apt-get -y upgrade
sudo timedatectl set-timezone UTC
sudo apt-get install -y git curl ca-certificates
```

Confirm the server address:

```bash
hostname -I
```

## 4. Put the GitHub files on the server

After uploading this repository to GitHub:

```bash
cd /tmp
git clone https://github.com/YOUR-ORG/m365-room-display.git
cd m365-room-display
git checkout v2.0.0
```

If you use a release archive instead, extract it under `/tmp` and enter its repository directory.

## 5. Run the installer

```bash
sudo bash scripts/install-ubuntu.sh
```

The installer:

1. Installs Nginx and required operating-system utilities.
2. Uses an existing Node.js 20+ runtime or downloads the pinned Node.js 26.13.0 LTS official Linux binary and verifies its SHA-256 checksum.
3. Creates the non-login `m365room` service account.
4. Copies the application to `/opt/m365-room-display`.
5. Creates protected configuration files from the sanitized examples.
6. Generates a random 256-bit dashboard token.
7. Installs and validates Nginx and systemd configuration.
8. Runs syntax checks and tests.
9. Starts the application in demo mode.

Confirm both services:

```bash
sudo systemctl status m365-room-display --no-pager
sudo systemctl status nginx --no-pager
```

Both must show `active (running)`.

## 6. Validate the demo installation

```bash
curl -sS http://127.0.0.1:3000/healthz | python3 -m json.tool
sudo -u m365room /opt/m365-room-display/scripts/smoke-test.sh
```

The health response should report `"status": "ok"` and `"mode": "demo"`. From a LAN browser, open:

```text
http://SERVER-IP/room/front
http://SERVER-IP/dashboard
```

Do not continue until the demo page renders. This separates operating-system/reverse-proxy issues from Microsoft 365 configuration issues.

## 7. Create the Microsoft Entra application

In the Microsoft Entra admin center:

1. Open **Identity > Applications > App registrations > New registration**.
2. Name it `M365 Room Display` and select **Accounts in this organizational directory only**.
3. Record the **Directory (tenant) ID** and **Application (client) ID**.
4. Open **Certificates & secrets > Client secrets > New client secret**. Record the secret **Value** immediately; do not use the secret ID.
5. Open **API permissions > Add a permission > Microsoft Graph > Application permissions**.
6. For display-only rooms, add `Calendars.Read`.
7. If and only if quick booking is required, use `Calendars.ReadWrite` instead.
8. Select **Grant admin consent** and verify the permission shows granted.

The service uses the OAuth 2.0 client-credentials flow and requests the Microsoft Graph `.default` scope. Application permissions can be tenant-wide, so use Exchange Online Application RBAC to scope the app to only the intended room mailboxes. Validate that scope before production use.

## 8. Configure the rooms

Edit the protected room file:

```bash
sudoedit /opt/m365-room-display/config/rooms.json
```

Example:

```json
[
  {
    "id": "front",
    "name": "Front Conference Room",
    "email": "frontconference@example.com",
    "timeZone": "America/New_York",
    "allowQuickBooking": false
  }
]
```

Rules:

- `id` must contain lowercase letters, numbers, and hyphens only; it becomes `/room/<id>`.
- `email` must be the actual Exchange Online room mailbox.
- `timeZone` must be an IANA name.
- Keep `allowQuickBooking` false unless `Calendars.ReadWrite` was granted and booking is required.

Validate the JSON:

```bash
python3 -m json.tool /opt/m365-room-display/config/rooms.json >/dev/null \
  && echo "ROOM CONFIG JSON OK"
```

Protect it:

```bash
sudo chown m365room:m365room /opt/m365-room-display/config/rooms.json
sudo chmod 600 /opt/m365-room-display/config/rooms.json
```

## 9. Configure production credentials

Edit the environment file without displaying it in terminal history:

```bash
sudoedit /opt/m365-room-display/.env
```

Set:

```ini
DEMO_MODE=false
PORT=3000
TENANT_ID=YOUR-DIRECTORY-TENANT-ID
CLIENT_ID=YOUR-APPLICATION-CLIENT-ID
CLIENT_SECRET=YOUR-CLIENT-SECRET-VALUE
ROOMS_FILE=./config/rooms.json
EVENT_REFRESH_SECONDS=60
TABLET_OFFLINE_SECONDS=120
ADMIN_TOKEN=KEEP-THE-RANDOM-INSTALLER-GENERATED-VALUE
PUBLIC_BASE_URL=
```

Then:

```bash
sudo chown m365room:m365room /opt/m365-room-display/.env
sudo chmod 600 /opt/m365-room-display/.env
sudo grep -E '^(DEMO_MODE|PORT|ROOMS_FILE|EVENT_REFRESH_SECONDS|TABLET_OFFLINE_SECONDS)=' /opt/m365-room-display/.env
```

Never print or commit `CLIENT_SECRET` or `ADMIN_TOKEN`.

## 10. Validate and start Microsoft 365 mode

```bash
cd /opt/m365-room-display
sudo -u m365room npm run check
sudo systemctl restart m365-room-display
sleep 3
sudo systemctl status m365-room-display --no-pager
```

Check health and rooms:

```bash
curl -sS http://127.0.0.1:3000/healthz | python3 -m json.tool
curl -sS http://127.0.0.1:3000/api/rooms | python3 -m json.tool
```

Health should now report `"mode": "m365"`.

Test every room ID individually:

```bash
curl -sS "http://127.0.0.1:3000/api/events?room=front" | python3 -m json.tool
```

A response containing an `events` array (including an empty array) means the calendar request succeeded. An error saying a user is invalid usually means the mailbox address in `rooms.json` is wrong.

Run the complete smoke test through Node and Nginx:

```bash
sudo -u m365room /opt/m365-room-display/scripts/smoke-test.sh
sudo -u m365room env BASE_URL=http://127.0.0.1 /opt/m365-room-display/scripts/smoke-test.sh
```

## 11. Configure firewall and tablet URLs

If UFW is enabled:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

Assign each tablet its permanent URL:

```text
http://SERVER-IP/room/front
http://SERVER-IP/room/back
```

Use a current Chrome/Edge/WebView and kiosk mode as appropriate. The compatibility fallback in `public/app.js` prevents the confirmed black-screen failure on browsers without `crypto.randomUUID()`.

## 12. Dashboard access

Open:

```text
http://SERVER-IP/dashboard
```

Retrieve the administrator token locally without copying it into chat, logs, URLs, or Git:

```bash
sudo grep '^ADMIN_TOKEN=' /opt/m365-room-display/.env
```

Enter it in the dashboard. The browser keeps it in session storage only. Rotate it with:

```bash
NEW_TOKEN=$(openssl rand -hex 32)
sudo sed -i "s/^ADMIN_TOKEN=.*/ADMIN_TOKEN=$NEW_TOKEN/" /opt/m365-room-display/.env
unset NEW_TOKEN
sudo systemctl restart m365-room-display
```

## 13. HTTPS (recommended)

Keep the application on loopback port 3000 and terminate TLS at Nginx. Use your organization's certificate process or Certbot when the host has public DNS. After enabling HTTPS:

- Redirect HTTP to HTTPS.
- Set `PUBLIC_BASE_URL=https://rooms.example.com` if Graph webhooks are implemented.
- Re-run the smoke test against the HTTPS URL.
- Do not expose port 3000 through the firewall.

## 14. Backup the known-good installation

After production validation:

```bash
sudo /opt/m365-room-display/scripts/backup.sh
```

The backup includes `.env`, so the script stores it under `/var/backups/m365-room-display`, owned by root with mode 700 on the directory and 600 on files. Copy it only to an approved encrypted backup destination.

## 15. Update and rollback

Before an update:

```bash
sudo /opt/m365-room-display/scripts/backup.sh
```

Update from a reviewed tag, preserving `.env` and `config/rooms.json`:

```bash
cd /tmp/m365-room-display
git fetch --tags
git checkout NEW-REVIEWED-TAG
sudo systemctl stop m365-room-display
sudo tar --exclude=.git --exclude=.env --exclude=config/rooms.json -C . -cf - . \
  | sudo tar -C /opt/m365-room-display -xf -
sudo chown -R m365room:m365room /opt/m365-room-display
sudo -u m365room bash -lc 'cd /opt/m365-room-display && npm run check'
sudo systemctl start m365-room-display
sudo -u m365room /opt/m365-room-display/scripts/smoke-test.sh
```

To roll back, stop the service, extract the selected verified archive, restore its matching systemd and Nginx files, run `systemctl daemon-reload`, validate Nginx, and restart both services.

## 16. Troubleshooting

### Service does not start

```bash
sudo journalctl -u m365-room-display -n 100 --no-pager
sudo ss -ltnp | grep ':3000' || true
```

### Tablet shows a blank/black page

```bash
curl -sS -o /dev/null -w 'app.js HTTP %{http_code} %{content_type}\n' http://127.0.0.1/app.js
curl -sS -o /dev/null -w 'styles.css HTTP %{http_code} %{content_type}\n' http://127.0.0.1/styles.css
node --check /opt/m365-room-display/public/app.js
```

Use GET tests as shown, then clear the tablet browser cache. This release includes the `crypto.randomUUID()` fallback that fixed the known black-screen issue.

### Calendar is temporarily unavailable

```bash
sudo journalctl -u m365-room-display -n 50 --no-pager
```

Check the room mailbox address, tenant/client IDs, secret expiration, granted application permission, admin consent, and Exchange Application RBAC scope.

### Nginx returns an error

```bash
sudo nginx -t
sudo systemctl status nginx --no-pager
curl -sS http://127.0.0.1:3000/healthz
curl -sS http://127.0.0.1/healthz
```

## 17. GitHub publication checklist

Before pushing:

```bash
npm ci
npm run check
git status --short --ignored
```

Confirm that `.env`, `config/rooms.json`, backup archives, secrets, tenant IDs, and production mailbox addresses are not staged. Then:

```bash
git init
git add .
git commit -m "Release M365 Room Display v2.0.0 known-good baseline"
git branch -M main
git remote add origin https://github.com/YOUR-ORG/m365-room-display.git
git push -u origin main
git tag -a v2.0.0 -m "Known-good v2 baseline"
git push origin v2.0.0
```

## 18. Official references

- Microsoft identity platform OAuth 2.0 client-credentials flow: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow
- Microsoft Graph calendar view: https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview?view=graph-rest-1.0
- Microsoft Graph create event: https://learn.microsoft.com/en-us/graph/api/user-post-events?view=graph-rest-1.0
- Microsoft Graph permissions reference: https://learn.microsoft.com/en-us/graph/permissions-reference
- Exchange Online Application RBAC: https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac
- Ubuntu Nginx installation: https://ubuntu.com/server/docs/how-to/web-services/install-nginx/
- Node.js releases: https://nodejs.org/en/about/previous-releases
