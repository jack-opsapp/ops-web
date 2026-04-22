# Inbox Empty-State Status View — Design Spec

**Date:** 2026-04-21
**Status:** Proposed
**Track:** E item 5 of the inbox UI polish pass — replaces the three-line *"Pick a thread from the list."* placeholder in `thread-detail-view.tsx`
**Design system reference:** OPS Design System (new, 2026-04-21 — sharper radii, outlined primary, `// OPERATOR :: <NAME>` voice). The repo's `.interface-design/system.md` has not yet been updated; this spec complies with the new system where the two diverge.

---

## Problem

When no thread is selected in `/inbox`, the center pane renders three lines of mono text: `// NOTHING SELECTED`, `Pick a thread from the list.`, and `Or hit ⌘K to search or jump.` That's the first thing a trades business owner sees every time they open their inbox — every morning, every context switch back from the field. It's wasted surface.

The owner's feedback (item 5 of the Track E list): *"when no thread picked, should show a suggested view with some metrics and todos etc."*

This spec scopes the "metrics" half of that feedback. A separate dashboard widget will handle the "todos" / start-of-day briefing half.

---

## Decisions

| Question | Decision |
|----------|----------|
| Primary role of this surface | **Inbox health at a glance.** Not a todo list, not a dashboard clone — signals that answer "am I keeping up?" |
| Contents (prioritized) | Three signals: (1) triage velocity trend, (2) reply debt, (3) drafts in progress |
| Detail depth for debt + drafts | Counts + inline top-3 mini-list per section. Full rails remain one click away. |
| Category breakdown (unread by LEAD/VENDOR/etc.) | **Explicitly excluded.** Redundant with the rail tabs and category chips already above the left column. |
| Age-of-oldest, snoozed-due, Phase C autonomy recap | **Excluded from this spec.** Follow-ups if the three chosen signals aren't enough. |
| Voice/copy | Tactical per new design system — no "Welcome back," no exclamations, no warmth. `// INBOX STATUS` header, `3 WAITING` bare-number format. Token-value empty states (`—`, `0 OUTSTANDING`). |
| Design system compliance | New system: panel radius 5px, button radius 2.5px, glass `rgba(10,10,10,0.70)` + blur(20px), primary button outlined-at-rest. |
| Relationship to dashboard | This view is inbox-specific state. The dashboard can host a separate "start-of-day" widget consuming the same data. Neither duplicates the other. |
| Backfill of historical data for velocity | None required — `email_threads.category_classified_at` timestamps already exist for the 14-day window. |

---

## Layout

