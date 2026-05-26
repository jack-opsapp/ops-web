# INBOX CATEGORY AUDIT
*Date: 2026-05-12 — author: P3-1 research agent*
*Scope: ops-web inbox filter rails (COMMITMENTS / SCHEDULED / NEEDS_REPLY / DONE).*
*Out of scope: code changes, classifier prompt edits, schema changes, visual rework.*

---

## 1. SUMMARY

Jackson's complaint ("these don't have clear, distinct, useful meaning") is *correct on all
three axes*. Production data shows:

- **2 of the 4 rails are zombie tabs.** `SCHEDULED` and `DONE` have **0 rows** in production
  (3,404 total threads). The operator never snoozes and never archives, so two of the four
  filter tabs are screen real-estate for a behavior the user has not adopted.
- **`NEEDS_REPLY` is undersized.** The rail shows 312 threads (gated on the `AWAITING_REPLY`
  label). **1,651 unread inbound threads have no `AWAITING_REPLY` label** and never appear in
  the rail. The in-column group header `// NEEDS REPLY` uses a different formula (unread
  inbound) and surfaces those 1,651 — same words, two definitions.
- **`COMMITMENTS` is real but tiny and overlapping.** 38 rows, of which 14 (37%) also carry
  `AWAITING_REPLY`. The label "COMMITMENTS" reads ambiguously to a trades operator (sounds
  like jobs they committed to, not promises Phase C extracted).

**Recommendation (Option B, §5):** collapse the four rails into three —
**`YOUR MOVE` / `WAITING` / `ARCHIVED`** — drop SCHEDULED as a rail (snooze becomes a thread
action that hides the thread), demote DRAFTS to an inline chip, and keep the 12-class
`primary_category` LLM taxonomy alive *only* as horizontal filter chips beneath the rails.
This is structural — Phase 4 visual rework still owns the chip / badge design.

---

## 2. CURRENT STATE PER CATEGORY

### Terminology disambiguation

There are **three taxonomies** in play. Jackson's complaint is about taxonomy (3); the audit
must keep them separate or recommendations get tangled.

| # | Taxonomy | Type | Owner | Surface |
|---|---|---|---|---|
| 1 | `primary_category` | enum, 12 values (one of CUSTOMER / VENDOR / SUBTRADE / PLATFORM_BID / LEGAL / JOB_SEEKER / COLLECTIONS / MARKETING / RECEIPT / PERSONAL / INTERNAL / OTHER — *plus legacy LEAD/CLIENT retained in TS union for transitional code, no rows in prod*) | Phase C LLM classifier — `thread-classifier-service.ts:85-176` | Category chip on thread row + detail header + horizontal filter chip strip |
| 2 | `labels` | array, 6 values (URGENT / AWAITING_REPLY / HAS_ATTACHMENT / HAS_QUOTE / HAS_INVOICE / FROM_NEW_SENDER) | Phase C LLM classifier | Inline pills on row; gates the NEEDS_REPLY rail |
| 3 | `InboxRail` filter tab | enum, 6 values: `everything / needs_reply / drafts / commitments / scheduled / done` | App code — `email-thread.ts:107-113`, filter logic in `email-thread-service.ts:636-662` | Filter-tab dropdown above thread column (`thread-column-header.tsx:50-75`) |

Plus a **fourth, independent grouping** lives inside any given rail: in-column group
headers `NEEDS_INPUT / NEEDS_REPLY / DRAFTS_READY / AWAITING_THEM / LATER`
(`src/lib/inbox/grouping.ts:28-41`). These are derived per-render from `agent.needsInput`,
`phaseC`, `unread`, and `ts`. **The rail name "NEEDS_REPLY" and the group name "NEEDS_REPLY"
share a string but use different formulas** (rail = `AWAITING_REPLY` label; group = unread
inbound). This is the literal "not distinct" symptom Jackson named.

### Bible drift (state explicitly per `feedback_specs_must_be_production_ready.md`)

- `ops-software-bible/07_SPECIALIZED_FEATURES.md:4702` says "four-rail segmented control"
  with rails `Needs reply / Everything / Scheduled / Done`. The code has **five** valid
  rails (the bible's four plus `commitments`), and the UI renders **six** options (adds
  `drafts`, sourced from a separate `/api/inbox/drafts` endpoint that merges provider drafts
  with `ai_draft_history`). Bible is stale at sections § 19 split-rails and § 19 classifier.
- `07_SPECIALIZED_FEATURES.md:4711` says "ALL + **13 categories**". The DB CHECK and the
  classifier prompt are at **12** (LEAD/CLIENT were collapsed into CUSTOMER per migration
  `20260428061836_collapse_lead_client_to_customer`). `email-thread.ts:23-37` retains
  LEAD/CLIENT in the TS union with a comment calling it a "tracking issue: cross-codebase
  rename of LEAD/CLIENT → CUSTOMER references in widgets, tests, and chip mappings".
- Per-category autonomy table at `07_SPECIALIZED_FEATURES.md:4737-4746` still lists LEAD and
  CLIENT as separate categories.

The bible needs to be updated as part of the implementation phase; this audit doesn't write
to the bible.

### Per-rail breakdown

For each rail, I list intended meaning (from code), actual usage (SQL counts), and UI
surfaces. Rail filter implementations are quoted verbatim from
`src/lib/api/services/email-thread-service.ts:636-662`.

#### COMMITMENTS

