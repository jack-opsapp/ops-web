## Phase 6: Failure-Mode Hardening, Analytics & Test Strategy

**Goal.** Turn every spec §16 failure mode into a guarded, tested behavior, instrument the wizard with `wizard_analytics`, fire the completion notification, and stand up the full vitest + Playwright test strategy. This phase is cross-cutting — it consumes artifacts from P1–P5 (store, canvas, sources, agent, commit) and hardens them. The only schema Phase 6 owns is one additive nullable column on `wizard_analytics`.

**Skills.** `interface-design` + `frontend-design` (gate banners, offline bar, BUILD IT button, inventory-off prompt), `ops-copywriter` (every user-facing string: blocker messages, offline copy, inventory prompt, completion notification — must clear ops-copywriter), `elite-animations` / `animation-architect` + `web-animations` (offline bar entrance, count-up on completion, card-accept confirm — one curve only), `audit-design-system` (DONE-GATE on every UI file in this phase — no merge until it passes). Logic-only tasks (prerequisites, gates, validation, dedupe, analytics, fallback) need no design skill but are pure-function TDD.

**Design tokens (every UI task in this phase).** Canvas `#000000`; surfaces `.glass`/`.glass-dense` (`rgba(18,18,20,0.58)`/`0.78` + `backdrop-blur(28px) saturate(1.3)` + `1px solid rgba(255,255,255,0.09)`); accent `#6F94B0` on the single primary CTA (BUILD IT) + focus rings ONLY — never on gate banners, offline bar, Back, toggles; text ladder `#EDEDED`/`#B5B5B5`/`#8A8A8A`/`#6A6A6A`; earth-tone semantics border-only (`olive #9DB582` added/positive, `tan #C4A868` review/attention, `rose #B58289` cost/error); radius `btn 5` / `chip 4` / `panel 10` / `modal 12` / `bar 2`; controls min-h 36px (NO touch targets — web); Cake Mono Light UPPERCASE for titles/buttons/badges, Mohave sentence-case body, JetBrains Mono `tnum`+`zero` for all numbers (11px min, `—`/`$0` for empty); icons `lucide-react` only; motion `cubic-bezier(0.22,1,0.36,1)`, no spring/bounce, honor `prefers-reduced-motion`; voice `//` section prefix, `[ ]` instructional, UPPERCASE authority / sentence-case content, no emoji, no exclamation points, never "AI", never "contractor".

**Conventions for every task below.** Vitest unit/component: `npm test -- run <path>` (single file) — expect `Test Files 1 passed`. E2E: `npm run test:e2e -- catalog-setup-wizard` (Playwright auto-starts the dev server). Commit after each green step with a conventional message (`feat(catalog-wizard):` / `test(catalog-wizard):` / `fix(catalog-wizard):`), staging files by name only — never `git add -A`. No `Co-Authored-By`. Each numbered step is a 2–5 min TDD loop: write failing test → run it (see it fail) → minimal impl → run it (see it pass) → commit.

---

### Task 6.1: Additive analytics schema — `wizard_analytics.company_id`

Verified against prod: `wizard_analytics` exists with web-ready columns (`platform`, `wizard_id`, `session_id`, `event`, `step_id`, `step_index`, `is_restart`, `trigger_type`, `trigger_context`, `duration_ms`, `steps_skipped`, `total_steps`, `user_id`, `user_role`) but **no `company_id`** — required for multi-tenant scoping of every wizard event (spec §16 "company_id scoping on every read/write"). Additive nullable column + index only; iOS reads the table and ignores unknown columns, so this is App-Store-safe.

**Skills:** none (DB migration).
**Files:**
- Create `supabase/migrations/<timestamp>_wizard_analytics_company_id.sql`
- Modify `src/lib/types/database.types.ts` (regenerate — `wizard_analytics` Row/Insert/Update gain `company_id: string | null`)

**Design tokens:** n/a.

Steps:
1. Write the migration SQL (idempotent):
   ```sql
   -- Multi-tenant scoping for catalog setup wizard analytics.
   -- Additive + nullable → safe across iOS App Store releases (the iOS
   -- client reads wizard_analytics and ignores unknown columns).
   alter table public.wizard_analytics
     add column if not exists company_id uuid references public.companies(id) on delete set null;

   create index if not exists wizard_analytics_company_id_idx
     on public.wizard_analytics (company_id);

   comment on column public.wizard_analytics.company_id is
     'Company the wizard session belongs to. Nullable for legacy iOS rows.';
   ```
2. Apply against a sentinel first (dry-run posture per the low-tenant direct-migration authorization): run `select 1 from information_schema.columns where table_name='wizard_analytics' and column_name='company_id';` via Supabase MCP `execute_sql` — expect 0 rows BEFORE. Confirm cost is $0 (DDL only). **Confirm at execution time:** Jackson's go-ahead to apply to prod `ijeekuhbatykdomumfjx` (memory: direct prod migrations authorized, but surface blast radius first — DDL `add column` on a low-row analytics table is non-locking on Postgres 11+ for a nullable column with no default).
3. After apply, re-run the `information_schema` check — expect 1 row.
4. Regenerate types: Supabase MCP `generate_typescript_types`, splice the `wizard_analytics` block into `src/lib/types/database.types.ts` (do not hand-edit other tables). Run `npm run type-check` — expect no new errors.
5. Commit: `feat(catalog-wizard): add company_id to wizard_analytics for multi-tenant scoping`.

---

### Task 6.2: Prerequisite predicates (pure)

Spec §16 "Prerequisites": company exists; baseline `initialize_company_defaults` ran (task_types/units present → read-merge, never re-seed); the `/catalog` (P3-2) surface deployed; not in expired-subscription lockout. Pure functions consumed by the route loader + `prerequisite-gate.tsx`.

**Skills:** none (pure TDD).
**Files:**
- Create `src/lib/catalog-setup/prerequisites.ts`
- Create `src/lib/catalog-setup/prerequisites.test.ts`

**Design tokens:** n/a.

Steps:
1. Failing test — define the input shape and the blocking-reason enum:
   ```ts
   import { describe, it, expect } from "vitest";
   import { deriveBlockingPrerequisite, type PrereqInput } from "./prerequisites";

   const ok: PrereqInput = {
     companyExists: true,
     baselineSeeded: true,
     catalogSurfaceDeployed: true,
     subscriptionLocked: false,
   };

   describe("deriveBlockingPrerequisite", () => {
     it("returns null when all prerequisites pass", () => {
       expect(deriveBlockingPrerequisite(ok)).toBeNull();
     });
     it("flags a missing company first (highest priority)", () => {
       expect(deriveBlockingPrerequisite({ ...ok, companyExists: false }))
         .toBe("no_company");
     });
     it("flags an unseeded baseline", () => {
       expect(deriveBlockingPrerequisite({ ...ok, baselineSeeded: false }))
         .toBe("baseline_not_seeded");
     });
     it("flags a missing catalog surface", () => {
       expect(deriveBlockingPrerequisite({ ...ok, catalogSurfaceDeployed: false }))
         .toBe("catalog_surface_absent");
     });
     it("flags subscription lockout", () => {
       expect(deriveBlockingPrerequisite({ ...ok, subscriptionLocked: true }))
         .toBe("subscription_locked");
     });
     it("returns the highest-priority blocker when several fail", () => {
       expect(deriveBlockingPrerequisite({
         companyExists: false, baselineSeeded: false,
         catalogSurfaceDeployed: false, subscriptionLocked: true,
       })).toBe("no_company");
     });
   });
   ```
