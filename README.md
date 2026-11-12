# Microsoft 365 Room Display

Multi-room meeting-room display for tablets, with a control dashboard. It reads room calendars
from Microsoft 365 (Microsoft Graph), or runs in demo mode with sample meetings. No runtime
dependencies; Node.js 22 or later.

## What it shows

- Room status (Available / In use), clock, and today's schedule with NOW and NEXT badges.
- "Free until 2:30 PM" on the status card. For rooms with `allowQuickBooking`, one-tap 15, 30 and 60 minute buttons (only those that fit before the next meeting) plus a "Reserve now" form.
- Office hours (default 8:00 AM to 5:00 PM, Monday to Friday, in the room's time zone): outside them the display says "Closed" instead of "Available" and hides booking. A meeting still in progress shows "In use". During the day, "Free until" stops at closing time and booking buttons never run past it.
- Company holidays from the same shared calendar as birthdays: an all-day event titled "Holiday - Christmas" (anything starting with "Holiday") shows "Closed" with the holiday name and hides all booking that day; the server refuses bookings on those days as well. A bare "HOLIDAY" takes its name from the public holidays calendar. Public holidays alone (Veterans Day and so on) do not close the office.
- Calendar changes (new, moved or cancelled meetings, even made in Outlook) reach the tablets within about 15 seconds: the server checks each room's calendar itself and pushes changes over the live connection. `CHANGE_CHECK_SECONDS` sets the interval, 0 turns it off.
- "Closed tomorrow: Thanksgiving" heads-up on the day before a company holiday (it looks past weekends: on Friday it can say "Closed Monday: ...").
- Tablet offline alerts: if a wall tablet stops checking in during office hours for `ALERT_AFTER_MINUTES` (default 10), the dashboard lists an alert and, when `ALERT_WEBHOOK_URL` is set, the same text is posted there as `{"text": "..."}`. A "back online" message follows. Alerts can also go to named people in Teams from a bot with its own name (`TEAMS_BOT_*`, `TEAMS_ALERT_EMAILS`; setup in `INSTALL-UBUNTU.md`, section 12b), and the dashboard has a "Send test alert" button. A room calendar that cannot be read for 10 minutes also raises an alert. Only wall tablets alert: a phone or tablet browser, a touch screen, or a page opened with `?kiosk=1`. A desktop browser (a Mac or PC someone opened a room page on to test or look) is listed on the dashboard as "test browser, no alerts" and never alerts or counts as the room's tablet.
- Self-healing: the server pings each tablet every 25 seconds. A tablet whose live connection goes quiet reconnects, and after 5 minutes reloads itself (only when the server answers, at most every 10 minutes).
- Kiosk mode: add `?kiosk=1` to a room URL to hide the refresh and message buttons on wall tablets.
- Each tablet reloads itself once a night (3:30 to 3:50 in the room's time zone) so it starts fresh.
- Orlando Foods look: dark by default (`?theme=light` or `?theme=auto` to change), with a background
  mood that follows the weather (clear, clouds, rain, storm, snow, ice, fog). Freezing rain and sleet count as ice.
- Orlando Foods logo in the middle of the top bar (white version on the dark theme, colour version on the light theme; hidden on narrow portrait screens). Files are in `public/logo/`, full-size originals in `assets/logo/`. The browser tab icon and home-screen icon are the white "O" of the logo on the brand burgundy.
- Official weather warnings (US): Winter Storm Warning, Flood Watch, Heat Advisory and the like, from the National Weather Service for your location, appear as a banner on every tablet (red for warnings, amber for watches and advisories) and disappear when they end. Each Severe or Extreme warning is also sent once to the alert list (Teams and webhook). Turn off with `WEATHER_ALERTS=false`.
- Snoopy, a 2D sprite companion that reacts to the room: resting, waiting before a meeting,
  thinking during one, plus waves, jumps, walks and look-around. Tap the screen and he looks at it.
- Snoopy outfits: a party hat on birthday and work anniversary days, festive outfits by date (Christmas, New Year, Valentine's Day, St. Patrick's Day, Easter, July 4th, Halloween, Veterans Day, Thanksgiving), pajamas (see sleeping, next) when the display says Closed, then weather and feels-like temperature (storm raincoat, raincoat, winter coat, Hawaiian shirt), and a chef hat on otherwise plain Fridays. Rules and limits live in `public/snoopy/outfits.json`; see `public/snoopy/outfits/README.md`.
- Sleeping Snoopy: while the display says Closed he sleeps on his red doghouse with floating Zs. A tap wakes him (stir, yawn, stretch, sit up, sleepy wave) for 15 seconds, with a shrug, a thoughtful chin-rub, a glance or a look-around along the way, then he settles back to sleep. On Closed days he also stirs by himself every few minutes. Details and file list in `public/snoopy/README.md`.
- Birthdays and work anniversaries from a shared Microsoft 365 calendar, shown on the status card. On a working day the line also covers the closed days that follow (a Saturday birthday shows on Friday as "Mabel (Saturday)").
- Dashboard at `/dashboard` (needs `ADMIN_TOKEN`): room overview, tablet status, messages, display on/off, alerts with a test-alert button, the running version and the current weather. It has the same Orlando Foods look as the displays.

## Run it

```bash
DEMO_MODE=true npm start     # http://localhost:3000/room/room
npm run check                # syntax check and tests (npm test runs only the 167 offline tests, about 8 seconds)
```

Production setup (Ubuntu, Nginx, systemd, Entra app): see `INSTALL-UBUNTU.md`. Updating a running server: run `scripts/deploy-on-server.sh` on the server (it pulls from GitHub, tests, backs up, copies, restarts only if needed, checks, and rolls back by itself if a check fails); the step-by-step version and the first-time setup are in `DEPLOY-CHECKLIST.md`.
Copy `.env.example` to `.env` and `config/rooms.example.json` to `config/rooms.json`.

## Settings

All settings are environment variables; see `.env.example`.

- Microsoft 365: `TENANT_ID`, `CLIENT_ID`, `CLIENT_SECRET`, `CLIENT_SECRET_EXPIRES` (YYYY-MM-DD; reminders at 30, 14, 7, 3 and 1 days and on expiry), `ROOMS_FILE`
- Refresh and tablets: `EVENT_REFRESH_SECONDS`, `TABLET_OFFLINE_SECONDS`, `CHANGE_CHECK_SECONDS`
- Alerts: `ALERT_AFTER_MINUTES`, `ALERT_WEBHOOK_URL`, and for Teams `TEAMS_BOT_APP_ID`, `TEAMS_BOT_APP_SECRET`, `TEAMS_BOT_TENANT_ID`, `TEAMS_BOT_CATALOG_ID` (the app's ID in the Teams admin center), `TEAMS_ALERT_EMAILS`, and rarely `TEAMS_BOT_SERVICE_URL`
- Office hours: `OFFICE_HOURS_START`, `OFFICE_HOURS_END`, `OFFICE_DAYS`, or `OFFICE_HOURS=off`
- Weather: `WEATHER_ENABLED`, `WEATHER_LATITUDE`, `WEATHER_LONGITUDE` (one location for all rooms), `WEATHER_SOURCE` (auto, nws, open-meteo), `WEATHER_CONTACT`, `WEATHER_ALERTS` (official warnings, default on)
- Birthdays: `BIRTHDAY_CALENDAR_MAILBOX`, `BIRTHDAY_CALENDAR_NAME`, `BIRTHDAY_CALENDAR_ID`,
  `BIRTHDAY_NAME_STYLE`, `BIRTHDAY_TIME_ZONE`. Only titles containing "birthday", "b'day" or
  "anniversary" are used; PTO and holidays on the same calendar are ignored. A yearly anniversary can carry the start
  year instead of a count, "Jodi Andrade - Work Anniversary (since 2025)", and the display works out the years
  ("Happy 1-year work anniversary, Jodi!" in 2026, 2-year in 2027).
- Per room, in `rooms.json`: `allowQuickBooking`, and `showCelebrations` (set `false` for
  client-facing rooms).

## Preview and testing URLs

`/preview.html` shows every theme, weather (including ice), room state, screen size (including the Samsung Galaxy Tab A7 Lite, landscape and portrait), Snoopy animation, outfit, celebration, Easter date, weather warning (one or several), kiosk mode and the logo. It is a review tool; remove or block it on public kiosks if you prefer.

Query options on a room URL: `theme`, `weather`, `warning` (a banner such as `Winter Storm Warning`, `Flood Watch|watch` for amber, several separated by `;`, or `none`), `preview` (free, soon, busy, ended, error),
`kiosk=1` (hide the refresh and message buttons), `snoopy` (animation name), `outfit`, `celebrate` (birthday, anniversary, both, weekend), `quickbook=1` (show the booking buttons), `hours` (open or closed), `holiday` (a name, or none), `closedsoon` (a name, or none), `temp` (feels-like Celsius), `day` (1 or 0), `date` (MM-DD or YYYY-MM-DD, pretend today), `nostream=1`.

## Security

No secrets, tenant IDs, room mailboxes or backups belong in this repository. See `SECURITY.md`.
