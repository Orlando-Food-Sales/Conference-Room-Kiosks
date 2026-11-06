#!/usr/bin/env bash
set -Eeuo pipefail
BASE_URL=${BASE_URL:-http://127.0.0.1:3000}
echo "Health:"; curl --fail --silent --show-error "$BASE_URL/healthz" | python3 -m json.tool
rooms=$(curl --fail --silent --show-error "$BASE_URL/api/rooms")
echo "Rooms:"; python3 -m json.tool <<<"$rooms"
room_id=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["rooms"][0]["id"])' <<<"$rooms")
echo "Events for $room_id:"; curl --fail --silent --show-error "$BASE_URL/api/events?room=$room_id" | python3 -m json.tool
for path in "/room/$room_id" /app.js /styles.css /dashboard; do code=$(curl --silent --output /dev/null --write-out '%{http_code}' "$BASE_URL$path"); [[ $code == 200 ]] || { echo "$path returned $code" >&2; exit 1; }; echo "$path: HTTP $code"; done
