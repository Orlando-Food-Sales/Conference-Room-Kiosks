# Installation manual — new Ubuntu server

## 1. Deployment target

This procedure installs the v2.0.0 known-good application in `/opt/m365-room-display`, runs it as the unprivileged `m365room` account, publishes it through Nginx, and manages it with systemd. The release includes the confirmed compatibility fix for browsers that do not implement `crypto.randomUUID()`.

The application needs Node.js 22 or later (Node.js 20 reached end of life on 30 April 2026 and no longer gets security fixes). The automatic tests pass on Node.js 22, 24 and 26, and the installer pins Node.js 26.13.0 (LTS). The application uses no third-party runtime packages: it imports only Node's own modules, so there is nothing to `npm install` and no package vulnerabilities to patch, only Node.js, Ubuntu and Nginx updates. Check `node -v` after any server update and when Node.js 22 leaves maintenance (30 April 2027).

## 2. Before you begin

Prepare:

- A new Ubuntu Server 22.04 or 24.04 LTS host with a static/reserved IP.
- A sudo-capable administrator account and working DNS/NTP.
- Outbound HTTPS access to `login.microsoftonline.com`, `graph.microsoft.com`, `api.weather.gov` and `api.open-meteo.com` (display weather; optional), and `nodejs.org`.
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
2. Uses an existing Node.js 22+ runtime or downloads the pinned Node.js 26.13.0 LTS official Linux binary and verifies its SHA-256 checksum.
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
- `showCelebrations` (optional, default true) controls birthdays and anniversaries on that room's display; set it to `false` for client-facing rooms.

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
WEATHER_LATITUDE=40.9595
WEATHER_LONGITUDE=-74.1252
BIRTHDAY_CALENDAR_MAILBOX=
OFFICE_HOURS_START=08:00
OFFICE_HOURS_END=17:00
OFFICE_DAYS=1-5
CHANGE_CHECK_SECONDS=15
ALERT_AFTER_MINUTES=10
ALERT_WEBHOOK_URL=
```

Tablet offline alerts: a tablet that has not checked in for `ALERT_AFTER_MINUTES` during office hours (and not on a company holiday) is listed under "Recent alerts" on the dashboard and written to the service log (`journalctl -u m365-room-display | grep ALERT`). To also get them in a chat tool, create an incoming webhook there and put its https address in `ALERT_WEBHOOK_URL`; the server posts `{"text": "..."}`. Teams workflow webhooks may need a different message shape; if nothing arrives, check the log for "Alert webhook" lines.

`CHANGE_CHECK_SECONDS` is how often the server looks at each room calendar to spot changes (5 to 3600, 0 turns it off). Tablets are updated right away when something changes, so no public web address or Microsoft webhook is needed. With 2 rooms and the default this is about 8 extra Microsoft Graph requests a minute.

Office hours use each room's `timeZone`. Outside them (and on days not in `OFFICE_DAYS`, where 0 is Sunday) the display shows "Closed" instead of "Available". A meeting still in progress shows "In use". Set `OFFICE_HOURS=off` to always show availability.

Weather comes from the US National Weather Service (real readings from the nearest airport station) with Open-Meteo as the backup; set `WEATHER_SOURCE=open-meteo` to use only the backup. Weather uses one location for all rooms (the defaults are Glen Rock, NJ; set `WEATHER_ENABLED=false` to turn it off). The other optional settings are listed in `.env.example`.

Birthdays and work anniversaries come from a shared Microsoft 365 mailbox. Set `BIRTHDAY_CALENDAR_MAILBOX` to its address; leave it empty to turn the feature off. The app registration needs `Calendars.Read` for that mailbox as well (include it in the Application RBAC scope). Only event titles containing "birthday", "b'day" or "anniversary" are shown, so PTO and holiday events in the same mailbox are ignored. Use `BIRTHDAY_CALENDAR_NAME` to read only calendars whose name contains some text.

The same mailbox also marks company holidays. Create an all-day event whose title starts with "Holiday" (for example "Holiday - Christmas", or "Holiday-Thanksgiving" spanning two days). On those days every display shows "Closed" with the holiday name and hides booking. If `BIRTHDAY_CALENDAR_NAME` is set, the holiday events must be in a calendar that matches it.

Then:

```bash
sudo chown m365room:m365room /opt/m365-room-display/.env
sudo chmod 600 /opt/m365-room-display/.env
sudo grep -E '^(DEMO_MODE|PORT|ROOMS_FILE|EVENT_REFRESH_SECONDS|TABLET_OFFLINE_SECONDS)=' /opt/m365-room-display/.env
```

Never print or commit `CLIENT_SECRET` or `ADMIN_TOKEN`.

Client secrets expire (the Entra portal shows the date under **Certificates & secrets**). Write that date into `.env` as `CLIENT_SECRET_EXPIRES=YYYY-MM-DD` and the server sends an alert (dashboard, Teams and webhook, whichever are set up) at 30, 14, 7, 3 and 1 days before it expires and once more when it has. The app cannot read the date from Microsoft itself, so update it whenever you replace the secret. To replace a secret without a gap: create the new secret in Entra first, put its value in `CLIENT_SECRET` (and `TEAMS_BOT_APP_SECRET` if the bot uses the same app), set the new `CLIENT_SECRET_EXPIRES`, restart the service, check the dashboard, then delete the old secret.

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

For wall tablets, add `?kiosk=1` to the address (for example `http://SERVER-IP/room/front?kiosk=1`). That hides the refresh and message buttons so visitors cannot tap them; booking buttons are controlled separately by `allowQuickBooking`. The page also heals itself: the server pings every 25 seconds, a tablet whose live connection goes quiet reconnects within about a minute and a half, and after 5 minutes it reloads the page (only if the server answers, at most every 10 minutes). Use a current Chrome/Edge/WebView and kiosk mode as appropriate. The compatibility fallback in `public/app.js` prevents the confirmed black-screen failure on browsers without `crypto.randomUUID()`.

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

