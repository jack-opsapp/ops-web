# OPS Web — Interface Design System v2

> **Canonical spec:** `docs/superpowers/specs/2026-04-15-ops-web-visual-system-design.md`
> This file is the quick-reference for every styling decision. The spec is the source of truth for WCAG ratios, migration details, and audit history.

## Direction

**Who:** A trades business owner — roofer, plumber, electrician — drowning in texts, paper, and chaos. Checking the dashboard between job sites, in the truck, on a phone or tablet. Not a desk-bound power user.

**Feel:** Command Deck — Apple-depth glass panels with tactical content. Uppercase Kosugi labels, `//` slash prefixes, JetBrains Mono data readouts, Mohave hero type. Earth-tone semantic palette. Military, measured, no nonsense. Every element earns its place.

**Depth strategy:** Glass surfaces + borders only on **static UI**. Top-edge gradient pseudo-element provides subtle lit-from-above quality. Stacked glass (dense variant) for modals/popovers over panels. **Floating-window shells** (workspace, future estimate/email composers) are the lone sanctioned `box-shadow` exception — see Depth Rules below.

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

### Agent Provenance Palette — Claude-authored surfaces only

| Token | Value | Use |
|-------|-------|-----|
| `agent` | `#8A7FB8` | Base agent fill, borders, AI-draft chevron tag |
| `agent-hi` | `#B5ABDC` | Emphasis text on agent surfaces |
| `agent-text` | `#C9C0E6` | Body text Claude wrote |
| `agent-text-2` | `#A39CC9` | Secondary / provenance lines ("Edited from Claude draft · 12s ago") |
| `agent-border` | `rgba(138,127,184,0.18)` | Dividers / outlines on agent cards |
| `agent-border-hi` | `rgba(138,127,184,0.36)` | Emphasis borders |
| `agent-bg` | `rgba(138,127,184,0.04)` | Tinted backgrounds |
| `agent-bg-hi` | `rgba(138,127,184,0.10)` | Hover / active agent surfaces |

**Rule.** Lavender is reserved for Claude-authored surfaces. Allowed: AI summary band, "Claude drafted this" labels, auto-sent banner, autonomy panel, AI-drafted bubble fills, AI-drafted thread row indicator, agent body text. Forbidden: category chips, status pills, links, drafts authored by user / Gmail, opportunities, "Your turn" banner, anything human-authored. If a surface mixes user + Claude content (edited Claude draft), use neutral text and surface agent provenance with a small `agent-text-2` provenance line.

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
| **JetBrains Mono** | All micro labels, numerical data, timestamps, metadata, category tags, `//` prefixes, tactical brackets |
| **Cake Mono** (brand + TopBar H1 + display) | Uppercase display voice — see Logo & Brand section |

**Kosugi is deprecated** (removed 2026-04-17). Every former Kosugi usage moved to JetBrains Mono — the mono face now carries both the tactical-label and numerical-data roles.

### Size Floor

**11px minimum. No exceptions.** `text-micro` (11px) is the smallest allowed token.

### Font Feature Settings

All numerical contexts: `font-feature-settings: "tnum" 1, "zero" 1` (tabular numerals, slashed zero).

### Type Hierarchy

| Role | Classes | Size | Use |
|------|---------|------|-----|
| Hero number | `font-mohave font-light` | 76–84px | Dashboard hero, revenue total |
| Page title (TopBar H1) | `font-cakemono font-light uppercase` | 22px | Root-route page heading — dashboard, clients, invoices, etc. |
| Display heading | `font-cakemono font-light uppercase` | 28–32px | Auth h1s, wizard step titles, account-type screen |
| Section heading | `font-cakemono font-light uppercase` | 15–20px | Admin section headers, settings panel subheads |
| Button label | `font-cakemono font-light uppercase` | 14px | Primary/secondary uppercase button text |
| Badge | `font-cakemono font-light uppercase tracking-wider` | 11px | Status badges, role tags |
| Panel title | `font-mono text-micro uppercase tracking-wider` | 11px | Widget/section titles |
| Body / name | `font-mohave text-body-sm` | 14px | Entity names, row primary text |
| Data value (lg) | `font-mono text-data-lg font-semibold` | 20px | Hero metrics in widgets |
| Data value | `font-mono text-data-sm` | 13px | Standard data values |
| Category label | `font-mono text-micro uppercase tracking-wider` | 11px | BOOKED, INVOICED, etc. |
| Metadata | `font-mono text-micro` | 11px | Timestamps, IDs, subtotals |
| Row secondary | `font-mono text-micro` | 11px | Line item secondary text |
| Footer | `font-mono text-micro uppercase tracking-wider` | 11px | "View Invoices" etc. |
| Badge | `font-mono text-micro uppercase tracking-wider` | 11px | Status badges |

