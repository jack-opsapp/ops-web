# Expense Review & My Expenses Widgets — V2 Redesign Spec

Redesign of both expense dashboard widgets and the shared Expense Batch Detail Popover to properly use company expense settings (`reviewFrequency`, `requireReceiptPhoto`, `requireProjectAssignment`), add urgency/overdue awareness, receipt compliance indicators, and inline quick-approve/reject actions.

V1 was a flat list with no awareness of review cadence, compliance, or urgency. V2 makes the widgets actually useful for triage and review.

---

## Data Dependencies (Shared)

| Hook | Purpose |
|------|---------|
| `useExpenseBatches()` | Batch list (staleTime 2min) |
| `useExpenseSettings()` | Company config: `reviewFrequency`, `requireReceiptPhoto`, `requireProjectAssignment` |
| `useAllExpenses()` | Per-batch receipt/project compliance counts (staleTime 5min) |
| `useTeamMembers()` | Submitter name resolution |
| `useAuthStore()` | Current user for submitter filtering |
| `usePermissionStore()` | `expenses.approve` for reviewer mode |

---

## Urgency Model

### Reviewer Urgency (expense-review widget)

Derived from the company's `reviewFrequency` setting and each batch's `periodEnd`.

```
cycleDays = { daily: 1, weekly: 7, biweekly: 14, monthly: 30 }[reviewFrequency]
daysPastPeriodEnd = floor((now - periodEnd) / oneDay)

fresh:    daysPastPeriodEnd < cycleDays           // crew still submitting
due:      cycleDays <= daysPastPeriodEnd < 2×cycleDays  // review window — act now
overdue:  daysPastPeriodEnd >= 2×cycleDays        // past review window — you're late
```

**Visual treatment:**
- Fresh: no indicator (default state)
- Due: amber dot
- Overdue: red dot

**Example (weekly, periodEnd = March 22):**
- Mar 22–29: fresh (crew submitting)
- Mar 29–Apr 5: due (review window)
- Apr 5+: overdue

### Submitter Urgency (my-expenses widget)

Different perspective — "has my batch been reviewed?"

- **Pending** (accent): submitted, waiting for review. Normal.
- **Revision needed** (warning): returned with flags — submitter must act.
- **Approved** (success): done.
- **Overdue review** (amber): pending for longer than expected review window (`daysPastPeriodEnd >= 2×cycleDays` and still pending). Signals manager hasn't looked at it.

---

## Receipt & Project Compliance

When `requireReceiptPhoto` is true:
- Compute per-batch: count of expenses with `receiptImageUrl` vs total expense count
- Surface as `"X/Y missing receipts"` in warning color on batch rows and popover
- If all present: `"receipts complete"` in success color (or omit if 100%)

When `requireProjectAssignment` is true:
- Compute per-batch: count of expenses with a project allocation vs total
- Same pattern: `"X/Y unassigned"` in warning color

Compliance data is derived from `useAllExpenses()` grouped by `batchId`.

---

## Widget: `expense-review` (Redesign)

### XS (1col, 140px) — Awareness signal
- Hero: pending batch count (font-mono text-display if ≤4 chars, text-data-lg otherwise)
- Title below: "Pending Review" (kosugi micro uppercase)
- If any overdue: `WidgetTrendContext` health variant, red dot, "N overdue"
- Entire widget taps → `/accounting`

### SM (2col, 140px) — Awareness signal
- Hero: total $ pending (formatCompactCurrency)
- ArrowUpRight icon → `/accounting`
- Title: "Expense Review"
- Supporting: "{N} batches · {X} overdue" — overdue count in red if > 0, omitted if 0
- If no overdue: "{N} batches pending"

### MD (6col, 288px) — Triage queue + quick actions
- Header: "Expense Review" (kosugi micro uppercase)
- Hero: total $ pending + batch count
- Detail zone (ScrollFade): batch rows sorted **overdue first → due → fresh**, within each group oldest first

**Batch row layout (MD):**
```
[urgency dot] [avatar] Submitter Name          $1,234  [✓] [✗]
                       EXP-2026-04 · 2/5 missing receipts
```

- **Urgency dot**: 6px circle, amber (due) or red (overdue). Hidden when fresh.
- **Avatar**: 20×20 circle with submitter initials (kosugi 8px).
- **Primary**: submitter name (mohave caption-sm).
- **Secondary**: batch number · compliance text. If `requireReceiptPhoto` and missing > 0: "2/5 missing receipts" in warning color. Otherwise batch number only.
- **Metric**: formatCompactCurrency(totalAmount) (mono micro-sm).
- **Approve action** (✓): WidgetInlineAction with Check icon. Quick-approves batch, shows toast "Batch approved".
- **Reject action** (✗): WidgetInlineAction with X icon. On click, expands an inline text field below the row. Type a note, press Enter or click send — returns batch for revision with that note as reviewNotes. Press Escape to cancel.
- **Row click** (not on action buttons): opens Expense Batch Detail Popover at click position.

Footer: "View All" → `/accounting` (kosugi micro uppercase)

