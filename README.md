# Microsoft 365 Room Display

Multi-room meeting-room display for tablets, with an operations dashboard. It reads room calendars
from Microsoft 365 (Microsoft Graph), or runs in demo mode with sample meetings. No runtime
dependencies; Node.js 20 or later.

## What it shows

- Room status (Available / In use), clock, and today's schedule with NOW and NEXT badges.
- Optional quick booking from the tablet.
- Orlando Foods look: dark by default (`?theme=light` or `?theme=auto` to change), with a background
  mood that follows the weather (clear, clouds, rain, storm, snow, fog).
- Snoopy, a 2D sprite companion that reacts to the room: resting, waiting before a meeting,
  thinking during one, plus waves, jumps, walks and look-around. Tap the screen and he looks at it.
- Snoopy outfits chosen by date (Christmas, New Year, Halloween, Thanksgiving) then by weather
  (winter coat, raincoat, Hawaiian shirt). See `public/snoopy/outfits.json` and
  `public/snoopy/outfits/README.md`.
- Birthdays and work anniversaries from a shared Microsoft 365 calendar, shown on the status card.
- Dashboard at `/dashboard` (needs `ADMIN_TOKEN`): room overview, tablet status, messages, display on/off.

## Run it

```bash
DEMO_MODE=true npm start     # http://localhost:3000/room/room
npm run check                # syntax check and tests
```

Production setup (Ubuntu, Nginx, systemd, Entra app): see `INSTALL-UBUNTU.md`.
Copy `.env.example` to `.env` and `config/rooms.example.json` to `config/rooms.json`.

## Settings

All settings are environment variables; see `.env.example`.

- Microsoft 365: `TENANT_ID`, `CLIENT_ID`, `CLIENT_SECRET`, `ROOMS_FILE`
- Refresh and tablets: `EVENT_REFRESH_SECONDS`, `TABLET_OFFLINE_SECONDS`
- Weather: `WEATHER_ENABLED`, `WEATHER_LATITUDE`, `WEATHER_LONGITUDE` (one location for all rooms)
- Birthdays: `BIRTHDAY_CALENDAR_MAILBOX`, `BIRTHDAY_CALENDAR_NAME`, `BIRTHDAY_CALENDAR_ID`,
  `BIRTHDAY_NAME_STYLE`, `BIRTHDAY_TIME_ZONE`. Only titles containing "birthday", "b'day" or
  "anniversary" are used; PTO and holidays on the same calendar are ignored.
- Per room, in `rooms.json`: `allowQuickBooking`, and `showCelebrations` (set `false` for
  client-facing rooms).

## Preview and testing URLs

`/preview.html` shows every theme, weather, room state, screen size, Snoopy animation, outfit and
celebration. It is a review tool; remove or block it on public kiosks if you prefer.

Query options on a room URL: `theme`, `weather`, `preview` (free, soon, busy, ended, error),
`snoopy` (animation name), `outfit`, `celebrate` (birthday, anniversary, both), `nostream=1`.

## Security

No secrets, tenant IDs, room mailboxes or backups belong in this repository. See `SECURITY.md`.