## 12b. Teams alerts from a named bot (optional)
Alerts (a tablet offline, a room calendar that cannot be read) can arrive as a Teams message from a bot with its own name, for example **Room Display Alerts**, sent to specific people. It is one-way: nobody can reply to it and it cannot read anyone's chats. Without this, alerts still appear on the dashboard and, if `ALERT_WEBHOOK_URL` is set, in a chat channel.

You need three kinds of access, which may be different people: someone who can create an **Azure Bot** resource, a **Microsoft Entra administrator** who can grant admin consent, and a **Teams administrator** who can upload an app. Microsoft changes these portals often, so names below may differ slightly.

1. **Choose the bot's Entra app.** Either reuse the room display's own app (single tenant; simplest, one secret to rotate, and `TEAMS_BOT_APP_SECRET` is the same value as `CLIENT_SECRET`), or create a separate one for tighter separation: **App registrations > New registration**, name it `Room Display Alerts`, choose **Accounts in this organizational directory only**, and create a client secret under **Certificates & secrets**. Record the **Application (client) ID** and **Directory (tenant) ID**. With a reused app, a leaked secret exposes both calendar and Teams access, so a separate app is safer if that matters to you.
2. **Create the Azure Bot.** In the Azure portal create an **Azure Bot** resource. Choose **Single Tenant** and **Use existing app registration**, and give the Application ID and tenant ID from step 1. Messaging endpoint: the bot never receives anything, but if the portal asks for one, any `https://` address works. Then open **Channels** and add **Microsoft Teams**. With the Azure CLI (signed in as an administrator) this is: `az provider register -n Microsoft.BotService`, `az group create -n rg-room-display -l eastus`, `az bot create -g rg-room-display -n YOUR-BOT-NAME --appid BOT-APP-ID --app-type SingleTenant --tenant-id TENANT-ID --sku F0 --endpoint https://example.com/api/messages`, then `az bot msteams create -g rg-room-display -n YOUR-BOT-NAME`.
3. **Let the bot find its own chat with each person.** On the app registration open **API permissions > Add a permission > Microsoft Graph > Application permissions** and add `TeamsAppInstallation.ReadWriteSelfForUser.All`, then **Grant admin consent**. (Only if you want the server to install the app for people itself and look it up in your catalog, also add `AppCatalog.Read.All`. Otherwise skip it and let each person add the app in step 5.)
4. **Build and upload the Teams app.** On a computer with this repository:
   ```bash
   scripts/build-teams-app.sh BOT-APP-ID https://your-company-website "Your Company Name"
   ```
   This writes `teams-app-build/room-display-alerts.zip`. In the **Teams admin center > Teams apps > Manage apps > Upload new app**, upload it. Open the uploaded app in Manage apps and note its **App ID**: it is different from the bot's application ID and is your `TEAMS_BOT_CATALOG_ID` (step 6). If the upload is blocked, a Teams administrator must allow custom apps for the organisation (**Teams apps > Setup policies / Org-wide app settings**).
5. **Add the app for each person.** Either each person opens Teams > **Apps > Built for your org > Room Display Alerts > Add**, or (with `AppCatalog.Read.All` from step 3) the server installs it the first time it sends.
6. **Configure the server.** In `/opt/m365-room-display/.env` set:
   ```ini
   TEAMS_BOT_APP_ID=APPLICATION-CLIENT-ID
   TEAMS_BOT_APP_SECRET=CLIENT-SECRET-VALUE
   TEAMS_BOT_TENANT_ID=DIRECTORY-TENANT-ID
   TEAMS_BOT_CATALOG_ID=APP-ID-FROM-TEAMS-ADMIN-CENTER
   TEAMS_ALERT_EMAILS=first.person@yourcompany.com,second.person@yourcompany.com
   ```
   Use each person's sign-in name (their user principal name, usually their email address). Then `sudo systemctl restart m365-room-display`.
7. **Test it.** Open the dashboard and click **Send test alert**. It reports, per person, whether the message was delivered and, if not, why.

Notes:
- The sender name and icon come from the app you uploaded in step 4. To rename the bot, change `name` in `deploy/teams-app/manifest.template.json`, raise `version`, rebuild and upload again.
- If a person blocks or removes the app, the dashboard test shows that; the other people still get the message.
- The Azure Bot, the app registration and the admin consent do not need the kiosk server to be reachable from the internet. It only makes outbound HTTPS calls to `login.microsoftonline.com`, `graph.microsoft.com` and `smba.trafficmanager.net`.
- Common test messages: "could not sign in" means a wrong app ID, secret or tenant; "refused permission" means step 3 is missing or not consented; "could not find the person" usually means the address is not that person's sign-in name; "not installed for this person" means step 5 is not done for them.

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