---

## Logo & Brand

### The Mark
The OPS mark is two interlocking chamfered brackets with subtle isometric extrusion. Monochrome only. Never apply color, gradient, shadow, or glow. Use `<OpsMark>` from `@/components/brand` — it renders inline SVG with `fill="currentColor"` so color inherits from CSS `color`.

### Lockups
`<OpsLockup orientation="horizontal">` — mark + "OPS" (Cake Mono, outlined paths) inline. Natural aspect ~1.59:1. Use for: sidebar footer, auth hero, blog header, portal watermark, email headers.
`<OpsLockup orientation="vertical">` — mark above "OPS". 1:1 square. Use for: loading gates, onboarding welcome screens.

### Clear Space & Minimum Size
- Clear space around the mark: at least 25% of the mark's height on all sides. No other element (text, border, icon) may enter this buffer.
- Minimum display size: 16px (mark), 24px tall (horizontal lockup), 48px tall (vertical lockup). Below these thresholds the extrusion detail collapses.

### Typography Role: Cake Mono = Heavy Uppercase Display Voice

**Cake Mono Light is OPS-Web's uppercase display voice.** It replaces every former "heavy-weight Mohave uppercase" treatment. Use it anywhere the visual intent is "confident, branded, all-caps" — page titles, section headers, buttons, badges, card titles, form labels, wizard step headings, modal titles, dashboard panel subheaders, calendar event labels.

**Weight is always `font-light` (300).** Never use Regular (400) or Bold (700) in product UI — they override Cake Mono's natural condensed tension. If something needs to read heavier, increase the size, don't increase the weight.

**Tracking:** Cake Mono is tightly metered by design. Most usages drop `tracking-wider` — apply extra tracking only when the visual context demands it (e.g., full-screen hero wordmarks).

**Still reserved for brand surfaces (uses same `font-cakemono` class):**
- Logo lockups (`<OpsLockup>`)
- iOS / Android app icon
- Marketing hero wordmarks (`ops-site/`)
- Social share images (OG, Twitter card)

**Never use Cake Mono for:**
- Body text, paragraphs, long-form copy
- Sentence-case content
- Numerical data readouts (use `font-mono`)
- Small-caps category labels (use `font-mono`, which is already the "small uppercase" voice)

**Mohave remains the voice for:**
- Hero numbers (Mohave Light at 76–84px)
- Body text, names, secondary text (Mohave 400–500 sentence-case)
- Anything non-uppercase at display sizes

**Kosugi remains the voice for:** 11px uppercase category labels — the micro label tier below Cake Mono.

Cake Mono is loaded via Adobe Typekit (kit id `dbh0pet`) in the root layout `<head>`. Weights available: 300 (Light), 400 (Regular), 700 (Bold). Product UI uses 300 only.

**ops-site** (marketing) does NOT follow this rule — it retains heavy Mohave display type. The web product (OPS-Web) and the marketing site diverge here intentionally.

