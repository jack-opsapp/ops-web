# OPS Web — Interface Design System v2

> **Canonical spec:** `docs/superpowers/specs/2026-04-15-ops-web-visual-system-design.md`
> This file is the quick-reference for every styling decision. The spec is the source of truth for WCAG ratios, migration details, and audit history.

## Direction

**Who:** A trades business owner — roofer, plumber, electrician — drowning in texts, paper, and chaos. Checking the dashboard between job sites, in the truck, on a phone or tablet. Not a desk-bound power user.

**Feel:** Command Deck — Apple-depth glass panels with tactical content. Uppercase Kosugi labels, `//` slash prefixes, JetBrains Mono data readouts, Mohave hero type. Earth-tone semantic palette. Military, measured, no nonsense. Every element earns its place.

**Depth strategy:** Glass surfaces + borders only. Zero box-shadows on dark backgrounds. Top-edge gradient pseudo-element provides subtle lit-from-above quality. Stacked glass (dense variant) for modals/popovers over panels.

---

## Palette

### Backgrounds

| Token | Value | Use |
|-------|-------|-----|
| `background` | `#000000` | Page canvas — pure black |
| `.glass-surface` | `rgba(18,18,20,0.58)` + blur(28px) sat(1.3) + 10px radius + top gradient | All elevated surfaces, cards, panels, widgets |
| `.glass-dense` | `rgba(18,18,20,0.78)` + blur(28px) sat(1.3) + 12px radius + top gradient | Stacked glass: dialogs, popovers, dropdowns, floating windows, toasts |
| `surface-input` | `rgba(255,255,255,0.04)` | Input fields |
| `surface-hover` | `rgba(255,255,255,0.05)` | Interactive row/button hover |
| `surface-active` | `rgba(255,255,255,0.08)` | Active toggle, pressed state |

### Text Hierarchy (WCAG AA verified vs #000)

| Token | Tailwind | Value | Ratio | Use |
|-------|----------|-------|-------|-----|
| text | `text-text` | `#EDEDED` | 18.8:1 AAA | Primary body, hero numbers, names, active nav |
| text-2 | `text-text-2` | `#B5B5B5` | 10.3:1 AAA | Secondary values, ghost buttons, links, sidebar icons |
| text-3 | `text-text-3` | `#8A8A8A` | 5.4:1 AA | Labels, metadata, subtitles, placeholders |
| text-mute | `text-text-mute` | `#6A6A6A` | 3.4:1 | Decorative ONLY: `//` slashes, separators. Never body text. |

### Accent — Primary Actions Only

| Token | Value | Use |
|-------|-------|-----|
| `ops-accent` | `#6F94B0` (5.6:1 AA) | Primary CTA button fill. Focus rings. Nothing else. |
| `ops-amber` | `#C4A868` | Warning semantic indicator. Never decorative. |

**Accent does NOT appear on:** ghost buttons, links, toggles, sidebar active state, tags, data bars, `//` slashes, input focus borders, carets, or any decorative element.

### Earth Tones — Semantic Indicators Only

| Token | Value | Semantic |
|-------|-------|----------|
| `olive` | `#9DB582` (7.8:1) | Positive: success, nominal, completed, +delta |
| `tan` | `#C4A868` (8.1:1) | Attention: warning, site visit, expiring |
| `rose` | `#B58289` (6.2:1) | Negative: error, overdue, cost |
| `brick` | `#93321A` (2.5:1) | Destructive: borders/dots only, never text on black |

### Financial

| Token | Value | Use |
|-------|-------|-----|
| `financial-revenue` | `#C4A868` | Revenue bars, income |
| `financial-profit` | `#9DB582` | Profit indicators |
| `financial-cost` | `#B58289` | Expense/cost indicators |
| `financial-receivables` | `#D4A574` | Outstanding receivables |
| `financial-overdue` | `#93321A` | Past-due amounts |

### Borders

| Token | Value | Use |
|-------|-------|-----|
| `line` / `border` | `rgba(255,255,255,0.10)` | Standard hairline — panels, topbar, inputs |
| `glass-border` | `rgba(255,255,255,0.09)` | Glass panel edge (applied by .glass-surface) |

### Neutral Fills

