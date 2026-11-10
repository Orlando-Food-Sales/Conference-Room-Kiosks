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
- Added `.env.example` (the installer needs it), `.gitignore`, and updated docs.

## 2.0.0 known-good baseline — 2026-11-06

- Multi-room display routes (`/room/<room-id>`).
- Microsoft Graph calendar view integration and optional quick booking.
- Operations dashboard, tablet heartbeat, and server-sent events.
- Systemd and Nginx deployment files.
- Browser compatibility fallback when `crypto.randomUUID()` is unavailable.
- Graceful SIGTERM shutdown and static-file HEAD support.
