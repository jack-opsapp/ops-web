# Inbox Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` (or `custom-skills:executing-plans`) to implement this plan task-by-task. Each task is a discrete commit-worthy unit; do not batch.

**Goal:** Port the design-handoff inbox redesign at `~/Downloads/design_handoff_inbox_redesign/` into `ops-web/src/components/ops/inbox/` as production code — three-column layout (thread feed · iMessage detail · context tabs), agent-palette provenance, calm motion, mobile drawer collapse — wired to the existing TanStack Query data layer with no scope deferred.

**Architecture:** Three resizable columns mounted inside the existing `<Sidebar>` + `<TopBar>` shell at `/inbox`. **Solid panels** (`#0E0F12` / `#16181C`) are scoped to inbox routes only — the canonical glass-surface system remains the OPS-Web default. **Agent lavender scale** (`#8A7FB8` + `agent*` tokens) is added to the global token system as a *Claude-authored-only* semantic, with audit rules to prevent leak. Motion stays in the 120–180ms band on the system's single `EASE_SMOOTH` curve, with a milestone-only olive `#9DB582` pulse for thread-close / estimate-accept / invoice-paid. State machine for bands and composer is driven by the existing `phaseC` field on threads plus a new `agent.needsInput` derived flag.

**Tech Stack:** Next.js 14 App Router · TypeScript · Tailwind CSS · Framer Motion · TanStack Query · Zustand · `lucide-react` · `react-resizable-panels` (new dependency) · `@radix-ui/react-tabs` (existing).

**Design System:**
- `OPS-Web/.interface-design/system.md` (canonical, spec v2 — 2026-04-17)
- `.claude/animation-studio.local.md` at OPS root (brand motion identity)
- `~/Downloads/design_handoff_inbox_redesign/README.md` + `SPEC.md` + `reference/*.jsx` (canonical visual reference for the inbox)

**Required Skills (load before each task type):**
- `custom-skills:interface-design` — every UI task
- `frontend-design` — every component build
- `animation-studio:animation-architect` (gateway, already loaded) → `animation-studio:web-animations` for any motion code
- `ops-copywriter` — every user-facing string
- `custom-skills:audit-design-system` — final audit pass
- `superpowers:test-driven-development` — every task with logic
- `superpowers:verification-before-completion` — before claiming any task done