| Token | Value | Use |
|-------|-------|-----|
| `fill-neutral` | `rgba(255,255,255,0.14)` | Non-interactive data: bar fills, progress tracks |
| `fill-neutral-dim` | `rgba(255,255,255,0.06)` | Track backgrounds, skeletons, subtle backgrounds |

---

## Typography

### Font Stack

| Font | Role |
|------|------|
| **Mohave** | Headings, hero numbers (wt 300), body text (wt 400–500), page titles |
| **Kosugi** | Category labels — ALWAYS uppercase + letter-spacing 0.16–0.20em |
| **JetBrains Mono** | All numerical data, timestamps, metadata values, currency, `//` prefixes |

### Size Floor

**11px minimum. No exceptions.** `text-micro` (11px) is the smallest allowed token.

### Font Feature Settings

All numerical contexts: `font-feature-settings: "tnum" 1, "zero" 1` (tabular numerals, slashed zero).

### Type Hierarchy

| Role | Classes | Size | Use |
|------|---------|------|-----|
| Hero number | `font-mohave font-light` | 76–84px | Dashboard hero, revenue total |
| Page title | `font-mohave font-medium` | 22–26px | Page heading |
| Panel title | `font-kosugi text-micro uppercase tracking-wider` | 11px | Widget/section titles |
| Body / name | `font-mohave text-body-sm` | 14px | Entity names, row primary text |
| Data value (lg) | `font-mono text-data-lg font-semibold` | 20px | Hero metrics in widgets |
| Data value | `font-mono text-data-sm` | 13px | Standard data values |
| Category label | `font-kosugi text-micro uppercase tracking-wider` | 11px | BOOKED, INVOICED, etc. |
| Metadata | `font-mono text-micro` | 11px | Timestamps, IDs, subtotals |
| Row secondary | `font-kosugi text-micro` | 11px | Line item secondary text |
| Footer | `font-kosugi text-micro uppercase tracking-wider` | 11px | "View Invoices" etc. |
| Badge | `font-mono text-micro uppercase tracking-wider` | 11px | Status badges |

---

## Border Radius

| Element | Value | Tailwind |
|---------|-------|----------|
| Glass panels / cards / widgets | 10px | `rounded-panel` |
| Modals / dialogs / popovers / dropdowns / floating windows / toasts | 12px | `rounded-modal` (via `.glass-dense`) |
| Buttons | 5px | `rounded` or `rounded-[5px]` |
| Tags / chips | 4px | `rounded-chip` |
| Inputs | 5px | `rounded-[5px]` |
| Funnel bars / progress tracks | 2px | `rounded-bar` |
| Sidebar item hover bg | 6px | `rounded-[6px]` |
| Avatars | full | `rounded-full` |

No `999px` fully-rounded pills anywhere except avatars. No `rounded-sm` (2.5px) on containers.

---

## Spacing

**Base unit:** 8px. All spacing is multiples of 4px or 8px.

### Canvas Layout

| Property | Value |
|----------|-------|
| Canvas padding | `36px 44px` (px-[44px] py-[36px]) |
| Max content width | `1320px` |
| Gap between panels | `24px` |
| Two-column layout gap | `24px` |

### Panel Internal

| Zone | Padding |
|------|---------|
| Panel header | `22px 30px 6px` |
| Panel body | `16px 30px 34px` |
| Hero panel body | `20px 40px 40px` |

### Widget Internal

| Context | Value | Tailwind |
|---------|-------|----------|
| XS inner padding | top only, sides from shell | `pt-3` |
| SM inner padding | all sides | `p-3` |
| MD+ inner padding | | `px-3 py-2` |
| Section gap | 8px | `mt-1` or `mb-1` |
| Row vertical padding | 3px | `py-[3px]` |
| Row horizontal padding | 4px | `px-1` |
| Icon-text gap | 4px | `gap-1` |
| Footer top padding | 8px | `pt-1` |

---

## Surface System

### Glass Panel (`.glass-surface`)

The canonical elevated surface. Used for all cards, panels, widgets, sidebars.

