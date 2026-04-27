# CALIBRATION — Design Specification

> **Status:** Phase 3 complete. Ready for Phase 4 implementation plan.
> **Date:** 2026-04-23
> **Target:** `OPS-Web`, new route `/calibration`
> **Visual foundation:** OPS Design System v2 (2026-04-17) — `.interface-design/system.md`
> **Skills loaded:** `animation-architect`, `interface-design`, `frontend-design`, `data-visualization`, `web-animations`, `ops-copywriter`, `mobile-ux-design`
> **Upstream docs:** `2026-04-23-calibration-inventory.md` · `2026-04-23-calibration-decisions.md`

**Outline**
0. Intent · 1. Users · 2. Emotional arc · 3. Information architecture · 4. Visual system · 5. Command deck (populated) · 6. First-run wizard · 7. INPUTS drill-in · 8. CORPUS drill-in · 9. CONFIG drill-in · 10. ACTIVITY drill-in · 11. MILESTONES drill-in · 12. Motion & animation · 13. Responsive & touch · 14. Accessibility · 15. Copy · 16. Permissions · 17. Migration · 18. Data model · 19. Non-goals · 20. Open implementation items

---

## 0. Intent

**Who this is for.** The trades business owner — deck contractor, roofer, HVAC shop, paint crew — who turned on AI features and now wants to see what the system actually knows about their business, what it's learning, and how autonomously it's operating. They are skeptical of black boxes. They want to see the seams.

**What it replaces.** Seven scattered surfaces today (`/settings/integrations/ai-setup`, `/agent/comms-config`, `/intel`, the phase-c dashboard widget on `/agent/queue`, `AutonomyStatusPanel`, `AutoSendSettings`, `EmailCategoryAutonomy`) are consolidated into one command deck at `/calibration`.

**What it feels like.** A radar scope, not a settings page. A bridge on a ship, not an admin panel. Every tile has a live pulse. Activity arrives from the edge and fades out the other side. Milestones unlock like stations on a ladder. The aesthetic signature is **tactical, always-scanning** — a system that breathes.

**Signature element.** A small radar-sweep pulse in the bottom-right corner of every tile. It rotates at 2.4s per cycle when idle, 1.2s when hovered. The sweep color maps to tile state: olive when nominal, amber when a source is actively running, muted when the tile is empty. It is the thing you notice before anything else; it's what makes CALIBRATION unmistakable.

**Rejected defaults (caught before defaulting).**
1. **Default:** Four-tab top nav with a pill indicator for the active tab. **Replaced with:** the 5-tile command deck — tiles are shaped by their data, not by a uniform tab skeleton.
2. **Default:** Icon + big number + label card skeleton repeated five times. **Replaced with:** each tile has its own internal composition (three rings, count-up, stacked bars, live sensor strip, domain grid) driven by the specific data shape.
3. **Default:** Big hero number at top of page. **Replaced with:** no hero. The deck itself is the primary view — status is distributed, not centralized.

---

## 1. Users

### Primary: Company admin (owner / operator)
- Has `email.configure_ai` permission.
- Visits `/calibration` after enabling phase_c, again after first scan completes, then weekly.
- Context: usually at a laptop, sometimes tablet in the truck between visits.
- Goal: verify the system is learning the right things, adjust autonomy, run a re-scan when the business changes.

### Secondary: Company admin during first-run
- Has permission but corpus is empty.
- Context: inside the OPS app for the first time after enabling AI.
- Goal: get through the 3 sources fast, see the system "come online."

### Out of scope: Field crew, OPS operators (internal), customer portal users
- Crew: no `email.configure_ai` permission → cannot see sidebar entry.
- OPS operators: continue using `/admin/system` for cross-company toggles.
- Customer portal: unrelated.

---

## 2. Emotional arc (per animation-architect)

| Stage | User feels | CALIBRATION's job | Motion beat |
|-------|-----------|-------------------|-------------|
| Sidebar click → page mount | Curious, maybe skeptical | Arrive with tactical precision. No wobble, no settling. | **Entry** — staggered tile reveal, 60ms between, opacity+6px translate, 200ms EASE_SMOOTH |
| Scanning the deck | Engaged, scanning for status | Reward exploration instantly. Radar pulses keep the surface alive. | **Discovery + Ambient** — continuous radar sweeps, hover brightens tile glass |
| Clicking a tile | About to commit to a focused view | Add weight. Transition feels like a camera move. | **Transition** — shared-element morph, 300ms, background tiles dim 0.3 |
| Running a source | Waiting, wants proof of progress | Continuous communication. Progress is never stuck. | **Commitment** — live progress ring, numbers ticking up, radar sweep accelerates |
| Milestone unlocks | Pride, validation | Celebrate with restraint. A stamp, not a parade. | **Achievement** — tile accent border pulse (1 beat, 240ms, olive at 0.9 → 0.3), persistent notification created, no confetti |
| Returning weekly | Settled, monitoring | The deck breathes even when nothing is happening. | **Ambient** — radar sweeps at 2.4s, RECENT rail tails scroll gently |

Every animation either serves one of these beats or gets cut. No decorative motion.

---

## 3. Information architecture

### 3.1 Route topology

```
/calibration                          ← Command deck (populated) OR first-run wizard (auto)
/calibration?section=inputs           ← INPUTS drill-in (3 re-runnable sub-sections)
/calibration?section=corpus           ← CORPUS drill-in (knowledge graph primary)
/calibration?section=config           ← CONFIG drill-in (autonomy + filters + categories)
/calibration?section=config&wizard=open  ← Same as above, with comms-config wizard auto-opened
/calibration?section=activity         ← ACTIVITY drill-in (live stream + filterable log)
/calibration?section=milestones       ← MILESTONES drill-in (absorbs PhaseCDashboard)
```

Query-param sections (not nested routes) so drill-ins preserve deck state and back-nav feels like a morph, not a page change.

### 3.2 Redirects wired in middleware

| Old URL | Rewrites to |
|---------|-------------|
| `/settings/integrations/ai-setup` | `/calibration` (permanent 308) |
| `/agent/comms-config` | `/calibration?section=config&wizard=open` (permanent 308) |
| `/intel` | `/calibration?section=corpus` (permanent 308) |

### 3.3 Sidebar entry

Lives in `src/components/layouts/sidebar.tsx` between `inbox` and `estimates`:

```tsx
{ label: t("nav.calibration"), href: "/calibration", icon: Radar, permission: "email.configure_ai" },
```

**Remove from sidebar:** `/intel` entry (consolidated into CALIBRATION).
**Keep as-is:** `/agent/queue` (BrainCircuit, admin permission) — not consolidated.

### 3.4 Deck ↔ drill-in semantics

The command deck is always the "home." Drilling in pushes a section state onto the URL; pressing the back button (browser or `←` breadcrumb) returns to the deck with tiles animating back into place via shared `layoutId`. This is a single-page feel — not a route cascade.

### 3.5 First-run vs populated mode switch

```
isFirstRun = interviewComplete === false
          && emailScanComplete === false
          && databaseMiningComplete === false
          && !userDismissedFirstRun
```

- `isFirstRun === true` → render `<FirstRunWizard>` (§6)
- `isFirstRun === false` → render `<CommandDeck>` (§5)

The flip is one-way per session: once the user completes or explicitly skips any input, `userDismissedFirstRun` persists and future visits render the deck. They can re-run any source from the INPUTS drill-in.

---

## 4. Visual system

### 4.1 Tokens (from `.interface-design/system.md` — no duplication)

All surfaces, text, borders, radii, spacing, and motion durations trace to the canonical tokens. The spec below **names tokens**, never raw hex.

### 4.2 Surface inventory

| Surface | Class | Use in CALIBRATION |
|---------|-------|---------------------|
| Page canvas | `bg-background` | Wraps everything |
| Tile | `.glass-surface rounded-panel` (10px) | Each of the 5 command-deck tiles |
| Drill-in surface | `.glass-surface rounded-panel` | Full-section body when drilled in |
| Modal / wizard overlay | `.glass-dense rounded-modal` (12px) | Comms-config wizard launcher, first-run wizard chrome |
| Inline input | `bg-surface-input rounded-[5px]` | Filter fields, search |
| Primary CTA | `bg-ops-accent text-black rounded-[5px]` (outlined at rest, fills on hover) | "RE-RUN WIZARD", "INITIATE SCAN", "ENGAGE" |

### 4.3 Typography inventory (all from system.md type hierarchy)

| Role | Token | Example use |
|------|-------|-------------|
| Page title | `font-cakemono font-light uppercase` 22px | `CALIBRATION` in TopBar |
| Breadcrumb | `font-mono text-micro uppercase tracking-wider` | `Command // Calibration // Inputs` |
| Tile title | `font-mono text-micro uppercase tracking-wider` with `//` prefix | `// INPUTS` |
| Tile hero data | `font-mohave font-light` 42px | `2,847` in CORPUS tile |
| Tile sub-metric | `font-mono text-data-sm` 13px | `+12 TODAY` |
| Tile footer | `font-mono text-micro` 11px | `LAST RUN 5M` |
| Section heading (drill-in) | `font-cakemono font-light uppercase` 20px | `AUTONOMY` within CONFIG |
| Body paragraph | `font-mohave text-body-sm` 14px | Descriptions, empty-state copy |
| CTA button label | `font-cakemono font-light uppercase` 14px | `RE-RUN WIZARD` |
| Event chip | `font-mono text-micro uppercase tracking-wider` | `SYS :: SCAN COMPLETE · 14:23` |

### 4.4 Palette application