**Inbox-specific design decisions (recorded so the executor doesn't re-litigate):**
1. **Solid panels in the inbox.** The handoff's `#0E0F12` / `#16181C` palette is scoped to `/inbox/**` because dense thread lists + bubble scroll + sticky group headers would jank with `backdrop-blur(28px) saturate(1.3)` glass at 60fps. Glass remains the OPS-Web system-wide default. New tokens are inbox-namespaced.
2. **Agent lavender is a global token, governed by usage rule.** Add to `tailwind.config.ts` and CSS variables. The system.md gets a new "Agent Provenance Palette" section documenting that lavender is reserved for Claude-authored surfaces only. `audit-design-system` pass will spot-check.
3. **Accent expansion inside the inbox.** Spec v2 says accent is "primary CTA + focus only, one per screen." Inside the inbox, accent ALSO functions as the "ball is yours" semantic (left bar on row when selected, "Your turn" band CTA, active project task dot, "This thread" pipeline tag). This is documented as a feature-scoped exception, not a system-wide change. The detail composer's primary send button remains the canonical primary CTA.
4. **Inbox uses `react-resizable-panels`.** New dep, ~5KB gzipped. Added in Phase 0.
5. **No glass-dense modals open from the inbox in this scope.** Project modal (linked from "Open project") is out of scope per the handoff — wire `?project=:id` URL param, modal lives elsewhere.
6. **Phase 3 / Phase C terminology.** `phaseC` is the existing thread field driving band + composer state. Values: `"none" | "ai_drafted" | "auto_sent"`. Plus a new derived flag `agent.needsInput: boolean`. Plus `closed: boolean`. The `bandKind` selection is a pure function of these — see Task 3.2.

---

## Task index

- **Phase 0 — Setup** · Task 0.1
- **Phase 1 — Tokens** · Tasks 1.1, 1.2
- **Phase 2 — Left column** · Tasks 2.1, 2.2, 2.3, 2.4
- **Phase 3 — Detail pane** · Tasks 3.1, 3.2, 3.3, 3.4
- **Phase 4 — Composer** · Tasks 4.1, 4.2, 4.3
- **Phase 5 — Right rail tabs** · Tasks 5.1, 5.2, 5.3, 5.4
- **Phase 6 — Resizers + responsive** · Tasks 6.1, 6.2
- **Phase 7 — Data + routing** · Tasks 7.1, 7.2
- **Phase 8 — Motion + a11y** · Tasks 8.1, 8.2
- **Phase 9 — Copy + cleanup + verification** · Tasks 9.1, 9.2, 9.3

Total: **25 tasks**.

---

## Phase 0 — Workspace Setup

### Task 0.1: Worktree, dependencies, dev-server smoke test

**Skills:** `superpowers:using-git-worktrees`

**Files:**
- Modify: `package.json` (add dep)

**Steps:**

1. From the ops-web repo root, create a git worktree for isolated work:
   ```bash
   cd /Users/jacksonsweet/Projects/OPS/ops-web
   git worktree add -b feat/inbox-redesign ../ops-web-inbox-redesign main
   cd ../ops-web-inbox-redesign
   ```
   (All subsequent paths in this plan are relative to `ops-web-inbox-redesign/`. If the executor stays in the main worktree, replace accordingly.)

2. Install `react-resizable-panels`:
   ```bash
   npm install react-resizable-panels
   ```
   Cost note: zero ongoing cost. Adds ~5KB gzipped to `/inbox` route.

3. Boot the dev server and verify the existing inbox loads:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000/inbox`. Confirm the current four-rail layout renders without errors. This is the regression baseline — screenshot it for before/after comparison at Phase 9.

4. Run type-check + tests to confirm a clean baseline:
   ```bash
   npm run type-check
   npm run test -- --run
   ```
   Expected: zero errors, all tests pass.

5. Commit the dependency add:
   ```bash
   git add package.json package-lock.json
   git commit -m "chore(inbox): add react-resizable-panels for inbox redesign"
   ```

---

## Phase 1 — Token Extension

### Task 1.1: Add `agent.*` lavender scale to global tokens

**Skills:** `custom-skills:interface-design`, `frontend-design`

**Files:**
- Modify: `tailwind.config.ts`
- Modify: `src/app/globals.css` (or wherever CSS variables live — verify with `rg "ops-accent-rgb" src/`)
- Modify: `.interface-design/system.md` (add "Agent Provenance Palette" section)

**Design tokens to add (global — usable across the app):**

```ts
// tailwind.config.ts → theme.extend.colors
agent: {
  DEFAULT: "#8A7FB8",                              // base agent fill / borders
  hi: "#B5ABDC",                                   // emphasis text on agent surfaces
  text: "#C9C0E6",                                 // body text Claude wrote
  text2: "#A39CC9",                                // secondary / provenance lines
  border: "rgba(138, 127, 184, 0.18)",             // dividers / outlines
  "border-hi": "rgba(138, 127, 184, 0.36)",        // emphasis borders
  bg: "rgba(138, 127, 184, 0.04)",                 // tinted backgrounds
  "bg-hi": "rgba(138, 127, 184, 0.10)",            // hover / active agent surface
},
```

```css
/* globals.css */
:root {
  --agent: #8A7FB8;
  --agent-hi: #B5ABDC;
  --agent-text: #C9C0E6;
  --agent-text-2: #A39CC9;
  --agent-border: rgba(138, 127, 184, 0.18);
  --agent-border-hi: rgba(138, 127, 184, 0.36);
  --agent-bg: rgba(138, 127, 184, 0.04);
  --agent-bg-hi: rgba(138, 127, 184, 0.10);
}
```

**system.md addition** — append after "Earth Tones" section:

```markdown
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
```

**Step 1 — Write the failing token-existence test:**

Create `tests/unit/design-system/agent-tokens.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import config from "../../../tailwind.config";

describe("agent palette tokens", () => {
  it("exposes the full agent scale on tailwind theme", () => {
    const colors = config.theme?.extend?.colors as Record<string, any>;
    expect(colors.agent).toEqual({
      DEFAULT: "#8A7FB8",
      hi: "#B5ABDC",
      text: "#C9C0E6",
      text2: "#A39CC9",
      border: "rgba(138, 127, 184, 0.18)",
      "border-hi": "rgba(138, 127, 184, 0.36)",
      bg: "rgba(138, 127, 184, 0.04)",
      "bg-hi": "rgba(138, 127, 184, 0.10)",
    });
  });
});
```

**Step 2 — Run, verify failure:**
```bash
npm run test -- tests/unit/design-system/agent-tokens.test.ts
```
Expected: FAIL — `colors.agent is undefined`.

**Step 3 — Add the tokens to `tailwind.config.ts`** (paste the agent block from above).

**Step 4 — Add CSS variables to `globals.css`.**

**Step 5 — Update `system.md` with the Agent Provenance Palette section.**

**Step 6 — Run, verify pass:**
```bash
npm run test -- tests/unit/design-system/agent-tokens.test.ts
npm run type-check
```

**Step 7 — Commit:**
```bash
git add tailwind.config.ts src/app/globals.css .interface-design/system.md tests/unit/design-system/agent-tokens.test.ts
git commit -m "feat(design-system): add agent.* lavender scale for Claude provenance"
```

---

### Task 1.2: Add inbox-scoped surface tokens

**Skills:** `custom-skills:interface-design`

**Files:**
- Modify: `tailwind.config.ts`
- Modify: `src/app/globals.css`

**Tokens to add** (namespaced `inbox-*` so they cannot leak into glass-surface contexts):

```ts
// tailwind.config.ts → theme.extend.colors
inbox: {
  bg: "#0E0F12",          // page background inside /inbox
  "bg-deep": "#08090B",   // deep wells (rail bg, message gutter)
  panel: "#16181C",       // cards, rails, composer
  elev: "#1A1D22",        // hover states
},
```

```css
/* globals.css */
:root {
  --inbox-bg: #0E0F12;
  --inbox-bg-deep: #08090B;
  --inbox-panel: #16181C;
  --inbox-elev: #1A1D22;
}
```

**Step 1 — Write the failing test** at `tests/unit/design-system/inbox-tokens.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import config from "../../../tailwind.config";

describe("inbox surface tokens", () => {
  it("exposes inbox-scoped surface tokens", () => {
    const colors = config.theme?.extend?.colors as Record<string, any>;
    expect(colors.inbox).toEqual({
      bg: "#0E0F12",
      "bg-deep": "#08090B",
      panel: "#16181C",
      elev: "#1A1D22",
    });
  });
});
```

**Step 2 — Run, verify failure.**
**Step 3 — Add tokens.**
**Step 4 — Run, verify pass.**

**Step 5 — Commit:**
```bash
git add tailwind.config.ts src/app/globals.css tests/unit/design-system/inbox-tokens.test.ts
git commit -m "feat(inbox): add inbox-scoped surface tokens (bg/bg-deep/panel/elev)"
```

---

## Phase 2 — Left Column

### Task 2.1: `<InboxShell>` three-column layout

**Skills:** `custom-skills:interface-design`, `frontend-design`, `animation-studio:web-animations`

**Files:**
- Create: `src/components/ops/inbox/inbox-shell.tsx`
- Modify: `src/app/(dashboard)/inbox/page.tsx` (route — wire to new shell)

**Reference:** `~/Downloads/design_handoff_inbox_redesign/Tabs Refined.html` (in-situ shell layout)

**Design tokens used:**
- Background: `bg-inbox-bg`
- Borders: `border-line` (existing), `border-line-hi` for active dividers
- Layout widths: left `360px` (320–480), center `flex`, right `360px` (320–440)

**Architecture note:** `<InboxShell>` is a client component. It uses Zustand for `rightRailOpen` (persisted to localStorage). Uses `react-resizable-panels` for the dividers, which is added in Task 6.1 — for this task, hardcode the widths and skip resize. Drag handles are added in Phase 6.

**Step 1 — Write the structural test** at `src/components/ops/inbox/__tests__/inbox-shell.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { InboxShell } from "../inbox-shell";

describe("<InboxShell>", () => {
  it("renders three primary regions with correct ARIA roles", () => {
    render(
      <InboxShell
        threadList={<div data-testid="thread-list" />}
        detail={<div data-testid="detail" />}
        contextRail={<div data-testid="context" />}
      />
    );
    expect(screen.getByTestId("thread-list")).toBeInTheDocument();
    expect(screen.getByTestId("detail")).toBeInTheDocument();
    expect(screen.getByTestId("context")).toBeInTheDocument();
    // Left + right are aside/complementary; center is main.
    expect(screen.getByRole("main")).toBeInTheDocument();
    const asides = screen.getAllByRole("complementary");
    expect(asides).toHaveLength(2);
  });

  it("hides the context rail when rightRailOpen=false", () => {
    render(
      <InboxShell
        rightRailOpen={false}
        threadList={<div />}
        detail={<div />}
        contextRail={<div data-testid="context" />}
      />
    );
    expect(screen.queryByTestId("context")).not.toBeInTheDocument();
  });
});
```

**Step 2 — Run, verify failure.**

**Step 3 — Implement `<InboxShell>`** (`src/components/ops/inbox/inbox-shell.tsx`):

```tsx
"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface InboxShellProps {
  threadList: ReactNode;
  detail: ReactNode;
  contextRail: ReactNode;
  rightRailOpen?: boolean;
  className?: string;
}

export function InboxShell({
  threadList,
  detail,
  contextRail,
  rightRailOpen = true,
  className,
}: InboxShellProps) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full bg-inbox-bg text-text",
        className
      )}
    >
      <aside
        role="complementary"
        aria-label="Thread list"
        className="flex w-[360px] shrink-0 flex-col border-r border-line bg-inbox-bg"
      >
        {threadList}
      </aside>
      <main className="flex min-w-0 flex-1 flex-col bg-inbox-bg">
        {detail}
      </main>
      {rightRailOpen && (
        <aside
          role="complementary"
          aria-label="Thread context"
          className="flex w-[360px] shrink-0 flex-col border-l border-line bg-inbox-bg-deep"
        >
          {contextRail}
        </aside>
      )}
    </div>
  );
}
```

**Step 4 — Wire the route.** Replace the body of `src/app/(dashboard)/inbox/page.tsx` to render `<InboxShell>` with placeholder children for now:

```tsx
import { InboxShell } from "@/components/ops/inbox/inbox-shell";