### LG (6col, 584px) — Same as MD
- 10+ rows visible
- Same row layout and actions as MD
- More vertical space for inline reject note expansion

### Empty State
- XS/SM: "0" hero, title label
- MD/LG: WidgetEmptyState with Check icon, "All caught up"

### Loading
- WidgetSkeleton variant="list" at all sizes

---

## Widget: `my-expenses` (Redesign)

### Config
- `period`: "this-month" | "last-month" | "ytd" (select, default "this-month")

### XS (1col, 140px) — Awareness
- Hero: count of batches needing submitter action (revision-needed). If 0 revisions, show pending count.
- Title: "My Expenses"
- If revision > 0: WidgetTrendContext health variant, warning dot, "N need revision"
- Tap → `/accounting`

### SM (2col, 140px) — Awareness
- Hero: total $ submitted this period
- ArrowUpRight icon → `/accounting`
- Title: "My Expenses"
- Supporting: "N approved · N pending" or warning text "N needs revision" if any (replaces summary)

### MD (6col, 288px) — Status tracker
- Header: "My Expenses" (kosugi micro uppercase)
- Hero: total $ submitted + batch count for period
- Detail zone (ScrollFade): batches sorted revision-needed first → pending → approved

**Batch row layout:**
```
[status bar] EXP-2026-04                      $675  [PENDING]
             APR 2026 · 2 items
```

- **Status bar**: 3px vertical bar, color by status (success=approved, accent=pending, warning=revision/partial, error=rejected, success=auto-approved)
- **Primary**: batch number (mohave caption-sm)
- **Secondary**: period display · item count. If revision needed: show flag comment preview from reviewer instead.
- **Badge**: status badge (APPROVED, PENDING, REVISION, REJECTED, AUTO) using badge color pattern from widget-builder skill §10
- **Metric**: formatCompactCurrency(totalAmount)
- **Receipt self-check**: when `requireReceiptPhoto` is true and batch has missing receipts, secondary shows "2/3 missing receipts" in warning — so submitter knows before manager flags them
- **Row click** → opens popover in submitter mode (read-only)

Footer: "View All" → `/accounting`

### LG (6col, 584px) — Same as MD plus:
- 10+ rows visible
- Revision batches show expanded secondary with reviewer's flag comments
- Action zone: summary strip with approved/pending/revision count badges

### Empty State
- XS/SM: "0" hero or "$0" hero
- MD/LG: WidgetEmptyState "No expenses submitted this period"

---

## Expense Batch Detail Popover (Redesign)

### Store
No changes to `expense-batch-popover-store.ts`. Same Zustand store, same API.

### Component Structure
```
ExpenseBatchPopoverInstance (memo)
├── Title bar — batch number + urgency badge (DUE/OVERDUE) + minimize/close
├── Info strip
│   ├── Row 1: Submitter name
│   ├── Row 2: Status badge + period display + item count + total
│   └── Row 3 (conditional): Receipt compliance bar (when requireReceiptPhoto)
├── Tab bar — "Expenses" | "Summary"
├── Tab content (flex-1, overflow-y-auto scrollbar-hide)
│   ├── Expenses tab: expense line items with receipt thumbnails
│   └── Summary tab: category breakdown + receipt coverage
├── Footer actions (reviewer mode, when reviewable)
│   ├── "Approve All" button
│   └── "Send Revisions" button (enabled when flaggedCount > 0)
└── Footer (submitter mode): "View in Accounting →"
```

### Title Bar
- Status color dot (6px) + batch number (mohave 13px semibold)
- **Urgency badge**: only when due or overdue. Amber "DUE" or red "OVERDUE" badge next to title. Uses badge color pattern (text-color bg-color/15 border-color/30, rounded-sm, mono 9px).
- Minimize + Close buttons (same as invoice popover)

### Info Strip
- Row 1: Submitter name (kosugi 10px text-tertiary)
- Row 2: Status badge (colored, uppercase 9px) + `"· MAR 16–22, 2026"` + `"· 5 items · $1,234"`
- Row 3 (conditional, only when `requireReceiptPhoto` is true):
  - Mini progress bar (4px height, green fill for receipts present, warning for gap)
  - Label: `"3/5 have receipts"` (kosugi 10px) — warning color if < 100%, success if 100%

### Expenses Tab

Each expense row:
```
[receipt thumb 40×50] Merchant Name                $425.00
                      Category · Mar 15         [flag icon]
```

**Receipt thumbnail (40×50px):**
- If `receiptImageUrl` exists: render actual image, rounded-[2px], object-cover. Click opens full image in lightbox.
- If missing AND `requireReceiptPhoto` is true: dashed border box (warning color), camera icon centered (warning color, 16px). Signals "missing required receipt."
- If missing AND `requireReceiptPhoto` is false: no thumbnail placeholder shown, row shifts left.

**Text content:**
- Merchant name: mohave text-body-sm text-primary, truncate. Falls back to `description` then `"Untitled"` (from i18n).
- Secondary: kosugi 10px text-disabled. `"Category · Mar 15"` format.
- Amount: mono 12px text-primary, right-aligned.