| Token | Used for |
|-------|----------|
| `text` (#EDEDED) | Tile hero numbers, section titles |
| `text-2` (#B5B5B5) | Sub-metrics, body text, CTAs at rest |
| `text-3` (#8A8A8A) | Tile labels, secondary metadata |
| `text-mute` (#6A6A6A) | `//` slashes, `SYS ::` prefix, separators |
| `ops-accent` (#6F94B0) | Primary CTA, focus ring, milestone unlock pulse |
| `olive` (#9DB582) | Nominal status, completed scans, positive milestones |
| `tan` (#C4A868) | In-progress, warnings, writing profile in training |
| `rose` (#B58289) | Errors, failed scans, low confidence (<0.3) |
| `fill-neutral` (white 14%) | Autonomy-level stacked bars, progress tracks |
| `fill-neutral-dim` (white 6%) | Idle tile sparkline backgrounds |

**No bright colors, no gradients, no neon.** The palette is the same everywhere; CALIBRATION earns its identity through composition and motion, not color.

### 4.5 Border radius

| Element | Radius |
|---------|--------|
| Tile | 10px (`rounded-panel`) |
| Drill-in container | 10px |
| Modal / wizard frame | 12px (`rounded-modal`) |
| Button | 5px |
| Chip / event pill | 4px (`rounded-chip`) |
| Progress bar track | 2px (`rounded-bar`) |
| Radar sweep container | 50% (circular) |

### 4.6 Signature — the radar sweep

The visual signature is a small continuously-rotating radar sweep in the bottom-right corner of every tile. It is **the one element that could only exist for CALIBRATION**.

```
Specs
─────
Container:  16×16px, positioned absolute, bottom:12px right:12px
Background: radial gradient — rgba(255,255,255,0.02) 0% → transparent 70%
Rings:      2 × 1px circles at 25% and 50% radius, color text-mute at 0.3 opacity
Sweep arm:  1px stroke from center to edge
Sweep fade: conic gradient trailing the arm 60° wide, 0.5 → 0 opacity
Rotation:   transform: rotate(0 → 360deg), animation 2.4s linear infinite (idle)
Hover:      animation-duration shortens to 1.2s over 200ms ease-out
Color map:  olive (nominal) | tan (source running) | rose (error) | text-3 (empty)
Reduced motion: animation paused at 315deg (static 45° arm), opacity 0.35
Intersection Observer: pause off-screen, resume on-screen
```

Implementation uses inline SVG with CSS `animation` — no JavaScript rAF. The pause-off-screen logic toggles the `animation-play-state` CSS property via an Intersection Observer.

---

## 5. Command deck — `/calibration` (populated mode)

### 5.1 Layout

Desktop ≥1200px:

```
 canvas padding 36px 44px, max-content 1320px
┌───────────────────────────────────────────────────────────────────┐
│ TopBar (existing chrome, not scoped)                              │
├───────────────────────────────────────────────────────────────────┤
│                                                                    │
│  // CALIBRATION                                                    │ ← page title row
│  [breadcrumb: Command // Calibration]                              │
│                                                                    │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐                      │
│  │  INPUTS   │  │  CORPUS   │  │  CONFIG   │   row 1 — 3 equal    │
│  │           │  │           │  │           │   tiles, 24px gap    │
│  │   […]     │  │   […]     │  │   […]     │                      │
│  │         ·│  │         ·│  │         ·│   · = radar sweep   │
│  └───────────┘  └───────────┘  └───────────┘                      │
│                                                                    │
│  ┌───────────┐  ┌─────────────────────────┐                       │
│  │ ACTIVITY  │  │      MILESTONES         │   row 2 — ACTIVITY    │
│  │           │  │                         │   1fr, MILESTONES     │
│  │   […]     │  │         […]             │   2fr (domain grid    │
│  │         ·│  │                       ·│   needs room)        │
│  └───────────┘  └─────────────────────────┘                       │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ // RECENT                                                     │ │
│  │ < SYS :: SCAN · 02:41 > < SYS :: 12 LEARNINGS · 12:18 > ...   │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
└───────────────────────────────────────────────────────────────────┘
```

Grid template (CSS):

```css
.calibration-deck {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  grid-template-rows: auto auto auto; /* row 1, row 2, recent rail */
  gap: 24px;
  padding: 36px 44px;
  max-width: 1320px;
  margin: 0 auto;
}

.deck-tile--inputs     { grid-column: 1; grid-row: 1; }
.deck-tile--corpus     { grid-column: 2; grid-row: 1; }
.deck-tile--config     { grid-column: 3; grid-row: 1; }
.deck-tile--activity   { grid-column: 1; grid-row: 2; }
.deck-tile--milestones { grid-column: 2 / span 2; grid-row: 2; } /* wider */
.deck-recent-rail      { grid-column: 1 / -1; grid-row: 3; }
```

Tile height: fixed at 200px for row 1 and row 2 (consistent baseline). RECENT rail: 56px tall.

### 5.2 Tile anatomy (shared)

Every tile has three zones:

```
┌───────────────────────────────┐
│ header (40px)  ── title ─     │  ← // TITLE (font-mono text-micro uppercase)
├───────────────────────────────┤
│                               │
│ body (main viz, no padding)   │  ← tile-specific composition
│                               │
├───────────────────────────────┤
│ footer (32px) ── micro ───    │  ← status metadata (font-mono text-micro)
└────────────────────────────·┘  ← radar sweep signature
```

Tile container (shared):

```tsx
<button
  type="button"
  className={cn(
    "glass-surface rounded-panel group relative overflow-hidden text-left",
    "flex flex-col h-[200px] transition-colors duration-150",
    "hover:bg-[rgba(22,22,24,0.68)]",
    "focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
  )}
  onClick={() => drillInTo(section)}
  aria-label={`${title} — ${statusDescription}. Click to drill in.`}
>
  <div className="px-5 pt-4 pb-2 flex items-center justify-between">
    <span className="font-mono text-micro uppercase tracking-wider text-text-2">
      <span className="text-text-mute mr-[6px]">//</span>{title}
    </span>
  </div>
  <div className="flex-1 px-5 pb-2 min-h-0">{body}</div>
  <div className="px-5 pb-3 text-text-3 font-mono text-micro">{footer}</div>
  <RadarSweep state={state} className="absolute bottom-3 right-3" />
</button>
```

### 5.3 Tile: INPUTS

**Title:** `// INPUTS`
**Body composition:** three mini progress rings side-by-side.

```
     ┌───┐      ┌───┐      ┌───┐
     │ 100%│    │ 86% │    │ 0%  │
     └───┘      └───┘      └───┘
     INTERVIEW  EMAIL SCAN  DATABASE
```

- Ring: SVG, 44px diameter, 3px stroke. Track `fill-neutral`, fill `olive` (complete), `tan` (running), `text-mute` (not started).
- Center number: `font-mohave font-light text-body` (14px) in ring color.
- Label under each ring: `font-mono text-micro uppercase tracking-wider text-text-3` (11px).
- Rings are keyed to these completion gates:
  - Interview: `interviewStore.phase === "completed"`
  - Email Scan: `gmail_scan_jobs` latest row `status === "complete"` AND no explicit skip
  - Database Mining: `miningJobs` latest row `status === "complete"` AND no explicit skip

**Footer:** `3 SOURCES · LAST RUN [relative]`
**Empty state (no sources ever run):** all three rings at 0%, `text-mute` color. Footer: `NO SOURCES RUN · INITIATE`.
**Animation on enter:** rings fill from 0 → target value in 1000ms spring (stiffness 60, damping 15). Staggered 120ms between rings.
**Drill-in target:** `/calibration?section=inputs`

### 5.4 Tile: CORPUS

**Title:** `// CORPUS`
**Body composition:** count-up number + tiny sparkline.

```
   2,847  FACTS
   ▂▄▇▆█▅▇   ← 7-day extraction trend
```

- Number: `font-mohave font-light text-[42px] text-text tabular-nums`. Uses count-up from 0 to final on mount (800ms cubicOut).
- Label: `font-mono text-micro uppercase tracking-wider text-text-3` (11px), positioned right-aligned next to number with `ml-2`.
- Sparkline: 140×20px Canvas, 1px stroke `text-2`, fill `fill-neutral-dim`, shows last 7 days of fact-extraction counts.
- If writing profile confidence < 0.5, appears below number: `CONFIDENCE 0.42 ·· TRAINING` in `tan`.
- If confidence ≥ 0.85: `CONFIDENCE 0.87 · LOCKED` in `olive`.

**Footer:** `+12 TODAY · CONFIDENCE 0.82`
**Empty state (no corpus):** number renders as `—`, label `NO CORPUS`. Footer: `AWAITING INPUTS`.
**Animation on enter:** number counts up 800ms cubicOut, sparkline draws left-to-right 600ms after number starts.
**Drill-in target:** `/calibration?section=corpus`

### 5.5 Tile: CONFIG

**Title:** `// CONFIG`
**Body composition:** 4-level autonomy stack chart.

```
AUTO SEND  ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░   3
AUTO DRAFT ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░   5
DRAFT      ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░   2
OFF        ▓▓▓░░░░░░░░░░░░░░░░░░░░   1
```

- Four horizontal bars representing email-type autonomy distribution.
- Label: `font-mono text-micro uppercase tracking-wider` (11px), width 88px left-aligned.
- Bar: 140px wide, 6px tall, `rounded-bar` (2px). Fill proportion = count at that level / total email types (11).
- Bar color: OFF = `text-mute`, DRAFT = `text-3`, AUTO DRAFT = `text-2`, AUTO SEND = `olive`.
- Count number right-aligned: `font-mono text-data-sm` (13px) in bar color.

**Footer:** `12 RULES · 7 CATEGORIES`
**Empty state (no config):** all bars at `fill-neutral-dim`, counts at 0. Footer: `DEFAULTS IN EFFECT · CONFIGURE`.
**Animation on enter:** bars grow left-to-right, 400ms EASE_SMOOTH, staggered 80ms from top (AUTO SEND) to bottom (OFF).
**Drill-in target:** `/calibration?section=config`

### 5.6 Tile: ACTIVITY

**Title:** `// ACTIVITY`
**Body composition:** live sensor strip.

Idle state:
```
   SYS :: NOMINAL

   Last 24h: 47 events · 0 queued
```

Running state (e.g., scan in progress):
```
   SCAN · 02:41

   ████████████░░░░░░░  61%
   238 / 391 threads
```

- Idle: `font-cakemono font-light uppercase` 20px in `olive`, subtitle `font-mono text-micro text-text-3`.
- Running: `font-cakemono font-light uppercase` 20px in `tan`, progress bar (140×4px, `rounded-bar`) in `tan`, thread count `font-mono text-data-sm text-text-2`.
- Error: same layout, title in `rose`.

**Footer:** `QUEUED [n] · COMPLETED [n] TODAY`
**Empty state (never any activity):** `SYS :: STANDBY`, footer `AWAITING TRAFFIC`.
**Animation on enter:** if running, progress bar fills to current %; if idle, sensor strip fades in; live updates smoothly interpolate progress.
**Drill-in target:** `/calibration?section=activity`

### 5.7 Tile: MILESTONES

**Title:** `// MILESTONES`
**Body composition:** 5-domain status grid.

```
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│ EMAIL    │ PROJECTS │ INVOICE  │ SCHEDULE │ COMMS    │
│   ●      │    ◐     │    ○     │    ●     │    ●     │
│ NOMINAL  │ LEARNING │ GATED    │ NOMINAL  │ NOMINAL  │
│ 0.82     │ 0.54     │ 0.00     │ 0.91     │ 0.88     │
└──────────┴──────────┴──────────┴──────────┴──────────┘
```

- 5 equal columns, 12px gap.
- Domain label: `font-mono text-micro uppercase tracking-wider text-text-3` (11px).
- Status dot: 10px diameter. `olive` (nominal), `tan` (learning), `text-mute` (gated/unavailable).
- Status label: `font-mono text-micro uppercase` (11px) in dot color.
- Confidence: `font-mohave text-body-sm` (14px) `tabular-nums` in `text-2`.

**Footer:** `7 / 9 MILESTONES · NEXT: AUTO-DRAFT`
**Empty state:** all dots at `text-mute`, all confidences `—`, footer `0 / 9 MILESTONES · AWAITING TRAFFIC`.
**Animation on enter:** each column fades in with 50ms stagger left-to-right. Dots pulse once on mount (0.3 → 1 opacity, 200ms).
**Milestone unlock event:** tile's accent border pulses (tile-level `border-ops-accent` for 240ms, olive fill at 0.9 opacity → 0), triggered when a new milestone crossing fires.
**Drill-in target:** `/calibration?section=milestones`

### 5.8 RECENT rail

A persistent horizontal strip under the 5 tiles, full-width.

```
┌──────────────────────────────────────────────────────────────┐
│ // RECENT                                              STREAM│
│ [SYS :: SCAN · 02:41] [SYS :: +12 FACTS · 02:38]            │
│                        [SYS :: LEARNING · DOMAIN=MARKS.COM]  │
│                        [SYS :: PROFILE CONFIDENCE 0.82]       │
└──────────────────────────────────────────────────────────────┘
```

- 56px tall, `.glass-surface rounded-panel`, horizontal flex.
- Title: `// RECENT` left-aligned, `STREAM` right-aligned indicating live.
- Events: 4px radius chips, `font-mono text-micro uppercase tracking-wider`.
  - `SYS ::` prefix in `text-mute`.
  - Event kind (`SCAN`, `LEARNING`, `CONFIDENCE`, `DRAFT`, etc.) in type-specific color (olive/tan/text-2/text-3).
  - Timestamp in `text-mute`.
- Shows last 5 events. Ordered newest-first, left-to-right.
- New events slide in from the left (Motion AnimatePresence with layout); the 6th slides out right.
- Tap a chip to jump to `/calibration?section=activity&event=<id>` (focuses that event in the log).

**Empty state:** `SYS :: CALIBRATION LINE CLEAR` centered, in `text-mute`.
**Realtime source:** Supabase realtime subscription on `agent_actions` + `agent_memories` + `gmail_scan_jobs` tables, filtered to current `company_id`, last 5 rows ordered by `created_at DESC`.
**Reduced motion:** chips swap without slide — opacity 150ms crossfade.

---

## 6. First-run wizard mode

When `isFirstRun === true` (see §3.5), replace the deck body with the first-run wizard. The TopBar + sidebar remain.

### 6.1 Layout

```
┌─────────────────────────────────────────────────────────┐
│ // CALIBRATION · INITIAL SCOPE               0 / 3      │  ← page title + progress
│                                                          │
│ Three sources feed the system. Each is optional.        │  ← body
│ Complete what you want. Skip the rest.                   │
│                                                          │
│ ┌─────────────────────────────────────────────────────┐ │
│ │  ◯ INTERVIEW                                         │ │
│ │  Ask the operator. You tell the system what          │ │
│ │  the system should know.                              │ │
│ │                                                       │ │
│ │  [ ENGAGE ]   [ SKIP ]                                │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                          │
│ ┌─────────────────────────────────────────────────────┐ │
│ │  ◯ EMAIL SCAN                                        │ │
│ │  Scan outbound. The system reads 12 months of        │ │
│ │  your sent mail.                                      │ │
│ │                                                       │ │
│ │  [ ENGAGE ]   [ SKIP ]                                │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                          │
│ ┌─────────────────────────────────────────────────────┐ │
│ │  ◯ DATABASE MINING                                   │ │
│ │  Mine database. The system reads your existing        │ │
│ │  estimates, projects, and clients.                    │ │
│ │                                                       │ │
│ │  [ ENGAGE ]   [ SKIP ]                                │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 6.2 Station anatomy

- `.glass-surface rounded-panel`, 24px padding, 16px vertical gap between stations.
- Status glyph: 14px circle left of title. `◯` (empty) = outline in `text-3`. `◐` (in progress) = half-fill `tan`. `●` (complete) = solid `olive`. `⊗` (skipped) = outline with X, `text-mute`.
- Title: `font-cakemono font-light uppercase` 20px in `text`.
- Description: `font-mohave text-body-sm text-text-2` (14px), max-width 560px.
- Actions: two buttons side-by-side.
  - `ENGAGE` (primary): outlined `text-ops-accent border-ops-accent` at rest → fills `bg-ops-accent text-black` on hover. Sends user into the existing Interview / Scan / Mining flow in-page (not a modal).
  - `SKIP` (ghost): `text-text-mute hover:text-text-2`, no border.

### 6.3 Progress indicator

Top-right of the page title: `0 / 3`, ticking up as stations complete or skip. When all 3 resolve (complete OR skip), the wizard triggers **Deck reveal**.

### 6.4 Deck reveal transition (wizard → deck)

1. User clicks ENGAGE / SKIP on the 3rd station.
2. 240ms pause (Commitment beat).
3. Footer line appears under the stations: `SYS :: SCOPE COMPLETE · STANDBY FOR DECK` (in `olive`, centered, font-mono text-micro uppercase).
4. 600ms hold.
5. Wizard fades out (opacity 1 → 0, 300ms ease-in).
6. Deck mounts with the standard entry choreography from §12.
7. `userDismissedFirstRun` writes to a user preference (persisted in Supabase `users.preferences.calibrationFirstRunComplete = true`).

### 6.5 Skip semantics

A user can skip all three sources. The deck still loads — but every tile renders in its empty state. The user can return to the INPUTS drill-in at any time and run a source then.

### 6.6 Interview / Scan / Mining flow reuse

The existing components are reused verbatim:
- `<AiIntakeInterview>` (from `src/components/settings/ai-intake-interview.tsx`)
- `<EmailScanSection>` (currently lives inline in the ai-setup page.tsx — extract to `src/components/calibration/email-scan-runner.tsx`)
- `<AiDatabaseMining>` (from `src/components/settings/ai-database-mining.tsx`)

When the user clicks ENGAGE on a station, the station expands inline (max-height transition 300ms EASE_SMOOTH) and renders the component. Other stations collapse to 48px (title + status glyph only).

---

## 7. INPUTS drill-in — `/calibration?section=inputs`

### 7.1 Layout

```
┌─────────────────────────────────────────────────────────┐
│ ← Command // Calibration // Inputs                      │  ← breadcrumb with back glyph
│                                                          │
│ // INPUTS                                                │  ← section title
│                                                          │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ ● INTERVIEW — COMPLETE                               │ │
│ │ Last run 3d ago · 47 answers · 82 facts extracted    │ │
│ │                                      [ RE-INTERVIEW ] │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                          │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ ◐ EMAIL SCAN — RUNNING · 61%                         │ │
│ │ ████████████████░░░░░░░░░░░░    238 / 391 threads   │ │
│ │ Current batch: 50 threads · 02:41 elapsed            │ │
│ │                                      [ VIEW PROGRESS ]│ │
│ └─────────────────────────────────────────────────────┘ │
│                                                          │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ ◯ DATABASE MINING — NOT RUN                          │ │
│ │ Mines pricing patterns, client-service relationships,│ │
│ │ and seasonal trends from your existing records.      │ │
│ │                                      [ INITIATE MINE ]│ │
│ └─────────────────────────────────────────────────────┘ │
│                                                          │
│ ─── ACCUMULATION BEHAVIOR ───────────────────────────── │
│                                                          │
│ Each source adds to the corpus. Re-running a source     │
│ updates its facts; it does not erase facts from the      │
│ others. Confidence rises when sources agree.             │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 7.2 Sub-section anatomy

Each of the three sub-sections:
- `.glass-surface rounded-panel`, 24px padding.
- Header: status glyph (14px) + title (`font-cakemono font-light uppercase` 20px) + status label (`font-mono text-micro uppercase tracking-wider` in status color).
- Middle: metadata or progress bar or description.
- Right-aligned primary CTA.

### 7.3 Status states per sub-section

| State | Glyph | Title color | Right CTA |
|-------|-------|-------------|-----------|
| Never run | `◯` `text-3` | `text-2` | `INITIATE [ACTION]` (primary, outlined accent) |
| Running | `◐` `tan` with sweep | `text` | `VIEW PROGRESS` (ghost, opens inline expanded state) |
| Complete | `●` `olive` | `text` | `RE-[ACTION]` (secondary) |
| Failed | `⊗` `rose` | `text` | `RETRY` (primary) |
| Skipped | `⊗` `text-mute` | `text-3` | `INITIATE [ACTION]` (primary) |

### 7.4 Running state — live progress

When a source is running, the sub-section expands by +40px to show a progress bar and live counters.

```
◐ EMAIL SCAN — RUNNING · 61%
████████████████░░░░░░░░░░░░    238 / 391 threads
Current batch: 50 threads · 02:41 elapsed · ETA 1m 45s
```

- Progress bar: 100% width, 4px tall, `rounded-bar`, fill `tan`, track `fill-neutral-dim`.
- Thread count: `font-mono text-data-sm text-text-2`.
- Meta line: `font-mono text-micro text-text-3`.
- Bar fills via Motion `useMotionValue` spring (stiffness 80, damping 20) — smooth interpolation when new poll data arrives.
- Polling: existing 3s poll cadence against `/api/integrations/ai-setup/email-scan?jobId=<id>` preserved.

### 7.5 Re-run semantics (confirmed accumulative)

Clicking `RE-[ACTION]` opens a confirm popover (dense glass) anchored to the button:

```
┌─────────────────────────────────────────┐
│ Re-run EMAIL SCAN?                      │
│                                          │
│ A new scan updates email-sourced facts  │
│ but does not erase facts from Interview │
│ or Database Mining. Confidence rises    │
│ when sources agree.                      │
│                                          │
│  [ RE-RUN ]    [ CANCEL ]                │
└─────────────────────────────────────────┘
```

- Popover: `.glass-dense rounded-modal`, 280px wide, 16px padding.
- Body: `font-mohave text-body-sm text-text-2`.
- Actions: primary (accent outlined) `RE-RUN` + ghost `CANCEL`.

### 7.6 Empty state (never any inputs run)

No sub-section is collapsed/hidden — all three render with status `◯`. Below the three sub-sections, a single line in `text-mute`:

```
Nothing has been run yet. Start with any source — or all three.
```

### 7.7 Accumulation explainer

Permanent footer block on this page (below the three sub-sections) explaining the accumulation model. `font-mohave text-body-sm text-text-2`. Not dismissible — it's load-bearing explanation of how calibration works.

---

## 8. CORPUS drill-in — `/calibration?section=corpus`

**Absorbs:** the full `/intel` UI (entity graph + entity detail + cluster resolution).

### 8.1 Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ ← Command // Calibration // Corpus                               │
│                                                                   │
│ // CORPUS                                  2,847 FACTS · 421 ENT │
│                                                                   │
│ ┌───────┐ ┌─────────────────────────────────┐ ┌───────────────┐ │
│ │ FACTS │ │                                  │ │ ENTITY DETAIL │ │
│ │ drawer│ │       Knowledge Graph            │ │     drawer     │ │
│ │       │ │                                  │ │                │ │
│ │ ⋯     │ │   [Force-directed D3 / Canvas]   │ │  (empty until │ │
│ │       │ │                                  │ │   you click)   │ │
│ │       │ │                                  │ │                │ │
│ └───────┘ └─────────────────────────────────┘ └───────────────┘ │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

- 3-column layout: FACTS drawer (280px collapsible) / Graph (flex-1) / ENTITY DETAIL drawer (320px, empty on load).
- Graph fills available viewport height minus TopBar + breadcrumb + header = ~calc(100vh - 180px).
- Drawers collapsible via chevron buttons at their outer edge.

### 8.2 FACTS drawer

Shows the raw extracted facts as a searchable, filterable list.

```
// FACTS                                             ⋯
─────────────────────────────────────────────
[ search facts... ]  [ source ▾ ]  [ confidence ▾ ]
─────────────────────────────────────────────
◉ Pricing for a 12x14 deck with railings starts around $8,500-$12,000.
  INTERVIEW · 1.00 · 5d ago

◉ Marks.com is marketing for this company — treat as VENDOR.
  LEARNING · 0.95 · 2h ago

◉ Most clients request spring installations (March-May).
  MINING · 0.87 · 5d ago

...
```

- Each fact: 1-3 lines of `font-mohave text-body-sm text-text` + metadata line in `font-mono text-micro text-text-3` (source in source-color: blue for Interview, amber for Email Scan, olive for Mining, rose for Learning).
- Filters: source dropdown (Interview / Scan / Mining / Learning), confidence range slider (0.0 – 1.0).
- Search: live-filters by fact text.
- Click a fact: highlights the related entity in the graph (the entity ring pulses 1 beat).

### 8.3 Knowledge graph

Reuse the existing `/intel` graph implementation, with these visual refinements to match CALIBRATION:

- Background: `bg-background` (pure black, no texture).
- Entity nodes: 8-16px diameter circles, size scales with connection count. Stroke 1px `text-2`.
- Edge lines: 0.5px `text-mute` at 0.4 opacity.
- Active entity (hovered or focused): stroke `ops-accent` at 1.5px, edges to connected entities brighten to `text-2`.
- Entity type badge: small letter inside node (P = Person, C = Company, S = Service, M = Material).
- Pan / zoom: existing controls (mouse drag / pinch / wheel).
- **Radar sweep metaphor**: a subtle 1px concentric ring pulse emanates from the currently-hovered entity outward, 2s cycle, `ops-accent` at 0.2 → 0 opacity. Makes the graph feel alive.

### 8.4 ENTITY DETAIL drawer

Empty state: `SELECT AN ENTITY` centered in `text-mute`, with a radar sweep icon above.

Populated state (click an entity):
```
// ENTITY · JANE COHEN
CLIENT · 12 THREADS · FIRST SEEN 2025-11-03

FACTS
─ Lives at 123 Oak Ave · interview 1.00
─ Prefers email contact · scan 0.94
─ Decided on cedar railings · scan 0.88

CONNECTED TO
▸ PROJECT · COHEN DECK REBUILD
▸ ESTIMATE #4521
▸ INVOICE #3318

[ VIEW IN OPS ]
```

- Entity name: `font-cakemono font-light uppercase` 20px.
- Type + meta: `font-mono text-micro uppercase tracking-wider text-text-3`.
- Facts list: `font-mohave text-body-sm` with `─` leader in `text-mute`.
- Connected records: link-style chevron list in `text-2 hover:text`.
- Primary CTA: `VIEW IN OPS` — deep-links to the clients/projects/etc. page.

### 8.5 Empty state (no corpus)

When `agent_memories` count is 0:

```
     ·    ·         ·
      ·        ·
  ·         ·       ·      ← animated radar sweep over empty grid
     ·  ·        ·
           ·      ·

       SYS :: NO CORPUS

  The system hasn't extracted anything yet.
  Run an input source to populate the corpus.

  [ RUN INPUTS → ]
```

- Centered empty illustration: 320×180 SVG, dots pattern + slow radar sweep animation.
- Headline: `font-cakemono font-light uppercase` 20px in `text-mute`.
- Body: `font-mohave text-body-sm text-text-2`.
- CTA: primary accent button, links to `/calibration?section=inputs`.

---

## 9. CONFIG drill-in — `/calibration?section=config`

**Absorbs:** `AutonomyStatusPanel`, `AutoSendSettings`, `EmailCategoryAutonomy`, `EmailFilterBuilder`, `FilterFunnelCanvas`, links to comms-config wizard.

### 9.1 Layout

```
┌─────────────────────────────────────────────────────────┐
│ ← Command // Calibration // Config                       │
│                                                           │
│ // CONFIG                                                 │
│                                                           │
│ ┌───────────────────────────────────────────────────────┐│
│ │ AUTONOMY                                   [ RE-RUN ] ││
│ │ ───────────────────────────────────────────────────── ││
│ │ STATUS UPDATE        ████████████████░░  AUTO SEND    ││
│ │ APPT CONFIRM         ██████████░░░░░░░░  DRAFT        ││
│ │ REMINDER             ████████████░░░░░░  AUTO DRAFT   ││
│ │ PAYMENT              ██████████████░░░░  AUTO SEND    ││
│ │ ... (7 more)                                           ││
│ └───────────────────────────────────────────────────────┘│
│                                                           │
│ ┌───────────────────────────────────────────────────────┐│
│ │ FILTERS                                     [ EDIT ]  ││
│ │ ───────────────────────────────────────────────────── ││
│ │ 12 active rules · 3 exclusions · funnel view →        ││
│ └───────────────────────────────────────────────────────┘│
│                                                           │
│ ┌───────────────────────────────────────────────────────┐│
│ │ CATEGORIES                                            ││
│ │ ───────────────────────────────────────────────────── ││
│ │ LEAD       ● AUTO DRAFT                               ││
│ │ CLIENT     ● AUTO DRAFT                               ││
│ │ VENDOR     ● DRAFT                                    ││
│ │ ... (10 more)                                         ││
│ └───────────────────────────────────────────────────────┘│
│                                                           │
│ ─── EXTERNAL ──────────────────────────────────────────  │
│                                                           │
│ TASK TYPES →          DUPLICATE DETECTION →               │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

### 9.2 AUTONOMY sub-section

Read-only summary grid of per-email-type autonomy levels.

- Header: `AUTONOMY` (`font-cakemono font-light uppercase` 20px) + `RE-RUN WIZARD` primary CTA (launches existing `CommsConfigWizard` in a full-screen overlay — `.glass-dense rounded-modal`, 100% viewport minus 48px outer padding, Escape closes).
- Body: 11 rows (one per email type).
  - Row: email type label (`font-mono text-micro uppercase tracking-wider` 11px, `text-text-3`, 160px wide) + autonomy bar + autonomy label.
  - Autonomy bar: 220px wide, 6px tall, `rounded-bar`. Fill proportion scales 0 / 0.33 / 0.66 / 1 for OFF / DRAFT / AUTO DRAFT / AUTO SEND. Color matches CONFIG tile mapping.
  - Autonomy label: `font-mono text-micro uppercase tracking-wider` in bar color.
- Row is clickable: opens a compact inline autonomy selector (radio group) scoped to that row. Selection persists immediately on change (optimistic update, PUT to `/api/integrations/email/auto-send/settings`).

### 9.3 FILTERS sub-section

- Header: `FILTERS` + `EDIT` secondary CTA (launches `FilterFunnelCanvas` modal).
- Body: one-line summary `N active rules · M exclusions · funnel view →`.
- Click the "funnel view →" link: opens full-screen funnel canvas view.

### 9.4 CATEGORIES sub-section

Reuses `<EmailCategoryAutonomy>` component. 13 categories (LEAD / CLIENT / VENDOR / SUBTRADE / PLATFORM_BID / LEGAL / JOB_SEEKER / COLLECTIONS / MARKETING / RECEIPT / PERSONAL / INTERNAL / OTHER).

- Row layout: category label (11px uppercase tracking-wider, 120px wide) + status dot (10px) + autonomy label + chevron to change.
- Click chevron: inline dropdown with allowed autonomy levels for that category (via `allowedLevelsFor()` from `phase-c-category-autonomy-service`).

### 9.5 EXTERNAL section

Footer with two link-style buttons to related surfaces that are **not** absorbed:
- `TASK TYPES →` deep-links to `/settings?tab=task-types`.
- `DUPLICATE DETECTION →` opens the duplicate-review sheet or links to its config (pending — see §20 open items).

`font-mono text-micro uppercase tracking-wider`, chevron glyph 12px, `text-text-2 hover:text-text`.

### 9.6 Comms-config wizard launcher (full-screen overlay)

When user clicks `RE-RUN WIZARD` in AUTONOMY:

1. Overlay mounts (`.glass-dense rounded-modal` at 100% viewport minus 48px padding, z-index 3000 = modal layer).
2. Existing `<CommsConfigWizard>` renders inside. Unchanged behavior, existing 10 steps.
3. Escape key or `[ CLOSE ]` chip top-right dismisses.
4. On wizard completion (submit), overlay fades out, CONFIG re-fetches summary data.

Enter motion: overlay opacity 0 → 1 + scale 0.98 → 1, 250ms EASE_SMOOTH. Exit motion: reverse, 200ms.

### 9.7 Deep-link: `/calibration?section=config&wizard=open`

If URL contains `wizard=open`, the CONFIG drill-in mounts with the comms-config overlay already open. Used by the redirect from `/agent/comms-config`.

---

## 10. ACTIVITY drill-in — `/calibration?section=activity`

### 10.1 Layout

```
┌─────────────────────────────────────────────────────────────┐
│ ← Command // Calibration // Activity                         │
│                                                               │
│ // ACTIVITY                               SYS :: NOMINAL · · │
│                                                               │
│ ┌───────────────────────────────────────────────────────────┐│
│ │ LIVE SENSOR                                                ││
│ │                                                            ││
│ │   ∙ Radar sweep animation ∙                                ││
│ │                                                            ││
│ │   No active jobs · last event 02:41 ago                    ││
│ └───────────────────────────────────────────────────────────┘│
│                                                               │
│ [ ALL ] [ SCANS ] [ EXTRACTIONS ] [ LEARNINGS ] [ DRAFTS ]   │
│ [ LAST HOUR ] [ 24H ] [ 7D ] [ 30D ] [ ALL ]                 │
│                                                               │
│ ┌───────────────────────────────────────────────────────────┐│
│ │ TIME       TYPE          SOURCE         DETAIL       CONF ││
│ │ ─────────────────────────────────────────────────────────  ││
│ │ 14:23      SCAN          EMAIL          SCAN COMPLETE  —  ││
│ │ 14:18      LEARNING      INBOX          MARKS.COM → M  0.9││
│ │ 12:41      EXTRACTION    SCAN           +12 FACTS     0.82││
│ │ ... (paginated)                                           ││
│ └───────────────────────────────────────────────────────────┘│
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### 10.2 LIVE SENSOR strip

Top of the page under the breadcrumb — a larger, permanently-present version of the ACTIVITY tile's body.

- 120px tall `.glass-surface rounded-panel`.
- Body: centered radar sweep icon (64px) + status text (`font-cakemono font-light uppercase` 20px) + sub-label (`font-mono text-micro text-text-3`).
- When running: radar sweep accelerates (1.2s cycle), color shifts to `tan`, shows current job + progress bar 280px wide.

### 10.3 Filter chips

- Type filter: ALL / SCANS / EXTRACTIONS / LEARNINGS / DRAFTS / SUGGESTIONS — multi-select, default ALL.
- Time range: radio group — LAST HOUR / 24H / 7D / 30D / ALL — default 24H.
- Chips: `.glass-surface` `rounded-chip` (4px), 6px padding, `font-mono text-micro uppercase tracking-wider`, `text-text-3` inactive / `text-text` active with `bg-surface-active`.

### 10.4 Event log table

- Columns: TIME (80px) / TYPE (120px) / SOURCE (120px) / DETAIL (flex) / CONFIDENCE (80px, right-aligned).
- Header: `font-mono text-micro uppercase tracking-wider text-text-3`.
- Rows: 40px tall, `hover:bg-surface-hover transition-colors`. Click to expand row to 200px showing full event payload (formatted JSON or structured detail).
- Virtualized via `@tanstack/react-virtual` for lists >100 rows.
- Live updates: new rows prepend to the top, slide in from above (Motion `initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}`, 250ms EASE_SMOOTH).

### 10.5 Realtime source

Supabase realtime subscription on three tables:
- `gmail_scan_jobs` (progress + status changes)
- `agent_memories` (new extractions)
- `agent_actions` (drafts, suggestions)

Merged client-side into a unified "event" stream, sorted by `created_at DESC`.

### 10.6 Deep-link: `/calibration?section=activity&event=<id>`

When URL includes an event ID, the log scrolls to that row (virtualized) and expands it.

### 10.7 Empty state

- Header: `SYS :: CALIBRATION LINE CLEAR`
- Body: `No activity in the selected window. Extend the time range or initiate a source.`
- CTA: `VIEW INPUTS →` link.

---

## 11. MILESTONES drill-in — `/calibration?section=milestones`

**Absorbs:** the existing `PhaseCDashboard` widget from `/agent/queue`.

### 11.1 Layout

```
┌─────────────────────────────────────────────────────────┐
│ ← Command // Calibration // Milestones                   │
│                                                           │
│ // MILESTONES                     OVERALL AUTONOMY 7 / 9 │
│                                                           │
│ ┌───────┬───────┬───────┬───────┬───────┐                │
│ │EMAIL  │PROJECT│INVOICE│SCHED  │COMMS  │  ← 5 domains   │
│ │  ●    │  ◐    │  ○    │  ●    │  ●    │                │
│ │NOMINAL│LEARNING│GATED │NOMINAL│NOMINAL│                │
│ └───────┴───────┴───────┴───────┴───────┘                │
│                                                           │
│ ─── EMAIL INTELLIGENCE ─────────────────────────────────  │
│   Drafts sent          47  · 30d                         │
│   Approval rate       94%  · olive                        │
│   Writing profile   0.82  · training                      │
│   Milestone          4 / 4  · All reached                 │
│                                                           │
│ ─── PROJECT MANAGEMENT ─────────────────────────────────  │
│   Suggestions proposed  12  · 30d                         │
│   Accepted              7  · 58%                          │
│   Milestone         2 / 3                                 │
│                                                           │
│ ... (3 more domains)                                      │
│                                                           │
│ ─── OVERALL AUTONOMY LADDER ─────────────────────────────│
│                                                           │
│ ①  PHASE_C ENABLED                     ● COMPLETE        │
│ ②  FIRST SCAN COMPLETE                 ● COMPLETE        │
│ ③  DRAFTING AVAILABLE (conf ≥ 0.5)     ● COMPLETE        │
│ ④  AUTO-DRAFT UNLOCKED (conf ≥ 0.75)   ● COMPLETE        │
│ ⑤  CATEGORY AUTONOMY CONFIGURED        ● COMPLETE        │
│ ⑥  50+ PRIOR APPOINTMENT CONFIRMS      ● COMPLETE        │
│ ⑦  WRITING PROFILE LOCKED (conf ≥ 0.85) ◐ IN TRAINING   │
│ ⑧  AUTO-SEND UNLOCKED                  ○ GATED           │
│ ⑨  FULL AUTO CAPABILITY                ○ GATED           │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

### 11.2 Domain status grid (top)

Same 5-column grid as the MILESTONES tile on the deck, but larger. Each column clickable → scrolls to that domain's detail section below.

### 11.3 Domain detail sections

Each of the 5 domains has its own `.glass-surface rounded-panel` section with:
- Header: domain name (`font-cakemono font-light uppercase` 20px) + overall status dot.
- Body: 3-5 metric rows.
  - Metric: label (`font-mono text-micro uppercase tracking-wider text-text-3` 11px, 200px wide) + value (`font-mohave text-body-sm text-text` with semantic color suffix) + qualifier (`font-mono text-micro text-text-3`).
- Milestone footer: `Milestone X / Y` with inline progression bar (100px wide, 4px tall).

### 11.4 Overall autonomy ladder (bottom)

The 9 milestones listed in order with status glyph + label + status label.

- Each row: 48px tall, `hover:bg-surface-hover`.
- Status glyph: `●` olive (complete), `◐` tan (in training / in progress), `○` text-mute (gated/future).
- Milestone number: Kosugi circled-digit glyph in `text-3`.
- Milestone name: `font-cakemono font-light uppercase` 14px in `text`.
- Status label: `font-mono text-micro uppercase tracking-wider` in status color, right-aligned.

### 11.5 Milestone unlock celebration (when a new milestone crosses)

When a milestone transitions from `IN_PROGRESS` to `COMPLETE`:

1. Row's status glyph transitions from `◐` to `●` (200ms color cross-fade + 1 beat scale pulse 1.0 → 1.15 → 1.0, 240ms total).
2. Row background flashes `olive-soft` at 0.3 opacity for 400ms then fades.
3. **Persistent notification fires** via existing `NotificationService`:
   - type: `milestone_unlocked`
   - persistent: true
   - title: `SYS :: AUTONOMY UNLOCK · [MILESTONE NAME]`
   - body: `[Condition that was met]. [New capability] is available for activation.`
   - actionUrl: `/calibration?section=milestones#milestone-N`
   - actionLabel: `REVIEW`
4. MILESTONES tile on the deck gets an accent border pulse (§5.7).

**Auto-apply rule:** Crossing a milestone unlocks a capability. It does NOT auto-enable it. The user must confirm (via the config section or the notification's action).

---

## 12. Motion & animation

### 12.1 Motion tokens (from system.md + animation-architect brand config)

```typescript
// src/lib/utils/calibration-motion.ts
export const CAL_MOTION = {
  easing: [0.22, 1, 0.36, 1] as const,     // EASE_SMOOTH — all transitions
  durations: {
    hover: 150,
    tileEnter: 200,
    drillInTransition: 300,
    deckEntryStagger: 60,   // ms between tiles
    countUp: 800,
    ringFill: 1000,
    barGrow: 400,
    radarCycleIdle: 2400,
    radarCycleHover: 1200,
    milestonePulse: 240,
    recentRailInsert: 250,
  },
  reducedMotion: {
    tileEnter: 150,         // opacity-only
    drillIn: 200,
    countUp: 0,             // instant
    ringFill: 0,
    barGrow: 0,
    radarCycle: null,       // static
  },
} as const;
```

### 12.2 Deck entry choreography

On `/calibration` mount (populated mode):

```
Time (ms)  →  0    60   120  180  240  300  360  420
INPUTS     ████████                                     fade + y
CORPUS          ████████                                fade + y
CONFIG              ████████                            fade + y
ACTIVITY                ████████                        fade + y
MILESTONES                  ████████                    fade + y
                                        ████████        RECENT rail slides up
```

- Each tile: `initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: CAL_MOTION.easing, delay: index * 0.06 }}`.
- Tile body content (rings, numbers, bars) start their own internal animations +150ms after the tile frame fades in.
- RECENT rail: `initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: CAL_MOTION.easing, delay: 0.36 }}`.

### 12.3 Count-up animations (CORPUS tile, MILESTONES confidence, INPUTS ring centers)

Use an `AnimatedNumber` component (new, `src/components/calibration/animated-number.tsx`):

```tsx
"use client";
import { useMotionValue, useTransform, animate } from "motion/react";
import { useEffect } from "react";

export function AnimatedNumber({ value, duration = 0.8, format }: {
  value: number;
  duration?: number;
  format?: (n: number) => string;
}) {
  const motionValue = useMotionValue(0);
  const rounded = useTransform(motionValue, (v) =>
    format ? format(v) : Math.round(v).toLocaleString()
  );

  useEffect(() => {
    const controls = animate(motionValue, value, {
      duration,
      ease: [0.33, 1, 0.68, 1],   // cubicOut — count-ups feel best with this, per data-viz skill
    });
    return () => controls.stop();
  }, [value, duration, motionValue]);

  return <motion.span>{rounded}</motion.span>;
}
```

Reduced motion: `useReducedMotion()` → `value` rendered directly with no animation.

### 12.4 Ring fill (INPUTS tile)

Use SVG `<circle>` with `stroke-dasharray` interpolation. Spring physics (stiffness 60, damping 15) via Motion's `useSpring`. Fill lags the counter slightly — a deliberate "settling" effect that makes the ring feel weighted.

### 12.5 Drill-in transition (tile → section)

Shared-element morph using `layoutId`:

```tsx
// Tile
<motion.button layoutId={`cal-tile-${section}`} ... >

// Drill-in surface
<motion.section layoutId={`cal-tile-${section}`} ... >
```

Motion's `layout` animation handles the morph automatically: tile bounds interpolate to section bounds, 300ms EASE_SMOOTH. Background tiles fade to 0.3 opacity synchronously.

On back-nav (Escape / breadcrumb click):
- Section bounds interpolate back to tile position.
- Other tiles fade back to 1.0.
- Section content fades out 100ms before the morph, tile body fades in 100ms after morph completes.

### 12.6 RECENT rail live insert

```tsx
<AnimatePresence mode="popLayout">
  {events.map((event) => (
    <motion.div
      key={event.id}
      layout
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      transition={{ duration: 0.25, ease: CAL_MOTION.easing }}
    >
      <EventChip {...event} />
    </motion.div>
  ))}
</AnimatePresence>
```

`mode="popLayout"` ensures existing chips slide over smoothly when a new chip inserts at the start.

### 12.7 Radar sweep (signature)

Pure CSS animation. No JavaScript rAF:

```css
@keyframes calibration-radar-sweep {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

.cal-radar-sweep__arm {
  animation: calibration-radar-sweep var(--cal-radar-duration, 2.4s) linear infinite;
  transform-origin: center;
}

.cal-tile:hover .cal-radar-sweep__arm {
  animation-duration: 1.2s;
  transition: animation-duration 200ms ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .cal-radar-sweep__arm {
    animation: none;
    transform: rotate(315deg);
    opacity: 0.35;
  }
}
```

Intersection Observer pauses the animation when off-screen:

```tsx
const radarRef = useRef<HTMLDivElement>(null);
useEffect(() => {
  if (!radarRef.current) return;
  const observer = new IntersectionObserver(([entry]) => {
    if (radarRef.current) {
      radarRef.current.style.animationPlayState = entry.isIntersecting ? "running" : "paused";
    }
  }, { threshold: 0.1 });
  observer.observe(radarRef.current);
  return () => observer.disconnect();
}, []);
```

### 12.8 Milestone unlock pulse

Custom keyframe, one-shot:

```css
@keyframes calibration-milestone-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(157, 181, 130, 0.9); }
  100% { box-shadow: 0 0 0 12px rgba(157, 181, 130, 0); }
}
.cal-tile--milestone-unlocked {
  animation: calibration-milestone-pulse 240ms ease-out 1;
}
```

Triggered by a one-shot state (`unlockedAt`) that clears after 400ms.

### 12.9 Reduced-motion fallbacks (summary)

| Animation | Reduced motion alternative |
|-----------|----------------------------|
| Tile entry stagger | Simultaneous 150ms opacity-only |
| Count-up numbers | Instant final value |
| Ring fill | Instant fill (no spring) |
| Bar grow | Instant |
| Drill-in morph | Crossfade 200ms |
| RECENT rail insert | 150ms opacity swap |
| Radar sweep | Static 45° arm at 0.35 opacity |
| Milestone pulse | 400ms background color fade only |

All alternatives serve the same emotional beat (Entry, Discovery, Achievement) via opacity/color changes — per animation-architect's "don't remove the emotion, change the means."

---

## 13. Responsive & touch

### 13.1 Desktop ≥1200px (primary)

Layout as §5.1. All animations full-fidelity.

### 13.2 Tablet 768-1199px

```
Row 1: INPUTS | CORPUS        (2 cols)
Row 2: CONFIG | ACTIVITY      (2 cols)
Row 3: MILESTONES             (full width)
Row 4: RECENT rail            (full width)
```

Grid:
```css
@media (max-width: 1199px) and (min-width: 768px) {
  .calibration-deck {
    grid-template-columns: 1fr 1fr;
    padding: 24px 28px;
  }
  .deck-tile--inputs    { grid-column: 1; grid-row: 1; }
  .deck-tile--corpus    { grid-column: 2; grid-row: 1; }
  .deck-tile--config    { grid-column: 1; grid-row: 2; }
  .deck-tile--activity  { grid-column: 2; grid-row: 2; }
  .deck-tile--milestones{ grid-column: 1 / -1; grid-row: 3; }
  .deck-recent-rail     { grid-column: 1 / -1; grid-row: 4; }
}
```

Tile hero numbers reduce to 36px (from 42). Ring diameter 36px (from 44). All touch targets remain ≥44×44px.

### 13.3 Phone <768px

Single-column stack: INPUTS / CORPUS / CONFIG / ACTIVITY / MILESTONES / RECENT rail.

- Tiles become 100% width, 160px tall.
- MILESTONES domain grid scrolls horizontally (5 columns stay 120px each, container overflows).
- Knowledge graph in CORPUS drill-in shows a `VIEW ON DESKTOP` CTA instead of the interactive graph (the WebGL/Canvas controls are unusable at phone scale). Facts drawer renders as a scrollable list with filters as a bottom sheet.

Canvas padding reduces to 16px 16px.

### 13.4 Touch target compliance

All interactive elements: minimum 44×44px touch region (can be smaller visual hit area if padded appropriately via pseudo-elements). Specifically:
- Tile (desktop 200px tall, mobile 160px tall — well above 44px).
- CTA buttons: 40px tall visual, 44px via `py-[10px] px-4` + negative margin hit region.
- RECENT rail chips: 28px tall visual, 44px via bottom/top padding on the rail.
- Filter chips: 24px tall visual, 36px effective (padding) — upgraded to 40px for touch.

### 13.5 Tablet-specific interactions

- Drill-in opens faster (250ms instead of 300ms) because touch users perceive latency more acutely.
- Swipe left from a drill-in section returns to the deck (fallback for back-nav; also still supported via breadcrumb and Escape via software keyboard).
- Hover states swap to `active:` states. Radar sweep accelerates on tap-hold instead of hover.

---

## 14. Accessibility

### 14.1 Semantic structure

```tsx
<main role="main" aria-label="Calibration command deck">
  <header>
    <h1 className="font-cakemono ...">CALIBRATION</h1>
    <nav aria-label="Breadcrumb">...</nav>
  </header>

  <section aria-label="Deck tiles">
    <button role="button" aria-label="INPUTS. 2 of 3 sources complete. Click to drill in.">...</button>
    {/* ... */}
  </section>

  <aside role="log" aria-label="Recent activity" aria-live="polite">
    {/* chip list */}
  </aside>
</main>
```

### 14.2 Focus management

- Tab order: page title → each tile in DOM order → RECENT rail chips (horizontal, arrow keys navigate within) → any footer CTAs.
- Focus ring: `1.5px ring-ops-accent ring-offset-2 ring-offset-black` (system.md standard).
- Drill-in: when entering a section, focus moves to the section heading. When returning to deck (back-nav), focus returns to the tile that was clicked.
- First-run wizard: focus moves to the first station's ENGAGE button on mount.

### 14.3 Keyboard shortcuts

| Keys | Action |
|------|--------|
| `Enter` / `Space` on tile | Drill in |
| `Escape` in drill-in | Return to deck |
| `←` / `→` in RECENT rail | Navigate chips |
| `Enter` on RECENT chip | Open that event in ACTIVITY drill-in |
| `⌘/Ctrl+K` (global) | Command palette (out of scope for CALIBRATION, not implemented here) |

### 14.4 Screen reader support

- Tiles: `aria-label` composed from `title + current value + status` (e.g., "INPUTS. 3 sources. 2 complete, 1 not run. Click to drill in.").
- Ring progress: `aria-valuenow`, `aria-valuemin="0"`, `aria-valuemax="100"`, `role="progressbar"`.
- RECENT rail: `role="log"` + `aria-live="polite"` — new events announced without interrupting.
- Radar sweep: `aria-hidden="true"` — decorative.
- Empty states: `role="status"` to announce "No corpus yet" etc.
- Knowledge graph: includes a screen-reader-only `<table>` with entity list + facts (fallback for inaccessible SVG).

### 14.5 Color independence

- Status never conveyed by color alone. Every status dot has a text label. Every ring has a percentage. Every bar has a count.
- Milestone glyphs (`●`, `◐`, `○`) are visually distinct shapes, not just colors.
- Tile states use position + shape + label + color (quadruple encoding).

### 14.6 Contrast

All text meets WCAG AA (≥4.5:1) against its background per system.md. `text-mute` (3.4:1) is used for decorative-only elements (`//` slashes, separators) — never for content.

### 14.7 Reduced motion

Covered in §12.9. Every animation has a reduced-motion alternative that still communicates the state transition.

### 14.8 Reduced transparency

When `prefers-reduced-transparency: reduce` is set, `.glass-surface` falls back to solid `#121214` + 1px border. (Add to existing CSS cascade; not CALIBRATION-specific but load-bearing given our glass reliance.)

---

## 15. Copy

All copy goes through `useDictionary("calibration")`. New dictionary at `src/i18n/dictionaries/en/calibration.json` (and `es/calibration.json` for Spanish parity).

### 15.1 Sidebar

```json
{
  "nav": { "calibration": "CALIBRATION" }
}
```

### 15.2 Page-level

```json
{
  "page": {
    "title": "CALIBRATION",
    "breadcrumb": "Command // Calibration",
    "subtitle": "Inputs. Corpus. Config. The system, visible."
  }
}
```

### 15.3 First-run wizard

```json
{
  "firstRun": {
    "header": "// CALIBRATION · INITIAL SCOPE",
    "body": "Three sources feed the system. Each is optional. Complete what you want. Skip the rest.",
    "progress": "{done} / 3",
    "stations": {
      "interview": {
        "title": "INTERVIEW",
        "description": "Ask the operator. You tell the system what the system should know.",
        "actionEngage": "ENGAGE",
        "actionSkip": "SKIP"
      },
      "emailScan": {
        "title": "EMAIL SCAN",
        "description": "Scan outbound. The system reads 12 months of your sent mail.",
        "actionEngage": "ENGAGE",
        "actionSkip": "SKIP"
      },
      "databaseMining": {
        "title": "DATABASE MINING",
        "description": "Mine database. The system reads your existing estimates, projects, and clients.",
        "actionEngage": "ENGAGE",
        "actionSkip": "SKIP"
      }
    },
    "completeLine": "SYS :: SCOPE COMPLETE · STANDBY FOR DECK"
  }
}
```

### 15.4 Tile copy

```json
{
  "tiles": {
    "inputs":     { "title": "// INPUTS",     "footerEmpty": "NO SOURCES RUN · INITIATE", "footer": "{count} SOURCES · LAST RUN {time}" },
    "corpus":     { "title": "// CORPUS",     "footerEmpty": "AWAITING INPUTS",           "footer": "+{today} TODAY · CONFIDENCE {conf}" },
    "config":     { "title": "// CONFIG",     "footerEmpty": "DEFAULTS IN EFFECT · CONFIGURE", "footer": "{rules} RULES · {cats} CATEGORIES" },
    "activity":   { "title": "// ACTIVITY",   "footerEmpty": "AWAITING TRAFFIC",          "footer": "QUEUED {q} · COMPLETED {c} TODAY" },
    "milestones": { "title": "// MILESTONES", "footerEmpty": "0 / 9 MILESTONES · AWAITING TRAFFIC", "footer": "{reached} / 9 MILESTONES · NEXT: {next}" }
  }
}
```

### 15.5 RECENT rail

```json
{
  "recent": {
    "title": "// RECENT",
    "stream": "STREAM",
    "empty": "SYS :: CALIBRATION LINE CLEAR",
    "eventTypes": {
      "scan":        "SCAN",
      "scanComplete":"SCAN COMPLETE",
      "extraction":  "EXTRACTION",
      "learning":    "LEARNING",
      "draft":       "DRAFT",
      "suggestion":  "SUGGESTION",
      "milestone":   "MILESTONE UNLOCK",
      "confidence":  "CONFIDENCE"
    }
  }
}
```

### 15.6 Drill-in sections

```json
{
  "sections": {
    "inputs": {
      "title": "// INPUTS",
      "accumulation": "Each source adds to the corpus. Re-running a source updates its facts; it does not erase facts from the others. Confidence rises when sources agree.",
      "reRunConfirm": {
        "title": "Re-run {source}?",
        "body": "A new run updates {source}-sourced facts but does not erase facts from other sources. Confidence rises when sources agree.",
        "actionConfirm": "RE-RUN",
        "actionCancel": "CANCEL"
      },
      "statusLabels": {
        "notRun":   "NOT RUN",
        "running":  "RUNNING · {percent}%",
        "complete": "COMPLETE",
        "failed":   "FAILED",
        "skipped":  "SKIPPED"
      },
      "actions": {
        "initiateInterview":    "INITIATE INTERVIEW",
        "initiateScan":         "INITIATE SCAN",
        "initiateMine":         "INITIATE MINE",
        "reInterview":          "RE-INTERVIEW",
        "reScan":               "RE-SCAN",
        "reMine":               "RE-MINE",
        "viewProgress":         "VIEW PROGRESS",
        "retry":                "RETRY"
      }
    },
    "corpus": {
      "title": "// CORPUS",
      "header": "{facts} FACTS · {entities} ENTITIES",
      "drawers": { "facts": "// FACTS", "entity": "// ENTITY" },
      "empty": {
        "heading": "SYS :: NO CORPUS",
        "body": "The system hasn't extracted anything yet. Run an input source to populate the corpus.",
        "cta": "RUN INPUTS →"
      },
      "entity": {
        "empty": "SELECT AN ENTITY",
        "viewInOps": "VIEW IN OPS"
      },
      "factSources": {
        "INTERVIEW": "INTERVIEW",
        "SCAN":      "SCAN",
        "MINING":    "MINING",
        "LEARNING":  "LEARNING"
      }
    },
    "config": {
      "title": "// CONFIG",
      "autonomy":   { "title": "AUTONOMY",   "reRunWizard": "RE-RUN WIZARD" },
      "filters":    { "title": "FILTERS",    "edit": "EDIT", "summary": "{rules} active rules · {excl} exclusions · funnel view →" },
      "categories": { "title": "CATEGORIES" },
      "external":   { "heading": "EXTERNAL", "taskTypes": "TASK TYPES →", "duplicates": "DUPLICATE DETECTION →" },
      "autonomyLevels": {
        "off":         "OFF",
        "draft":       "DRAFT",
        "auto_draft":  "AUTO DRAFT",
        "auto_send":   "AUTO SEND"
      }
    },
    "activity": {
      "title": "// ACTIVITY",
      "liveSensor": {
        "nominal":  "SYS :: NOMINAL",
        "running":  "{type} · {elapsed}",
        "error":    "SYS :: ERROR"
      },
      "filters": {
        "all":         "ALL",
        "scans":       "SCANS",
        "extractions": "EXTRACTIONS",
        "learnings":   "LEARNINGS",
        "drafts":      "DRAFTS",
        "suggestions": "SUGGESTIONS"
      },
      "timeRanges": {
        "hour":  "LAST HOUR",
        "day":   "24H",
        "week":  "7D",
        "month": "30D",
        "all":   "ALL"
      },
      "columns": {
        "time":       "TIME",
        "type":       "TYPE",
        "source":     "SOURCE",
        "detail":     "DETAIL",
        "confidence": "CONF"
      },
      "empty": {
        "heading": "SYS :: CALIBRATION LINE CLEAR",
        "body":    "No activity in the selected window. Extend the time range or initiate a source.",
        "cta":     "VIEW INPUTS →"
      }
    },
    "milestones": {
      "title": "// MILESTONES",
      "overallHeader": "OVERALL AUTONOMY {reached} / 9",
      "domains": {
        "email":    "EMAIL INTELLIGENCE",
        "projects": "PROJECT MANAGEMENT",
        "invoice":  "INVOICING",
        "schedule": "SCHEDULING",
        "comms":    "COMMUNICATIONS"
      },
      "statuses": {
        "nominal":     "NOMINAL",
        "learning":    "LEARNING",
        "gated":       "GATED",
        "unavailable": "UNAVAILABLE"
      },
      "ladder": {
        "1": "PHASE_C ENABLED",
        "2": "FIRST SCAN COMPLETE",
        "3": "DRAFTING AVAILABLE",
        "4": "AUTO-DRAFT UNLOCKED",
        "5": "CATEGORY AUTONOMY CONFIGURED",
        "6": "50+ PRIOR APPOINTMENT CONFIRMS",
        "7": "WRITING PROFILE LOCKED",
        "8": "AUTO-SEND UNLOCKED",
        "9": "FULL AUTO CAPABILITY"
      },
      "ladderStatuses": {
        "complete":    "COMPLETE",
        "inTraining":  "IN TRAINING",
        "gated":       "GATED"
      }
    }
  }
}
```

### 15.7 Milestone unlock notification

```json
{
  "milestoneUnlock": {
    "titlePrefix": "SYS :: AUTONOMY UNLOCK",
    "bodies": {
      "draftingAvailable":        "Writing profile confidence reached {conf}. Drafting capability is available for activation.",
      "autoDraftUnlocked":        "Writing profile confidence reached {conf}. Auto-draft capability is available for activation.",
      "autoSendUnlocked":         "Writing profile confidence 0.85 and {priors}+ prior confirmations reached. Auto-send is available for activation.",
      "fullAutoCapability":       "All autonomy milestones reached. Full auto capability is available for activation."
    },
    "actionLabel": "REVIEW"
  }
}
```

### 15.8 Error states

```json
{
  "errors": {
    "scanFailed":       "Scan failed: {reason}. Retry or contact support.",
    "mineFailed":       "Database mining failed: {reason}. Retry or contact support.",
    "networkError":     "SYS :: CONNECTION LOST · RETRYING",
    "permissionDenied": "You don't have access to CALIBRATION. Ask an admin to grant you the email.configure_ai permission."
  }
}
```

---

## 16. Permissions

### 16.1 Route gate

`/calibration` and all its sections are gated on the `email.configure_ai` permission (currently the `phase_c` feature flag's permission).

Implementation in middleware / layout:

```tsx
// src/app/(dashboard)/calibration/layout.tsx
import { redirect } from "next/navigation";
import { checkPermission } from "@/lib/permissions";

export default async function CalibrationLayout({ children }: { children: React.ReactNode }) {
  const canAccess = await checkPermission("email.configure_ai");
  if (!canAccess) redirect("/dashboard");
  return <>{children}</>;
}
```

### 16.2 Sidebar visibility

The sidebar entry is rendered only when `permission === "email.configure_ai"` is granted (existing pattern in `sidebar.tsx`).

### 16.3 Feature flag gate

`phase_c` feature flag still gates `email.configure_ai` routes (post-flag-collapse, see §17). A company with phase_c disabled sees no sidebar entry; direct navigation redirects to `/dashboard`.

### 16.4 OPS operator cross-company access

Out of scope for `/calibration`. OPS operators continue using `/admin/system` for per-company toggles. No company picker is added to `/calibration`.

---

## 17. Migration

### 17.1 Flag consolidation

**Goal:** Deprecate `ai_email_review`. All AI gating → `phase_c`.

**Migration SQL** (`supabase/migrations/20260424000000_collapse_ai_email_review_to_phase_c.sql`):

```sql
-- Copy any ai_email_review overrides into phase_c, preserving enabled timestamps.
UPDATE admin_feature_overrides AS p
SET
  phase_c_enabled   = true,
  phase_c_enabled_at = COALESCE(p.phase_c_enabled_at, r.ai_email_review_enabled_at)
FROM admin_feature_overrides AS r
WHERE p.company_id = r.company_id
  AND r.ai_email_review_enabled = true
  AND (p.phase_c_enabled IS NULL OR p.phase_c_enabled = false);

-- Drop the legacy columns once all gates are migrated.
-- (Scheduled for +30 days after CALIBRATION ships — see §17.6.)
-- ALTER TABLE admin_feature_overrides DROP COLUMN ai_email_review_enabled;
-- ALTER TABLE admin_feature_overrides DROP COLUMN ai_email_review_enabled_at;
```

**Feature flag definitions update** (`src/lib/feature-flags/feature-flag-definitions.ts`):

```typescript
export const FEATURE_FLAG_ROUTES: Record<string, string[]> = {
  pipeline: ["/pipeline"],
  accounting: ["/accounting", "/estimates", "/invoices"],
  products: ["/products"],
  inventory: ["/inventory"],
  portal: ["/inbox"],
  // ai_email_review removed.
  phase_c: ["/calibration"],        // ← updated route
  deck_builder: ["/deck-builder"],
};

export const FEATURE_FLAG_PERMISSIONS: Record<string, string[]> = {
  // ...
  // ai_email_review removed.
  phase_c: ["email.configure_ai", "calibration.view"],   // ← adds calibration.view alias for future granularity; still uses email.configure_ai gate
  // ...
};
```

Any remaining code references to `ai_email_review` are changed to `phase_c`. A grep audit pre-migration confirms no orphan references.

### 17.2 Route redirects

Add to `middleware.ts`:

```typescript
const REDIRECTS: Record<string, string> = {
  "/settings/integrations/ai-setup": "/calibration",
  "/agent/comms-config":             "/calibration?section=config&wizard=open",
  "/intel":                          "/calibration?section=corpus",
};

// Inside middleware(request):
const pathname = request.nextUrl.pathname;
if (REDIRECTS[pathname]) {
  const url = request.nextUrl.clone();
  const target = REDIRECTS[pathname];
  const [base, query] = target.split("?");
  url.pathname = base;
  if (query) url.search = `?${query}`;
  return NextResponse.redirect(url, 308);
}
```

### 17.3 Sidebar update

`src/components/layouts/sidebar.tsx`:

```diff
 { label: t("nav.inbox"), href: "/inbox", icon: Mail, permission: "pipeline.view" },
+{ label: t("nav.calibration"), href: "/calibration", icon: Radar, permission: "email.configure_ai" },
 { label: t("nav.estimates"), href: "/estimates", icon: FileText, permission: "estimates.view" },
 ...
-{ label: t("nav.intel"), href: "/intel", icon: Radar, permission: "pipeline.view" },
 { label: t("nav.agentQueue"), href: "/agent/queue", icon: BrainCircuit, permission: "admin" },
```

Radar icon moves from `/intel` to `/calibration` (same icon component, new destination).

### 17.4 Agent queue widget removal

`src/app/(dashboard)/agent/queue/page.tsx`: remove `<PhaseCDashboard />` render + its imports. Queue becomes queue-only.

`src/components/agent/phase-c-dashboard.tsx`: file stays (used inside CALIBRATION MILESTONES drill-in). No behavioral change; just changes its mount location.

### 17.5 Dead code deletion (after CALIBRATION ships)

After 2 weeks of CALIBRATION in production with no regressions:

```
DELETE:
  src/app/(dashboard)/settings/integrations/ai-setup/page.tsx
  src/app/(dashboard)/agent/comms-config/page.tsx
  src/app/(dashboard)/intel/page.tsx
  src/components/settings/auto-send-settings.tsx       (moved into CONFIG drill-in)
  src/components/settings/autonomy-status-panel.tsx    (moved into CONFIG drill-in)
  src/components/settings/email-category-autonomy.tsx  (moved into CONFIG drill-in)

KEEP (reused in CALIBRATION):
  src/components/settings/ai-intake-interview.tsx      (reused in INPUTS)
  src/components/settings/ai-database-mining.tsx       (reused in INPUTS)
  src/components/settings/ai-setup-dashboard.tsx       (broken up — parts reused in MILESTONES)
  src/components/settings/email-filter-builder.tsx     (reused in CONFIG/FILTERS)
  src/components/settings/filter-funnel-canvas.tsx     (reused in CONFIG/FILTERS)
  src/components/agent/comms-config-wizard/*           (reused as wizard launcher)
  src/components/agent/phase-c-dashboard.tsx           (reused in MILESTONES)
```

The stopgap plan (`2026-04-23-ai-setup-admin-panel.md`) becomes dead code — its target (the ai-setup page) is deleted. Any partial work in progress on that plan should be halted.

### 17.6 Migration ordering (the safe sequence)

1. **Write dictionary files** (`en/calibration.json`, `es/calibration.json`).
2. **Ship `/calibration` with feature flag** (behind `calibration_preview` user-level flag) — deck, wizard, all drill-ins, behind the flag.
3. **Dogfood for 48h** with Jackson's company. Fix sharp edges.
4. **Flip the flag globally** for companies with `phase_c=true`.
5. **Wire redirects** on the same deploy.
6. **Remove the old sidebar entries** on the same deploy.
7. **Run the ai_email_review migration** (SQL).
8. **Wait 2 weeks.**
9. **Delete dead code** + drop migrated columns.

This ordering means no user is ever stuck on a dead URL. At every intermediate step, either old or new surface works.

---

## 18. Data model impact

**No new tables.** CALIBRATION reads from existing tables only:

| Tile / section | Source tables |
|----------------|---------------|
| INPUTS tile (ring progress) | `gmail_scan_jobs`, `agent_memories` (source=interview), `miningJobs` (TBD — if stored) |
| CORPUS tile (fact count, sparkline, confidence) | `agent_memories`, `agent_writing_profiles` |
| CONFIG tile (autonomy stack, rule count) | `auto_send_settings`, `email_filter_rules`, `email_category_autonomy` |
| ACTIVITY tile (live sensor, queue count) | `gmail_scan_jobs` (status), `agent_actions` (queue_depth) |
| MILESTONES tile (domain grid, milestone count) | `agent_actions`, `agent_writing_profiles.confidence`, `autonomy_milestones` |
| RECENT rail | merged stream from `agent_memories`, `gmail_scan_jobs`, `agent_actions`, `email_thread_category_corrections` |
| CORPUS drill-in (knowledge graph) | `agent_memories`, `graph_entities`, `agent_knowledge_graph` (existing /intel source) |
| ACTIVITY drill-in (event log) | Same as RECENT rail + pagination |
| MILESTONES drill-in | `agent_actions`, `autonomy_milestones`, all per-domain aggregations (approval_rate, confidence, etc.) |

### 18.1 New query helpers

```
src/lib/api/services/calibration-service.ts
  - getDeckState(companyId): fetches INPUTS rings, CORPUS count, CONFIG stack, ACTIVITY status, MILESTONES grid (one TanStack Query hook, 30s cache, 10s realtime patch)
  - getRecentEvents(companyId, limit=5): merged recent stream
  - getFullActivityLog(companyId, filters): paginated log for ACTIVITY drill-in
  - getCorpusSummary(companyId): facts + entities + edges counts + writing profile confidence
  - subscribeToLive(companyId): Supabase realtime subscription, returns unsubscribe fn
```

### 18.2 Optional: add a materialized view

For performance on the deck (5 tiles + rail means ~7 queries per page load), consider a materialized view `v_calibration_deck_state`:

```sql
CREATE MATERIALIZED VIEW v_calibration_deck_state AS
  SELECT company_id,
    (SELECT COUNT(*) FROM agent_memories am WHERE am.company_id = c.id) AS fact_count,
    (SELECT COUNT(*) FROM graph_entities ge WHERE ge.company_id = c.id) AS entity_count,
    (SELECT confidence FROM agent_writing_profiles wp WHERE wp.company_id = c.id ORDER BY created_at DESC LIMIT 1) AS writing_confidence,
    -- etc.
  FROM companies c;
```

Refresh concurrently on a 30s cron. **Decision for Phase 4:** ship without the MV first; add it only if deck load exceeds 400ms on production data. (Per OPS "perfection is integral" rule, we don't pre-optimize without measurement.)

---

## 19. Non-goals (hard exclusions)

- **Not replacing `/inbox`** — inbox is runtime email operations. CALIBRATION surfaces learnings from inbox recategorizations in the ACTIVITY feed, but the inbox itself is untouched.
- **Not replacing `/agent/queue`** — queue is approval of agent-proposed actions. CALIBRATION moves the PhaseCDashboard widget out, but the queue stays.
- **Not replacing `/admin/system`** — OPS operator cross-company admin stays there. CALIBRATION is tenant-scoped.
- **Not replacing task-types wizard** — task type learning stays at `/settings?tab=task-types`. CONFIG drill-in links to it.
- **Not replacing duplicate-review sheet** — duplicate detection stays as its own sheet. CONFIG drill-in links to its settings.
- **Not replacing the import-pipeline / email-setup wizards** — they stay as modal wizards from `/settings?tab=integrations`. INPUTS drill-in may link to them for initial Gmail connection but does not absorb them.
- **Not adding new data models** — works entirely with existing tables.
- **Not adding new permissions** — reuses `email.configure_ai`.

---

## 20. Open implementation items

These need resolution during Phase 4 planning (not brainstorm-level; tactical):

1. **Duplicate detection external link target** — does the CONFIG external link go to an existing settings page for duplicates, or open the duplicate-review sheet directly? (Today there's no dedicated config page for dup rules.) Phase 4 task: verify current state; create a minimal settings page if none exists, or link to the sheet if acceptable.

2. **Mining job persistence** — is there a `miningJobs` table or is DB mining state only in-memory? If in-memory, INPUTS ring needs a persistence shim. Phase 4 verifies in Supabase.

3. **Autonomy milestone table** — does `autonomy_milestones` exist, or is progression computed ad-hoc? Phase 4 verifies; if ad-hoc, decide whether to persist milestone crossings (for the unlock notifications) or compute every time.

4. **Materialized view decision** — ship without, measure, add if deck load >400ms on production-sized data.

5. **Mobile knowledge graph fallback** — does the current /intel graph render on phone at all, or does it fully fail? If it renders but slowly, we keep it; if it fails, we gate behind the `VIEW ON DESKTOP` CTA. Phase 4 verifies.

6. **ai_email_review column name** — verify the exact column names (`ai_email_review_enabled` vs `ai_email_review`) in `admin_feature_overrides` before writing the migration. MCP query against Supabase.

7. **First-run detection source** — where is "interview completed" persisted authoritatively? `useInterviewStore` (Zustand) is client-side. We need a server-side source of truth (e.g. `users.preferences.interviewComplete` OR `agent_memories` where source='interview' exists).

8. **CALIBRATION preview feature flag** — introduce `calibration_preview` user-level flag for the dogfood window. Phase 4 task: add to feature-flag-definitions + admin override UI.

Each of these has a "verify before implementing" step in Phase 4.

---

## 21. Success criteria

CALIBRATION is successful when:

1. **All existing AI surfaces redirect** to `/calibration` with no dead URLs.
2. **Jackson runs Interview + Scan + Mining** on his own company and sees the deck populate in real-time.
3. **RECENT rail** shows 5 live events with <2s latency from extraction → display.
4. **CORPUS drill-in** renders the existing knowledge graph with no regression.
5. **CONFIG drill-in** allows re-running the comms-config wizard end-to-end.
6. **MILESTONES drill-in** matches the data that was on `/agent/queue`'s PhaseCDashboard pre-migration.
7. **Reduced motion** preference disables all sweeps and count-ups with tested fallbacks.
8. **Tablet layout** works on iPad (768-1024) and iPad Pro (1024-1366). Jackson can scroll and drill in from the truck.
9. **Lighthouse a11y score** ≥ 95 on the deck.
10. **Deck initial load** < 400ms on 4G throttled (p75).
11. **No regressions** in `/inbox`, `/agent/queue`, `/admin/system`, or any other non-absorbed surface.
12. **`ai_email_review` flag** has zero remaining code references after 2-week bake.

---

## 22. References

- **Visual tokens:** `OPS-Web/.interface-design/system.md`
- **Canonical v2 spec:** `docs/superpowers/specs/2026-04-15-ops-web-visual-system-design.md`
- **Inventory (Phase 1):** `docs/superpowers/specs/2026-04-23-calibration-inventory.md`
- **Decisions (Phase 2):** `docs/superpowers/specs/2026-04-23-calibration-decisions.md`
- **Notification rail pattern:** `docs/superpowers/plans/2026-03-09-notification-rail-design.md`
- **Full-height pattern:** `docs/superpowers/plans/2026-04-21-full-height-pages.md`
- **PMF deck pattern (reference for scoped tokens + realtime):** `docs/superpowers/specs/2026-04-21-pmf-tracking-dashboard-design.md`
- **OPS Design System v2 HTML prototypes:** `/Users/jacksonsweet/Projects/OPS/ops-design-system-v2/project/`
- **Existing knowledge stack docs:** `ops-software-bible/05_DESIGN_SYSTEM.md` + `07_SPECIALIZED_FEATURES.md` (notifications)

---

## 23. Handoff to Phase 4

Phase 4 (implementation plan) must produce `OPS-Web/docs/superpowers/plans/2026-04-23-calibration-implementation.md` per OPS planning standard:

- Verified file list (every file to create / modify with absolute paths)
- Copy-paste-ready code for each task (not prose descriptions)
- 2-5 min granular tasks
- Commit after each task
- Permission gating specified per task
- Browser verification at the end (Jackson must run the deck, drill in, see live events)

The plan should resolve the §20 open items up-front (MCP queries to verify schemas / columns / persistence) before writing component code.
