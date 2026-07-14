# Books Expenses Console — Reconciliation Notes

Merge of `main` (rebuilt Books expenses console, commits `a86fdb0e..cfe359e1`)
into `feat/web-polish-batch`. Date 2026-07-13.

**Commits:**
- `c7ca9e9c` — merge commit (conflict-resolution policy documented in the message)
- `31981898` — `refactor(expenses): route new console toasts through the tokenized wrapper`
- (this evidence commit) — reconciliation artifacts + notes

---

## 1. What survived vs died from the web-polish books workstream

The books workstream (plan `2026-07-09-books-expenses-and-switching.md`) had 6 tasks.
Main deleted the four old-console files those tasks styled, so the styling died —
but every task's *intent* is re-audited against the new console below (section 3).

| Books-workstream task | Landed on | Outcome after merge |
|---|---|---|
| Task 1 — one list, review above history | `expense-review-dashboard.tsx` (DELETED on main) | **Died with the file.** Superseded by main's lifecycle-bucket model (superior — see verdict a). |
| Task 2 — dense two-row cards | `invoice-card.tsx` (DELETED) | **Died.** New console ships denser 57px single-line rows (see verdict b). |
| Task 4 — month chips newest-at-right | `expense-filters.tsx` + dashboard (DELETED) | **Died.** New console has no month-chip strip; month grouping is section-header based, newest-first (see verdict d). |
| Task 5 — floating compact approve/reject | `invoice-detail-panel.tsx` (DELETED) | **Died.** New `BatchDetailPanel` uses a pinned footer state machine (see verdict c — flagged for taste review). |
| **Task 3 — constant-height workbar across segments** | `expenses-segment.tsx` (took main's) + `sync-segment.tsx` (ours, untouched by main) | **Survived in effect.** All four segments still pin at `--shell-header-top = 89px` (measured live). Main's new Workbar (filters + meta + create + tabStrip) is inherently two-row, so parity holds without our Row-1 lift. |
| **Task 6 — animated segment switching** | `books-page.tsx` (ours, untouched by main) | **Survived outright.** Main's `ExpensesSegment` keeps the identical `{metrics, segmentControl}` prop contract, so the `AnimatePresence mode="wait"` crossfade drives it unchanged. |

**App-wide batch conventions (unaffected by the expenses rebuild):** toast wrapper,
metrics click-to-flip, workbar cohesion, pipeline/clients/projects polish — all preserved.

### Conflict resolution detail
- **4 modify/delete conflicts** (`expense-filters`, `expense-review-dashboard`, `invoice-card`, `invoice-detail-panel`): took main's deletion.
- **`expenses-segment.tsx`** (content conflict): took main's new console verbatim as the base.
- **`auto-approve-rule-form.tsx`**: auto-merged cleanly — main's hardcoded-hex→token refactor and our one-line toast reroute did not overlap. Both survived.
- **`en/es books.json`**: auto-merged as a union — main's ~136 new console keys + our two keys (`expenses.rejectDisabledHint`, `sync.badge.notConnected`). 238 keys each, valid JSON, EN/ES parity.
- **`books-page.tsx`**: not touched by main; our crossfade + constant-chrome kept outright.

---

## 2. Convention fixes applied to the new console (batch-convention sweep)

Audited main's 9 new commits' code against every established batch convention
(raw sonner, hardcoded hex/rgba, `rounded-full` pills, `rounded-btn`, deprecated
`SegmentedPicker`, `@carbon` icons, metrics-cell navigation).

**Only one clear-cut violation found — the raw-sonner import** (main's console was
otherwise well-tokenized; the sibling session clearly followed the design system):

| File | Fix |
|---|---|
| `src/components/books/segments/expenses-segment.tsx` | `import { toast } from "sonner"` → `"@/components/ui/toast"` |
| `src/components/expenses/batch-detail-panel.tsx` | same reroute |

(`auto-approve-rule-form.tsx`'s reroute rode in via the auto-merge.) The ESLint
`no-restricted-imports` guard now passes clean on both files; `toast.success` /
`toast.error` (incl. the mark-paid `action` undo) are API-identical, zero behaviour
change — **verified live**: the "MARKED PAID · UNDO" toast renders on the OPS
glass-dense surface with the accent-bordered action button.

**Non-violations confirmed (not touched):**
- `batch-list.tsx:108` `rounded-full` — it's a person **avatar** (sanctioned exception).
- `ExpenseInstrumentRow` — pure display, no navigation, so the metrics-cell "navigate vs flip" convention does not apply.
- No hardcoded hex/rgba, no banned radii, no SegmentedPicker, no Carbon imports anywhere in the new console.

---

## 3. Four-complaints re-audit (against the NEW console)

Jackson's four expense complaints were written against the OLD console. Re-judged
against main's rebuild:

### (a) "needs review / history toggle should be one list, review above history"
**VERDICT: already solved — superseded by a superior model.**
The old two-mode toggle is gone. The new console uses a four-stage lifecycle-bucket
workbar — `TO REVIEW / TO PAY / PAID / WITH CREW` — as tokenized filter chips (same
pattern as the rest of the app). `TO REVIEW` is the default landing (leftmost), so
the actionable queue is front-and-centre with no toggle to flip; `PAID` (history) is
an explicit separate bucket you opt into. This is a better answer than "one list with
review above history": it never hides review, and it separates history cleanly.
Evidence: `04-lifecycle-buckets-landing-to-review.png`.

### (b) "expense cards too big / bulky"
**VERDICT: already solved — PASS (dense).**
Person-grouped queue: a compact group header (`avatar · name · N BATCHES · $total`)
over **57px single-line batch rows** (`FEB 2–8 · 1 ITEM · AUTO · $960.00`, amount
right-aligned mono), measured live. Far denser than the old ~120px 4-row cards.
Per-row actions (MARK PAID) are hover-revealed, keeping the scan surface clean.
Evidence: `01-to-pay-dense-person-rows.png`.

### (c) "approve/reject too big — should be small floating bottom-right of the review panel"
**VERDICT: partially still applies → NOT auto-fixed; FLAGGED for Jackson's taste review.**
The new `BatchDetailPanel` footer is a lifecycle **state machine** pinned at the
bottom of a dedicated detail column:
- `review` → REMOVE-ALL-FLAGS link + REJECT / APPROVE ALL (full-width, or two `flex-1` half-width buttons, `px-4 py-2` cakemono, tokenized olive/rose)
- `pay` → full-width MARK PAID
- `paid` → paid stamp (left) + **compact UNDO PAID link, bottom-right** — this state already matches Jackson's ask.

The review/pay buttons are larger than the compact floating cluster our (now-dead)
Task 5 built. **Judged honestly:** this is a deliberate, well-tokenized master-detail
footer proportionate to the new dedicated detail column — not the cramped oversized
treatment of the old panel. The "floating cluster" was a bespoke fix for one deleted
panel, **not** an app-wide batch convention. Forcing it onto a three-state footer
machine would be a redesign, not a polish, and risks regressing the state clarity.
Per OPS division of labour (taste calls go to Jackson, don't unilaterally restyle a
sibling session's deliberate design), this is left as-is and surfaced for his call.
- If he wants it: change the review/pay footers from full-width `border-t` bars to an `absolute bottom-3 right-3` compact `h-[28px]` cluster (mirrors the paid state's bottom-right link) — a contained follow-up.
Evidence: `02-detail-panel-paid-state-footer.png` (paid-state footer visible; the
to-review footer could not be shown live — the seed company's TO REVIEW bucket is
empty/"QUEUE CLEAR", so the review-state footer is documented from code, `batch-detail-panel.tsx:383-427`).

### (d) "month chips — newest at far right"
**VERDICT: not applicable — the month-chip UI no longer exists.**
The new console has no month-chip strip (the workbar chips are lifecycle buckets).
Month grouping lives only inside the `PAID` bucket as section headers
(`// JUL 2026`), and `groupPaidByMonth` sorts by `paidAt` **descending** — newest
paid-month section on top, which is the correct default for a history view.
Evidence: `03-paid-month-grouping-newest-first.png`.

---

## 4. Verification results

- **tsc:** touched source files are clean. Pre-existing unrelated errors only:
  `@playwright/test` module-resolution in `tests/e2e/*` + `tests/visual/*` (287+7),
  and 2 in `notification-service.test.ts` (a vitest mock-tuple typing quirk in a file
  **neither side modified** — byte-identical to base and to main; inherited, not a
  merge artifact; the test passes at runtime).
- **ESLint sonner guard:** passes clean on both rerouted files (`npx next lint --file`).
- **Live preview (1440×900, dev-bypass, `web-polish` launch on :3210):**
  - Books expenses console renders with real data (0 console errors).
  - `--shell-header-top = 89px` measured on ALL four segments (invoices/estimates/expenses/sync) — no toolbar jump; crossfade + constant chrome intact with the new console.
  - Mark-paid + undo exercised end-to-end; tokenized toast confirmed; seed data restored to original (TO PAY 45, PAID 1 batch).
- **Tests — 9 files, 90/90 pass, 0 failures:**
  - Main's additions: `expense-buckets` (12), `expense-metrics` (5).
  - Our batch (merge broke nothing): `toast-undo` (4), `metrics-strip-flip` (2), `pipeline-filter-chips` (4), `route-registry` (42).
  - Cross-cutting: `books-service` (12), `books-sync-segment` (6), `notification-service` (3).

## 5. Unresolved / flagged
- **(c) detail-panel footer button size** — taste decision surfaced for Jackson (section 3c). No code change made.
- The seed company's **TO REVIEW bucket is empty**, so the review-state approve/reject footer was verified by code reading, not by pixels.