```css
background: rgba(18, 18, 20, 0.58);
backdrop-filter: blur(28px) saturate(1.3);
border: 1px solid rgba(255, 255, 255, 0.09);
border-radius: 10px;
/* Plus ::before pseudo-element: */
background: linear-gradient(180deg, rgba(255,255,255,0.04), transparent 40%);
```

### Dense Glass (`.glass-dense`)

For stacked surfaces: modals over panels, popovers over cards, floating windows, toasts.

```css
background: rgba(18, 18, 20, 0.78);
backdrop-filter: blur(28px) saturate(1.3);
border: 1px solid rgba(255, 255, 255, 0.09);
border-radius: 12px;
/* Plus ::before pseudo-element: */
background: linear-gradient(180deg, rgba(255,255,255,0.03), transparent 35%);
```

### `<Surface>` Component

Import from `@/components/ui/surface`. Variants: `default` (glass-surface), `dense` (glass-dense), `inset` (input surface), `ghost` (transparent).

### Depth Rules

- Glass + borders only. Zero `box-shadow` anywhere on dark backgrounds.
- No `shadow-card`, `shadow-elevated`, `shadow-floating`.
- The top-edge gradient pseudo-element is the only depth cue.

---

## Component Primitives

### Buttons

| Variant | Fill | Text | Border | Use |
|---------|------|------|--------|-----|
| Primary | `ops-accent` | black | none | Single primary CTA per screen |
| Default | `rgba(255,255,255,0.07)` | `text-2` | `rgba(255,255,255,0.10)` | Standard button |
| Secondary | transparent | `text-2` | `rgba(255,255,255,0.10)` | Secondary actions |
| Ghost | transparent | `text-2` | none | Subtle actions |
| Destructive | `rose-soft` | `rose` | `rose-line` | Delete, cancel (rare) |
| Link | transparent | `text-2` | none | Inline text links |

Hover: Default/Secondary/Ghost → `rgba(255,255,255,0.05)` bg + text brightens to `text`.
Focus: `1.5px ring-ops-accent ring-offset-2 ring-offset-black`

### Tags

| Variant | Text | Background | Border | When |
|---------|------|------------|--------|------|
| Neutral | `text-2` | `rgba(255,255,255,0.05)` | `1px solid line` | Default — no semantic meaning |
| Olive | `olive` | `olive-soft` | `olive-line` | Success, completed, in-progress |
| Tan | `tan` | `tan-soft` | `tan-line` | Warning, site visit, attention |
| Rose | `rose` | `rose-soft` | `rose-line` | Error, overdue, cost |

Earth-tone tags ONLY when the color carries semantic meaning. Default is neutral.

### Toggles / Segment Controls

- Inactive: `text-3`, transparent bg, `line` border
- Hover: `text-2`, `rgba(255,255,255,0.03)` bg
- Active: `text` (white), `rgba(255,255,255,0.08)` bg, border `rgba(255,255,255,0.18)`
- No accent color on toggles.

### Links

- Default: `text-2`
- Hover: `text` + subtle `text-3` underline
- No accent color on links.

### Inputs

