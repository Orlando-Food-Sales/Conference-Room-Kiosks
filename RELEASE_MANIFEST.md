# Release manifest

Based on the verified v2.0.0 known-good deployment baseline, including the tablet compatibility correction (the browser never calls `crypto.randomUUID()` unconditionally). Everything added since is listed in `CHANGELOG.md` (the 2.1.0 section).

## Files that describe a release

| File | What it is |
|---|---|
| `MANIFEST.txt` | Every tracked file with its size |
| `SHA256SUMS` | SHA-256 checksum of every tracked file except the two lists themselves |
| `verification/VERIFICATION.txt` | What was checked, and what was not |
| `CHANGELOG.md` | What changed |

`MANIFEST.txt` and `SHA256SUMS` are generated. After your last change, run `git add` for any new files, then `scripts/update-manifests.sh`, and commit the result. To check a copy: `sha256sum -c SHA256SUMS` (macOS: `shasum -a 256 -c SHA256SUMS`).

## One-time update bundle (kept for history)

`patches/`, `snippets/`, `tools/apply_single_line_update.py` and `REPO-FILE-MANIFEST.txt` belong to the earlier single-line meeting rows update. That change is already in `public/app.js` and `public/styles.css`; none of these files are used at run time or by the installer.

## Deliberately not in this repository

- `.env` (Entra tenant ID, client ID, client secret, administrator token, Teams bot secret)
- `config/rooms.json` (production mailbox addresses and room inventory)
- `teams-app-build/` (the generated Teams app zip)
- backup archives and logs

Use `.env.example` and `config/rooms.example.json` as templates. See `INSTALL-UBUNTU.md` for the complete installation procedure.
