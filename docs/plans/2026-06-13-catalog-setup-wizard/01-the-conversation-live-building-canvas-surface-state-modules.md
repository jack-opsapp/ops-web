## Phase 1: The Conversation + Live-Building Canvas (surface, state, modules)

**Goal.** Stand up the wizard's deterministic, resumable foundation: a pure staging-card model + reducer/state-machine (heavily TDD'd), a persisted Zustand store that survives refresh, the full-page two-pane shell (driver pane + live-building canvas), accept/edit/reject card components, a bespoke neutral-fill module rail (SELL → STOCK → TYPES → REVIEW), and the mandatory motion. Every source (import/agent/template/manual) feeds ONE canvas — so the operator never sees "products vs catalog items," only their stuff taking shape (spec §5, §7, §8). No commit, no agent calls, no schema in this phase.

**Skills.** `interface-design` + `frontend-design` (shell, panes, cards, rail); `elite-animations` → `animation-architect` then `web-animations` (all motion); `ops-copywriter` (every visible string — first-run headline, card-state labels, totals, BUILD IT); `audit-design-system` (done-gate on every UI task); `wireframe` (stepper + card mock before code, spec §13). Reducer/state-machine tasks are pure logic — TDD only, no UI skill.

**Design tokens (cite, never hardcode).** Canvas pure `#000`; surfaces `.glass-surface` (panes/cards), `.glass-dense` (any nested modal/popover) — DESIGN.md §Backgrounds. Titles `font-cakemono font-light` UPPERCASE 28–32px (DESIGN.md "wizard titles"); body `font-mohave` sentence case; all numbers/totals/prices `font-mono` tabular-lining slashed-zero (`text-text` + tnum/zero). Text ladder `text-text` / `text-text-2` / `text-text-3` / `text-text-mute` (decorative only). Accent `ops-accent #6F94B0` ONLY on the single BUILD IT primary CTA + focus rings — **never on the module rail/stepper** (DESIGN.md §85-87, spec §7, §13). Earth semantics: `olive #9DB582` (accepted/added/positive), `tan #C4A868` (review/attention), `rose #B58289` (reject/cost) — border + muted-fill only. Controls 36px (`h-9`) / radius 5 (`rounded-[5px]`) for buttons, chips radius 4 (`rounded-sm`) — no touch targets (DESIGN.md §301-307). Icons `lucide-react` only. Empty/zero = `—` or `$0`, never "N/A". Motion: one curve `EASE_SMOOTH` = `[0.22,1,0.36,1]` from `@/lib/utils/motion`; step x-slide ~250ms; card-accept = brief olive confirm; running totals count-up; every animation honors `prefers-reduced-motion` (150ms opacity fallback) — DESIGN.md §262-276.

---

### Task 1.1: Staging-card data model (types only)

Pure TypeScript model for the in-memory canvas. Self-contained (no import of the overhaul-branch `catalog.ts`) so Phase 1 compiles standalone; field names mirror the live tables per spec §9 (align to real `catalog.ts` after the rebase — see confirmations).

**Skills:** none (pure types).
**Files:**
- Create `src/lib/catalog-setup/staging-types.ts`
**Design tokens:** n/a (no UI).

Steps:

1. Write the types file. No test yet (types are exercised by the reducer suite in 1.2). Complete content:

```ts
// src/lib/catalog-setup/staging-types.ts
// Pure, framework-free model for the catalog-setup live-building canvas.
// Every source (import / agent / template / manual) produces StagingCards;
// the canvas renders one surface so the operator never sees the
// products-vs-catalog-items table split (spec §5, §7, §8).

/** Which module a card belongs to (spec §5, §9). */
export type ModuleKey = "sell" | "stock" | "types";

/** Where a card originated (spec §8 sources table). */
export type CardSource = "import" | "agent" | "template" | "manual";

/**
 * Lifecycle of a single staged row.
 * - proposed: surfaced, not yet acted on (default for import/agent/template)
 * - accepted: owner accepted as-is → counts toward "added"
 * - edited:   owner changed fields then accepted → counts toward "added"
 * - rejected: owner dismissed → never committed
 * - merge:    matched an existing catalog row; resolves into the live row on commit (spec §11 dedupe)
 */
export type CardState = "proposed" | "accepted" | "edited" | "rejected" | "merge";

/** A card whose owner accept/edit/merge action will be committed (spec §11). */
export const COMMITTABLE_STATES: readonly CardState[] = ["accepted", "edited", "merge"];

/** SELL → products (spec §9 SELL). default_price maps to products.base_price. */
export interface SellFields {
  name: string;
  description?: string;
  /** products.base_price (the spec calls the input "default_price") */
  defaultPrice: number | null;
  unitCost: number | null;
  sku?: string;
  isTaxable: boolean;
  kind: "service" | "material" | "package";
  /** estimate type bucket */
  type: "LABOR" | "MATERIAL" | "OTHER";
  pricingUnit?: string;
}

/** STOCK → catalog_items/variants (spec §9 STOCK). */
export interface StockFields {
  name: string;
  sku?: string;
  /** on-hand */
  quantity: number | null;
  unitCost: number | null;
  /** single reorder point — fans into warning + agent-derived critical later */
  reorderPoint: number | null;
  unitId?: string;
}

/** TYPES → trade picker + task_types (spec §9 TYPES). */
export interface TypeFields {
  /** task_types.display, or the trade value when isTrade */
  display: string;
  color?: string;
  isTrade?: boolean;
}

interface BaseCard {
  /** client-supplied stable id — becomes the commit client id (spec §11) */
  id: string;
  source: CardSource;
  state: CardState;
  /** present when this card matched a live catalog row (spec §11 dedupe) */
  matchedExistingId?: string;
}

export type StagingCard =
  | (BaseCard & { module: "sell"; fields: SellFields })
  | (BaseCard & { module: "stock"; fields: StockFields })
  | (BaseCard & { module: "types"; fields: TypeFields });

export type CardFieldsFor<M extends ModuleKey> = Extract<StagingCard, { module: M }>["fields"];

/** Running counters for the canvas header (spec §7 "N proposed · M added"). */
export interface RunningTotals {
  proposed: number;
  /** accepted + edited + merge */
  added: number;
  rejected: number;
}
```

2. Typecheck only: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep staging-types || echo "TYPES OK"`
   Expected: `TYPES OK` (no errors referencing staging-types).
3. Commit: `git add src/lib/catalog-setup/staging-types.ts && git commit -m "feat(catalog-setup): staging-card data model"`

---

### Task 1.2: Pure staging reducer — add / accept / edit / reject

The state machine core. TDD, zero React, zero I/O. This is the heaviest-tested unit in the phase.

**Skills:** none (pure logic, TDD).
**Files:**
- Create `src/lib/catalog-setup/staging-reducer.test.ts`
- Create `src/lib/catalog-setup/staging-reducer.ts`
**Design tokens:** n/a.

Steps:

1. Write the failing test first:

```ts
// src/lib/catalog-setup/staging-reducer.test.ts
import { describe, it, expect } from "vitest";
import { stagingReducer, initialStagingState, type StagingAction } from "./staging-reducer";
import type { StagingCard } from "./staging-types";

function sellCard(id: string, over: Partial<StagingCard> = {}): StagingCard {
  return {
    id, source: "manual", state: "proposed", module: "sell",
    fields: { name: "Tear-off", defaultPrice: 100, unitCost: 40, isTaxable: true, kind: "service", type: "LABOR" },
    ...over,
  } as StagingCard;
}