- **Intended meaning** — threads where Phase C extracted an unresolved promise (yours or
  theirs) with a due date. Implementation:
  ```ts
  case "commitments":
    query = query
      .eq("has_unresolved_commitments", true)
      .is("archived_at", null);
  ```
  The flag `has_unresolved_commitments` is denormalized from `agent_memories` rows by a DB
  trigger (`recompute_thread_commitments`, migration 077). Sorted by
  `next_commitment_due_at ASC`. No definition of the term appears in the user-facing
  dictionary (`src/i18n/dictionaries/en/inbox.json`); the rail title `// COMMITMENTS` is the
  user's only signal.
- **Actual usage** — **38 rows** (1.1% of 3,404 threads). 14 of the 38 (37%) also have an
  `AWAITING_REPLY` label.
- **UI surface** — Filter tab `[COMMITMENTS ▾]`. Inline pills at thread-detail
  top (`commitmentPills.label` in dictionary). Resolve affordance: ✓ button on the today-bar
  via `nextCommitmentId` + `PATCH /api/inbox/commitments/:id`.

#### SCHEDULED

- **Intended meaning** — snoozed threads, where `snoozed_until` is in the future.
  Implementation:
  ```ts
  case "scheduled":
    query = query
      .is("archived_at", null)
      .not("snoozed_until", "is", null)
      .gt("snoozed_until", new Date().toISOString());
  ```
- **Actual usage** — **0 rows**. The operator has snoozed nothing.
- **UI surface** — Filter tab `[SCHEDULED ▾]`. Empty-state copy
  (`empty.title: "Inbox zero"`). Snooze action exposed on every thread via more menu and via
  the per-row state-tag — but the action is unused at the company scope queried here.

#### NEEDS_REPLY

- **Intended meaning** — unarchived, not-snoozed threads where Phase C has tagged the thread
  `AWAITING_REPLY`. Implementation:
  ```ts
  case "needs_reply":
    query = query
      .is("archived_at", null)
      .or("snoozed_until.is.null,snoozed_until.lt." + new Date().toISOString())
      .contains("labels", ["AWAITING_REPLY"]);
  ```
  The `AWAITING_REPLY` label is set by the classifier when the **last message** is inbound
  **AND** asks a direct question/requests action and a reply is "reasonably expected"
  (`thread-classifier-service.ts:122-123`). It can also be set heuristically during the
  activities backfill (`07_SPECIALIZED_FEATURES.md:4672` notes "regex heuristics" but the
  current code path is classifier-driven).
- **Actual usage** — **312 rows** (9.2% of all threads). Distribution by primary_category
  (sampled n=1000 per category):
  - CUSTOMER: 262 of 546 (48%)
  - VENDOR: 17 of 142 (12%)
  - MARKETING: 4 of 1000 sampled (0.4% — noise)
  - RECEIPT: 3 of 697 (0.4% — noise)
- **The headline mismatch:** 1,651 threads have `unread_count > 0` AND
  `latest_direction = 'inbound'` AND no `AWAITING_REPLY` label. These appear in the
  *in-column* NEEDS_REPLY group (when the operator views ALL or any other rail) but are
  invisible from the NEEDS_REPLY rail. Same label, two truths.
- **UI surface** — Filter tab `[NEEDS REPLY ▾]`. Sidebar unread badge sums
  `unread_count` across the first page of the NEEDS_REPLY rail
  (`use-inbox-threads.ts:299-307` — so the sidebar undercounts by the same factor: 27
  unread of 312 in rail vs. 1,651 unread total).

#### DONE

- **Intended meaning** — archived threads. Implementation:
  ```ts
  case "done":
    query = query.not("archived_at", "is", null);
  ```
- **Actual usage** — **0 rows**. The operator has archived nothing.
- **UI surface** — Filter tab `[DONE ▾]`. Also accessed via the "More" menu →
  "ARCHIVED THREADS" item (`more.archive` in dictionary).

#### EVERYTHING (out of scope of complaint but listed for completeness)

- **Intended meaning** — all unarchived, not-snoozed threads.
- **Actual usage** — **3,404 rows** (everything in the table; no snoozed, no archived).
- This is the user's effective default.

#### DRAFTS (out of scope of complaint but listed for completeness)

- **Intended meaning** — threads where there's an unsent draft (provider draft in Gmail/M365
  drafts folder OR `ai_draft_history.status = 'drafted'`).
- **Actual usage** — separate endpoint, not measured here. The DRAFTS rail isn't even in the
  threads endpoint's `VALID_FILTERS` set (`route.ts:30-36`) — it's fetched from
  `/api/inbox/drafts` and rendered separately. So the DRAFTS "rail" is a different data
  source pretending to be the same UI control.

### Phase C classifier confidence (the 12-class `primary_category` taxonomy)

For reference, the LLM classifier confidence (`category_confidence`) is **healthy** across
the 12 categories. Bimodal: high-confidence on noise (MARKETING / RECEIPT / PLATFORM_BID),
high-confidence on CUSTOMER, lower on OTHER (correctly).

