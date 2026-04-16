# OPS Web — Interface Design System

> **Canonical spec:** `docs/superpowers/specs/2026-04-15-ops-web-visual-system-design.md`
> This file summarizes the design system for quick reference. The spec is the source of truth for all token values, WCAG ratios, and migration details.

## Direction

**Who:** A trades business owner — roofer, plumber, electrician — drowning in texts, paper, and chaos. Checking the dashboard between job sites, in the truck, on a phone or tablet. Not a desk-bound power user.

**Feel:** Command Deck — Apple-depth glass panels with tactical content. Uppercase Kosugi labels, `//` slash prefixes, JetBrains Mono data readouts, Mohave hero type. Earth-tone semantic palette. Military, measured, no nonsense. Every element earns its place.

**Depth strategy:** Glass surfaces + borders only. Zero box-shadows on dark backgrounds. Top-edge gradient pseudo-element provides subtle lit-from-above quality. Stacked glass (dense variant) for modals over panels.

---

## Palette

### Backgrounds
| Token | Value | Use |
|-------|-------|-----|
| `background` | `#000000` | Page canvas — pure black |
| `glass-surface` | `rgba(18,18,20,0.58)` + blur(28px) sat(1.3) | All elevated surfaces |
| `glass-dense` | `rgba(18,18,20,0.78)` + blur(28px) sat(1.3) | Stacked glass: modal over panel |
| `surface-input` | `rgba(255,255,255,0.04)` | Input fields |

### Text Hierarchy (WCAG AA verified vs #000)
| Token | Value | Ratio | Use |
|-------|-------|-------|-----|
| `text` | `#EDEDED` | 18.8:1 AAA | Primary body, hero numbers, names, active nav |
| `text-2` | `#B5B5B5` | 10.3:1 AAA | Secondary values, ghost buttons, links |
| `text-3` | `#8A8A8A` | 5.4:1 AA | Labels, metadata, subtitles |
| `text-mute` | `#6A6A6A` | 3.4:1 | Decorative ONLY: `//` slashes, separators. Never body text. |

### Accent — Primary Actions Only
| Token | Value | Use |
|-------|-------|-----|
| `ops-accent` | `#6F94B0` (5.6:1 AA) | Primary CTA button fill. Focus rings. Nothing else. |
| `ops-amber` | `#C4A868` | Warning semantic indicator. Never decorative. |

Accent does NOT appear on: ghost buttons, links, toggles, sidebar active state, tags, data bars, `//` slashes, or any decorative element.

### Earth Tones — Semantic Indicators Only
| Token | Value | Semantic |
|-------|-------|----------|
| `olive` | `#9DB582` (7.8:1) | Positive: success, nominal, completed, +delta |
| `tan` | `#C4A868` (8.1:1) | Attention: warning, site visit, expiring |
| `rose` | `#B58289` (6.2:1) | Negative: error, overdue, cost |
| `brick` | `#93321A` (2.5:1) | Destructive: borders/dots only, never text on black |

### Financial (unchanged)
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
| `line` | `rgba(255,255,255,0.10)` | Standard hairline — panels, topbar, statusbar |
| `glass-border` | `rgba(255,255,255,0.09)` | Glass panel edge |

### Neutral Fills
| Token | Value | Use |
|-------|-------|-----|
| `fill-neutral` | `rgba(255,255,255,0.14)` | Non-interactive data: bar fills, progress tracks |
| `fill-neutral-dim` | `rgba(255,255,255,0.06)` | Track backgrounds, skeletons |

---

## Typography

### Font Stack
| Font | Use |
|------|-----|
| **Mohave** | Headings, body text, primary labels, row text |
| **Kosugi** | Section labels, captions, buttons, metadata (ALWAYS uppercase + tracking-wider) |
| **JetBrains Mono** | Numbers, data, metrics, currency, counts |

### Widget Type Scale
| Role | Classes | Size | Use |
|------|---------|------|-----|
| **Hero XS** | `font-mono text-display font-bold` | 28px | XS widget primary number |
| **Hero SM** | `font-mono text-data-lg font-bold` | 20px | SM widget primary number |
| **Hero MD+** | `font-mono text-display font-bold` | 28px | MD/LG hero numbers |
| **Section label** | `font-kosugi text-micro uppercase tracking-wider` | 11px | Widget titles, section headers |
| **Row primary** | `font-mohave text-caption-sm` | 12px | Line item primary text |
| **Row secondary** | `font-kosugi text-micro-sm` | 10px | Line item secondary text |
| **Metric value** | `font-mono text-micro-sm` | 10px | Right-side metric on rows |
| **Footer** | `font-kosugi text-micro uppercase tracking-wider` | 11px | "View Invoices" etc. |
| **Badge** | `font-mono text-micro-sm uppercase tracking-wider` | 10px | Status badges |

---

## Spacing

**Base unit:** 8px. All spacing is multiples of 4px (half-unit) or 8px.

