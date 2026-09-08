# SPEC-03 Locked-Total Control Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use custom-skills:executing-plans to implement this plan task-by-task.

**Goal:** Give the operator a real write path for `spec_projects.locked_total_cents` on SPEC-03 engagements — locked on the current scope-doc draft from the Scope Doc tab, binding at the customer's scope sign-off — so the Milestones tab prices and fires P2–P4.

**Architecture:** One pure module (`spec-locked-total.ts`) owns parsing, the lock gate, the scope-doc hash, and the tab projection; the data layer (`spec-queries.ts`) and the server action (`lock-total.ts`) both delegate to it so UI and server can never disagree. The action writes the figure into the current scope doc's `content_json` (re-hashing `content_hash`) and onto the project row, then logs a `spec_communications` system row and an operator notification. The Milestones tab is already wired to the column.

**Tech Stack:** Next.js 15 App Router server actions, Supabase service-role client (`getAdminSupabase`), vitest + @testing-library/react, TypeScript.

**Design System:** `.interface-design/system.md` (OPS Web v2) + `ops-design-system/project/DESIGN.md`. Tokens used: `glass-surface`, `font-cakemono font-light`, `font-mono`, `text-text` / `text-text-2` / `text-text-3` / `text-text-mute`, `border-line` / `border-line-hi`, `bg-surface-input`, `rounded` (5px) / `rounded-chip` (4px), `text-ops-accent border-ops-accent hover:bg-ops-accent hover:text-black` (primary, outlined at rest), `text-olive border-olive/40`, `ease-smooth duration-150`, `tabular-nums`.

**Required Skills:** `ops-design`, `custom-skills:interface-design`, `frontend-design:frontend-design`, `ops-copywriter:ops-copywriter`, `superpowers:test-driven-development`, `custom-skills:audit-design-system` (before calling UI done), `superpowers:verification-before-completion`.

**Design spec:** `docs/superpowers/specs/2026-09-06-spec03-locked-total-control-design.md`.

**Working rules:** worktree `/Users/jacksonsweet/Projects/OPS/ops-web-spec-admin-tier-v2` only; every Bash command starts with an explicit `cd` into it; run each vitest file in isolation (`npx vitest run <file>`); tsc with `NODE_OPTIONS=--max-old-space-size=8192`; conventional commits, no AI attribution, never push.

---

### Task 1: Pure module — parser, gate, hash, projection

**Skills:** `superpowers:test-driven-development`.

**Files:**
- Create: `src/lib/admin/spec-locked-total.ts`
- Modify: `src/lib/admin/spec-types.ts` (add `LockBlockedReason`, `SpecScopeLockedTotal`, `SpecScopeTab.lockedTotal`)
- Test: `src/lib/admin/__tests__/spec-locked-total.test.ts`

**Step 1: Write the failing tests** covering:
- `parseLockedTotalInput`: `"31000"`, `"31,000"`, `"$31,000.50"`, `" 25000 "` accepted → cents; `""`, `"abc"`, `"31000.123"`, `"24999.99"`, `"21474836.48"` rejected with the right reason; result cents are integers.
- `lockedTotalGate`: allowed when spec03 + open status + unsent current doc + no sign-off + no P2; each blocked reason; precedence `not_variable_tier` → `engagement_closed` → `signed` → `p2_invoiced` → `no_scope_doc` → `doc_sent`.
- `scopeContentHash` equals `sha256(JSON.stringify(content))`; `withLockedTotal` returns a new object carrying `locked_total_cents` and does not mutate its input; `readScopeDocTotalCents` reads integers only.
- `composeScopeLockedTotal`: null for spec01/spec02; projects the floor, validated project figure (sub-floor → null), current doc figure + version, `signedAt`, and the gate reason.

**Step 2: Run** `cd <worktree> && npx vitest run src/lib/admin/__tests__/spec-locked-total.test.ts` → FAIL (module missing).

**Step 3: Implement** the module and the types.

**Step 4: Run** the same file → PASS.

