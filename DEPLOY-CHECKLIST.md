# Deploy checklist (release 2.1.0 and later)

For updating the kiosk server from this repository. Real addresses, passwords, tenant and app IDs and email
addresses are deliberately not written here: use `USER@SERVER` below and take the values from the server's `.env`,
your password manager or the Entra and Teams admin centers.

Do it at a quiet time (early morning or after hours). A restart takes seconds, but every tablet reconnects at once.

## The easy way: run one script on the server itself

`scripts/deploy-on-server.sh` does sections 1 to 4 and 7 below by itself, on the server, so nobody needs to copy files from a laptop.
It downloads the new version from GitHub into a temporary folder, runs all the tests there with the server's own Node,
shows what will change, backs up the running app, copies the files (never `.env`, `config/rooms.json` or `node_modules`),
restarts the service only if server code changed, checks `/healthz` shows the new version, runs the smoke test, and puts the
old version back automatically if the restart or the smoke test fails.

The first time (the script is not on the server yet), log in to the server and run:

```bash
sudo apt install -y git rsync curl python3          # only if one of them is missing
curl -fsSL https://raw.githubusercontent.com/Orlando-Food-Sales/Conference-Room-Kiosks/main/scripts/deploy-on-server.sh -o ~/deploy-on-server.sh
bash ~/deploy-on-server.sh --dry-run                # shows what would change, changes nothing
bash ~/deploy-on-server.sh                          # asks to confirm, then deploys (asks for your sudo password once, for the restart)
```

After that first deploy the script lives in the app folder, so every later update is just:

```bash
/opt/m365-room-display/scripts/deploy-on-server.sh --dry-run
/opt/m365-room-display/scripts/deploy-on-server.sh
```

Options: `--ref v2.1.0` (a tag or branch instead of main), `--yes` (no question), `--restart` / `--no-restart`. `--help` lists the
settings. New settings still go into `.env` by hand (section 3); the script lists the ones your `.env` does not have yet.

From a laptop over ssh, add `-t` so the script has a terminal for its question and the sudo password:
`ssh -t user@server 'bash /opt/m365-room-display/scripts/deploy-on-server.sh'`. Without a terminal it stops before changing
anything unless you add `--yes`, and it also stops if a restart is needed and sudo would ask for a password (use `-t`, or
`--no-restart` and restart yourself). If the copy of the script you run is older than the one on GitHub, it prints a note
saying how to update it (for a git clone such as `~/kiosks`: `git -C ~/kiosks pull`). It also stops if the disk does not have
room for the backup and the copy (about twice the app folder plus 100 MB); old backups are in `~/deploy-backups`.
The Teams test alert (section 6) and looking at a tablet (section 5) are still yours to do afterwards.

The manual steps below are the same thing done from a laptop, and they are the fallback if the server cannot reach github.com.

## 0. Before you start

- [ ] `main` is what you want to deploy: `git log --oneline -1`, and `npm run check` passes on your computer.
- [ ] You have SSH access and `sudo` on the server, and can reach the Entra and Teams admin centers.
- [ ] The two people who get alerts know a chat from "Room Display Alerts" is coming (see section 6).
- [ ] In the Teams admin center the app is **Allowed**, and no policy blocks it for those two people.
- [ ] Node.js on the server is 22 or later: `ssh USER@SERVER node -v`. (Node 20 reached end of life on 30 April 2026.)

## 1. Back up the running copy

```bash
ssh USER@SERVER 'tar -czf ~/room-display-backup-$(date +%Y%m%d-%H%M).tar.gz -C /opt m365-room-display && ls -lh ~/room-display-backup-*.tar.gz | tail -1'
ssh USER@SERVER 'curl -s http://127.0.0.1:3000/healthz'     # note the version it reports now (none means 2.0.0 or older)
```

The backup includes `.env` and `config/rooms.json`. Keep it until the next deploy.

## 2. Copy the new files

From the repository folder on your computer. `.env`, `config/rooms.json` and `node_modules` are never touched.

```bash
rsync -rltc --executability --exclude .git --exclude .env --exclude config/rooms.json --exclude node_modules \
  --exclude .DS_Store --exclude .agents --exclude teams-app-build \
  ./ USER@SERVER:/opt/m365-room-display/
```

Add `-n` for a dry run that only lists what would change. Use `--executability` as written and never a bare `-E`: on a Mac `-E` means "send extended attributes", which makes rsync try to send a junk `._file` for every file and fail. (The checklist runs the scripts with `bash` anyway, so a missing executable bit never stops a deploy.)