export default function InboxPage() {
  return (
    <InboxShell
      threadList={<div className="p-4 text-text-3">Thread list (Phase 2)</div>}
      detail={<div className="p-4 text-text-3">Detail (Phase 3)</div>}
      contextRail={<div className="p-4 text-text-3">Context (Phase 5)</div>}
    />
  );
}
```

(Save the previous body in a sibling `page.tsx.bak` only if you want a recovery point. Otherwise rely on git.)

**Step 5 — Run tests + type-check + visual check.**
```bash
npm run test -- inbox-shell
npm run type-check
```
Visit `http://localhost:3000/inbox` — confirm three vertical bands, dark background, hairline borders.

**Step 6 — Commit:**
```bash
git add src/components/ops/inbox/inbox-shell.tsx src/components/ops/inbox/__tests__/inbox-shell.test.tsx src/app/\(dashboard\)/inbox/page.tsx
git commit -m "feat(inbox): inbox shell scaffold with three-column layout"
```

---

### Task 2.2: `<TodayBar>` — pinned commitments strip

**Skills:** `custom-skills:interface-design`, `ops-copywriter`, `frontend-design`

**Files:**
- Create: `src/components/ops/inbox/today-bar.tsx`
- Create: `src/components/ops/inbox/__tests__/today-bar.test.tsx`
- Modify: `src/i18n/dictionaries/en/inbox.json` (create if missing)
- Modify: `src/i18n/dictionaries/es/inbox.json` (create if missing)

**Reference:** `reference/v3-columns.jsx` `V3TodayColumn` block + the `Inbox - Final.html` artboards.

**Spec:** ~64px tall, `bg-inbox-panel`, sits at the top of the left column. Two states:
- **At least one commitment:** `// BALL IN YOUR COURT — TODAY`(Cake Mono Light 10.5px, `tracking-[0.18em]`, `text-text-2`) + count pill + first commitment as a one-line link to its thread.
- **Zero commitments:** `// ALL CLEAR` + `text-text-3` body "no commitments today".

**i18n keys to add to `inbox.json`:**

```json
{
  "todayBar": {
    "title": "BALL IN YOUR COURT",
    "today": "TODAY",
    "allClear": "ALL CLEAR",
    "noCommitments": "no commitments today",
    "itemCount_one": "{count} item",
    "itemCount_other": "{count} items"
  }
}
```

(ops-copywriter invoked to confirm: terse tactical, uppercase for authority, sentence-case for body content, no exclamations, no emoji.)

**Step 1 — Test** (`__tests__/today-bar.test.tsx`):

```tsx
import { render, screen } from "@testing-library/react";
import { TodayBar } from "../today-bar";

describe("<TodayBar>", () => {
  it("renders the empty state when there are zero commitments", () => {
    render(<TodayBar commitments={[]} />);
    expect(screen.getByText(/ALL CLEAR/)).toBeInTheDocument();
    expect(screen.getByText(/no commitments today/)).toBeInTheDocument();
  });

  it("shows the next commitment summary when one exists", () => {
    render(
      <TodayBar
        commitments={[
          { id: "c1", text: "Confirm revised start date · Calloway", due: "TODAY 17:00", threadId: "t1", urgent: true },
        ]}
      />
    );
    expect(screen.getByText(/BALL IN YOUR COURT/)).toBeInTheDocument();
    expect(screen.getByText(/Confirm revised start date · Calloway/)).toBeInTheDocument();
  });

  it("links the next commitment to its thread", () => {
    render(
      <TodayBar
        commitments={[
          { id: "c1", text: "X", due: "TODAY", threadId: "t-abc", urgent: false },
        ]}
      />
    );
    expect(screen.getByRole("link", { name: /X/ })).toHaveAttribute("href", "/inbox/t-abc");
  });
});
```

**Step 2 — Run, verify failure.**

**Step 3 — Implement.** Use `font-cakemono font-light` for the section label, `font-mono` for the count and due time, `font-mohave` for the body line. Pull strings from `useDictionary("inbox")`.

**Step 4 — Run, verify pass + visual smoke.**

**Step 5 — Commit.**

---

### Task 2.3: `<ThreadList>` — grouped sections + sticky headers

**Skills:** `custom-skills:interface-design`, `frontend-design`, `animation-studio:web-animations`

**Files:**
- Create: `src/components/ops/inbox/thread-list.tsx`
- Create: `src/components/ops/inbox/__tests__/thread-list.test.tsx`
- Create: `src/lib/inbox/grouping.ts` (pure function — easy unit test target)
- Modify: `src/i18n/dictionaries/{en,es}/inbox.json`

**Reference:** `reference/v3-columns.jsx` `V4Column`, plus `SPEC.md` § "Left column".

**Group order (top → bottom):** `NEEDS YOUR INPUT` → `URGENT` → `TODAY` → `THIS WEEK` → `EARLIER`. Empty groups are not rendered.

**Sticky group headers:** `9.5px font-cakemono font-light uppercase tracking-[0.18em] text-text-3`, `bg-inbox-bg/95 backdrop-blur-[4px]` (4px blur is light enough not to jank). `position: sticky; top: 0; z-1;`. Padding `12px 14px 6px`.

