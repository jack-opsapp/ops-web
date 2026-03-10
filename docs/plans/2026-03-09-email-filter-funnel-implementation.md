# Email Filter Funnel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the domain scroll list with an interactive Canvas 2D filter pipeline visualization that lets users see and control how emails flow through each filter stage.

**Architecture:** Canvas 2D horizontal pipeline (left-to-right) with category nodes connected by flowing vectors. Nodes use the same glow/particle aesthetic as `SetupStarfield.tsx`. Clicking a category zooms into individual filter sub-nodes. The funnel, filter controls, and email list all share the wizard's existing `filters` state.

**Tech Stack:** React, Canvas 2D, requestAnimationFrame, TypeScript, existing GmailSyncFilters type

---

### Task 1: Update AI prompt for richer summary

**Files:**
- Modify: `src/lib/api/services/email-classifier.ts`

**Step 1:** Update the `SYSTEM_PROMPT` constant. Change the summary instruction from the current single line to:

```typescript
// In the OUTPUT FORMAT section, replace the summary line with:
"summary": "3-4 sentence analysis. Include: (1) specific observations about this inbox — mention notable domains/patterns you see, (2) approximate percentage of emails that appear to be real customer or lead correspondence, (3) key domains you're keeping and why, (4) what categories of noise you're filtering and why. Be specific to THIS inbox, not generic."
```

**Step 2:** Verify by reading the full prompt to confirm the change is coherent.

**Step 3:** Commit.

```bash
git add src/lib/api/services/email-classifier.ts
git commit -m "feat: update AI prompt for richer scan summary"
```

---

### Task 2: Simplify StepScan — summary only, no domain list

**Files:**
- Modify: `src/components/settings/email-setup-wizard.tsx`

**Step 1:** In the `StepScan` component (starts at ~line 1081), replace the entire `{scanComplete && (...)}` block. Remove the domain groups map, the expandable domain cards, and the per-email expanded lists. Replace with:

```tsx
{scanComplete && (
  <>
    {/* Connection email badge */}
    {connectionEmail && (
      <motion.div variants={staggerItem} className="flex items-center gap-[6px]">
        <Mail className="w-[12px] h-[12px] text-ops-accent" />
        <span className="font-mono text-[10px] text-ops-accent">{connectionEmail}</span>
      </motion.div>
    )}

    {/* Stats row */}
    <motion.div variants={staggerItem} className="grid grid-cols-3 gap-1">
      <div className="px-1.5 py-1 rounded border border-border-subtle text-left">
        <span className="font-mono text-data-lg text-text-primary block">
          {scannedEmails.length}
        </span>
        <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-wider">
          Emails scanned
        </span>
      </div>
      <div className="px-1.5 py-1 rounded border border-[rgba(107,143,113,0.2)] text-left">
        <span className="font-mono text-data-lg text-[#9DB582] block">
          {importCount}
        </span>
        <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-wider">
          To import
        </span>
      </div>
      <div className="px-1.5 py-1 rounded border border-border-subtle text-left">
        <span className="font-mono text-data-lg text-text-secondary block">
          {filterCount}
        </span>
        <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-wider">
          Filtered out
        </span>
      </div>
    </motion.div>

    {/* AI summary */}
    {scanSummary && (
      <motion.div variants={staggerItem}>
        <p className="font-mohave text-body-sm text-text-secondary text-left leading-relaxed">
          {scanSummary}
        </p>
      </motion.div>
    )}
  </>
)}
```

**Step 2:** Remove the `onExcludeDomain` prop from StepScan — no longer needed. Remove it from the component signature, the prop type, and the parent render site.

**Step 3:** Remove unused state/imports: `expandedDomain` state inside StepScan, `ChevronDown` if no longer used elsewhere.

**Step 4:** Verify the scan step renders: summary + stats only, no domain cards.

**Step 5:** Commit.

```bash
git add src/components/settings/email-setup-wizard.tsx
git commit -m "feat: simplify StepScan to summary + stats only"
```

---

### Task 3: Create FilterFunnelCanvas component — static nodes and vectors

**Files:**
- Create: `src/components/settings/filter-funnel-canvas.tsx`

**Context:** Reference `src/components/setup/SetupStarfield.tsx` for Canvas 2D patterns (camera, star physics, node glow rendering, DPR handling, resize observer).