**Step 5: Commit** `feat(spec-admin): locked-total parser, gate, and scope-doc projection`.

---

### Task 2: Data layer — project the lock state into the Scope Doc tab

**Files:**
- Modify: `src/lib/admin/spec-queries.ts` (`buildScopeTab` signature + call site in `getProjectDetail`)
- Modify: `src/app/admin/spec/[id]/_actions/new-scope-revision.ts` (use `scopeContentHash`)

**Steps:** `buildScopeTab({ row, scopeDocs, acceptanceEvents, payments })` composes `lockedTotal` via `composeScopeLockedTotal`; `new-scope-revision.ts` drops its private `sha256` for the shared `scopeContentHash`. Run `npx vitest run src/lib/admin/__tests__/spec-queries-milestone-fireability.test.ts` (must stay green) and `tsc`. Commit `refactor(spec-admin): scope tab carries the SPEC-03 lock state`.

---

### Task 3: Milestones tab points at the control

**Skills:** `ops-copywriter:ops-copywriter`, `ops-design`.

**Files:**
- Modify: `src/lib/admin/spec-milestones.ts:121` (reason → `Total not locked — lock it on the scope doc`)
- Modify: `src/components/admin/spec/project-detail/MilestonesTab.tsx` (summary link `LOCK TOTAL ON SCOPE DOC →` while `!totalLocked`; footer note wording)
- Test: `src/lib/admin/__tests__/spec-milestones.test.ts`, `src/lib/admin/__tests__/spec-queries-milestone-fireability.test.ts`, `src/components/admin/spec/project-detail/__tests__/MilestonesTab.test.tsx`

**Steps:** update the three expectations + add a link assertion (`href="/admin/spec/<id>?tab=scope"`, absent when locked) → run each file → FAIL → implement → PASS. Link styling per DESIGN.md § Links: `text-text-2 hover:text-text`, mono 11px uppercase, no accent. Commit `feat(spec-admin): milestones tab links to the locked-total control`.

---

### Task 4: Server action `lockTotal`

**Skills:** `superpowers:test-driven-development`.

**Files:**
- Create: `src/app/admin/spec/[id]/_actions/lock-total.ts`
- Test: `src/app/admin/spec/[id]/_actions/__tests__/lock-total.test.ts`

**Step 1: Failing tests** with a table-aware fake `getAdminSupabase` (thenable query builder, per-table response queues, recorded `update`/`insert` payloads); `vi.mock` for `./_require-operator` and `next/cache`:
- non-operator → throws `SYS :: SPEC OPERATOR GATE DENIED` and `from` never called;
- sub-floor input → throws `SYS :: TOTAL BELOW FLOOR` before any DB read;
- happy path → scope doc update carries `content_json.locked_total_cents` + recomputed `content_hash`; project update carries `locked_total_cents` + `updated_at`; comms insert `{ channel: "system", direction: "outbound", is_test }` with summary naming the figure and doc version; notification insert `{ type: "spec_total_locked", action_url: "/admin/spec/<id>?tab=milestones" }`; `revalidatePath` called for the project page and `/admin/spec`;
- signed engagement → throws with the signed label and writes nothing;
- spec02 → throws `SYS :: LOCK REFUSED · ONLY SPEC-03 …` and writes nothing;
- re-lock → comms summary reads `Total re-locked $31,000 → $32,500 …`.

**Step 2:** run → FAIL. **Step 3:** implement (gate → parse → load project / current doc / sign-off / P2 → `lockedTotalGate` → write doc → write project → comms → notification (non-blocking) → revalidate). **Step 4:** run → PASS. **Step 5:** commit `feat(spec-admin): lock-total server action for SPEC-03 engagements`.

---

### Task 5: Scope Doc tab — `LockedTotalPanel`

**Skills:** `ops-design`, `custom-skills:interface-design`, `frontend-design:frontend-design`, `ops-copywriter:ops-copywriter`, `custom-skills:audit-design-system`.

