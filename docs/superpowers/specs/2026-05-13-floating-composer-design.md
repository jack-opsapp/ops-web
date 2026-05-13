# FLOATING COMPOSER + INBOX ICON-SIZE PASS — DESIGN SPEC

*Date: 2026-05-13 — agent: INBOX REDESIGN P4-3*
*Scope: convert the in-flow thread composer to an absolutely-positioned floating panel
that floats over the bottom of the message list, and normalize all inbox icon sizes
against the design-system canon.*

---

## 1. SUMMARY

Today the composer is rendered as a fixed band — `shrink-0 border-t border-line bg-inbox-panel`
inside `<ThreadDetail>`'s children flow — that displaces the message list upward. Jackson
asked for an iMessage-style floating input: a glass-dense panel that **sits over the
bottom of the messages region with breathing room**, content scrolls UNDER it (the last
message peeks through the glass and around the side margins), and the panel stays in
place when the user scrolls.

This spec replaces the fixed band with `Composer` rendered inside an
absolutely-positioned wrapper at the bottom of the messages-wrapper. The composer keeps
its full toolbar visible (Sparkles, divider, Paperclip/Image/Calendar, Send), preserves
the ⌘↵ shortcut, draft switcher, AI banner, error states, and Phase C `sendVariant`.
Side and bottom margins create a clear floating-island silhouette; the message list gets
bottom padding so scrolling-to-end still leaves the last message visible above the
composer.

Bundled with this is **a small icon-size normalization pass** across the inbox detail
surface: the detail-header action cluster (Archive/Clock/Tag/MoreHorizontal) upsizes
from 14px → 16px to match the design-system canon for header action buttons, and the
composer toolbar icons upsize from 16px → 18px (with their hit targets growing 26px →
28px) so the primary interaction surface is comfortable for trade-glove use.

---

## 2. DESIGN DIRECTIONS EXPLORED

### Direction 1 — "True iMessage" (expand-on-focus)

Single-line collapsed at rest with hidden toolbar; expands to multi-line and reveals
Sparkles/Paperclip/Image/Calendar on focus.