**Step 1 — Pure-function test for grouping** (`tests/unit/inbox/grouping.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { groupThreads, GroupKey } from "@/lib/inbox/grouping";

describe("groupThreads", () => {
  const NOW = new Date("2026-05-06T15:00:00Z").getTime();

  it("places agent-blocked threads in NEEDS_YOUR_INPUT", () => {
    const threads = [{ id: "a", agent: { needsInput: true }, ts: NOW, labels: [] }];
    const groups = groupThreads(threads, NOW);
    expect(groups.get("NEEDS_YOUR_INPUT")).toEqual([threads[0]]);
  });

  it("places URGENT-labelled threads in URGENT", () => {
    const threads = [{ id: "b", agent: { needsInput: false }, ts: NOW, labels: ["URGENT"] }];
    const groups = groupThreads(threads, NOW);
    expect(groups.get("URGENT")).toEqual([threads[0]]);
  });

  it("buckets by recency: today vs this week vs earlier", () => {
    const today = NOW - 1000 * 60 * 60 * 2;          // 2h ago
    const thisWeek = NOW - 1000 * 60 * 60 * 24 * 3;  // 3d ago
    const earlier = NOW - 1000 * 60 * 60 * 24 * 30;  // 30d ago
    const threads = [
      { id: "t", agent: { needsInput: false }, ts: today, labels: [] },
      { id: "w", agent: { needsInput: false }, ts: thisWeek, labels: [] },
      { id: "e", agent: { needsInput: false }, ts: earlier, labels: [] },
    ];
    const groups = groupThreads(threads, NOW);
    expect(groups.get("TODAY")?.[0].id).toBe("t");
    expect(groups.get("THIS_WEEK")?.[0].id).toBe("w");
    expect(groups.get("EARLIER")?.[0].id).toBe("e");
  });

  it("orders groups: needs-input → urgent → today → this-week → earlier", () => {
    // ...
    const keys = Array.from(groupThreads([], NOW).keys()) as GroupKey[];
    expect(keys).toEqual(["NEEDS_YOUR_INPUT", "URGENT", "TODAY", "THIS_WEEK", "EARLIER"]);
  });

  it("auto-sent threads are suppressed from default groupings", () => {
    const threads = [{ id: "x", agent: { needsInput: false }, ts: NOW, labels: [], phaseC: "auto_sent" }];
    const groups = groupThreads(threads, NOW);
    expect([...groups.values()].flat()).toEqual([]);  // hidden by default
  });
});
```

**Step 2 — Run, verify failures.**

**Step 3 — Implement `src/lib/inbox/grouping.ts`** as a pure function. Type `Thread` should mirror the existing inbox thread schema — discover via `rg "type Thread" src/` and re-use existing types where they exist; extend if needed.

**Step 4 — Implement `<ThreadList>`** that takes `threads: Thread[]`, `selectedThreadId: string | null`, `onSelect: (id: string) => void`, calls `groupThreads`, and renders sticky group headers + rows.

For the rendering of rows themselves, render `<ThreadRow>` (from Task 2.4) — implement a placeholder for now that just renders client name + ts.

**Step 5 — Run, verify pass.**

**Step 6 — Commit:**
```bash
git commit -m "feat(inbox): thread list with grouped sections and sticky headers"
```

---

### Task 2.4: `<ThreadRow>` — variants for read/unread/AI/needs-input/auto-sent/urgent

**Skills:** `custom-skills:interface-design`, `frontend-design`, `ops-copywriter`

**Files:**
- Create: `src/components/ops/inbox/thread-row.tsx`
- Create: `src/components/ops/inbox/__tests__/thread-row.test.tsx`

**Reference:** `reference/v3-columns.jsx` `V4Row` + handoff README "Row anatomy".

**Row anatomy (~68px):**
- Left edge: optional 2px stripe — `bg-rose` for `URGENT`, `bg-agent` for AI-drafted (only when row not selected); `bg-ops-accent` when selected.
- Avatar 32×32 round.
- Title row:
  - Client name `13px font-mohave` — `font-semibold` if unread, `font-medium` if read; `text-text` if unread, `text-text-2` if read; `tracking-[-0.003em]`.
  - **AI-DRAFT chevron tag** (when `phaseC === "ai_drafted"`) — `font-cakemono font-light` 9.5px `tracking-[0.16em]` uppercase, `text-agent`.
  - **"?" pill** (when `agent.needsInput === true`) — `font-cakemono font-light` 9.5px `tracking-[0.16em]` uppercase, `text-agent` with `border-agent-border` rounded-chip.
  - Right-aligned time meta: `10.5px font-mono tracking-[0.2em] text-muted` (or `text-text-3` if unread).
- Snippet row: 1 line, `12px font-mohave leading-[1.4] text-text-3`.

**Selected state:** `bg-ops-accent/7` row tint + 3px accent left bar (overrides category stripe).

**Hover state:** `bg-inbox-elev`.

**Step 1 — Test all six variants render the expected signals.** Add prop variations for `unread`, `phaseC`, `agent.needsInput`, `labels: ["URGENT"]`, `selected`. Assert specific class presences (e.g., `text-agent` shows up when AI-drafted).

**Step 2-5:** TDD as usual.

**Step 6 — Commit:**
```bash
git commit -m "feat(inbox): thread row with read/unread/AI/needs-input/auto-sent/urgent variants"
```

---

## Phase 3 — Detail Pane

### Task 3.1: `<ThreadDetail>` shell — header, contact strip, prev/next nav

**Skills:** `custom-skills:interface-design`, `frontend-design`, `animation-studio:web-animations`

**Files:**
- Create: `src/components/ops/inbox/thread-detail.tsx`
- Create: `src/components/ops/inbox/thread-detail-header.tsx`
- Create: `src/components/ops/inbox/contact-strip.tsx`
- Create: `src/components/ops/inbox/__tests__/thread-detail.test.tsx`

**Reference:** `reference/v4-detail.jsx` `V4Detail` (the shell parts).

**Header bar (~56px, `border-b border-line`, `bg-inbox-panel`):**
- Client name — `font-mohave font-medium 16px tracking-[-0.005em] text-text` truncated.
- Right-side icon buttons (28×28 each, `text-text-3 hover:text-text-2`): `archive`, `clock` (snooze), `tag` (recategorize), `more`. Use `lucide-react`.
- A separate left-edge cluster: prev/next thread arrows + `Cmd+K` hint via `<KeyHint>` + right-rail toggle.

**Contact strip (under header):**
- `bg-inbox-bg`, padding `8px 18px`, `border-b border-line`.
- Tappable mono entries: `phone · email · address`.
- Style: `font-mono 10.5px tracking-[0.2em] text-text-3 hover:text-text-2`. Lucide icons `phone`, `mail`, `building` at 11px stroke 1.75 in `text-muted`.

**Prev/next nav:** Bind `J` / `K` keys to `onPrev` / `onNext` props (props provided by parent — in Task 7.2 they'll resolve from grouping). Skip in inputs/textareas.

**Step 1 — Test.**
**Step 2-5 — Implement, verify, commit.**

```bash
git commit -m "feat(inbox): thread detail header + contact strip with J/K navigation"
```

---

### Task 3.2: `<DetailBand>` — five band kinds + selection logic

**Skills:** `custom-skills:interface-design`, `ops-copywriter`, `animation-studio:web-animations`

**Files:**
- Create: `src/components/ops/inbox/detail-band.tsx` (orchestrator + selection)
- Create: `src/components/ops/inbox/bands/summary-band.tsx`
- Create: `src/components/ops/inbox/bands/needs-input-band.tsx`
- Create: `src/components/ops/inbox/bands/ball-yours-band.tsx`
- Create: `src/components/ops/inbox/bands/auto-sent-band.tsx`
- Create: `src/components/ops/inbox/bands/closed-band.tsx`
- Create: `src/lib/inbox/band-selection.ts` (pure function)
- Create: `tests/unit/inbox/band-selection.test.ts`
- Modify: `src/i18n/dictionaries/{en,es}/inbox.json` (band copy)

**Reference:** `reference/v4-detail.jsx` `V4SummaryBand` / `V4NeedsInputBand` + handoff README "Detail bands" table.

**Pure selection function `selectBand(thread)`:**
```ts
type BandKind = "summary" | "needs-input" | "ball-yours" | "auto-sent" | "closed" | null;

export function selectBand(thread: ThreadForBand): BandKind {
  if (thread.closed) return "closed";
  if (thread.agent?.needsInput) return "needs-input";
  if (thread.phaseC === "auto_sent") return "auto-sent";
  if (thread.aiSummary) return "summary";
  if (thread.ballInCourt === "user") return "ball-yours";
  return null;
}
```

**Bands:**

1. **Summary band** — `bg-agent-bg`, `border-b border-line`. Layout per `V4SummaryBand`. Lavender section label "YOUR MOVE", `font-mono` muted timestamp + "updated by Claude · {n} min ago", body `font-mohave 12.5px text-agent-text leading-[1.5] tracking-[-0.003em] text-pretty`. Optional `history` button on the right.

2. **Needs-input band** — `bg-agent-bg`, lavender Sparkles icon, label "// CLAUDE NEEDS YOUR INPUT" (Cake Mono Light, `text-agent-hi`), body in `text-agent-text`, optional bullet options as 26px-tall ghost buttons + a "type a reply..." escape hatch button. Surface a "PROVIDE ANSWER" filled `bg-agent-bg-hi border-agent-border-hi text-agent-hi` button as the primary CTA when no options provided.

3. **Ball-yours band** — `bg-inbox-panel`, 2px `bg-ops-accent` left bar, label "// YOUR TURN — {client name} is waiting" (`font-cakemono font-light text-text`), accent CTA `text-ops-accent border-ops-accent` outlined "Reply" button.

4. **Auto-sent band** — `bg-agent-bg`, "Claude replied {n}h ago — say something different?" with a `text-agent-hi` underlined link to revise.

5. **Closed band** — soft success: olive Check icon (`text-olive`), "Closed Apr 23" mono meta, dim `text-text-3`. No CTA.

**Step 1 — Test the selection function** with all 6 input states (closed > needs-input > auto-sent > summary > ball-yours > null priority chain).

**Step 2-5 — TDD.**

**Step 6 — Commit:**
```bash
git commit -m "feat(inbox): detail band system (summary/needs-input/ball-yours/auto-sent/closed)"
```

---

### Task 3.3: `<MessageBubble>` + day separator + author grouping

**Skills:** `custom-skills:interface-design`, `frontend-design`

**Files:**
- Create: `src/components/ops/inbox/message-bubble.tsx`
- Create: `src/components/ops/inbox/message-list.tsx`
- Create: `src/lib/inbox/message-grouping.ts`
- Tests: `__tests__/message-bubble.test.tsx`, `tests/unit/inbox/message-grouping.test.ts`

**Reference:** `reference/v3-messages.jsx` `V3Bubble` + handoff README § "Messages".

**Bubble spec:**
- **Inbound:** `bg-inbox-panel`, `border border-line`, left-aligned, avatar in 32px gutter.
- **Outbound:** `bg-ops-accent/20` (`rgba(111,148,176,0.20)`), `border border-ops-accent/22` (`rgba(111,148,176,0.22)`), right-aligned, no avatar, max-w 70% of viewport.
- **AI-drafted (sent by Claude on user's behalf):** `bg-agent-bg-hi`, `border border-agent-border-hi`, lavender Sparkles 10px icon in the meta line + `text-agent-text-2 font-mono 10px` "sent by Claude". Right-aligned outbound layout.
- Body: `13.5px font-mohave leading-[1.5] text-text tracking-[-0.003em] text-pretty`.
- Radius `10px`. Tail corner only on the **last bubble per author group**.
- Same-author messages within ~5 minutes collapse the vertical gap from `14px` → `4px`.

**Day separator:** centered `font-mono 10px tracking-[0.2em] uppercase text-muted` between days. e.g. `APR 24`.

**Step 1 — Test author-grouping logic** (`message-grouping.ts`): given an array of messages, returns annotations `{ isFirstOfAuthorRun, isLastOfAuthorRun, dayBoundary }` so the renderer can decide tail / gap / separator.

**Step 2-5 — TDD.**

**Step 6 — Commit.**

---

### Task 3.4: `<PhotoBubble>` — inline photo grid in messages

**Skills:** `custom-skills:interface-design`, `frontend-design`

**Files:**
- Create: `src/components/ops/inbox/photo-bubble.tsx`
- Tests: `__tests__/photo-bubble.test.tsx`

**Reference:** `reference/v4-detail.jsx` `V4PhotoBubble`.

**Spec:** Inbound or outbound, photo grid is inside the bubble (above body if any). Grid `grid-cols-1 / 2 / 3` based on photo count, max-w 360px, gap `4px`. Each photo cell `aspect-square` with `rounded-[6px] border border-line`. Click → opens lightbox (out of scope for this task — fire `onPhotoClick(photo, index)` prop only).

Below grid: optional body bubble + meta row with `n photo(s)` indicator.

**Step 1 — Test for grid layout selection (1/2/3 column).**

**Step 2-5 — TDD + visual check.**

---

## Phase 4 — Composer

### Task 4.1: `<Composer>` base — textarea, send button, attach affordances

**Skills:** `custom-skills:interface-design`, `frontend-design`, `ops-copywriter`, `animation-studio:web-animations`

**Files:**
- Create: `src/components/ops/inbox/composer/composer.tsx`
- Create: `src/components/ops/inbox/composer/composer-input.tsx`
- Tests: `__tests__/composer.test.tsx`
- Modify: `src/i18n/dictionaries/{en,es}/inbox.json`

**Reference:** `reference/v4-detail.jsx` `V4Composer` (empty state portion).

**Spec:**
- Container: `bg-inbox-panel border-t border-line` fixed at the bottom of detail.
- Inner box: `bg-inbox-bg-deep border border-line-hi rounded-[6px] padding-[10px 12px] min-h-[84px]` flex column.
- Textarea: `font-mohave 13px leading-[1.55] text-text tracking-[-0.003em]` placeholder `text-muted`. Auto-grow to max 200px before scrolling.
- Action row at bottom: 26×26 ghost buttons for `paperclip`, `image`, `sparkles`, `calendar`. `text-text-3 hover:text-text-2`.
- Send button (primary, right-aligned): outlined `border-ops-accent text-ops-accent` at rest, fills to `bg-ops-accent text-black` on hover. `font-cakemono font-light uppercase tracking-[0.14em] 11px` content "SEND" + Lucide `send` 11px.
- **`Cmd+Enter` sends.**

**Focus ring:** `0 0 0 1px rgba(111,148,176,0.4)` on the inner box when textarea is focused — the only allowed shadow in the inbox per the brand config.

**Step 1 — Test.** Focus, paste, Cmd+Enter, send-button click.

**Step 2-5 — TDD.**

**Step 6 — Commit.**

---

### Task 4.2: Draft switcher chip strip + AI-loaded state

**Skills:** `custom-skills:interface-design`, `frontend-design`, `ops-copywriter`

**Files:**
- Create: `src/components/ops/inbox/composer/draft-switcher.tsx`
- Modify: `src/components/ops/inbox/composer/composer.tsx`
- Tests: `__tests__/draft-switcher.test.tsx`

**Reference:** `reference/v4-detail.jsx` `V4DraftSwitcher` + handoff "Composer states" table.

**Draft sources:** `"yours" | "claude" | "gmail" | "outlook"`. Each has icon (sparkles for claude, user for yours, mail for gmail/outlook) and a label.

**Chip strip:** Above the input. `bg-white/2 border-b border-line padding-[8px 10px]`. Section label `// DRAFTS` (Cake Mono 9.5px). Then segmented control of chips, each 22px tall, padding `0 9px`, `font-mohave 11.5px`. Active chip: `bg-inbox-panel border-line-hi text-text` (or `border-agent-border-hi` if active is Claude). Inactive: transparent border, `text-text-3`.

**AI-loaded composer state** (active chip is Claude, body unchanged):
- Inner box border becomes `border-agent-border-hi`.
- Body renders in `text-agent-text`.
- A small banner above the textarea: lavender Sparkles + `font-cakemono font-light 10px text-agent-hi` "CLAUDE DRAFTED THIS · review" + `font-mono 9.5px text-muted` timestamp.
- Send button changes to filled lavender: `border-agent bg-agent/18 text-agent-hi`. Content: "SEND AI DRAFT" (Cake Mono Light).
- An additional 28px ghost "Edit" button appears to the left of send.

**Step 1-5 — TDD.**

**Step 6 — Commit.**

---

### Task 4.3: Edited-from-Claude state + edit toolbar

**Skills:** `custom-skills:interface-design`, `frontend-design`, `ops-copywriter`

**Files:**
- Create: `src/components/ops/inbox/composer/edit-toolbar.tsx`
- Modify: `src/components/ops/inbox/composer/composer.tsx`
- Create: `src/lib/inbox/draft-state.ts` (pure state machine)
- Tests: `tests/unit/inbox/draft-state.test.ts`, `__tests__/edit-toolbar.test.tsx`

**State machine** (`draft-state.ts`):

```ts
type DraftState = "empty" | "drafts-available" | "ai-loaded" | "edited-from-claude" | "user-typed";

export function nextDraftState(prev: DraftState, event: DraftEvent): DraftState { ... }
```

Events: `LOAD_DRAFT(source)`, `EDIT_BODY(diff)`, `REVERT`, `CLEAR`, `SEND`, `RECEIVE_DRAFTS(n)`.

Rules (from handoff "Composer states"):
- `empty` + `RECEIVE_DRAFTS(>0)` → `drafts-available`
- `drafts-available` + `LOAD_DRAFT("claude")` → `ai-loaded`
- `ai-loaded` + `EDIT_BODY` → `edited-from-claude`
- `edited-from-claude` + `REVERT` → `ai-loaded`
- `edited-from-claude` + `LOAD_DRAFT(other)` → confirm dialog: "Discard changes?" — if yes, transition to that other state.
- `*` + `SEND` → `empty`

**Edit toolbar** appears below the input box when `state === "edited-from-claude"`:
- `bg-white/2 border border-dashed border-line rounded-[4px] padding-[6px 10px] mt-[8px]`.
- Content: pencil icon + `font-mono 10.5px text-text-3` "edited from Claude's draft" + `+{n}` (olive) `−{m}` (rose) added/removed counts + `See changes`/`Revert`/`Regenerate` buttons.
- Send button regresses to default accent.

**Step 1 — Test the state machine** with all transitions, including the discard-confirmation branch.

**Step 2-5 — TDD.**

**Step 6 — Commit.**

---

## Phase 5 — Right Rail Context Tabs

### Task 5.1: `<ContextRail>` aside + tab strip

**Skills:** `custom-skills:interface-design`, `frontend-design`, `animation-studio:web-animations`, `ops-copywriter`

**Files:**
- Create: `src/components/ops/inbox/context-rail/context-rail.tsx`
- Create: `src/components/ops/inbox/context-rail/tab-strip.tsx`
- Tests: `__tests__/context-rail.test.tsx`
- Modify: `src/i18n/dictionaries/{en,es}/inbox.json`

**Reference:** `reference/v4-context-tabs.jsx` `CtxPanel_TabsRefined`.

**Tab strip (~38px, `bg-inbox-panel border-b border-line`):** equal flex tabs `Projects · Pipeline · Files`. Active tab: `text-text` with 2px `bg-ops-accent` underline. Inactive: `text-text-3`. Hover: `text-text-2`. `font-mohave 11.5px tracking-[0.2em]` (yes — wider tracking than spec norm because handoff specifies "letter-spacing: 0.2"). Each tab includes a count: `font-mono 10px tabular-nums text-muted`.

**Default tab on every thread open:** Projects. Tab state is component-local — does NOT persist across thread switches. Re-mounts to Projects on `threadId` change.

**Body:** `flex-1 overflow-y-auto padding-[12px]`.

**Header above tab strip:** Client mini-header with name + tier + "open record" external icon. ~52px.

**Step 1-5 — TDD + visual.**

**Step 6 — Commit.**

---

### Task 5.2: `<ProjectCard>` with tasks + accounting

**Skills:** `custom-skills:interface-design`, `frontend-design`, `ops-copywriter`

**Files:**
- Create: `src/components/ops/inbox/context-rail/project-card.tsx`
- Create: `src/components/ops/inbox/context-rail/status-pip.tsx`
- Create: `src/components/ops/inbox/context-rail/accounting-bar.tsx`
- Tests: `__tests__/project-card.test.tsx`

**Reference:** `reference/v4-context-tabs.jsx` `ProjectCard` + handoff "Projects tab data contract".

**Spec — collapsed:** chevron-right + title (`font-mohave 12.5px text-text tracking-[-0.003em]`) + `<StatusPip>` + value (mono right-aligned) + tasks-done counter (`{done}/{total}` in `font-mono 9.5px text-muted`). 10px vertical padding.

**Spec — expanded:** stage / dates / lead row (`font-mono 10px text-text-3`) → "// SCOPE" section → task list → "// ACCOUNTING" section → mini progress bar + invoice/estimate rows → "Open project" ghost button (links via `?project=:id` URL param).

**Status pip mapping** (`statusPipFor(status)`):
- `On site` → accent dot
- `Quoted` → muted
- `Awaiting acceptance` → warn (tan)
- `Done` → olive
- `Paid` → olive
- `Scheduled` → muted

**First card auto-opens** (`defaultOpen={i === 0}`).

**Accounting progress bar:** 4px tall, rounded-full. Stack: olive `paid/total`, then warn at 0.7 opacity for `(invoiced - paid)/total`. Background `bg-inbox-bg-deep`.

**Step 1-5 — TDD.**

**Step 6 — Commit.**

---

### Task 5.3: `<PipelineList>` — stage groups + "This thread" indicator

**Skills:** `custom-skills:interface-design`, `frontend-design`, `ops-copywriter`

**Files:**
- Create: `src/components/ops/inbox/context-rail/pipeline-list.tsx`
- Tests: `__tests__/pipeline-list.test.tsx`

**Reference:** `reference/v4-context-tabs.jsx` `PipelineList`.

**Spec:** Group opps by stage (`Lead → Discovery → RFQ in → Quoted`, then any others). Each opp card: title + value (mono right) + meta row (estimate ref, confidence, source). Linked-to-current-thread opps get a 2px `bg-ops-accent` left bar via `box-shadow: inset 2px 0 0 var(--ops-accent)` AND a "↗ This thread" tag in `text-ops-accent` with link icon.

`+ New opportunity` ghost dashed-border button at bottom — wires to `onNewOpportunity()` callback (parent decides routing).

**Step 1-5 — TDD.**

**Step 6 — Commit.**

---

### Task 5.4: `<FilesView>` — photos grid + documents list

**Skills:** `custom-skills:interface-design`, `frontend-design`

**Files:**
- Create: `src/components/ops/inbox/context-rail/files-view.tsx`
- Tests: `__tests__/files-view.test.tsx`

**Reference:** `reference/v4-context-tabs.jsx` `FilesView`.

**Photos:** `// IMAGES · {count}` section label, then 3-col `aspect-square` grid with 4px gap. Hover surfaces filename overlay (`bg-black/45` + `font-mono 8.5px tracking-[0.3em] text-white/85`). Click → `onPhotoOpen(file)`.

**Documents:** `// DOCUMENTS · {count}` then compact rows: 26×26 file icon thumbnail + name (`font-mohave 12px text-text-2`) + size/date (`font-mono 9.5px text-muted`). `bg-inbox-panel border border-line rounded-[5px] padding-[8px 10px] gap-[9px]`.

**Step 1-5 — TDD.**

**Step 6 — Commit.**

---

## Phase 6 — Resizers + Responsive

### Task 6.1: `react-resizable-panels` integration + persistence

**Skills:** `frontend-design`, `animation-studio:web-animations`

**Files:**
- Modify: `src/components/ops/inbox/inbox-shell.tsx`
- Create: `src/stores/inbox-layout-store.ts` (Zustand, persisted to localStorage)
- Tests: `__tests__/inbox-layout-store.test.ts`

**Spec:**
- Wrap left + center + right in `<PanelGroup direction="horizontal" autoSaveId="inbox">` from `react-resizable-panels`.
- Left panel: `defaultSize={22}` (% of container), `minSize={20}`, `maxSize={30}`. Convert to px via `react-resizable-panels` API.
- Right panel: `defaultSize={22}`, `minSize={20}`, `maxSize={28}`.
- `<PanelResizeHandle>` with a 4px-wide invisible hit area, hover surfaces a 1px `bg-line-hi` line. **Double-click** resets to default — wire via `onDoubleClick` on the handle.
- `autoSaveId` lets the lib persist widths automatically. Wrap with custom Zustand store as well so we can reset programmatically.

**Step 1 — Test the Zustand store** persistence shape.
**Step 2-5 — TDD + visual drag-resize check.**
**Step 6 — Commit.**

---

### Task 6.2: Responsive collapses (≥1600 / 1280–1599 / <1280 / <768)

**Skills:** `custom-skills:interface-design`, `custom-skills:mobile-ux-design`, `frontend-design`, `animation-studio:web-animations`

**Files:**
- Modify: `src/components/ops/inbox/inbox-shell.tsx`
- Create: `src/components/ops/inbox/mobile-stacked-shell.tsx` (single-pane router for <768)
- Tests: `__tests__/responsive-shell.test.tsx`

**Breakpoints:**
- `≥1600px` — all three columns visible by default; right rail open.
- `1280–1599px` — three columns, but right rail **closed** by default; toggle in detail header re-opens it.
- `<1280px` — right rail becomes overlay drawer (slide in from right, 180ms, `bg-inbox-bg-deep`, full height, 360px width, dim backdrop). Left column stays as a column.
- `<768px` — single-pane router pattern: list view → detail view → context view. Each is full-screen. Back navigation via header back-arrow + browser history. Match the existing OPS-Web mobile pattern (discover via `rg "useMediaQuery" src/components/`).

**Animation:** Right rail open/close uses Framer Motion `width` interpolation 0 → 360, 180ms, `EASE_SMOOTH`. Reduced motion: opacity-only fade.

**Step 1-5 — TDD.**

**Step 6 — Commit.**

---

## Phase 7 — Data + Routing

### Task 7.1: TanStack Query hooks for client-scoped context

**Skills:** `frontend-design` (data layer)

**Files:**
- Create: `src/lib/hooks/use-client-projects.ts`
- Create: `src/lib/hooks/use-client-opportunities.ts`
- Create: `src/lib/hooks/use-client-files.ts`
- Modify: `src/lib/api/query-client.ts` (add query keys)
- Modify: `src/lib/api/services/` (add corresponding service methods if missing — discover with `rg "client_id" src/lib/api/services/`)
- Tests: `tests/unit/hooks/use-client-projects.test.ts` (mocked Supabase client)

**Discovery first.** Run:
```bash
rg "client.*projects" src/lib/api/services/
rg "useThread\b" src/lib/hooks/
```
This shows what already exists. Re-use existing services where they exist; do not duplicate.

**Hook signature pattern** (matches existing OPS-Web TanStack Query conventions):

```ts
export function useClientProjects(clientId: string | null | undefined) {
  return useQuery({
    queryKey: ["client", clientId, "projects"],
    enabled: !!clientId,
    queryFn: async () => {
      if (!clientId) return [];
      return ProjectService.listByClient(clientId);
    },
  });
}
```

**Step 1 — Mock-Supabase test** for happy path + null client.
**Step 2-5 — TDD.**
**Step 6 — Commit.**

---

### Task 7.2: Routing — `/inbox/:threadId`, prev/next, ⌘+Enter, ⌘+K

**Skills:** `frontend-design`

**Files:**
- Modify: `src/app/(dashboard)/inbox/[threadId]/page.tsx` (create if missing)
- Modify: `src/components/ops/inbox/thread-detail-header.tsx` (wire prev/next from grouping)
- Create: `src/components/ops/inbox/use-thread-keyboard.ts` (J/K/⌘Enter/⌘K hooks)

**Spec:**
- `/inbox` shows the list with no thread selected (or auto-selects first if any).
- `/inbox/:threadId` selects the thread; URL is the source of truth for `selectedThreadId`.
- `J` / `K` move to next/prev within current grouping (call `useNextPrevThread(currentId, groups)`).
- `⌘+Enter` in composer → send.
- `⌘+K` opens command palette (existing in shell — verify with `rg "CommandPalette" src/`).

**Step 1 — Test thread navigation hook** with synthetic group structure.
**Step 2-5 — TDD.**
**Step 6 — Commit.**

---

## Phase 8 — Motion Polish + Accessibility

### Task 8.1: Rail transitions, composer fade, milestone olive pulse

**Skills:** `animation-studio:animation-architect` → `animation-studio:web-animations`

**Files:**
- Modify: `src/lib/utils/motion.ts` (add inbox-specific variants)
- Modify: `src/components/ops/inbox/inbox-shell.tsx` (right-rail open/close)
- Modify: `src/components/ops/inbox/composer/composer.tsx` (body fade between draft loads)
- Create: `src/components/ops/inbox/milestone-pulse.tsx` (wrapper component)

**New variants in `motion.ts`:**

```ts
// 180ms width slide for right rail
export const inboxRailVariants: Variants = {
  open:   { width: 360, opacity: 1, transition: { duration: 0.18, ease: EASE_SMOOTH } },
  closed: { width: 0,   opacity: 0, transition: { duration: 0.18, ease: EASE_SMOOTH } },
};

// 120ms crossfade for composer body when draft swaps
export const composerBodyFadeVariants: Variants = {
  hidden:  { opacity: 0, transition: { duration: 0.12, ease: EASE_SMOOTH } },
  visible: { opacity: 1, transition: { duration: 0.12, ease: EASE_SMOOTH } },
};

// 200ms olive milestone pulse — fires once on key={trigger} change
export const milestonePulseVariants: Variants = {
  initial:   { boxShadow: "0 0 0 0 rgba(157, 181, 130, 0)" },
  pulse: {
    boxShadow: [
      "0 0 0 0 rgba(157, 181, 130, 0)",
      "0 0 0 4px rgba(157, 181, 130, 0.55)",
      "0 0 0 0 rgba(157, 181, 130, 0)",
    ],
    transition: { duration: 0.20, ease: EASE_SMOOTH, times: [0, 0.5, 1] },
  },
};
```

**Milestone wrapper:** `<MilestonePulse trigger={status}>` re-runs the pulse animation whenever `trigger` changes from a non-milestone to a milestone state. Used on `<ProjectCard>` (when status flips to "Done"), `<EstimateRow>` (status flips to "accepted"), `<InvoiceRow>` (status flips to "paid"), and the `<ThreadRow>` that just got marked closed.

**Step 1 — Test milestone-pulse fires** by passing controlled `trigger` prop and asserting `motion.div` `animate` cycles.
**Step 2-5 — TDD + visual smoke.**
**Step 6 — Commit.**

---

### Task 8.2: Reduced motion sweep

**Skills:** `animation-studio:web-animations`, `frontend-design`

**Files:**
- Modify: every `framer-motion` usage in `src/components/ops/inbox/**`
- Modify: `src/lib/utils/motion.ts` — export a `useReducedInboxMotion()` helper that returns simplified variants.

**Sweep rule:** every `motion.*` instance must read `useReducedMotion()` from `framer-motion` and substitute opacity-only variants when reduced motion is preferred. The OLIVE PULSE becomes a single 150ms opacity flash from 1.0 → 0.85 → 1.0. The width-slide rail becomes opacity 0 → 1 with `display: none` toggle.

**Test approach:** add a `__tests__/reduced-motion.test.tsx` that mocks `useReducedMotion(true)` and asserts simplified variants are selected.

**Step 1-5 — TDD.**

**Step 6 — Commit:**
```bash
git commit -m "feat(inbox): reduced-motion fallbacks across all inbox motion"
```

---

## Phase 9 — Copy + Cleanup + Verification

### Task 9.1: i18n pass — extract every string into `inbox.json`

**Skills:** `ops-copywriter`

**Files:**
- Modify: `src/i18n/dictionaries/en/inbox.json`
- Modify: `src/i18n/dictionaries/es/inbox.json`
- Modify: every component touched in Phases 2–5 to use `useDictionary("inbox")`.

**Process:**

1. `rg -n '"[A-Z]' src/components/ops/inbox/ | rg -v 'i18n' | rg -v 'test'` — surface every literal string still in components.
2. Move each into `inbox.json` under a clear namespace (`todayBar`, `groups`, `bands.summary`, `composer`, etc.).
3. Replace literals with `t("path") ?? "English fallback"`.
4. Spanish: best-effort translate; ops-copywriter pass for Spanish tactical voice.
5. Confirm zero remaining string literals via the same `rg` query.

**Step 1 — Verification command:**
```bash
rg -n '"[A-Z][a-z]+ [a-z]' src/components/ops/inbox/ | rg -v dictionaries | rg -v 'test'
```
Expected: zero hits.

**Step 6 — Commit:**
```bash
git commit -m "feat(inbox): i18n pass — all inbox strings via inbox.json dictionary"
```

---

### Task 9.2: Cleanup deletions

**Skills:** `frontend-design`

**Files:**
- Delete: `src/components/ops/inbox/split-inbox-tabs.tsx` (four-rail tabs)
- Delete: `src/components/ops/inbox/category-filter-chips.tsx` (chip strip)
- Delete: `src/components/ops/inbox/thread-commitment-strip.tsx` (replaced by `<TodayBar>`)
- Delete: `src/components/ops/inbox/thread-sibling-strip.tsx` (replaced by header prev/next + J/K)
- Delete: `src/components/ops/inbox/empty-status-*.tsx` (5 files — replaced by band system + per-tab empty states)
- Delete: `src/components/ops/inbox/phase-c-status-strip.tsx` (collapsed into `<DetailBand>`)
- Modify: `src/components/ops/inbox/category-chip.tsx` (keep — only used in detail header subtitle now; trim unused props)
- Modify: any consumer importing the deleted files (find via `rg "from .*split-inbox-tabs" src/`)

**Process:**
1. `rg "split-inbox-tabs|category-filter-chips|thread-commitment-strip|thread-sibling-strip|empty-status-|phase-c-status-strip" src/` — list every consumer.
2. Replace consumer imports with new equivalents (or delete the parent feature if appropriate — verify with the user before deleting any non-inbox file).
3. `rm` the inbox files.
4. `npm run type-check` — must pass clean.
5. `npm run test -- --run` — must pass clean.

**Step 6 — Commit:**
```bash
git commit -m "chore(inbox): remove obsolete components (split-tabs, filter-chips, sibling-strip, empty-status-*, phase-c-strip)"
```

---

### Task 9.3: Final audit + smoke test + screenshots

**Skills:** `custom-skills:audit-design-system`, `superpowers:verification-before-completion`

**Files:**
- Create: `tests/e2e/inbox-redesign.spec.ts` (Playwright golden path)
- Create: `docs/plans/2026-05-06-inbox-redesign-screenshots/` (after/before pairs)

**Verification checklist (do all in order):**

1. `npm run type-check` → zero errors.
2. `npm run test -- --run` → zero failures.
3. Run `audit-design-system`:
   ```
   /audit-design-system src/components/ops/inbox/
   ```
   Expected: zero hardcoded hex / spacing / radius / font values; every styling decision traces to a token.
4. Manual smoke (dev server):
   - Open `/inbox`. Confirm three columns, dark, hairline borders, no shadows.
   - Click any row → detail loads. Confirm correct band kind for that thread's `phaseC` + `agent.needsInput`.
   - If thread has `phaseC === "ai_drafted"`: confirm AI-loaded composer + lavender send button + "Edit" affordance.
   - Edit the body → confirm transition to edited state, neutral text, accent send button, edit toolbar visible with `+/−` deltas.
   - Click "Revert" → confirm return to AI-loaded state.
   - Switch threads via `J`/`K` → confirm right-rail tab resets to "Projects".
   - Open Pipeline → confirm "This thread" indicator on linked opps.
   - Open Files → confirm 3-col photo grid + doc list.
   - Drag the resizer → confirm width persists across reload.
   - Toggle right rail closed → confirm 180ms slide, persisted.
   - At viewport <1280: rail becomes overlay drawer.
   - At viewport <768: stacked single-pane router works.
   - Set OS reduced motion ON → re-run all of the above; confirm opacity-only fallbacks.
5. Playwright golden-path:

   ```ts
   // tests/e2e/inbox-redesign.spec.ts
   import { test, expect } from "@playwright/test";

   test("inbox golden path: open → switch → draft → send", async ({ page }) => {
     await page.goto("/inbox");
     await expect(page.getByRole("complementary", { name: "Thread list" })).toBeVisible();
     await page.getByRole("button", { name: /calloway/i }).first().click();
     await expect(page.url()).toMatch(/\/inbox\/[a-z0-9-]+/);
     // ...exercise drafts, send, prev/next, etc.
   });
   ```

6. Screenshots: capture each artboard scenario from `Inbox - Final.html` as a Playwright screenshot. Store under `docs/plans/2026-05-06-inbox-redesign-screenshots/after-{n}.png`. Compare side-by-side with the original handoff HTML rendered in a browser; differences must be deliberate (production data shape) only.

7. **Final commit + PR.**
   ```bash
   git add .
   git commit -m "test(inbox): golden-path Playwright + audit-design-system clean"
   git push origin feat/inbox-redesign
   gh pr create --title "feat(inbox): redesign — three-column, agent provenance, calm motion" --body "$(cat <<'EOF'
   ## Summary
   - Three-column inbox shell (thread feed · iMessage detail · context tabs)
   - Agent lavender provenance scale (`agent.*` tokens) — Claude-authored only
   - Detail bands: summary / needs-input / ball-yours / auto-sent / closed
   - Composer state machine: empty → drafts → AI-loaded → edited
   - Right rail tabs: Projects / Pipeline / Files (default Projects, no persistence)
   - Resizable columns with localStorage persistence; mobile drawer + stacked-pane router
   - Motion: 180ms rail / 120ms composer / 200ms olive milestone pulse, all on `EASE_SMOOTH`
   - Reduced-motion fallbacks across the board
   - i18n pass — every string in `inbox.json`
   - Removed: `split-inbox-tabs`, `category-filter-chips`, `thread-commitment-strip`, `thread-sibling-strip`, `empty-status-*`, `phase-c-status-strip`

   ## Test plan
   - [x] `npm run type-check`
   - [x] `npm run test -- --run`
   - [x] `audit-design-system src/components/ops/inbox/`
   - [x] Manual smoke: golden path + every band kind + composer state machine + resize + responsive + reduced motion
   - [x] Playwright golden path: `tests/e2e/inbox-redesign.spec.ts`
   - [x] Screenshots vs. handoff HTML — pixel-faithful where production data allows

   🤖 Generated with [Claude Code](https://claude.com/claude-code)
   EOF
   )"
   ```

---

## Done definition

- All 25 tasks complete with their commits.
- `npm run type-check` clean.
- `npm run test -- --run` green.
- `audit-design-system src/components/ops/inbox/` zero violations.
- Every artboard scenario from `Inbox - Final.html` reproduces in production with real data.
- Playwright golden path passes.
- Screenshots captured; PR open with summary + test plan.
- Worktree merged or PR mergeable; obsolete files removed.

If anything in the spec is ambiguous mid-implementation, the canonical answer is in `~/Downloads/design_handoff_inbox_redesign/Inbox - Final.html` or `Tabs Refined.html`. If it's not in either of those, it's not designed yet — flag back to the user before improvising.