describe("stagingReducer", () => {
  it("starts empty", () => {
    expect(initialStagingState.cards).toEqual([]);
  });

  it("ADD_CARDS appends proposed cards", () => {
    const s = stagingReducer(initialStagingState, { type: "ADD_CARDS", cards: [sellCard("a"), sellCard("b")] });
    expect(s.cards.map((c) => c.id)).toEqual(["a", "b"]);
    expect(s.cards.every((c) => c.state === "proposed")).toBe(true);
  });

  it("ADD_CARDS is idempotent by id (re-adding does not duplicate)", () => {
    let s = stagingReducer(initialStagingState, { type: "ADD_CARDS", cards: [sellCard("a")] });
    s = stagingReducer(s, { type: "ADD_CARDS", cards: [sellCard("a")] });
    expect(s.cards).toHaveLength(1);
  });

  it("ACCEPT_CARD flips state to accepted", () => {
    let s = stagingReducer(initialStagingState, { type: "ADD_CARDS", cards: [sellCard("a")] });
    s = stagingReducer(s, { type: "ACCEPT_CARD", id: "a" });
    expect(s.cards[0].state).toBe("accepted");
  });

  it("EDIT_CARD merges fields and sets state to edited", () => {
    let s = stagingReducer(initialStagingState, { type: "ADD_CARDS", cards: [sellCard("a")] });
    s = stagingReducer(s, { type: "EDIT_CARD", id: "a", fields: { defaultPrice: 250 } });
    const card = s.cards[0];
    expect(card.state).toBe("edited");
    expect(card.module === "sell" && card.fields.defaultPrice).toBe(250);
    expect(card.module === "sell" && card.fields.name).toBe("Tear-off");
  });

  it("REJECT_CARD flips state to rejected (kept in list for undo)", () => {
    let s = stagingReducer(initialStagingState, { type: "ADD_CARDS", cards: [sellCard("a")] });
    s = stagingReducer(s, { type: "REJECT_CARD", id: "a" });
    expect(s.cards[0].state).toBe("rejected");
  });

  it("an action on an unknown id is a no-op (returns same state ref)", () => {
    const s0 = stagingReducer(initialStagingState, { type: "ADD_CARDS", cards: [sellCard("a")] });
    const s1 = stagingReducer(s0, { type: "ACCEPT_CARD", id: "nope" });
    expect(s1).toBe(s0);
  });
});
```

2. Run, watch it fail: `npx vitest run src/lib/catalog-setup/staging-reducer.test.ts`
   Expected: fails — `Cannot find module './staging-reducer'`.
3. Minimal implementation:

```ts
// src/lib/catalog-setup/staging-reducer.ts
import type { StagingCard, CardFieldsFor, ModuleKey } from "./staging-types";

export interface StagingState {
  cards: StagingCard[];
}

export const initialStagingState: StagingState = { cards: [] };

export type StagingAction =
  | { type: "ADD_CARDS"; cards: StagingCard[] }
  | { type: "ACCEPT_CARD"; id: string }
  | { type: "EDIT_CARD"; id: string; fields: Partial<CardFieldsFor<ModuleKey>> }
  | { type: "REJECT_CARD"; id: string }
  | { type: "MERGE_CARD"; id: string; matchedExistingId: string }
  | { type: "RESET" };

function mapCard(state: StagingState, id: string, fn: (c: StagingCard) => StagingCard): StagingState {
  const idx = state.cards.findIndex((c) => c.id === id);
  if (idx === -1) return state; // no-op, same ref
  const next = state.cards.slice();
  next[idx] = fn(state.cards[idx]);
  return { ...state, cards: next };
}

export function stagingReducer(state: StagingState, action: StagingAction): StagingState {
  switch (action.type) {
    case "ADD_CARDS": {
      const existing = new Set(state.cards.map((c) => c.id));
      const fresh = action.cards.filter((c) => !existing.has(c.id));
      if (fresh.length === 0) return state;
      return { ...state, cards: [...state.cards, ...fresh] };
    }
    case "ACCEPT_CARD":
      return mapCard(state, action.id, (c) => ({ ...c, state: "accepted" }));
    case "EDIT_CARD":
      return mapCard(state, action.id, (c) => ({ ...c, state: "edited", fields: { ...c.fields, ...action.fields } } as StagingCard));
    case "REJECT_CARD":
      return mapCard(state, action.id, (c) => ({ ...c, state: "rejected" }));
    case "MERGE_CARD":
      return mapCard(state, action.id, (c) => ({ ...c, state: "merge", matchedExistingId: action.matchedExistingId }));
    case "RESET":
      return initialStagingState;
    default:
      return state;
  }
}
```

4. Run, watch it pass: `npx vitest run src/lib/catalog-setup/staging-reducer.test.ts`
   Expected: all tests pass (8 passing).
5. Commit: `git add src/lib/catalog-setup/staging-reducer.ts src/lib/catalog-setup/staging-reducer.test.ts && git commit -m "feat(catalog-setup): pure staging reducer with add/accept/edit/reject"`

---

### Task 1.3: Merge state + undo + reset on the reducer

Extend the reducer for the dedupe/merge path (spec §11) and undo (re-propose), plus RESET (covered by store reset later).

**Skills:** none (pure logic, TDD).
**Files:**
- Modify `src/lib/catalog-setup/staging-reducer.test.ts`
- Modify `src/lib/catalog-setup/staging-reducer.ts`
**Design tokens:** n/a.

Steps:

1. Append failing tests:

```ts
  it("MERGE_CARD sets state=merge and records matchedExistingId", () => {
    let s = stagingReducer(initialStagingState, { type: "ADD_CARDS", cards: [sellCard("a")] });
    s = stagingReducer(s, { type: "MERGE_CARD", id: "a", matchedExistingId: "live-123" });
    expect(s.cards[0].state).toBe("merge");
    expect(s.cards[0].matchedExistingId).toBe("live-123");
  });

  it("UNRESOLVE_CARD returns a rejected card to proposed (undo)", () => {
    let s = stagingReducer(initialStagingState, { type: "ADD_CARDS", cards: [sellCard("a")] });
    s = stagingReducer(s, { type: "REJECT_CARD", id: "a" });
    s = stagingReducer(s, { type: "UNRESOLVE_CARD", id: "a" });
    expect(s.cards[0].state).toBe("proposed");
  });

  it("RESET clears all cards", () => {
    let s = stagingReducer(initialStagingState, { type: "ADD_CARDS", cards: [sellCard("a"), sellCard("b")] });
    s = stagingReducer(s, { type: "RESET" });
    expect(s.cards).toEqual([]);
  });
```

2. Run, watch UNRESOLVE_CARD fail: `npx vitest run src/lib/catalog-setup/staging-reducer.test.ts`
   Expected: `UNRESOLVE_CARD` test fails (action not handled), others pass.
3. Add the action to the union and switch:

```ts
// in StagingAction union add:
  | { type: "UNRESOLVE_CARD"; id: string }
```
```ts
// in the switch, before default:
    case "UNRESOLVE_CARD":
      return mapCard(state, action.id, (c) => ({ ...c, state: "proposed", matchedExistingId: undefined }));
