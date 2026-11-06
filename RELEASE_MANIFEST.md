# Release manifest

This repository reconstructs the verified v2.0.0 known-good deployment baseline and incorporates the confirmed tablet compatibility correction: the browser never calls `crypto.randomUUID()` unconditionally.

Production-specific values are intentionally excluded:

- `.env` (Entra tenant ID, client ID, client secret, administrator token)
- `config/rooms.json` (production mailbox addresses and room inventory)
- backup archives and logs

Use `.env.example` and `config/rooms.example.json` as templates. See `INSTALL-UBUNTU.md` for the complete installation procedure.
