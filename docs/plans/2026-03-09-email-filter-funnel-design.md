# Email Filter Funnel Visualization — Design

## Goal

Replace the confusing domain scroll list with an interactive, galaxy-aesthetic filter pipeline visualization that shows users exactly how their emails flow through each filter stage — and lets them toggle filters on/off to see the impact in real-time.

## Architecture

Canvas 2D horizontal pipeline (left-to-right) matching the existing starfield aesthetic from the setup views. Category-level nodes connected by flowing vectors, with drill-down zoom into individual filters per category.

## Wizard Flow

**Current:** Scan → (domain list) → Filters → Import
**New:** Scan → Summary → Filters (with funnel) → Import

No step skipping. "Continue" from Scan always goes to Filters.

---

## Scan Completion (Step 3)

After AI analysis completes:

- **Stats row** (3 columns): Emails scanned | To import | Filtered out
- **AI summary paragraph** — 3-4 sentences:
  - Specific observations about this inbox (e.g., "Heavy mix of Home Depot receipts and Google security alerts alongside real customer conversations")
  - Rough % of inbox worth keeping
  - Key domains identified as worth importing
  - What's being filtered and why
- **"Review Filters" button** — advances to Filters step

No domain scroll list. No individual email cards. Summary + stats only.

---

## Filter Funnel Visualization (Step 4)

### Layout

Full-width Canvas 2D component at top of the Filters step. Below it: filter controls (left) and scrollable email list (right).

### Funnel Nodes (left to right)

| Node | Label | Glow Color |
|------|-------|------------|
| Source | "500 emails sampled" | Accent blue `#597794` |
| Preset Blocklist | "Newsletters & notifications" | Amber `#C4A868` |
| AI Blocked Domains | "Blocked domains" | Amber `#C4A868` |
| AI Blocked Addresses | "Blocked addresses" | Amber `#C4A868` |
| AI Subject Keywords | "Subject keywords" | Amber `#C4A868` |
| Result | "N to import" | Green `#9DB582` |

Each filter node shows its removal count (e.g., "-112").

### Vectors Between Nodes

- Flowing lines connecting each node
- Thickness proportional to remaining email count (gets thinner left-to-right as emails are stripped)
- Active filters: solid lines with subtle animated particle drift along path
- Disabled filters: dim, dashed line, thickness unchanged (emails pass through)

### Node Visual Style

- Square nodes with glow effect (matching starfield nodes)
- Count displayed below each node
- Subtle idle particle orbit around each node (lighter than starfield — few particles per node)
- Ambient background stars (~200, subtle drift)

### Interaction

- **Hover**: Node brightens, tooltip shows filter details (e.g., "6 domains blocked")
- **Click category node**: Zoom-in animation — camera lerps to focused node, node expands into sub-view showing individual filters as smaller nodes. Each sub-node (e.g., "google.com — 12 emails") has a toggle. Toggling one off stops its flow (dim/dashed). Click background or back arrow to zoom out.
- **Toggle filter off**: Flow line from that node goes dim/dashed. All downstream counts update immediately.
- **Manually added filters**: Appear as new nodes inserted into the pipeline with same styling.

### Canvas Details

- Canvas 2D (same approach as SetupStarfield.tsx)
- ~200 ambient background stars with gentle drift
- RequestAnimationFrame loop, cleanup on unmount
- `prefers-reduced-motion`: static nodes + lines, no particles or flow animation
- Colors: accent blue `#597794`, amber `#C4A868`, green `#9DB582`

---

## Filter Controls + Email List (Below Funnel)

### Left Side: Filter Controls

- **Preset blocklist toggle** — on/off switch for 60+ newsletter domains
- **AI-suggested filters** — all pre-applied, shown as removable chips:
  - Blocked domains
  - Blocked addresses
  - Subject keywords
- **Custom filter rules builder** — "Add custom filter rules" expander
- Changes here sync bidirectionally with the funnel canvas

### Right Side: Email List

- Header: "N emails will be imported"
- Scrollable list of emails that pass ALL active filters
- Each row: sender, subject, date (compact)
- Updates live when filters are toggled in funnel or controls

### State Sync

- Single source of truth: existing `filters` state object in the wizard
- Funnel reads `filters` + `scannedEmails`, computes per-node counts cumulatively
- Toggle in funnel or chip removal in controls both call same `onUpdate(filters)`
- No duplicate state

---

## AI Prompt Update

Update the system prompt in `email-classifier.ts` to request a longer summary:

- Specific observations about the inbox composition
- Rough % of emails worth keeping
- Key domains identified as real customer/lead sources
- Brief note on what's being filtered and why
- Target: 3-4 sentences

---

## New Components

| Component | Type | Purpose |
|-----------|------|---------|
| `FilterFunnelCanvas.tsx` | Canvas 2D | Funnel visualization — nodes, vectors, particles, zoom drill-down |

## Modified Components

| Component | Changes |
|-----------|---------|
| `email-setup-wizard.tsx` | Remove domain list from StepScan (summary only). Redesign StepFilters with funnel + email list. Fix step navigation. |
| `email-classifier.ts` | Update system prompt for longer summary. |

## No Changes Needed

- API routes (scan-start, scan-status, scan-preview)
- Data model (gmail_scan_jobs, gmail_connections)
- Filter state shape (GmailSyncFilters)
