# FLOATING `// YOUR TURN` BADGE — DESIGN SPEC

*Date: 2026-05-13 — agent: INBOX REDESIGN P4-2*
*Scope: replace the full-width BallYoursBand in the inbox detail surface with an absolutely-positioned floating badge. Reconcile P4-1's header triage chip accent slot.*

---

## 1. SUMMARY

The current `BallYoursBand` is a full-width compact strip rendered in flow above the message list whenever `ballInCourt === "user"` (last message inbound). It pushes content down, claims the entire horizontal width of the detail pane, and duplicates the snooze action already present in the detail header.

This spec replaces it with `FloatingYourTurnBadge` — a compact, absolutely-positioned chip anchored to the top-center of the detail surface, glass-dense backdrop, accent-tinted slash label, optional inline `✓` acknowledge button. The badge floats *over* the message list rather than displacing it. It owns the screen's single accent slot, so P4-1's per-rail triage chip downgrades from `tone="accent"` to `tone="neutral"` whenever the badge is mounted.

---

## 2. TRIGGER

The badge mounts whenever the detail-loaded thread is classified as `YOUR_MOVE` by the rail predicate:

```ts
classifyRail(railPredicateThread(thread), now) === "YOUR_MOVE"
```

`YOUR_MOVE` is the broader umbrella signal (`rail-predicates.ts:127-132`):
- `has_unresolved_commitments = true`, OR
- `labels` contains `AWAITING_REPLY`, OR
- `latest_direction = inbound` AND `unread_count > 0`, OR
- `agent_blocking_question != null`

This is **broader** than the current band trigger (`ballInCourt === "user"` ≈ last direction inbound). The expansion is deliberate: the floating badge is the umbrella "your turn" signal; specialised bands (NeedsInputBand, AutoSentBand, ClosedBand) keep their in-flow roles since they carry actionable content the badge does not replicate.

When the user navigates to a thread on any rail (ALL / YOUR_MOVE / WAITING / ARCHIVED), the badge appears iff the *thread itself* classifies as YOUR_MOVE — not the rail filter. The badge is per-thread, not per-rail.

---

## 3. VISUAL ANATOMY

```
                ┌───────────────────────────────┐
                │  //  YOUR TURN  ·  18H    ✓  │
                └───────────────────────────────┘
```

- **Surface**: `.glass-dense` (`rgba(18,18,20,0.78)` + `backdrop-blur(28px) saturate(1.3)` + 1px hairline border)
- **Border**: `1px solid rgba(255,255,255,0.09)` (matches glass-dense default). No accent border — the accent lives in the text/icon tint, not the chrome.
- **Radius**: `4px` (chip token)
- **Padding**: `6px 10px` (compact chip footprint, vertically aligned with action buttons in the header)
- **Z-index**: `1500` (floating-ui layer; below 2000+ windows, below 3000 Radix modals; above the message list and any in-flow band)
- **Width**: intrinsic (content-driven). Approx 150–180px. Never spans more than 50% of the detail surface width.

### Content (left → right)
1. `//` slash prefix in `text-text-mute` (decorative separator per design system)
2. `YOUR TURN` slash label in `text-ops-accent` (Cake Mono Light, 11px, uppercase, tracking `0.14em`)
3. `·` bullet separator in `text-text-mute`
4. Wait clock (`18H` / `12D` / `MAR 4`) in JetBrains Mono `text-text-2`, tabular-lining, slashed zero
5. **(Optional)** Inline `✓` icon button — only when `onAcknowledge` is supplied (i.e. thread carries the `AWAITING_REPLY` label and the operator can clear it without sending a reply). Same icon-button affordance the BallYoursBand currently exposes.

### What's omitted (and why)
- **Client name** — already in the detail header, redundant in a tight floating chip.
- **REPLY button** — `onReply("reply")` on the current band is dead per P4-1's audit (the onAction handler short-circuits unless an agent question is attached). The `⌘↵` keyboard shortcut on the composer is the live affordance.
- **Snooze button** — already in the detail header's `snoozeSlot`. Duplicating it in the band/badge violates DRY.

