# Changelog

## 2.1.0 — 2026-11-11

- Logo fix for the Samsung Galaxy Tab A7 Lite: the "hide on short screens" rule also hid the logo on the real tablet (about 893x500 CSS pixels at 1.5x), so it never showed there; it now shows, a little smaller on short landscape screens, and is hidden only on narrow portrait ones. The logo is also made in five pre-scaled sizes (200 to 800 px wide, resampled with Lanczos, edges slightly sharpened) and the pages use `srcset`, so the tablet picks the closest size instead of shrinking a large image, which looked soft. The preview page has "as the tablet sees it" sizes (893x500 and 500x893) and a note that its scaled-to-fit view looks softer than the real screen.
- Browser tab icon (`favicon.ico`, 16/32/48 px) and home-screen icon (`apple-touch-icon.png`, 180 px): the "O" of the Orlando logo, white on the brand burgundy, linked from the display, dashboard and preview pages. The server serves `.ico` files with the right type (they used to be a 404).
- `DEPLOY-CHECKLIST.md`: the update of a running server written as a checklist, with the exact commands, what each check should show, the Teams test messages and how to roll back. It holds no addresses, passwords or IDs.
- `/healthz` now reports the running `version` (and so does the dashboard status line, "v2.1.0 · M365 · Updated ..."), so after a deploy you can see which release the server is on. The project version is now 2.1.0.
- The dashboard is now called "Room Display Control" (page heading and browser tab), with "CONFERENCE ROOMS" above it, instead of "Operations dashboard".
- The dashboard has the Orlando Foods look: the logo, the same colours as the room displays, outlined secondary buttons, tap-sized buttons, keyboard focus outlines and a phone layout.
- `scripts/smoke-test.sh` now also checks the version, the logo files, the dashboard and preview files, and that `/api/weather` includes the official warnings list (it prints the current weather and any active warnings).
- Orlando Foods theme, dark by default; `?theme=light|auto`. Background mood follows the weather
  (`/api/weather`, cached 10 minutes, source described below; `WEATHER_*` settings; default location Glen Rock, NJ).
- Schedule rows rebuilt as single-line rows with NOW and NEXT badges; page markup and stylesheet
  brought back in line.
- Snoopy sprite companion (`public/snoopy.js`) reacting to the room calendar, with outfits chosen by
  date and weather (`public/snoopy/outfits.json`).
- Birthdays and work anniversaries from a shared Microsoft 365 mailbox (`/api/celebrations`,
  `BIRTHDAY_*` settings, per-room `showCelebrations`).
- Preview page (`/preview.html`) and preview query options. Framing is now allowed from the same
  origin only (`x-frame-options: SAMEORIGIN`) so the preview can embed the display.