### Widget Internal Spacing
| Context | Value | Tailwind |
|---------|-------|----------|
| **XS inner padding** | `pt-3` (top only, sides from shell) | `pt-3` |
| **SM inner padding** | `p-3` (all sides) | `p-3` |
| **MD+ inner padding** | `px-3 py-2` | `px-3 py-2` |
| **Section gap** | 8px | `mt-1` or `mb-1` |
| **Row vertical padding** | 3px | `py-[3px]` |
| **Row horizontal padding** | 4px | `px-1` |
| **Icon-text gap** | 4px | `gap-1` |
| **Footer top padding** | 8px | `pt-1` |

---

## Border Radius

| Context | Value | Tailwind |
|---------|-------|----------|
| Cards | 5px | `rounded-[5px]` (from Card component) |
| Buttons | 2.5px | `rounded-sm` |
| Inputs | 2.5px | `rounded-sm` |
| Chart bars | 2.5px top | `rounded-t-sm` |
| Badges | 2.5px | `rounded-sm` |
| Avatars | full | `rounded-full` |

---

## Widget Anatomy

### Size Tiers
| Size | Grid | Content Rules |
|------|------|---------------|
| **XS** (1x1) | ~120x80px | Hero number + title ONLY. No description, no footer, no secondary metrics. |
| **SM** (2x1) | ~240x80px | Hero + title + ONE secondary element (chart, description, or legend). No footer. |
| **MD** (6x2) | ~full-width x 160px | Header + content zone + footer. Charts and lists fit within bounds. |
| **LG** (6x4) | ~full-width x 320px | Header + hero/chart + scrollable detail + footer. WidgetHeroCollapse for chart+list. |

### Zone Structure (MD+)
```
┌─────────────────────────────────────┐
│ HEADER: title (left) + controls (right) │ ← font-kosugi text-micro uppercase
├─────────────────────────────────────┤
│ CONTENT: chart / metrics / list          │ ← main data display
├─────────────────────────────────────┤
│ FOOTER: navigation text                  │ ← font-kosugi text-micro uppercase
└─────────────────────────────────────┘
```

### XS Pattern (STRICT)
```
┌──────────┐
│ 42       │ ← font-mono text-display font-bold (hero)
│ REVENUE  │ ← font-kosugi text-micro uppercase (title) mt-1
│ $12.5K   │ ← font-kosugi text-micro-sm (subtitle, optional)
└──────────┘
```
- Padding: `pt-3` (inner div)
- No footer. No description. No navigation icon.
- Entire card is clickable (card-level onClick).

### SM Pattern (STRICT)
```
┌───────────────────────────┐
│ 42          ↗             │ ← hero (left) + ArrowUpRight 14px (right)
│ REVENUE                   │ ← title, mt-1
│ [secondary element]       │ ← chart/description/legend, mt-1
└───────────────────────────┘
```
- Padding: `p-3`
- Navigation: ArrowUpRight icon only (14px, text-disabled, hover:text-secondary). Top-right.
- ONE secondary element: sparkline, bar, description text, or legend. Not multiple.
- No footer text.

### SM Background Chart Pattern
When SM has a chart:
```
┌───────────────────────────┐
│ [chart fills card with    │ ← WidgetBackgroundChart, opacity 0.35
│  gradient-masked edges]   │   padding p-2, mask-image gradients (15%/85%)
│ 42          ↗             │ ← text on top (z-10)
│ REVENUE                   │
│ $12.5K mtd                │
└───────────────────────────┘
```
- Chart MUST have padding from card edges (p-2 inside the chart wrapper)
- Chart MUST have gradient mask on all edges (fade to transparent at 15% in, 85% out)
- NO hard cutoffs. Ever.
- Chart is pointer-events-none at SM.

### MD+ Footer Pattern
- Font: `font-kosugi text-micro text-text-tertiary uppercase tracking-wider`
- Hover: `hover:text-text-secondary transition-colors`
- Alignment: left
- Text: destination name ("View Invoices", "View Pipeline", etc.) — i18n'd
- Positioned at bottom via `mt-auto`

### Navigation Consistency
| Size | Navigation Element |
|------|-------------------|
| XS | Entire card clickable. No button. |
| SM | ArrowUpRight icon (14px) top-right. `text-text-disabled hover:text-text-secondary` |
| MD | Footer text + optional row-level clicks |
| LG | Footer text + row-level clicks + inline actions |

---

## Empty States

Empty states MUST be size-aware. A single shared return for all sizes causes text bleeding at XS/SM.

### XS Empty
```
Hero value ($0, 0%, --%) in text-display text-text-disabled
Title in text-micro uppercase
NO description, NO footer
```

### SM Empty
```
Hero value in text-data-lg text-text-disabled
Title in text-micro uppercase, mt-1
Short description (truncated) in text-caption-sm text-text-disabled, mt-1
NO footer
```

