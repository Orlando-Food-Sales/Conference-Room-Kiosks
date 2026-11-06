# M365 Meeting Room Display v2.0.0

A dependency-light Node.js service for multi-room Microsoft 365 calendar displays. It provides room tablet views, a room picker, timed calendar refresh, server-sent updates, tablet heartbeat tracking, an administrator dashboard, and optional quick booking.

This is the **known-good v2 baseline**. It includes the tablet fix that uses a secure UUID fallback when `crypto.randomUUID()` is unavailable.

## Quick start (demo mode)

```bash
git clone https://github.com/YOUR-ORG/m365-room-display.git
cd m365-room-display
sudo bash scripts/install-ubuntu.sh
```

Open `http://SERVER-IP/room/front` and `http://SERVER-IP/dashboard`. The installer starts in demo mode. Follow [INSTALL-UBUNTU.md](INSTALL-UBUNTU.md) to connect Microsoft 365 securely.

## Requirements

- Ubuntu Server 22.04 or 24.04 LTS
- Node.js 20 or later (the installer pins Node.js 26.13.0 LTS when needed)
- Nginx
- Microsoft Entra app registration and Exchange Online room mailboxes for production mode

## Repository layout

| Path | Purpose |
|---|---|
| `src/` | HTTP server, configuration, demo and Microsoft Graph calendar clients |
| `public/` | Tablet and dashboard web applications |
| `config/rooms.example.json` | Sanitized multi-room template |
| `deploy/` | Systemd and Nginx production configuration |
| `scripts/` | Installer, smoke test, and protected backup script |
| `test/` | Node built-in test suite |
| `.github/workflows/ci.yml` | GitHub Actions validation |

## Local development

```bash
cp .env.example .env
cp config/rooms.example.json config/rooms.json
npm install
npm run check
npm start
```

Then open `http://localhost:3000/room/front`.

## Production configuration

Do not commit `.env` or `config/rooms.json`. Use `Calendars.Read` for display-only deployments. Only grant `Calendars.ReadWrite` when quick booking is enabled, and scope application access to the intended room mailboxes.

See [INSTALL-UBUNTU.md](INSTALL-UBUNTU.md) for step-by-step installation, Entra configuration, validation, update, backup, and rollback instructions.
