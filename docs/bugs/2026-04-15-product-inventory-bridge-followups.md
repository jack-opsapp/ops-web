# Product-Inventory Bridge — Post-Ship Follow-ups

**Date:** 2026-04-15
**Feature:** Product-Inventory Bridge (migration 069, commits 642ee94..62f42ea)
**Spec:** `docs/superpowers/specs/2026-04-10-product-inventory-bridge-design.md`
**Plan:** `docs/superpowers/plans/2026-04-10-product-inventory-bridge.md`
**Scope:** Issues discovered during code review and Phase C impact audit immediately after shipping the 16-commit data + UI implementation. Two buckets: (A) correctness bugs in the deduction service that should land before Canpro beta actually completes tasks with BOMs attached, and (B) Phase C awareness gaps so the agent/memory/classifier stack learns this feature exists.

All items below are independent enough to be picked up by separate agents/PRs.

---

## A. Correctness bugs in the deduction path

### 1. Double-deduction race condition in `deductForTask`

**Severity:** high — exploitable in any two-tab or two-device scenario, corrupts stock counts silently
**File:** `src/lib/api/services/inventory-deduction-service.ts` lines 54–147
**Also:** `src/lib/hooks/use-tasks.ts` line ~404 (`useUpdateTaskStatus.onSuccess`)