- Pros: most "iMessage-y"; maximum message-area real estate.
- Cons: hidden affordances clash with OPS tactical voice ("every element earns its
  place and is visible"); two-state expansion adds regression risk; draft switcher
  and AI banner have no home at rest; animation between states is expensive to test.

### Direction 2 — "Always-rich, full-width" (low-effort lift)

Same content as today; just adds glass + radius + position. Floating-but-full-width.

- Pros: lowest regression risk.
- Cons: looks like a fixed band with different styling; messages don't peek around
  the sides; doesn't read as a "floating island"; misses the iMessage feel.

### Direction 3 (recommended) — "Floating island" (always-visible toolbar, geometry-driven floating)

Composer is contained in a glass-dense rounded panel with `bottom: 12px` and
`left/right: 24px` gutters. Toolbar visible at rest. Draft switcher + AI banner
render INSIDE the floating panel above the textarea. MessageList grows
`pb-[120px]` so the last message sits above the composer at rest; scrolling-mid-thread,
messages slide under the glass and peek through.

- Pros: true floating-island silhouette via geometry (margins + radius + glass); single
  visual state; matches OPS tactical voice; coordinates cleanly with P4-2 badge (top
  1500, composer bottom 1550); preserves all current behavior; draft switcher / AI
  banner / error state render naturally inside the panel.
- Cons: slightly larger footprint than Direction 1 at rest — acceptable given the
  toolbar is the active interaction surface.

**Decision: Direction 3.**

---

## 3. POSITION + GEOMETRY

The composer mounts inside the messages-wrapper (the `<div className="relative flex
min-h-0 flex-1 flex-col">` introduced by P4-2 for the floating badge) — the same
relative-positioned wrapper that hosts `floatingBadgeSlot`.

```
ThreadDetail (flex column)
├─ ThreadDetailHeader (in flow, ~52px)
└─ messages-wrapper (position: relative)
   ├─ {children}
   │  ├─ CommitmentPills (in flow)
   │  ├─ DetailBand (in flow)
   │  ├─ MessageList (scrollable, grows, pb-[120px])
   │  ├─ FloatingComposer ← absolute, bottom:12 left:6 right:6, z-1550   ← THIS SPEC
   │  └─ composerError (in flow under the composer, but no longer in flow → see §6)
   └─ floatingBadgeSlot (absolute, top:8 center, z-1500)
```

### Wrapper

```tsx
<div className="pointer-events-none absolute inset-x-0 bottom-3 z-[1550] flex justify-center px-6">
  <div className="pointer-events-auto w-full max-w-[760px]">
    <Composer floating ... />
  </div>
</div>
```

- `pointer-events-none` on the outer wrapper so the gutter regions stay clickable
  (avatar tap-throughs, etc.); `pointer-events-auto` on the actual composer.
- `bottom-3` = 12px above the messages-wrapper floor.
- `px-6` = 24px gutters left/right at narrow widths; `max-w-[760px]` caps the panel
  on wide viewports so the line length stays scannable.

### Inner panel (Composer rewrite)

When `floating` prop is true, the Composer's outer `<div>` becomes:

```
rounded-panel border border-glass-border bg-[rgba(18,18,20,0.78)]
backdrop-blur-[28px] [backdrop-saturate:1.3]
px-2 py-3
```

instead of today's `shrink-0 border-t border-line bg-inbox-panel px-2 py-3`.

- `rounded-panel` = 10px panel radius token
- `border-glass-border` = `rgba(255,255,255,0.09)` hairline (already in tailwind config)
- `bg-[rgba(18,18,20,0.78)]` = glass-dense alpha (P4-2 badge uses the same value)
- `backdrop-blur-[28px] [backdrop-saturate:1.3]` = canonical glass-dense filter
- No `border-t` — the glass panel has a full 1px border on all sides

### MessageList padding

`MessageList` currently uses `flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto
scrollbar-hide px-2 py-4`. The floating composer requires bottom padding so the last
message scrolls above the composer's top edge instead of being permanently obscured.

Change: append `pb-[120px]` to MessageList's outer container. 120px = ~92px composer
height (single-line textarea + toolbar + padding) + 12px bottom margin + ~16px breathing
room. Matches iMessage's bottom-padding behaviour.

The padding is **MessageList-local** — it should not be applied at the wrapper level so
that other content slots (CommitmentPills, DetailBand) keep their natural in-flow
spacing.

### Z-index

P4-2's floating badge claims `z-[1500]` inside the same messages-wrapper. The composer
takes `z-[1550]` — between the badge (1500) and the floating-ui ceiling (1600 reserved
for future). The composer is the higher-priority floating element because the operator
interacts with it; the badge is informational.

Order on screen (bottom → top):
1. MessageList (in flow)
2. CommitmentPills (in flow)
3. DetailBand (in flow, when active)
4. Floating YOUR TURN badge (`z-1500`)
5. Floating composer (`z-1550`)
6. Dropdown popovers if any (Radix portal, `z-3000`)

---

## 4. VISUAL ANATOMY

```
┌──────────────────────────────────────────────────────────┐  ← rounded-panel (10px)
│ [DraftSwitcher row] ← topAccessory (only if drafts > 0)  │
│ [AI banner row]     ← topAccessory (only if pristine AI) │
│ ───────────────────────────────────────────────────────  │  ← hairline separator
│ Textarea (Mohave 13, auto-grows, min 1 line, max 200px)  │
│ ───────────────────────────────────────────────────────  │  ← hairline separator
│ [✦]│[📎] [🖼] [📅]              [EDIT DRAFT] [SEND ⌘↵]  │  ← toolbar (28px tall)
└──────────────────────────────────────────────────────────┘
```

Internal layout details:

- **Top accessories** (`topAccessory` prop) render at the top of the floating panel,
  not above it. Currently used for `<DraftSwitcher>` (when `threadDrafts > 0`) and
  `<AiDraftBanner>` (when `isAgentDraft && isPristineDraft`). Both already work as
  in-panel banners — no API change needed.
- **Inner box (textarea container)** stays as a separate rounded element inside the
  glass panel with `border bg-inbox-bg-deep` so the textarea has its own visual frame
  inside the glass. This preserves the focus-ring behavior already implemented
  (`focus-within:border-ops-accent` / `focus-within:border-agent`).
- **Toolbar** is the existing flex row with Sparkles + divider + Paperclip/Image/
  Calendar + flex-1 + Edit (conditional) + Send.

### Glass-dense over MessageList

The glass-dense surface at 78% alpha lets scrolling messages peek through as a soft
blurred layer beneath the composer. When the user scrolls up from the end-of-thread
position, the last message visually slides under the composer's top edge, blurred-
through, before disappearing entirely. This is the iMessage "messages bleed under
the glass" effect implemented in OPS terms.

The composer's BOTTOM edge sits 12px above the messages-wrapper floor (i.e. above the
viewport bottom for the messages region). So even at the very-bottom scroll position,
there's a 12px gap where the inbox-bg color shows through under the composer — clean,
not a band touching the viewport edge.