**Step 1:** Create the component with this structure:

```tsx
"use client";

import { useRef, useEffect, useCallback } from "react";
import type { GmailSyncFilters } from "@/lib/types/pipeline";

// ─── Types ───────────────────────────────────────────────────────────────────

interface FilterNode {
  id: string;
  label: string;
  shortLabel: string;
  type: "source" | "filter" | "result";
  enabled: boolean;
  count: number;        // emails removed (for filters) or remaining (for source/result)
  color: { r: number; g: number; b: number };
  x: number;            // computed position
  y: number;
}

interface FunnelStar {
  x: number;
  y: number;
  size: number;
  alpha: number;
  vx: number;
  vy: number;
  phase: number;
}

interface FlowParticle {
  x: number;
  y: number;
  progress: number;     // 0-1 along the vector
  speed: number;
  fromNode: number;
  toNode: number;
}

interface ScannedEmail {
  id: string;
  fromEmail: string;
  domain: string;
  subject: string;
  from: string;
  date: string;
  wouldImport: boolean;
  reason?: string;
  labels?: string[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ACCENT = { r: 89, g: 119, b: 148 };     // #597794
const AMBER = { r: 196, g: 168, b: 104 };     // #C4A868
const GREEN = { r: 157, g: 181, b: 130 };     // #9DB582
const DIM = { r: 80, g: 80, b: 80 };          // disabled

const NODE_SIZE = 6;           // half-size of square node
const STAR_COUNT = 150;
const FLOW_PARTICLE_COUNT = 40;
const CANVAS_HEIGHT = 220;

// ─── Props ───────────────────────────────────────────────────────────────────

interface FilterFunnelCanvasProps {
  filters: GmailSyncFilters;
  scannedEmails: ScannedEmail[];
  preFilteredCount: number;     // emails removed by preset blocklist before AI
  onToggleCategory: (category: string, enabled: boolean) => void;
  onDrillDown: (category: string) => void;
  className?: string;
}
```

**Step 2:** Implement the core Canvas setup — canvas ref, container ref, DPR handling, resize observer (copy pattern from SetupStarfield lines 186-199).

**Step 3:** Implement `computeNodes()` — takes filters + scannedEmails, returns array of FilterNode objects with computed positions and counts. Each filter node computes how many emails IT specifically removes (cumulative pipeline). Nodes spaced evenly left-to-right.

```typescript
function computeNodes(
  filters: GmailSyncFilters,
  emails: ScannedEmail[],
  preFilteredCount: number,
  canvasWidth: number,
): FilterNode[] {
  const totalSampled = emails.length + preFilteredCount;
  let remaining = totalSampled;
  const nodes: FilterNode[] = [];
  const padding = 60;
  const usableWidth = canvasWidth - padding * 2;

  // Source
  nodes.push({
    id: "source", label: `${totalSampled} emails sampled`,
    shortLabel: "Sampled", type: "source", enabled: true,
    count: totalSampled, color: ACCENT,
    x: padding, y: CANVAS_HEIGHT / 2,
  });

  // Preset blocklist
  const presetCount = preFilteredCount;
  remaining -= presetCount;
  nodes.push({
    id: "preset", label: "Newsletters & notifications",
    shortLabel: "Preset", type: "filter",
    enabled: filters.usePresetBlocklist,
    count: presetCount, color: filters.usePresetBlocklist ? AMBER : DIM,
    x: padding + usableWidth * 0.2, y: CANVAS_HEIGHT / 2,
  });

  // AI blocked domains
  const domainBlocked = new Set(filters.excludeDomains.map(d => d.toLowerCase()));
  const domainCount = emails.filter(e => domainBlocked.has(e.domain.toLowerCase())).length;
  remaining -= domainCount;
  nodes.push({
    id: "domains", label: "Blocked domains",
    shortLabel: "Domains", type: "filter",
    enabled: filters.excludeDomains.length > 0,
    count: domainCount, color: filters.excludeDomains.length > 0 ? AMBER : DIM,
    x: padding + usableWidth * 0.4, y: CANVAS_HEIGHT / 2,
  });

  // AI blocked addresses
  const addrBlocked = new Set((filters.excludeAddresses ?? []).map(a => a.toLowerCase()));
  const addrCount = emails.filter(e =>
    addrBlocked.has(e.fromEmail.toLowerCase()) && !domainBlocked.has(e.domain.toLowerCase())
  ).length;
  remaining -= addrCount;
  nodes.push({
    id: "addresses", label: "Blocked addresses",
    shortLabel: "Addresses", type: "filter",
    enabled: (filters.excludeAddresses ?? []).length > 0,
    count: addrCount, color: (filters.excludeAddresses ?? []).length > 0 ? AMBER : DIM,
    x: padding + usableWidth * 0.6, y: CANVAS_HEIGHT / 2,
  });

  // Subject keywords
  const keywords = (filters.excludeSubjectKeywords ?? []).map(k => k.toLowerCase());
  const kwCount = emails.filter(e => {
    if (domainBlocked.has(e.domain.toLowerCase())) return false;
    if (addrBlocked.has(e.fromEmail.toLowerCase())) return false;
    return keywords.some(kw => e.subject.toLowerCase().includes(kw));
  }).length;
  remaining -= kwCount;
  nodes.push({
    id: "keywords", label: "Subject keywords",
    shortLabel: "Keywords", type: "filter",
    enabled: keywords.length > 0,
    count: kwCount, color: keywords.length > 0 ? AMBER : DIM,
    x: padding + usableWidth * 0.8, y: CANVAS_HEIGHT / 2,
  });

  // Result
  nodes.push({
    id: "result", label: `${Math.max(0, remaining)} to import`,
    shortLabel: "Import", type: "result", enabled: true,
    count: Math.max(0, remaining), color: GREEN,
    x: padding + usableWidth, y: CANVAS_HEIGHT / 2,
  });

  return nodes;
}
```

