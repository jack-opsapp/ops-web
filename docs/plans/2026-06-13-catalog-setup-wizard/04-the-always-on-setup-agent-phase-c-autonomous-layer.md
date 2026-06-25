## Phase 4: The Always-On Setup Agent (+ Phase C autonomous layer)

**Goal.** Stand up the dedicated, narrow, **suggest-only**, **ungated** Setup Agent that helps any company build its catalog: (1) converse to generate from a description, (2) enrich imported/CSV rows with options/tiers/recipes/types that import can't express, and (3) extract rows from an uploaded PDF price list / photo of a parts list / pasted text. Every proposal is schema-validated by a PURE validator **before** it can become a card; the agent never writes — proposals land as accept/edit/reject cards on the **same** staging canvas the deterministic sources feed (Phase 1), and the owner's accepted set still commits through Phase 3's `catalog_setup_save`. Graceful degradation: offline / declined / model-failure falls back to the deterministic survey + template + manual with **zero data loss**. The **Phase C autonomous layer is gated** and pre-stages a whole proposed catalog through the existing `agent_actions` approval queue.

**Skills (invoke at build, by exact name — non-negotiable).** `vercel:ai-sdk` (streaming + structured output; fetch live model IDs; search `node_modules/ai/docs`), `claude-api` (model `claude-opus-4-8`, adaptive thinking, structured outputs via `output_config.format`/`messages.parse`, vision/document input), `ops-copywriter` (every agent-facing string — "guided setup" / describe-the-behavior, **never** "AI", audience-language rules: subtrades / owner-operators / the trades / crews — never "contractor"), `frontend-design` + `interface-design` (agent conversation pane + proposal-stream affordance), `animation-architect` then `elite-animations`/`web-animations` (proposal-arrival motion), `audit-design-system` (done-gate).

**Design tokens (for all UI tasks; cite specifics — never hardcode).** Full-page **glass-surface** on `#000`; inner dialogs `.glass-dense`. Cake Mono Light UPPERCASE (`font-cakemono font-light`) for pane/step titles + badges (28–32px display); Mohave (`font-mohave`) sentence-case for the conversation body; JetBrains Mono (`font-mono`, `tnum`/`zero`) for all numbers/prices/counters (11px floor). Accent `#6F94B0` (`ops-accent`) on the single primary CTA + focus rings ONLY — never on the stepper, the upload affordance, the offline banner, or proposal cards. Earth-tone semantics: `olive #9DB582` = proposal accepted/added, `tan #C4A868` = needs-review/attention, `rose #B58289` = cost/error. Radii: buttons/inputs 5px (`rounded-[5px]`), chips 4px (`rounded-chip`), panels 10px (`rounded-panel`), dialogs 12px (`rounded-modal`). One easing `cubic-bezier(0.22,1,0.36,1)` (`EASE_SMOOTH`), no spring/bounce; honor `prefers-reduced-motion`. Icons `lucide-react` only. Empty/zero = `—` / `$0`, never "N/A". No touch targets on web (sizing traces to DESIGN.md, not 44px).

> **Execution-time reconciliation reminders.** (a) Phases 1–3 do not yet exist in the worktree — every reference to the canvas store (`useCatalogSetupStore`), the card type (`CatalogCard`/`CatalogProposal`), and the `catalog_setup_save` payload row shape is an **integration point**: read the real Phase-1/3 types before writing imports and adapt names. (b) The `ai` / `@ai-sdk/anthropic` packages are **not installed** — Task 4.1 installs them; fetch live versions/model IDs then. (c) The Catalog surface lives only on `feat/web-overhaul` today; the wizard rebases onto the P3-2 base before build. (d) The permission bit `catalog.run_setup` and the `external_source`/`external_id` columns come from Phase 0 — this phase consumes them.

---

### Task 4.1: Install AI dependencies + wire the model/provider config (no secrets in client)

**Skills:** vercel:ai-sdk, claude-api.
**Files:**
- Modify `package.json` (add `ai`, `@ai-sdk/anthropic`; add `@ai-sdk/react` only if the pane uses `useChat`).
- Create `src/lib/catalog-setup/agent/model.ts`.
- Create `src/lib/catalog-setup/agent/__tests__/model.test.ts`.
- Modify `.env.local.example` (add `ANTHROPIC_API_KEY`) and `CLAUDE.md` Product Environment Variables table.