**Flag toggle (reviewer mode only, when batch is reviewable):**
- Flag icon (Lucide Flag, 14×14)
- Unflagged: text-disabled, hover → text-warning
- Flagged: warning color (filled appearance via color)
- Click unflagged: sets `flaggingId`, expands comment input below the row
- Comment input: bg-surface, border, mohave 11px, placeholder "What needs fixing?", Enter to submit, Escape to cancel
- Click flagged: calls unflagExpense, removes flag

**Flag comment display:**
- When expense is flagged, shows below the row: warning-colored flag icon (12px) + flag comment text (mohave 11px, warning color, truncate)
- Reviewer mode: comment is editable via the flag toggle flow
- Submitter mode: comment is read-only

### Summary Tab
- Category breakdown: horizontal bars (same pattern as expense-tracker widget), accent color, sorted by amount descending
- Receipt coverage: progress bar (4px) with fraction label `"4/5 have receipts"`
- If `requireProjectAssignment`: project assignment coverage with same pattern

### Footer Actions (reviewer mode)
- **"Approve All"** — calls `useApproveBatch()`. Full-width-ish button with Check icon. Disabled during mutation.
- **"Send Revisions"** — calls `useRejectWithRevisions()`. Enabled only when flaggedCount > 0. Shows flag count badge `(3)` in warning color. Disabled during mutation.
- Both show toast on success and close popover.

### Footer (submitter mode)
- "View in Accounting →" link (kosugi micro uppercase, ArrowUpRight icon)

---

## Inline Reject UX (Widget)

When the reviewer clicks the reject action (✗) on a batch row in the MD/LG widget:

1. Row stays in place. A text input field slides open below the row (150ms, EASE_SMOOTH).
2. Input: full-width, mohave 11px, placeholder from i18n `"batchPopover.flagComment"` ("What needs fixing?"), auto-focused.
3. Submit: Enter key or small send button. Calls a simplified reject flow:
   - Sets `reviewNotes` on the batch
   - Returns batch status to `rejected` (not partial — this is a blanket rejection from the widget, not per-expense flagging)
   - Shows toast: "Returned for revision"
4. Cancel: Escape key collapses the input.
5. Only one reject input can be open at a time in the widget.

This is intentionally simpler than the popover's per-expense flagging. The widget reject is "quick return with a note." Granular per-expense flagging happens in the popover.

---

## Sorting & Grouping

### expense-review widget (MD/LG)
1. **Overdue** batches first (red dot), oldest first within group
2. **Due** batches second (amber dot), oldest first
3. **Fresh** batches last, oldest first

No visual group headers — the urgency dot is sufficient. The sort order does the work.

### my-expenses widget (MD/LG)
1. **Revision needed** first (submitter must act)
2. **Pending** second
3. **Approved** / **Auto-approved** last
4. Within each group: newest first (most recent submittals on top)

---

## Animation

- **Inline reject expand/collapse**: height 0→auto over 150ms, EASE_SMOOTH. Reduced motion: opacity only.
- **Row removal on approve**: scale 0.98 + opacity 0.5 (150ms), then height collapse to 0 (250ms). Reduced motion: opacity fade only.
- **Urgency dot**: no animation — static color. Overdue dot could pulse subtly (opacity 0.7→1.0 loop, 2s) but respect reduced motion.
- **Receipt compliance bar in popover**: width animates from 0 on mount (400ms, EASE_SMOOTH).
- **All animations** respect `useReducedMotion()`.

---

## i18n Keys (New/Changed)

```json
"expenseReview.overdue": "overdue",
"expenseReview.due": "due",
"expenseReview.batchesPendingCount": "batches",
"expenseReview.returnedForRevision": "Returned for revision",
"expenseReview.missingReceipts": "missing receipts",
"expenseReview.receiptsComplete": "receipts complete",
"expenseReview.unassigned": "unassigned",

"myExpenses.overdueReview": "overdue review",

"batchPopover.haveReceipts": "have receipts",
"batchPopover.missingReceipts": "missing receipts",
"batchPopover.due": "DUE",
"batchPopover.overdue": "OVERDUE"
```

Spanish translations follow the same pattern as existing keys.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/dashboard/widgets/expense-review-widget.tsx` | Rewrite — add urgency, compliance, inline approve/reject |
| `src/components/dashboard/widgets/my-expenses-widget.tsx` | Rewrite — add submitter urgency, compliance self-check |
| `src/components/ops/expense-batch-popover.tsx` | Rewrite — add urgency badge, receipt thumbnails, compliance bar |
| `src/components/dashboard/widget-preview.tsx` | Update preview cases for new props |
| `src/app/(dashboard)/dashboard/page.tsx` | Pass `expenseSettings` to widgets if needed (or widgets call hook internally) |
| `src/i18n/dictionaries/en/dashboard.json` | Add new keys |
| `src/i18n/dictionaries/es/dashboard.json` | Add Spanish translations |

No new files. No store changes. No new API calls — all data already available via existing hooks.
