#!/usr/bin/env python3
"""Safely apply the validated single-line meeting update to an existing repository."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

OLD_JS = r'''  const upcoming = state.events.filter(event => new Date(event.end).getTime() > now - 30 * 60000).slice(0, 8);
  $('eventList').innerHTML = upcoming.length ? upcoming.map(event => {
    const start = new Date(event.start).getTime(), end = new Date(event.end).getTime();
    const cls = start <= now && end > now ? 'current' : end <= now ? 'past' : '';
    return `<article class="event ${cls}"><div></div><div><time>${formatRange(event)}</time><strong>${escapeText(event.subject)}</strong>${event.organizer ? `<small>${escapeText(event.organizer)}</small>` : ''}</div></article>`;
  }).join('') : '<p class="empty">No more meetings scheduled.</p>';
'''
NEW_JS = r'''  const upcoming = state.events
    .filter(event => new Date(event.end).getTime() > now - 30 * 60000)
    .slice(0, 8);

  $('eventList').innerHTML = upcoming.length
    ? upcoming.map(event => {
        const start = new Date(event.start).getTime();
        const end = new Date(event.end).getTime();
        const cls = start <= now && end > now
          ? 'current'
          : end <= now
            ? 'past'
            : '';

        const organizer = event.organizer
          ? escapeText(event.organizer)
          : '';

        return `<article class="event meeting-row ${cls}">
          <div class="meeting-indicator"></div>
          <div class="meeting-time">${formatRange(event)}</div>
          <div class="meeting-subject">${escapeText(event.subject)}</div>
          <div class="meeting-organizer">${organizer}</div>
        </article>`;
      }).join('')
    : '<p class="empty">No more meetings scheduled.</p>';
'''
CSS_UPDATE = r'''
/* =========================================
   Single-line upcoming meeting rows
   ========================================= */

.section-heading {
  padding-bottom: 8px;
}

.event-list {
  display: grid;
  grid-template-columns: 1fr;
  gap: 7px;
  padding-top: 8px;
}

.event.meeting-row {
  display: grid;
  grid-template-columns: 4px 155px minmax(0, 1fr) minmax(140px, 220px);
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 10px 14px;
  background: #0b1727;
  border: 1px solid var(--line);
  border-radius: 10px;
}

.event.meeting-row::before {
  display: none;
}

.meeting-indicator {
  align-self: stretch;
  min-height: 32px;
  background: var(--blue);
  border-radius: 4px;
}

.event.meeting-row.current .meeting-indicator {
  background: var(--red);
}

.meeting-time {
  color: var(--muted);
  font-size: .82rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.meeting-subject {
  min-width: 0;
  color: var(--text);
  font-size: 1rem;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.meeting-organizer {
  min-width: 0;
  color: var(--muted);
  font-size: .82rem;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.event.meeting-row.past {
  opacity: .46;
}

.empty {
  padding: 14px 0;
}

@media (max-width: 800px) {
  .event.meeting-row {
    grid-template-columns: 4px 125px minmax(0, 1fr);
  }

  .meeting-organizer {
    display: none;
  }

  .meeting-time {
    font-size: .76rem;
  }

  .meeting-subject {
    font-size: .92rem;
  }
}
'''
CSS_MARKER = "Single-line upcoming meeting rows"


def fail(message: str) -> None:
    raise SystemExit(f"ERROR: {message}")


def atomic_write(path: Path, content: str) -> None:
    mode = path.stat().st_mode
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent,
                                     prefix=f".{path.name}.", delete=False) as handle:
        handle.write(content)
        temp_name = handle.name
    os.chmod(temp_name, mode)
    os.replace(temp_name, path)


def validate_javascript(content: str, directory: Path) -> None:
    node = shutil.which("node")
    if not node:
        fail("Node.js is required so public/app.js can be syntax-checked before writing.")
    temp_name = None
    try:
        with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8",
                                         dir=directory, delete=False) as handle:
            handle.write(content)
            temp_name = handle.name
        result = subprocess.run([node, "--check", temp_name], text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        if result.returncode:
            fail("updated app.js failed syntax validation:\n" + result.stdout.strip())
    finally:
        if temp_name:
            Path(temp_name).unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    mode_group = parser.add_mutually_exclusive_group(required=True)
    mode_group.add_argument("--check", action="store_true")
    mode_group.add_argument("--apply", action="store_true")
    parser.add_argument("repository", nargs="?", default=".")
    args = parser.parse_args()

    root = Path(args.repository).resolve()
    app = root / "public" / "app.js"
    css = root / "public" / "styles.css"
    if not app.is_file() or not css.is_file():
        fail(f"expected {app} and {css}")

    app_text = app.read_text(encoding="utf-8")
    css_text = css.read_text(encoding="utf-8")
    old_count = app_text.count(OLD_JS)
    new_count = app_text.count(NEW_JS)

    if old_count == 1 and new_count == 0:
        next_app = app_text.replace(OLD_JS, NEW_JS, 1)
        js_state = "will update"
    elif old_count == 0 and new_count == 1:
        next_app = app_text
        js_state = "already current"
    else:
        fail(f"app.js safety check failed (old block={old_count}, new block={new_count}); no files changed")

    marker_count = css_text.count(CSS_MARKER)
    exact_css_count = css_text.count(CSS_UPDATE.strip("\n"))
    if marker_count == 0:
        next_css = css_text.rstrip() + "\n" + CSS_UPDATE
        css_state = "will update"
    elif marker_count == 1 and exact_css_count == 1:
        next_css = css_text
        css_state = "already current"
    else:
        fail(f"styles.css safety check failed (marker={marker_count}, exact block={exact_css_count}); no files changed")

    validate_javascript(next_app, app.parent)
    print(f"public/app.js: {js_state}; syntax valid")
    print(f"public/styles.css: {css_state}")

    if args.check:
        print("CHECK OK: repository is compatible; no files changed.")
        return 0

    if next_app == app_text and next_css == css_text:
        print("NO-OP: repository already contains the validated update.")
        return 0

    atomic_write(app, next_app)
    atomic_write(css, next_css)
    print("APPLY OK: updated repository files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