### No shadow

Per OPS rule "Depth is glass + hairline only. No box-shadows on dark backgrounds."
The composer's border and glass tint do all the depth work.

### Accent slot coordination

The composer's send button uses the design-system primary CTA: `border-ops-accent
bg-transparent text-ops-accent` at rest → `bg-ops-accent text-black` on hover. This is
**outlined-at-rest accent** — text + border accent, no fill.

P4-2's floating badge claims the **filled accent text** slot (`text-ops-accent` on the
label). The header triage chip is **downgraded to neutral** when the badge is active.

Per the P4-2 spec § 11 surprises: "The composer's send button is a *primary CTA*; the
badge is a *state marker*. They are not in conflict per the design system rule (one
accent CTA, one accent marker is fine — the rule is 'no decorative accent')." That
holds here.

Visual check: **no element uses solid-fill `bg-ops-accent` at rest while the badge is
active**. Verified in §11 (Verification).

---

## 5. ICON-SIZE NORMALIZATION PASS

Audit table — every inbox lucide-react usage cross-referenced against the canonical
size table (header actions 16px/24px, composer actions 18px/28px, inline state 12-14px,
floating affordances 14-16px).

### Before → After

| Location | Icon(s) | Before | After | Reason |
|---|---|---|---|---|
| `thread-detail-header.tsx:81` | Archive / Clock / Tag / MoreHorizontal | 14px (h-3.5) in 24px (h-6) | **16px (h-4)** in 24px (h-6) | Canon: header action buttons = 16px in 24px hit target |
| `composer.tsx:128` | Sparkles (AI draft) | 16px (h-4) in 26px | **18px (h-[18px])** in **28px (h-7)** | Canon: composer actions = 18px in 28px |
| `composer.tsx:137` | Paperclip (attach file) | 16px (h-4) in 26px | **18px (h-[18px])** in **28px (h-7)** | same |
| `composer.tsx:145` | Image (attach image) | 16px (h-4) in 26px | **18px (h-[18px])** in **28px (h-7)** | same |
| `composer.tsx:153` | Calendar (schedule) | 16px (h-4) in 26px | **18px (h-[18px])** in **28px (h-7)** | same |
| `composer.tsx:172` | Send (in send button) | 14px (h-3.5) | **16px (h-4)** | Composer primary CTA glyph should align with 16px header standard, slightly larger than other inline send-button text glyphs |

### Untouched (already canonical)

- `floating-your-turn-badge.tsx:137` Check icon at 12px (h-3) in 18px hit target —
  intentional P4-2 chip-sized affordance; inside a 22px-tall chip context where 14px
  would visually overpower the 11px text. Document as exception.
- `thread-row.tsx:276-300` UserPlus/Paperclip/DollarSign/Receipt at 14px — inline
  signal-row indicators, correct per inline-icon canon.
- `state-tag.tsx:142` X at 12px — inside chip, correct.
- `today-bar.tsx:183,191` Check at 16px / ArrowRight at 14px — today-bar primary
  action vs secondary nav distinction, correct.
- All bands (auto-sent, closed, needs-input, summary) — Sparkles at 14px inline,
  correct.
- Context rail icons (project-card, pipeline-list, work-view, files-view) — all
  14px inline, correct.
- `mobile-stacked-shell.tsx:56` ChevronLeft at 16px in 28px (h-7) — correct.
- `thread-column-header.tsx:159` MoreHorizontal at 16px / `:212` X at 12px — both
  correct.
- `message-bubble.tsx` Sparkles at 14px inline — correct.

### Composer toolbar hit target

The current `iconBtn` constant is:
```
"inline-flex h-[26px] w-[26px] items-center justify-center rounded-chip ..."
```
After the pass:
```
"inline-flex h-7 w-7 items-center justify-center rounded-chip ..."
```
That's 26px → 28px hit target. The send button shell stays at 28px tall (already correct)
to align horizontally with the toolbar buttons after the bump.

---

## 6. COMPOSER COMPONENT API

### New prop: `floating`

```ts
interface ComposerProps {
  // ... existing props
  /** Renders as a floating glass-dense panel instead of a fixed band. When
   *  true, the outer container uses panel radius, glass-dense surface, no
   *  border-top. Consumer must wrap in an absolutely-positioned container. */
  floating?: boolean;
}
```

Default: `false`. When false, the composer renders unchanged for backward compat with
any future consumer that wants the band style.

When `true`:
```tsx
<div className={cn(
  "rounded-panel border border-glass-border bg-[rgba(18,18,20,0.78)] px-2 py-3",
  "backdrop-blur-[28px] [backdrop-saturate:1.3]",
  className,
)}>
```

When `false` (existing):
```tsx
<div className={cn(
  "shrink-0 border-t border-line bg-inbox-panel px-2 py-3",
  className,
)}>
```

The internal layout (topAccessory → inner-box → toolbar → bottomAccessory) is
unchanged.

### composerError position

The composer-error message currently renders OUTSIDE the Composer as a sibling
(`<p role="alert" className="px-2 pb-2 ...">{composerError}</p>` in inbox-route.tsx).
With the floating composer, this would render under the absolute wrapper — invisible.

**Move** the error into the floating composer's wrapper element so it floats with the
composer. The error becomes a `bottomAccessory` rendered INSIDE the panel below the
toolbar, separated by a hairline. New i18n key: not needed — existing
`composer.error.noRecipient` / `composer.error.sendFailed` stay.

```tsx
bottomAccessory={
  composerError ? (
    <p
      role="alert"
      className="mt-2 border-t border-line pt-2 px-1 font-mono text-[11px] text-rose"
      style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
    >
      {composerError}
    </p>
  ) : null
}
```

---

## 7. ANIMATION

The floating composer mounts/unmounts via Framer Motion when the active thread changes.
Animation follows the design-system canon and reuses the conceptual pattern from P4-2's
floating badge (same direction, mirrored axis):

```ts
// src/lib/utils/motion.ts — new variant under "Inbox redesign variants"
export const floatingComposerVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.2, ease: EASE_SMOOTH } },
  exit: { opacity: 0, y: 12, transition: { duration: 0.15, ease: EASE_SMOOTH } },
};