### Color Treatment
- On dark backgrounds (product chrome, dashboard): mark in `text` (#EDEDED) via CSS `color` inherited through `currentColor`.
- On light backgrounds (invoices, printed docs, light-mode emails): mark in `#000000`.
- Never tint with accent, earth tones, or any non-monochrome color.

### Accessibility
Every usage carries a `title` prop that resolves to "OPS" (default) OR explicit `title=""` for purely decorative instances where surrounding text already identifies the brand. Avoid stacking `aria-label` on a wrapper with the SVG's own title — use one or the other.

### Deprecated
Bebas Neue (removed 2026-04-17). Any new `font-family: "Bebas Neue"` declaration fails review.

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

- Glass + borders only on **static UI surfaces** (cards, panels, widgets, sidebars, headers, tab strips). Zero `box-shadow`.
- The top-edge gradient pseudo-element is the only depth cue on static surfaces.
- No `shadow-card`, `shadow-elevated`, `shadow-floating` — these legacy tokens are deprecated.

#### Floating-window exception (sanctioned 2026-05-07)

**Floating-window shells** — the only `box-shadow`-bearing surfaces in OPS-Web — separate dense glass from the canvas where a borderless ring alone would not. Two tokens cover every approved use:

| Token | Stack | Use |
|-------|-------|-----|
| `--shadow-window` | `0 24px 64px rgba(0,0,0,0.65), 0 0 0 0.5px rgba(255,255,255,0.04)` | Workspace shell; future estimate / email composer windows |
| `--shadow-dropdown` | `0 12px 32px rgba(0,0,0,0.55)` | Floating dropdowns over busy underlayments (e.g. address autocomplete over Mapbox tiles) |

These tokens are the **complete allowlist**. New shadow stacks are not permitted; reuse the closest token or escalate. Static UI inside the floating window (panels, rows, inputs) still keeps to glass + borders only.

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

## Right-Edge Action Tabs

The right edge of the canvas houses a stack of tactical action tabs — slim 28px vertical tabs flush against `right: 0`, each pairing with its own drawer. The current instances are **Notifications** (`N`), **Quick Actions** (`Q`), and **Bug Report** (`` ` ``). All three render through the shared `<EdgeTab>` primitive at `src/components/ui/edge-tab.tsx`.

### Anatomy

| Element | Spec |
|---------|------|
| Tab width | `28px` always |
| Tab rest height | Per instance — Notifications `180px`, Quick Actions `132px`, Bug Report `100px` |
| Tab expanded height (hover or open) | Matches paired drawer height (animates `top` + `height` simultaneously, never `bottom`/`transform`) |
| Background | `var(--glass)` |
| Backdrop | `blur(28px) saturate(1.3)` |
| Border | `1px solid var(--glass-border)`, `border-right: none` |
| Radius | `4px` top-left + bottom-left only (flat against edge) |
| Accent stripe | `2px` left edge, full height. Color reflects state per instance — see Accent Tones below |
| Glyph | Centered. Closed state `rotate(-90deg)` (lays sideways with vertical wordmark), open state `rotate(45deg)` (`+` becomes `×`). 220ms `EASE_SMOOTH` |
| Wordmark | `font-mono` 9px, `letter-spacing: 0.18em`, vertical (`writing-mode: vertical-rl; transform: rotate(180deg)`), uppercase, `text-2` |
| Count badge | Closed only. `font-mono` 11px tabular-nums, vertical orientation matching wordmark |
| Hover tooltip | Closed only. `glass-dense` chip with title (`font-mohave` 13) + `KeyHint` shortcut, fades in to the left of the tab |

### Accent Tones

The left accent stripe is **always painted** — never empty. Color derives from instance semantics:

| Instance | At rest | Has critical | Has attention |
|---|---|---|---|
| Notifications | `--ops-accent` (steel blue) | `--rose` | `--tan` |
| Quick Actions | `--ops-accent` (steel blue, always — actions have no severity tone) | — | — |
| Bug Report | `--text-mute` (ambient — bug submission is voluntary, not urgent) | — | — |

### Stacking on the Right Edge

When two or more tabs share the right rail, they stack vertically centered on the viewport mid. The math is precomputed via `stackOffset`:

```
combined_height = tab1.restHeight + gap + tab2.restHeight  (gap = 8px)
midpoint = combined_height / 2
tab1.stackOffset = -(midpoint - tab1.restHeight/2)   // negative = above center
tab2.stackOffset = +(midpoint - tab2.restHeight/2)   // positive = below center
```

For Notifications (180) + Quick Actions (132): `STACK_OFFSET_NOTIF = -94`, `STACK_OFFSET_QA = +94`. When a tab expands (hover or open), `top` and `height` interpolate smoothly to fill the paired drawer's footprint — `top` becomes `0` and `height` becomes `100%` of the rail anchor.

**Bug Report (100px)** sits below Quick Actions in a three-stack arrangement:

```
Notifications  center −94 (above mid)   spans −184 → −4
gap                       8 px
Quick Actions  center +94 (below mid)   spans  +28 → +160
gap                       8 px
Bug Report     center +218               spans +168 → +268
```

`STACK_OFFSET_BUG = +218`. The third tab keeps the same 8px gap between siblings — it does not re-center the stack on the rail midpoint, so opening Bug Report doesn't shift the existing two tabs. On viewports where +268 would clip below the rail bottom, the EdgeTab's `maxHeight: calc(100vh - (railTop + railBottom))` clamp keeps everything visible.

### Drawer Pairing

Each tab pairs with **one** drawer. Two drawers cannot be open simultaneously — `useEdgeTabStore` enforces single-slot mutual exclusion via `activeTab: string | null`. Opening Quick Actions atomically closes Notifications and vice versa.

| Drawer style | Use when | Notifications | Quick Actions | Bug Report |
|---|---|---|---|---|
| **Full-rail** | Content needs vertical room (lists, filtering, scroll) | ✓ `top: 72; bottom: 16` | — | — |
| **Panel-anchored** | Content is finite and static (action menus, settings, single forms) | — | ✓ 308×452, anchored to tab vertical center via `stackOffset` math | ✓ 360×520, anchored at `STACK_OFFSET_BUG` |

### Drawer Surface

| Property | Full-rail (Notif) | Panel (Quick Actions) | Panel (Bug Report) |
|---|---|---|---|
| Width | `min(360px, calc(100vw - 36px))` | `308px` | `360px` (clamped to viewport) |
| Height | `calc(100vh - 88px)` (full rail) | `452px` (panel) | `520px` (panel) |
| Background | `var(--glass)` (0.58 alpha) | `rgba(32, 34, 38, 0.92)` | `rgba(32, 34, 38, 0.92)` (matches QA — form-dense, needs legibility) |
| Border | `1px solid var(--glass-border)` (0.09) | `1px solid rgba(255,255,255,0.18)` | `1px solid rgba(255,255,255,0.18)` |
| Border-right | `none` | `none` | `none` |
| Border-radius | `0` (flat against edge) | `0` (flat against edge) | `0` (flat against edge) |
| Top-edge highlight | `linear-gradient(180deg, rgba(255,255,255,0.04), transparent 40%)` | Same | Same |
| z-index | `1500` (floating-ui) | `1500` | `1500` |

### Open Animation

Both drawer styles slide in from the right edge over `260ms EASE_SMOOTH`:

```ts
hidden:  { x: width, opacity: 0 }
visible: { x: 0, opacity: 1, transition: { duration: 0.26, ease: EASE_SMOOTH } }
exit:    { x: width, opacity: 0, transition: { duration: 0.22, ease: EASE_SMOOTH } }
```

The tab simultaneously translates left by `drawerWidth` (CSS `right` transition, same 260ms / `EASE_SMOOTH`), so the tab remains stuck to the drawer's leading edge throughout.

### Customize Affordance

Long-press edit modes are **forbidden** on edge-tab drawers. Customize must be a persistent footer affordance:

```
[CUSTOMIZE →]   bottom-right of drawer, font-mono 10px, letter-spacing 0.14em, text-3
```

Clicking routes to the relevant settings tab (`/settings?tab=quick-actions` for Quick Actions). The drawer closes on navigation.

### Keyboard Shortcuts

Single-letter, no modifier, registered globally with input/textarea/contenteditable guards. Toggles open/close.

| Tab | Shortcut |
|---|---|
| Notifications | `N` |
| Quick Actions | `Q` |
| Bug Report | `` ` `` (backtick) |

`Escape` closes the active drawer. Both shortcuts mount via document keydown listener and check:

```ts
if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
const tag = (e.target as HTMLElement)?.tagName;
if (tag === "INPUT" || tag === "TEXTAREA") return;
if ((e.target as HTMLElement)?.isContentEditable) return;
```

### Hide Conditions

Edge tabs hide when the canvas is in immersive/full-bleed mode:

- `pathname === "/intel"` (full-bleed map canvas)
- Dashboard customize mode active
- A wizard or duplicate-review sheet is open

When hidden, the corresponding `<EdgeTab>` returns `null` — the entire tab is removed from the DOM, not just hidden via opacity.

### Reduced Motion

Both tabs and drawers must provide `useReducedMotion()` fallbacks: opacity-only transitions at `150ms`. Glyph rotation and slide motion are suppressed.

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
│ HEADER: title (left) + controls     │ ← font-mono text-micro uppercase
├─────────────────────────────────────┤
│ CONTENT: chart / metrics / list     │ ← main data display
├─────────────────────────────────────┤
│ FOOTER: navigation text             │ ← font-mono text-micro uppercase
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
- Font: `font-mono text-micro uppercase tracking-wider`
- No accent on active pill.

### "+N More" (WidgetMoreButton)

- Font: `font-mono text-micro text-text-3 hover:text-text-2`
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

## Keyboard Annotations

Every keyboard shortcut on screen renders through **`KeyHint`** (`src/components/ui/key-hint.tsx`). Do not hand-roll `<kbd>` chips.

### Canonical glyphs

Always use these symbols — never spelled-out words like `"Cmd"` or `"Enter"`.

| Key | Glyph | Key | Glyph |
|-----|-------|-----|-------|
| Command | `⌘` | Enter / Return | `↵` |
| Option / Alt | `⌥` | Backspace | `⌫` |
| Shift | `⇧` | Space | `␣` |
| Control | `⌃` | Escape | `⎋` |
| Tab | `⇥` | Arrows | `→ ← ↑ ↓` |

### Variants

| Variant | Use when | Visual |
|---------|----------|--------|
| **`chip`** *(default)* | Standalone reference: shortcut lists, tooltips, command palette, search-field hints, menu items | Boxed: `bg-[rgba(255,255,255,0.06)]`, `border-[rgba(255,255,255,0.10)]`, `rounded-[3px]`, `min-w-[20px] h-[20px] px-[5px]`. Combos render as side-by-side chips with `gap-[4px]`. |
| **`inline`** | Inside a coloured button or running text where a hard-edged chip would compete with the container | Bracketed mono: `[K]` or `[⌘K]`, `font-mono text-[11px] opacity-70`, colour inherits from parent. |

### Rules

1. **Always mono** (`font-mono` — JetBrains Mono) at `text-[11px]`. Never Kosugi, never Mohave.
2. **Never accent-coloured.** KeyHints are metadata, not primary actions.
3. **Multi-key combos** = pass an array: `<KeyHint keys={["⌘","K"]} />` → renders `⌘` `K` (chip) or `[⌘K]` (inline).
4. **Accessibility**: `KeyHint` wraps a real `<kbd>` element and sets `aria-label` from a glyph-to-name map so screen readers announce "Command K" instead of the raw glyph. Override with an explicit `aria-label` if the context needs different copy.
5. **Never pair with a repeating text label.** "Press [K] to search" — not "Press K key [K]".

### Usage

```tsx
import { KeyHint } from "@/components/ui/key-hint";

// Single key, standalone
<KeyHint keys="K" />

// Combo, standalone
<KeyHint keys={["⌘", "K"]} />

// Inline inside a button or muted text
<button>
  <KeyHint keys="1" variant="inline" /> SAVE AS LEAD
</button>
```

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

### Calendar event badges & bars (frosted-glass tinted fill)

Calendar event chips, bars, and the type/status sub-badges paint over a busy
canvas (grid lines, day numbers, drop targets). Their fill MUST be a frosted-
glass-tinted layer so content behind them never bleeds through and hurts
legibility.

**Recipe (canonical — exposed via `frostedBadgeStyle()` in `calendar-utils.ts`):**

- `background: linear-gradient({typeColors.bg}, {typeColors.bg}), rgba(18, 18, 20, 0.78)`
  — type tint stacked over the dense-glass dark base.
- `backdrop-filter: blur(28px) saturate(1.3)` (and the `-webkit-` prefix).
- Border: `1px solid {typeColors.border}` (full-strength type color).
- Type tint alpha stays at `0.18` (`colorTripleFromHex` default) — do not
  raise it; the dark base is what guarantees legibility.

Use `frostedBadgeStyle(event.typeColors)` for type-driven fills (Month bars,
Crew blocks, Day card type badges, hover-popover type chip) and
`frostedBadgeStyleFromBg(event.statusColors.bg)` for status-driven fills
(Day timed blocks, all-day strip pills). Never paint a calendar badge with
just the raw `typeColors.bg` — the result is unreadable over busy grids.

---

## Calendar Badges (event bars in `/calendar`)

The month, week, day, and crew views all render the same logical artifact — an event badge sitting on top of a day cell. The day cell carries weekend tinting, today highlight, and grid overlays, so the badge fill must opaque enough that none of those bleed through.

**Task events (`kind === "task"`) — single rule across all sizes (sm / md / lg):**

- Background: `rgba(255, 255, 255, 0.04)` (frosted-glass tint, neutral)
- Border: 1px hairline of the badge's status hue at alpha 0.30 — derived from the type color via `hairlineBorder(typeColors.border)`
- Text: status-tone color (`typeColors.text`)
- The full-strength type stripe (3–4px) on the leading edge stays — it is the primary type signal
- The right-side type chip stays uppercase Cake Mono Light at 9–10px

### Special-event treatments (non-color signal)

The special-events row in the crew view, plus any month/week/day rendering of personal or time-off events, MUST use the non-color signal below. Task type colors can land on any palette and would visually merge into special events otherwise.

| Kind | Background | Border | Glyph | Text |
|------|------------|--------|-------|------|
| `personal` | `rgba(255, 255, 255, 0.10)` | `rgba(255, 255, 255, 0.20)` | Lucide `Star` (filled, 1.5px stroke) | `#FFFFFF` |
| `time_off` | `rgba(196, 168, 104, 0.06)` | `rgba(196, 168, 104, 0.30)` (`--tan`) | Lucide `TreePalm` (1.5px stroke) | `#C4A868` (`--tan`) |

Special events drop the type stripe and type chip. The leading glyph (Star or TreePalm) carries the kind signal. (Bugs `0342efaf` time-off, `89a5d774` personal.)

**Status-locked badges** (completed / cancelled): full-strength border + dimming overlay overrides the hairline rule.

The badge MUST use this surface — direct status-fill (`event.typeColors.bg` at 18% alpha) leaves day cells visible behind the bar and was retired (bug 7424ea4f).

### Today cell (highlighted day in month / week / day / crew)

The cell containing `today` reads with a frosted-glass tint of the primary accent so the operator can spot it at a glance even on a busy month grid. (Bug `a561f726`.)

| Property | Value |
|----------|-------|
| Background | `var(--ops-accent-soft)` (`rgba(111, 148, 176, 0.12)`) |
| Border / inset highlight | `var(--ops-accent-line)` (`rgba(111, 148, 176, 0.30)`) — month grid uses `box-shadow: inset 0 0 0 1px ...` to avoid replacing the cell's right grid border |
| Drop-target hover (drag-over) | `rgba(111, 148, 176, 0.18)` — brightens above today fill so a drag indicator always reads as the strongest signal |
| Today badge / chip (header) | `var(--ops-accent)` solid fill, black text, 4px radius |

The previous 0.06-alpha tint read identical to the weekend tint and was indistinguishable on busy weeks. The new 0.12 + accent-line border keeps today readable without competing with task badges.

### Unscheduled tray dock side

The unscheduled tray docks **LEFT** in every view (month / week / day / crew). The tray is a secondary panel — left-side placement matches the sidebar / filter rail mental model and avoids the previous bouncing-across-views feel. (Bug `8620c037`.) Mounted in `src/app/(dashboard)/calendar/page.tsx` once and rendered ahead of the main calendar grid container.

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

---

### Project Workspace Patterns

- **Mode pill:** VIEWING (quiet) / EDITING (tan + pulse) / CREATING (accent + pulse). Pulse = 1.6s opacity 1↔0.45 (compositor-only — see plan amendment 12.6).
- **Mode-aware footer:** `ModeFooterConfig = { destructive | meta | spacer | secondary[] | ghost | primary }`. One primary per footer maximum.
- **Floating window shell:** 8-direction resize, traffic lights, draggable header. Position+size persist to `opsWin:{key}`. Sanctioned `--shadow-window` token (exception to "no box-shadow on dark backgrounds" rule — see 2026-05-07 amendment).
- **Status temperature drives chrome:** PROJECT_STATUS_COLORS hex bleeds into pin glow, schedule strip today-tick, active task highlight. Use `withAlpha(hex, percent)` utility (`src/lib/utils/color.ts`) instead of hex alpha-suffix.
- **Activity timeline:** `project_notes` is the single canonical table. `event_kind` (nullable) discriminates user notes (NULL) from system events. Compose new entries via `<NoteComposer>` (reused across surfaces).
- **ConfirmModal destructive variant:** glass-dense bg, rose accent stripe (`border-t-[var(--rose)]`), 12px modal radius, Cake Mono Light title, Mohave body, `--shadow-window` elevation. Used for archive; reusable for delete/revert/cancel flows.