- Refresh (↻) and message (✉) buttons on the room screen; the message panel uses the admin token. The dashboard shows each room's display link and an optional live view.
- "Free until 2:30 PM" on the status card and one-tap 15/30/60 minute booking buttons (only for rooms with quick booking, and only durations that fit before the next meeting).
- Quiet nightly reload of each tablet (3:30 to 3:50 in the room's time zone, spread by tablet) so tablets left on for weeks start fresh.
- Fixed Display off: the screen is now plain black (it used to stay visible, squeezed). The dashboard shows "Display OFF" on the room card and live view. Scripts, styles and JSON are re-checked by browsers on every load (`no-cache`), and PNG/JSON are served with the right content types.
- Office hours: the display shows "Closed" outside them (default 8:00 to 17:00, Monday to Friday, room time zone; `OFFICE_HOURS_*` settings). "Free until" and the booking buttons stop at closing time.
- Company holidays: an all-day event whose title starts with "Holiday" (for example "Holiday - Christmas") on the shared calendar makes the display say "Closed" with the holiday name and hides booking for that day. Public holidays such as Veterans Day do not close the office.
- Fits the Samsung Galaxy Tab A7 Lite (8.7in, 1340x800) and other tablets: the page always fits the screen height with no scrolling, rows that do not fit are hidden, short screens get tighter spacing, and portrait no longer lets the time run into the meeting title.
- "Today's schedule" lists only today's meetings. A meeting tomorrow morning no longer shows up looking like an old one; when nothing is left it says "No more meetings today. Next: tomorrow at 9:00 AM."
- Weekend and holiday birthdays: on a working day the birthday line also covers the closed days that follow, for example "Happy birthday, Mabel (Saturday)!" on Friday. Company holidays count as closed days.
- Bookings on a company holiday are refused by the server too (409 "The office is closed for Thanksgiving"), not just hidden on the tablet. If the holiday calendar cannot be read, booking is allowed.
- Faster updates: the server checks each room calendar every 15 seconds (`CHANGE_CHECK_SECONDS`) and pushes any change to the tablets immediately, instead of waiting up to a minute. One fetch is shared by all tablets for a few seconds. No public web address is needed. `/api/notifications` now ignores notifications that do not carry `GRAPH_CLIENT_STATE` when it is set.
- "Closed tomorrow" heads-up on the status card when the next working day is a company holiday ("Closed tomorrow through Friday: Thanksgiving", "Closed Monday: ...").
- Tablet offline alerts: a tablet that stops checking in for 10 minutes during office hours (`ALERT_AFTER_MINUTES`) raises an alert on the dashboard and, if `ALERT_WEBHOOK_URL` is set, posts it there; a "back online" message follows. Also alerts when a room has had no tablet since the server started. Tablets unseen for a week are forgotten.
- Tablets report their screen size and zoom with each check-in; the dashboard lists every device per room (model, screen size, address, online or not), to explain why two displays look different.
- More accurate weather: inside the US the server reads real station observations from the National Weather Service (nearest of Teterboro, Caldwell, Newark for Glen Rock), with Open-Meteo as the backup and outside the US (`WEATHER_SOURCE`). Conditions use what is actually falling (rain, snow, thunder, fog, cloud cover), feels-like temperature includes wind chill and heat index, day or night comes from the sun's position, and weather older than 3 hours is dropped. The dashboard shows the current reading and its source.
- Snoopy's outfits now use feels-like temperature: winter coat when it snows or feels 4 C (39 F) or colder, Hawaiian shirt only when sunny, daytime and 18 C (64 F) or warmer, raincoat for rain or storms. Limits are in `public/snoopy/outfits.json`.
- New outfits: party hat (birthday or work anniversary, beats everything), pajamas (when the display says Closed), and Valentine's Day (Feb 10 to 14). The seven earlier outfits now use the 11-row sheets, so Snoopy can look around in them too. Preview with `?date=MM-DD`.
- More outfits: St. Patrick's Day, Easter, July 4th, a storm raincoat with umbrella for thunderstorms, and a chef hat and apron for Fridays (lowest priority, so weather and festive outfits win). Pajamas and party hat now use the 11-row sheets. Date rules accept an optional `year`, and `weekdays`.
- Alerts to named people in Teams from a notification-only bot (for example "Room Display Alerts"): set `TEAMS_BOT_*` and `TEAMS_ALERT_EMAILS`. The server finds or installs the bot's Teams app for each person through Microsoft Graph and posts into their own chat. New alert when a room calendar cannot be read for 10 minutes. The dashboard has a "Send test alert" button that reports delivery per person. `scripts/build-teams-app.sh` builds the Teams app package; `deploy/teams-app/` holds its manifest template and icons. The bot can reuse the room display's own Entra app (add `TeamsAppInstallation.ReadWriteSelfForUser.All` and `AppCatalog.Read.All`, with admin consent). After the zip is uploaded, Teams gives the app its own ID; set it as `TEAMS_BOT_CATALOG_ID`.
- Easter is worked out for any year instead of listed: one rule, `"easter": { "before": 7, "after": 0 }`, replaces the four yearly entries (2027 to 2030), so it never runs out. Tested against 24 published Easter dates and every year from 1900 to 2200.
- Orlando Foods logo on the display and the room picker: white on the dark theme, colour on the light theme (the colour logo's dark lettering would vanish on dark), hidden on narrow or very short screens. Web copies in `public/logo/` are trimmed and 800 px wide (under 60 KB each); the 3508x2482 originals are kept in `assets/logo/` and are not served.
- Preview page brought up to date: ice weather, weather warnings (red, amber, and three at once), kiosk mode, the Samsung Galaxy Tab A7 Lite sizes (1340x800 landscape, 800x1340 portrait) and a short screen, computed-Easter examples (2031, 2038, the Monday after Easter), and the warning, kiosk and size settings in the caption. New tests make sure every control is wired to the display and every example is valid.
- Official weather warnings: the server asks the National Weather Service for active warnings at your location (every 5 minutes, US only, `WEATHER_ALERTS`). Tablets show a banner on the status card (red for Severe and Extreme such as Winter Storm Warning, amber for Moderate such as Flood Watch or Heat Advisory) until the warning ends; Minor ones such as Frost Advisory are ignored. Each Severe or Extreme warning is also sent once to the alert list (dashboard, Teams, webhook), and again only if a new one is issued. If the Weather Service cannot be reached the last warnings stay for up to 30 minutes, but never past their end time. Preview with `?warning=Winter Storm Warning` or `?warning=Flood Watch|watch`.
- New `ice` weather for freezing rain, freezing drizzle and sleet (it used to show as rain or snow): its own icy background and streaks, and Snoopy wears the winter coat instead of the raincoat.
- Kiosk mode: `?kiosk=1` on a room URL hides the refresh and message buttons on wall tablets.
- Auto-heal: the server sends a named `ping` event to every tablet each 25 seconds (it used to send an invisible comment). A tablet that hears nothing for 75 seconds replaces its live connection; after 5 minutes of silence it reloads the page, but only when `/healthz` answers (an outage never leaves a browser error page) and at most every 10 minutes. The dashboard live view never reloads itself.
- Client secret expiry reminders: set `CLIENT_SECRET_EXPIRES=YYYY-MM-DD` and an alert goes out (dashboard, Teams, webhook) at 30, 14, 7, 3 and 1 days before, and when it has expired, during office hours. A restart repeats the current stage once.
- Daylight saving: the "No more meetings today. Next: tomorrow" label added 24 hours to the clock, which is wrong on the two 23 and 25 hour days a year; it now counts calendar days. New tests run office-hours alerts and the secret expiry count across the March and November 2027 clock changes.
- Node.js 22 or later is now required (`engines`, the installer and the docs): Node.js 20 reached end of life on 30 April 2026. Tests pass on Node.js 22, 24 and 26. A new test keeps the project free of third-party packages and the Node version consistent in every file.
- Tests: 137 automatic tests (was 3) covering settings, holidays and birthdays, weather, bookings and the holiday block, instant change detection, tablet alerts, admin controls, security headers, and the outfit rules file (unique ids, real dates, image sizes, priority order). They run offline in about 7 seconds with `npm test`.
- `scripts/update-manifests.sh` regenerates `MANIFEST.txt` and `SHA256SUMS` from the tracked files (they were stale). Removed the partial `CHECKSUMS.sha256`. Rewrote `RELEASE_MANIFEST.md`, `UPDATING-GITHUB.md` and `verification/VERIFICATION.txt` to match the current project.
- Fixed a race where a slow outfit image could replace the outfit chosen after it.
- Added `.env.example` (the installer needs it), `.gitignore`, and updated docs.

## 2.0.0 known-good baseline — 2026-11-06

- Multi-room display routes (`/room/<room-id>`).
- Microsoft Graph calendar view integration and optional quick booking.
- Operations dashboard, tablet heartbeat, and server-sent events.
- Systemd and Nginx deployment files.
- Browser compatibility fallback when `crypto.randomUUID()` is unavailable.
- Graceful SIGTERM shutdown and static-file HEAD support.