```

4. Run, watch pass: `npx vitest run src/lib/catalog-setup/staging-reducer.test.ts`
   Expected: all pass (11 passing).
5. Commit: `git add -u && git commit -m "feat(catalog-setup): reducer merge + undo (unresolve) + reset"`

---

### Task 1.4: Reducer selectors — running totals, per-module grouping, blockers

Pure derived data the canvas needs (spec §7 totals, §16 "// 3 ROWS NEED A PRICE" blocker). Kept out of the reducer so they stay cheap, memoizable, and unit-pure.

**Skills:** none (pure logic, TDD).
**Files:**
- Create `src/lib/catalog-setup/selectors.test.ts`
- Create `src/lib/catalog-setup/selectors.ts`
**Design tokens:** n/a.

Steps:

1. Write the failing test:

```ts
// src/lib/catalog-setup/selectors.test.ts
import { describe, it, expect } from "vitest";
import { stagingReducer, initialStagingState } from "./staging-reducer";
import { selectRunningTotals, selectByModule, selectBlockers } from "./selectors";
import type { StagingCard } from "./staging-types";

function sell(id: string, price: number | null): StagingCard {
  return { id, source: "manual", state: "proposed", module: "sell",
    fields: { name: id, defaultPrice: price, unitCost: 0, isTaxable: true, kind: "service", type: "LABOR" } };
}
function typeCard(id: string): StagingCard {
  return { id, source: "manual", state: "proposed", module: "types", fields: { display: id } };
}

describe("selectors", () => {
  it("running totals count proposed and added (accepted+edited+merge), excluding rejected", () => {
    let s = stagingReducer(initialStagingState, { type: "ADD_CARDS", cards: [sell("a", 1), sell("b", 1), sell("c", 1), sell("d", 1)] });
    s = stagingReducer(s, { type: "ACCEPT_CARD", id: "a" });
    s = stagingReducer(s, { type: "EDIT_CARD", id: "b", fields: { defaultPrice: 5 } });
    s = stagingReducer(s, { type: "REJECT_CARD", id: "c" });
    const t = selectRunningTotals(s);
    expect(t).toEqual({ proposed: 1, added: 2, rejected: 1 }); // d still proposed
  });

  it("groups non-rejected cards by module", () => {
    let s = stagingReducer(initialStagingState, { type: "ADD_CARDS", cards: [sell("a", 1), typeCard("t1")] });
    s = stagingReducer(s, { type: "REJECT_CARD", id: "a" });
    const g = selectByModule(s);
    expect(g.sell).toHaveLength(0);
    expect(g.types.map((c) => c.id)).toEqual(["t1"]);
  });

  it("blockers: an accepted/edited SELL card with null price blocks build-it", () => {
    let s = stagingReducer(initialStagingState, { type: "ADD_CARDS", cards: [sell("a", null), sell("b", 100)] });
    s = stagingReducer(s, { type: "ACCEPT_CARD", id: "a" });
    s = stagingReducer(s, { type: "ACCEPT_CARD", id: "b" });
    expect(selectBlockers(s)).toEqual([{ kind: "missing_price", count: 1 }]);
  });

  it("a proposed card with null price does NOT block (only committable cards block)", () => {
    const s = stagingReducer(initialStagingState, { type: "ADD_CARDS", cards: [sell("a", null)] });
    expect(selectBlockers(s)).toEqual([]);
  });
});
```

2. Run, watch fail: `npx vitest run src/lib/catalog-setup/selectors.test.ts`
   Expected: fails — `Cannot find module './selectors'`.
3. Implement:

```ts
// src/lib/catalog-setup/selectors.ts
import type { StagingState } from "./staging-reducer";
import { COMMITTABLE_STATES, type StagingCard, type RunningTotals } from "./staging-types";

const isCommittable = (c: StagingCard) => (COMMITTABLE_STATES as readonly string[]).includes(c.state);

export function selectRunningTotals(state: StagingState): RunningTotals {
  let proposed = 0, added = 0, rejected = 0;
  for (const c of state.cards) {
    if (c.state === "proposed") proposed++;
    else if (c.state === "rejected") rejected++;
    else added++; // accepted | edited | merge
  }
  return { proposed, added, rejected };
}

export function selectByModule(state: StagingState): Record<"sell" | "stock" | "types", StagingCard[]> {
  const out = { sell: [] as StagingCard[], stock: [] as StagingCard[], types: [] as StagingCard[] };
  for (const c of state.cards) {
    if (c.state === "rejected") continue;
    out[c.module].push(c);
  }
  return out;
}

export type Blocker = { kind: "missing_price"; count: number } | { kind: "missing_name"; count: number };

export function selectBlockers(state: StagingState): Blocker[] {
  const blockers: Blocker[] = [];
  const committable = state.cards.filter(isCommittable);
  const missingPrice = committable.filter((c) => c.module === "sell" && (c.fields.defaultPrice === null || c.fields.defaultPrice === undefined)).length;
  if (missingPrice > 0) blockers.push({ kind: "missing_price", count: missingPrice });
  const missingName = committable.filter((c) => !c.fields.name && !(c.module === "types" && c.fields.display)).length;
  if (missingName > 0) blockers.push({ kind: "missing_name", count: missingName });
  return blockers;
}
```

4. Run, watch pass: `npx vitest run src/lib/catalog-setup/selectors.test.ts`
   Expected: all pass (4 passing).
5. Commit: `git add src/lib/catalog-setup/selectors.ts src/lib/catalog-setup/selectors.test.ts && git commit -m "feat(catalog-setup): canvas selectors (totals, grouping, blockers)"`

---

### Task 1.5: Step machine — SELL → STOCK → TYPES → REVIEW with conditional STOCK + permission skip

Pure step/module progression. STOCK is conditional on `inventoryTracked` (spec §6, §9); steps the operator lacks permission for are skipped (spec §16 compound gate). Mirrors iOS `BusinessProfile.setupModules` ordering (spec §3 parity).

**Skills:** none (pure logic, TDD).
**Files:**
- Create `src/lib/catalog-setup/step-machine.test.ts`
- Create `src/lib/catalog-setup/step-machine.ts`
**Design tokens:** n/a.

Steps:

1. Write the failing test:

```ts
// src/lib/catalog-setup/step-machine.test.ts
import { describe, it, expect } from "vitest";
import { buildStepPlan, nextStep, prevStep, type StepContext } from "./step-machine";

const full: StepContext = { inventoryTracked: true, canSell: true, canStock: true, canTypes: true };

describe("step machine", () => {
  it("full plan is sell → stock → types → review", () => {
    expect(buildStepPlan(full)).toEqual(["sell", "stock", "types", "review"]);
  });

  it("omits stock when inventory not tracked", () => {
    expect(buildStepPlan({ ...full, inventoryTracked: false })).toEqual(["sell", "types", "review"]);
  });

  it("omits stock when the operator lacks inventory permission, even if tracked", () => {
    expect(buildStepPlan({ ...full, canStock: false })).toEqual(["sell", "types", "review"]);
  });

  it("review is always present and last", () => {
    const plan = buildStepPlan({ inventoryTracked: false, canSell: false, canStock: false, canTypes: false });
    expect(plan[plan.length - 1]).toBe("review");
  });

  it("nextStep advances along the plan and clamps at review", () => {
    expect(nextStep("sell", full)).toBe("stock");
    expect(nextStep("review", full)).toBe("review");
  });

  it("prevStep retreats and clamps at the first step", () => {
    expect(prevStep("types", full)).toBe("stock");
    expect(prevStep("sell", full)).toBe("sell");
  });

  it("nextStep skips the omitted stock step", () => {
    const ctx = { ...full, inventoryTracked: false };
    expect(nextStep("sell", ctx)).toBe("types");
  });
});
```

2. Run, watch fail: `npx vitest run src/lib/catalog-setup/step-machine.test.ts`
   Expected: fails — module not found.
3. Implement:

```ts
// src/lib/catalog-setup/step-machine.ts
export type WizardStep = "sell" | "stock" | "types" | "review";