**Files:**
- Modify: `src/components/admin/spec/project-detail/ScopeTab.tsx`
- Test: `src/components/admin/spec/project-detail/__tests__/ScopeTab.test.tsx`

**Intent checkpoint (interface-design):**
- Intent: the operator, once per SPEC-03 engagement, commits the quoted total onto the scope doc before it goes out; needs to see the floor, the figure, the resulting split, and exactly why the control is closed when it is.
- Palette: monochrome text ladder; olive for the LOCKED chip (positive state); accent only on the LOCK / RE-LOCK button, only while live.
- Depth: borders only, `glass-surface` panel, hairline dividers.
- Typography: `// LOCKED TOTAL` Cake Mono 300 14px title (matches sibling panels); figures JetBrains Mono tabular; bracketed mono 10–11px micro-text.
- Spacing: 8px base; panel `p-5`; internal `gap-2` / `mt-3`.

**Panel states** (see spec § 3.2). Input: `type="text" inputMode="decimal"` with `$` prefix label, `bg-surface-input border-line focus:border-line-hi rounded font-mono text-[12px] tabular-nums` (no accent focus per DESIGN.md § Inputs); button: `rounded border-ops-accent text-ops-accent hover:bg-ops-accent hover:text-black font-mono text-[11px] uppercase tracking-[0.16em]` (same primary treatment as `NEW SCOPE REVISION`).

**Steps:** failing render tests (panel absent when `lockedTotal` is null; unlocked → floor + input + `LOCK TOTAL`; locked + open → `LOCKED` chip, figure, split line, `RE-LOCK`; each blocked reason → bracket text, no form; mismatch line) → FAIL → implement → PASS → run `custom-skills:audit-design-system` on the file → commit `feat(spec-admin): locked-total control on the scope doc tab`.

---

### Task 6: Type-check and the touched suites

Run `cd <worktree> && NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` and every test file touched in Tasks 1–5, each in isolation. Fix anything red before proceeding.

---

### Task 7: Live proof (dev bypass as the real operator)

1. Uncommitted local shims: add `jackson: { email: "j4ckson.sweet@gmail.com", label: "JACKSON" }` to `BYPASS_USERS` in `src/app/api/dev/bypass-token/route.ts`; in `src/app/admin/layout.tsx` accept that email when `NODE_ENV === "development" && DEV_BYPASS_AUTH === "true"`. Never stage either file.
2. `.claude/launch.json` (git-excluded): `npm run dev:webpack -- -p 3450`.
3. Insert an `is_test = true` SPEC-03 fixture (project in `discovery`, paid P1 `spec_payments` row, V1 scope doc) via the Supabase MCP; record the ids.
4. Browser: set cookie `dev-bypass-user=jackson`, open `/admin/spec/<id>?tab=scope`, capture the unlocked panel; enter `31,000`, LOCK TOTAL; capture the locked panel; open `?tab=milestones` and capture P2–P4 priced at $8,250 each; check `?tab=timeline` for the system row and the notification row in the DB; RE-LOCK to `32,500` and confirm the doc hash changed and P4 carries the residual cents; try `24,999` and confirm the refusal.
5. Save screenshots + page text to `docs/artifacts/spec03-locked-total-20260906/`.
6. Delete the fixture rows (project cascades; delete the operator notification rows by id) and revert both shims. Confirm `git status` shows only intended files.

---

### Task 8: Bible + memory

- `ops-software-bible/SPEC/05_ADMIN_UX.md` — Tab 4 panel + states, Tab 5 wording, F.2.a status line adds `lock-total.ts`.
- `ops-software-bible/SPEC/10_TIER_MODEL_V2.md` — status line + § 6 bullet.
- `ops-software-bible/SPEC/03_WORKFLOW.md` — the Tier-Model-v2 sentence about when the column is written.
- Commit in the bible repo: `docs(spec): SPEC-03 locked-total control`.
- Commit artifacts on the ops-web branch: `docs(spec-admin): locked-total control proof artifacts`.
- Update memory `project_spec_admin_tier_v2_rename.md` (open item 2 closed; next spawn ordinal).
