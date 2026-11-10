# Changelog

## Unreleased

- Orlando Foods theme, dark by default; `?theme=light|auto`. Background mood follows the weather
  (`/api/weather`, Open-Meteo, cached 10 minutes; `WEATHER_*` settings).
- Schedule rows rebuilt as single-line rows with NOW and NEXT badges; page markup and stylesheet
  brought back in line.
- Snoopy sprite companion (`public/snoopy.js`) reacting to the room calendar, with outfits chosen by
  date and weather (`public/snoopy/outfits.json`).
- Birthdays and work anniversaries from a shared Microsoft 365 mailbox (`/api/celebrations`,
  `BIRTHDAY_*` settings, per-room `showCelebrations`).
- Preview page (`/preview.html`) and preview query options. Framing is now allowed from the same
  origin only (`x-frame-options: SAMEORIGIN`) so the preview can embed the display.
- Added `.env.example` (the installer needs it), `.gitignore`, and updated docs.

## 2.0.0 known-good baseline — 2026-11-06

- Multi-room display routes (`/room/<room-id>`).
- Microsoft Graph calendar view integration and optional quick booking.
- Operations dashboard, tablet heartbeat, and server-sent events.
- Systemd and Nginx deployment files.
- Browser compatibility fallback when `crypto.randomUUID()` is unavailable.
- Graceful SIGTERM shutdown and static-file HEAD support.