export interface StepContext {
  inventoryTracked: boolean;
  canSell: boolean;
  canStock: boolean;
  canTypes: boolean;
}

export function buildStepPlan(ctx: StepContext): WizardStep[] {
  const plan: WizardStep[] = [];
  if (ctx.canSell) plan.push("sell");
  if (ctx.canStock && ctx.inventoryTracked) plan.push("stock");
  if (ctx.canTypes) plan.push("types");
  plan.push("review"); // always present, always last
  return plan;
}

export function nextStep(current: WizardStep, ctx: StepContext): WizardStep {
  const plan = buildStepPlan(ctx);
  const i = plan.indexOf(current);
  if (i === -1) return plan[0];
  return plan[Math.min(i + 1, plan.length - 1)];
}

export function prevStep(current: WizardStep, ctx: StepContext): WizardStep {
  const plan = buildStepPlan(ctx);
  const i = plan.indexOf(current);
  if (i <= 0) return plan[0];
  return plan[i - 1];
}
```

4. Run, watch pass: `npx vitest run src/lib/catalog-setup/step-machine.test.ts`
   Expected: all pass (7 passing).
5. Commit: `git add src/lib/catalog-setup/step-machine.ts src/lib/catalog-setup/step-machine.test.ts && git commit -m "feat(catalog-setup): step machine (conditional stock + permission skip)"`

---

### Task 1.6: Persisted Zustand store wrapping the reducer

Mirrors `src/stores/setup-store.ts`: `persist` middleware, distinct key, `_hydrated` gate, `reset()`. Holds the in-progress canvas across refresh (spec §11 persistence/resume). Wraps the pure reducer so the store stays thin.

**Skills:** none (store logic, TDD).
**Files:**
- Create `src/stores/catalog-setup-store.ts`
- Create `tests/unit/stores/catalog-setup-store.test.ts`
**Design tokens:** n/a.

Steps:

1. Write the failing store test (pattern from `tests/unit/stores/edge-tab-store.test.ts`):

```ts
// tests/unit/stores/catalog-setup-store.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useCatalogSetupStore } from "@/stores/catalog-setup-store";
import type { StagingCard } from "@/lib/catalog-setup/staging-types";

function sell(id: string): StagingCard {
  return { id, source: "manual", state: "proposed", module: "sell",
    fields: { name: id, defaultPrice: 10, unitCost: 0, isTaxable: true, kind: "service", type: "LABOR" } };
}

describe("useCatalogSetupStore", () => {
  beforeEach(() => useCatalogSetupStore.getState().reset());

  it("starts with an empty canvas and step 'sell'", () => {
    expect(useCatalogSetupStore.getState().cards).toEqual([]);
    expect(useCatalogSetupStore.getState().currentStep).toBe("sell");
  });

  it("dispatch ADD_CARDS then ACCEPT_CARD mutates through the reducer", () => {
    const d = useCatalogSetupStore.getState().dispatch;
    d({ type: "ADD_CARDS", cards: [sell("a")] });
    d({ type: "ACCEPT_CARD", id: "a" });
    expect(useCatalogSetupStore.getState().cards[0].state).toBe("accepted");
  });

  it("setStep updates the current step", () => {
    useCatalogSetupStore.getState().setStep("types");
    expect(useCatalogSetupStore.getState().currentStep).toBe("types");
  });

  it("reset clears cards and returns to step 'sell'", () => {
    const d = useCatalogSetupStore.getState().dispatch;
    d({ type: "ADD_CARDS", cards: [sell("a")] });
    useCatalogSetupStore.getState().setStep("review");
    useCatalogSetupStore.getState().reset();
    expect(useCatalogSetupStore.getState().cards).toEqual([]);
    expect(useCatalogSetupStore.getState().currentStep).toBe("sell");
  });

  it("exposes a _hydrated flag", () => {
    expect(typeof useCatalogSetupStore.getState()._hydrated).toBe("boolean");
  });
});
```

2. Run, watch fail: `npx vitest run tests/unit/stores/catalog-setup-store.test.ts`
   Expected: fails — module not found.
3. Implement:

```ts
// src/stores/catalog-setup-store.ts
"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  stagingReducer, initialStagingState, type StagingAction,
} from "@/lib/catalog-setup/staging-reducer";
import type { StagingCard } from "@/lib/catalog-setup/staging-types";
import type { WizardStep } from "@/lib/catalog-setup/step-machine";

interface CatalogSetupState {
  cards: StagingCard[];
  currentStep: WizardStep;
  _hydrated: boolean;
  dispatch: (action: StagingAction) => void;
  setStep: (step: WizardStep) => void;
  reset: () => void;
}

export const useCatalogSetupStore = create<CatalogSetupState>()(
  persist(
    (set, get) => ({
      cards: initialStagingState.cards,
      currentStep: "sell",
      _hydrated: false,
      dispatch: (action) => {
        const next = stagingReducer({ cards: get().cards }, action);
        set({ cards: next.cards });
      },
      setStep: (currentStep) => set({ currentStep }),
      reset: () => set({ cards: initialStagingState.cards, currentStep: "sell" }),
    }),
    {
      name: "ops-catalog-setup-state",
      partialize: (s) => ({ cards: s.cards, currentStep: s.currentStep }),
      onRehydrateStorage: () => () => {
        useCatalogSetupStore.setState({ _hydrated: true });
      },
    },
  ),
);
```

4. Run, watch pass: `npx vitest run tests/unit/stores/catalog-setup-store.test.ts`
   Expected: all pass (5 passing).
5. Run the full Phase 1 logic suite once: `npx vitest run src/lib/catalog-setup tests/unit/stores/catalog-setup-store.test.ts`
   Expected: all logic + store tests green.
6. Commit: `git add src/stores/catalog-setup-store.ts tests/unit/stores/catalog-setup-store.test.ts && git commit -m "feat(catalog-setup): persisted zustand store (resume across refresh)"`

---

### Task 1.7: Stepper + card design mock (GATE — approve before any UI code)

Spec §13: there is no canonical wizard-stepper in `ui_kits/ops-web`; the module rail AND staging card must be mocked and approved before code. This task produces the mock + the placeholder spec doc. **Tasks 1.8–1.12 are blocked until Jackson approves the mock.**

**Skills:** `wireframe` (generate 3–4 module-rail + card variants), `interface-design` + `frontend-design` (judge against the system), `ops-copywriter` (card-state + rail labels), `audit-design-system` (token trace).
**Files:**
- Create `docs/specs/2026-06-13-catalog-setup-wizard-stepper-card-mocks.md`
**Design tokens:** module rail = neutral fills only (`text-text` current / `text-text-2` past / `text-text-mute` future), indicator squares radius 2 — **explicitly no `ops-accent`** (DESIGN.md §85-87, mirrors `stepper-rail.tsx` structure but recolored off-accent); card = `.glass-surface`, title `font-cakemono font-light` UPPERCASE, numbers `font-mono`, accept=`olive`, review=`tan`, reject=`rose` border/muted-fill; chips radius 4. BUILD IT is the lone `ops-accent` element.

Steps:

1. Invoke `wireframe` for the two-pane shell + module rail + a single staging card (3–4 variants). Capture chosen variant rationale ("why this presentation, for this user, at this moment" per master plan §6).
2. Invoke `ops-copywriter` to lock the card-state labels (`ACCEPT` / `EDIT` / `REJECT` / `MERGE`), rail labels (`SELL` / `STOCK` / `TYPES` / `REVIEW`), running-totals string (`N proposed · M added`), and the primary CTA `BUILD IT` (spec §14 sample — finalize voice).
3. Write `docs/specs/2026-06-13-catalog-setup-wizard-stepper-card-mocks.md` capturing: chosen variant, every token reference, the no-accent-on-rail rule, the olive card-accept micro-interaction, and a screenshot/SVG of the approved mock.
4. Run `audit-design-system` against the mock doc; record zero hardcoded values, every value traced to a token.
5. Commit: `git add docs/specs/2026-06-13-catalog-setup-wizard-stepper-card-mocks.md && git commit -m "docs(catalog-setup): stepper + card design mock (pre-code gate)"`
6. **STOP — get Jackson's approval on the mock before Task 1.8.** (Confirmation item.)

---

### Task 1.8: Wizard-local motion variants

All wizard motion in one file, on the single curve, with reduced-motion fallbacks (DESIGN.md §262-276). Reuses `EASE_SMOOTH` from `@/lib/utils/motion`; adds step x-slide, card-accept olive confirm, and a count-up hook (the same pattern as the approved `supply-strip.tsx useCountUp`).

**Skills:** `elite-animations` → `animation-architect` (motion plan) then `web-animations` (Framer impl).
**Files:**
- Create `src/components/catalog/setup-wizard/motion.ts`
- Create `tests/unit/components/catalog-setup/motion.test.ts`
**Design tokens:** easing `EASE_SMOOTH [0.22,1,0.36,1]`; step x-slide ~250ms (spec §13); count-up 800ms (DESIGN.md hero count-up); reduced-motion → 150ms opacity.

Steps:

1. Write the failing test (variants are pure objects — assert shape so the curve/duration can't drift):

```ts
// tests/unit/components/catalog-setup/motion.test.ts
import { describe, it, expect } from "vitest";
import { stepSlideVariants, cardAcceptVariants, EASE_WIZARD } from "@/components/catalog/setup-wizard/motion";