## 3. Add the new settings to the server `.env`

Only add lines that are not there yet (`grep -c '^TEAMS_' /opt/m365-room-display/.env` prints 0 on a first deploy).
Secrets are copied on the server and never printed.

```bash
ssh USER@SERVER
cd /opt/m365-room-display
[ -n "$(tail -c1 .env)" ] && echo >> .env          # make sure the file ends with a new line
# The bot reuses the room display's own Entra app, so its ID, secret and tenant are the existing ones:
extra=$(sed -n -e 's/^CLIENT_ID=/TEAMS_BOT_APP_ID=/p' -e 's/^CLIENT_SECRET=/TEAMS_BOT_APP_SECRET=/p' -e 's/^TENANT_ID=/TEAMS_BOT_TENANT_ID=/p' .env)
printf '%s\n' "$extra" >> .env
nano .env     # then add these three lines by hand:
#   TEAMS_BOT_CATALOG_ID=<the App ID of "Room Display Alerts" in Teams admin center > Manage apps>
#   TEAMS_ALERT_EMAILS=<first sign-in name>,<second sign-in name>
#   CLIENT_SECRET_EXPIRES=<expiry date of CLIENT_SECRET, YYYY-MM-DD, from Entra > Certificates & secrets>
```

`WEATHER_ALERTS=true` (official weather warnings) is the default; add `WEATHER_ALERTS=false` only to turn them off.

Check the result without showing secrets:

```bash
grep -E '^(TEAMS_|CLIENT_SECRET_EXPIRES|WEATHER_)' .env | sed 's/\(SECRET=\).*/\1(hidden)/'
```

## 4. Check, restart, verify

```bash
ssh USER@SERVER 'cd /opt/m365-room-display && npm run check'          # all tests must pass on the server's Node
ssh -t USER@SERVER 'sudo systemctl restart m365-room-display && systemctl is-active m365-room-display'
ssh USER@SERVER 'cd /opt/m365-room-display && bash scripts/smoke-test.sh'   # must end with "Smoke test passed."
```

- [ ] The smoke test prints `Running version 2.1.0`. If it shows the old number, the service did not restart on the new code.
- [ ] `journalctl -u m365-room-display -n 30 --no-pager` shows no errors. (A bad setting stops the server with a clear message.)
- [ ] The dashboard (`http://SERVER/dashboard`, administrator token) shows the logo, `v2.1.0 · M365`, both rooms, each
      tablet online, and the line **Alerts go to: this dashboard · Teams (2 people)**.

## 5. Look at the tablets

- [ ] Reload one tablet (or press its refresh button) and check the logo, the status card and today's schedule.
- [ ] Wall tablets: change their address to end in `?kiosk=1` so visitors cannot tap refresh or message.
- [ ] Press **Reserve** on a room, then delete the test meeting in Outlook. The tablet should update within about 15 seconds.
- [ ] Back room: a real tablet is checking in (a Mac browser shows as "test browser, no alerts" and does not count).

## 6. Send the test alert

On the dashboard click **Send test alert**. It reports, per person, whether the message was delivered. The first message
installs the bot for that person, so a new chat from "Room Display Alerts" appears.

| Message | Meaning |
|---|---|
| could not sign in | wrong app ID, secret or tenant in `.env` |
| refused permission | the Graph permissions are missing or not consented |
| could not find the person | the address is not that person's sign-in name |
| not installed for this person | the Teams app is blocked, or `TEAMS_BOT_CATALOG_ID` is wrong |

## 7. If something is wrong: roll back

```bash
ssh -t USER@SERVER 'sudo systemctl stop m365-room-display && sudo tar -xzf ~/room-display-backup-YYYYMMDD-HHMM.tar.gz -C /opt && sudo systemctl start m365-room-display'
ssh USER@SERVER 'curl -s http://127.0.0.1:3000/healthz'
```

Use the file name from step 1. Restoring puts back the old code **and** the old `.env`, so the new Teams settings go too.
Files that did not exist before (for example the logo folder) are left in place, which is harmless.

## 8. Afterwards

- [ ] Put the secret's expiry date in your own calendar too. The server reminds at 30, 14, 7, 3 and 1 days, but a reminder
      that does not depend on the kiosk server is a safer backup.
- [ ] Set up an outside uptime check on `http://SERVER/healthz` if you have a monitor available.
- [ ] Watch the dashboard's device list for the first week: tablets that reload on their own (auto-heal) or drop offline.
- [ ] Rotate the server password if it was ever shared in chat, and move to an SSH key when convenient.
