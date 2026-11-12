#!/usr/bin/env bash
# Update the running room display from GitHub, on the server itself.
#
#   scripts/deploy-on-server.sh                  update to the latest main
#   scripts/deploy-on-server.sh --dry-run        show what would change, change nothing
#   scripts/deploy-on-server.sh --ref v2.1.0     update to a tag or branch instead of main
#   scripts/deploy-on-server.sh --yes            do not ask for confirmation
#   scripts/deploy-on-server.sh --restart        restart even if only web files changed
#   scripts/deploy-on-server.sh --no-restart     never restart (you do it yourself)
#   From another computer: ssh -t user@server 'bash ~/kiosks/scripts/deploy-on-server.sh'
#   (-t gives it a terminal for the question and the sudo password; without one it stops instead of hanging)
#
# What it does, in order, and stops at the first problem:
#   1. checks the server (Node 22+, git, rsync, curl, the app folder and its .env)
#   2. downloads the new version into a temporary folder (nothing live is touched)
#   3. runs the whole test suite on that copy, with this server's Node
#   4. shows what will change and asks you to confirm
#   5. backs up the running app (including .env) to ~/deploy-backups
#   6. copies the new files over (never .env, config/rooms.json or node_modules)
#   7. restarts the service only if server code changed (web-only changes need no restart)
#   8. checks /healthz reports the new version and runs scripts/smoke-test.sh
#   9. if step 7 or 8 fails, puts the old version back and restarts it, then tells you
#
# Settings (environment variables, all optional):
#   APP_DIR       /opt/m365-room-display
#   REPO_URL      https://github.com/Orlando-Food-Sales/Conference-Room-Kiosks.git
#   SERVICE       m365-room-display
#   BACKUP_DIR    $HOME/deploy-backups        KEEP_BACKUPS  2
#   HEALTH_URL    http://127.0.0.1:3000/healthz
#   RESTART_CMD   sudo systemctl restart $SERVICE      (the only step that needs sudo and your password)
#   SMOKE_CMD     bash $APP_DIR/scripts/smoke-test.sh  (with BASE_URL set from HEALTH_URL)
set -Eeuo pipefail

APP_DIR=${APP_DIR:-/opt/m365-room-display}
REPO_URL=${REPO_URL:-https://github.com/Orlando-Food-Sales/Conference-Room-Kiosks.git}
SERVICE=${SERVICE:-m365-room-display}
BACKUP_DIR=${BACKUP_DIR:-$HOME/deploy-backups}
KEEP_BACKUPS=${KEEP_BACKUPS:-2}
HEALTH_URL=${HEALTH_URL:-http://127.0.0.1:3000/healthz}
RESTART_CMD=${RESTART_CMD:-sudo systemctl restart $SERVICE}
BASE_URL=${HEALTH_URL%/healthz}
SMOKE_CMD=${SMOKE_CMD:-BASE_URL=$BASE_URL bash $APP_DIR/scripts/smoke-test.sh}

REF=main; DRY=0; ASSUME_YES=0; RESTART=auto
while [[ $# -gt 0 ]]; do
  case $1 in
    --ref) REF=${2:?--ref needs a branch or tag}; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    --restart) RESTART=yes; shift ;;
    --no-restart) RESTART=no; shift ;;
    -h|--help) sed -n '2,31p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
done

say() { printf '\n== %s\n' "$*"; }
die() { printf '\nSTOPPED: %s\n' "$*" >&2; exit 1; }
# Files the deploy must never overwrite or remove: the server's own settings and room list.
EXCLUDES=(--exclude .git --exclude .env --exclude config/rooms.json --exclude node_modules --exclude .DS_Store --exclude .agents --exclude teams-app-build)

WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
health() { curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null; }
field() { python3 -c 'import sys,json; print(json.load(sys.stdin).get(sys.argv[1], ""))' "$1"; }