**Decisions already locked.** Model defaults to `claude-opus-4-8` with **adaptive thinking** (claude-api skill: do not set `budget_tokens`, do not set `temperature`/`top_p`/`top_k` — they 400). `ANTHROPIC_API_KEY` is **server-only** (never `NEXT_PUBLIC_`). Streaming is mandatory for proposal generation (long output).

**Steps (TDD, 2–5 min each, commit after each green):**

1. Install only the AI SDK first (per vercel:ai-sdk prereq): run `npm i ai @ai-sdk/anthropic` in the worktree (use `npm` — turbopack note in CLAUDE memory; dev uses webpack). Then in `node_modules/ai/docs` run `grep -rl "streamObject" node_modules/ai/docs/` and `grep -rl "anthropic(" node_modules/@ai-sdk/anthropic/docs/` to confirm the current API surface before writing code. Expected: at least one match each. Commit `chore(catalog-setup): add ai + @ai-sdk/anthropic deps`.
2. Fetch the live Claude model IDs (vercel:ai-sdk rule 7): `curl -s https://ai-gateway.vercel.sh/v1/models | jq -r '[.data[] | select(.id | startswith("anthropic/")) | .id] | reverse | .[]'`. Confirm `anthropic/claude-opus-4-8` (or the gateway form) exists; the claude-api skill is authoritative that the bare model id is `claude-opus-4-8`. Note the exact provider-prefixed id for `model.ts`.
3. Write a failing test `model.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { SETUP_AGENT_MODEL_ID, getSetupAgentModel } from "../model";

describe("setup agent model config", () => {
  it("defaults to claude-opus-4-8", () => {
    expect(SETUP_AGENT_MODEL_ID).toContain("claude-opus-4-8");
  });
  it("never date-suffixes the model id", () => {
    expect(SETUP_AGENT_MODEL_ID).not.toMatch(/claude-opus-4-8-\d{8}/);
  });
  it("exposes a provider model instance", () => {
    expect(getSetupAgentModel()).toBeTruthy();
  });
});
```
Run `npm test -- src/lib/catalog-setup/agent/__tests__/model.test.ts`. Expected: fails (module missing).
4. Implement `model.ts` (minimal, AI SDK form — verify against `node_modules/ai/docs` before finalizing):
```ts
import { anthropic } from "@ai-sdk/anthropic";

// Single source of truth. claude-api skill: bare id, no date suffix, adaptive thinking.
export const SETUP_AGENT_MODEL_ID = "claude-opus-4-8" as const;

export function getSetupAgentModel() {
  // Reads ANTHROPIC_API_KEY from the server env automatically.
  return anthropic(SETUP_AGENT_MODEL_ID);
}
```
Run the test. Expected: passes. Commit `feat(catalog-setup): setup-agent model/provider config`.
5. Add `ANTHROPIC_API_KEY` to `.env.local.example` with a one-line comment ("server-only; powers guided-setup proposal generation + document extraction; never NEXT_PUBLIC"). Add the matching row to the CLAUDE.md Product Environment Variables table. Verify no `NEXT_PUBLIC_ANTHROPIC` anywhere: `grep -rn "NEXT_PUBLIC_ANTHROPIC" src` → expected no matches. Commit `docs(catalog-setup): document ANTHROPIC_API_KEY`.

**Acceptance:** deps installed; `model.ts` is the single model-id source; key is server-only; tests green.
**Confirm at execution:** the exact provider-prefixed model id from the live gateway (step 2) vs the bare id; whether the pane will use `@ai-sdk/react` `useChat` (affects whether to install it now).

---

### Task 4.2: PURE proposal schemas (Zod) mirroring the card + commit row shape

**Skills:** claude-api (structured outputs), vercel:ai-sdk (Zod-driven `streamObject`).
**Files:** Create `src/lib/catalog-setup/agent/proposal-schemas.ts`; Create `src/lib/catalog-setup/agent/__tests__/proposal-schemas.test.ts`.

**Decisions already locked (spec §9, §10, §11).** Proposals come in three module shapes: **SELL** (writes `products`: name, description, `default_price`/`base_price`, `unit_cost`, `sku`, `is_taxable`, `kind` ∈ service|material|package, `type` ∈ LABOR|MATERIAL|OTHER, `pricing_unit`; optioned/tiered = `select` `product_options` + `product_option_values` + `add_flat` `product_pricing_modifiers`, base = lowest tier — **never `tiered_pricing`**); **STOCK** (writes `catalog_items` family + `catalog_variants`: `quantity`, `unit_cost_override`/`price_override`, `warning_threshold`/`critical_threshold`, `unit_id`; recipes → `product_materials` pinned to a concrete `catalog_variant_id`); **TYPES** (trade ∈ widened list from §9; task_types display/color/is_default/display_order). The schema must mirror the Phase-3 `catalog_setup_save` payload row shape so an accepted card commits without transformation.

