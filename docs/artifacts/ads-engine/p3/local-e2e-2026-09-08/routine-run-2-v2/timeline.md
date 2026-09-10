# Routine run 2 (prompt v2) — local rehearsal timeline

Run id `53dea8bd-c10c-4279-90fb-ab63392dc5a9` · worker `local` · base `http://127.0.0.1:3225`
Claimed 2026-09-09T04:36:47Z · lease until 2026-09-08T22:16:47-07:00 · brief `ads-brief-2026-09-10-v1`

## HTTP calls, in order

| # | Call | Status | Result |
|---|---|---|---|
| 1 | POST /api/internal/ads/engine/claim | 200 | run 53dea8bd-c10c-4279-90fb-ab63392dc5a9; duties hygiene, creative; max_structural_per_run 3; 6 proposals already pending |
| 2 | POST /api/internal/ads/engine/runs/53dea8bd.../proposals (batch 1, indexes 0-3) | 200 | index 0 accepted · index 1 REJECTED COPY_REJECTED · index 2 accepted · index 3 accepted |
| 3 | POST /api/internal/ads/engine/runs/53dea8bd.../proposals (batch 2, index 1 only) | 200 | index 1 accepted |
| 4 | POST /api/internal/ads/engine/runs/53dea8bd.../release | 200 | state released, outcome done |

## Per-index result

| Index | Kind | Target | Submission 1 | Submission 2 |
|---|---|---|---|---|
| 0 | create_rsa_challenger | challenger:customers/4454506598/adGroups/22 (Crew scheduling) | accepted `61818898-e53e-4609-bc63-f7985133856b` | — |
| 1 | create_rsa_challenger | challenger:customers/4454506598/adGroups/23 (Quotes & invoices) | rejected `COPY_REJECTED` → issue `HEADLINE_TOO_LONG`, field `headlines[9]`, "34 characters; the limit is 30." | accepted `1d4f5c28-0aad-417a-ba54-8f34d2f8e3d2` |
| 2 | create_rsa_challenger | challenger:customers/4454506598/adGroups/31 (Jobber alternative) | accepted `dd111b91-9dd4-480d-9a7e-fbc6227b762a` | — |
| 3 | observation | observation:29dcf69e ("work order app") | accepted `5ada39a5-15d0-4e37-a063-9dec40364521` | — |

The index-1 rejection was the deliberate rehearsal exercise: the editor-approved copy was saved to
`candidate-clean-1.json`, then one 34-character headline ("Quotes and invoices from the truck") was appended
before the first submission. Fix applied per the prompt's table: restored the approved copy, ran the editor
again, resubmitted only that index.

## Editor verdicts, per candidate and round

| Candidate | Round | File | Verdict | Reason | Fix applied |
|---|---|---|---|---|---|
| 0 (adGroups/22) | 1 | editor-0-round1.json | not approved | weak_copy | Pinned headline 2 "Changes sync when you're back" → "Changes sync when back online" |
| 0 | 2 | editor-0-round2.json / editor-0.json | approved | approved | — |
| 1 (adGroups/23) | 1 | editor-1-round1.json | approved | approved | Took the note anyway: description 1 no longer restates the pinned price headline; now uses the sanctioned "every feature, every tier" |
| 1 | 2 | editor-1-round2.json | approved | approved | — (this revision saved as candidate-clean-1.json) |
| 1 | 3 (after server COPY_REJECTED) | editor-1-round3.json / editor-1.json | approved | approved | — (approved copy restored, over-long headline removed) |
| 2 (adGroups/31) | 1 | editor-2-round1.json | not approved | repetitive | Description 2 rewritten: headline stack → "It works offline. A dead signal in a basement does not stop the job." |
| 2 | 2 | editor-2-round2.json / editor-2.json | approved | approved | — |

Every editor round ran in a fresh subagent whose only inputs were voice.md, brand-facts.json and that candidate.