| category | rows | % | confidence p50 | confidence p90 |
|---|---|---|---|---|
| MARKETING | 1686 | 49.5% | 0.99 | 0.99 |
| RECEIPT | 697 | 20.5% | 0.97 | 0.98 |
| CUSTOMER | 546 | 16.0% | 0.97 | 0.98 |
| VENDOR | 142 | 4.2% | 0.88 | 0.92 |
| OTHER | 120 | 3.5% | 0.41 | 0.72 |
| SUBTRADE | 64 | 1.9% | 0.88 | 0.94 |
| PLATFORM_BID | 61 | 1.8% | 0.99 | 0.99 |
| INTERNAL | 46 | 1.4% | 0.96 | 1.00 |
| PERSONAL | 22 | 0.6% | 0.95 | 0.99 |
| LEGAL | 8 | 0.2% | 0.87 | 0.98 |
| COLLECTIONS | 7 | 0.2% | 0.97 | 0.97 |
| JOB_SEEKER | 5 | 0.1% | 0.98 | 0.98 |
| LEAD / CLIENT | 0 | 0% | — | — |

**70% of the inbox is MARKETING + RECEIPT.** That's the true shape of the data.

User overrides are vanishingly rare: 6 total rows in `email_thread_category_corrections`
across all time. The user is not engaging the recategorize affordance, which is also a
signal — either the LLM is right enough not to bother, or the user doesn't perceive enough
benefit to correct.