**Steps (TDD):**

1. Read the real Phase-1 card type and Phase-3 payload shape first (`grep -rn "CatalogCard\|CatalogProposal\|catalog_setup_save" src/`). If absent (Phases 1/3 not yet landed), proceed against the spec §9/§11 shapes and leave a `// INTEGRATION: align with Phase 1 CatalogCard` marker — do not invent extra fields.
2. Write failing `proposal-schemas.test.ts` covering: a valid SELL flat-price proposal; a valid SELL tiered proposal (select option + add_flat values); a valid STOCK variant; a valid TYPES trade+task; and rejections — SELL with no price, SELL using a `tiered_pricing` field (must be **absent from the schema** so it's stripped/rejected), STOCK with no `unit_id`, TYPES with an out-of-list trade, an unknown `kind`/`type` enum. Example:
```ts
import { describe, it, expect } from "vitest";
import { CatalogProposalSchema, ProposalBatchSchema } from "../proposal-schemas";

const sellFlat = { module: "SELL", name: "Roof tune-up", default_price: 250, kind: "service", type: "LABOR", is_taxable: true };

describe("CatalogProposalSchema", () => {
  it("accepts a flat-priced SELL proposal", () => {
    expect(CatalogProposalSchema.safeParse(sellFlat).success).toBe(true);
  });
  it("rejects a SELL proposal with no price", () => {
    const { default_price, ...noPrice } = sellFlat;
    expect(CatalogProposalSchema.safeParse(noPrice).success).toBe(false);
  });
  it("has no tiered_pricing field (dead column)", () => {
    const withDead = { ...sellFlat, tiered_pricing: { a: 1 } };
    const r = CatalogProposalSchema.safeParse(withDead);
    // strict object → unknown key fails (or is stripped); assert it never round-trips
    expect(r.success && (r.data as Record<string, unknown>).tiered_pricing).toBeFalsy();
  });
  it("accepts a batch of proposals", () => {
    expect(ProposalBatchSchema.safeParse({ proposals: [sellFlat] }).success).toBe(true);
  });
});
```
Run `npm test -- src/lib/catalog-setup/agent/__tests__/proposal-schemas.test.ts`. Expected: fails.
3. Implement `proposal-schemas.ts`: `SellProposalSchema`, `StockProposalSchema`, `TypesProposalSchema` as `z.object({...}).strict()`, a `module` discriminant, `CatalogProposalSchema = z.discriminatedUnion("module", [...])`, and `ProposalBatchSchema = z.object({ proposals: z.array(CatalogProposalSchema) })`. Tier ladder modeled as `options?: { kind: "select"; values: { label: string; add_flat: number }[] }` — NO `tiered_pricing` field anywhere. Trade is `z.enum([...§9 list..., "general"])`. Recipe as `materials?: { catalog_variant_id: string; qty: number }[]` (concrete id required). No I/O, no defaults that hide missing data.
4. Run the test. Expected: passes. Commit `feat(catalog-setup): zod proposal schemas (no tiered_pricing)`.

**Acceptance:** schemas are PURE, strict, and structurally match the commit payload; `tiered_pricing` is structurally impossible.
**Confirm at execution:** final trade enum list (locks at plan time, §9); exact Phase-1 card field names.

---

### Task 4.3: PURE proposal validator (guardrails → cards that can't hard-fail on commit)

**Skills:** claude-api.
**Files:** Create `src/lib/catalog-setup/agent/proposal-validator.ts`; Create `src/lib/catalog-setup/agent/__tests__/proposal-validator.test.ts`.

**Decisions already locked (spec §16 war-game).** Beyond schema shape, the validator enforces commit-safety so no card hard-fails `catalog_setup_save`: SELL needs name **and** price; STOCK variant needs a `unit_id`; tier ladder must be a `select` option with `add_flat` values (base = lowest tier); a recipe must pin a concrete `catalog_variant_id` (a nil-selector family pin is silently dropped by `RecipeResolver` → reject it here with a precise message); trade must be in the widened allowed list; vocabulary references (category/unit) must be resolvable or markable-for-auto-create (Phase 3 pre-resolves). Output per-field errors so the card renders `// NEEDS A PRICE` etc. PURE — no DB calls; resolvability is checked against a passed-in `ctx` (known categories/units/variant ids) the caller supplies.

**Steps (TDD):**

1. Write failing `proposal-validator.test.ts`. Cover each rule as its own `it`:
```ts
import { describe, it, expect } from "vitest";
import { validateProposal } from "../proposal-validator";

const ctx = { knownUnitIds: new Set(["u1"]), knownVariantIds: new Set(["v1"]), allowedTrades: new Set(["roofing","hvac","plumbing","electrical","general"]) };

describe("validateProposal", () => {
  it("flags a SELL proposal missing a price", () => {
    const r = validateProposal({ module: "SELL", name: "X", kind: "service", type: "LABOR" } as any, ctx);
    expect(r.ok).toBe(false);
    expect(r.errors).toContainEqual(expect.objectContaining({ field: "default_price" }));
  });
  it("rejects a recipe with a nil/unknown variant pin", () => {
    const r = validateProposal({ module: "STOCK", name: "Shingle", unit_id: "u1", quantity: 0, materials: [{ catalog_variant_id: "ghost", qty: 1 }] } as any, ctx);
    expect(r.ok).toBe(false);
  });
  it("rejects an out-of-list trade", () => {
    const r = validateProposal({ module: "TYPES", trade: "underwater-basket-weaving" } as any, ctx);
    expect(r.ok).toBe(false);
  });
  it("passes a complete, resolvable SELL tiered proposal", () => {
    const r = validateProposal({ module: "SELL", name: "Install", default_price: 100, kind: "service", type: "LABOR", options: { kind: "select", values: [{ label: "S", add_flat: 0 }, { label: "L", add_flat: 50 }] } } as any, ctx);
    expect(r.ok).toBe(true);
  });
});
```
Run it. Expected: fails.
2. Implement `validateProposal(p, ctx): { ok: boolean; errors: { field: string; message: string }[] }` and `validateBatch(b, ctx)` (maps + aggregates). Messages are operator-facing seeds (UPPERCASE/`//` style applied at render via ops-copywriter, not hardcoded prose here). No I/O.
3. Run the test. Expected: passes. Commit `feat(catalog-setup): pure proposal validator (commit-safety guardrails)`.

**Acceptance:** every spec §16 per-card failure mode has a test; validator is PURE and deterministic.
**Confirm at execution:** whether vocabulary auto-create (Phase 3) means "unknown category" is a soft warning (markable) rather than a hard reject — align the `ctx` contract with Phase 3.

---

### Task 4.4: The Setup Agent system prompt (narrow, suggest-only, schema-aware)

**Skills:** claude-api (prompt design + caching: keep frozen/deterministic), ops-copywriter (any operator-visible phrasing the agent emits).
**Files:** Create `src/lib/catalog-setup/agent/system-prompt.ts`; Create `src/lib/catalog-setup/agent/__tests__/system-prompt.test.ts`.

**Decisions already locked (spec §10).** The agent's only job is standing up the operating system. It is **suggest-only** — it proposes cards and must NEVER claim to have saved/created anything. It speaks the OPS module model (SELL/STOCK/TYPES), the tier-ladder pricing contract, and audience language (subtrades / the trades / crews — never "contractor"). It must produce output conforming to `ProposalBatchSchema`. The prompt is frozen (no per-request interpolation of dates/ids → prompt-cache safe, claude-api skill).

**Steps (TDD):**

1. Write failing `system-prompt.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { SETUP_AGENT_SYSTEM_PROMPT } from "../system-prompt";

describe("setup agent system prompt", () => {
  it("instructs suggest-only (never claims to save)", () => {
    expect(SETUP_AGENT_SYSTEM_PROMPT).toMatch(/propose|suggest/i);
    expect(SETUP_AGENT_SYSTEM_PROMPT).toMatch(/never (say|claim).*saved|do not .*write/i);
  });
  it("bans the word contractor", () => {
    expect(SETUP_AGENT_SYSTEM_PROMPT.toLowerCase()).not.toContain("contractor");
  });
  it("encodes the tier ladder (add_flat, not tiered_pricing)", () => {
    expect(SETUP_AGENT_SYSTEM_PROMPT).toMatch(/add_flat/);
    expect(SETUP_AGENT_SYSTEM_PROMPT).not.toMatch(/tiered_pricing/);
  });
  it("has no interpolated date/uuid (cache-safe)", () => {
    expect(SETUP_AGENT_SYSTEM_PROMPT).not.toMatch(/\$\{/);
  });
});
```
Run it. Expected: fails.
2. Implement `system-prompt.ts` as a single frozen template literal export (no interpolation). Content: role/scope, suggest-only rule, the SELL/STOCK/TYPES model, the pricing contract (lowest tier = base, size deltas via `add_flat` modifiers), recipe rule (pin a concrete variant), trade list, audience language, and "emit proposals matching the provided schema; if you can't fill a required field, say so rather than guessing." Run the test. Expected: passes.
3. Commit `feat(catalog-setup): setup-agent system prompt`.

**Acceptance:** prompt is frozen, suggest-only, schema-aware, audience-compliant; tests green.
**Confirm at execution:** final trade list; whether ops-copywriter wants to tune any operator-visible phrasing the agent surfaces verbatim.

---

### Task 4.5: Streaming generate route (conversational generate + enrich) — auth + per-proposal validation

**Skills:** vercel:ai-sdk (`streamObject` + the framework streaming response helper), claude-api (adaptive thinking, structured output).
**Files:** Create `src/app/api/catalog-setup/agent/generate/route.ts`; Create `src/app/api/catalog-setup/agent/__tests__/generate-route.test.ts`.

**Decisions already locked.** Auth pattern (repo standard): `verifyAdminAuth(req)` → `findUserByAuth(uid, email, "id, company_id")` → service-role for any DB read; gate on the granular permission `catalog.run_setup` (never role). The route is **ungated** by Phase C — available to all companies (spec §17.1). It streams a `ProposalBatchSchema` object; **each proposal is server-validated (Task 4.3) before it is emitted**; invalid proposals are dropped with a logged reason (never surfaced as a broken card). On model error/timeout/offline-upstream the route returns a structured fallback envelope (`{ fallback: true, reason }`) with a non-500 status so the client keeps the canvas (spec §16 "agent failure mid-session → no data loss").

**Steps (TDD):**

1. Write failing `generate-route.test.ts` (mock `verifyAdminAuth`, `findUserByAuth`, and the AI SDK `streamObject`):
   - `401` when `verifyAdminAuth` returns null.
   - `403` when the user lacks `catalog.run_setup`.
   - happy path: a mocked stream of two proposals (one valid, one invalid by Task 4.3) → response contains only the valid proposal.
   - model-throws → response is the `{ fallback: true }` envelope, status not 500.
   Run `npm test -- src/app/api/catalog-setup/agent/__tests__/generate-route.test.ts`. Expected: fails.
2. Implement the route: `export const runtime = "nodejs"` (needs the service-role + server key); POST handler does auth → permission check (read `has_permission`/the permission helper used elsewhere — `grep -rn "has_permission\|hasPermission\|usePermission" src/lib` to match the server-side check pattern) → build messages (`SETUP_AGENT_SYSTEM_PROMPT` + the user's description/enrich context + any imported rows to enrich) → `streamObject({ model: getSetupAgentModel(), schema: ProposalBatchSchema, ... })` → as proposals arrive, run `validateProposal` and forward only `ok` ones via the AI SDK streaming response. Wrap in try/catch → fallback envelope. company_id on every read.
3. Run the test. Expected: passes. Commit `feat(catalog-setup): streaming guided-setup generate route`.

**Acceptance:** auth + permission enforced; invalid proposals never reach the client; failures degrade without 500/data-loss.
**Confirm at execution:** the exact server-side permission-check helper name/signature (match an existing route); whether enrich context (imported rows) is posted in the body or referenced by a staged-session id.

---

### Task 4.6: Document / photo / pasted-text extraction route (Claude vision/document input)

**Skills:** claude-api (document + vision input; PDF support), vercel:ai-sdk (`streamObject` with file/image parts), ops-copywriter (upload-affordance + error strings).
**Files:** Create `src/app/api/catalog-setup/agent/extract/route.ts`; Create `src/app/api/catalog-setup/agent/__tests__/extract-route.test.ts`.

**Decisions already locked (spec §8, §17.3).** Accept an uploaded PDF price list, a photo of a parts list, or pasted text → Claude document/vision input → structured proposals (same `ProposalBatchSchema` + Task 4.3 validation). Same auth + permission as 4.5. Enforce a size/type allowlist (PDF, PNG/JPEG/WebP, plain text); reject oversized/unsupported with a precise non-500 error. The deterministic CSV/XLSX path is **not** here — Phase 2's auto-route sends only messy docs/photos to this route.

**Steps (TDD):**

1. Write failing `extract-route.test.ts`: `401`/`403` as in 4.5; oversized upload → `413`-style structured error; unsupported mime → structured `400`; a fixture parts-list (text or a tiny base64 image) → mocked stream yields proposals that pass through validation. Run it. Expected: fails.
2. Implement the route: parse the multipart/body, validate mime + size against the allowlist, build the Claude message with a `document`/`image` content part (PDF → document; photo → image; paste → text) per the claude-api skill, then `streamObject(ProposalBatchSchema)` with `SETUP_AGENT_SYSTEM_PROMPT` + an extraction instruction. Validate each proposal (Task 4.3). try/catch → fallback envelope. `export const runtime = "nodejs"`; set a sane body-size limit.
3. Run the test. Expected: passes. Commit `feat(catalog-setup): document/photo extraction route`.

**Acceptance:** uploads are allowlisted; extraction yields validated proposals; failures degrade cleanly.
**Confirm at execution:** max upload size (research Anthropic document/image limits via claude-api skill at build); whether to reuse an existing upload helper in `src/app/api/uploads`.

---

### Task 4.7: Client hook — stream proposals into the Phase-1 canvas; offline/failure → zero-loss fallback

**Skills:** vercel:ai-sdk (consuming a streamed object / `useChat` if chosen), frontend-design.
**Files:** Create `src/lib/catalog-setup/agent/use-setup-agent.ts`; Create `src/lib/catalog-setup/agent/__tests__/use-setup-agent.test.ts`.

**Decisions already locked (spec §7, §16).** The hook drives the conversation, calls `generate`/`extract`, parses streamed proposals, **re-validates client-side** (defense-in-depth via Task 4.3), and injects valid proposals into the Phase-1 store via `useCatalogSetupStore.addProposals(...)`. It detects offline (`navigator.onLine` / fetch failure) and model-failure (the fallback envelope) and raises a `fallbackToGuided` signal **without** clearing any accepted cards (zero data loss). It updates the running counter through the store, not its own state.

**Steps (TDD):**

1. Read the real Phase-1 store API (`grep -rn "useCatalogSetupStore\|addProposals\|acceptCard" src/`). If absent, code against the spec contract and mark `// INTEGRATION`.
2. Write failing `use-setup-agent.test.ts` (mock fetch + a fake store): valid streamed proposals call `addProposals`; an invalid streamed proposal is dropped (not added); fetch rejects (offline) → `fallbackToGuided === true` and `addProposals` is **not** called with garbage and previously-added cards remain; the fallback envelope from the route sets `fallbackToGuided` without throwing. Run it. Expected: fails.
3. Implement the hook: `useSetupAgent()` returning `{ generate, extract, isStreaming, fallbackToGuided }`; on each parsed proposal run `validateProposal` (client ctx mirrors server) and `store.addProposals([...])` for valid ones; catch network/model errors → set `fallbackToGuided`, never mutate accepted cards. Run the test. Expected: passes.
4. Commit `feat(catalog-setup): use-setup-agent hook (zero-loss fallback)`.

**Acceptance:** proposals reach the canvas; invalid dropped; offline/failure preserves accepted cards and flips to guided fallback.
**Confirm at execution:** exact store action names + whether the canvas dedupes (show-diff is Phase 3) so the hook just adds.

---

### Task 4.8: Agent conversation pane (left driver) + proposal-stream affordance

**Skills:** frontend-design, interface-design, animation-architect → web-animations/elite-animations, ops-copywriter, audit-design-system.
**Files:** Create `src/components/catalog/setup/agent/SetupAgentPane.tsx`; Create `src/components/catalog/setup/agent/AgentProposalStream.tsx`; Create `src/components/catalog/setup/agent/__tests__/SetupAgentPane.test.tsx`; Modify `src/i18n/dictionaries/{en,es}/catalog-setup.json` (add agent keys).

**Decisions already locked (spec §7, §13, §14).** The pane is the LEFT-pane driver of the Phase-1 two-pane wizard: the "guided setup" conversation by default, with the opener (`What do you sell, and how do you charge for it?`), the upload affordance (doc/photo/paste → `extract`), and the offline/fallback banner (`[ OFFLINE — SWITCH TO GUIDED SETUP ]`). Cards render via the Phase-1 card component on the RIGHT canvas; `AgentProposalStream` is only the streaming-in indicator + the per-card arrival motion (brief **olive** confirm + count-up on the running totals; 250ms x-slide; honor `prefers-reduced-motion`). **Never** the word "AI" — "guided setup" / describe-the-behavior (ops-copywriter). All strings via `useDictionary("catalog-setup")`.

**Design tokens (specifics).** Pane title: `font-cakemono font-light uppercase` 28–32px. Conversation body: `font-mohave` sentence case, `text-text`/`text-text-2`. Running counter: `font-mono` `tnum`/`zero`. Upload affordance is a **secondary** control (transparent bg, `border rgba(255,255,255,0.10)`, `text-text-2`, 5px radius) — **no accent**. Offline banner: `tan` border-only (`tan-line`), `font-mono` micro, `[ ]` instructional bracket. Proposal arrival: `olive` confirm flash, count-up 800ms quadratic ease-out per DESIGN.md. The single accent element on the whole wizard is Phase 1's **BUILD IT** CTA — this pane has none.

**Steps (TDD):**

1. Wireframe the pane (invoke `frontend-design`/`interface-design` + `wireframe`): conversation column, opener, input, upload affordance, fallback banner. Justify each element per the design-judgment rule (why this, for this user, now) — drop anything that's just "the feature exists."
2. Get the copy from `ops-copywriter` for: opener, upload prompt, paste prompt, offline/fallback banner, proposal-stream status ("proposing…" / "N proposed · M added"). Add keys to both dictionaries. **No "AI", no "contractor", no exclamation points.**
3. Write failing `SetupAgentPane.test.tsx` (Testing Library): renders the opener; the upload affordance fires `extract`; the offline banner shows the bracketed copy when `fallbackToGuided`; assert **no element carries `ops-accent`** in this pane (query for the accent class/token and expect none). Run it. Expected: fails.
4. Implement `SetupAgentPane.tsx` (consumes `useSetupAgent`) and `AgentProposalStream.tsx` (motion only — `EASE_SMOOTH`, reduced-motion fallback to opacity-only 150ms). Tokens only; lucide-react icons. Run the test. Expected: passes.
5. Run the `audit-design-system` skill against the two components — fix any hardcoded color/spacing/radius/font; confirm accent appears nowhere here. Commit `feat(catalog-setup): setup-agent conversation pane + proposal stream`.

**Acceptance:** pane drives generate/extract, shows the fallback banner, uses tokens only, carries no accent; audit passes; copy approved; both dictionaries updated.
**Confirm at execution:** the exact Phase-1 wizard slot the pane mounts into; whether the upload affordance is shared with Phase 2's source picker.

---

### Task 4.9: Phase C autonomous layer — gated pre-stage through the agent_actions approval queue

**Skills:** claude-api, vercel:ai-sdk, (server) — no new UI.
**Files:** Create `src/lib/catalog-setup/agent/phase-c/autonomous-prestage.ts`; Create `src/app/api/catalog-setup/agent/prestage/route.ts`; Create `src/lib/catalog-setup/agent/phase-c/__tests__/autonomous-prestage.test.ts`; (verify-only) `src/app/api/feature-flags/route.ts`.

**Decisions already locked (spec §10, §12, §17.1).** The deeper **autonomous** layer is the only Phase-C-gated piece: it can pre-stage a whole proposed catalog and route it through the **existing** `ApprovalQueueService.proposeAction(...)` over `agent_actions` — NOT a new queue. Gate: **server** `AdminFeatureOverrideService.isAIFeatureEnabled(companyId, "phase_c")` (fail-closed) AND the granular `catalog.run_setup`; the **client** gate (`flagsReady && canAccessFeature("phase_c")`) is applied wherever this is triggered (a Phase-1/Phase-8 entry point — out of this task's file scope, but the route must not trust the client). Off path returns a clean `403` (no app break). The narrow suggest-only Setup Agent (Tasks 4.2–4.8) stays ungated and fully functional with this layer disabled.

**Steps (TDD):**

1. Read `approval-queue-service.ts` `proposeAction` signature (already in context: `{ companyId, userId, actionType, actionData, contextSummary, contextSource?, sourceId?, confidence?, priority? }`) and confirm whether a new `actionType` (e.g. `prestage_catalog`) needs registering in the approval-queue types/executor, or whether the autonomous layer only **proposes** (review-only) and the actual commit stays the owner's `BUILD IT` (preferred — keeps suggest-only invariant). Default: propose review-only actions; do NOT add an auto-executing catalog write.
2. Write failing `autonomous-prestage.test.ts` (mock `AdminFeatureOverrideService` + `ApprovalQueueService`): `phase_c` disabled → `proposeAction` **not** called and the util returns `{ gated: true }` (fail-closed); `phase_c` enabled → `proposeAction` called once per proposed catalog with `companyId` scoping; a missing/unknown company → fail-closed. Run it. Expected: fails.
3. Implement `autonomous-prestage.ts`: `await AdminFeatureOverrideService.isAIFeatureEnabled(companyId, "phase_c")`; if false return `{ gated: true }`; else generate the proposed catalog (reuse the generate path / model), validate (Task 4.3), and route through `ApprovalQueueService.proposeAction(...)`. PURE-ish (DB via injected services for testability).
4. Implement `prestage/route.ts`: auth (4.5 pattern) + `catalog.run_setup` + server `isAIFeatureEnabled('phase_c')` (fail-closed) → call the util; off path → `403` JSON. Run the tests. Expected: pass.
5. Verify `feature-flags/route.ts` already emits the synthetic `phase_c` flag (it does — confirmed in context) so the client gate resolves; no change unless a distinct `catalog_setup_autonomous` flag is chosen (see confirmations). Commit `feat(catalog-setup): gated phase-c autonomous pre-stage (agent_actions)`.

**Acceptance:** autonomous layer is double-gated and fail-closed; routes through the existing approval queue; disabling it leaves the ungated Setup Agent fully working; tests green.
**Confirm at execution:** (1) whether to register a new `agent_actions` `actionType` + executor or keep the layer review-only (recommended); (2) whether to reuse `phase_c` or add a dedicated `catalog_setup_autonomous` synthetic flag in `feature-flags/route.ts`; (3) the exact `userId` to attribute proposed actions to (the running operator).

---

### Task 4.10: End-to-end graceful-degradation + zero-data-loss integration test

**Skills:** vercel:ai-sdk, claude-api.
**Files:** Create `tests/integration/catalog-setup-agent-degradation.test.ts` (or co-located, matching the repo's integration layout under `tests/integration`).

**Decisions already locked (spec §16 cross-cutting).** The wizard must be fully functional with the agent disabled, and a mid-session agent failure must keep every already-accepted card. This task proves the seam between Task 4.7's hook, the Phase-1 store, and the fallback signal end-to-end (with the network/model mocked).

**Steps (TDD):**

1. Write failing integration test: seed the (real or faithfully-faked) Phase-1 store with two accepted cards; drive `useSetupAgent` to stream a third valid proposal (accepted) → store has 3; then force the next `generate` call to reject (model failure) → assert `fallbackToGuided === true` AND the store still has all 3 accepted cards (nothing cleared); then simulate offline and assert the same invariant. Run `npm test -- tests/integration/catalog-setup-agent-degradation.test.ts`. Expected: fails (until 4.7 + store wiring align).
2. Make it pass by reconciling the hook ↔ store contract (adjust imports/integration markers from 4.7, not the invariants).
3. Commit `test(catalog-setup): agent degradation preserves accepted cards`.

**Acceptance:** the zero-data-loss + agent-optional invariants are proven by a green integration test.
**Confirm at execution:** whether the integration test can import the real Phase-1 store (post-rebase) or must use the faithful fake until Phases 1–3 land.

---

### Phase 4 done-gate (all must hold before marking complete)
- `npm test -- src/lib/catalog-setup/agent src/app/api/catalog-setup/agent` is green (schemas, validator, prompt, routes, hook, phase-c).
- `audit-design-system` passes on `SetupAgentPane.tsx` + `AgentProposalStream.tsx`; the wizard's single accent element remains Phase 1's **BUILD IT** CTA (none in this pane).
- No proposal can reach a card without passing the PURE validator; `tiered_pricing` is structurally impossible.
- The Setup Agent is reachable by any company with `catalog.run_setup`; the **autonomous** layer is double-gated (`phase_c` server fail-closed + client `canAccessFeature`).
- Offline / declined / model-failure preserves every accepted card and falls back to the deterministic survey+template+manual (proven by Task 4.10).
- Zero occurrences of "AI" / "contractor" in agent-facing copy (`grep -rin "\bAI\b\|contractor" src/components/catalog/setup/agent src/i18n/dictionaries/*/catalog-setup.json` → none in agent strings); `ANTHROPIC_API_KEY` is server-only.
- Lint note: per CLAUDE memory, OPS-Web CI red on main is usually pre-existing `next lint`; verify locally, don't claim CI passed.
