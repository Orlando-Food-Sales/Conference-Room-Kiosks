# Security

- Never commit `.env`, `config/rooms.json`, client secrets, administrator tokens, backup archives, or production logs.
- Keep the Node service bound behind Nginx/firewall rules and expose only the intended reverse-proxy port.
- Use `Calendars.Read` application permission unless quick booking is required; use `Calendars.ReadWrite` only for rooms that need booking.
- Scope application access to the room mailboxes with Exchange Online Application RBAC.
- Rotate the Entra client secret and `ADMIN_TOKEN` on a defined schedule and after any suspected disclosure.
- Use HTTPS when traffic crosses an untrusted network.
- The server makes optional outbound calls for weather to `api.weather.gov` (US National Weather Service) and `api.open-meteo.com` (backup). Only the configured latitude and longitude are sent; disable it with `WEATHER_ENABLED=false`.
- Birthdays and anniversaries are public on every tablet that shows them. Show first names only (the default) and set `"showCelebrations": false` on client-facing rooms.
- Pages may be framed by the same origin only (`x-frame-options: SAMEORIGIN`), which the preview page needs. `/preview.html` is a review tool; block it in Nginx on public kiosks if you do not want it served.

Report suspected vulnerabilities privately to the repository owner. Do not open a public issue containing secrets or tenant details.
- `ALERT_WEBHOOK_URL` is a secret (anyone with it can post into your channel). Keep it in `.env` only. Alerts contain room and tablet names but no calendar details.
- `TEAMS_BOT_APP_SECRET` is a secret. Keep it in `.env` only, rotate it before it expires, and give the bot's Entra app only the `TeamsAppInstallation.ReadWriteSelfForUser.All` permission (plus `AppCatalog.Read.All` if you want the server to install the app itself). The Teams bot is notification-only: it cannot read chats and it ignores replies. Alert messages contain room and tablet names and error summaries, never calendar details.