#### Repro
1. Create a task with `task_materials` populated.
2. Open the task in two browser tabs / on two devices.
3. Mark it Completed in Tab A. Immediately mark it Completed in Tab B (before Tab A's network round-trip finishes).
4. Check `inventory_items.quantity` for the deducted items.

#### Root cause
`deductForTask` does a sequential `SELECT … WHERE id = $taskId` (line 58) to check `inventory_deducted`, runs the deduction loop, and only at the end (line 147) writes `UPDATE project_tasks SET inventory_deducted = true`. The client-side guard in `useUpdateTaskStatus` reads `context.previousTask.inventoryDeducted` from the optimistic cache, not from a fresh DB read. Both concurrent callers pass both guards and execute the full loop.

Two rows get inserted into `inventory_deductions` with `reason = 'task_completion'`, and `inventory_items.quantity` is debited twice.

#### Proposed fix
Replace the read+write pair with an atomic test-and-set as the first operation in `deductForTask`:

```sql
UPDATE project_tasks
SET inventory_deducted = true
WHERE id = $1 AND inventory_deducted = false
RETURNING id, company_id, project_id, source_line_item_id
```

Only proceed with the deduction loop if a row was actually returned (meaning this call claimed the task). This can be done as a Supabase RPC wrapping the `UPDATE … RETURNING` or, short-term, as an inline query — as long as the UPDATE runs *before* the deduction loop, not after.

`reverseForTask` has the same shape and needs the mirror fix (`UPDATE … SET inventory_deducted = false WHERE id = $1 AND inventory_deducted = true RETURNING …`).

---

### 2. `create_notification_if_new` called with company UUID as `user_id`

**Severity:** high — low-stock notifications silently go nowhere in the common case
**File:** `src/lib/api/services/inventory-deduction-service.ts` line 135

#### Current code
```ts
await supabase
  .rpc("create_notification_if_new", {
    p_user_id: userId ?? companyId,   // <-- bug
    p_company_id: companyId,
    ...
  })
  .then(() => undefined, () => undefined); // errors swallowed
```

`userId` is typed `string | null`. When `null` is passed (happens any time the deduction path doesn't have an authenticated user context — including future server-side / cron paths and the current hook when `currentUser?.id` is undefined), the fallback fires the company UUID as `p_user_id`. A company id is not a user id. The RPC either fails or inserts a notification row tagged to a phantom user that nobody can see. The `.then(() => undefined, () => undefined)` swallows both outcomes.

Because of the error suppression, **there is no signal this is broken** until a stakeholder asks "why didn't I get a low-stock alert."

#### Proposed fix
Options, in preference order:

1. **Look up the company owner** (`companies.owner_id` or the first admin from `company.adminIds`) and use that as the notification target when `userId` is null.
2. **Skip notification entirely** if `userId` is null and log a `console.warn` so the gap is visible.
3. **Switch to `NotificationService.create()`** and iterate over all admins for the company — each gets their own notification row.

Also: remove the blanket error suppression. At minimum log failures via `console.error`.

---

### 3. `inventory_deductions.insert` has no error check — partial-state corruption possible

**Severity:** moderate — rare but produces unrecoverable state when it fires
**File:** `src/lib/api/services/inventory-deduction-service.ts` lines 115–130

#### Scenario
1. Loop processes material A.
2. `inventory_items.update` for A succeeds → stock is debited in the DB.
3. `inventory_deductions.insert` for A fails (network blip, RLS hiccup, DB connection drop).
4. Current code ignores the insert error, continues to material B, eventually sets `inventory_deducted = true`.
5. Material A's stock is debited but there's no audit row → `reverseForTask` reads `inventory_deductions WHERE reason = 'task_completion'`, finds nothing for A, never restores A's stock.

#### Proposed fix
Check the insert error and throw. Even better: wrap the `UPDATE inventory_items` and `INSERT inventory_deductions` for each material in a single DB-side RPC that runs both statements in one transaction. If the RPC fails, the item quantity is untouched and the audit row is absent — consistent.

Short-term, at minimum:
```ts
const { error: insertError } = await supabase.from("inventory_deductions").insert({...});
if (insertError) throw new Error(`Failed to log deduction: ${insertError.message}`);
```

---

### 4. `createTasksFromProposals` return ordering is implicit

**Severity:** low — works today, brittle long-term
**Files:** `src/lib/api/services/task-service.ts` lines 585–619, `src/components/ops/review-tasks-modal.tsx` lines 227–240

The modal indexes `taskIds[idx]` back into `proposals[idx]` to populate `task_materials`. This works because:
- `createTasksFromProposals` does a single `INSERT … RETURNING id`; Supabase returns insertion order.
- The internal `.filter(p => p.selected)` is a no-op since the caller pre-filters.

If either of those assumptions changes, the mapper silently binds task N's materials to task M. There is no error — just wrong data.

#### Proposed fix
Return `Array<{ taskId: string; lineItemId: string }>` from `createTasksFromProposals` so the caller never has to index-align. Update the one call site in `review-tasks-modal.tsx` to read `.lineItemId` off the returned tuple.

---

### 5. Dead condition in `TaskMaterialsSection`

**Severity:** low — cosmetic, hides the "unknown item" fallback that the code was trying to render
**File:** `src/components/ops/task-materials-section.tsx` line ~141

```tsx
{item && !itemMap.has(row.inventoryItemId) && (
  <option value={row.inventoryItemId}>unknown</option>
)}
```

`item` is `itemMap.get(row.inventoryItemId)`, so if `item` is truthy the `.has` is also truthy. The condition is always false and the `<option>` never renders.

If the intent was "show an 'unknown' placeholder when the item was deleted from inventory after being attached to this task," flip the guard:

```tsx
{!item && (
  <option value={row.inventoryItemId}>unknown</option>
)}
```

Affects display only — no data corruption.

---

## B. Phase C awareness gaps

Phase C (memory, knowledge graph, approval queue, email classifier, drafting) was audited against the newly-shipped inventory bridge. Nothing in Phase C *breaks*, but in several places it operates with a blind spot that will widen as the feature gets used.

### 6. Email AI classifier has no verdict for inventory/supplier traffic

**Severity:** moderate — silent misclassification happening right now in production
**File:** `src/lib/api/services/email-ai-classifier.ts` lines ~417–426

#### Current behaviour
Classifier emits one of three verdicts: `'lead' | 'biz' | 'skip'`.
- `lead` = a prospective customer
- `biz` = vendor pitching services to the company
- `skip` = noise

Emails from suppliers about backorders, shipping delays, and stock availability are currently classified either as `'biz'` (miscategorised as a sales pitch) or `'skip'` (dropped entirely). For a contractor who stocks railing parts and gets regular supplier updates, this is meaningful signal falling on the floor.

#### Proposed fix
Add a fourth verdict `'operational'` (or `'supply'`) and extend the prompt + keyword checks with terms:
- `backorder`, `out of stock`, `stock availability`, `ETA`, `lead time`
- `supplier`, `wholesaler`, `delivery date`, `shipment delayed`
- `reorder`, `restock`, `on order`, `material shortage`

Route `'operational'` to a new section of the unified inbox or to the existing Phase C approval queue as a `flag_low_stock` proposal (see item 7).

---

### 7. Approval queue missing inventory action types

**Severity:** moderate — blocks any future agent work involving inventory
**File:** `src/lib/types/approval-queue.ts` lines 9–28

#### Current `AgentActionType` enum (18 values)
`create_project`, `create_task`, `create_invoice`, `send_email`, `send_status_email`, `send_invoice_email`, `send_payment_reminder`, `reassign_task`, `archive_project`, `client_health_alert`, `financial_insight`, `optimize_schedule`, `reschedule_tasks`, `send_appointment_confirmation`, `send_day_before_reminder`, `send_appointment_reminder`, `send_schedule_changed`, `send_subcontractor_coordination`, `process_reschedule_request`.

No inventory-related actions. Once agents are allowed to propose things like "stock is low, reorder," or "flag this task as materials-blocked," there is no valid action type to propose with.

#### Proposed fix
Add at minimum:
- `flag_low_stock` — purely informational, agent raises an alert about a specific `inventory_item_id`
- `adjust_inventory` — agent proposes a quantity change to `inventory_items.quantity` (always requires human approval; corresponding `inventory_deductions` row with `reason = 'manual_adjustment'` on apply)
- Consider `complete_task_with_deduction` only if agents are ever allowed to mark tasks Completed — currently they aren't, so this can wait.

Each new type needs a matching branch in `ApprovalQueueService.executeAction` (`approval-queue-service.ts` lines 130–168).

---

### 8. Memory indexer doesn't ingest BOMs or task materials

**Severity:** moderate — biggest leverage gap for making agents genuinely useful to trade workers
**Files:**
- `src/lib/api/services/memory-service.ts`
- Phase C indexer routes under `src/app/api/phase-c/` (or wherever the background indexer lives)
- Memory plan: `docs/plans/2026-04-08-phase-c-agent-knowledge-system.md`

#### Current behaviour
The memory service already recognises `'material'` as an entity type (`memory-service.ts:186`) and extracts material entities from email text — so if a customer writes "we'd like cedar shingles," it becomes a graph entity. Good.

What it does **not** do:
- Read the `product_materials` table to learn that product X has BOM [A, B, C]
- Read the `task_materials` table to learn that task Y requires 12 posts and 6 rails
- Read `inventory_deductions` to learn that task Y has settled its materials
- Create edges: `task → requires → material (qty=X)` or `product → bom → material (qty_per_unit=Y)`

Net effect: the agent knows what materials customers *mention* in emails, but does not know what materials your business *actually consumes per job*. That's the entire value proposition of a knowledge-aware agent for a trades business.

#### Proposed fix
Extend the Phase C indexer (or memory-service's fact extraction pass) to run a batch job after any of these tables change:

1. Read `product_materials` and upsert `(product, requires, material, qty_per_unit)` facts into `agent_knowledge_graph`.
2. Read `task_materials` and upsert `(task, requires, material, qty)` facts with the task's `project_id` as context.
3. Read `inventory_deductions` and upsert `(task, deducted, material, qty, at)` facts for audit-style queries.

Rebuild pattern: either listen on Supabase realtime channels for these tables or add them to whatever Phase C batch re-index loop exists today.

Downstream effect: the draft generator (item 9) and any future inventory action proposals (item 7) can now reason about actual stock vs. committed materials.

---

### 9. Draft generator has no stock-availability context

**Severity:** low — feature opportunity, not a bug
**File:** `src/lib/api/services/draft-generator.ts` lines ~29–154 (look at `buildPrompt` / context assembly)

The drafting prompt includes current promotions, pricing references, and client history, but nothing about material availability. A draft reply that says "we can start Monday" on a job whose BOM requires items you don't currently have in stock is a foot-gun — the AI commits the business to a date it can't honour.

#### Proposed fix
After item 8 lands (memory indexer knows BOMs), inject a short "STOCK STATUS" section into the drafting context: for each product mentioned in the current estimate / conversation thread, list whether stock is sufficient, low, or short, and by how much. Keep it under ~150 tokens so it doesn't blow the prompt budget.

Gate behind the same feature flag as the rest of Phase C drafting.

---

### 10. Agent system prompts don't mention inventory

**Severity:** low — not an issue until agents can act on inventory
**Files:** `ai-draft-service.ts:552`, `email-ai-classifier.ts` (multiple), `ai-sync-reviewer.ts:259`, `draft-generator.ts:96`

Current system prompts describe the business as "trades/construction," explain "clients hire them, vendors sell TO them," but make no mention of inventory, materials, or stock. That's fine today because no agent writes to inventory tables. As soon as item 7 (`flag_low_stock` / `adjust_inventory`) lands, the agents need to know they have this capability.

#### Proposed fix
Once items 7 and 8 are done, update each system prompt to include a short "You have access to real-time inventory status and can see stock quantities for all tracked materials. You may propose inventory adjustments via the approval queue; a human must approve before any change takes effect." sentence. Do not enable agent inventory actions until all three (7, 8, 10) are in place.

---

### 11. Intel graph doesn't link tasks to materials, doesn't surface `inventory_deducted`

**Severity:** low — visualization polish
**File:** `src/app/api/intel/graph/route.ts` lines ~40–58, 124–125

Intel already supports `'material'` as a node type and renders tasks. Two quick wins once item 8's indexer populates the graph:

1. Add `inventory_deducted` to the explicit column list at line 124 and expose it as a task node property — lets the galaxy visually distinguish "completed + settled" from "completed + unsettled" tasks.
2. Once `task → requires → material` edges exist in `agent_knowledge_graph`, Intel will automatically render them since the graph route enumerates edges — just verify the edge type is included in the rendering filters.

No schema changes needed; both are additive.

---

## Sequencing recommendation

| # | Priority | Work | Unblocks |
|---|----------|------|----------|
| 1 | P0 — before Canpro beta completes any BOM-linked task | Race condition fix | Prevents real stock corruption |
| 2 | P0 | Notification recipient fix | Low-stock alerts actually reach someone |
| 3 | P0 | Audit insert error check | Prevents unrecoverable partial deductions |
| 6 | P1 — next Phase C cycle | Operational verdict in classifier | Stops misrouting supplier emails today |
| 8 | P1 | Memory indexer ingests BOM/task_materials | Single highest-leverage Phase C change |
| 7 | P1 | Action type enum + executeAction branches | Unblocks any agent inventory proposals |
| 4 | P2 | Task-ids tuple return | Brittleness hardening, not urgent |
| 9 | P2 — after 8 | Inject stock context into draft generator | Prevents "can start Monday" foot-gun |
| 5 | P3 | Dead condition in TaskMaterialsSection | Cosmetic |
| 10 | P3 — after 7, 8 | Update agent system prompts | Needed before first inventory action ships |
| 11 | P3 — after 8 | Intel graph inventory polish | Pure visualization |

Items 1–3 and 5 can each be a small standalone PR. Item 4 is a one-file refactor. Items 6–11 are Phase C work and should be sequenced together in one or two follow-up sprints, in the order above.