---

## 4. POSITION

Top-center of the detail surface, anchored to the messages-wrapper (the `<div>` inside `<ThreadDetail>` that contains CommitmentPills + DetailBand + MessageList + Composer).

```
ThreadDetail (flex column, position relative on inner wrapper)
├─ ThreadDetailHeader (~52px tall, in flow)
└─ messages-wrapper (flex column, relative)
   ├─ [CommitmentPills]   (in flow, when commitments exist)
   ├─ [DetailBand]        (in flow, ball-yours branch DELETED — others stay)
   ├─ MessageList         (scrollable)
   ├─ Composer            (in flow at bottom)
   └─ FloatingYourTurnBadge   ← absolute, top: 8px, left: 50%, translateX(-50%)
```

CSS sketch:
```tsx
<div className="absolute left-1/2 top-2 z-[1500] -translate-x-1/2">
  <div className="glass-dense rounded-chip border border-line px-2.5 py-1.5 ...">
    ...
  </div>
</div>
```

**Why top-center, not top-right.** Top-center claims the same horizontal real estate the band currently does (full-width centerline). It's immediately visible on a YOUR_MOVE thread without scanning the corners. Top-right tucks the affordance away — the operator's eye doesn't track there for "what's the state of this thread."

**Overlap acceptance.** When CommitmentPills are present they left-align; the badge floats above their right-of-center region. The glass-dense backdrop is semi-opaque (78% alpha) so the pills behind remain partially legible. When DetailBand has another active branch (needs-input, auto-sent, closed), the badge sits above its top edge. This is the trade-off of "floating" — content is visually muted under the chip, but never displaced.

**Layout invariant.** Adding `position: relative` to the messages-wrapper div in `ThreadDetail` is the only structural change. No other layout consumers depend on that wrapper being statically positioned.

---

## 5. COPY SYSTEM

Three surfaces, three labels, one mental model:

| Surface | Label | Voice |
|---|---|---|
| Rail filter button | `YOUR MOVE` | Noun — the bucket name |
| Header triage chip (per-thread) | `YOURS · 18H` | Pronoun shorthand — fits tight chip |
| Floating badge (per-thread) | `// YOUR TURN · 18H` | Imperative — punchy call-to-action |

Same idea, three forms. Variety is intentional: the rail names the bucket, the row-level chip annotates inline, the badge demands attention. Cognitive simplicity is preserved because each label clearly maps to its surface; no operator will see two labels saying the same thing in the same place.

### Dictionary keys (new)

**EN — `src/i18n/dictionaries/en/inbox.json`:**
```json
"floatingBadge.label": "// YOUR TURN",
"floatingBadge.aria": "Your turn",
"floatingBadge.acknowledge": "Mark no reply needed"
```

**ES — `src/i18n/dictionaries/es/inbox.json`:**
```json
"floatingBadge.label": "// TU TURNO",
"floatingBadge.aria": "Tu turno",
"floatingBadge.acknowledge": "Marcar sin respuesta necesaria"
```

ES precedent: `row.stateYoursHours` already uses `TU TURNO · {hours}H` (line 359). The badge uses the same noun phrase.

### Dictionary keys (deleted with the band)

- `bands.ballYours.label`, `bands.ballYours.reply`, `bands.ballYours.aria` (EN + ES, the older two-line banner copy)
- `bands.ballYours.title`, `bands.ballYours.wait`, `bands.ballYours.waitNone`, `bands.ballYours.reply`, `bands.ballYours.acknowledge`, `bands.ballYours.snooze` (EN + ES, the current single-row band copy)

---

## 6. ACCENT SLOT COORDINATION

Design system rule: **one accent (`#6F94B0` steel blue) per screen, max**. Both the floating badge and P4-1's header triage chip want it.