say "1. Checking this server"
[[ $EUID -ne 0 ]] || die "run this as your normal user, not root (sudo is only used for the restart)."
for tool in git rsync curl tar python3 node npm; do command -v "$tool" >/dev/null || die "$tool is not installed (sudo apt install git rsync curl python3)."; done
node_major=$(node -p 'Number(process.versions.node.split(".")[0])')
[[ $node_major -ge 22 ]] || die "Node.js 22 or newer is required, this server has $(node -v)."
[[ -f $APP_DIR/package.json && -f $APP_DIR/.env ]] || die "$APP_DIR does not look like the installed app (no package.json or .env)."
[[ -w $APP_DIR ]] || die "$APP_DIR is not writable by $(whoami)."
old_version=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$APP_DIR/package.json")
echo "Node $(node -v) | running version $old_version | app folder $APP_DIR"
if h=$(health); then echo "Service answers: version $(printf '%s' "$h" | field version), up $(printf '%s' "$h" | field uptimeSeconds) s"; else echo "Warning: the service is not answering at $HEALTH_URL right now."; fi

say "2. Downloading $REF from GitHub into a temporary folder"
git clone --quiet --depth 1 --branch "$REF" "$REPO_URL" "$WORK/new" || die "could not download '$REF' from $REPO_URL (check the name and that this server can reach github.com)."
new_commit=$(git -C "$WORK/new" rev-parse --short HEAD)
new_version=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$WORK/new/package.json")
echo "Got commit $new_commit, version $new_version: $(git -C "$WORK/new" log -1 --format=%s)"
# This script is run from a copy (usually ~/kiosks). If that copy is older than the one just downloaded, say so:
# fixes to this script only take effect after "git -C <that folder> pull".
if ! cmp -s "$0" "$WORK/new/scripts/deploy-on-server.sh"; then
  if here=$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null); then
    echo "Note: this deploy script differs from the one in $REF. Update it first with:  git -C \"$here\" pull"
  else
    echo "Note: this deploy script differs from the one in $REF. Get the latest copy from $REPO_URL and run that."
  fi
fi

say "3. Running the tests on that copy (nothing live is touched)"
if ! test_output=$(cd "$WORK/new" && npm run check 2>&1); then
  printf '%s\n' "$test_output" | grep -E '^# (tests|pass|fail)|^not ok' || printf '%s\n' "$test_output" | tail -15
  die "the tests fail on $REF with this server's Node, so nothing was changed."
fi
printf '%s\n' "$test_output" | grep -E '^# (tests|pass|fail)'

say "4. What would change"
CHANGES=$(rsync -rlci --executability --dry-run "${EXCLUDES[@]}" "$WORK/new/" "$APP_DIR/" | grep -E '^[<>c]f' || true)
count=$(printf '%s' "$CHANGES" | grep -c . || true)
if [[ $count -eq 0 ]]; then echo "Nothing differs: $APP_DIR already matches $REF ($new_commit)."; exit 0; fi
printf '%s\n' "$CHANGES" | awk 'NR <= 40 {print "  " $2}'
[[ $count -le 40 ]] || echo "  ... and $((count - 40)) more"
echo "$count files differ. Version $old_version -> $new_version."
needs_restart=no
printf '%s\n' "$CHANGES" | awk '{print $2}' | grep -E '^(src/|package(-lock)?\.json$)' >/dev/null && needs_restart=yes
[[ $RESTART == yes ]] && needs_restart=yes
[[ $RESTART == no ]] && needs_restart=no
case $RESTART:$needs_restart in auto:yes) why=' (server code changed)' ;; auto:no) why=' (only web files changed)' ;; *) why=' (you asked for that)' ;; esac
echo "Restart needed: $needs_restart$why"
# Settings in the new .env.example that this server's .env does not have yet (informational: the app still starts, the feature is off).
missing=$(grep -oE '^[A-Z][A-Z0-9_]*=' "$WORK/new/.env.example" | grep -vxFf <(grep -oE '^[A-Z][A-Z0-9_]*=' "$APP_DIR/.env" || true) | tr -d '=' | tr '\n' ' ' || true)
[[ -z $missing ]] || echo "Settings in .env.example that your .env does not have (optional, features stay off): $missing"
# Room for the backup and the copy (the backup is about the size of the app folder, compressed).
app_kb=$(du -sk "$APP_DIR" | cut -f1)
for spot in "$BACKUP_DIR" "$APP_DIR"; do
  probe=$spot; while [[ ! -d $probe ]]; do probe=$(dirname "$probe"); done
  free_kb=$(df -Pk "$probe" | awk 'NR == 2 {print $4}')
  [[ ${free_kb:-0} -ge $((app_kb * 2 + 102400)) ]] || die "only $((free_kb / 1024)) MB free for $spot; the update needs about $(((app_kb * 2 + 102400) / 1024)) MB. Free some space (old backups are in $BACKUP_DIR) and try again."
