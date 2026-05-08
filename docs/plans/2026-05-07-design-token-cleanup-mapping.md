# Project Workspace — Design-Token Cleanup Mapping

**Status:** Checkpoint — awaiting review before sweep.
**Scope:** `src/components/ops/projects/workspace/` only.
**Goal:** Replace every raw `rgba(...)` / hex / alpha-suffix literal in the
workspace with a design-token reference. No behavioural change, no visual
drift beyond ≤0.02 alpha consolidation tolerance per the brief.

This document is the **mapping proposal**. Sweep work (Task 6) does not begin
until a reviewer signs off on the token taxonomy.

---

## Sources of truth consulted

1. `ops-design-system/project/SKILL.md` — agent brief (read first per protocol).
2. `ops-design-system/project/README.md` — voice + visual foundations.
3. `ops-design-system/project/uploads/system.md` v2 (2026-04-17) — canonical
   spec with WCAG ratios and component primitives.
4. `ops-design-system/project/colors_and_type.css` — canonical CSS tokens.
5. `OPS-Web/src/styles/globals.css` — the in-app token surface this PR mutates.

### What the design system specifies

| Family | Tokens already named in spec |
|--------|------------------------------|
| **White elevation** | `0.04` `surface-input`, `0.05` `surface-hover`, `0.06` `fill-neutral-dim`, `0.08` `surface-active`, `0.09` `glass-border`, `0.10` `line`/`border`, `0.14` `fill-neutral` |
| **Glass tint** | `0.40` `glass-bg-subtle` (OPS-Web only), `0.58` `glass-bg`, `0.78` `glass-bg-dense` |
| **Earth tones** | full soft/line pairs at 0.12 / 0.30 alphas |

### What the design system DOES NOT specify (gaps)

- **Black scrim scale.** The spec line 268-269 says "Glass + borders only.
  Zero `box-shadow` anywhere on dark backgrounds." The workspace pragmatically
  needs black-tinted overlays for: nested tab strips inside dense glass, modal
  drop shadows, dark washes over Mapbox tiles, pin-on-light-tile strokes.
  None of these have spec coverage. **This is the largest gap below.**
- **`rgba(255,255,255,0.18)`** — referenced in spec lines 305 (active toggle
  border) and 419 (period picker active pill border) but never given a CSS
  variable. `--glass-border-medium` is `0.12`, `--glass-border-strong` is
  `0.20` — neither matches the documented value.
- **`rgba(255,255,255,0.01)` and `rgba(255,255,255,0.02)`** — sub-input
  vignette tints. Outside the spec's named scale.
- **Map canvas bg `#0a0d10`** — Mapbox-specific; intentionally outside the
  brand palette per the in-file comment at `map-hero.tsx:34`.
- **Glass-over-map tint `rgba(18,18,20,0.92)`** — `--glass-dense` (0.78) is
  the spec dropdown surface, but the address-autocomplete dropdown floats
  over Mapbox tiles where 0.78 leaks the busy underlayment. Comment at
  `address-autocomplete.tsx:183-185` documents the deviation.
- **`rgba(20,20,20,0.55|0.95)` map fade** — slightly warmer than the
  18,18,20 glass family. Used in `map-hero.tsx:38` for the bottom fade
  that bridges the map tile to the compact strip below.

These gaps were surfaced for review rather than improvised on. The token
proposals below treat them as additions to OPS-Web's `globals.css`, not
mutations of the cross-platform spec.

---

## Inventory

Generated from
`grep -rohE 'rgba\([0-9, .]+\)' src/components/ops/projects/workspace/`,
deduplicated and ordered by usage frequency.

### A. White elevation (already covered by existing tokens)