- Background: `rgba(255,255,255,0.04)` (`bg-surface-input`)
- Border: `1px solid rgba(255,255,255,0.10)`
- Text: `text`
- Placeholder: `text-3`
- Focus: border brightens to `rgba(255,255,255,0.20)` — no accent
- Error: border `rose` (#B58289)
- Radius: 5px

### Active Navigation (Sidebar)

- Inactive: `text-3` icon, no bg
- Hover: `text-2` icon, `rgba(255,255,255,0.04)` bg, 6px radius
- Active: `text` (white) icon, 2px vertical indicator bar in `text-2`
- No accent color on navigation.

---

## Tactical Character

These elements give OPS its identity — the feel of a command center, not a generic SaaS dashboard.

### `//` Slash Prefix

- Applied to: panel titles, section labels
- Font: JetBrains Mono, same size as the title it prefixes
- Color: `text-mute` (#6A6A6A) — decorative, never accent
- Spacing: `margin-right: 6px` after slash

### Breadcrumb Path

`Command // Dashboard` — Kosugi uppercase 11px, `text-3`, with `//` separator in `text-mute`.

### Uppercase Kosugi Labels

All category labels (BOOKED, INVOICED, LEAD, QUALIFIED, etc.) use Kosugi uppercase with `letter-spacing: 0.16–0.20em`. This is the OPS voice in the UI.

---

## Widget Anatomy

### Size Tiers

| Size | Grid | Content Rules |
|------|------|---------------|
| **XS** (1x1) | ~120x80px | Hero number + title ONLY. No description, no footer. |
| **SM** (2x1) | ~240x80px | Hero + title + ONE secondary element. No footer. |
| **MD** (6x2) | ~full-width x 160px | Header + content zone + footer. |
| **LG** (6x4) | ~full-width x 320px | Header + hero/chart + scrollable detail + footer. |

### Zone Structure (MD+)

```
┌─────────────────────────────────────┐
│ HEADER: title (left) + controls     │ ← font-kosugi text-micro uppercase
├─────────────────────────────────────┤
│ CONTENT: chart / metrics / list     │ ← main data display
├─────────────────────────────────────┤
│ FOOTER: navigation text             │ ← font-kosugi text-micro uppercase
└─────────────────────────────────────┘
```

### Navigation Consistency

| Size | Navigation Element |
|------|-------------------|
| XS | Entire card clickable. No button. |
| SM | ArrowUpRight icon (14px) top-right. `text-text-mute hover:text-text-2` |
| MD | Footer text + optional row-level clicks |
| LG | Footer text + row-level clicks + inline actions |

---

## Empty States

Empty states MUST be size-aware.

### XS Empty
Hero value ($0, 0%) in `text-display text-text-mute`. Title in `text-micro uppercase`. No description, no footer.

### SM Empty
Hero value in `text-data-lg text-text-mute`. Title in `text-micro uppercase`, mt-1. Short description in `text-caption-sm text-text-mute`, mt-1. No footer.

### MD+ Empty
Title in header position. Centered hero value in `text-display text-text-mute`. Description in `text-caption-sm text-text-mute`. Footer navigation text.

---

## Interactive Patterns

### Row Hover

`hover:bg-surface-hover transition-colors` — only on clickable rows.

### Inline Actions (WidgetInlineAction)

- 20x20px touch target, 14px icon
- `text-text-mute hover:text-text-2`
- MUST call `e.stopPropagation()` to prevent parent click

### Period Picker (WidgetPeriodPicker)

- SM: CalendarDays icon (14px) → Popover dropdown
- MD+: Inline pill group
- Active pill: `bg-surface-active text-text border border-[rgba(255,255,255,0.18)] rounded-chip px-1.5 py-[1px]`
- Inactive: `text-text-3 hover:text-text-2 border border-transparent`
- Font: `font-kosugi text-micro uppercase tracking-wider`
- No accent on active pill.

### "+N More" (WidgetMoreButton)

- Font: `font-kosugi text-micro text-text-3 hover:text-text-2`
- MUST be outside the ScrollFade container
- Click toggles expanded state — does NOT navigate away

### Hero Collapse (WidgetHeroCollapse)

- CSS max-height transition, NOT framer-motion layout
- Duration: 300ms, easing: cubic-bezier(0.22, 1, 0.36, 1)
- Collapsed: opacity 0.6, reduced max-height

### Card Flip (WidgetCardFlip)

- Click on title → 3D rotateY(180deg), 350ms, perspective(600px)
- Back face: glass-surface, title + description + data source
- Reduced motion: crossfade fallback

---

## Animation

**Easing:** `cubic-bezier(0.22, 1, 0.36, 1)` (EASE_SMOOTH). All animations.

**NO spring physics.** NO bounce. Exception: drag-and-drop reorder only.

| Animation | Duration | Easing |
|-----------|----------|--------|
| Hover transitions | 150ms | EASE_SMOOTH |
| Panel enter | 200ms | EASE_SMOOTH |
| Page transitions | 250ms | EASE_SMOOTH |
| Row stagger entrance | 300ms + 50ms/item | EASE_SMOOTH |
| Chart bar grow | 400-600ms + index delay | EASE_SMOOTH |
| Hero number count-up | 800ms | Quadratic ease-out |
| Card flip | 350ms | EASE_SMOOTH |
| Hero collapse | 300ms | EASE_SMOOTH |

**Reduced motion:** Every animation MUST check `useReducedMotion()` or `prefers-reduced-motion`. Fallback: opacity-only transitions at 150ms.

---

## Status Badges (WidgetStatusBadge)

- Font: `font-mono text-micro uppercase tracking-wide`
- Padding: `px-1 py-[1px]`
- Radius: `rounded-chip` (4px)
- Border: `border`
- Color pattern: `text-{color} bg-{color}/15 border-{color}/30`
- MUST use WidgetStatusBadge component — never hand-roll badge styling

---

## Scroll Containers

### ScrollFade

- Gradient fade at top and bottom when content overflows
- Gradient color: matches glass surface `rgba(18, 18, 20, 0.95)` → transparent
- Gradient MUST touch the exact edge of the container (no gap)

### No Hard Cutoffs

Any content that fades, clips, or overflows MUST use gradient transitions. Hard edges are a design failure.

---

## Colors in Code

### Rules

1. `className` uses Tailwind tokens: `text-text`, `text-text-2`, `bg-surface-hover`, `border-glass-border`
2. `style={{}}` uses WT CSS variables: `WT.accent`, `WT.glass`, `WT.fillNeutral`
3. **NEVER hardcode hex values** in components. Zero exceptions.
4. Fallback for missing data: use `WT.muted` or `text-text-mute`

---

## Accessibility

| Requirement | Standard |
|-------------|----------|
| Text contrast | ≥ 4.5:1 (AA) for all body text. `text-mute` (3.4:1) decorative only. |
| Font size floor | 11px minimum. No exceptions. |
| Touch targets | 44×44px minimum on all interactive elements. |
| Focus ring | `1.5px solid accent, offset 2px` — accent appropriate for system-level focus. |
| Reduced motion | Every animation checks `prefers-reduced-motion`. Fallback: opacity-only at 150ms. |
| Semantic HTML | `<button>` for buttons, `<a>` for links. No div click handlers without ARIA roles. |
| Color independence | Information never conveyed by color alone. Earth-tone tags always include text labels. |

---

## i18n

ALL user-facing text MUST go through `useDictionary("<namespace>")`. This includes: widget titles, footer navigation, empty states, status labels, period picker options, tooltip labels, "+N more" text, fallback strings.

Pattern: `t("key") ?? "English fallback"`

---

## Shared Component Usage

These shared components MUST be used. Never hand-roll equivalent markup:

| Component | Use For |
|-----------|---------|
| `<Surface>` | Any glass panel (default/dense/inset/ghost) |
| `<Card>` | Widget-level cards (default/elevated/interactive/accent/ghost) |
| `WidgetLineItem` | Any list row in any widget |
| `WidgetStatusBadge` | Any status indicator |
| `WidgetEmptyState` | Any centered empty state (MD+) |
| `WidgetPeriodPicker` | Any time filter control |
| `WidgetMoreButton` | Any "+N more" expandable |
| `WidgetBackgroundChart` | Any SM background chart |
| `WidgetHeroCollapse` | Any LG collapsible hero section |
| `WidgetInlineAction` | Any inline action button |
| `WidgetCardFlip` | Any title-click info reveal |
| `ScrollFade` | Any scrollable list container |
| `WidgetTooltip` | Any hover tooltip on charts |
| `formatCompactCurrency` | Any compact currency display |
| `formatLocaleCurrency` | Any full currency display |
| `widgetLineItemStyle` | Any staggered row entrance |

---

## Z-Index Scale

| Layer | z-index | Purpose |
|-------|---------|---------|
| **base** | 0 | Normal flow |
| **content** | 1–10 | In-page elevation (vignettes, calendar states) |
| **interactive** | 100–200 | Drag/resize/ghost overlays |
| **nav** | 500 | Sidebar |
| **dropdown** | 1000 | Menus, autocomplete |
| **floating-ui** | 1500–1600 | FAB, bug report, action prompts, window dock |
| **window** | 2000+ | Floating windows (dynamic, auto-increments) |
| **modal** | 3000 | Portaled dialogs/sheets (Radix) |
| **map-controls** | 5000 | Full-screen map page only |
| **emergency** | 9000–9999 | Sign-out, lockout overlays |