done
if [[ $DRY -eq 1 ]]; then echo; echo "Dry run: nothing was changed."; exit 0; fi

# Without a terminal (for example "ssh server 'deploy-on-server.sh'") nobody can answer a question, so stop now
# instead of waiting forever: the confirmation needs --yes, and a restart needs sudo that does not ask for a password.
if [[ ! -t 0 ]]; then
  [[ $ASSUME_YES -eq 1 ]] || die "no terminal to answer 'Go ahead?'. Run it in a terminal (ssh -t), or add --yes. Nothing was changed."
  if [[ $needs_restart == yes && $RESTART_CMD == sudo\ * ]] && ! sudo -n true 2>/dev/null; then
    die "a restart is needed and sudo wants a password, but there is no terminal to type it. Run it with ssh -t, or use --no-restart and restart yourself. Nothing was changed."
  fi
fi
if [[ $ASSUME_YES -ne 1 ]]; then read -r -p "Go ahead and deploy? [y/N] " answer; [[ $answer == [yY]* ]] || { echo "Cancelled, nothing was changed."; exit 0; }; fi

say "5. Backing up the running app"
mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
backup="$BACKUP_DIR/room-display-$(date +%Y%m%d-%H%M%S)-v$old_version.tar.gz"
( umask 077; tar -czf "$backup" -C "$(dirname "$APP_DIR")" "$(basename "$APP_DIR")" )
echo "Saved $backup ($(du -h "$backup" | cut -f1)); it contains .env, so keep it private."

rollback() {
  say "ROLLING BACK to version $old_version"
  local old="$WORK/old"; mkdir -p "$old"
  tar -xzf "$backup" -C "$old"
  rsync -rltc --executability --delete "${EXCLUDES[@]}" "$old/$(basename "$APP_DIR")/" "$APP_DIR/"
  if [[ $needs_restart == yes ]]; then eval "$RESTART_CMD" || echo "The restart command failed, restart the service by hand."; sleep 3; fi
  if h=$(health); then back=$(printf '%s' "$h" | field version); echo "Back on ${back:+version $back}${back:-the previous version (it does not report a version number)}."; else echo "The service is not answering. Restore by hand from $backup"; fi
  die "the update to $new_version failed and the old version was put back. Nothing else was changed."
}

say "6. Copying the new files"
rsync -rltc --executability "${EXCLUDES[@]}" "$WORK/new/" "$APP_DIR/" || rollback
echo "Copied. Your .env and config/rooms.json were not touched."

if [[ $needs_restart == yes ]]; then
  say "7. Restarting the service (this is the only step that asks for your password)"
  eval "$RESTART_CMD" || rollback
  ok=0
  for _ in $(seq 1 30); do
    if h=$(health); then
      up=$(printf '%s' "$h" | field uptimeSeconds); v=$(printf '%s' "$h" | field version)
      if [[ $v == "$new_version" && ${up:-999999} -lt 40 ]]; then ok=1; break; fi
    fi
    sleep 1
  done
  [[ $ok -eq 1 ]] || { echo "The service did not come back on version $new_version within 30 seconds."; rollback; }
  echo "Restarted: now version $new_version."
else
  say "7. No restart needed (only web files changed; tablets pick them up when they reload)"
  health >/dev/null || { echo "The service is not answering."; rollback; }
fi

say "8. Smoke test"
if eval "$SMOKE_CMD" > "$WORK/smoke.txt" 2>&1; then grep -E 'Running version|Smoke test passed' "$WORK/smoke.txt" || true
else tail -15 "$WORK/smoke.txt"; echo "The smoke test failed."; rollback; fi

# Keep the newest few backups only.
{ ls -1t "$BACKUP_DIR"/room-display-*.tar.gz 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | while read -r old_backup; do rm -f "$old_backup"; done; } || true

say "Done: $old_version -> $new_version ($new_commit)"
echo "Backup: $backup"
echo "Undo later with:  tar -xzf $backup -C $(dirname "$APP_DIR") && $RESTART_CMD"
echo "Tablets that are already open keep the old page until they reload (nightly at about 3:30 AM, or reload them by hand)."