### MD+ Empty
```
Title in header position
Centered hero value in text-display text-text-disabled
Description in text-caption-sm text-text-disabled
Footer navigation text
```

---

## Interactive Patterns

### Row Hover
`hover:bg-[rgba(255,255,255,0.04)] transition-colors`

Only applied when row has an onClick. Never on non-interactive rows.

### Inline Actions (WidgetInlineAction)
- 20x20px touch target, 14px icon
- `text-text-disabled hover:text-text-secondary`
- MUST call `e.stopPropagation()` to prevent parent click
- Multi-action: Radix Popover, side="bottom", collisionPadding={8}

### Click Zones
When a row has BOTH navigation AND inline actions, structurally separate them:
- Navigation zone: flex-1 div with onClick
- Action zone: separate div containing WidgetInlineAction
- NEVER nest action buttons inside a clickable parent without stopPropagation

### Period Picker (WidgetPeriodPicker)
- SM: CalendarDays icon (14px) → Popover dropdown
- MD+: Inline pill group
- Active pill: `bg-ops-accent/15 text-ops-accent border border-ops-accent/30 rounded-sm px-1.5 py-[1px]`
- Inactive: `text-text-tertiary hover:text-text-secondary border border-transparent`
- Font: `font-kosugi text-micro-sm uppercase tracking-wider`
- All labels MUST be i18n'd

### "+N More" (WidgetMoreButton)
- Font: `font-kosugi text-micro-sm text-text-tertiary hover:text-text-secondary`
- MUST be outside the ScrollFade container (not overlapping content)
- Click toggles expanded state — does NOT navigate away

### Hero Collapse (WidgetHeroCollapse)
- CSS max-height transition, NOT framer-motion layout
- Duration: 300ms, easing: cubic-bezier(0.22, 1, 0.36, 1)
- Collapsed: opacity 0.6, reduced max-height
- Chart content should use `transform: scaleY()` for visual shrink (no layout thrash)
- Scroll hysteresis: collapse at 20px scroll, expand at 10px (prevents rapid toggling)

### Card Flip (WidgetCardFlip)
- Click on title → 3D rotateY(180deg), 350ms, perspective(600px)
- Back face: frosted glass surface, title + description + data source
- Reduced motion: crossfade fallback

---

## Animation

**Easing:** `cubic-bezier(0.22, 1, 0.36, 1)` (EASE_SMOOTH). All widget animations.
**NO spring physics.** NO bounce. Exception: drag-and-drop reorder (spacer widget only).

| Animation | Duration | Easing |
|-----------|----------|--------|
| Row stagger entrance | 300ms + 50ms/item delay | EASE_SMOOTH |
| Chart bar grow | 400-600ms + index delay | EASE_SMOOTH |
| Hero number count-up | 1000ms | Quadratic ease-out |
| Card flip | 350ms | EASE_SMOOTH |
| Hero collapse | 300ms | EASE_SMOOTH |
| Fade in (empty state) | 150ms | EASE_SMOOTH |

**Reduced motion:** Every animation MUST check `useReducedMotion()`. Alternative: opacity-only transitions at 150-200ms.

---

## Status Badges (WidgetStatusBadge)

- Font: `font-mono text-micro-xs uppercase tracking-wide`
- Padding: `px-1 py-[1px]`
- Radius: `rounded-sm`
- Border: `border`
- Color pattern: `text-{color} bg-{color}/15 border-{color}/30`
- MUST use WidgetStatusBadge component — never hand-roll badge styling

---

## Scroll Containers

### ScrollFade
- Gradient fade at top and bottom when content overflows
- Gradient color: matches card background `rgba(10, 10, 10, 0.95)` → transparent
- Gradient MUST touch the exact edge of the container (no gap)
- Bottom gradient position: `bottom: 0` absolute

### No Hard Cutoffs
Any content that fades, clips, or overflows MUST use gradient transitions. Hard edges are a design failure. This applies to:
- ScrollFade top/bottom
- WidgetBackgroundChart edges (mask-image gradient)
- Any clipped content

---

## Colors in Code

### Rules
1. `className` uses Tailwind tokens: `text-ops-accent`, `bg-status-success/15`, `border-financial-revenue/30`
2. `style={{}}` uses WT CSS variables: `WT.accent`, `WT.success`, `WT.revenue`
3. **NEVER hardcode hex values** in widget components. Zero exceptions.
4. Fallback for missing data: use `WT.muted` or `text-text-disabled`

---

## i18n

ALL user-facing text MUST go through `useDictionary("dashboard")`. This includes:
- Widget titles
- Footer navigation text
- Empty state messages
- Status labels
- Period picker options
- Tooltip labels
- "+N more" text
- Fallback strings

Pattern: `t("key") ?? "English fallback"`

---

## Shared Component Usage

These shared components MUST be used. Never hand-roll equivalent markup:

| Component | Use For |
|-----------|---------|
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
