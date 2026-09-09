# Google Ads engine — runbook

Operational reference for the measurement layer (Phase 1) of the Google Ads
engine. Design: `ops-software-bible/specs/2026-09-08-google-ads-engine-design.md`.
Plan: `ops-software-bible/docs/plans/2026-09-08-google-ads-engine-p1-measurement.md`.

Accounts: manager `5448339076` (OPS LTD, holds the developer token) →
serving client `4454506598` (OPS, CAD, America/Vancouver). Service account
`firebase-adminsdk-fbsvc@ops-ios-app.iam.gserviceaccount.com` on Cloud project
`ops-ios-app` (`992104001932`).

## Readiness probe

`node scripts/ads/validate-probe.mjs` (run from a worktree with a real
`.env.local`). Read-only: the mutate uses `validateOnly: true`, and the Data
Manager call uses `validateOnly: true`. Exit `0` when the gate is green, `2`
when any account action is still missing, `1` on a script failure. Every run
writes `docs/artifacts/ads-engine/p1/probe-<timestamp>.json`.

The gate is green only when all four are true:

| Check | Meaning | Who flips it |
|---|---|---|
| `mutateValidateOnly.status === 200` | The service account may write (role Standard on the manager) | Jackson — Google Ads → manager 5448339076 → Admin → Access and security |
| `acceptedCustomerDataTerms` | Customer data terms accepted on the serving account | Jackson — Google Ads → client 4454506598 → Goals → Conversions → Settings |
| `enhancedConversionsForLeadsEnabled` | Enhanced conversions for leads on | Jackson — same settings page |
| `dataManagerReachable` | Data Manager API enabled on Cloud project `ops-ios-app` | Jackson — https://console.developers.google.com/apis/api/datamanager.googleapis.com/overview?project=992104001932 |

### Results

| Probed at (UTC) | Write access | Data terms | EC for leads | Data Manager API | Service-account role | Artifact |
|---|---|---|---|---|---|---|
| 2026-09-08 22:00 | 403 `authorizationError.ACTION_NOT_PERMITTED` | false | false | not probed | READ_ONLY on manager, absent on client | (planning session) |
| 2026-09-09 01:19 | 403 `authorizationError.ACTION_NOT_PERMITTED` | false | false | 403 `PERMISSION_DENIED` / `SERVICE_DISABLED` | READ_ONLY on manager, absent on client | `probe-2026-09-09T01-19-21-347Z.json` |

**Status: BLOCKED.** All four account actions are still missing as of the
latest probe. Everything that needs no write access (client upgrade, planner,
outbox, migrations, click-id capture, warehouse, readiness console) proceeds;
the live conversion-action apply (Task 3 step 5) and the live Data Manager
rehearsal (Task 5 step 5) wait for a green probe.