**Step 4:** Implement the render loop. Draw in this order:
1. Ambient stars (small white dots with gentle drift)
2. Flow vectors between nodes (lines with thickness proportional to remaining count)
3. Nodes (square with glow, matching starfield style)
4. Labels below nodes (count + short label)
5. Flow particles drifting along active vectors

**Step 5:** For node glow rendering, reference SetupStarfield's node draw code. Key pattern:
```typescript
// Glow
ctx.shadowColor = `rgba(${color.r}, ${color.g}, ${color.b}, 0.6)`;
ctx.shadowBlur = 16;
ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, 0.9)`;
ctx.fillRect(x - NODE_SIZE, y - NODE_SIZE, NODE_SIZE * 2, NODE_SIZE * 2);
ctx.shadowBlur = 0;
```

**Step 6:** For flow vectors between nodes:
```typescript
// Vector from node A to node B
const thickness = Math.max(1, (remainingAfterA / totalSampled) * 8);
ctx.strokeStyle = enabled
  ? `rgba(${ACCENT.r}, ${ACCENT.g}, ${ACCENT.b}, 0.3)`
  : `rgba(80, 80, 80, 0.15)`;
ctx.lineWidth = thickness;
if (!enabled) ctx.setLineDash([4, 4]);
ctx.beginPath();
ctx.moveTo(nodeA.x + NODE_SIZE, nodeA.y);
ctx.lineTo(nodeB.x - NODE_SIZE, nodeB.y);
ctx.stroke();
ctx.setLineDash([]);
```

**Step 7:** For flow particles along active vectors:
```typescript
// Small bright dots that drift along active flow lines
for (const particle of flowParticles) {
  const fromNode = nodes[particle.fromNode];
  const toNode = nodes[particle.toNode];
  // Only show particles on active (enabled) flow lines
  if (!toNode.enabled && toNode.type === "filter") continue;
  const px = fromNode.x + (toNode.x - fromNode.x) * particle.progress;
  const py = fromNode.y + (toNode.y - fromNode.y) * particle.progress;
  const alpha = 0.4 + Math.sin(particle.progress * Math.PI) * 0.4;
  ctx.fillStyle = `rgba(${ACCENT.r}, ${ACCENT.g}, ${ACCENT.b}, ${alpha})`;
  ctx.beginPath();
  ctx.arc(px, py, 1.5, 0, Math.PI * 2);
  ctx.fill();
  // Advance
  particle.progress += particle.speed * dt;
  if (particle.progress > 1) particle.progress = 0;
}
```

**Step 8:** Add mouse interaction — track hover via mousemove, detect which node is hovered (distance check to node center). On hover, brighten node glow. On click, call `onDrillDown(node.id)` for filter nodes, or `onToggleCategory` for toggling.

**Step 9:** Add `prefers-reduced-motion` check — if true, skip flow particles and star drift. Render static nodes + lines only.

**Step 10:** Commit.

```bash
git add src/components/settings/filter-funnel-canvas.tsx
git commit -m "feat: FilterFunnelCanvas — static nodes, vectors, flow particles"
```

---

### Task 4: Add drill-down zoom animation

**Files:**
- Modify: `src/components/settings/filter-funnel-canvas.tsx`

**Step 1:** Add state for drill-down: `drilledCategory`, `zoomLevel`, `zoomTarget`, `cameraOffset`.

**Step 2:** When `onDrillDown(categoryId)` is called, set `drilledCategory` and animate zoom:
- Camera lerps toward the clicked node (CAMERA_LERP = 0.06, same as starfield)
- Zoom level lerps from 1.0 to ~2.5
- Other nodes fade out (alpha → 0.1)
- Sub-nodes appear around the focused node:
  - For "domains": each `filters.excludeDomains` entry becomes a sub-node
  - For "addresses": each `filters.excludeAddresses` entry
  - For "keywords": each `filters.excludeSubjectKeywords` entry
  - Sub-nodes arranged in a radial or grid pattern around the parent
- Each sub-node shows: label (e.g., "google.com"), count (emails it removes), toggle state
- Vectors from parent to each sub-node, same glow style

**Step 3:** Sub-node toggle: clicking a sub-node calls back to parent to update filters (remove/add the specific domain/address/keyword). Flow line to that sub-node goes dim/dashed.

**Step 4:** Zoom out: click canvas background or press Escape to zoom back. Camera lerps back to default position, sub-nodes fade, main nodes fade in.

**Step 5:** Commit.

```bash
git add src/components/settings/filter-funnel-canvas.tsx
git commit -m "feat: drill-down zoom into individual filters"
```

---

### Task 5: Redesign StepFilters — funnel + controls + email list

**Files:**
- Modify: `src/components/settings/email-setup-wizard.tsx`

**Step 1:** Import FilterFunnelCanvas at top of file:
```typescript
import { FilterFunnelCanvas } from "@/components/settings/filter-funnel-canvas";
```

**Step 2:** Rewrite `StepFilters` component. New layout:

```tsx
function StepFilters({
  filters,
  connectionId,
  onUpdate,
  scannedEmails,
  preFilteredCount,
}: {
  filters: GmailSyncFilters;
  connectionId: string;
  onUpdate: (f: GmailSyncFilters) => void;
  scannedEmails: ScannedEmail[];
  preFilteredCount: number;
}) {
  const [drilledCategory, setDrilledCategory] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(
    (filters.rules?.length ?? 0) > 0,
  );

  // Compute import count with current filters
  const importedEmails = scannedEmails.filter((e) => wouldImportWithFilters(e, filters));
  const importCount = importedEmails.length;

  function handleToggleCategory(category: string, enabled: boolean) {
    // Toggle entire category on/off in filters
    switch (category) {
      case "preset":
        onUpdate({ ...filters, usePresetBlocklist: enabled });
        break;
      case "domains":
        // If disabling, clear excludeDomains; if enabling, restore from scan
        // (store original AI suggestions somewhere or just toggle visibility)
        break;
      // ... similar for addresses, keywords
    }
  }

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-2">
      {/* Funnel visualization */}
      <motion.div variants={staggerItem}>
        <FilterFunnelCanvas
          filters={filters}
          scannedEmails={scannedEmails}
          preFilteredCount={preFilteredCount}
          onToggleCategory={handleToggleCategory}
          onDrillDown={setDrilledCategory}
          className="w-full rounded border border-border-subtle"
        />
      </motion.div>

      {/* Controls + Email list side by side */}
      <div className="flex gap-3">
        {/* Left: Filter controls */}
        <div className="w-[280px] shrink-0 space-y-2">
          {/* Preset blocklist toggle */}
          {/* ... same toggle as current ... */}

          {/* Blocked domains chips */}
          {filters.excludeDomains.length > 0 && (
            <div>
              <label className="font-kosugi text-[10px] text-text-disabled block mb-[4px] text-left">
                Blocked domains ({filters.excludeDomains.length})
              </label>
              <div className="flex flex-wrap gap-[4px]">
                {filters.excludeDomains.map((d) => (
                  <span key={d} className="inline-flex items-center gap-[3px] px-[6px] py-[2px] rounded-sm bg-background-card border border-border-subtle font-mono text-[10px] text-text-disabled">
                    {d}
                    <button onClick={() => onUpdate({
                      ...filters,
                      excludeDomains: filters.excludeDomains.filter(x => x !== d),
                    })} className="hover:text-ops-error transition-colors">
                      <X className="w-[10px] h-[10px]" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Blocked addresses chips */}
          {/* ... same pattern ... */}

          {/* Subject keywords chips */}
          {/* ... same pattern ... */}

          {/* Custom filter rules builder */}
          {/* ... same as current ... */}
        </div>

        {/* Right: Email list */}
        <div className="flex-1 min-w-0 rounded border border-border-subtle bg-background-card overflow-hidden flex flex-col">
          <div className="px-2 py-1.5 border-b border-border-subtle flex items-center justify-between">
            <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider">
              {importCount} emails will be imported
            </span>
          </div>
          <div className="flex-1 overflow-y-auto max-h-[300px]">
            {importedEmails.map((email) => (
              <div key={email.id} className="flex items-center gap-[8px] py-[3px] px-2 border-b border-border-subtle/50 hover:bg-background-elevated transition-colors">
                <div className="flex-1 min-w-0 text-left">
                  <span className="font-mohave text-[11px] text-text-secondary block truncate">
                    {email.subject || "(no subject)"}
                  </span>
                  <span className="font-mono text-[9px] text-text-disabled truncate block">
                    {email.from}
                  </span>
                </div>
                <span className="font-kosugi text-[9px] text-text-disabled shrink-0">
                  {new Date(email.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
```

**Step 3:** Update StepFilters props — add `preFilteredCount`. Pass it from parent (available from scan result data `result.preFiltered`). Store `preFilteredCount` in wizard state alongside `scannedEmails`.

**Step 4:** Remove `domainGroups` prop from StepFilters — no longer needed. Remove `domainGroups` state from the wizard if it's only used by these two steps.

**Step 5:** Fix step navigation: ensure "Next" from scan always goes to filters. Check `canProceed()` — scan step should return `scanComplete` only (not `scannedEmails.length > 0`).

**Step 6:** Commit.

```bash
git add src/components/settings/email-setup-wizard.tsx
git commit -m "feat: redesign StepFilters with funnel canvas + email list"
```

---

### Task 6: Wire up bidirectional sync between funnel and controls

**Files:**
- Modify: `src/components/settings/email-setup-wizard.tsx`
- Modify: `src/components/settings/filter-funnel-canvas.tsx`

**Step 1:** Ensure `handleToggleCategory` in StepFilters correctly toggles each category:
- `preset`: toggle `usePresetBlocklist`
- `domains`: store the AI-suggested domains separately so they can be restored. When disabled, remove all AI-suggested domains from `excludeDomains`. When re-enabled, add them back.
- `addresses`: same pattern for `excludeAddresses`
- `keywords`: same pattern for `excludeSubjectKeywords`

**Step 2:** When user removes a chip from the left-side controls, the funnel canvas should reflect the updated count on next render (it reads from `filters` prop).

**Step 3:** When user adds a custom filter rule in the builder, and it matches one of the funnel categories (e.g., a `from_domain` rule maps to domains category), update the relevant node count. For custom rules that don't map to a category, add a new "Custom rules" node to the funnel.

**Step 4:** Commit.

```bash
git add src/components/settings/email-setup-wizard.tsx src/components/settings/filter-funnel-canvas.tsx
git commit -m "feat: bidirectional sync between funnel and filter controls"
```

---

### Task 7: Polish — hover tooltips, node labels, responsive sizing

**Files:**
- Modify: `src/components/settings/filter-funnel-canvas.tsx`

**Step 1:** Add hover tooltip — when hovering a node, render a floating label above it showing:
- Category name
- Count removed
- Filter details (e.g., "6 domains: google.com, apple.com, ...")
- Use DOM overlay positioned via canvas coordinates (same pattern as starfield hover labels)

**Step 2:** Ensure canvas resizes properly when dialog resizes. Use ResizeObserver (same as starfield).

**Step 3:** Add count labels below each node:
- Filter nodes: "-N" in the node's color
- Source: total count
- Result: remaining count in green

**Step 4:** Add subtle node idle animation — tiny particles orbiting each active node (2-3 particles per node, small orbit radius). Reference starfield's `AMBIENT_ORBIT_RADIUS` pattern.

**Step 5:** Commit.

```bash
git add src/components/settings/filter-funnel-canvas.tsx
git commit -m "feat: funnel polish — tooltips, labels, idle particles"
```

---

### Task 8: Clean up wizard — remove dead code, fix flow

**Files:**
- Modify: `src/components/settings/email-setup-wizard.tsx`

**Step 1:** Remove `DomainGroup` interface and `domainGroups` state if no longer referenced anywhere.

**Step 2:** Remove domain grouping logic from `processScanResults` — no longer needed since we don't display domain groups.

**Step 3:** Store `preFilteredCount` from scan result:
```typescript
const [preFilteredCount, setPreFilteredCount] = useState(0);
// In processScanResults:
setPreFilteredCount(data.preFiltered ?? 0);
```

**Step 4:** Update `canProceed` for scan step to use `scanComplete` only:
```typescript
case "scan":
  return scanComplete;
```

**Step 5:** Remove the `onExcludeDomain` callback that was passed to StepScan — already removed the prop in Task 2.

**Step 6:** Verify full wizard flow: Connect → How It Works → Scan (summary) → Filters (funnel) → Import. No skipping.

**Step 7:** Commit.

```bash
git add src/components/settings/email-setup-wizard.tsx
git commit -m "refactor: clean up wizard — remove domain groups, fix flow"
```

---

### Task 9: Store AI-suggested filters separately for toggle restore

**Files:**
- Modify: `src/components/settings/email-setup-wizard.tsx`

**Step 1:** Add state to store the original AI suggestions so they can be toggled on/off:

```typescript
const [aiSuggestedFilters, setAiSuggestedFilters] = useState<{
  excludeDomains: string[];
  excludeAddresses: string[];
  excludeSubjectKeywords: string[];
} | null>(null);
```

**Step 2:** In `processScanResults`, save the AI suggestions before merging them into filters:

```typescript
const aiDomains = [
  ...(ai?.excludeDomains ?? []),
  ...suggestedBlockDomains,
];
const aiAddresses = ai?.excludeAddresses ?? [];
const aiKeywords = ai?.excludeSubjectKeywords ?? [];
setAiSuggestedFilters({
  excludeDomains: aiDomains,
  excludeAddresses: aiAddresses,
  excludeSubjectKeywords: aiKeywords,
});
```

**Step 3:** Pass `aiSuggestedFilters` to StepFilters so `handleToggleCategory` can restore them when re-enabling a category.

**Step 4:** Commit.

```bash
git add src/components/settings/email-setup-wizard.tsx
git commit -m "feat: store AI-suggested filters for category toggle restore"
```

---

### Task 10: Integration test — full flow walkthrough

**Step 1:** Manually test the full flow:
1. Open email setup wizard
2. Click "Scan My Emails"
3. Wait for scan to complete — should see summary + stats, NO domain list
4. Click "Review Filters" or "Next"
5. Filters step shows funnel canvas with nodes + flow
6. Hover nodes — should brighten with tooltip
7. Click a category — should zoom in to show individual filters
8. Toggle an individual filter off — flow dims, downstream counts update
9. Zoom back out — main view reflects changes
10. Remove a chip from left controls — funnel updates
11. Email list on right shows only passing emails, updates live
12. Click Next — goes to Import step (not skipped)

**Step 2:** Test edge cases:
- Scan with 0 emails
- All emails filtered (result = 0)
- No AI suggestions (AI failed)
- `prefers-reduced-motion` — static rendering

**Step 3:** Final commit with any fixes.

```bash
git add -A
git commit -m "fix: integration test fixes for filter funnel"
```