export const floatingComposerVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15, ease: EASE_SMOOTH } },
  exit: { opacity: 0, transition: { duration: 0.12, ease: EASE_SMOOTH } },
};
```

Mount triggers when a thread is selected and `detail` resolves. Exit triggers on
thread change or detail unload. The badge enters from `y: -8` (top), the composer
enters from `y: 12` (bottom) — mirrored axis, same easing curve, same 200ms duration.

Reduced motion strips the y translate — opacity-only fade at 150ms.

---

## 8. COPY (i18n)

**No new keys needed.** The composer already uses:
- `composer.tacticPlaceholder` → `[type message — ⌘↵ to send]` / `[escribe mensaje — ⌘↵ para enviar]`
- `composer.sendTactic` → `SEND` / `ENVIAR`
- `composer.sendPhaseC` → `SEND PHASE C DRAFT` / `ENVIAR BORRADOR PHASE C`
- `composer.editDraftTactic` → `EDIT DRAFT` / `EDITAR BORRADOR`
- `composer.error.noRecipient` → existing
- `composer.error.sendFailed` → existing
- `composer.attachFile` / `composer.attachImage` / `composer.draftWithPhaseC` / `composer.scheduleSend` → existing

Copy was reviewed against the `ops-copywriter` skill's voice rules:
- ✓ Tactical bracket prefix (`[type message — ⌘↵ to send]`)
- ✓ UPPERCASE for authority on buttons (`SEND`, `EDIT DRAFT`)
- ✓ `//` not present (composer doesn't need a section header — the panel itself is
  the affordance)
