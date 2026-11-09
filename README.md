# Microsoft 365 Room Display — GitHub Update Bundle

This bundle updates the previously supplied **v2 known-good repository** to the
validated **single-line upcoming meeting layout** used by the working deployment.

## What changes

- `public/app.js`: gives upcoming meetings dedicated indicator, time, subject,
  and organizer columns.
- `public/styles.css`: adds compact single-line desktop styling and a tablet
  fallback that hides the organizer below 800 px.
- The existing Microsoft 365/Graph, room selection, SSE, tablet heartbeat,
  quick-booking, dashboard, and UUID compatibility logic is not changed.

## Contents

- `UPDATING-GITHUB.md` — exact update and commit procedure.
- `tools/apply_single_line_update.py` — recommended safety-checked updater.
- `patches/0001-single-line-upcoming-meetings.patch` — reviewable Git patch.
- `public/styles.css` — complete replacement stylesheet based on the known-good
  base plus the validated layout.
- `snippets/` — exact JavaScript and CSS blocks for code review.
- `CHECKSUMS.sha256` — SHA-256 integrity hashes.
- `verification/VERIFICATION.txt` — build and test record.

## Security

This bundle contains no `.env`, tenant ID, client ID, client secret, administrator
token, room mailbox address, production hostname, IP address, or backup archive.
Use a private repository if your main project contains organization-specific room
configuration.