The 12-class LLM taxonomy is **not** what's broken. It's the *rails* (taxonomy #3) and the
*labels* (taxonomy #2 — specifically `AWAITING_REPLY`'s coverage of the user's intuition of
"unread mail that needs a reply") that don't line up.

### Background reality: the backfill drain Jackson called out

The user noted "56 NEVER_CLASSIFIED rows and 3,199 historical rows with a category but no
`ai_summary`". My query confirms an even larger drain:

- `primary_category IS NULL`: **0 rows** (NEVER_CLASSIFIED was never a stored sentinel
  literal in prod for this company; it's at NULL elsewhere, or the cleanup migration ran).
- `ai_summary IS NULL`: **3,257 rows (95.7% of the table)**. The classifier has been writing
  `primary_category` without writing `ai_summary` for almost the entire table.

This is a *separate* problem from the category taxonomy — the AI summary band that should
appear in the detail view is unpopulated for nearly all threads. Per the prompt I'm told not
to propose a backfill; flagging only so the audit reader knows: **any UI that relies on
`ai_summary` is currently rendering the defensive fallback (`"Classification unavailable —
open the thread to read it directly."`) for ~96% of threads**. Recent commits (`566aef7c
fix(inbox): defer thread classify with after() so ai_summary actually lands`) show this is a
known live issue being worked.

This means the "AI summary" affordance is not currently a strong reason to keep or kill any
particular rail — it's broken table-wide regardless.

---

## 3. OBSERVED PROBLEMS

Each problem cited with code-line or SQL evidence so the implementation phase can verify
without re-running the audit.

### Problem 3.1 — Two zero-rows rails

Evidence: production query against `email_threads`.

- `SCHEDULED`: 0 rows.
- `DONE`: 0 rows.

Cause: the operator does not use snooze or archive. The UI offers six tabs (`everything`,
`needs_reply`, `drafts`, `commitments`, `scheduled`, `done`); two of them have always been
empty for this user and likely will be unless onboarding teaches snooze/archive.

Impact: every visit to the inbox header costs the operator a tab-scan that includes two
choices they have ruled out. The "Inbox zero" empty state (`empty.title` dictionary key) is
designed beautifully — but they never see it because the rail is always 0 anyway.

### Problem 3.2 — Rail/group name collision: NEEDS_REPLY

Same words, two different queries:

- **Rail** `needs_reply` (`email-thread-service.ts:637-642`):
  `archived_at IS NULL AND (snoozed_until IS NULL OR snoozed_until < now()) AND labels @> '{AWAITING_REPLY}'`
- **In-column group** `NEEDS_REPLY` (`grouping.ts:60-69`):
  `!closed AND phaseC !== 'auto_sent' AND !agent.needsInput AND phaseC !== 'ai_drafted' AND draftKind !== 'ai'|'user' AND unread === true`

Evidence: rail returns **312 rows**; in-column group covers **1,651 additional threads**
(unread inbound without `AWAITING_REPLY`). When the operator clicks NEEDS REPLY hoping to
see what they owe a reply on, they see 312 threads. When they click ALL and scroll, they see
the same 312 plus 1,651 more under a `// NEEDS REPLY` header.

The classifier sets `AWAITING_REPLY` conservatively ("only apply if a reply is reasonably
expected" — `thread-classifier-service.ts:122-123`). The operator's mental model is
permissive ("if it's unread and from a person, I might need to do something").

### Problem 3.3 — COMMITMENTS as a rail overlaps NEEDS_REPLY and means something the operator can't predict

Evidence: 14 of 38 commitment threads (37%) also carry `AWAITING_REPLY`. The COMMITMENTS
rail does NOT exclude snoozed threads (it filters only on `archived_at IS NULL` and
`has_unresolved_commitments`); the SCHEDULED rail also shows snoozed threads. Today these
two rails don't fight because SCHEDULED is empty, but the design has them silently
overlapping.

Label-meaning evidence: the noun "COMMITMENTS" is not defined anywhere in
`src/i18n/dictionaries/en/inbox.json`. The rail title is the operator's only signal. To a
trades business owner the word maps to "things I've committed to (jobs, schedules, bids)",
not to "threads where Phase C found a promise with a date in them." The actual semantic is
LLM-extracted-promise-fact denormalized from `agent_memories`.

### Problem 3.4 — Rail filter dimension is conflated with status-disposition dimension

The 6 rails mix three logical types:

- **State** (mutually exclusive with each other and with everything else):
  - `done` = `archived_at IS NOT NULL`
  - `scheduled` = `snoozed_until IS NOT NULL AND > now()`
- **Triage signal** (overlapping lenses on the active pile):
  - `needs_reply` = has the AWAITING_REPLY label
  - `commitments` = has unresolved commitment memories
- **Catch-all**:
  - `everything` = unarchived, not snoozed (effectively ALL ACTIVE)
- **Different data source pretending to be a rail**:
  - `drafts` = unsent drafts (provider + AI) — not even in `VALID_FILTERS` for the threads
    route (`route.ts:30-36`)

The operator's mental model wants the rails to be a *partition* ("show me one bucket at a
time"). They are not. Two are state-exclusive, two are overlapping signals, one is a
catch-all, one is a different data source. Without a clear conceptual frame, the labels
have to do all the work — which is exactly where the user's "clear, distinct, useful"
critique lands.

### Problem 3.5 — DRAFTS lives in the rail row but isn't a rail

`thread-column-header.tsx:68-75` lists six rail options including `drafts`. But the
`/api/inbox/threads` route's `VALID_FILTERS` set only includes five (`everything`,
`needs_reply`, `scheduled`, `done`, `commitments` — `route.ts:30-36`); DRAFTS is fetched
from `/api/inbox/drafts` entirely separately (`use-inbox-threads.ts:529-553`). If the
operator picks DRAFTS in the filter dropdown, the result is sourced differently than every
other rail. UX wise: looks like a rail; mechanically: a different page.

### Problem 3.6 — Sidebar unread badge tracks a stale view

`useInboxUnreadCount` (`use-inbox-threads.ts:297-321`) sums `unread_count` across the first
page of the NEEDS_REPLY rail. Because that rail filters on `AWAITING_REPLY` label (312
threads — only 27 with unread), the sidebar badge **systematically undercounts** the unread
pile by an order of magnitude.

Evidence:
- Unread in NEEDS_REPLY rail page-1: ~27
- Total unread inbound: 1,651+
- Sidebar tells the operator about ~1.6% of their actual unread mail.

Out of scope to fix now, but listed because any "category" change ripples into this counter.

### Problem 3.7 — Recategorize modal options don't match the canonical category set

`src/i18n/dictionaries/en/inbox.json:512-521` defines the recategorize modal options as
`NEEDS REPLY / FYI / SCHEDULED / CLOSED / SPAM / CUSTOMER / LEAD`. The CHECK constraint and
TS union allow CUSTOMER / VENDOR / SUBTRADE / PLATFORM_BID / LEGAL / JOB_SEEKER /
COLLECTIONS / MARKETING / RECEIPT / PERSONAL / INTERNAL / OTHER. The modal offers values
that aren't valid `primary_category` values (NEEDS_REPLY isn't a primary_category — it's a
label) and offers LEAD (which the DB collapsed to CUSTOMER). Stale dictionary; recategorize
flow is partially broken (will either fail validation or fall through to OTHER).
**Out of scope to fix**, but it confirms how badly the layered taxonomies have drifted.

---

## 4. OPTIONS

Four options ordered roughly by ambition. Each option states the structural change, the
implementation effort at OPS-Web AI-assisted velocity, and the explicit ripples into P3-2
(caught-up state per filter), P3-3 (search scope), and Phase 4 (visual rework).

For all options: the 12-class `primary_category` LLM taxonomy stays. It's accurate, the user
doesn't fight it (6 corrections ever), and it's load-bearing for the dashboard widgets
(`inbox-leads-widget`, `phase-c-autonomy-widget`) and crons (`stale-leads`).

### Option A — Sharpen and keep all four

Tighten each rail's definition and rename for clarity. No structural change.

Specifics:
- Rename `SCHEDULED` → `SNOOZED` (correct verb). Keep behavior.
- Rename `DONE` → `ARCHIVED` (correct verb). Keep behavior.
- Broaden NEEDS_REPLY rail to include unread inbound regardless of `AWAITING_REPLY` label:
  add `OR (latest_direction = 'inbound' AND unread_count > 0)` to the rail query. Brings the
  rail up to ~1,963 threads (312 + 1,651) — matches the user's permissive mental model.
- Reword the LLM classifier prompt's AWAITING_REPLY definition to better cover the misses
  (out-of-scope to draft here).
- Drop the in-column `// NEEDS REPLY` group header (rail filter already does the work),
  keep only DRAFTS_READY / AWAITING_THEM / LATER / NEEDS_INPUT as in-column groups.
- Define `COMMITMENTS` in copy: e.g. "// COMMITMENTS — promises with a deadline".
- Fix the recategorize modal options to use the canonical `primary_category` set.

**Pros**
- Smallest change. Nothing dies. The data model is unchanged.
- The rail/group name collision is resolved.
- Sidebar badge becomes accurate after the NEEDS_REPLY rail is broadened.

**Cons**
- SCHEDULED + ARCHIVED still 0 rows. Renaming them doesn't make them used. We've kept
  zombie tabs, just better-named ones.
- The COMMITMENTS-vs-NEEDS_REPLY overlap (37%) remains. Operator still has to pick which
  tab to look in.
- Doesn't address the conceptual mush — rails still mix state and signal.

**Effort estimate**: 1 session (small UI rename, dictionary updates, one server-side query
broadening, one in-column group header removed). Including bible update + test updates.

**Ripple**:
- *P3-2 (caught-up state)*: still 6 caught-up states to design — but two are now permanently
  empty by user behavior. Recommend per-rail tactical copy; the empty rails get a "// QUIET
  · nothing waiting" treatment rather than the celebratory "Inbox zero" current default.
- *P3-3 (search scope)*: independent. Search across rails behaviour unchanged.
- *Phase 4 (visual rework)*: category chips on rows remain. Today-bar's commitment ✓
  affordance survives. Re-skin only.
- *iOS sync*: zero schema change. Safe.

### Option B — Collapse to 3 rails: YOUR MOVE / WAITING / ARCHIVED (recommended)

Replace the 4-rail system with 3 rails framed by *whose turn it is*.

Specifics:
- **`YOUR MOVE`** (default tab) — the answer to "what do I do next?"
  Query: `archived_at IS NULL AND (snoozed_until IS NULL OR snoozed_until < now()) AND (`
    `has_unresolved_commitments = true`
    `OR labels @> '{AWAITING_REPLY}'`
    `OR (latest_direction = 'inbound' AND unread_count > 0)`
    `OR agent_blocking_question IS NOT NULL`
  `)`
  Sort: `next_commitment_due_at ASC NULLS LAST, last_message_at DESC`.
  In-column group headers within YOUR MOVE: `// PHASE C NEEDS INPUT` → `// COMMITMENTS DUE`
  → `// UNREAD` → `// WAITING ON REPLY`.
- **`WAITING`** — "ball is in their court; I'm done for now"
  Query: `archived_at IS NULL AND (snoozed_until IS NULL OR snoozed_until < now()) AND
  has_unresolved_commitments = false AND NOT labels @> '{AWAITING_REPLY}' AND
  NOT (latest_direction = 'inbound' AND unread_count > 0)`.
  Sort: `last_message_at DESC`.
  In-column groups: `// AWAITING THEM` (last direction outbound, ≤14d) → `// LATER` (older).
- **`ARCHIVED`** — `archived_at IS NOT NULL`. (Renamed from DONE.)

**Snooze becomes a thread action only.** Snoozed threads disappear from `YOUR MOVE` and
`WAITING` until the snooze fires. No SCHEDULED rail. A persistent counter in the header
(`// 3 SNOOZED ▾`) gives access to the snoozed list via a popover for transparency; this
counter shows even when 0 (always-visible `// 0 SNOOZED`) is bad — show only when count > 0
(empirically that's almost never today).

**DRAFTS becomes an inline chip.** Each row with a draft gets a `// DRAFT READY` pill (today
the dictionary has `row.stateDraftReady` already). Header gets a counter
`// 0 DRAFTS ▾` that opens the dedicated drafts surface (preserves the existing
`/api/inbox/drafts` endpoint). Or — if Jackson prefers — DRAFTS stays as a rail but with the
explicit acknowledgement that it's a different data source.

**Category chips stay.** The 12-class `primary_category` continues to render as horizontal
filter chips below the rail row (CUSTOMER / VENDOR / SUBTRADE / PLATFORM_BID / LEGAL /
COLLECTIONS / MARKETING / RECEIPT / PERSONAL / INTERNAL / JOB_SEEKER / OTHER). These remain
useful for *narrowing* — "YOUR MOVE filtered to CUSTOMER" is a high-leverage view.

**Pros**
- Maps to a single mental model: ball-in-court ("yours / theirs / closed"). The user reads
  three rail names and they form a sentence.
- Drops zero-row tabs.
- The headline "where do I go next?" view (YOUR MOVE) folds together commitments +
  needs-reply + unread + agent-blocking-question; the user no longer has to choose between
  COMMITMENTS and NEEDS_REPLY tabs.
- Sidebar unread badge can shift to the YOUR MOVE count, which is meaningful.
- The rail/group name collision goes away: YOUR MOVE is the rail name, and inside it the
  groups are `COMMITMENTS DUE` / `UNREAD` / `WAITING ON REPLY` — different words.

**Cons**
- Higher implementation effort than Option A: one new compound query, three rail labels and
  copy, snooze surfaced via header counter, draft surfaced via inline chip + header counter.
- Operators who *had* learned the current 6-tab system have to relearn. Migration risk is
  low (small user base, currently 1 active operator) but worth flagging.
- Snooze surface is reduced; if the user *should* be snoozing more and hasn't, this design
  hides snooze behind a counter. Counter-argument: the user has chosen not to snooze in
  3,404 threads, so the SCHEDULED rail isn't earning its real estate.

**Effort estimate**: 1–2 sessions for the rail rewrite (server query, route filter parse,
column header, dictionary, in-column grouping reorg, dedicated drafts surface). Plus bible
update. Phase 4 will redo the visual chrome on top.

**Ripple**:
- *P3-2 (caught-up state)*: now 3 caught-up states instead of 6. Distinct per rail:
  - YOUR MOVE caught-up: `// CAUGHT UP\n[—] nothing waiting on you` (tactical, owns the
    "inbox zero" emotional payoff)
  - WAITING caught-up: `// QUIET\n[—] no recent waits`
  - ARCHIVED empty: `// EMPTY\n[—] nothing archived yet`
- *P3-3 (search scope)*: search expectation gets cleaner. With one dominant rail
  (YOUR MOVE), the search should *filter that rail*. ⌘K command palette stays for global
  navigation, but typing in the header search filters threads inside the current rail.
- *Phase 4 (visual rework)*: category chips on lead cards persist. Thread row should grow a
  secondary chip slot for the in-rail context tag (`COMMITMENT DUE · FRI`, `UNREAD · 2D`,
  `DRAFT READY`). Detail header keeps the category chip + opens a new chip for the active
  triage signal.
- *iOS sync*: zero schema change — all logic is server-side query construction. Safe per
  `project_ios_supabase_sync_constraint.md`.

### Option C — Rip out rails; single feed sorted by urgency score

Single thread feed of active (non-archived) threads, sorted by a composite urgency score.
No rail tabs. ARCHIVED is a separate page, accessed via "More → Archived threads".

Specifics:
- Score: weighted combination of (commitment soonest-due, unread age, AWAITING_REPLY label,
  latest direction, opportunity stage, FROM_NEW_SENDER, URGENT label).
- The "what do I do?" framing becomes "the top of the list is what I do." All categorization
  is implicit in the sort order.
- Category chips remain for narrowing (CUSTOMER / VENDOR / ...).

**Pros**
- Maximally simple mental model. One list. No tab choices.
- Eliminates ALL of the rail/group/name collisions.

**Cons**
- The user *cannot predict* what they'll see. Hidden ranking is a black box; if the score is
  wrong they have no recourse beyond "click around and hope."
- Loses the visible signal that there's an explicit COMMITMENTS pile, which the operator's
  current behavior says they want to *see* (commitments rail exists and has 38 rows;
  someone wired this in deliberately).
- AI-driven scoring without user calibration is dangerous in trades — the operator who
  loses a $40k deck quote to a misranked thread is going to walk.

**Effort estimate**: 2–3 sessions for the scorer, plus extensive tuning. Recommended only
if the ranking model is explainable per-row (a visible "why is this here?" affordance).

**Ripple**:
- *P3-2*: only one caught-up state — easier to design.
- *P3-3*: search must filter the feed in place. Lower complexity than Option B.
- *Phase 4*: rail UI disappears. Detail rail keeps category chip and grows an explainer
  ("ranked #3 because: 2 days unread + open commitment due tomorrow").
- *iOS sync*: zero schema change.

### Option D — Hide the rails behind a "View" menu; default to ALL with smart groups

Pragmatic middle-ground. Keep all 6 rails as logical filters, but only ever show ONE in the
header by default (ALL). The other 5 move into a "View" dropdown.

Specifics:
- Header: `// INBOX  [VIEW ▾]  [CATEGORY ▾]` — view chooser collapses today's filter
  dropdown into a quieter affordance.
- Default view = ALL. In-column groups carry the triage signal: `NEEDS INPUT` →
  `COMMITMENTS DUE` → `UNREAD` → `AWAITING_REPLY` → `WAITING ON THEM` → `LATER`.
- ARCHIVED, SNOOZED, DRAFTS remain reachable from the View menu for operators who need them.

**Pros**
- Preserves optionality (some users do use snooze/archive eventually).
- Reduces the cognitive load of 6 visible tabs to 1 visible default.
- Minimal mechanical change — almost entirely a UI restructure with reused server queries.

**Cons**
- Doesn't actually solve "clear, distinct, useful meaning" — moves the problem behind a
  menu instead of resolving it. The View menu options are still
  `ALL / NEEDS_REPLY / COMMITMENTS / SCHEDULED / DONE / DRAFTS`, with the same naming
  issues.
- Operators looking for the snooze list have to discover the View menu — adds friction for
  a feature already underused.

**Effort estimate**: 1 session for the UI restructure. Smallest pure-effort option after A.

**Ripple**:
- *P3-2*: still 6 caught-up states (since the views still exist), just less visited.
- *P3-3*: search filters whichever view is active. Same as today.
- *Phase 4*: visual surface to redesign is the View menu + smart group headers. Less
  ambitious than Option B.
- *iOS sync*: zero schema change.

---

## 5. RECOMMENDATION

**Option B — collapse to YOUR MOVE / WAITING / ARCHIVED — with snooze and drafts demoted to
inline affordances.**

### Why

1. **It solves the user's complaint at the root.** The four rails Jackson named have
   indistinct meaning *because they don't form a coherent partition*. YOUR MOVE / WAITING /
   ARCHIVED maps to a single mental frame ("ball in court") that's natural to a trades
   business owner. Three rail names, one sentence.

2. **It's grounded in observed behavior, not theoretical UX.** Production data says the user
   doesn't snooze (0 rows) and doesn't archive (0 rows). It says NEEDS_REPLY is undersized
   by a factor of ~5x (1,651 unread inbound vs. 312 in the rail). The recommendation pays
   attention to what the operator actually does.

3. **It respects the perfection standard.** The audit doesn't propose a half-measure rename
   (Option A) that leaves zombie tabs intact. It doesn't propose a black-box AI-sorted feed
   (Option C) that the trades operator can't trust. It draws the line at the level of
   *whose turn is it?* and rebuilds the rail row accordingly.

4. **The cost is acceptable.** 1–2 sessions of work at OPS-Web AI-assisted velocity.
   Schema-stable, iOS-sync-safe. The 12-class LLM `primary_category` stays. The
   `agent_memories` commitment denormalization stays. The `AWAITING_REPLY` label stays
   useful (it becomes one input among four into the YOUR MOVE filter, rather than the sole
   gate).

5. **It un-blocks P3-2 and P3-3.** With 3 rails instead of 6, the caught-up state design
   collapses to 3 distinct tactical-voice empty states, each with a clear emotional payoff.
   Search-scope behavior gets unambiguous: "search filters this rail."

### What the implementation phase will touch (NOT building here)

For the next spawn (`INBOX REDESIGN - P3-2` or implementation-specific spawn):

- `src/lib/types/email-thread.ts:107-113` — rewrite `InboxRail` union.
- `src/lib/api/services/email-thread-service.ts:636-662` — new switch arms.
- `src/app/api/inbox/threads/route.ts:30-36` — update `VALID_FILTERS`.
- `src/components/ops/inbox/thread-column-header.tsx:50-75` — rail buttons + header counters
  for snoozed/drafts.
- `src/lib/inbox/grouping.ts` — reorganize in-column groups to map cleanly onto the new
  rails.
- `src/lib/hooks/use-inbox-threads.ts:297-321` — point unread sidebar badge at YOUR MOVE.
- `src/i18n/dictionaries/{en,es}/inbox.json` — rewrite all `filter.rail.*` and
  `commandPalette.nav.*` keys. Fix the stale `modal.recat.*` options at the same time
  (problem 3.7). Define COMMITMENTS / WAITING / etc. in copy.
- `src/components/dashboard/widgets/inbox-leads-widget.tsx` — already filters
  `primary_category = 'CUSTOMER'`, unaffected.
- `src/components/dashboard/widgets/phase-c-autonomy-widget.tsx` — unaffected.
- `src/app/api/cron/stale-leads/route.ts` — uses `primary_category`, unaffected.
- `src/components/ops/inbox/__tests__/inbox-route-navigation.test.tsx` — keyboard shortcuts
  (1/2/3/4/6) and rail navigation tests will need rewrites.
- `ops-software-bible/07_SPECIALIZED_FEATURES.md:4700-4720` — bible update for the new rail
  structure and the corrected category count (12, not 13).

The implementation phase should also do the long-deferred LEAD/CLIENT → CUSTOMER cleanup
called out in `email-thread.ts:15-22` while the file is open.

---

## 6. RIPPLE NOTES

### P3-2 — caught-up state inconsistent across filters

Today: 6 rails (effectively 4 the user complains about, plus EVERYTHING and DRAFTS), with
different caught-up copy across them. The dictionary has `empty.title: "Inbox zero"`
(global), `empty.status.title: "Inbox status"` (the status view), and
`row.queueEmpty: "// QUEUE EMPTY"` (the row-level empty) — three different framings of the
same state.

Under each option:

- **Option A**: still 6 caught-up states, but renaming helps. SNOOZED/ARCHIVED can get a
  permanent "quiet" treatment since they're empty by design for this user.
- **Option B (recommended)**: 3 caught-up states. Per-rail tactical voice:
  - YOUR MOVE: `// CAUGHT UP` + `[—] nothing waiting on you`
  - WAITING: `// QUIET` + `[—] no recent threads`
  - ARCHIVED: `// EMPTY` + `[—] nothing archived yet`
- **Option C**: 1 caught-up state. Owns the inbox-zero moment entirely.
- **Option D**: 6 caught-up states, but only the default (ALL) is high-frequency. Others
  can be terse stubs.

P3-2 should be designed *after* the rail decision lands.

### P3-3 — search input opens ⌘K palette instead of filtering threads in place

Today: clicking the header search button opens the global command palette. The palette
filters by category and exposes nav shortcuts, but it doesn't filter threads-in-place. This
is correct *if* the inbox is a launchpad ("type to search and jump anywhere"), wrong if the
inbox is a self-contained tool ("type to narrow this list").

Under each option:

- **Option A**: search behavior unchanged. The undersized NEEDS_REPLY rail still hides 1,651
  threads from the in-place search, since the palette searches across all threads not the
  active rail.
- **Option B (recommended)**: search must filter the active rail in place. ⌘K remains the
  global palette for nav. Two affordances:
  - Header search input → filters the active rail (`subject ILIKE / latest_snippet ILIKE`).
  - ⌘K → command palette (global threads search + category filter chips + navigate to
    other rails).
- **Option C**: same as B — in-place feed search.
- **Option D**: same as B for the default view.

P3-3 should be designed *after* the rail decision lands. If Jackson agrees with Option B,
P3-3 has a clear answer: the header search filters the active rail.

### Phase 4 — visual rework

Phase 4 owns the chip + badge visual design. The audit recommends:

- **Category chip** (12-class `primary_category`) survives on every row and in the detail
  header. Phase 4 may reskin it.
- **Triage chip** (rail-specific state) is the new visual element under Option B:
  - In YOUR MOVE: `// COMMITMENT DUE · FRI`, `// UNREAD · 2D`, `// PHASE C NEEDS INPUT`,
    `// AWAITING REPLY · 5D`. Today's `row.state*` dictionary keys (
    `stateYoursHours / stateOverdue / stateDraftReady / ...`) already cover most of this;
    they just need a rail-aware mapping.
  - In WAITING: `// THEIRS · 3D`, `// FYI`.
- The today-bar's commitment ✓ resolve affordance (`nextCommitmentId` →
  PATCH `/api/inbox/commitments/:id`) is preserved unchanged.

