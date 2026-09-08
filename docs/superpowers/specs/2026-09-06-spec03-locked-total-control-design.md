# SPEC-03 locked-total control — design

**Date:** 2026-09-06 · **Surface:** ops-web `/admin/spec/[id]` (operator console) · **Branch:** `fix/spec-admin-tier-v2-20260905`
**Contract:** ops-software-bible/SPEC/10_TIER_MODEL_V2.md § 2 + § 6 · 05_ADMIN_UX.md Tab 4 / Tab 5 · 03_WORKFLOW.md scope sign-off.

## 1. Problem

SPEC-03 · PROPRIETARY is the only variable-total tier. P1 is fixed at $6,250 (a quarter of the $25,000 floor); P2–P4 each invoice `(locked_total − P1) ÷ 3` with residual cents on P4. The console already prices P2–P4 from `spec_projects.locked_total_cents` (`specMilestoneSchedule`, `composeMilestonesTab`) and refuses to fire them while the column is null — but **no write path exists**. The column can only be set in Supabase Studio, which is not a product.

Verified live schema (2026-09-06, project `ijeekuhbatykdomumfjx`):

| Object | Fact |
|---|---|
| `spec_projects.locked_total_cents` | `integer`, nullable, no CHECK, no trigger |
| `spec_scope_documents` | `content_json jsonb NOT NULL`, `content_hash text NOT NULL` (sha256 of the JSON), `sent_at`, `superseded_at`, unique `(spec_project_id, version)` |
| `spec_acceptance_events` | `event_type` CHECK admits `scope_signoff`; `scope_document_id` FK → scope doc; `payload_hash` carries the signed doc's `content_hash` |
| `spec_communications.channel` | CHECK admits `system` |
| `notifications` | `type` is free text; `action_url` must be an internal path |
| Writers of `scope_signoff` | **none** in ops-web or ops-site today — the customer countersign is recorded outside the product |
| `spec_projects` rows | 0 in prod |

## 2. Approaches considered

**A. Lock on the project only (Milestones tab input).** One input writes `spec_projects.locked_total_cents`. Simplest, but the figure never lands on the document the customer signs, so the evidence chain (`payload_hash = content_hash`) would not cover the price. Rejected.

**B. Lock at sign-off (two-phase).** Quote on the scope doc; copy to the project only when the `scope_signoff` acceptance lands. Correct in the abstract, but nothing in the product writes that acceptance yet, so the second phase has no trigger — it would need either a DB trigger on `spec_acceptance_events` or a new "record sign-off" control (a separate feature with its own side effects per 05_ADMIN_UX § `discovery → building`). Deferred work is exactly what this control exists to remove. Rejected for now; the design below leaves a clean seam for it.

**C. Lock on the scope doc draft, binding at sign-off (chosen).** The operator locks the total on the *current* scope-doc draft from the Scope Doc tab. One action writes the figure into the doc's `content_json` (re-hashing `content_hash`) **and** onto `spec_projects.locked_total_cents`. The lock stays editable while that doc is unsent and unsigned; once the doc is sent, signed, or P2 is invoiced, the console refuses re-locks and changes go through a change order. Money still cannot move early: P2 keeps its existing `scope_signoff` gate.

Why C: the number must be on the document *before* it goes out, not after; the Milestones tab's invoice gate already enforces the customer's signature; and the customer's `payload_hash` then covers the price. "Locked at scope sign-off" (bible § 2) is honoured as *binding* at sign-off — the operator commits the quote onto the doc, the countersign binds it.

## 3. Design

### 3.1 Placement — where the operator meets it

- **Scope Doc tab, right column, first panel when the tier is SPEC-03: `// LOCKED TOTAL`.** This is where the doc is composed and where the figure belongs. Fixed-total tiers never render it (the tab data carries `lockedTotal: null`).
- **Milestones tab** keeps rendering `—` for P2–P4 until locked; its summary line gains a single link `LOCK TOTAL ON SCOPE DOC →` (`?tab=scope`) and the P2 blocked reason / footer note now say *on the scope doc* instead of *at scope sign-off*, so the operator is pointed at the actual control from the place the block is felt.
- Once locked, the Milestones tab already flips to `LOCKED TOTAL · $31,000` and prices P2–P4. No new surface.