- ✓ Sentence-case nowhere (no body copy)
- ✓ No emoji, no exclamation points
- ✓ Wait-clock affordance: not applicable (composer doesn't render a time value)

Nothing to refine. Keep existing copy.

---

## 9. FILES TOUCHED

### Modified

**Commit 1 — icon-size pass:**
- `src/components/ops/inbox/thread-detail-header.tsx` — HeaderActionButton icon class `h-3.5 w-3.5` → `h-4 w-4`
- `src/components/ops/inbox/composer/composer.tsx` — iconBtn constant `h-[26px] w-[26px]` → `h-7 w-7`; toolbar icons `h-4 w-4` → `h-[18px] w-[18px]`; send icon `h-3.5 w-3.5` → `h-4 w-4`; Sparkles button hit target updated for the bigger icon.

**Commit 2 — floating composer:**
- `src/components/ops/inbox/composer/composer.tsx` — add `floating?: boolean` prop; conditional outer container styling.
- `src/components/ops/inbox/inbox-route.tsx` — wrap `<Composer>` in absolutely-positioned floating wrapper inside the messages-wrapper; pass `floating` prop; move `composerError` into the composer's `bottomAccessory`.
- `src/components/ops/inbox/message-list.tsx` — append `pb-[120px]` to the outer container's className (composer-aware bottom padding).
- `src/lib/utils/motion.ts` — add `floatingComposerVariants` + `floatingComposerVariantsReduced` under the inbox redesign variants section.
- `src/components/ops/inbox/__tests__/composer.test.tsx` — add tests for `floating` prop (renders glass surface; preserves all existing behaviour).
- `src/components/ops/inbox/__tests__/inbox-route-navigation.test.tsx` — adjust any test that asserts composer-band-specific layout (e.g., border-t).
- `OPS-Web/CLAUDE.md` z-index scale — claim `z-1550` for the floating composer in the floating-ui slot table.

### Created

- `src/components/ops/inbox/composer/floating-composer-wrapper.tsx` — small wrapper component that handles the absolute positioning + AnimatePresence motion for the floating composer. Keeps `Composer` itself reusable.

### Deleted

None.

---

## 10. NON-GOALS

Per the dispatch:

- DO NOT modify projects-table-v2 / pipeline parallel-session WIP.
- DO NOT redesign the thread detail header chrome, lead cards, client strip, accounting totals banner, popovers, archive/ellipsis buttons.
- DO NOT modify the rail predicates, classifier code, or bible.
- DO NOT audit DetailBandAction's orphaned `take-over` / `reply` union members.
- DO NOT touch `package.json` / `package-lock.json`.
- DO NOT fix filed sync bugs.
- DO NOT redesign the composer's internal layout (toolbar order, button surfaces) — only chrome + position + icon sizes change.

---

## 11. VERIFICATION

After both commits land:

### Automated

- `npx tsc --noEmit` → exit 0
- `npx vitest run src/components/ops/inbox tests/unit/inbox src/lib/inbox` → all pass
- New composer.test.tsx cases:
  - `floating` prop renders glass surface (`rounded-panel`, `backdrop-blur`, no `border-t`)
  - All existing assertions still pass (placeholder, send shortcut, toolbar order, etc.)
  - composerError renders inside the panel as bottomAccessory when set

### Manual smoke (port 3100)

- Open a thread → composer floats at the bottom with 12px breathing room above the floor and 24px gutters
- Last message visible above the composer at rest (pb-[120px] does its job)
- Scroll up → message list scrolls under the composer; composer stays put; mid-thread messages peek through the glass
- Type a draft → input grows for multi-line up to max 200px
- Press ⌘↵ → send fires
- Open a YOUR_MOVE thread → badge at top + composer at bottom both render; only one element uses solid-fill `bg-ops-accent` (NEITHER — badge is text-accent, composer send is border + text accent). Confirmed via devtools query: `document.querySelectorAll('[class*="bg-ops-accent"]:not(:hover)')` returns 0 elements with class containing `bg-ops-accent` outside of hover state.
- Toggle `prefers-reduced-motion: reduce` → composer mounts statically (opacity-only)
- Inspect icons: detail-header buttons 16px, composer toolbar 18px, send glyph 16px, all 1.5px stroke

### Coordination evidence (badge + composer)

Both visible simultaneously. Capture screenshot showing:
- Badge at top-center, accent text on glass-dense chip
- Composer at bottom, outlined-accent send button (no fill at rest)
- Header triage chip in neutral tone (downgraded by badge per P4-2)
- No `bg-ops-accent` fills simultaneously visible

---

## 12. SURPRISES FOR FOLLOW-ON P4/P5 AGENTS

- **Z-index slot 1550 is now claimed by the floating composer.** P4-4 (client strip),
  P4-5 (lead cards), P4-6 (totals banner), P5-1 (popovers) must not collide.
  Z-1500 (badge) and 1550 (composer) are committed within the messages-wrapper. The
  rest of the floating-ui range 1551-1600 is free; portaled Radix dialogs at z-3000
  still stack over both.

- **MessageList now has `pb-[120px]` permanently.** Any future change to the composer's
  height (e.g. ever taller draft-switcher rows) needs to revisit this padding value or
  switch to a measured dynamic padding. For now, 120px = 92px composer + 12px bottom
  margin + 16px breathing room is a fixed approximation.

- **Composer's `floating` prop is opt-in.** The default behavior is the legacy band
  styling. Inbox-route uses `floating={true}`. Any other future consumer (a project
  workspace composer, a notes composer, etc.) defaults to the band style and can opt
  in.

- **composerError moved into bottomAccessory.** Anyone reading inbox-route.tsx and
  expecting to find the error as a sibling div will be surprised. The error is now
  rendered INSIDE the floating composer panel, separated by a hairline, with the same
  `role="alert"` semantics.

- **The accent slot rule still holds with three contenders.** Badge (filled text),
  composer send (outlined border + text), and the header triage chip can all want
  accent. P4-2 already downgrades the chip to neutral when the badge is active. This
  spec adds the composer-send-button accent, which is **outlined** not **filled** — it
  doesn't count as the "filled accent" slot. No element has `bg-ops-accent` at rest.
  Hover transitions to `bg-ops-accent` on the send button, but that's a transient state.

- **Animation curve coordination.** Badge animates from `y: -8` (top, in from above),
  composer from `y: 12` (bottom, in from below). Mirrored axis, same 200ms / 150ms
  durations, same `EASE_SMOOTH` curve. Anyone adding more floating UI inside the
  detail surface should follow this directional pattern: top-anchored → enter from
  above; bottom-anchored → enter from below; same easing, same timing.

---

*End of spec.*