describe("wizard motion", () => {
  it("uses the single OPS easing curve", () => {
    expect(EASE_WIZARD).toEqual([0.22, 1, 0.36, 1]);
  });
  it("step slide enters from +80 and exits to -80 (forward dir)", () => {
    const enter = stepSlideVariants.enter(1);
    expect(enter).toMatchObject({ x: 80, opacity: 0 });
  });
  it("step transition is ~250ms", () => {
    expect(stepSlideVariants.center.transition.duration).toBeCloseTo(0.25, 2);
  });
  it("card-accept flashes an olive confirm then settles", () => {
    expect(cardAcceptVariants.accepted.transition.ease).toEqual([0.22, 1, 0.36, 1]);
  });
});
```

2. Run, watch fail: `npx vitest run tests/unit/components/catalog-setup/motion.test.ts`
   Expected: module not found.
3. Implement:

```ts
// src/components/catalog/setup-wizard/motion.ts
"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion, type Variants } from "framer-motion";
import { EASE_SMOOTH } from "@/lib/utils/motion";

export const EASE_WIZARD = EASE_SMOOTH; // [0.22, 1, 0.36, 1] — the only curve

/** Step x-slide ~250ms (spec §13). Direction-aware. */
export const stepSlideVariants: Variants = {
  enter: (dir: number) => ({ x: dir >= 0 ? 80 : -80, opacity: 0 }),
  center: { x: 0, opacity: 1, transition: { duration: 0.25, ease: EASE_WIZARD } },
  exit: (dir: number) => ({ x: dir >= 0 ? -80 : 80, opacity: 0, transition: { duration: 0.2, ease: EASE_WIZARD } }),
};

/** Card-accept: a brief olive confirm, then settle (no bounce/spring). */
export const cardAcceptVariants: Variants = {
  proposed: { borderColor: "rgba(255,255,255,0.10)" },
  accepted: { borderColor: ["rgba(157,181,130,0.9)", "rgba(157,181,130,0.35)"], transition: { duration: 0.45, ease: EASE_WIZARD } },
};

