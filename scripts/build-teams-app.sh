#!/usr/bin/env bash
# Builds the Teams app package (room-display-alerts.zip) for the notification-only alert bot.
# Usage: scripts/build-teams-app.sh <bot-app-id> <company-website-https-url> ["Company name"]
# The zip is written to teams-app-build/ (ignored by Git). Upload it in the Teams admin center.
set -Eeuo pipefail

APP_ID=${1:-}
WEBSITE=${2:-}
COMPANY=${3:-Orlando Food Sales}
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SRC="$HERE/deploy/teams-app"
OUT="$HERE/teams-app-build"

if [[ ! $APP_ID =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
  echo "Usage: $0 <bot-app-id> <https://company-website> [\"Company name\"]" >&2
  echo "The first value must be the bot's Application (client) ID from Microsoft Entra, a GUID." >&2
  exit 2
fi
if [[ ! $WEBSITE =~ ^https://[^[:space:]\"\\]+$ ]]; then
  echo "The company website must be an https:// address, for example https://www.example.com" >&2
  exit 2
fi
if [[ $COMPANY == *'"'* || $COMPANY == *'\'* || $COMPANY == *'|'* ]]; then
  echo "The company name must not contain quotes, backslashes or the | character." >&2
  exit 2
fi
command -v zip >/dev/null || { echo "The zip command is required." >&2; exit 1; }

rm -rf "$OUT"; mkdir -p "$OUT/package"
sed -e "s|__BOT_APP_ID__|$APP_ID|g" -e "s|__WEBSITE__|$WEBSITE|g" -e "s|__COMPANY_NAME__|$COMPANY|g" \
  "$SRC/manifest.template.json" > "$OUT/package/manifest.json"
cp "$SRC/color.png" "$SRC/outline.png" "$OUT/package/"

node -e '
  const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const must = [m.id === m.bots[0].botId, m.id === m.webApplicationInfo.id, m.icons.color && m.icons.outline, m.name.short.length <= 30, m.description.short.length <= 80];
  if (must.includes(false) || JSON.stringify(m).includes("__")) { console.error("The manifest did not come out right."); process.exit(1); }
' "$OUT/package/manifest.json"

(cd "$OUT/package" && zip -q -X ../room-display-alerts.zip manifest.json color.png outline.png)
echo "Built: $OUT/room-display-alerts.zip"
unzip -l "$OUT/room-display-alerts.zip" | tail -n +4 | head -n 3
