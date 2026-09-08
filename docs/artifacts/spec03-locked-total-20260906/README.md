# SPEC-03 locked-total control — live proof (2026-09-06)

Branch `fix/spec-admin-tier-v2-20260905` · worktree dev server on :3450 · dev bypass as the real operator
(`j4ckson.sweet@gmail.com`, users row `1746a0c1`, `spec.admin` override) via two local, uncommitted shims
(bypass allow-list + dev-only `/admin` staff-gate pass), both reverted afterwards.

Fixture: an `is_test = true` SPEC-03 engagement `8964fd86-d854-4b11-8284-db58043d4d19` (status `discovery`,
paid P1 `$6,250`, scope doc V1) inserted for the run and **deleted afterwards** together with the two
`spec_total_locked` notification rows the action wrote. `spec_projects` is back to 0 rows.

Captures are full-page PNGs at 2× from headless Chromium (`capture-spec03.mjs`, run from this folder) plus the
page text (`.txt`) the same run read from `<main>`.

| Step | Files | Proves |
|---|---|---|
| 01 | `01-unlocked-{scope,milestones}` | Scope Doc tab: `NOT LOCKED · —`, floor, input + `LOCK TOTAL`. Milestones: `FLOOR · FROM $25,000`, `LOCK TOTAL ON SCOPE DOC →` link, P2–P4 `—`. |
| 02 | `02-locked-31000-{scope,milestones,timeline}` | Locked `$31,000` through the real action: `LOCKED` chip, split `P1 $6,250 · P2–P4 $8,250`, `RE-LOCK`; doc JSON carries `locked_total_cents: 3100000` under a new hash; Milestones price P2–P4 and P2 waits only on the customer's sign-off; Timeline shows the system row. |
| 03 | `03-relocked-32500-50-{scope,milestones}` | Re-lock to `$32,500.50`: residual cents on P4 (`$8,750.16 / $8,750.16 / $8,750.18`); comms row `Total re-locked $31,000 → $32,500.50 on scope doc v1`; second notification `Total re-locked`. |
| 03b | `03b-refusal-below-floor.txt` | `24,999` → `SYS :: TOTAL BELOW FLOOR · $25,000` from the live action; database unchanged. |
| 04 | `04-doc-sent-scope` | Doc marked sent → control closed: `[V1 SENT — CUT A NEW REVISION TO CHANGE THE TOTAL]`, no form. |
| 05 | `05-signed-{scope,milestones}` | Customer `scope_signoff` recorded (payload hash = doc hash) → `[SIGNED · SEP 06, 2026 — CHANGES GO THROUGH A CHANGE ORDER]`; Milestones now offers `FIRE P2 INVOICE` at `$8,750.16`. |

Database rows observed after step 02 (queried live): `spec_projects.locked_total_cents = 3100000`;
`spec_scope_documents.content_json = {"features":["takeoff","pricing"],"locked_total_cents":3100000}` with
`content_hash 165593888c…`; `spec_communications` system row `Total locked at $31,000 on scope doc v1 (SPEC-03 · floor $25,000)`
(`is_test = true`, logged by the operator); `notifications` row `type spec_total_locked`, `action_url /admin/spec/<id>?tab=milestones`,
`action_label VIEW MILESTONES`, `company_id 00000000-0000-0000-0000-00000000000a`.

Automated coverage (each file green in isolation): `src/lib/admin/__tests__/spec-locked-total.test.ts` (38),
`src/app/admin/spec/[id]/_actions/__tests__/lock-total.test.ts` (13), `src/components/admin/spec/project-detail/__tests__/ScopeTab.test.tsx` (11),
`MilestonesTab.test.tsx` (7), `spec-milestones.test.ts` (16), `spec-queries-milestone-fireability.test.ts` (3); `tsc --noEmit` clean;
`scripts/check-slash-opacity.mjs` clean.
