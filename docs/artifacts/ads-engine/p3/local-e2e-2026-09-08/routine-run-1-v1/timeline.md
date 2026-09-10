# Routine rehearsal timeline — run 10e4cf67-1fda-4259-92ff-8fcb3ece26b6

Base URL http://127.0.0.1:3225. Worker `local`. Brief `ads-brief-2026-09-10-v1`.
Lease opened 2026-09-08T21:19:40-07:00, 40 minutes.

| # | Call | Status | Result |
|---|------|--------|--------|
| 1 | POST /api/internal/ads/engine/claim | 200 | run 10e4cf67-1fda-4259-92ff-8fcb3ece26b6 claimed; brief with duties hygiene, creative, structure |
| 2 | POST /api/internal/ads/engine/runs/10e4cf67-1fda-4259-92ff-8fcb3ece26b6/proposals | 200 | 6 proposals, 6 accepted, 0 rejected |
| 3 | POST /api/internal/ads/engine/runs/10e4cf67-1fda-4259-92ff-8fcb3ece26b6/release | 200 | state released, outcome done |

## Per-proposal result, submission 1 (the only submission)

| index | kind | target | result |
|-------|------|--------|--------|
| 0 | add_negatives | NEG · Job seekers | accepted — negatives:NEG · Job seekers:2fe6e892 |
| 1 | add_negatives | NEG · Homeowner intent | accepted — negatives:NEG · Homeowner intent:68ca49f9 |
| 2 | add_negatives | NEG · Training | accepted — negatives:NEG · Training:800c051c |
| 3 | add_negatives | NEG · Generic waste | accepted — negatives:NEG · Generic waste:20cc464c |
| 4 | observation | COMPETITOR · CA conversion import | accepted — observation:7733c7da |
| 5 | observation | BRAND · CA budget ceiling | accepted — observation:af18445c |

No proposal was rejected, so no server fix loop ran. Zero validation codes were returned.

## Editor gate (off the wire, local subagents)

| candidate | ad group | round 1 | round 2 | outcome |
|-----------|----------|---------|---------|---------|
| candidate-4 | 22 Crew scheduling | not approved, unsupported_claim | not approved, repetitive | dropped, never submitted |
| candidate-5 | 23 Quotes & invoices | not approved, unsupported_claim | not approved, repetitive | dropped, never submitted |
| candidate-6 | 31 Jobber alternative | not approved, unsupported_claim | not approved, repetitive | dropped, never submitted |

Because no challenger cleared the editor, the planned deliberate COPY_REJECTED exercise
(a 34+ character headline attached to the Crew scheduling proposal) had no approved
candidate to attach to and was not performed. No candidate-clean-4.json exists.
