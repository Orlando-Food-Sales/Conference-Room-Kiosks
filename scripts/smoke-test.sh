#!/usr/bin/env bash
set -Eeuo pipefail
BASE_URL=${BASE_URL:-http://127.0.0.1:3000}
echo "Health:"; health=$(curl --fail --silent --show-error "$BASE_URL/healthz"); python3 -m json.tool <<<"$health"
python3 -c 'import json,sys; h=json.load(sys.stdin); assert h["status"]=="ok" and h.get("version"), "healthz must report status ok and a version"; print("Running version " + h["version"])' <<<"$health"
rooms=$(curl --fail --silent --show-error "$BASE_URL/api/rooms")
echo "Rooms:"; python3 -m json.tool <<<"$rooms"
room_id=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["rooms"][0]["id"])' <<<"$rooms")
echo "Events for $room_id:"; curl --fail --silent --show-error "$BASE_URL/api/events?room=$room_id" | python3 -m json.tool
for path in "/room/$room_id" /app.js /styles.css /theme.css /theme.js /snoopy.js /snoopy/snoopy.png /snoopy/outfits.json /logo/orlando-foods-white.png /logo/orlando-foods-color.png /dashboard.css /dashboard.js /preview.html /api/weather /api/celebrations /dashboard; do code=$(curl --silent --output /dev/null --write-out '%{http_code}' "$BASE_URL$path"); [[ $code == 200 ]] || { echo "$path returned $code" >&2; exit 1; }; echo "$path: HTTP $code"; done
echo "Weather and official warnings:"
curl --fail --silent --show-error "$BASE_URL/api/weather" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert isinstance(d.get("alerts"), list), "/api/weather must include an alerts list"; w=d.get("weather"); print("  weather: " + (w["condition"] + ", feels " + str(w["feelsLikeC"]) + " C, source " + w["source"] if w else "not available (turned off or unreachable)")); print("  active warnings: " + (", ".join(a["event"] for a in d["alerts"]) or "none"))'
echo "Smoke test passed."