### 3.2 Panel states (SPEC-03 only)

| State | Shows | Control |
|---|---|---|
| No scope doc yet | `[DRAFT V1 FIRST — THE TOTAL LIVES ON THE SCOPE DOC]` | none |
| Unlocked, current doc unsent + unsigned | floor line `FLOOR · $25,000` | dollar input + `LOCK TOTAL` |
| Locked, current doc unsent + unsigned | `LOCKED · $31,000` + split line `P1 $6,250 · P2 $8,250 · P3 $8,250 · P4 $8,250` | dollar input (prefilled) + `RE-LOCK` |
| Current doc sent, not signed | locked figure (or floor) + `[V2 SENT — CUT A NEW REVISION TO CHANGE THE TOTAL]` | none |
| Signed (`scope_signoff` exists) | locked figure + `[SIGNED · SEP 05, 2026 · CHANGES GO THROUGH A CHANGE ORDER]` | none |
| P2 already invoiced (drift: payment without acceptance) | locked figure + `[P2 INVOICED — TOTAL IS BINDING]` | none |
| Engagement closed (`completed` / `cancelled` / `refunded`) | figure or floor + `[ENGAGEMENT CLOSED]` | none |
| Doc figure ≠ project figure (Studio edit / drift) | extra line `[V3 CARRIES $30,000 — RE-LOCK TO SYNC]` | as per state |

Voice: terse, bracketed micro-text, UPPERCASE for authority, sentence case nowhere needed. Numbers in JetBrains Mono, formatted (`$31,000`), empty is `—`.

### 3.3 Modules

**`src/lib/admin/spec-locked-total.ts` (pure, no I/O)**
- `SPEC03_LOCKED_TOTAL_MAX_CENTS` — int4 ceiling (2,147,483,647) so a fat-fingered figure fails with a message instead of a DB error.
- `parseLockedTotalInput(raw)` → `{ ok: true, cents } | { ok: false, reason }`. Accepts `31000`, `31,000`, `$31,000.50`; rejects empty, non-numeric, >2 decimals, below floor, above max. Cents are integers, always.
- `lockedTotalGate({ tier, status, currentDoc, hasScopeSignoff, hasP2Payment })` → `{ allowed: true } | { allowed: false, reason: LockBlockedReason }`. Reason codes: `not_variable_tier` · `no_scope_doc` · `doc_sent` · `signed` · `p2_invoiced` · `engagement_closed`. The UI and the server action share this, so they can never disagree.
- `readScopeDocTotalCents(contentJson)` — reads `content_json.locked_total_cents` defensively (integer or null).
- `withLockedTotal(contentJson, cents)` — returns a new content object with `locked_total_cents` set.
- `scopeContentHash(contentJson)` — `sha256(JSON.stringify(content))`, extracted from `new-scope-revision.ts` so both writers hash identically.
- `composeScopeLockedTotal(params)` → `SpecScopeLockedTotal | null` — the tab projection (floor, project figure via `readLockedTotalCents`, doc figure, signed-at, blocked reason). Null for fixed-total tiers.

**`src/lib/admin/spec-types.ts`** — `SpecScopeTab.lockedTotal: SpecScopeLockedTotal | null`; `LockBlockedReason` type.

**`src/lib/admin/spec-queries.ts`** — `buildScopeTab` takes the project row, acceptance events and payments (already loaded by `getProjectDetail`) and delegates to `composeScopeLockedTotal`.

**`src/lib/admin/spec-milestones.ts`** — reason string becomes `Total not locked — lock it on the scope doc`.