2. Run `npm test -- run src/lib/catalog-setup/prerequisites.test.ts` — expect fail (module missing).
3. Minimal impl:
   ```ts
   export type BlockingPrerequisite =
     | "no_company"
     | "baseline_not_seeded"
     | "catalog_surface_absent"
     | "subscription_locked";

   export interface PrereqInput {
     companyExists: boolean;
     baselineSeeded: boolean;
     catalogSurfaceDeployed: boolean;
     subscriptionLocked: boolean;
   }

   /** Highest-priority blocker, or null when the wizard may run. */
   export function deriveBlockingPrerequisite(i: PrereqInput): BlockingPrerequisite | null {
     if (!i.companyExists) return "no_company";
     if (i.subscriptionLocked) return "subscription_locked";
     if (!i.catalogSurfaceDeployed) return "catalog_surface_absent";
     if (!i.baselineSeeded) return "baseline_not_seeded";
     return null;
   }
   ```
   Note: ordering puts `no_company` first, then `subscription_locked` (a paying-state gate that outranks data-shape gates), then surface, then baseline. The multi-fail test asserts `no_company` wins regardless of the rest.
4. Run the test — expect `Test Files 1 passed`.
5. Add `baselineSeeded` derivation helper `baselineSeeded(taskTypeCount: number, unitCount: number): boolean` returning `taskTypeCount > 0 && unitCount > 0` (read-merge signal — baseline is present, the wizard must not re-seed). Write its 2-case test (0/0 → false; 196/n → true), impl, run, green.
6. Commit: `feat(catalog-wizard): prerequisite predicates for wizard entry`.

---

### Task 6.3: Single-session-per-company lock

Spec §16 "only one setup session at a time per company". Use the existing `catalog_setup_save_requests` ledger (UNIQUE `(company_id, idempotency_key)`) or `wizard_states` as the lock substrate — acquire on entry keyed by `company_id` + a fresh session id, treat a live lock owned by a different session as "another session is running". Pure logic + a thin service wrapper; the network read is mocked in tests.

**Skills:** none (pure TDD + mocked service).
**Files:**
- Create `src/lib/catalog-setup/session-lock.ts`
- Create `src/lib/catalog-setup/session-lock.test.ts`

**Design tokens:** n/a.

Steps:
1. Failing test for the pure conflict predicate:
   ```ts
   import { describe, it, expect } from "vitest";
   import { isHeldByOther, type LockState } from "./session-lock";

   const now = Date.parse("2026-06-13T12:00:00Z");
   const mine = "sess-mine";

   describe("isHeldByOther", () => {
     it("free when no lock row exists", () => {
       expect(isHeldByOther(null, mine, now)).toBe(false);
     });
     it("free when the lock is mine", () => {
       const lock: LockState = { sessionId: mine, heartbeatAt: now - 1000 };
       expect(isHeldByOther(lock, mine, now)).toBe(false);
     });
     it("held when another live session owns it", () => {
       const lock: LockState = { sessionId: "sess-other", heartbeatAt: now - 5000 };
       expect(isHeldByOther(lock, mine, now)).toBe(true);
     });
     it("free when another session's lock is stale (>120s heartbeat)", () => {
       const lock: LockState = { sessionId: "sess-other", heartbeatAt: now - 121_000 };
       expect(isHeldByOther(lock, mine, now)).toBe(false);
     });
   });
   ```
2. Run — expect fail.
3. Impl `isHeldByOther(lock, mySessionId, nowMs)` with a `LOCK_TTL_MS = 120_000` staleness window so an abandoned/crashed session self-releases (resume must not be permanently blocked by a dead tab). Run — green.
4. Add `buildSessionId()` (crypto-random, prefixed `cw_`) + test that two calls differ and both match `/^cw_/`. Green.
5. Commit: `feat(catalog-wizard): single-session-per-company lock predicate`.

**Confirm at execution time:** whether the lock substrate is `catalog_setup_save_requests` (read latest row per company) or `wizard_states` (a dedicated lock row) — pick whichever P5's commit pipeline already touches to avoid a second table; this only changes the service read, not the pure predicate.

---

### Task 6.4: Compound per-step permission gate

Spec §16 "Role / permission matrix": account-holder/company-admin/office (with `products.manage`) → full run; operator/crew (scoped, no manage) → wizard hidden or read-only, never a dead "build it"; **every step's required permission is checked up front** — a step needing `inventory.manage` auto-hides for someone without it. Never role-filter (memory: never `role IN (...)`); use the granular `can(permission, scope?)` from `usePermissionStore`. Pure predicates take a `can` function so they are trivially testable.

**Skills:** none (pure TDD).
**Files:**
- Create `src/lib/catalog-setup/step-gates.ts`
- Create `src/lib/catalog-setup/step-gates.test.ts`

**Design tokens:** n/a.

Steps:
1. Failing test — declare the module→permission map and the visibility reducer:
   ```ts
   import { describe, it, expect } from "vitest";
   import {
     STEP_REQUIRED_PERMISSIONS,
     isStepAccessible,
     visibleModulePlan,
     type WizardModule,
   } from "./step-gates";

   const fullCan = () => true;
   const noInventory = (p: string) => p !== "inventory.manage" && p !== "inventory.import";
   const viewerOnly = (p: string) => p.endsWith(".view");

   describe("STEP_REQUIRED_PERMISSIONS", () => {
     it("requires catalog.run_setup + products.manage for SELL", () => {
       expect(STEP_REQUIRED_PERMISSIONS.SELL).toEqual(
         expect.arrayContaining(["catalog.run_setup", "products.manage"]),
       );
     });
     it("requires inventory.manage for STOCK", () => {
       expect(STEP_REQUIRED_PERMISSIONS.STOCK).toContain("inventory.manage");
     });
   });

   describe("isStepAccessible", () => {
     it("grants SELL to a products manager", () => {
       expect(isStepAccessible("SELL", fullCan)).toBe(true);
     });
     it("hides STOCK from someone without inventory.manage (no dead end)", () => {
       expect(isStepAccessible("STOCK", noInventory)).toBe(false);
     });
     it("hides everything from a view-only user", () => {
       expect(isStepAccessible("SELL", viewerOnly)).toBe(false);
     });
   });

   describe("visibleModulePlan", () => {
     const plan: WizardModule[] = ["SELL", "STOCK", "TYPES", "REVIEW"];
     it("drops STOCK for a no-inventory manager", () => {
       expect(visibleModulePlan(plan, noInventory)).toEqual(["SELL", "TYPES", "REVIEW"]);
     });
     it("keeps the full plan for a full manager", () => {
       expect(visibleModulePlan(plan, fullCan)).toEqual(plan);
     });
   });
   ```
