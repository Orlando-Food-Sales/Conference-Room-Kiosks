#!/usr/bin/env bash
# Regenerates MANIFEST.txt (file list with sizes) and SHA256SUMS (checksums) from the files Git tracks.
# Run it after your last change and before committing:  scripts/update-manifests.sh
# Verify a checkout later with:  sha256sum -c SHA256SUMS   (macOS: shasum -a 256 -c SHA256SUMS)
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if command -v sha256sum >/dev/null; then HASH=(sha256sum); else HASH=(shasum -a 256); fi
# New files must be known to Git (git add) to be listed. Both outputs list everything except themselves.
: > MANIFEST.txt.tmp
: > SHA256SUMS.tmp
COUNT=0
while IFS= read -r f; do
  [[ -f $f ]] || continue
  printf '%s\t%s bytes\n' "$f" "$(wc -c < "$f" | tr -d ' ')" >> MANIFEST.txt.tmp
  "${HASH[@]}" "$f" >> SHA256SUMS.tmp
  COUNT=$((COUNT + 1))
done < <(git ls-files -c | grep -v -x -e MANIFEST.txt -e SHA256SUMS | LC_ALL=C sort)
mv MANIFEST.txt.tmp MANIFEST.txt
mv SHA256SUMS.tmp SHA256SUMS
echo "Wrote MANIFEST.txt and SHA256SUMS for $COUNT files."