| Literal | Existing token | Sites | Action |
|---------|----------------|-------|--------|
| `rgba(255,255,255,0.04)` | `--surface-input` | atoms/text-area.tsx:19 · atoms/btn.tsx:35,39 · atoms/chip.tsx:22 · atoms/icon-btn.tsx:24 · atoms/segmented.tsx:60 · atoms/text-input.tsx:23 · atoms/select.tsx:53 · shell/project-workspace-window.tsx:165 (boxShadow ring) · inputs/address-autocomplete.tsx:212 (border-bottom) | **Sweep to `var(--surface-input)`** |
| `rgba(255,255,255,0.05)` | `--surface-hover` | shell/window-title-bar.tsx:80 (gradient start) · shell/mode-pill.tsx:28 | **Sweep to `var(--surface-hover)`** |
| `rgba(255,255,255,0.06)` | `--fill-neutral-dim` | atoms/select.tsx:93 · viewing/project-sidebar.tsx:121 · viewing/schedule-strip.tsx:89 · viewing/activity-tab.tsx:101 · map/map-hero.tsx:524 · shell/mode-pill.tsx:29 | **Sweep to `var(--fill-neutral-dim)`** |
| `rgba(255,255,255,0.10)` (and ` 0.10` formatting variant) | `--line` (or `--glass-border-medium` if 0.12 acceptable — these are exact 0.10 sites so use `--line`) | shell/window-title-bar.tsx:79,104 · shell/traffic-light.tsx:83 · map/map-hero.tsx:29 (PILL_BORDER) · inputs/address-autocomplete.tsx:170,189 | **Sweep to `var(--line)`** |
| `rgba(255,255,255,0.14)` | `--fill-neutral` | map/map-hero.tsx:405 | **Sweep to `var(--fill-neutral)`** |

**Subtotal:** 25 sites covered by existing tokens. Zero new tokens needed.

### B. White elevation (gaps in token table)

| Literal | Sites | Proposed token | Rationale |
|---------|-------|----------------|-----------|
| `rgba(255,255,255,0.01)` | shell/window-title-bar.tsx:80 (gradient end) | None — refactor to `transparent` | Gradient `0.05 → 0.01` is visually identical to `0.05 → transparent` on dark glass. Saves a token; fade preserved. |
| `rgba(255,255,255,0.02)` | viewing/project-sidebar.tsx:83 · viewing/accounting-tab.tsx:126 | **`--surface-vignette`** = `rgba(255,255,255,0.02)` | Sub-input wash for "card-on-glass" patterns. Below `--surface-input` (0.04) and above transparent. Used where a panel needs faint definition without competing with an enclosing input. |
| `rgba(255,255,255,0.18)` | shell/traffic-light.tsx:83 | **`--glass-border-active`** = `rgba(255,255,255,0.18)` | Spec lines 305 and 419 explicitly call for this value on active toggles and period pickers but no CSS variable exists. Bridges `--glass-border-medium` (0.12) and `--glass-border-strong` (0.20). |

**New tokens:** 2 (`--surface-vignette`, `--glass-border-active`).
**Refactors-to-existing:** 1 (the `0.01` → `transparent` swap).

### C. Black scrim — the design-system gap