/** Count-up for running totals — reduced-motion aware (mirrors supply-strip). */
export function useCountUp(target: number, duration = 800): number {
  const reduce = useReducedMotion();
  const [value, setValue] = useState(reduce ? target : 0);
  const prev = useRef(0);
  useEffect(() => {
    if (reduce) { setValue(target); return; }
    const from = prev.current; prev.current = target;
    let start: number | null = null; let raf = 0;
    const step = (ts: number) => {
      if (start === null) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      const eased = 1 - (1 - p) * (1 - p);
      setValue(from + (target - from) * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, reduce]);
  return value;
}
```

4. Run, watch pass: `npx vitest run tests/unit/components/catalog-setup/motion.test.ts`
   Expected: all pass (4 passing).
5. Commit: `git add src/components/catalog/setup-wizard/motion.ts tests/unit/components/catalog-setup/motion.test.ts && git commit -m "feat(catalog-setup): wizard motion variants + count-up hook"`

---

### Task 1.9: Module rail (bespoke neutral-fill stepper)

The persistent SELL → STOCK → TYPES → REVIEW rail (spec §7). Structurally follows `stepper-rail.tsx` but recolored to neutral fills — **NO accent** (the §13 rule; a deviation here is the canonical design failure). Step list comes from `buildStepPlan`.

**Skills:** `interface-design` + `frontend-design`, `audit-design-system` (done-gate), `ops-copywriter` (labels already locked in 1.7).
**Files:**
- Create `src/components/catalog/setup-wizard/module-rail.tsx`
- Create `tests/unit/components/catalog-setup/module-rail.test.tsx`
**Design tokens:** labels `font-cakemono font-light` UPPERCASE; current `text-text`, past `text-text-2`, future `text-text-mute`; indicator squares radius 2 (`rounded-[2px]`); **no `ops-accent` / no `#6F94B0` anywhere**; the rail is a `<nav>` with a hairline `border-r border-[rgba(255,255,255,0.10)]`.

Steps:

1. Write the failing test — assert render + the no-accent invariant:

```tsx
// tests/unit/components/catalog-setup/module-rail.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ModuleRail } from "@/components/catalog/setup-wizard/module-rail";

describe("ModuleRail", () => {
  it("renders the planned steps as uppercase labels", () => {
    render(<ModuleRail steps={["sell", "stock", "types", "review"]} currentStep="stock" />);
    expect(screen.getByText("SELL")).toBeInTheDocument();
    expect(screen.getByText("REVIEW")).toBeInTheDocument();
  });

  it("never paints the accent color on the rail (design-system §13 rule)", () => {
    const { container } = render(<ModuleRail steps={["sell", "types", "review"]} currentStep="sell" />);
    expect(container.innerHTML.toLowerCase()).not.toContain("#6f94b0");
    expect(container.innerHTML).not.toContain("ops-accent");
  });

  it("omits a step that isn't in the plan", () => {
    render(<ModuleRail steps={["sell", "types", "review"]} currentStep="sell" />);
    expect(screen.queryByText("STOCK")).toBeNull();
  });
});
```

2. Run, watch fail: `npx vitest run tests/unit/components/catalog-setup/module-rail.test.tsx`
   Expected: module not found.
3. Implement (labels mapped from step keys; current/past/future coloring; reduced-motion safe — no motion needed beyond static):

```tsx
// src/components/catalog/setup-wizard/module-rail.tsx
"use client";

import { Check } from "lucide-react";
import type { WizardStep } from "@/lib/catalog-setup/step-machine";

const LABELS: Record<WizardStep, string> = { sell: "SELL", stock: "STOCK", types: "TYPES", review: "REVIEW" };

interface ModuleRailProps {
  steps: WizardStep[];
  currentStep: WizardStep;
}

export function ModuleRail({ steps, currentStep }: ModuleRailProps) {
  const currentIdx = steps.indexOf(currentStep);
  return (
    <nav className="flex flex-col gap-0.5 w-[160px] flex-shrink-0 pr-4 border-r border-[rgba(255,255,255,0.10)]">
      {steps.map((step, i) => {
        const isCurrent = step === currentStep;
        const isPast = i < currentIdx;
        return (
          <div key={step} className="flex items-center gap-2 py-1.5">
            <div className="w-3.5 h-3.5 flex items-center justify-center flex-shrink-0">
              {isPast ? (
                <Check size={10} className="text-text-2" />
              ) : isCurrent ? (
                <div className="w-2 h-2 bg-[#EDEDED] rounded-[2px]" />
              ) : (
                <div className="w-2 h-2 border border-[rgba(255,255,255,0.15)] rounded-[2px]" />
              )}
            </div>
            <span
              className="font-cakemono font-light text-status tracking-[0.15em] uppercase"
              style={{ color: isCurrent ? "#EDEDED" : isPast ? "#B5B5B5" : "#6A6A6A" }}
            >
              {LABELS[step]}
            </span>
          </div>
        );
      })}
    </nav>
  );
}
```

4. Run, watch pass: `npx vitest run tests/unit/components/catalog-setup/module-rail.test.tsx`
   Expected: all pass (3 passing).
5. Run `audit-design-system` on this file; confirm zero hardcoded accent, every value traced.
6. Commit: `git add src/components/catalog/setup-wizard/module-rail.tsx tests/unit/components/catalog-setup/module-rail.test.tsx && git commit -m "feat(catalog-setup): module rail stepper (neutral fills, no accent)"`

---

### Task 1.10: Staging card component (accept / edit / reject / merge)

The unit of the canvas (spec §7). Renders a card per `StagingCard`, exposes accept/edit/reject (and merge when `matchedExistingId`), drives the olive card-accept micro-interaction. State changes dispatch up — the card is presentational + a small edit affordance.

**Skills:** `interface-design` + `frontend-design`, `elite-animations` (card-accept), `ops-copywriter` (labels locked in 1.7), `audit-design-system`.
**Files:**
- Create `src/components/catalog/setup-wizard/staging-card.tsx`
- Create `tests/unit/components/catalog-setup/staging-card.test.tsx`
**Design tokens:** `.glass-surface` card, radius 10; title `font-cakemono font-light` UPPERCASE; price/qty `font-mono` tabular (`$0` zero, never N/A); ACCEPT button border `olive`, REJECT border `rose`, MERGE border `tan` — earth tones as border/muted-fill only (DESIGN.md §328-334); card-accept = `cardAcceptVariants` (olive confirm); chips radius 4; reduced-motion fallback inherited from variants.

Steps:

1. Write the failing test:

```tsx
// tests/unit/components/catalog-setup/staging-card.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StagingCardView } from "@/components/catalog/setup-wizard/staging-card";
import type { StagingCard } from "@/lib/catalog-setup/staging-types";

const card: StagingCard = { id: "a", source: "agent", state: "proposed", module: "sell",
  fields: { name: "Tear-off", defaultPrice: 250, unitCost: 90, isTaxable: true, kind: "service", type: "LABOR" } };

describe("StagingCardView", () => {
  it("renders the card name and price (mono, formatted)", () => {
    render(<StagingCardView card={card} onAccept={() => {}} onReject={() => {}} onEdit={() => {}} />);
    expect(screen.getByText("TEAR-OFF")).toBeInTheDocument();
    expect(screen.getByText("$250")).toBeInTheDocument();
  });

  it("shows '—' for a null price, never N/A", () => {
    const noPrice = { ...card, fields: { ...card.fields, defaultPrice: null } } as StagingCard;
    render(<StagingCardView card={noPrice} onAccept={() => {}} onReject={() => {}} onEdit={() => {}} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/N\/A/i)).toBeNull();
  });

  it("fires onAccept / onReject", () => {
    const onAccept = vi.fn(); const onReject = vi.fn();
    render(<StagingCardView card={card} onAccept={onAccept} onReject={onReject} onEdit={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /accept/i }));
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    expect(onAccept).toHaveBeenCalledOnce();
    expect(onReject).toHaveBeenCalledOnce();
  });

  it("offers MERGE instead of ACCEPT when the card matched an existing row", () => {
    const matched = { ...card, matchedExistingId: "live-1" } as StagingCard;
    render(<StagingCardView card={matched} onAccept={() => {}} onReject={() => {}} onEdit={() => {}} onMerge={() => {}} />);
    expect(screen.getByRole("button", { name: /merge/i })).toBeInTheDocument();
  });
});
```

2. Run, watch fail: `npx vitest run tests/unit/components/catalog-setup/staging-card.test.tsx`
   Expected: module not found.
3. Implement (price formatter local for now; align to `catalog/format.ts` `fmtMoney` after the rebase). Card title pulls `display` for TYPES, `name` otherwise. Earth-tone action buttons; olive confirm via `cardAcceptVariants`.

```tsx
// src/components/catalog/setup-wizard/staging-card.tsx
"use client";

import { motion } from "framer-motion";
import { Check, Pencil, X, GitMerge } from "lucide-react";
import type { StagingCard } from "@/lib/catalog-setup/staging-types";
import { cardAcceptVariants } from "./motion";

function title(card: StagingCard): string {
  return card.module === "types" ? card.fields.display : card.fields.name;
}
function priceLabel(card: StagingCard): string {
  if (card.module !== "sell") return "—";
  const p = card.fields.defaultPrice;
  return p === null || p === undefined ? "—" : `$${p}`;
}

interface Props {
  card: StagingCard;
  onAccept: () => void;
  onReject: () => void;
  onEdit: () => void;
  onMerge?: () => void;
}

export function StagingCardView({ card, onAccept, onReject, onEdit, onMerge }: Props) {
  const matched = !!card.matchedExistingId;
  return (
    <motion.div
      variants={cardAcceptVariants}
      animate={card.state === "accepted" || card.state === "edited" ? "accepted" : "proposed"}
      className="glass-surface rounded-[10px] border border-[rgba(255,255,255,0.10)] p-2 flex flex-col gap-1.5"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-cakemono font-light text-body-lg uppercase text-text truncate">{title(card)}</span>
        <span className="font-mono text-data text-text tabular-nums">{priceLabel(card)}</span>
      </div>
      <div className="flex items-center gap-1">
        {matched ? (
          <button onClick={onMerge} aria-label="Merge"
            className="h-8 px-3 rounded-[5px] font-mohave text-button-sm uppercase border border-[rgba(196,168,104,0.4)] text-[#C4A868] hover:bg-[rgba(196,168,104,0.1)] inline-flex items-center gap-1">
            <GitMerge size={14} /> Merge
          </button>
        ) : (
          <button onClick={onAccept} aria-label="Accept"
            className="h-8 px-3 rounded-[5px] font-mohave text-button-sm uppercase border border-[rgba(157,181,130,0.4)] text-[#9DB582] hover:bg-[rgba(157,181,130,0.1)] inline-flex items-center gap-1">
            <Check size={14} /> Accept
          </button>
        )}
        <button onClick={onEdit} aria-label="Edit"
          className="h-8 px-3 rounded-[5px] font-mohave text-button-sm uppercase border border-[rgba(255,255,255,0.10)] text-text-2 hover:bg-[rgba(255,255,255,0.05)] inline-flex items-center gap-1">
          <Pencil size={14} /> Edit
        </button>
        <button onClick={onReject} aria-label="Reject"
          className="h-8 px-3 rounded-[5px] font-mohave text-button-sm uppercase border border-[rgba(181,130,137,0.4)] text-[#B58289] hover:bg-[rgba(181,130,137,0.1)] inline-flex items-center gap-1">
          <X size={14} /> Reject
        </button>
      </div>
    </motion.div>
  );
}
```

4. Run, watch pass: `npx vitest run tests/unit/components/catalog-setup/staging-card.test.tsx`
   Expected: all pass (4 passing).
5. Run `audit-design-system` on the file; confirm no accent on the card, earth tones border-only.
6. Commit: `git add src/components/catalog/setup-wizard/staging-card.tsx tests/unit/components/catalog-setup/staging-card.test.tsx && git commit -m "feat(catalog-setup): staging card (accept/edit/reject/merge + olive confirm)"`

---

### Task 1.11: Running totals header (count-up)

The `N proposed · M added` counter (spec §7), animating on the count-up hook. Numbers mono/tabular; reduced-motion safe.

**Skills:** `elite-animations` (count-up), `frontend-design`, `ops-copywriter` (string locked in 1.7), `audit-design-system`.
**Files:**
- Create `src/components/catalog/setup-wizard/running-totals.tsx`
- Create `tests/unit/components/catalog-setup/running-totals.test.tsx`
**Design tokens:** numbers `font-mono` tabular (`tnum`/`zero`), `text-text`; separator `·` in `text-text-mute`; labels `font-mohave` sentence case `text-text-3`.

Steps:

1. Failing test (assert it renders the final values — count-up animates toward target; with reduced motion in jsdom it should land on target):

```tsx
// tests/unit/components/catalog-setup/running-totals.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RunningTotals } from "@/components/catalog/setup-wizard/running-totals";

describe("RunningTotals", () => {
  it("renders proposed and added counts", () => {
    render(<RunningTotals totals={{ proposed: 4, added: 12, rejected: 1 }} />);
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText(/proposed/i)).toBeInTheDocument();
    expect(screen.getByText(/added/i)).toBeInTheDocument();
  });
});
```

2. Run, watch fail: `npx vitest run tests/unit/components/catalog-setup/running-totals.test.tsx`
   Expected: module not found.
3. Implement (mock `useReducedMotion`-driven count-up resolves to target immediately under jsdom):

```tsx
// src/components/catalog/setup-wizard/running-totals.tsx
"use client";

import type { RunningTotals as Totals } from "@/lib/catalog-setup/staging-types";
import { useCountUp } from "./motion";

export function RunningTotals({ totals }: { totals: Totals }) {
  const proposed = Math.round(useCountUp(totals.proposed));
  const added = Math.round(useCountUp(totals.added));
  return (
    <div className="flex items-center gap-2 font-mohave text-body-sm text-text-3">
      <span className="font-mono text-data text-text tabular-nums">{proposed}</span>
      <span>proposed</span>
      <span className="text-text-mute">·</span>
      <span className="font-mono text-data text-text tabular-nums">{added}</span>
      <span>added</span>
    </div>
  );
}
```

4. Run, watch pass: `npx vitest run tests/unit/components/catalog-setup/running-totals.test.tsx`
   Expected: pass.
5. Commit: `git add src/components/catalog/setup-wizard/running-totals.tsx tests/unit/components/catalog-setup/running-totals.test.tsx && git commit -m "feat(catalog-setup): running totals count-up header"`

---

### Task 1.12: Two-pane shell (driver + canvas + rail + BUILD IT) and driver/canvas panes

The full-page surface (spec §7) — heavy shell like `comms-config-wizard`. Left = driver pane (Phase 1 renders the deterministic guided-prompt fallback; the agent driver is a later phase). Right = canvas: module-grouped columns of `StagingCardView`, the `RunningTotals` header, and the BUILD IT footer (the lone `ops-accent` CTA, **disabled in Phase 1** — commit wired in a later phase; blockers from `selectBlockers` surface the `// N ROWS NEED A PRICE` message). Wires store → selectors → components.

**Skills:** `interface-design` + `frontend-design` (composition), `elite-animations` → `web-animations` (step x-slide via `stepSlideVariants`), `ops-copywriter` (headline `STAND UP YOUR CATALOG`, sub, BUILD IT, blocker message — spec §14), `audit-design-system` (final done-gate).
**Files:**
- Create `src/components/catalog/setup-wizard/driver-pane.tsx`
- Create `src/components/catalog/setup-wizard/canvas-pane.tsx`
- Create `src/components/catalog/setup-wizard/setup-wizard-shell.tsx`
- Create `tests/unit/components/catalog-setup/setup-wizard-shell.test.tsx`
**Design tokens:** page canvas `#000`; panes `.glass-surface`; title `font-cakemono font-light` UPPERCASE 28–32px (`text-display`/explicit); body `font-mohave`; BUILD IT = `Button variant="primary"` (the only accent element); blocker line `font-mono text-status text-[#B58289]` with `//` prefix; rail = `ModuleRail`; step transitions `stepSlideVariants` ~250ms; two-column `flex` layout (driver fixed ~360px, canvas flex-1), full-height `min-h-screen`.

Steps:

1. Failing shell test (assert structure, the disabled CTA, and the blocker message; mock the store):

```tsx
// tests/unit/components/catalog-setup/setup-wizard-shell.test.tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { SetupWizardShell } from "@/components/catalog/setup-wizard/setup-wizard-shell";
import { useCatalogSetupStore } from "@/stores/catalog-setup-store";
import type { StagingCard } from "@/lib/catalog-setup/staging-types";

const sell = (id: string, price: number | null): StagingCard => ({
  id, source: "agent", state: "proposed", module: "sell",
  fields: { name: id, defaultPrice: price, unitCost: 0, isTaxable: true, kind: "service", type: "LABOR" } });

describe("SetupWizardShell", () => {
  beforeEach(() => useCatalogSetupStore.getState().reset());

  it("renders the first-run headline and the module rail", () => {
    render(<SetupWizardShell inventoryTracked canSell canStock canTypes />);
    expect(screen.getByText(/STAND UP YOUR CATALOG/i)).toBeInTheDocument();
    expect(screen.getByText("SELL")).toBeInTheDocument();
    expect(screen.getByText("REVIEW")).toBeInTheDocument();
  });

  it("renders BUILD IT, disabled in Phase 1 (commit not wired)", () => {
    render(<SetupWizardShell inventoryTracked canSell canStock canTypes />);
    const cta = screen.getByRole("button", { name: /build it/i });
    expect(cta).toBeDisabled();
  });

  it("surfaces a blocker when an accepted SELL card has no price", () => {
    const d = useCatalogSetupStore.getState().dispatch;
    d({ type: "ADD_CARDS", cards: [sell("a", null)] });
    d({ type: "ACCEPT_CARD", id: "a" });
    render(<SetupWizardShell inventoryTracked canSell canStock canTypes />);
    expect(screen.getByText(/1 ROW.*NEED.*PRICE/i)).toBeInTheDocument();
  });
});
```

2. Run, watch fail: `npx vitest run tests/unit/components/catalog-setup/setup-wizard-shell.test.tsx`
   Expected: module(s) not found.
3. Implement the driver pane (Phase-1 fallback driver — a placeholder for the guided survey; agent driver later):

```tsx
// src/components/catalog/setup-wizard/driver-pane.tsx
"use client";

export function DriverPane() {
  // Phase 1: deterministic guided-prompt fallback container.
  // The Setup Agent conversation driver layers into this same slot in a later phase (spec §7, §10).
  return (
    <aside className="w-[360px] flex-shrink-0 glass-surface rounded-[10px] p-3 flex flex-col gap-3">
      <div>
        <h1 className="font-cakemono font-light text-display uppercase text-text">Stand up your catalog</h1>
        <p className="font-mohave text-body-sm text-text-2 mt-1">
          Your price book, your stock, your trades — set up once, ready for every estimate.
        </p>
      </div>
      <p className="font-mohave text-body text-text-3">How do you want to start?</p>
      {/* Source picker + guided prompts land in a later phase. */}
    </aside>
  );
}
```

4. Implement the canvas pane (grouped columns + totals + BUILD IT footer):

```tsx
// src/components/catalog/setup-wizard/canvas-pane.tsx
"use client";

import { Button } from "@/components/ui/button";
import { useCatalogSetupStore } from "@/stores/catalog-setup-store";
import { selectRunningTotals, selectByModule, selectBlockers } from "@/lib/catalog-setup/selectors";
import { RunningTotals } from "./running-totals";
import { StagingCardView } from "./staging-card";

const MODULE_TITLES = { sell: "// SELL", stock: "// STOCK", types: "// TYPES" } as const;

export function CanvasPane() {
  const cards = useCatalogSetupStore((s) => s.cards);
  const dispatch = useCatalogSetupStore((s) => s.dispatch);
  const state = { cards };
  const totals = selectRunningTotals(state);
  const grouped = selectByModule(state);
  const blockers = selectBlockers(state);
  const priceBlocker = blockers.find((b) => b.kind === "missing_price");

  return (
    <section className="flex-1 glass-surface rounded-[10px] p-3 flex flex-col gap-3 min-h-0">
      <header className="flex items-center justify-between">
        <RunningTotals totals={totals} />
      </header>

      <div className="flex-1 overflow-y-auto scrollbar-hide flex flex-col gap-4">
        {(["sell", "stock", "types"] as const).map((m) =>
          grouped[m].length === 0 ? null : (
            <div key={m} className="flex flex-col gap-1.5">
              <span className="font-mono text-status text-text-mute uppercase tracking-wider">{MODULE_TITLES[m]}</span>
              {grouped[m].map((card) => (
                <StagingCardView
                  key={card.id}
                  card={card}
                  onAccept={() => dispatch({ type: "ACCEPT_CARD", id: card.id })}
                  onReject={() => dispatch({ type: "REJECT_CARD", id: card.id })}
                  onEdit={() => dispatch({ type: "EDIT_CARD", id: card.id, fields: {} })}
                  onMerge={card.matchedExistingId ? () => dispatch({ type: "MERGE_CARD", id: card.id, matchedExistingId: card.matchedExistingId! }) : undefined}
                />
              ))}
            </div>
          ),
        )}
      </div>

      <footer className="flex items-center justify-between pt-2 border-t border-[rgba(255,255,255,0.10)]">
        {priceBlocker ? (
          <span className="font-mono text-status text-[#B58289]">{`// ${priceBlocker.count} ROW${priceBlocker.count === 1 ? "" : "S"} NEED A PRICE`}</span>
        ) : <span />}
        {/* BUILD IT is the lone accent CTA. Disabled in Phase 1 — commit pipeline wired in a later phase. */}
        <Button variant="primary" disabled aria-label="Build it">Build it</Button>
      </footer>
    </section>
  );
}
```

5. Implement the shell (rail from `buildStepPlan`; two panes; step x-slide ready for later content):

```tsx
// src/components/catalog/setup-wizard/setup-wizard-shell.tsx
"use client";