### Where the conflict happens

The header triage chip uses `tone="accent"` only when `computeStateTag(...).kind === "yours"`:
- `latest_direction === "inbound"`, AND
- `labels` contains `AWAITING_REPLY`, AND
- elapsed wait ≤ 1 week

This is a *strict subset* of YOUR_MOVE — every thread for which the header chip is accent is also a YOUR_MOVE thread, so the badge is also mounted. Other YOUR_MOVE sub-states use `tone: "rose"` (overdue/alarmed), `"lavender"` (drafts/auto-sent), `"neutral"` (theirs/fyi), or `"tan"` (theirs > 1w) — none conflict.

### Mechanism

The simplest possible coordination: at the `InboxRoute` level (where both `floatingBadgeActive` and `triageStateForDetail` are computed), override the triage tone before passing it to the StateTag.

```ts
const floatingBadgeActive =
  detail && classifyRail(toRailPredicateThread(detail.thread), now) === "YOUR_MOVE";

const triageTone =
  floatingBadgeActive && triageStateForDetail?.tone === "accent"
    ? "neutral"
    : triageStateForDetail?.tone;
```

Then:
```tsx
triageSlot={
  triageStateForDetail ? (
    <StateTag
      tone={triageTone}
      variant="bare"
      prefix={triageStateForDetail.prefix}
      value={triageStateForDetail.value}
    />
  ) : undefined
}
```

No prop drilling into `ThreadDetailHeader`. No new Zustand store. The parent computes the tone with full context, the header receives a ready-styled element.

### Rejected alternatives

- **Hide the chip entirely when the badge mounts.** Loses information — the chip's wait clock is useful even when the badge says the same thing. Keeping both with the tone downgrade preserves info density.
- **Move the accent to the chip and downgrade the badge.** Reverse coordination would weaken the badge's prominence. The badge is the more salient signal (larger, top-center). The accent belongs there.
- **Prop drilling `triageActive={false}`.** Adds a new prop to the header for one consumer. The tone-override approach reuses existing props.

---

## 7. ANIMATION

### Mount/unmount

`<motion.div>` with `AnimatePresence`. Reads from a new variant added to `src/lib/utils/motion.ts`:

```ts
export const floatingBadgeVariants: Variants = {
  hidden: { opacity: 0, y: -8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.2, ease: EASE_SMOOTH } },
  exit:    { opacity: 0, y: -8, transition: { duration: 0.15, ease: EASE_SMOOTH } },
};

export const floatingBadgeVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
  exit:    { opacity: 0, transition: { duration: 0.12 } },
};
```

Curve: `EASE_SMOOTH = [0.22, 1, 0.36, 1]` (single design-system easing).
No spring, no scale, no bounce.

### Reduced motion

Honored via `useReducedMotion()`. Reduced variant strips the `y` translate so the badge appears/disappears via opacity only (~150ms). Test asserts `getByTestId("floating-your-turn-badge")` is present without animation properties.

### When transitions fire

- Mount: thread changes from non-YOUR_MOVE → YOUR_MOVE classification (e.g. switching threads, or a thread newly becomes YOUR_MOVE via realtime update).
- Unmount: opposite, OR the operator archives/snoozes the thread.
- No transitions on internal content change (label text update, wait clock tick): the badge stays mounted; only its inner content re-renders.

---

## 8. ACKNOWLEDGE BUTTON (✓)

Inline icon button, only shown when `onAcknowledge` is provided. Identical role to the BallYoursBand's existing button — clears the `AWAITING_REPLY` label for the active thread.

```tsx
{onAcknowledge && (
  <button
    type="button"
    onClick={onAcknowledge}
    aria-label={t("floatingBadge.acknowledge")}
    title={t("floatingBadge.acknowledge")}
    className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[2px] text-text-3 transition-colors hover:bg-ops-accent/[0.18] hover:text-ops-accent focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent"
  >
    <Check aria-hidden className="h-3 w-3" strokeWidth={1.5} />
  </button>
)}
```