2. Run — expect fail.
3. Impl: `WizardModule = "SELL"|"STOCK"|"TYPES"|"REVIEW"`; `STEP_REQUIRED_PERMISSIONS` ( `SELL: ["catalog.run_setup","products.manage"]`, `STOCK: ["catalog.run_setup","inventory.manage"]`, `TYPES: ["catalog.run_setup","products.manage"]` — trade/task types are catalog setup, not a separate perm; lock the exact bit at execution time against P1's registered set, `REVIEW: ["catalog.run_setup"]` ); `isStepAccessible(step, can)` = every required perm `can(p, "all")`; `visibleModulePlan(plan, can)` = `plan.filter(m => isStepAccessible(m, can))`. REVIEW only shows when at least one buildable module is visible — add that to the filter (REVIEW is dropped if only itself remains). Add a test for "REVIEW alone is dropped" and impl.
4. Run — green.
5. Add `entryAllowed(can)` = `can("catalog.run_setup","all")` — the wizard-level gate that decides hidden-vs-shown at the entry point (operator/crew without the bit never sees the takeover/CTA). Test true/false, impl, green.
6. Commit: `feat(catalog-wizard): compound per-step permission gates`.

**Confirm at execution time:** the exact permission bit name from P1 (`catalog.run_setup` is the spec's proposed name) and whether TYPES needs a distinct types/calendar permission — read `src/lib/types/permissions.ts` after P1 lands and align the constant.

---

### Task 6.5: Required-field validation engine

Spec §16 "Required-field stalls": a product needs name + price; a stock variant needs a unit; RPCs reject unknown category/unit. BUILD IT must be blocked with a precise message (`// 3 ROWS NEED A PRICE`) — never a silently-disabled button. Pure validators over staged cards produce a structured blocker list; copy is composed from it.

**Skills:** `ops-copywriter` (the blocker message strings only).
**Files:**
- Create `src/lib/catalog-setup/validation.ts`
- Create `src/lib/catalog-setup/validation.test.ts`

**Design tokens:** n/a (logic); blocker strings follow voice rules (`//` prefix, UPPERCASE authority, count via mono at render).

Steps:
1. Failing test — per-card validators return field-level codes:
   ```ts
   import { describe, it, expect } from "vitest";
   import {
     validateProductCard, validateStockCard, collectBlockers, buildBlockerMessage,
   } from "./validation";

   describe("validateProductCard", () => {
     it("passes a named, priced product with a known category", () => {
       expect(validateProductCard({ name: "Repair", basePrice: 250, categoryId: "c1" }))
         .toEqual([]);
     });
     it("flags a missing name", () => {
       expect(validateProductCard({ name: " ", basePrice: 250, categoryId: "c1" }))
         .toContain("missing_name");
     });
     it("flags a missing/zero price", () => {
       expect(validateProductCard({ name: "Repair", basePrice: null, categoryId: "c1" }))
         .toContain("missing_price");
     });
     it("flags an unresolved category (would hard-fail catalog_setup_save)", () => {
       expect(validateProductCard({ name: "Repair", basePrice: 250, categoryId: null }))
         .toContain("unresolved_category");
     });
   });

   describe("validateStockCard", () => {
     it("flags a variant with no unit", () => {
       expect(validateStockCard({ name: "Shingle", unitId: null }))
         .toContain("missing_unit");
     });
   });

   describe("collectBlockers", () => {
     it("aggregates by code across cards", () => {
       const cards = [
         { kind: "product", name: "", basePrice: 1, categoryId: "c1" },
         { kind: "product", name: "B", basePrice: null, categoryId: "c1" },
         { kind: "product", name: "C", basePrice: null, categoryId: "c1" },
       ] as const;
       const blockers = collectBlockers(cards as any);
       expect(blockers.find(b => b.code === "missing_price")?.count).toBe(2);
       expect(blockers.find(b => b.code === "missing_name")?.count).toBe(1);
     });
   });

   describe("buildBlockerMessage", () => {
     it("formats the highest-count blocker in OPS voice", () => {
       expect(buildBlockerMessage([{ code: "missing_price", count: 3 }]))
         .toBe("// 3 ROWS NEED A PRICE");
     });
     it("returns null when there are no blockers (BUILD IT enabled)", () => {
       expect(buildBlockerMessage([])).toBeNull();
     });
     it("pluralizes correctly for a single row", () => {
       expect(buildBlockerMessage([{ code: "missing_name", count: 1 }]))
         .toBe("// 1 ROW NEEDS A NAME");
     });
   });
   ```
2. Run — expect fail.
3. Impl: per-card validators returning `string[]` codes; `collectBlockers` walks accepted cards, dispatches by `kind`, tallies counts per code; `buildBlockerMessage` maps each code to a copy template (`missing_price → "{n} ROW{S} NEED{S} A PRICE"`, `missing_name → "{n} ROW{S} NEED{S} A NAME"`, `missing_unit → "{n} STOCK ROW{S} NEED{S} A UNIT"`, `unresolved_category → "{n} ROW{S} NEED A CATEGORY"`), picks the highest-count blocker, applies `//` prefix + singular/plural (`ROW`/`ROWS`, `NEEDS`/`NEED`). Run `ops-copywriter` on these templates and lock final wording. Run — green.
4. Add `allCardsValid(cards): boolean` = `collectBlockers(cards).length === 0` — the boolean BUILD IT enable signal (the button is enabled-or-shows-reason; never silently disabled). Test, impl, green.
5. Commit: `feat(catalog-wizard): required-field validation + blocker messaging`.

---

### Task 6.6: Show-diff dedupe correctness (merge, never double-create)

Spec §16 "Duplicate on commit" + "Re-run" + §11 "Dedupe": match imported rows against the live catalog on `lower(trim(sku))` (and name when SKU absent); a matched card defaults to **show-diff** (per-field accept) with merge-all and skip offered; commit via merge-capable `catalog_setup_save` (never create-only apply); `external_source`/`external_id` make re-imports re-sync, not duplicate. Re-running the wizard on a populated catalog must merge, not double-create. (If a `dedupe.ts` was created in P3/P5 for the source mappers, EXTEND it here with the re-run + external_id correctness; otherwise create it.)

**Skills:** none (pure TDD).
**Files:**
- Create or Modify `src/lib/catalog-setup/dedupe.ts`
- Create or extend `src/lib/catalog-setup/dedupe.test.ts`

**Design tokens:** n/a.

Steps:
1. Failing test — normalization + classification + re-run idempotency:
   ```ts
   import { describe, it, expect } from "vitest";
   import {
     normalizeKey, matchAgainstCatalog, classifyCard, dedupeReRun,
   } from "./dedupe";

   const live = [
     { id: "p1", sku: "SHGL-30", name: "30yr Shingle", externalId: "qb-100", basePrice: 95 },
   ];

   describe("normalizeKey", () => {
     it("lowercases and trims sku", () => {
       expect(normalizeKey("  SHGL-30 ")).toBe("shgl-30");
     });
   });

   describe("matchAgainstCatalog", () => {
     it("matches on sku case/space-insensitively", () => {
       expect(matchAgainstCatalog({ sku: "shgl-30 ", name: "X" }, live)?.id).toBe("p1");
     });
     it("falls back to name match when sku is absent", () => {
       expect(matchAgainstCatalog({ sku: null, name: "30yr Shingle" }, live)?.id).toBe("p1");
     });
     it("matches on externalId even when sku/name drift", () => {
       expect(matchAgainstCatalog({ sku: "NEW-SKU", name: "renamed", externalId: "qb-100" }, live)?.id)
         .toBe("p1");
     });
     it("returns null for a genuinely new row", () => {
       expect(matchAgainstCatalog({ sku: "NEW-1", name: "New" }, live)).toBeNull();
     });
   });

   describe("classifyCard", () => {
     it("classifies a match as show-diff by default", () => {
       expect(classifyCard({ sku: "SHGL-30", name: "30yr Shingle", basePrice: 99 }, live).mode)
         .toBe("diff");
     });
     it("classifies a new row as create", () => {
       expect(classifyCard({ sku: "NEW-1", name: "New" }, live).mode).toBe("create");
     });
     it("attaches the target id + changed fields on a diff", () => {
       const c = classifyCard({ sku: "SHGL-30", name: "30yr Shingle", basePrice: 99 }, live);
       expect(c.targetId).toBe("p1");
       expect(c.changedFields).toContain("basePrice");
     });
   });

   describe("dedupeReRun (idempotency)", () => {
     it("re-importing the SAME rows produces zero creates (all merge to self)", () => {
       const reimport = [{ sku: "SHGL-30", name: "30yr Shingle", externalId: "qb-100", basePrice: 95 }];
       const result = dedupeReRun(reimport, live);
       expect(result.creates).toHaveLength(0);
       expect(result.merges).toHaveLength(1);
       expect(result.merges[0].targetId).toBe("p1");
     });
   });
   ```
2. Run — expect fail.
3. Impl: `normalizeKey` (lower+trim); `matchAgainstCatalog` precedence **externalId → sku → name** (externalId wins so a renamed/re-SKU'd row still re-syncs — this is the won-conversion-class fix); `classifyCard` returns `{ mode: "create"|"diff", targetId?, changedFields[] }` diffing only the fields the card carries; `dedupeReRun` partitions into `{ creates, merges }`. Run — green.
4. Add `applyDiffSelection(card, fieldChoices)` — show-diff per-field accept: only operator-accepted fields land in the merge payload; unaccepted fields keep the live value. Test (accept basePrice only → payload has basePrice, omits name), impl, green.
5. Add `mergeAll(card)` (accept every changed field) and `skip(card)` (mode `skip`, excluded from commit). Test both, impl, green.
6. Commit: `feat(catalog-wizard): show-diff dedupe with external_id re-sync`.

---

### Task 6.7: Online-status hook + offline fallback resolver

Spec §16 "Offline" + "Agent off" + "Agent failure mid-session". Offline → detect, surface `[ OFFLINE — SWITCH TO GUIDED SETUP ]`, hold commits. Agent off / failed → deterministic survey + template + manual stand alone; every already-accepted card is preserved; no data loss. Split into (a) a reusable `use-online-status` hook and (b) a pure driver-resolver.

**Skills:** none (hook + pure TDD).
**Files:**
- Create `src/lib/hooks/use-online-status.ts`
- Create `src/lib/hooks/use-online-status.test.ts`
- Create `src/lib/catalog-setup/agent-fallback.ts`
- Create `src/lib/catalog-setup/agent-fallback.test.ts`

**Design tokens:** n/a.

Steps:
1. Failing test for the hook (jsdom dispatches `online`/`offline` events; `navigator.onLine` is settable):
   ```ts
   import { describe, it, expect, afterEach } from "vitest";
   import { renderHook, act } from "@testing-library/react";
   import { useOnlineStatus } from "./use-online-status";

   afterEach(() => {
     Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
   });

   describe("useOnlineStatus", () => {
     it("reports the initial navigator.onLine value", () => {
       Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
       const { result } = renderHook(() => useOnlineStatus());
       expect(result.current).toBe(false);
     });
     it("updates to false on an offline event", () => {
       const { result } = renderHook(() => useOnlineStatus());
       expect(result.current).toBe(true);
       act(() => { window.dispatchEvent(new Event("offline")); });
       expect(result.current).toBe(false);
     });
     it("updates to true on an online event", () => {
       Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
       const { result } = renderHook(() => useOnlineStatus());
       act(() => { window.dispatchEvent(new Event("online")); });
       expect(result.current).toBe(true);
     });
   });
   ```
2. Run `npm test -- run src/lib/hooks/use-online-status.test.ts` — expect fail.
3. Impl `useOnlineStatus()`: `useState(() => navigator.onLine)`, `useEffect` subscribing to `online`/`offline`, cleanup on unmount. Run — green.
4. Failing test for the pure resolver:
   ```ts
   import { describe, it, expect } from "vitest";
   import { resolveDriver } from "./agent-fallback";

   describe("resolveDriver", () => {
     it("uses the agent when online + enabled + no error", () => {
       expect(resolveDriver({ online: true, agentEnabled: true, agentErrored: false }))
         .toBe("agent");
     });
     it("falls back to guided when offline", () => {
       expect(resolveDriver({ online: false, agentEnabled: true, agentErrored: false }))
         .toBe("guided");
     });
     it("falls back to guided when the agent is disabled", () => {
       expect(resolveDriver({ online: true, agentEnabled: false, agentErrored: false }))
         .toBe("guided");
     });
     it("falls back to guided after an agent error mid-session", () => {
       expect(resolveDriver({ online: true, agentEnabled: true, agentErrored: true }))
         .toBe("guided");
     });
   });
   ```
5. Run — fail.
6. Impl `resolveDriver({ online, agentEnabled, agentErrored })` → `agent` only when `online && agentEnabled && !agentErrored`, else `guided`. Run — green.
7. Add `commitsHeld(online): boolean` (= `!online`) — offline holds BUILD IT; and `preserveAcceptedOnFailure(prevAccepted, _err)` returning `prevAccepted` unchanged (the no-data-loss guarantee — a one-liner with a test that asserts referential preservation). Test both, impl, green.
8. Commit: `feat(catalog-wizard): online-status hook + agent fallback resolver`.

---

### Task 6.8: `wizard_analytics` event builder + dispatcher

Spec §16 "Analytics on every step": `shown / started / step_completed / skipped / abandoned / completed`. Reuse the existing `wizard_analytics` table (web-ready columns + new `company_id` from 6.1) — NOT a web equivalent (verified the table fits: `platform`, `wizard_id`, `session_id`, `event`, `step_id/index`, `is_restart`, `trigger_type/context`, `duration_ms`, `steps_skipped`, `total_steps`). Pure builder + a service dispatcher (fire-and-forget, never throws into the UI).

**Skills:** none (pure TDD + mocked service).
**Files:**
- Create `src/lib/catalog-setup/analytics.ts`
- Create `src/lib/catalog-setup/analytics.test.ts`
- Create `src/lib/hooks/use-catalog-setup-analytics.ts`

**Design tokens:** n/a.

Steps:
1. Failing test for the builder:
   ```ts
   import { describe, it, expect } from "vitest";
   import { buildAnalyticsEvent, WIZARD_ID } from "./analytics";

   const base = {
     companyId: "co-1", userId: "u-1", sessionId: "cw_abc",
     totalSteps: 4,
   };

   describe("buildAnalyticsEvent", () => {
     it("builds a 'shown' row with the wizard id + platform web", () => {
       const row = buildAnalyticsEvent({ ...base, event: "shown",
         triggerType: "first_run_takeover", triggerContext: "catalog_0_0" });
       expect(row).toMatchObject({
         wizard_id: WIZARD_ID, platform: "web", event: "shown",
         company_id: "co-1", user_id: "u-1", session_id: "cw_abc",
         trigger_type: "first_run_takeover", trigger_context: "catalog_0_0",
         total_steps: 4,
       });
     });
     it("includes step_id/step_index for step_completed", () => {
       const row = buildAnalyticsEvent({ ...base, event: "step_completed",
         stepId: "SELL", stepIndex: 0 });
       expect(row).toMatchObject({ event: "step_completed", step_id: "SELL", step_index: 0 });
     });
     it("includes duration_ms + steps_skipped on completed", () => {
       const row = buildAnalyticsEvent({ ...base, event: "completed",
         durationMs: 42000, stepsSkipped: 1, isRestart: false });
       expect(row).toMatchObject({ event: "completed", duration_ms: 42000, steps_skipped: 1, is_restart: false });
     });
     it("rejects an unknown event at the type level (runtime guard)", () => {
       // @ts-expect-error invalid event
       expect(() => buildAnalyticsEvent({ ...base, event: "bogus" })).toThrow();
     });
   });
   ```
2. Run — fail.
3. Impl: `WIZARD_ID = "catalog_setup"`; `WizardAnalyticsEvent = "shown"|"started"|"step_completed"|"skipped"|"abandoned"|"completed"`; `buildAnalyticsEvent(input)` maps camelCase input to the snake_case `wizard_analytics` Insert shape, sets `platform: "web"`, validates `event` against the union (throw on unknown). Run — green.
4. Failing test for the dispatcher (mock the supabase insert):
   ```ts
   import { describe, it, expect, vi, beforeEach } from "vitest";
   const insert = vi.fn().mockResolvedValue({ error: null });
   vi.mock("@/lib/supabase/helpers", () => ({
     requireSupabase: () => ({ from: () => ({ insert }) }),
   }));
   import { dispatchWizardEvent } from "./analytics";

   beforeEach(() => insert.mockClear());

   describe("dispatchWizardEvent", () => {
     it("inserts the built row into wizard_analytics", async () => {
       await dispatchWizardEvent({ companyId: "co", userId: "u", sessionId: "cw_x",
         totalSteps: 4, event: "started" });
       expect(insert).toHaveBeenCalledTimes(1);
       expect(insert.mock.calls[0][0]).toMatchObject({ event: "started", platform: "web" });
     });
     it("never throws on insert error (fire-and-forget)", async () => {
       insert.mockResolvedValueOnce({ error: new Error("boom") });
       await expect(dispatchWizardEvent({ companyId: "co", userId: "u",
         sessionId: "cw_x", totalSteps: 4, event: "shown" })).resolves.toBeUndefined();
     });
   });
   ```
5. Run — fail. Impl `dispatchWizardEvent` = `buildAnalyticsEvent` → `requireSupabase().from("wizard_analytics").insert(...)`, swallow errors (console.warn, never throw — analytics must never break the wizard). Run — green.
6. Create `use-catalog-setup-analytics.ts`: a hook returning `{ trackShown, trackStarted, trackStepCompleted, trackSkipped, trackAbandoned, trackCompleted }`, each closing over the live company/user/session/totalSteps and calling `dispatchWizardEvent`; `trackAbandoned` is wired to a `beforeunload` + route-change effect (best-effort). (Hook is thin glue — covered by the E2E network assertion in 6.13, no separate unit test needed per YAGNI.)
7. Commit: `feat(catalog-wizard): wizard_analytics event builder + dispatcher`.

---

### Task 6.9: Company-scoped completion + notification

Spec §6 + §16 "Completion": company-scoped flag `company_settings.catalog_setup_completed_at` (NOT user-scoped `setup_progress`); the always-honest "data exists" signal (supply strip leaves 0/0); on finish a Sonner toast + a header-rail notification (`OPEN CATALOG →`). Copy from §14. (If P5 already writes the completion flag inside `catalog_setup_save`'s caller, this task ADDS the notification + toast + re-entry flip; otherwise it owns the whole completion service.)

**Skills:** `ops-copywriter` (notification title/body/action + toast), `audit-design-system` (the toast surface only — Sonner styling must trace to `.glass-dense`).
**Files:**
- Create or Modify `src/lib/api/services/catalog-setup-completion.ts`
- Create `src/lib/api/services/catalog-setup-completion.test.ts`

**Design tokens:** toast = `.glass-dense`; title Cake Mono Light UPPERCASE; counts JetBrains Mono `tnum`+`zero`; `OPEN CATALOG →` is the action label (no accent — secondary); icon lucide `PackageCheck` 20px monochrome `currentColor`.

Steps:
1. Failing test — completion writes the flag + dispatches the rail notification (mock supabase):
   ```ts
   import { describe, it, expect, vi } from "vitest";
   const update = vi.fn().mockResolvedValue({ error: null });
   const insert = vi.fn().mockResolvedValue({ error: null });
   const eq = vi.fn(() => ({ }));
   vi.mock("@/lib/supabase/helpers", () => ({
     requireSupabase: () => ({
       from: (t: string) => t === "company_settings"
         ? { update: () => ({ eq: () => update() }) }
         : { insert },
     }),
   }));
   import { buildCompletionNotification } from "@/lib/api/services/catalog-setup-completion";

   describe("buildCompletionNotification", () => {
     it("formats the rail notification from final counts (OPS voice)", () => {
       const n = buildCompletionNotification({
         userId: "u", companyId: "co", productCount: 24, stockCount: 12,
       });
       expect(n).toMatchObject({
         type: "system", title: "Catalog ready",
         body: "Your price book is live. 24 products, 12 in stock.",
         action_url: "/catalog", action_label: "OPEN CATALOG",
         persistent: false, is_read: false, company_id: "co", user_id: "u",
       });
     });
     it("omits the stock clause when nothing is tracked", () => {
       const n = buildCompletionNotification({ userId: "u", companyId: "co",
         productCount: 24, stockCount: 0 });
       expect(n.body).toBe("Your price book is live. 24 products.");
     });
   });
   ```
2. Run — fail.
3. Impl `buildCompletionNotification(counts)` → the notification row (type `system` to stay additive; if P1 added a `catalog_ready` `NotificationType` value, switch to it then — flag at execution time). Compose the body with correct pluralization + conditional stock clause. **Run `ops-copywriter`** to finalize "Catalog ready" / body wording. Run — green.
4. Add `markCatalogSetupComplete({ companyId, userId, counts })`: writes `company_settings.catalog_setup_completed_at = now()` (idempotent — re-run does not double-fire the notification: guard on the flag being null before dispatching). Test (a) flag write called once, (b) notification NOT re-dispatched when the flag was already set. Impl, green.
5. Add `shouldShowFirstRunTakeover(completedAt, productCount, stockCount): boolean` = `completedAt == null && productCount === 0 && stockCount === 0` — re-entry flips from takeover to "add more / edit" once complete (spec §16 "Re-run"). Test 3 cases (fresh → true; completed → false; has-data-no-flag → false). Impl, green.
6. Commit: `feat(catalog-wizard): company-scoped completion flag + rail notification`.

---

### Task 6.10: Prerequisite gate + offline banner components

UI for 6.2 and 6.7. The prerequisite gate renders the blocking reason as a calm, honest panel (never a crash); the offline banner surfaces `[ OFFLINE — SWITCH TO GUIDED SETUP ]` and is the visual signal that commits are held.

**Skills:** `interface-design` + `frontend-design`, `ops-copywriter` (every string), `animation-architect` + `web-animations` (banner entrance), `audit-design-system` (DONE-GATE).
**Files:**
- Create `src/components/catalog-setup/prerequisite-gate.tsx`
- Create `src/components/catalog-setup/offline-banner.tsx`
- Create `src/components/catalog-setup/__tests__/prerequisite-gate.test.tsx`
- Create `src/components/catalog-setup/__tests__/offline-banner.test.tsx`

**Design tokens:** gate panel `.glass` radius 10, title Cake Mono Light UPPERCASE `#EDEDED`, body Mohave `#B5B5B5`; offline bar radius 2, border-only `tan #C4A868` (attention, not error), label Cake Mono Light `[ OFFLINE — SWITCH TO GUIDED SETUP ]`, lucide `WifiOff` 16px; no accent anywhere here (accent is BUILD IT only); entrance = 250ms y-slide `cubic-bezier(0.22,1,0.36,1)`, `prefers-reduced-motion` → opacity-only.

Steps:
1. Failing component test for the gate:
   ```tsx
   import { describe, it, expect } from "vitest";
   import { render, screen } from "@testing-library/react";
   import { PrerequisiteGate } from "../prerequisite-gate";

   describe("PrerequisiteGate", () => {
     it("renders children when there is no blocker", () => {
       render(<PrerequisiteGate blocker={null}><div>WIZARD</div></PrerequisiteGate>);
       expect(screen.getByText("WIZARD")).toBeInTheDocument();
     });
     it("renders the catalog-surface reason instead of children", () => {
       render(<PrerequisiteGate blocker="catalog_surface_absent"><div>WIZARD</div></PrerequisiteGate>);
       expect(screen.queryByText("WIZARD")).not.toBeInTheDocument();
       expect(screen.getByText(/catalog/i)).toBeInTheDocument();
     });
     it("shows a subscription-lockout reason", () => {
       render(<PrerequisiteGate blocker="subscription_locked" />);
       expect(screen.getByText(/subscription/i)).toBeInTheDocument();
     });
   });
   ```
2. Run — fail. Impl `PrerequisiteGate`: `blocker == null` → render `children`; else a `.glass` panel with a per-reason title+body map (copy via ops-copywriter, e.g. `subscription_locked → "// SUBSCRIPTION REQUIRED"` + body). Run — green.
3. Failing component test for the offline banner:
   ```tsx
   import { describe, it, expect } from "vitest";
   import { render, screen } from "@testing-library/react";
   import { OfflineBanner } from "../offline-banner";

   describe("OfflineBanner", () => {
     it("renders nothing when online", () => {
       const { container } = render(<OfflineBanner online />);
       expect(container).toBeEmptyDOMElement();
     });
     it("shows the switch-to-guided message when offline", () => {
       render(<OfflineBanner online={false} />);
       expect(screen.getByText("[ OFFLINE — SWITCH TO GUIDED SETUP ]")).toBeInTheDocument();
     });
   });
   ```
4. Run — fail. Impl `OfflineBanner`: `online` → `null`; else the `tan`-bordered bar with the exact string + `WifiOff` icon, `motion.div` entrance honoring reduced motion. Run — green.
5. Run `audit-design-system` against both files — fix any hardcoded hex/spacing/radius/font to token references until it passes. Commit only after the audit is green.
6. Commit: `feat(catalog-wizard): prerequisite gate + offline banner`.

---

### Task 6.11: BUILD IT button (disabled-with-reason) + inventory-off prompt

Spec §16 "Required-field stalls" (BUILD IT shows the blocker, never silently disabled) + "Inventory off but stock arrives" (one-time track-inventory? prompt; declined → stock down-shifts to products-only, quantities surfaced not dropped). (If P5 created `build-it-button.tsx`, MODIFY it to wire the 6.5 blocker message + 6.7 offline hold; otherwise create it.)

**Skills:** `interface-design` + `frontend-design`, `ops-copywriter`, `animation-architect` + `web-animations` (count-up on the running totals), `audit-design-system` (DONE-GATE).
**Files:**
- Create or Modify `src/components/catalog-setup/build-it-button.tsx`
- Create `src/components/catalog-setup/inventory-off-prompt.tsx`
- Create `src/components/catalog-setup/__tests__/build-it-button.test.tsx`
- Create `src/components/catalog-setup/__tests__/inventory-off-prompt.test.tsx`

**Design tokens:** BUILD IT = THE one accent element — outlined `text-ops-accent border-ops-accent` radius 5 min-h 36 → fills `bg-ops-accent text-black` on hover; label Cake Mono Light `BUILD IT`; blocker reason rendered beside it in `rose #B58289` border-only chip (radius 4) with JetBrains Mono count; offline-held state = same disabled treatment with the tan offline reason; inventory prompt = `.glass-dense` modal radius 12, no exclamation, `Track inventory?` (sentence case content) with `TRACK` / `KEEP AS PRODUCTS` choices (neither is accent — this is a fork, not a primary CTA).

Steps:
1. Failing test for the button states:
   ```tsx
   import { describe, it, expect, vi } from "vitest";
   import { render, screen, fireEvent } from "@testing-library/react";
   import { BuildItButton } from "../build-it-button";

   describe("BuildItButton", () => {
     it("is enabled and fires onBuild when there are no blockers and online", () => {
       const onBuild = vi.fn();
       render(<BuildItButton blockerMessage={null} online onBuild={onBuild} />);
       const btn = screen.getByRole("button", { name: /build it/i });
       expect(btn).toBeEnabled();
       fireEvent.click(btn);
       expect(onBuild).toHaveBeenCalledTimes(1);
     });
     it("shows the precise blocker reason and does not fire when blocked", () => {
       const onBuild = vi.fn();
       render(<BuildItButton blockerMessage="// 3 ROWS NEED A PRICE" online onBuild={onBuild} />);
       expect(screen.getByText("// 3 ROWS NEED A PRICE")).toBeInTheDocument();
       fireEvent.click(screen.getByRole("button", { name: /build it/i }));
       expect(onBuild).not.toHaveBeenCalled();
     });
     it("holds the commit and explains why when offline", () => {
       const onBuild = vi.fn();
       render(<BuildItButton blockerMessage={null} online={false} onBuild={onBuild} />);
       expect(screen.getByText(/offline/i)).toBeInTheDocument();
       fireEvent.click(screen.getByRole("button", { name: /build it/i }));
       expect(onBuild).not.toHaveBeenCalled();
     });
   });
   ```
2. Run — fail. Impl `BuildItButton({ blockerMessage, online, onBuild })`: enabled only when `blockerMessage == null && online`; otherwise rendered with `aria-disabled` + a visible reason (`blockerMessage` or the offline hold copy) — NEVER a bare disabled button with no explanation; click is a no-op when blocked. Run — green.
3. Failing test for the inventory-off prompt:
   ```tsx
   import { describe, it, expect, vi } from "vitest";
   import { render, screen, fireEvent } from "@testing-library/react";
   import { InventoryOffPrompt } from "../inventory-off-prompt";

   describe("InventoryOffPrompt", () => {
     it("offers track vs keep-as-products when stock arrives with inventory off", () => {
       render(<InventoryOffPrompt open stockItemCount={5} onTrack={() => {}} onKeepAsProducts={() => {}} />);
       expect(screen.getByText(/track inventory/i)).toBeInTheDocument();
       expect(screen.getByRole("button", { name: /track/i })).toBeInTheDocument();
       expect(screen.getByRole("button", { name: /keep as products/i })).toBeInTheDocument();
     });
     it("fires onKeepAsProducts (quantities surfaced, not silently dropped)", () => {
       const onKeep = vi.fn();
       render(<InventoryOffPrompt open stockItemCount={5} onTrack={() => {}} onKeepAsProducts={onKeep} />);
       fireEvent.click(screen.getByRole("button", { name: /keep as products/i }));
       expect(onKeep).toHaveBeenCalledTimes(1);
     });
   });
   ```
4. Run — fail. Impl `InventoryOffPrompt` (Radix Dialog `.glass-dense`): copy via ops-copywriter, the count rendered in JetBrains Mono, two non-accent choices. Run — green.
5. Run `audit-design-system` on both files — confirm BUILD IT is the only accent element, the rose/tan reason chips are border-only, no shadows, all values token-traced. Fix to green.
6. Commit: `feat(catalog-wizard): BUILD IT reason states + inventory-off prompt`.

---

### Task 6.12: Vitest coverage sweep for the pure-function surface

Spec test strategy: "vitest unit coverage for all pure functions (reducers, mappers, dedupe, payload builder, schema validators)". Tasks 6.2–6.9 already TDD the Phase-6-owned pure functions. This task closes the gap on P3–P5 pure functions that lack tests and asserts a coverage floor so the wizard's logic core is fully covered.

**Skills:** none (TDD backfill).
**Files:**
- Modify/Create tests under `src/lib/catalog-setup/*.test.ts` for any P3–P5 pure module without a sibling test (e.g. the survey reducer, CSV/XLSX mapper, `catalog_setup_save` payload builder, schema validators, vocabulary pre-resolver). Exact paths depend on P3–P5 file names — enumerate at execution time.

**Design tokens:** n/a.

Steps:
1. Enumerate the pure-function surface: `npm test -- run --coverage` then read the v8 coverage report; list every file under `src/lib/catalog-setup/` (and the source mappers) with <100% line coverage or no test file. (Expected output: a coverage table; record the gaps.)
2. For EACH uncovered pure module, in its own commit: write the failing test(s) for the untested branches (happy + each edge), run (fail), confirm the existing impl passes them (no impl change — these are already-built P3–P5 functions; if a test reveals a real bug, fix it minimally and note it), run (green). Prioritize: payload builder (the `catalog_setup_save` jsonb shape — every mode `create`/`edit`, client ids, `deleted_ids`), the CSV/XLSX mapper (family grouping, header alias, name→category/unit resolution), the survey→module-plan reducer, schema validators.
3. Re-run `npm test -- run --coverage` — assert the `src/lib/catalog-setup/**` line coverage is ≥ 95% (record the number; if a branch is genuinely untestable, justify with an inline comment).
4. Commit each module's tests separately: `test(catalog-wizard): cover <module> pure functions`.

**Confirm at execution time:** the precise filenames + signatures from P3–P5 (read the actual files before writing tests — do not assume signatures).

---

### Task 6.13: Component tests for the canvas + cards

Spec test strategy: "component tests for the canvas/cards". The accept/edit/reject card and the live-building canvas (running counter `N proposed · M added`, module grouping) are P2 artifacts; this task adds their behavioral component tests (the gate/offline/build-it/inventory components are already tested in 6.10–6.11).

**Skills:** `audit-design-system` (DONE-GATE re-run on the canvas/card if any token drift is found while testing).
**Files:**
- Create `src/components/catalog-setup/__tests__/canvas.test.tsx`
- Create `src/components/catalog-setup/__tests__/proposal-card.test.tsx`
(exact component paths from P2 — confirm at execution time.)

**Design tokens:** assert presentational invariants only via accessible queries (not hex) — accept→olive confirm, reject removes the card, counter increments; trust `audit-design-system` for token correctness.

Steps:
1. Failing test — card accept/edit/reject:
   - `accept` calls `onAccept(card.id)` and moves the card into the added group;
   - `reject` calls `onReject(card.id)` and removes it from the canvas;
   - `edit` opens the inline editor and `onEdit` receives the patched fields;
   - a duplicate-match card renders in `diff` mode with per-field accept controls (ties to 6.6).
2. Run — fail. (Components exist from P2; tests assert their wired behavior. If a behavior is missing, that is a P2 gap — fix minimally here and note it.) Run — green.
3. Failing test — canvas counter: rendering N proposed + accepting M updates the running `N proposed · M added` (numbers in mono); module grouping shows SELL/STOCK/TYPES headers only for non-empty groups (skipped module → honest empty state, ties to §16 "Skip"). Run — fail → impl/wire → green.
4. If any token drift surfaces, run `audit-design-system` on the canvas/card and fix to green.
5. Commit: `test(catalog-wizard): canvas + proposal-card component behavior`.

---

### Task 6.14: Playwright E2E — happy path + top-4 failure modes

Spec test strategy: "Playwright E2E for the happy path + the top failure modes (resume, dedupe, offline, agent-off)". Playwright IS configured (`playwright.config.ts`, multi-browser, auto-starts dev server). Use the proven deterministic route-mock harness from `tests/e2e/won-conversion.spec.ts` / `pipeline-table.spec.ts`: seed auth, make the user a company admin so `catalog.run_setup`/`products.manage`/`inventory.manage` are satisfied without mocking the roles tables, and fulfill every wizard network dependency (feature-flags, agent stream, `catalog_setup_save`, dedupe preflight, analytics insert) at the route layer with fixtures — no live Supabase/Firebase, no real writes (prod is low-tenant + protected; a write-path E2E must never touch it).

**Skills:** none (E2E; the visual correctness is owned by `audit-design-system` on the component tasks).
**Files:**
- Create `tests/e2e/catalog-setup-wizard.spec.ts`
- Create `tests/e2e/helpers/catalog-setup-auth.ts` (seeded auth + shared route fixtures; mirror `tests/e2e/helpers/` + the won-conversion harness)

**Design tokens:** n/a.

Steps:
1. Create the helper: port the auth-seeding + Firebase-fallback + admin-role pattern from `won-conversion.spec.ts` (top of file) into `catalog-setup-auth.ts`, exporting `seedCatalogWizardAuth(page)` and `mockWizardRoutes(page, fixtures)` (feature-flags → `{ phase_c:false }` for the agent-off case / `true` otherwise; `POST /api/catalog-setup/agent` → streamed proposals or a 500; `POST .../commit` (catalog_setup_save) → records the payload + returns `id_map`/`counts`; dedupe preflight → matched/unmatched fixtures).
2. **Happy path** test: navigate to `/catalog` on a 0/0 company → first-run takeover → start guided → accept 2 SELL cards → BUILD IT → assert the commit route received a merge-capable payload (mode `edit`, client ids, stable `idempotency_key`) and the completion toast + rail notification appear, and a `completed` `wizard_analytics` insert was attempted. Run `npm run test:e2e -- catalog-setup-wizard` — iterate to green (Radix needs `PointerEvent`; resize viewport ≥768px for the desktop shell — both noted in memory).
3. **Resume** test: start a session, accept 1 card, reload the page → assert "pick up where you left off?" restores the staged canvas (persisted Zustand) with the accepted card still present and nothing committed (commit route never called pre-reload). Green.
4. **Dedupe** test: seed the dedupe preflight with a SKU match → assert the matched card renders in show-diff mode, accept one field, BUILD IT → assert the commit payload carries a merge (targetId set), not a second create. Green.
5. **Offline** test: `await page.context().setOffline(true)` → assert `[ OFFLINE — SWITCH TO GUIDED SETUP ]` appears, BUILD IT is held (commit route not called on click), then `setOffline(false)` → BUILD IT recovers. Green.
6. **Agent-off** test: feature-flags → `phase_c:false` AND force the agent route to 500 mid-session after 1 accepted card → assert the driver falls back to the guided survey, the already-accepted card is preserved (no data loss), and the wizard still reaches BUILD IT. Green.
7. Commit: `test(catalog-wizard): e2e happy path + resume/dedupe/offline/agent-off`.

**Confirm at execution time:** the exact wizard route paths (`/api/catalog-setup/*`) and the `/catalog` first-run entry selectors from P2/P4/P5 — read the real components/routes before writing selectors; do not assume.

---

### Task 6.15: Phase done-gate — design-system audit + full suite green

The §6/§13 enforcement: `audit-design-system` is the DONE-GATE for every UI surface, and the whole test suite must be green before Phase 6 is complete.

**Skills:** `audit-design-system` (final pass), `ops-copywriter` (final copy pass on any string not yet cleared).
**Files:** none new (verification + fixes only).

**Design tokens:** all of the above — the audit confirms zero hardcoded color/spacing/radius/font across every `src/components/catalog-setup/**` file Phase 6 created or modified.

Steps:
1. Run `audit-design-system` across `src/components/catalog-setup/` (gate, offline banner, BUILD IT, inventory prompt, plus any canvas/card touched here). Record findings; fix every hardcoded value to a token reference; re-run until clean. Commit fixes as `fix(catalog-wizard): design-system audit corrections`.
2. Confirm every user-facing string went through `ops-copywriter` (blocker messages, offline copy, inventory prompt, completion notification, gate reasons). Fix any stragglers.
3. Run the full unit/component suite: `npm test -- run` — expect all Phase-6 files green (`Test Files N passed`). Note: per memory, ops-web CI is red on main from pre-existing lint; verify locally and do not claim "CI passed" — claim "local suite green" with the count.
4. Run `npm run type-check` — expect no new errors from Phase 6 files.
5. Run `npm run test:e2e -- catalog-setup-wizard` — expect the 5 scenarios pass on chromium (the canonical CI browser).
6. Final commit if any fixes landed: `chore(catalog-wizard): phase 6 done-gate (audit + suite green)`.

**Confirm at execution time:** whether `next lint` errors in touched files are pre-existing (compare against the base) — fix Phase-6-introduced lint, leave pre-existing alone (do not step on sibling WIP).
