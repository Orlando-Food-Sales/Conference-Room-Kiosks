# Security

- Never commit `.env`, `config/rooms.json`, client secrets, administrator tokens, backup archives, or production logs.
- Keep the Node service bound behind Nginx/firewall rules and expose only the intended reverse-proxy port.
- Use `Calendars.Read` application permission unless quick booking is required; use `Calendars.ReadWrite` only for rooms that need booking.
- Scope application access to the room mailboxes with Exchange Online Application RBAC.
- Rotate the Entra client secret and `ADMIN_TOKEN` on a defined schedule and after any suspected disclosure.
- Use HTTPS when traffic crosses an untrusted network.

Report suspected vulnerabilities privately to the repository owner. Do not open a public issue containing secrets or tenant details.
