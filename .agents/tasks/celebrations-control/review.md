# Review: celebrations control (7be5bc0..5554c2a)

Verdict: APPROVED. No blockers.

## Auth, logging and safety
- Admin-only: the four routes sit inside the existing `/api/admin/` block (src/server.js:749), so token or session auth and the same-origin JSON rule for sessions apply. Test "all four celebration routes need the administrator token" covers 401 with no token and a wrong token, and checks that Graph was never called. There is no session-specific test for these routes. The guard is shared and tested elsewhere, so this is not a blocker.
- Logging: lines are written with `logger.log` and the `Celebrations:` prefix, with the who text from `whoText(who)`. The `activity` regex now includes `Celebrations:`. The test checks the lines appear in Recent activity and that no address, id or secret is in them. Refusals and Graph failures go to `logger.warn` with the kind only.
- Deletion safety: `isOwnAnniversary` requires a seriesMaster, all-day, not cancelled, absoluteYearly with interval 1, and the exact subject `Name - Work Anniversary (since YYYY)`. `remove` re-reads the event from Graph, checks the calendar is one the door screens read, and checks canEdit before the single DELETE. Birthdays, one-offs and extra-text titles are refused (409). Tests cover these cases.
- UI confirmation: the confirm text (dashboard.js `celebConfirmText`) names the whole yearly series, the person, the calendar and the mailbox, and says it goes to Deleted Items. A test checks the Deleted Items wording and that the new block has no innerHTML. README, INSTALL-UBUNTU and CHANGELOG all say deleted items are recoverable in Outlook.
- Errors: plain-language messages for read-only calendar, outage (503), permission (502), not-found (404) and unrecognised entry.
- Demo mode: the in-memory list never calls Graph. A test covers it.
- Privacy: only names and dates are logged.
- No new dependencies. `.env.example` is unchanged, which is correct since there are no new settings.

## Check that proves it done
- Coder's recorded results in the commit message: `npm run check` 289/289 pass. e2e in headless Chrome, DEMO_MODE, 1139 px: 20/20 PASS, no horizontal overflow, screenshot at /tmp/celebrations-1139.png (not committed).
- New tests: 19 in test/celebration-admin.test.js, plus additions in celebrations.test.js and dashboard-page.test.js. They cover list, remove, add, hide, auth, refusal of unparseable events, activity logging, error cases and demo mode.
- Docs, CHANGELOG (inside 2.2.0) and manifests (MANIFEST.txt, SHA256SUMS) are updated.
- Git: one local commit on main, `main...origin/main [ahead 1]`. Nothing was pushed and there is no deploy trace.

## Notes (not blockers)
- src/server.js has whitespace-only reformatting in `failureAnswer` and in the `checkWeatherAlerts` indentation. It has no behaviour change.
- Nothing could be verified against the real calendar, as the plan states.
