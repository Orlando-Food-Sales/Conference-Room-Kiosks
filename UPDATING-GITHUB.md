# Update the GitHub repository

These instructions assume the repository already contains the previously supplied
v2 known-good source, including the `generateId()` browser compatibility fix.

## 1. Start from a clean branch

```bash
cd /path/to/meeting-room-display
git status --short
git switch -c update/single-line-meeting-rows
```

If `git status --short` prints unrelated changes, commit or stash them first.

## 2. Copy in the updater

From this extracted bundle:

```bash
mkdir -p tools
cp /path/to/bundle/tools/apply_single_line_update.py tools/
chmod 755 tools/apply_single_line_update.py
```

Optionally also copy the review artifacts:

```bash
mkdir -p docs/updates
cp /path/to/bundle/README.md docs/updates/single-line-meeting-rows.md
cp /path/to/bundle/patches/0001-single-line-upcoming-meetings.patch docs/updates/
```

## 3. Compatibility check (does not modify files)

```bash
python3 tools/apply_single_line_update.py --check .
```

Expected ending:

```text
CHECK OK: repository is compatible; no files changed.
```

The updater refuses to proceed unless it finds either the exact known-good old
rendering block or the exact validated new block. It also syntax-checks the
resulting JavaScript with Node.js before writing.

## 4. Apply the update

```bash
python3 tools/apply_single_line_update.py --apply .
```

Expected ending:

```text
APPLY OK: updated repository files.
```

Running the command again is safe and reports a no-op.

## 5. Review and validate

```bash
node --check public/app.js
git diff --check
git diff -- public/app.js public/styles.css
```

Confirm the diff contains these dedicated classes:

```text
meeting-row
meeting-indicator
meeting-time
meeting-subject
meeting-organizer
```

Run the repository's normal automated tests if it defines them. Do not replace
`.env`, `config/rooms.json`, systemd, Nginx, or Microsoft Entra configuration for
this UI-only update.

## 6. Commit and push

```bash
git add public/app.js public/styles.css tools/apply_single_line_update.py
git commit -m "Improve upcoming meeting row layout"
git push -u origin update/single-line-meeting-rows
```

Open a pull request and verify in the browser that desktop rows show
**indicator | time | subject | organizer**. At widths up to 800 px, verify that
the organizer is hidden and the remaining text is not scrambled.

## Alternative: apply the patch

Instead of using the updater:

```bash
git apply --unidiff-zero --check /path/to/bundle/patches/0001-single-line-upcoming-meetings.patch
git apply --unidiff-zero /path/to/bundle/patches/0001-single-line-upcoming-meetings.patch
node --check public/app.js
git diff --check
```

Use one method only. The updater is recommended because it performs stricter
content and idempotency checks.

## Rollback before committing

```bash
git restore public/app.js public/styles.css
```
