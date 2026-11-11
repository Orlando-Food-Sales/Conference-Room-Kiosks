# Update the GitHub repository

How changes get from your computer to GitHub and then to the kiosk server.

## 1. Check and commit

```bash
cd /path/to/Conference-Room-Kiosks
git status --short
npm run check                  # syntax check and all offline tests must pass
git add <the files you changed>
scripts/update-manifests.sh    # refreshes MANIFEST.txt and SHA256SUMS (new files must be git added first)
git add MANIFEST.txt SHA256SUMS
git commit -m "Describe the change"
```

Do not add `.env`, `config/rooms.json`, `teams-app-build/`, backups or logs; `.gitignore` already skips them. If `git status` shows anything that looks like a secret, stop and remove it before committing.

## 2. Push

Small changes can go straight to `main`. For anything risky, use a branch and a pull request:

```bash
git switch -c my-change
git push -u origin my-change
```

Then open a pull request on GitHub and merge it when you are happy.

## 3. Put it on the server

Follow `DEPLOY-CHECKLIST.md` (backup, copy, settings, restart, smoke test, test alert, rollback). In short:

Pushing to GitHub does not change the kiosks. Deploy as described in `INSTALL-UBUNTU.md` (section 15, "Update and rollback"): back up `/opt/m365-room-display`, copy the new files in without touching `.env`, `config/rooms.json` or `node_modules`, run `npm run check` on the server, restart with `sudo systemctl restart m365-room-display`, and open `/dashboard` to confirm. Changes that only touch files in `public/` need no restart, but tablets pick them up only when they reload (the nightly reload or the refresh button).

A change that adds a new setting needs the matching line in the server's `.env` first (see `.env.example`).

## 4. Roll back

```bash
git revert <commit>     # on your computer, then push and deploy again
```

On the server, restore the backup tarball you took before deploying and restart the service.

## Earlier one-time update

The single-line meeting rows update (`tools/apply_single_line_update.py`, `patches/`, `snippets/`) was applied long ago and is kept only for history. See `RELEASE_MANIFEST.md`.