### iOS sync constraint

Per `project_ios_supabase_sync_constraint.md` (auto-memory): only additive nullable column /
new table changes are safe between iOS App Store releases. All four options in this audit
are **iOS-sync-safe** — they touch UI and server query logic only. No `email_threads` column
is renamed, dropped, or type-changed. No new column is required.

If at any point the implementation phase wants to add a new column (e.g. `triage_score` for
Option C, or a denormalized `your_move_flag` for Option B), that column must be added
nullable and the iOS app must continue to read the table without it.

### Phase C autonomy router

`ops-software-bible/07_SPECIALIZED_FEATURES.md:4722-4746` defines per-category autonomy
levels keyed on `primary_category`. Option B (recommended) doesn't change `primary_category`
semantics — the LLM still emits CUSTOMER / VENDOR / etc., and the router still dispatches
on those values. So the autonomy router is unaffected. (If Option C were chosen, the
autonomy router would still work since it's category-driven.)

### Dashboard widgets

`inbox-leads-widget.tsx:64,75` and `phase-c-autonomy-widget.tsx:79-102` query on
`primary_category` directly. Unaffected by any option (the LLM taxonomy is preserved across
all four).

### Stale-leads cron

`src/app/api/cron/stale-leads/route.ts:56` queries
`primary_category IN FOLLOW_UP_CATEGORIES`. Unaffected.

### Sidebar unread badge (problem 3.6)

Under Option A: gets fixed automatically when the NEEDS_REPLY rail query is broadened.
Under Option B: re-anchor the badge to the YOUR MOVE count.
Under Option C: re-anchor to the unsorted unread count.
Under Option D: re-anchor to the ALL view's NEEDS_REPLY group count.

---

## 7. OPEN QUESTIONS FOR JACKSON

These need an explicit answer before the implementation phase can spawn. Numbered for
reference.

1. **Option choice.** Recommended Option B (3 rails: YOUR MOVE / WAITING / ARCHIVED).
   Confirm, or pick A / C / D.

2. **Snooze surfacing under Option B.** With the SCHEDULED rail gone, snoozed threads can
   either:
   - (a, recommended) hide entirely from YOUR MOVE / WAITING until snooze fires. Header
     shows `// 3 SNOOZED ▾` counter only when count > 0; the counter opens a popover list.
   - (b) get a 4th rail SNOOZED that only renders when count > 0.
   - (c) keep visible in WAITING with a small `// SNOOZED · UNTIL TUE` chip on the row.

3. **Drafts surfacing under Option B.** With DRAFTS demoted from a rail:
   - (a, recommended) `// 0 DRAFTS ▾` counter in the column header opens a popover or a
     dedicated panel (current `/api/inbox/drafts` endpoint stays). Each row with a draft
     gets an inline `// DRAFT READY` pill.
   - (b) keep DRAFTS as a 4th rail (acknowledging it's a different data source).
   - (c) inline pill only — no header counter.

4. **AWAITING_REPLY label backfill.** Under any option, the rail today misses ~1,651 unread
   inbound threads. Two paths:
   - (a, recommended) ignore the label as the sole gate. YOUR MOVE filter unions
     `AWAITING_REPLY` with `unread_count > 0 AND latest_direction = inbound`. Label remains
     useful as a higher-precision signal but isn't load-bearing.
   - (b) backfill `AWAITING_REPLY` onto every thread where `unread_count > 0 AND
     latest_direction = inbound`. Heavier; means a one-time write to ~1,651 rows.
   - (c) sharpen the classifier prompt so future threads are tagged correctly (doesn't help
     the backlog).

5. **Category-chip filter strip.** Today the row of `primary_category` filter chips lives
   below the rail. With 12 categories that's a busy strip. Options:
   - (a) keep all 12 chips, no change.
   - (b) collapse to 5 high-frequency chips (CUSTOMER / VENDOR / MARKETING / RECEIPT / OTHER)
     with a `MORE` chip that opens a popover of the remaining 7.
   - (c) drop the chip strip; the only filter dimension becomes rail + search. Categories
     remain visible per-row but not filterable from the header.

6. **LEAD / CLIENT TS-union cleanup.** `email-thread.ts:15-22` declares LEAD and CLIENT in
   the `EmailThreadCategory` union "for transitional code that hasn't been migrated yet."
   Production has 0 rows in either. Is the implementation phase authorized to remove
   LEAD/CLIENT from the union and remove the legacy chip/widget/test references? Listed in
   the type file as a tracking issue but never closed.

7. **Bible update authorization.** The implementation phase should update
   `ops-software-bible/07_SPECIALIZED_FEATURES.md:4700-4720` to reflect the chosen option,
   correct the rail count, fix the "13 categories" → "12 categories" wording, and rewrite
   the autonomy-per-category table to remove LEAD/CLIENT. Confirm this is in-scope for the
   implementation phase (per CLAUDE.md root rules the bible must be updated in-session, but
   I want explicit confirmation given this audit didn't touch the bible).

8. **Are P3-2 and P3-3 implementation spawns dependent on P3-1 implementation?** I'd
   recommend the order be:
   - **P3-1 implementation** (rail rewrite, this audit's deliverable) → land first.
   - **P3-2 implementation** (caught-up state per rail) → land after, since the rail set is
     now known.
   - **P3-3 implementation** (search scope) → land after P3-2, since the search expectation
     depends on the rail count.
   Confirm or reorder.

---

*End of audit.*