**`src/app/admin/spec/[id]/_actions/lock-total.ts` (server action)**
1. Operator gate re-check (`requireSpecOperatorUserId`, same as every sibling).
2. Read `project_id`, `locked_total`; parse → cents; throw `SYS :: …` on any parse failure.
3. Load the project row (`tier, status, is_test, locked_total_cents, customer_name, customer_email`); load the current scope doc (latest by version, preferring `superseded_at IS NULL`, mirroring `buildScopeTab`); count `scope_signoff` acceptances; count `scope_signoff` payments.
4. `lockedTotalGate` → throw with the reason label when blocked.
5. Write the scope doc: `content_json = withLockedTotal(...)`, `content_hash = scopeContentHash(...)`.
6. Write `spec_projects.locked_total_cents` + `updated_at`.
7. `spec_communications` system row (carries `is_test`): `Total locked at $31,000 on scope doc v2 (SPEC-03 · floor $25,000)` or `Total re-locked $31,000 → $32,500 on scope doc v2`.
8. `notifications` row for the operator (`type: spec_total_locked`, `company_id: OPS_OPERATIONS_COMPANY_ID`, `action_url: /admin/spec/{id}?tab=milestones`, `action_label: VIEW MILESTONES`); failure logged, never blocks.
9. `revalidatePath` for the project page and the board.

Order of writes: doc first, then project. A failure between the two leaves the doc carrying the figure and the project null; re-running the action is idempotent and repairs it. Concurrent operators: last write wins on both rows — acceptable at one operator.

**`src/components/admin/spec/project-detail/ScopeTab.tsx`** — `LockedTotalPanel` per § 3.2, using the tab's existing `Panel` / `EmptyState`, the ETA-editor input classes, and the outlined-accent primary button already used by `NEW SCOPE REVISION`. Accent appears once on the tab (the lock button) only while the control is live; when blocked, nothing on the panel is accent.

**`MilestonesTab.tsx`** — link to the scope tab while unlocked; footer wording per § 3.1.

### 3.4 Not in scope

Recording the customer's `scope_signoff` acceptance (and the `discovery → building` side effects); customer-facing scope view; Stripe. The seam for approach B is `lockedTotalGate` + `composeScopeLockedTotal`: when a sign-off writer lands it re-uses the same gate.

## 4. Tests (vitest, each file green in isolation)

- `src/lib/admin/__tests__/spec-locked-total.test.ts` — parser (every accepted format, every rejection), gate (every reason, the allowed path, precedence when several apply), hash/withLockedTotal (stable, sha256 of the JSON, no mutation of the input), `composeScopeLockedTotal` (null for spec01/02, blocked reasons, mismatch figures, signed-at).
- `src/app/admin/spec/[id]/_actions/__tests__/lock-total.test.ts` — mocks `_require-operator`, `next/cache`, `@/lib/supabase/admin-client` with a table-aware fake: denies non-operators before any read; rejects a sub-floor figure without touching the DB; happy path writes doc content + hash, the project column, a `system` comms row with `is_test`, and the operator notification; blocks when signed; blocks fixed-total tiers.
- `src/components/admin/spec/project-detail/__tests__/ScopeTab.test.tsx` — panel absent for fixed tiers; unlocked/locked/blocked/mismatch renders; input + button presence per state.
- Existing suites updated for the wording change: `spec-milestones.test.ts`, `spec-queries-milestone-fireability.test.ts`, `MilestonesTab.test.tsx` (+ link assertion).
- `tsc --noEmit` with `NODE_OPTIONS=--max-old-space-size=8192`.

## 5. Live proof

Dev server on the worktree with the dev bypass as the real operator (local, uncommitted shims: `jackson` in the bypass allow-list + a dev-only pass in the `/admin` staff gate, both reverted afterwards). An `is_test = true` SPEC-03 engagement with a paid P1 and a V1 scope doc is inserted for the run and deleted afterwards (together with the comms/notification rows the action writes). Screenshots + page text land in `docs/artifacts/spec03-locked-total-20260906/`.

## 6. Bible updates (same session)

- `SPEC/05_ADMIN_UX.md` — Tab 4 gains the LOCKED TOTAL panel + states; Tab 5 wording; the F.2.a status paragraph lists `lock-total.ts`.
- `SPEC/10_TIER_MODEL_V2.md` — status line + § 6 bullet: locked on the scope doc draft by the operator, binding at `scope_signoff`, re-locks refused after send/sign-off.
- `SPEC/03_WORKFLOW.md` — the one Tier-Model-v2 sentence that says the column is written *at* the event now describes the actual mechanism.
