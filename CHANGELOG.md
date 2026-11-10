# Changelog

## Unreleased

- Orlando Foods theme, dark by default; `?theme=light|auto`. Background mood follows the weather
  (`/api/weather`, Open-Meteo, cached 10 minutes; `WEATHER_*` settings; default location Glen Rock, NJ).
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
- Added `.env.example` (the installer needs it), `.gitignore`, and updated docs.

## 2.0.0 known-good baseline — 2026-11-06

- Multi-room display routes (`/room/<room-id>`).
- Microsoft Graph calendar view integration and optional quick booking.
- Operations dashboard, tablet heartbeat, and server-sent events.
- Systemd and Nginx deployment files.
- Browser compatibility fallback when `crypto.randomUUID()` is unavailable.
- Graceful SIGTERM shutdown and static-file HEAD support.