The workspace uses 9 distinct `rgba(0, 0, 0, ...)` alphas across 11 sites for
purposes the spec explicitly disallows ("Zero box-shadows on dark
backgrounds"). The pragmatic reality: nested glass-over-glass surfaces, drop
shadows under floating windows, and dark washes over Mapbox tiles all need
black-tinted overlays.

I propose a **5-token semantic scale** that consolidates within the brief's
≤0.02 alpha drift tolerance.

| Proposed token | Value | Replaces | Sites |
|----------------|-------|----------|-------|
| **`--scrim-strip-bg`** | `rgba(0,0,0,0.18)` | `0.16`, `0.18`, `0.20` | viewing/project-viewing-tabs.tsx:55 (0.16) · viewing/schedule-strip.tsx:82 (0.18) · shell/modal-tabs.tsx:37 (0.20) |
| **`--scrim-overlay`** | `rgba(0,0,0,0.32)` | `0.30`, `0.32` | shell/traffic-light.tsx:86 (0.30 hover border) · viewing/project-viewing-body.tsx:65 (0.32 overlay) |
| **`--scrim-input-bg`** | `rgba(0,0,0,0.45)` | `0.42`, `0.45` | shell/mode-footer.tsx:63 (0.42) · inputs/address-autocomplete.tsx:172 (0.45) |
| **`--scrim-edge-stroke`** | `rgba(0,0,0,0.55)` | `0.5`, `0.55` | map/project-map.tsx:109 (0.5 pin border) · map/project-map.tsx:147 (0.55) · shell/traffic-light.tsx:41 (0.55 stroke) · inputs/address-autocomplete.tsx:191 (0.55 boxShadow) |
| **`--scrim-window-shadow`** | `rgba(0,0,0,0.65)` | `0.65` | shell/project-workspace-window.tsx:165 (boxShadow) · map/map-hero.tsx:28 (PILL_BG) |

**Drift footprint** (for visual-parity audit):
- `0.16 → 0.18` = +12.5% relative; on glass over `#000`, undetectable.
- `0.20 → 0.18` (modal-tabs only) = -10% relative; modal-tabs underlines re-read at slightly less contrast — flagged for visual check.
- `0.30 → 0.32` = +6.7% relative; undetectable.
- `0.42 → 0.45` = +7.1% relative; undetectable.
- `0.50 → 0.55` (project-map pin border) = +10% relative; pin border on light Mapbox tiles is the one place this could read — the 0.05 alpha shift adds ~5% perceptual darkness to a 2px stroke. Acceptable.

**New tokens:** 5.

> **Open question for reviewer:** Token names are semantic (`-strip-bg`,
> `-overlay`, etc.) per the brief's preference for "fewer-but-meaningful
> tokens" over a numeric ramp. If you'd rather see a numeric ramp
> (`--scrim-1` … `--scrim-5`) for orthogonality with `--text-1/2/3` and
> `--glass-bg/-dense/-subtle`, this is the moment to redirect.

### D. Glass-tinted (off-spec variants)

| Literal | Sites | Proposed token | Rationale |
|---------|-------|----------------|-----------|
| `rgba(18,18,20,0.92)` | inputs/address-autocomplete.tsx:186 | **`--glass-bg-opaque`** = `rgba(18,18,20,0.92)` | Documented exception (file comment): `--glass-dense` (0.78) leaks Mapbox tiles. 0.92 keeps address rows readable. Add as the highest tier in the glass family. |
| `rgba(20,20,20,0.55)` | map/map-hero.tsx:38 (FADE_GRADIENT mid-stop) | **`--map-fade-mid`** = `rgba(20,20,20,0.55)` | Slightly warmer than 18,18,20 glass family. Map-scoped, not a brand token. |
| `rgba(20,20,20,0.95)` | map/map-hero.tsx:38 (FADE_GRADIENT end-stop) | **`--map-fade-end`** = `rgba(20,20,20,0.95)` | Bridges Mapbox canvas to compact strip below. Map-scoped. |

**New tokens:** 3 (one for the dropdown deviation, two scoped to the map fade).

### E. Hex literals

| Literal | Sites | Proposed token | Rationale |
|---------|-------|----------------|-----------|
| `#0a0d10` | map/map-hero.tsx:36 (`MAP_CANVAS_BG`) · map/project-map.tsx:30 (`MAP_CANVAS_BG`) | **`--map-canvas-bg`** = `#0a0d10` | Mapbox tile canvas. In-file comment notes "no design-system token matches; this is scoped to the map surface only." Make it a token so the rule "no hex literals in workspace files" stays absolute. |

**New tokens:** 1.

### F. Status-color alpha-suffix patterns

| Literal | Sites | Replacement |
|---------|-------|-------------|
| `${statusColor}33` (≈ alpha 0.20) | viewing/schedule-strip.tsx:95 | `withAlpha(statusColor, 20)` |
| `${statusColor}55` (≈ alpha 0.33) | viewing/schedule-strip.tsx:111 | `withAlpha(statusColor, 33)` |
| `${color}80` (≈ alpha 0.50) | map/project-map.tsx:146 | `withAlpha(color, 50)` |

**Note to reviewer:** the brief mentions "2 magic alpha-suffix patterns" but
inventory turned up **3** (the `${color}80` boxShadow on `OtherProjectPin`
in `project-map.tsx:146` was missed). All three are addressed by the same
`withAlpha(hex, alphaPercent)` utility. No additional design decision needed.

**Utility location:** `src/lib/utils/color.ts` (new file — no existing color
helper at that path; `src/lib/portal/theme.ts:72` has a `lightenHex` but
it's portal-scoped). Add unit tests covering: 6-char hex input, 7-char
`#`-prefixed input, alpha clamping (0–100), and rejection of malformed
input.

### G. Out-of-scope literals (deferred — flagged for awareness)

| Literal | Site | Why deferred |
|---------|------|--------------|
| `0 24px 64px rgba(0,0,0,0.65)` boxShadow stack | shell/project-workspace-window.tsx:164-165 | The black-alpha component is tokenized via `--scrim-window-shadow`. The full shadow stack (24px blur, 64px y-offset) violates spec line 268 ("Zero box-shadows on dark backgrounds") but is operationally required for floating-window depth. **Surfacing as a design-system gap, not improvising a `--shadow-window` token in this PR.** |
| `0 12px 32px rgba(0,0,0,0.55)` boxShadow | inputs/address-autocomplete.tsx:191 | Same gap class. Black tint covered by `--scrim-edge-stroke`; full shadow stack is the gap. |
| `0 0 12px ${color}` and `0 0 6px ${color}` glow shadows | map/project-map.tsx:108 · map/map-hero.tsx:344, 388, 563 | Status-colored glow effects — no alpha, no hex literal to sweep. The `${color}` interpolation is OK as-is once `withAlpha` lands for the alpha-suffix sites. |
| Comment-only mentions of rgba values | shell/modal-tabs.tsx:11 · inputs/address-autocomplete.tsx:183 | Documentation comments referencing token values — not live literals. No sweep. |

---

## Summary

**Proposed new tokens (11 total):**

```css
/* Add to src/styles/globals.css under :root, alphabetized within group */

/* White elevation (gap fill) */
--glass-border-active: rgba(255, 255, 255, 0.18);
--surface-vignette:    rgba(255, 255, 255, 0.02);

/* Black scrim scale (new family — design-system gap addressed) */
--scrim-strip-bg:      rgba(0, 0, 0, 0.18);
--scrim-overlay:       rgba(0, 0, 0, 0.32);
--scrim-input-bg:      rgba(0, 0, 0, 0.45);
--scrim-edge-stroke:   rgba(0, 0, 0, 0.55);
--scrim-window-shadow: rgba(0, 0, 0, 0.65);

/* Glass tint (off-spec variants) */
--glass-bg-opaque:     rgba(18, 18, 20, 0.92);

/* Map-scoped */
--map-canvas-bg:       #0a0d10;
--map-fade-mid:        rgba(20, 20, 20, 0.55);
--map-fade-end:        rgba(20, 20, 20, 0.95);
```

**Sweep volume:**
- 25 sites → existing tokens (no new tokens needed).
- 9 sites → new white-elevation / glass-tint tokens.
- 11 sites → new black-scrim tokens.
- 2 sites → `MAP_CANVAS_BG` constant → `--map-canvas-bg`.
- 3 sites → `withAlpha(hex, percent)` utility.
- 1 site → `0.01` literal collapsed into `transparent` (gradient).

**Visual-drift footprint:** 5 alpha consolidations within the ≤0.02
tolerance. The largest perceptual delta is the `0.50 → 0.55` shift on the
2px pin border in `project-map.tsx:109` — a ~5% darkness increase against
light Mapbox tiles. Acceptable per brief.

---

## Reviewer checkpoint

Please confirm:

1. **Token naming.** Semantic (`--scrim-strip-bg`, `--scrim-overlay`, …) vs
   numeric ramp (`--scrim-1` … `--scrim-5`). I went semantic per the
   brief's "fewer-but-meaningful" preference; happy to flip.
2. **Map-scoped tokens.** Are `--map-canvas-bg`, `--map-fade-mid`,
   `--map-fade-end` acceptable as workspace-local concerns, or should they
   live elsewhere (e.g. a `map.css` module)?
3. **Modal-tabs drift.** The `0.20 → 0.18` consolidation in
   `shell/modal-tabs.tsx:37` is the only -direction shift. Acceptable, or
   should I keep it as `--scrim-strip-bg-mid` (a 6th scrim token)?
4. **Black-shadow gap.** I flagged `0 24px 64px` and `0 12px 32px` shadows
   as design-system gaps but did NOT propose `--shadow-window` /
   `--shadow-dropdown` tokens. Do you want those added in Task 6, deferred
   to a separate doc, or escalated to Jackson before this PR lands?
5. **`withAlpha` utility location.** `src/lib/utils/color.ts` (new file).
   Or should it live next to `cn` in `src/lib/utils/cn.ts`?

Sweep work (Task 6) does not begin until these points are resolved.
