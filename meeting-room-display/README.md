# M365 Meeting Room Display

A production-oriented, dependency-free Node.js starter application for a wall-mounted tablet outside a meeting room. It reads a Microsoft 365 resource mailbox through Microsoft Graph, updates connected browsers when Graph change notifications arrive, and optionally supports ad-hoc room reservations.

## Features

- Full-screen, touch-friendly browser UI for iPad, Android, and Windows tablets
- Current availability, active meeting, remaining time, and today's upcoming agenda
- Private meetings display as **Private meeting** with organizer details hidden
- Microsoft Graph application authentication; the client secret never reaches the browser
- Near-real-time refresh using Graph change notifications and Server-Sent Events (SSE)
- Five-minute polling fallback if a webhook or SSE connection is interrupted
- Optional quick booking with overlap protection
- Demo mode for local evaluation without an M365 tenant
- Dockerfile, health endpoint, security headers, and automated API tests

## Architecture

```text
Microsoft 365 room mailbox
        │
        │ Graph calendarView + change notifications
        ▼
Node.js HTTP service ────────── SSE ─────► Tablet browser(s)
        │
        └── app-only Entra credentials (server only)
```

The service subscribes to `created`, `updated`, and `deleted` event changes. A valid notification causes all connected displays to refetch the room calendar. Notifications do not contain event details, and `clientState` is validated before a refresh is broadcast.

## Run the demo

Requirements: Node.js 20 or newer.

```bash
cp .env.example .env
npm install
npm start
```

Open `http://localhost:3000` in a tablet browser. The example environment enables demo mode, so no Microsoft 365 credentials are required.

Run checks with:

```bash
npm test
```

## Microsoft 365 setup

### 1. Create or identify a room mailbox

In the Exchange admin center, create a **Room mailbox** or use an existing resource mailbox. Record its primary SMTP address, for example `frontconferenc@orlandofoods.com`.

### 2. Register an Entra application

1. In Microsoft Entra admin center, create an app registration.
2. Add Microsoft Graph **Application** permission `Calendars.Read`.
3. If quick booking is required, add `Calendars.ReadWrite` instead.
4. Grant tenant-wide admin consent.
5. Create a client secret or, for Azure hosting, replace client-secret authentication with a managed identity/certificate before production.
6. Record the tenant ID, client ID, and secret.

For least privilege, restrict the app to only the intended room mailbox using Exchange Online Application RBAC (preferred) or an Application Access Policy. Do not leave a calendar application permission tenant-wide unless that scope is explicitly required.

### 3. Configure the service

Create `.env` from `.env.example` and set:

```dotenv
DEMO_MODE=false
ROOM_NAME=Northstar Conference Room
ROOM_EMAIL=northstar-room@contoso.com
DISPLAY_TIME_ZONE=America/New_York
TENANT_ID=00000000-0000-0000-0000-000000000000
CLIENT_ID=00000000-0000-0000-0000-000000000000
CLIENT_SECRET=your-secret
PUBLIC_BASE_URL=https://rooms.contoso.com
ALLOW_QUICK_BOOKING=false
GRAPH_CLIENT_STATE=a-random-value-with-at-least-32-characters
```

`DISPLAY_TIME_ZONE` must be an IANA time zone. `PUBLIC_BASE_URL` must be a publicly reachable HTTPS origin so Microsoft Graph can validate and deliver notifications to:

```text
https://rooms.contoso.com/api/graph/notifications
```

If `PUBLIC_BASE_URL` is omitted, the display still works and polls every five minutes, but Graph subscriptions are not created.

### 4. Publish behind HTTPS

Run the container behind a reverse proxy or an Azure service that terminates HTTPS. Forward SSE without response buffering. Example Nginx location settings:

```nginx
proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_buffering off;
proxy_read_timeout 1h;
```

Only the webhook route needs internet ingress. For a stronger deployment, expose `/api/graph/notifications` through a narrow public ingress and keep the UI/API on a trusted device network or behind Microsoft Entra application access.

### 5. Configure the tablet

- Browse to the HTTPS URL and add it to the home screen or use kiosk/single-app mode.
- Disable sleep while powered and enable guided access or Android screen pinning.
- Use landscape or portrait orientation; the layout adapts automatically.
- Keep the device on a managed network and deploy browser/device updates through MDM.

## API

| Route | Purpose |
|---|---|
| `GET /healthz` | Liveness and operating mode |
| `GET /api/config` | Non-secret display settings |
| `GET /api/events` | Busy room events for a range of up to seven days |
| `GET /api/stream` | SSE channel for display refresh signals |
| `POST /api/book` | Optional ad-hoc reservation with collision check |
| `POST /api/graph/notifications` | Graph validation and change notifications |

## Security and production notes

- Quick booking is disabled by default. Enable it only on a trusted network or after placing the API behind device/user authentication.
- Keep `.env` out of source control. Store production secrets in Azure Key Vault or the hosting platform's secret store.
- Prefer a certificate or managed identity over a long-lived client secret.
- Apply least-privilege mailbox scoping in Exchange Online.
- Graph subscriptions expire and are renewed automatically. The service currently keeps subscription state in memory, so each replica would create its own subscription. For a multi-replica deployment, persist subscription ownership in Redis or a database and run renewal as a singleton job.
- The room mailbox is the organizer for quick reservations created by this starter. If reservations must be owned by the person at the tablet, add delegated Entra sign-in and create the event in that user's calendar with the room as an attendee.
- Add centralized logging, alerting for subscription failures, a reverse-proxy request limit, and deployment-specific authentication before a broad rollout.

## Project layout

```text
public/                 Tablet web interface
src/config.js           Environment validation
src/graph-calendar.js   Microsoft Graph calendar client
src/demo-calendar.js    Local sample calendar
src/subscription-manager.js  Graph subscription lifecycle
src/server.js           API, webhook, SSE, static hosting
test/                   Node test suite
```
