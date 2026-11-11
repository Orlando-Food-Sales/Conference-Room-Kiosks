# Security

- Never commit `.env`, `config/rooms.json`, client secrets, administrator tokens, backup archives, or production logs.
- Keep the Node service bound behind Nginx/firewall rules and expose only the intended reverse-proxy port.
- Use `Calendars.Read` application permission unless quick booking is required; use `Calendars.ReadWrite` only for rooms that need booking.
- Scope application access to the room mailboxes with Exchange Online Application RBAC.
- Rotate the Entra client secret and `ADMIN_TOKEN` on a defined schedule and after any suspected disclosure.
- Use HTTPS when traffic crosses an untrusted network.
- The server makes optional outbound calls for weather to `api.weather.gov` (US National Weather Service) and `api.open-meteo.com` (backup). The same `api.weather.gov` service also supplies official weather warnings (`/alerts/active`). Only the configured latitude and longitude are sent; disable weather with `WEATHER_ENABLED=false`, or just the warnings with `WEATHER_ALERTS=false`.
- Birthdays and anniversaries are public on every tablet that shows them. Show first names only (the default) and set `"showCelebrations": false` on client-facing rooms.
- Pages may be framed by the same origin only (`x-frame-options: SAMEORIGIN`), which the preview page needs. `/preview.html` is a review tool; block it in Nginx on public kiosks if you do not want it served.
- `ALERT_WEBHOOK_URL` is a secret (anyone with it can post into your channel). Keep it in `.env` only. Alerts contain room and tablet names but no calendar details.
- `TEAMS_BOT_APP_SECRET` is a secret. Keep it in `.env` only and rotate it before it expires. The bot needs only the `TeamsAppInstallation.ReadWriteSelfForUser.All` permission (plus `AppCatalog.Read.All` if you want the server to install the app itself). If the bot reuses the room display's Entra app, one leaked secret exposes both calendar and Teams access; a separate app keeps them apart. The Teams bot is notification-only: it cannot read chats and it ignores replies. Alert messages contain room and tablet names and error summaries, never calendar details.
- Entra IDs (tenant, application and Teams catalog IDs) are not secrets, but keep real ones, and real email addresses, out of this repository; they belong in `.env`.

Report suspected vulnerabilities privately to the repository owner. Do not open a public issue containing secrets or tenant details.