When `onAcknowledge` is omitted (commitment-driven YOUR_MOVE, blocking-question YOUR_MOVE, unread-inbound-no-AWAITING_REPLY YOUR_MOVE), the badge is purely informational.

---

## 9. FILES TOUCHED

### Created
- `src/components/ops/inbox/floating-your-turn-badge.tsx` — the new component
- `src/components/ops/inbox/__tests__/floating-your-turn-badge.test.tsx` — component tests

### Modified
- `src/lib/utils/motion.ts` — `floatingBadgeVariants` + reduced variant (under the `// ─── Inbox redesign variants ───` section)
- `src/components/ops/inbox/thread-detail.tsx` — add `floatingBadgeSlot?: ReactNode` prop; wrap children container in `relative`
- `src/components/ops/inbox/inbox-route.tsx` — compute `floatingBadgeActive`, override triage tone, mount `<FloatingYourTurnBadge>` via the new slot
- `src/components/ops/inbox/detail-band.tsx` — remove the `ball-yours` branch; drop the band-yours props from the props interface
- `src/lib/inbox/band-selection.ts` — remove `"ball-yours"` from `BandKind` and the selection precedence in `selectBand` / `selectActionBand`
- `src/i18n/dictionaries/en/inbox.json` — add `floatingBadge.*` keys; remove `bands.ballYours.*` keys
- `src/i18n/dictionaries/es/inbox.json` — same as EN, mirrored
- `src/components/ops/inbox/__tests__/detail-band.test.tsx` — drop the ball-yours assertions

### Deleted
- `src/components/ops/inbox/bands/ball-yours-band.tsx`

---

## 10. NON-GOALS

Per the spawn prompt:
- DO NOT modify `rail-predicates.ts` (consumed read-only).
- DO NOT touch projects-table-v2 parallel-session WIP.
- DO NOT touch pipeline parallel-session WIP.
- DO NOT audit `DetailBandAction`'s `"take-over"` / `"reply"` union members — they're flagged for a later sweep. Drop their consumer (BallYoursBand) but keep the union.
- DO NOT touch the `package.json` / `package-lock.json` (lockfile drift belongs to parallel sessions).
- DO NOT redesign the thread row, lead cards, client strip, composer, accounting totals banner, popovers, archive/ellipsis buttons.

---

## 11. SURPRISES FOR FOLLOW-ON P4 AGENTS

- **Z-index slot 1500 is now claimed by the floating badge inside the detail surface.** Future P4-3 (composer popovers), P4-4 (client strip overlays), P4-5 (lead cards), P4-6 (totals banner) — pick z-index values that don't collide. The badge is below 2000 (windows) and 3000 (Radix modals), so any portaled dialog stacks over it.
- **The accent slot is owned per-thread.** If P4-3/P4-6 introduce a new accent surface (e.g. the composer's primary CTA — which is already accent via `sendVariant="accent"` from the Composer), the operator could see badge-accent AND composer-accent on the same screen. The composer's send button is a *primary CTA*; the badge is a *state marker*. They are not in conflict per the design system rule (one accent CTA, one accent marker is fine — the rule is "no decorative accent"). Document and move on.
- **`band-selection.ts` no longer returns `"ball-yours"`.** Consumers must handle the narrower union. P4 has no other call sites; iOS app doesn't share this code.
- **`reply` / `take-over` `DetailBandAction` union members are now orphaned** — no remaining caller. Left in place per the spawn prompt's explicit "don't audit" directive. Whoever does the next P4 sweep should clean them up.
- **`triageStateForDetail.tone` is overridden at the parent.** Anyone reading the StateTag rendered in the header should know that "accent" is suppressed when the badge is active; the *computed* tone is preserved in `triageStateForDetail.tone` for tests/analytics.
