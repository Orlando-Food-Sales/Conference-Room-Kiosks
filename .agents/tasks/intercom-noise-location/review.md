# Door intercom, noise level and location (2.2.0), second pass
Five local commits on main, nothing pushed, no new runtime dependency (package.json only changes the version). Evidence is from commit messages and FEAT findings (265 tests pass, e2e scenarios a-h pass). Not re-run.
Watch for: the manifests are stale after the last fix commit (confirmed).
**Verdict**: NEEDS_CHANGES
## High-level view
The first-pass blockers are fixed. One red badge now reflects the call microphone and the noise meter microphone, the no-dashboard ring path sets the cooldown, and the unauthenticated ring is documented as a residual risk with advice to keep the server on the office network or VPN. The hard constraints hold. Only the tablet's public ring starts a call, with no admin route that creates one. The tablet calls getUserMedia for the call only from the `answered` event, and the dashboard only after the answer POST succeeds. The server relays set-up messages only and logs who and how long, never SDP. The noise heartbeat carries validated numbers and enums. Docs, .env.example, CHANGELOG and version are updated.
The one gap is that commit 0f64f77 changed ten tracked files without regenerating SHA256SUMS and MANIFEST.txt.
<details>
<summary>Issues (1)</summary>

1. **Stale manifests** (confirmed, blocking) — `shasum -a 256 -c SHA256SUMS` fails for the ten files changed in 0f64f77. Run update-manifests.sh and commit.

</details>
<details><summary>Details</summary>

### Manifests after the badge fix
The earlier feature commit regenerated the manifests. The badge fix then edited app.js, index.html, theme.css, intercom.js, three docs and tests but did not touch MANIFEST.txt or SHA256SUMS, so the checksum list no longer matches the tree. A deploy that verifies checksums would reject it.

### Residual risk, now documented
The ring is public and tabletId is client-supplied, so someone who knows a tablet id could join a call an administrator answers. INSTALL 12f states this, and the banner shows the room name. Requiring a live SSE stream for the ringing tabletId would shrink it further (optional).
</details>
<details><summary>File map</summary>

Full diff: `git diff d0c3ee4..HEAD`. Server: src/intercom.js, server.js, config.js. Pages: public/app.js, dashboard.js, index.html, css. Docs: README, INSTALL-UBUNTU, CHANGELOG, DEPLOY-CHECKLIST, .env.example, nginx. Tests and tools/e2e-intercom.mjs.
</details>