import { useCatalogSetupStore } from "@/stores/catalog-setup-store";
import { buildStepPlan, type StepContext } from "@/lib/catalog-setup/step-machine";
import { ModuleRail } from "./module-rail";
import { DriverPane } from "./driver-pane";
import { CanvasPane } from "./canvas-pane";

type Props = { inventoryTracked: boolean; canSell: boolean; canStock: boolean; canTypes: boolean };

export function SetupWizardShell(props: Props) {
  const currentStep = useCatalogSetupStore((s) => s.currentStep);
  const ctx: StepContext = props;
  const steps = buildStepPlan(ctx);

  return (
    <div className="min-h-screen bg-black p-4 flex gap-4">
      <ModuleRail steps={steps} currentStep={currentStep} />
      <DriverPane />
      <CanvasPane />
    </div>
  );
}
```

6. Run, watch pass: `npx vitest run tests/unit/components/catalog-setup/setup-wizard-shell.test.tsx`
   Expected: all pass (3 passing).
7. Run the full Phase 1 suite: `npx vitest run src/lib/catalog-setup tests/unit/stores/catalog-setup-store.test.ts tests/unit/components/catalog-setup`
   Expected: every Phase 1 test green.
8. Typecheck: `npx tsc --noEmit 2>&1 | grep catalog-setup || echo "TYPES OK"`
   Expected: `TYPES OK`.
9. Run `audit-design-system` across `src/components/catalog/setup-wizard/`; confirm accent appears only on BUILD IT, every value traced to a token, copy via ops-copywriter.
10. Commit: `git add src/components/catalog/setup-wizard/driver-pane.tsx src/components/catalog/setup-wizard/canvas-pane.tsx src/components/catalog/setup-wizard/setup-wizard-shell.tsx tests/unit/components/catalog-setup/setup-wizard-shell.test.tsx && git commit -m "feat(catalog-setup): two-pane wizard shell (driver + live-building canvas)"`

---

### Task 1.13: Integration-point documentation (no wiring this phase)

Record exactly where the shell plugs into the catalog host so the later phase has a precise contract; do NOT edit `catalog-page.tsx` (it isn't in this worktree until the rebase — confirmation item).

**Skills:** none (docs).
**Files:**
- Modify `docs/specs/2026-06-13-catalog-setup-wizard-stepper-card-mocks.md` (append an "Integration points" section).
**Design tokens:** n/a.

Steps:

1. Append to the mock doc: (a) first-run takeover — in `src/components/catalog/catalog-page.tsx`, when `products.length === 0 && stockRows.length === 0` and `can("products.view")`, render `<SetupWizardShell .../>` in place of the empty segment tables (entry point spec §6.1); (b) deep-link route `/catalog/setup`; (c) re-entry from the catalog kebab (`catalog-kebab.tsx`) and Settings; (d) props wiring — `inventoryTracked` from `company_inventory_settings.inventory_mode === 'tracked'`, `canSell = can("products.manage")`, `canStock = can("inventory.manage")`, `canTypes` per task/calendar perms (spec §12). Note all of these are wired in a later phase.
2. Commit: `git add docs/specs/2026-06-13-catalog-setup-wizard-stepper-card-mocks.md && git commit -m "docs(catalog-setup): record catalog host integration points"`

---

**Phase 1 done-gate.** All logic + store + component suites green (`npx vitest run src/lib/catalog-setup tests/unit/stores/catalog-setup-store.test.ts tests/unit/components/catalog-setup`); `tsc --noEmit` clean for the new paths; `audit-design-system` passes on `src/components/catalog/setup-wizard/`; the stepper/card mock was approved by Jackson before any UI code; accent appears only on BUILD IT; every visible string ran through `ops-copywriter`. No commit pipeline, no agent network calls, no schema — the canvas is real, deterministic, resumable, and ready for the source-feeding + commit phases to build on.
