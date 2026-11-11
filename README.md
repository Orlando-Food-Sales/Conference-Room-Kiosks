# Microsoft 365 Room Display

Multi-room meeting-room display for tablets, with an operations dashboard. It reads room calendars
from Microsoft 365 (Microsoft Graph), or runs in demo mode with sample meetings. No runtime
dependencies; Node.js 20 or later.

## What it shows

- Room status (Available / In use), clock, and today's schedule with NOW and NEXT badges.
- "Free until 2:30 PM" on the status card. For rooms with `allowQuickBooking`, one-tap 15, 30 and 60 minute buttons (only those that fit before the next meeting) plus a "Reserve now" form.
- Office hours (default 8:00 AM to 5:00 PM, Monday to Friday, in the room's time zone): outside them the display says "Closed" instead of "Available" and hides booking. A meeting still in progress shows "In use". During the day, "Free until" stops at closing time and booking buttons never run past it.
- Company holidays from the same shared calendar as birthdays: an all-day event titled "Holiday - Christmas" (anything starting with "Holiday") shows "Closed" with the holiday name and hides all booking that day; the server refuses bookings on those days as well. A bare "HOLIDAY" takes its name from the public holidays calendar. Public holidays alone (Veterans Day and so on) do not close the office.
- Calendar changes (new, moved or cancelled meetings, even made in Outlook) reach the tablets within about 15 seconds: the server checks each room's calendar itself and pushes changes over the live connection. `CHANGE_CHECK_SECONDS` sets the interval, 0 turns it off.
- "Closed tomorrow: Thanksgiving" heads-up on the day before a company holiday (it looks past weekends: on Friday it can say "Closed Monday: ...").
- Tablet offline alerts: if a tablet stops checking in during office hours for `ALERT_AFTER_MINUTES` (default 10), the dashboard lists an alert and, when `ALERT_WEBHOOK_URL` is set, the same text is posted there as `{"text": "..."}`. A "back online" message follows.
- Each tablet reloads itself once a night (3:30 to 3:50 in the room's time zone) so it starts fresh.
- Orlando Foods look: dark by default (`?theme=light` or `?theme=auto` to change), with a background
  mood that follows the weather (clear, clouds, rain, storm, snow, fog).
- Snoopy, a 2D sprite companion that reacts to the room: resting, waiting before a meeting,
  thinking during one, plus waves, jumps, walks and look-around. Tap the screen and he looks at it.
- Snoopy outfits: a party hat on birthday and work anniversary days, festive outfits by date (Christmas, New Year, Valentine's Day, Halloween, Thanksgiving, and more as art arrives), pajamas when the display says Closed, then weather and feels-like temperature (raincoat, winter coat, Hawaiian shirt). Rules and limits live in `public/snoopy/outfits.json`; see `public/snoopy/outfits/README.md`.
  (winter coat, raincoat, Hawaiian shirt). See `public/snoopy/outfits.json` and
  `public/snoopy/outfits/README.md`.
- Birthdays and work anniversaries from a shared Microsoft 365 calendar, shown on the status card. On a working day the line also covers the closed days that follow (a Saturday birthday shows on Friday as "Mabel (Saturday)").
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
- Refresh and tablets: `EVENT_REFRESH_SECONDS`, `TABLET_OFFLINE_SECONDS`, `CHANGE_CHECK_SECONDS`
- Alerts: `ALERT_AFTER_MINUTES`, `ALERT_WEBHOOK_URL`
- Office hours: `OFFICE_HOURS_START`, `OFFICE_HOURS_END`, `OFFICE_DAYS`, or `OFFICE_HOURS=off`
- Weather: `WEATHER_ENABLED`, `WEATHER_LATITUDE`, `WEATHER_LONGITUDE` (one location for all rooms), `WEATHER_SOURCE` (auto, nws, open-meteo), `WEATHER_CONTACT`
- Birthdays: `BIRTHDAY_CALENDAR_MAILBOX`, `BIRTHDAY_CALENDAR_NAME`, `BIRTHDAY_CALENDAR_ID`,
  `BIRTHDAY_NAME_STYLE`, `BIRTHDAY_TIME_ZONE`. Only titles containing "birthday", "b'day" or
  "anniversary" are used; PTO and holidays on the same calendar are ignored.
- Per room, in `rooms.json`: `allowQuickBooking`, and `showCelebrations` (set `false` for
  client-facing rooms).

## Preview and testing URLs

`/preview.html` shows every theme, weather, room state, screen size, Snoopy animation, outfit and
celebration. It is a review tool; remove or block it on public kiosks if you prefer.

Query options on a room URL: `theme`, `weather`, `preview` (free, soon, busy, ended, error),
`snoopy` (animation name), `outfit`, `celebrate` (birthday, anniversary, both, weekend), `quickbook=1` (show the booking buttons), `hours` (open or closed), `holiday` (a name, or none), `closedsoon` (a name, or none), `temp` (feels-like Celsius), `day` (1 or 0), `date` (MM-DD, pretend today), `nostream=1`.

## Security

No secrets, tenant IDs, room mailboxes or backups belong in this repository. See `SECURITY.md`.