Single vertical column, three stacked sections. Fills the center pane (`flex-1 min-h-0` child of the inbox card established by Track A's full-height mode). Scrolls internally if vertical space is tight.

```
┌────────────────────────────────────────────────────────────┐
│ // INBOX STATUS                                            │
│ WED · APR 21 · 10:34                           14 UNREAD   │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  // CLASSIFIED · LAST 14D                                  │
│  ┌─ sparkline (monochrome, text-2 stroke, 72px tall) ────┐ │
│  │           _/\___/\__       ___/\_/\                   │ │
│  └───────────────────────────────────────────────────────┘ │
│  23 THIS WEEK   ↓ 12% VS PRIOR                             │
│                                                            │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  // REPLY DEBT                                3 WAITING    │
│  OLDEST 4d                                                 │
│                                                            │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ LEAD    Jane Patel    Cedar pricing?         4d  →  │  │
│  │ CLIENT  Mark M        Reschedule?            2d  →  │  │
│  │ VENDOR  Brent @ ABC   PO #4421 status?      18h  →  │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                            │
│  OPEN NEEDS REPLY RAIL  →                                  │
│                                                            │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  // DRAFTS                                         2       │
│                                                            │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ DRAFT     To jane@…      RE: Cedar…          1h  →  │  │
│  │ AI DRAFT  To brent@…     RE: PO…             4h  →  │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                            │
│  OPEN DRAFTS RAIL  →                                       │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### Section structure (repeated 3×)

```
// <SECTION TITLE>                              <headline metric>
<optional secondary line, all uppercase mono>

<compact row list — up to 3 rows>

<ghost-button footer action>
```

### Visual tokens (new design system)

| Element | Token / value |
|---------|---------------|
| Section container | transparent, divided by 1px `var(--line)` top-rule |
| Section title | `.slash` prefix + `font-mono text-[11px] uppercase tracking-[0.16em] text-text-3` |
| Headline metric | `font-mono text-[13px] tabular-nums text-text` |
| Secondary metric line | `font-mono text-[11px] uppercase tracking-[0.12em] text-text-3` |
| Sparkline stroke | `var(--text-2)` at `stroke-width: 1.5`, `stroke-linecap: round` |
| Sparkline fill | `rgba(181, 181, 181, 0.04)` (text-2 at 4%) — *very* faint, optional |
| Sparkline baseline | `rgba(255,255,255,0.04)` — `var(--fill-neutral-dim)` hairline |
| Delta label arrow | `↓` or `↑` unicode, `font-mono` |
| Delta label color | `var(--rose)` when falling (concerning), `var(--olive)` when climbing, `var(--text-2)` when within ±1% |
| Row container | `rounded-[5px]` (panel radius), `border: 1px solid var(--line)`, `bg-transparent` |
| Row | `px-3 py-2`, hover `bg-surface-hover` (`rgba(255,255,255,0.05)`), cursor pointer |
| Row category tag | `.tag` neutral (mono 11px uppercase, 2.5px radius, `rgba(255,255,255,0.05)` bg, `var(--line)` border) |
| Row primary text | `font-mohave text-[13px] text-text` |
| Row secondary text | `font-mohave text-[12px] text-text-2 truncate` |
| Row age | `font-mono text-[11px] tabular-nums text-text-3` |
| Row arrow | `→` unicode `text-text-mute` |
| Footer action | ghost button, `font-cakemono font-light uppercase text-[12px] text-text-2 hover:text-text`, trailing `→` |
| Section padding | `px-3 py-3` (12px) — matches widget internal padding |

### Responsive behavior

Minimum usable width: 480px. Below that the row columns collapse to two-line layout (primary text on line 1, category + age + arrow on line 2). The card never shows a horizontal scrollbar.

---

## Voice / Copy Rules

Per the new design system's copy table. Every string in this view follows:

| Context | Copy |
|---------|------|
| View header | `// INBOX STATUS` |
| Date line | `<DAY> · <MON> <DAY> · <HH:MM>` — all caps, mono, middle-dot separators, 24h time |
| Top-right aggregate | `<N> UNREAD` (or `—` when zero) |
| Velocity title | `// CLASSIFIED · LAST 14D` |
| Velocity headline | `<N> THIS WEEK   <↓\|↑> <P>% VS PRIOR` (arrow + color on delta only) |
| Velocity zero-state | `// CLASSIFIED · LAST 14D / — NO ACTIVITY` |
| Debt title | `// REPLY DEBT` |
| Debt headline | `<N> WAITING` or `0 OUTSTANDING` (zero-state) |
| Debt secondary | `OLDEST <age>` or omitted at zero |
| Drafts title | `// DRAFTS` |
| Drafts headline | `<N>` or `—` (zero-state) |
| Footer actions | `OPEN NEEDS REPLY RAIL  →` / `OPEN DRAFTS RAIL  →` |

Empty states for row lists:

- Debt zero: no row list rendered. Headline reads `0 OUTSTANDING`. No footer action.
- Drafts zero: no row list rendered. Headline reads `—`. No footer action.

Explicitly banned (per new system):
- Emoji of any kind
- Exclamation points
- Title Case sentences (`"Cedar Pricing Discussion"` → render as whatever the subject already is, don't re-case it, but our own labels are either UPPERCASE or sentence case)
- "Welcome back" / "Hi Jackson" / warmth
- Illustrations
- Rounded pills (except avatars, which this view doesn't use)

---

## Data Flow

### New endpoint: `GET /api/inbox/velocity`

Returns the last 14 days of classification activity for the caller's scope.

```ts
// Request
GET /api/inbox/velocity?scope=own|company

// Response
{
  "daily": [ 3, 5, 0, 4, 2, 8, 1, 0, 3, 6, 2, 0, 4, 0 ], // oldest→newest, length 14
  "weekTotal": 23,        // sum of the most recent 7 entries
  "weekDelta": -0.12,     // (weekTotal - priorWeekTotal) / priorWeekTotal, -1..+inf
  "priorWeekTotal": 26    // sum of entries 8-14 days back (for display + debugging)
}
```

Underlying query (one round-trip, denormalized in the route handler):

```sql
SELECT date_trunc('day', category_classified_at AT TIME ZONE 'UTC') AS day,
       COUNT(*) AS count
FROM email_threads
WHERE company_id = $1
  AND category_classified_at >= NOW() - INTERVAL '14 days'
  AND (
    $2 = 'company'
    OR connection_id = ANY($3::uuid[])  -- user's own connection ids for scope=own
  )
GROUP BY day
ORDER BY day ASC;
```

Auth/permission mirrors `/api/inbox/threads` (same `inbox.view` / `inbox.view_company` gates, same scope resolution). Route handler pads missing days with 0 so the response is always length-14.

**Polling cadence:** TanStack Query `staleTime: 5 * 60_000` (5 minutes). The velocity trend doesn't need to be second-fresh.

### Reused: `GET /api/inbox/threads?filter=needs_reply&limit=3`

Already exists. The existing hook (`useInboxThreads`) handles this — we call it with a fixed `limit=3` inside the empty-view component. No new endpoint code.

### Reused: `GET /api/inbox/drafts?limit=3`

Already exists via `useInboxDrafts`. Same pattern.

### Aggregate unread count

The top-right `<N> UNREAD` comes from the *already-computed* `railCounts.everything` in `inbox/page.tsx`. Passed through as a prop — no new fetch.

### "Oldest" age for reply-debt secondary

Client-side derivation from the three returned rows: `max(now - row.lastMessageAt)` on the top 3. No new DB work. When more than 3 threads are waiting, this may undercount the true oldest, but the top 3 are sorted by recency descending so row[0]'s age is the freshest of the waiting set, not the oldest — we compute from the set we have and accept the small approximation. A correct "oldest across all waiting" would require a separate aggregate query; YAGNI for v1.

**Sort order for the debt mini-list.** The main `/api/inbox/threads?filter=needs_reply` returns `last_message_at DESC` (newest first). For the top-3 mini-list we want oldest first, because urgent debt is what you should see — a 4-day-old LEAD waiting on you is louder than a 2-hour-old one. Implementation: fetch `limit=10` and sort client-side ascending by `last_message_at`, then take the first 3. Keeps the API surface unchanged (no new `order` query param) for one cheap round-trip. `oldest` age then equals `now - rows[0].lastMessageAt` exactly.

---

## Loading and Error States

Each of the three sections owns its own fetch and renders its own loading / error state — one section's failure does not block the other two.

| Section | Loading | Error | Zero-data |
|---------|---------|-------|-----------|
| Velocity | Skeleton: baseline hairline + pulsing `rgba(255,255,255,0.04)` block at sparkline height. Headline hidden. | Title renders as `// CLASSIFIED · LAST 14D`. Below: `SYS :: VELOCITY UNAVAILABLE` in `font-mono text-[11px] text-text-3`. No sparkline, no headline. | `// CLASSIFIED · LAST 14D / — NO ACTIVITY` (per voice table). Sparkline renders as a flat baseline hairline. |
| Reply debt | Title + headline render. Row list shows three skeleton rows (pulsing hairline height). | Title renders. Below: `SYS :: DEBT UNAVAILABLE`. No rows, no footer. | Title renders with `0 OUTSTANDING` headline. No rows, no footer. |
| Drafts | Title + headline render. Row list shows two skeleton rows. | Title renders. Below: `SYS :: DRAFTS UNAVAILABLE`. | Title renders with `—` headline. No rows, no footer. |

The `SYS ::` prefix for error states matches the new design system's voice pattern ("SYS :: SYNC FAILED · 08:42"). The error copy is terse and names the thing — no "Something went wrong" generic apology.

Retry behavior: TanStack Query's default retry (3 attempts with exponential backoff) applies to all three fetches. No manual retry button — if persistent, the `SYS ::` line surfaces the failure and the rail tab at top of the left column remains accessible as a workaround.

---

## Component Architecture

```
src/components/ops/inbox/
  ├── empty-status-view.tsx          (NEW — top-level container, orchestrates the 3 sections)
  ├── empty-status-header.tsx        (NEW — tactical header, wall clock + unread count)
  ├── empty-status-velocity.tsx      (NEW — sparkline + headline metric section)
  ├── empty-status-reply-debt.tsx    (NEW — debt section with inline top-3 list)
  ├── empty-status-drafts.tsx        (NEW — drafts section with inline top-3 list)
  └── empty-status-sparkline.tsx     (NEW — pure SVG sparkline, no framework chrome)
```

Five small files plus a container. Each is < 150 LOC and has one job.

**Rationale for splitting instead of one file:**
- Each section has distinct data fetching and empty-state logic — keeping them separate means each can be unit-tested in isolation.
- The sparkline is a pure function of `number[14]` → SVG. It's the only reusable piece — another future widget (dashboard hero, for example) should import this directly.
- Container (`empty-status-view.tsx`) becomes trivially short and easy to reason about.

### Hook layer

```
src/lib/hooks/
  └── use-inbox-velocity.ts          (NEW — TanStack wrapper around /api/inbox/velocity)
```

Mirrors the existing `use-inbox-threads.ts` pattern — typed, paginated (N/A here but the surrounding style is consistent), single export `useInboxVelocity(scope)`.

### Query keys

Add to `src/lib/api/query-client.ts`:

```ts
queryKeys.inbox.velocity = (scope: InboxScope) =>
  [...queryKeys.inbox.all, "velocity", scope] as const;
```

### Modified files

```
src/app/(dashboard)/inbox/page.tsx              — pass railCounts.everything as a prop down the empty view path
src/components/ops/inbox/thread-detail-view.tsx — REPLACE the existing "// Nothing selected" early-return block (~lines 565-587) with <EmptyStatusView />. The rest of the file is unchanged.
src/lib/api/query-client.ts                     — add velocity key
```

### New files

```
src/app/api/inbox/velocity/route.ts             — GET handler
src/lib/hooks/use-inbox-velocity.ts             — client-side hook
src/components/ops/inbox/empty-status-view.tsx
src/components/ops/inbox/empty-status-header.tsx
src/components/ops/inbox/empty-status-velocity.tsx
src/components/ops/inbox/empty-status-reply-debt.tsx
src/components/ops/inbox/empty-status-drafts.tsx
src/components/ops/inbox/empty-status-sparkline.tsx
```

Eight new files, three modified. No schema changes.

---

## Animation

All animations respect `prefers-reduced-motion` via `useReducedMotion()` from framer-motion. Reduced-motion fallback: opacity 0→1 at 150ms for all, no draw-on, no stagger, no count-up.

| Element | Animation | Duration | Easing |
|---------|-----------|----------|--------|
| View mount (container) | `opacity: 0 → 1` | 200ms | EASE_SMOOTH |
| Header clock tick | none (the minute advance is not animated — it just updates) | — | — |
| Sparkline path draw | `stroke-dashoffset` from `pathLength` to 0 | 400ms | EASE_SMOOTH |
| "23 THIS WEEK" count-up | number interpolates from `weekTotal / 2` → `weekTotal` | 800ms | Quadratic ease-out |
| Row stagger entry | `opacity: 0, translateY: 4px → 1, 0` | 300ms base + 50ms/row | EASE_SMOOTH |
| Row hover | `bg-transparent → bg-surface-hover` | 150ms | EASE_SMOOTH |
| Footer action hover | `text-text-2 → text-text` | 150ms | EASE_SMOOTH |

The sparkline draw and count-up fire exactly once on first mount per session — remounts during the same session don't replay. This is implemented via a `useRef<boolean>` latch inside each component.

---

## Accessibility

| Requirement | Implementation |
|-------------|---------------|
| Keyboard navigation | Rows are `role="button" tabIndex={0}`, respond to Enter + Space. `j/k` also work when the center pane has focus (matching the main conversation-list muscle memory). |
| Focus ring | `1.5px solid var(--ops-accent)` with 2px offset from black, on any focused row or footer button. |
| Screen reader labels | Sparkline has `role="img"` + `aria-label="14-day classification trend, 23 this week, down 12% versus prior"`. Rows announce `"<category>, <sender>, <subject>, <age> ago"`. |
| Color-only info | Delta label combines color + arrow + text (`↓ 12% VS PRIOR`). Never color alone. |
| Text contrast | All text uses `text` (18.8:1), `text-2` (10.3:1), or `text-3` (5.4:1). `text-mute` (3.4:1) is used only on the `//` prefix and is decorative. |
| Reduced motion | Every animation gates on `useReducedMotion()`. |
| Touch target | Minimum 44×44px on all interactive elements (rows, footer buttons). |

---

## Internationalization

All user-facing strings go through `useDictionary("inbox")` with English fallbacks. New keys:

```json
{
  "empty.status.title": "Inbox status",
  "empty.status.unreadSuffix": "Unread",
  "empty.velocity.title": "Classified · Last 14d",
  "empty.velocity.thisWeek": "this week",
  "empty.velocity.vsPrior": "vs prior",
  "empty.velocity.noActivity": "No activity",
  "empty.debt.title": "Reply debt",
  "empty.debt.waiting": "Waiting",
  "empty.debt.oldestPrefix": "Oldest",
  "empty.debt.zero": "0 Outstanding",
  "empty.debt.openRail": "Open Needs Reply rail",
  "empty.drafts.title": "Drafts",
  "empty.drafts.zero": "—",
  "empty.drafts.openRail": "Open Drafts rail"
}
```

All keys get Spanish translations in `src/i18n/dictionaries/es/inbox.json` matching the existing pattern.

Note on casing: the display renders the strings *after* `.toUpperCase()` at the component level, because the design system mandates UPPERCASE for these tactical labels. The i18n source stays Title Case so translators can see it correctly.

---

## Non-Goals

- **No category breakdown.** Item 1 of Q2 was explicitly deferred.
- **No snooze-coming-due section.** Item 5 of Q2 deferred.
- **No Phase C autonomy recap.** Item 7 of Q2 deferred.
- **No dashboard-widget version.** That's a separate follow-up; the empty view is inbox-native.
- **No commit-to-dev-server E2E automation.** The plan's Task N manual-check step runs in a dev server — no Playwright additions in this scope.
- **No sibling-thread-strip completion.** The `ThreadSiblingStrip` import added to `thread-detail-view.tsx` by the parallel research agent is a separate thread-grouping feature. Out of scope here.
- **No changes to `.interface-design/system.md` to match the new design system.** That's a codebase-wide audit/migration and deserves its own spec. This view ships compliant with the new system but does not retrofit old code.

---

## Verification Plan

1. **Empty state (zero data).** Manually set `needs_reply` count to 0 and drafts to 0 (e.g. by archiving everything). Expected: velocity renders (even with zero activity, showing `— NO ACTIVITY`), debt renders `0 OUTSTANDING`, drafts renders `—`. No empty row tables, no footer actions for zero sections.
2. **Populated state.** Load a mailbox with 3+ needs_reply threads and 2+ drafts. Expected: top-3 of each render, row order matches the rail-tab order (debt sorted oldest-first, drafts sorted most-recently-edited-first), footer actions appear.
3. **Wall clock ticks.** Leave the view open for 90 seconds. Expected: the `HH:MM` advances once (at the minute rollover). No flicker, no reflow.
4. **Sparkline.** Open a fresh session. Expected: path draws in 400ms on first mount. Refresh the route (same session): no draw animation (latched). Toggle `prefers-reduced-motion: reduce`: no draw, just fade.
5. **Row click.** Click any debt row or draft row. Expected: that thread opens in the detail view (just like clicking the same thread in the left rail).
6. **Footer actions.** Click "OPEN NEEDS REPLY RAIL". Expected: the left rail's rail tab switches to `needs_reply`. The empty view is replaced by the newly-auto-selected thread.
7. **Keyboard.** Tab-cycle through rows and footer buttons. Expected: focus ring visible, Enter activates, Escape blurs.
8. **Scope toggle.** Switch between My inbox / Company (if permissioned). Expected: velocity sparkline refetches and re-renders with the new scope's data.
9. **Dev server Lighthouse pass.** Run Lighthouse a11y check on `/inbox` with no thread selected. Expected: score 100. Any drops are regressions to investigate.
10. **Visual diff against the wireframe.** Compare the rendered view at a 1200×800 viewport to the ASCII wireframe in this spec. Expected: pixel-level layout match (within 2px tolerance for text leading).

---

## Design System Compliance

| System rule | This view's stance |
|-------------|-------------------|
| Panel radius 5px | ✓ section containers are flat (no radius); row list container uses 5px |
| Button radius 2.5px | ✓ no filled buttons; ghost footer buttons are pure text |
| Glass values (0.70 / blur 20px) | Not used — this view is on the already-glass inbox card; nested glass (glass-on-glass-on-glass) is banned |
| Border hairline `var(--line)` | ✓ section dividers + row list container border |
| No shadows on dark | ✓ zero box-shadow in this view |
| Accent color usage | ✓ steel blue (#6F94B0) appears ONLY on focus rings — nowhere else in this view |
| `//` prefix on section titles | ✓ all three section titles |
| Mono tabular for numbers | ✓ all numbers (unread count, velocity total, delta %, ages) |
| Cake Mono Light for display | ✓ footer action buttons |
| No emoji | ✓ |
| No exclamation points | ✓ |
| Reduced-motion support | ✓ every animation gates on `useReducedMotion()` |
| 11px font floor | ✓ smallest text is 11px mono metadata; row category tags |
| WCAG AA contrast | ✓ all text uses `text` / `text-2` / `text-3`; mute only decorative |
| `// OPERATOR :: <NAME>` pattern | Not used here — that pattern is for operator-identity contexts (sidebar footer, dashboard hero). This view is stateful, not identity. |
| `SYS :: <event>` pattern | Not used here — reserved for async system events (sync failures, etc). This view shows steady-state metrics, not events. |

One explicit deviation from the new system: `.interface-design/system.md` in the repo still has 10px panel radii and filled primary buttons. This view matches the **new** design system (5px, outlined primary), knowingly differing from the repo's outdated spec. The plan calls this out for future audit.
