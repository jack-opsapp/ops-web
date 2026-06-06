# QuickBooks Sync P2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the QuickBooks P2 full CRUD sync engine and the minimal customer-facing Settings experience without enabling production QuickBooks writes.

**Architecture:** P2 uses a service-role, queue-based sync engine for OPS -> QuickBooks writes, signed webhooks plus reconcile for QuickBooks -> OPS, and record-level audit events for every decision. The customer UI moves to Settings as one status-first accounting panel; Accounting remains a financial work surface with no integration setup tab.

**Tech Stack:** Next.js App Router, React 19, TanStack Query, Supabase Postgres/RLS/RPC, Vitest, Playwright, QuickBooks Online API v3, OPS design system, lucide-react.

---

## Source Inputs

- Spec: `docs/superpowers/specs/2026-06-05-quickbooks-sync-p2-design.md`
- Bible: `/Users/jacksonsweet/Projects/OPS/ops-software-bible/04_API_AND_INTEGRATION.md`
- Bible: `/Users/jacksonsweet/Projects/OPS/ops-software-bible/09_FINANCIAL_SYSTEM.md`
- Mock: `/Users/jacksonsweet/Projects/OPS/ops-web/.superpowers/brainstorm/86535-1780621605/content/qbo-p2-minimal-customer-sync.html`
- Supabase project: `ijeekuhbatykdomumfjx`
- Validation company: Maverick Projects QuickBooks sandbox

## Non-Negotiable Product Decisions

- No customer-facing read-only/full-CRUD mode selector.
- Read-only remains developer/sandbox behavior.
- No `Integrations` sub-tab under `/accounting`.
- QuickBooks setup and health live in `Settings -> Integrations -> Accounting`.
- Healthy state is quiet: one dominant panel, status, last sync, and no primary action.
- Low-prominence `DISCONNECT` and `ADVANCED` actions are allowed for admins.
- `ACCOUNTING_WRITE_ENABLED` stays absent or false until sandbox proof is complete and production enablement is explicitly requested.
- CanPro QuickBooks production cannot be connected in this phase because Intuit admin authorization is unavailable.

## Worktree And Agent Split

Use isolated worktrees for implementation. Do not code P2 directly in the shared dirty `ops-web` checkout.

Spawn titles:

- `QUICKBOOKS SYNC - P2-1` Engine/Data Contract
- `QUICKBOOKS SYNC - P2-2` QuickBooks Push Mappers
- `QUICKBOOKS SYNC - P2-3` Webhook/Reconcile
- `QUICKBOOKS SYNC - P2-4` Operator UX
- `QUICKBOOKS SYNC - P2-5` Maverick Sandbox QA

Each implementation agent starts by running:

```bash
pwd
git branch --show-current
git rev-parse --short HEAD
git status --short
```

Expected:

- `pwd` is an isolated `ops-web` worktree, not `/Users/jacksonsweet/Projects/OPS/ops-web`.
- Branch name is task-specific.
- Dirty files are either absent or explicitly owned by that agent.

## File Ownership Map

Database:

- Create `supabase/migrations/20260605090000_qbo_p2_sync_queue.sql`
- Create `tests/unit/supabase/qbo-p2-sync-queue-migration.test.ts`

Queue and audit:

- Create `src/lib/api/services/accounting-sync-queue-types.ts`
- Create `src/lib/api/services/accounting-sync-queue-service.ts`
- Create `src/lib/api/services/accounting-sync-audit-service.ts`
- Create `src/lib/api/services/__tests__/accounting-sync-queue-service.test.ts`
- Create `src/lib/api/services/__tests__/accounting-sync-audit-service.test.ts`

QuickBooks write path:

- Create `src/lib/api/services/quickbooks-write-service.ts`
- Create `src/lib/api/services/qbo-push-mappers.ts`
- Create `src/lib/api/services/qbo-conflict.ts`
- Create `src/lib/api/services/__tests__/quickbooks-write-service.test.ts`
- Create `src/lib/api/services/__tests__/qbo-push-mappers.test.ts`
- Create `src/lib/api/services/__tests__/qbo-conflict.test.ts`
- Add fixtures under `tests/fixtures/qbo/push/`

Worker and routes:

- Create `src/app/api/cron/accounting/quickbooks/push-queue/route.ts`
- Create `src/app/api/cron/accounting/quickbooks/reconcile/route.ts`
- Create `src/app/api/integrations/accounting/sync-health/route.ts`
- Create `src/app/api/integrations/accounting/sync-actions/route.ts`
- Create `tests/integration/qbo-push-queue-route.test.ts`
- Create `tests/integration/qbo-reconcile-route.test.ts`
- Create `tests/integration/accounting-sync-health-route.test.ts`
- Create `tests/integration/accounting-sync-actions-route.test.ts`

Inbound/reconcile:

- Modify `src/app/api/integrations/quickbooks/webhook/route.ts`
- Modify `src/lib/api/services/quickbooks-webhook-apply-service.ts`
- Create `src/lib/api/services/quickbooks-reconcile-service.ts`
- Modify `tests/integration/qbo-webhook-route.test.ts`
- Create `tests/unit/services/quickbooks-reconcile-service.test.ts`

Settings UI:

- Modify `src/components/settings/accounting-tab.tsx`
- Create `src/components/settings/accounting-sync-panel.tsx`
- Create `src/components/settings/accounting-provider-picker.tsx`
- Create `src/components/settings/accounting-disconnect-dialog.tsx`
- Create `src/lib/hooks/use-qbo-sync-health.ts`
- Create `src/lib/hooks/use-qbo-sync-actions.ts`
- Modify `src/lib/api/query-client.ts`
- Modify `src/lib/hooks/index.ts`
- Modify `src/i18n/dictionaries/en/accounting.json`
- Modify `src/i18n/dictionaries/es/accounting.json`
- Create `tests/unit/components/settings-accounting-sync-panel.test.tsx`
- Create `tests/unit/hooks/use-qbo-sync-health.test.tsx`

Accounting page cleanup:

- Modify `src/app/(dashboard)/accounting/page.tsx`
- Replace `tests/unit/components/accounting-page-import-tab.test.tsx` with `tests/unit/components/accounting-page-tabs.test.tsx`
- Modify `src/i18n/dictionaries/en/accounting.json`
- Modify `src/i18n/dictionaries/es/accounting.json`

Import review hardening:

- Modify `src/components/accounting/qbo/customer-match-table.tsx`
- Modify `src/components/accounting/qbo/quickbooks-import-tab.tsx`
- Modify `src/lib/hooks/use-qbo-import.ts`
- Modify `src/lib/api/services/quickbooks-import-service.ts`
- Modify `src/app/api/integrations/quickbooks/import/route.ts`
- Modify `src/app/api/integrations/quickbooks/import/apply/route.ts`
- Modify existing QBO import tests under `tests/unit/components/`, `tests/unit/hooks/`, and `tests/integration/`

Docs and QA:

- Modify `/Users/jacksonsweet/Projects/OPS/ops-software-bible/04_API_AND_INTEGRATION.md`
- Modify `/Users/jacksonsweet/Projects/OPS/ops-software-bible/09_FINANCIAL_SYSTEM.md`
- Create `scripts/qbo-p2-maverick-smoke.ts`
- Create `docs/qa/2026-06-05-qbo-p2-maverick-sandbox.md`

## Task 0: Live Baseline Proof

**Owner:** `QUICKBOOKS SYNC - P2-1`

**Files:**

- Read: `docs/superpowers/specs/2026-06-05-quickbooks-sync-p2-design.md`
- Read: `/Users/jacksonsweet/Projects/OPS/ops-software-bible/04_API_AND_INTEGRATION.md`
- Read: `/Users/jacksonsweet/Projects/OPS/ops-software-bible/09_FINANCIAL_SYSTEM.md`
- No code changes in this task.

- [ ] **Step 1: Verify branch and dirty state**

Run:

```bash
pwd
git branch --show-current
git rev-parse --short HEAD
git status --short
```

Expected: isolated implementation worktree, task branch, no unrelated dirty files.

- [ ] **Step 2: Verify the write gate is off locally**

Run:

```bash
node -e "console.log(process.env.ACCOUNTING_WRITE_ENABLED === 'true' ? 'WRITE ENABLED' : 'WRITE DISABLED')"
```

Expected:

```text
WRITE DISABLED
```

- [ ] **Step 3: Verify live Supabase accounting baseline**

Use Supabase MCP SQL against project `ijeekuhbatykdomumfjx`:

```sql
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'accounting_connections',
    'accounting_sync_log',
    'clients',
    'sub_clients',
    'invoices',
    'estimates',
    'payments',
    'line_items'
  )
order by table_name, ordinal_position;
```

Expected verified facts:

- `accounting_connections.company_id` is `text`.
- `clients.company_id`, `sub_clients.company_id`, `invoices.company_id`, `estimates.company_id`, `payments.company_id`, and `line_items.company_id` are `uuid`.
- `accounting_connections.sync_direction` allows `pull_only`, `push_only`, and `bidirectional`.
- `accounting_connections.propagate_deletes` exists and defaults false.

- [ ] **Step 4: Verify current idempotency indexes**

Use Supabase MCP SQL:

```sql
select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('clients', 'sub_clients', 'invoices', 'estimates', 'payments')
  and indexdef ilike '%qb_id%'
order by tablename, indexname;
```

Expected indexes:

- `clients_company_qb_id_uniq`
- `sub_clients_company_qb_id_uniq`
- `invoices_company_qb_id_uniq`
- `estimates_company_qb_id_uniq`
- `payments_company_qb_id_uniq`

- [ ] **Step 5: Commit no-op proof note only if an artifact is created**

If this task creates a proof artifact, commit it:

```bash
git add docs/qa/2026-06-05-qbo-p2-live-baseline.md
git commit -m "docs(qbo): capture p2 live baseline"
```

Expected: no commit when no artifact is created.

## Task 1: Queue Schema, Trigger Contract, And Claim RPC

**Owner:** `QUICKBOOKS SYNC - P2-1`

**Files:**

- Create: `supabase/migrations/20260605090000_qbo_p2_sync_queue.sql`
- Create: `tests/unit/supabase/qbo-p2-sync-queue-migration.test.ts`

- [ ] **Step 1: Write the failing migration contract test**

Create `tests/unit/supabase/qbo-p2-sync-queue-migration.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260605090000_qbo_p2_sync_queue.sql"),
  "utf8"
);

describe("QBO P2 sync queue migration", () => {
  it("is transaction-wrapped and sentinel-guarded", () => {
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
    expect(sql).toContain("qbo_p2_sync_queue_sentinel");
    expect(sql).toContain("raise exception");
  });

  it("creates queue and event tables with uuid company ids", () => {
    expect(sql).toContain("create table if not exists public.accounting_sync_queue");
    expect(sql).toContain("create table if not exists public.accounting_sync_events");
    expect(sql).toContain("company_id uuid not null");
    expect(sql).toContain("connection_id uuid");
  });

  it("constrains queue values and active coalescing", () => {
    expect(sql).toContain("check (entity_type in ('customer', 'invoice', 'estimate', 'payment'))");
    expect(sql).toContain("check (operation in ('create', 'update', 'void', 'inactivate', 'delete_soft', 'link', 'reconcile'))");
    expect(sql).toContain("check (status in ('pending', 'claimed', 'succeeded', 'failed', 'blocked', 'needs_review', 'cancelled'))");
    expect(sql).toContain("accounting_sync_queue_active_uniq");
    expect(sql).toContain("where status = 'pending'");
  });

  it("adds a service-role claim RPC using skip locked", () => {
    expect(sql).toContain("create or replace function public.claim_accounting_sync_queue");
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("grant execute on function public.claim_accounting_sync_queue(text, integer, text) to service_role");
  });

  it("uses a transaction-local QuickBooks source marker to prevent echo loops", () => {
    expect(sql).toContain("current_setting('ops.sync_source', true)");
    expect(sql).toContain("= 'quickbooks'");
  });

  it("installs triggers for every OPS write surface", () => {
    for (const table of ["clients", "sub_clients", "invoices", "estimates", "payments", "line_items"]) {
      expect(sql).toContain(`trg_accounting_sync_queue_${table}`);
      expect(sql).toContain(`on public.${table}`);
    }
  });

  it("keeps queue and event writes server-side", () => {
    expect(sql).toContain("alter table public.accounting_sync_queue enable row level security");
    expect(sql).toContain("alter table public.accounting_sync_events enable row level security");
    expect(sql).not.toMatch(/for insert\s+to authenticated/i);
    expect(sql).not.toMatch(/for update\s+to authenticated/i);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- tests/unit/supabase/qbo-p2-sync-queue-migration.test.ts
```

Expected: fails because `supabase/migrations/20260605090000_qbo_p2_sync_queue.sql` does not exist.

- [ ] **Step 3: Create the migration**

Create `supabase/migrations/20260605090000_qbo_p2_sync_queue.sql` with this structure:

```sql
begin;

create table if not exists public.accounting_sync_queue (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  connection_id uuid not null references public.accounting_connections(id) on delete cascade,
  provider text not null default 'quickbooks' check (provider in ('quickbooks')),
  entity_type text not null check (entity_type in ('customer', 'invoice', 'estimate', 'payment')),
  entity_id uuid not null,
  external_id text null,
  operation text not null check (operation in ('create', 'update', 'void', 'inactivate', 'delete_soft', 'link', 'reconcile')),
  source_table text not null check (source_table in ('clients', 'sub_clients', 'invoices', 'estimates', 'payments', 'line_items')),
  source_action text not null check (source_action in ('insert', 'update', 'delete', 'soft_delete', 'void')),
  source_updated_at timestamptz null,
  idempotency_key text not null,
  status text not null default 'pending' check (status in ('pending', 'claimed', 'succeeded', 'failed', 'blocked', 'needs_review', 'cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  run_after timestamptz not null default now(),
  locked_at timestamptz null,
  locked_by text null,
  last_error text null,
  payload_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists accounting_sync_queue_active_uniq
  on public.accounting_sync_queue (
    company_id,
    provider,
    entity_type,
    entity_id,
    operation,
    idempotency_key
  )
  where status = 'pending';

create index if not exists accounting_sync_queue_due_idx
  on public.accounting_sync_queue (provider, status, run_after, created_at)
  where status = 'pending';

create table if not exists public.accounting_sync_events (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid null references public.accounting_sync_queue(id) on delete set null,
  company_id uuid not null,
  connection_id uuid null references public.accounting_connections(id) on delete set null,
  provider text not null check (provider in ('quickbooks')),
  direction text not null check (direction in ('ops_to_qb', 'qb_to_ops', 'reconcile', 'system')),
  entity_type text not null check (entity_type in ('customer', 'invoice', 'estimate', 'payment')),
  entity_id text null,
  external_id text null,
  operation text not null check (operation in ('create', 'update', 'void', 'inactivate', 'delete_soft', 'link', 'reconcile')),
  status text not null check (status in ('succeeded', 'failed', 'blocked', 'needs_review', 'skipped')),
  source text not null check (source in ('trigger', 'worker', 'webhook', 'reconcile', 'operator')),
  ops_updated_at timestamptz null,
  qb_updated_at timestamptz null,
  decision text null check (decision is null or decision in ('ops_won', 'qb_won', 'skipped', 'needs_review', 'retry', 'blocked')),
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null default '{}'::jsonb,
  error text null,
  created_at timestamptz not null default now()
);

alter table public.accounting_sync_queue enable row level security;
alter table public.accounting_sync_events enable row level security;

drop policy if exists accounting_sync_queue_service_role_only on public.accounting_sync_queue;
create policy accounting_sync_queue_service_role_only
  on public.accounting_sync_queue
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists accounting_sync_events_service_role_only on public.accounting_sync_events;
create policy accounting_sync_events_service_role_only
  on public.accounting_sync_events
  for all
  to service_role
  using (true)
  with check (true);

create or replace function public.claim_accounting_sync_queue(
  p_provider text default 'quickbooks',
  p_limit integer default 25,
  p_worker_id text default 'qbo-worker'
)
returns setof public.accounting_sync_queue
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with due as (
    select id
    from public.accounting_sync_queue
    where provider = p_provider
      and status = 'pending'
      and run_after <= now()
    order by run_after asc, created_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 25), 100))
  )
  update public.accounting_sync_queue q
  set status = 'claimed',
      attempts = q.attempts + 1,
      locked_at = now(),
      locked_by = coalesce(p_worker_id, 'qbo-worker'),
      updated_at = now()
  from due
  where q.id = due.id
  returning q.*;
end;
$$;

revoke all on function public.claim_accounting_sync_queue(text, integer, text) from public, anon, authenticated;
grant execute on function public.claim_accounting_sync_queue(text, integer, text) to service_role;

create or replace function public.enqueue_accounting_sync()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_company_id uuid;
  v_connection_id uuid;
  v_entity_type text;
  v_entity_id uuid;
  v_external_id text;
  v_operation text;
  v_source_action text;
  v_source_updated_at timestamptz;
  v_payload jsonb;
begin
  if current_setting('ops.sync_source', true) = 'quickbooks' then
    return coalesce(new, old);
  end if;

  v_row := coalesce(new, old);
  v_company_id := v_row.company_id;
  v_source_updated_at := nullif(coalesce(to_jsonb(v_row)->>'updated_at', to_jsonb(v_row)->>'created_at'), '')::timestamptz;

  select id
  into v_connection_id
  from public.accounting_connections
  where company_id = v_company_id::text
    and provider = 'quickbooks'
    and is_connected = true
    and sync_direction <> 'pull_only'
  order by updated_at desc nulls last
  limit 1;

  if v_connection_id is null then
    return coalesce(new, old);
  end if;

  v_entity_type := case tg_table_name
    when 'clients' then 'customer'
    when 'sub_clients' then 'customer'
    when 'invoices' then 'invoice'
    when 'estimates' then 'estimate'
    when 'payments' then 'payment'
    when 'line_items' then case
      when v_row.invoice_id is not null then 'invoice'
      when v_row.estimate_id is not null then 'estimate'
      else null
    end
    else null
  end;

  v_entity_id := case tg_table_name
    when 'line_items' then coalesce(
      nullif(to_jsonb(v_row)->>'invoice_id', '')::uuid,
      nullif(to_jsonb(v_row)->>'estimate_id', '')::uuid
    )
    else v_row.id
  end;

  if v_entity_type is null or v_entity_id is null then
    return coalesce(new, old);
  end if;

  if tg_table_name = 'line_items' and v_entity_type = 'invoice' then
    select qb_id
    into v_external_id
    from public.invoices
    where id = v_entity_id
      and company_id = v_company_id;
  elsif tg_table_name = 'line_items' and v_entity_type = 'estimate' then
    select qb_id
    into v_external_id
    from public.estimates
    where id = v_entity_id
      and company_id = v_company_id;
  else
    v_external_id := nullif(to_jsonb(v_row)->>'qb_id', '');
  end if;
  v_source_action := lower(tg_op);
  v_operation := case
    when tg_op = 'UPDATE' and tg_table_name = 'clients' and to_jsonb(new)->>'deleted_at' is not null and to_jsonb(old)->>'deleted_at' is null then 'inactivate'
    when tg_op = 'UPDATE' and tg_table_name in ('invoices', 'estimates') and to_jsonb(new)->>'deleted_at' is not null and to_jsonb(old)->>'deleted_at' is null then 'void'
    when tg_op = 'UPDATE' and tg_table_name = 'payments' and to_jsonb(new)->>'voided_at' is not null and to_jsonb(old)->>'voided_at' is null then 'void'
    when tg_op = 'INSERT' and v_external_id is null then 'create'
    when tg_op = 'INSERT' then 'update'
    else 'update'
  end;

  if tg_op = 'UPDATE' and tg_table_name <> 'line_items' then
    if coalesce(to_jsonb(old)->>'qb_id', '') is distinct from coalesce(to_jsonb(new)->>'qb_id', '')
      and coalesce(to_jsonb(old)->>'updated_at', '') is not distinct from coalesce(to_jsonb(new)->>'updated_at', '')
    then
      return new;
    end if;
  end if;

  v_payload := jsonb_build_object(
    'table', tg_table_name,
    'op', tg_op,
    'id', v_entity_id,
    'qbId', v_external_id,
    'updatedAt', v_source_updated_at
  );

  insert into public.accounting_sync_queue (
    company_id,
    connection_id,
    provider,
    entity_type,
    entity_id,
    external_id,
    operation,
    source_table,
    source_action,
    source_updated_at,
    idempotency_key,
    payload_snapshot
  )
  values (
    v_company_id,
    v_connection_id,
    'quickbooks',
    v_entity_type,
    v_entity_id,
    v_external_id,
    v_operation,
    tg_table_name,
    case when v_operation in ('void', 'inactivate') then 'soft_delete' else v_source_action end,
    v_source_updated_at,
    concat(tg_table_name, ':', v_entity_id::text),
    v_payload
  )
  on conflict (company_id, provider, entity_type, entity_id, operation, idempotency_key)
  where status = 'pending'
  do update
    set source_updated_at = excluded.source_updated_at,
        payload_snapshot = excluded.payload_snapshot,
        run_after = least(public.accounting_sync_queue.run_after, excluded.run_after),
        updated_at = now();

  return coalesce(new, old);
end;
$$;

revoke all on function public.enqueue_accounting_sync() from public, anon, authenticated;
grant execute on function public.enqueue_accounting_sync() to service_role;

drop trigger if exists trg_accounting_sync_queue_clients on public.clients;
create trigger trg_accounting_sync_queue_clients
  after insert or update on public.clients
  for each row execute function public.enqueue_accounting_sync();

drop trigger if exists trg_accounting_sync_queue_sub_clients on public.sub_clients;
create trigger trg_accounting_sync_queue_sub_clients
  after insert or update on public.sub_clients
  for each row execute function public.enqueue_accounting_sync();

drop trigger if exists trg_accounting_sync_queue_invoices on public.invoices;
create trigger trg_accounting_sync_queue_invoices
  after insert or update on public.invoices
  for each row execute function public.enqueue_accounting_sync();

drop trigger if exists trg_accounting_sync_queue_estimates on public.estimates;
create trigger trg_accounting_sync_queue_estimates
  after insert or update on public.estimates
  for each row execute function public.enqueue_accounting_sync();

drop trigger if exists trg_accounting_sync_queue_payments on public.payments;
create trigger trg_accounting_sync_queue_payments
  after insert or update on public.payments
  for each row execute function public.enqueue_accounting_sync();

drop trigger if exists trg_accounting_sync_queue_line_items on public.line_items;
create trigger trg_accounting_sync_queue_line_items
  after insert or update on public.line_items
  for each row execute function public.enqueue_accounting_sync();

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'accounting_sync_queue') then
    raise exception 'qbo_p2_sync_queue_sentinel: queue table missing';
  end if;

  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'accounting_sync_events') then
    raise exception 'qbo_p2_sync_queue_sentinel: events table missing';
  end if;

  if not exists (select 1 from pg_proc where proname = 'claim_accounting_sync_queue') then
    raise exception 'qbo_p2_sync_queue_sentinel: claim rpc missing';
  end if;
end $$;

commit;
```

- [ ] **Step 4: Run the migration contract test**

Run:

```bash
npm test -- tests/unit/supabase/qbo-p2-sync-queue-migration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run existing QBO migration tests**

Run:

```bash
npm test -- tests/unit/supabase/qbo-a0-schema-migration.test.ts tests/unit/supabase/qbo-company-subclient-migration.test.ts tests/unit/supabase/qbo-full-qb-id-unique-indexes.test.ts tests/unit/supabase/accounting-propagate-deletes-migration.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add supabase/migrations/20260605090000_qbo_p2_sync_queue.sql tests/unit/supabase/qbo-p2-sync-queue-migration.test.ts
git commit -m "feat(qbo): add p2 sync queue schema"
```

Expected: commit created.

## Task 2: Queue And Audit Services

**Owner:** `QUICKBOOKS SYNC - P2-1`

**Files:**

- Create: `src/lib/api/services/accounting-sync-queue-types.ts`
- Create: `src/lib/api/services/accounting-sync-queue-service.ts`
- Create: `src/lib/api/services/accounting-sync-audit-service.ts`
- Create: `src/lib/api/services/__tests__/accounting-sync-queue-service.test.ts`
- Create: `src/lib/api/services/__tests__/accounting-sync-audit-service.test.ts`

- [ ] **Step 1: Write queue service tests**

Create `src/lib/api/services/__tests__/accounting-sync-queue-service.test.ts` with tests for claim, success, retry, block, and review:

```ts
import { describe, expect, it, vi } from "vitest";
import { AccountingSyncQueueService } from "../accounting-sync-queue-service";

function clientMock() {
  const rpc = vi.fn();
  const update = vi.fn();
  const eq = vi.fn(() => ({ select: () => ({ single: () => Promise.resolve({ data: { id: "q-1", status: "succeeded" }, error: null }) }) }));
  const from = vi.fn(() => ({ update: (patch: unknown) => { update(patch); return { eq }; } }));
  return { rpc, from, update, eq };
}

describe("AccountingSyncQueueService", () => {
  it("claims due QuickBooks queue rows through the RPC", async () => {
    const db = clientMock();
    db.rpc.mockResolvedValue({ data: [{ id: "q-1", status: "claimed" }], error: null });
    const service = new AccountingSyncQueueService(db as never);

    const rows = await service.claimDue({ provider: "quickbooks", limit: 10, workerId: "w-1" });

    expect(db.rpc).toHaveBeenCalledWith("claim_accounting_sync_queue", {
      p_provider: "quickbooks",
      p_limit: 10,
      p_worker_id: "w-1",
    });
    expect(rows).toEqual([{ id: "q-1", status: "claimed" }]);
  });

  it("marks a row succeeded and clears lock fields", async () => {
    const db = clientMock();
    const service = new AccountingSyncQueueService(db as never);
    await service.markSucceeded("q-1", { externalId: "123" });
    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "succeeded",
      external_id: "123",
      locked_at: null,
      locked_by: null,
      last_error: null,
    }));
  });

  it("schedules retry with exponential backoff", async () => {
    const db = clientMock();
    const service = new AccountingSyncQueueService(db as never);
    await service.scheduleRetry({ id: "q-1", attempts: 2, maxAttempts: 5 } as never, "rate limited");
    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "pending",
      last_error: "rate limited",
      locked_at: null,
      locked_by: null,
    }));
    expect(String(db.update.mock.calls[0][0].run_after)).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("blocks a row when max attempts are exhausted", async () => {
    const db = clientMock();
    const service = new AccountingSyncQueueService(db as never);
    await service.scheduleRetry({ id: "q-1", attempts: 5, maxAttempts: 5 } as never, "validation failed");
    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "blocked",
      last_error: "validation failed",
    }));
  });
});
```

- [ ] **Step 2: Write audit service tests**

Create `src/lib/api/services/__tests__/accounting-sync-audit-service.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { AccountingSyncAuditService } from "../accounting-sync-audit-service";

describe("AccountingSyncAuditService", () => {
  it("inserts a record-level audit event without raw tokens", async () => {
    const insert = vi.fn(() => ({ select: () => ({ single: () => Promise.resolve({ data: { id: "evt-1" }, error: null }) }) }));
    const from = vi.fn(() => ({ insert }));
    const service = new AccountingSyncAuditService({ from } as never);

    await service.record({
      queueId: "q-1",
      companyId: "7a88c7d6-d4e3-49be-9d21-0a989e0f3222",
      connectionId: "91d98e28-36ec-4060-b047-3cb5cc342a12",
      provider: "quickbooks",
      direction: "ops_to_qb",
      entityType: "invoice",
      entityId: "inv-1",
      externalId: "123",
      operation: "update",
      status: "succeeded",
      source: "worker",
      decision: "ops_won",
      beforeSnapshot: { total: 10 },
      afterSnapshot: { total: 12 },
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      queue_id: "q-1",
      provider: "quickbooks",
      direction: "ops_to_qb",
      status: "succeeded",
      source: "worker",
    }));
    expect(JSON.stringify(insert.mock.calls[0][0])).not.toMatch(/access_token|refresh_token|Bearer/i);
  });
});
```

- [ ] **Step 3: Run failing service tests**

Run:

```bash
npm test -- src/lib/api/services/__tests__/accounting-sync-queue-service.test.ts src/lib/api/services/__tests__/accounting-sync-audit-service.test.ts
```

Expected: fails because service files do not exist.

- [ ] **Step 4: Create queue types**

Create `src/lib/api/services/accounting-sync-queue-types.ts`:

```ts
export const ACCOUNTING_SYNC_TERMINAL_STATUSES = [
  "succeeded",
  "failed",
  "blocked",
  "needs_review",
  "cancelled",
] as const;

export type AccountingSyncProvider = "quickbooks";
export type AccountingSyncEntityType = "customer" | "invoice" | "estimate" | "payment";
export type AccountingSyncOperation = "create" | "update" | "void" | "inactivate" | "delete_soft" | "link" | "reconcile";
export type AccountingSyncQueueStatus =
  | "pending"
  | "claimed"
  | "succeeded"
  | "failed"
  | "blocked"
  | "needs_review"
  | "cancelled";
export type AccountingSyncDirection = "ops_to_qb" | "qb_to_ops" | "reconcile" | "system";
export type AccountingSyncDecision = "ops_won" | "qb_won" | "skipped" | "needs_review" | "retry" | "blocked";

export interface AccountingSyncQueueRow {
  id: string;
  companyId: string;
  connectionId: string;
  provider: AccountingSyncProvider;
  entityType: AccountingSyncEntityType;
  entityId: string;
  externalId: string | null;
  operation: AccountingSyncOperation;
  sourceTable: string;
  sourceAction: string;
  sourceUpdatedAt: string | null;
  idempotencyKey: string;
  status: AccountingSyncQueueStatus;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  lockedAt: string | null;
  lockedBy: string | null;
  lastError: string | null;
  payloadSnapshot: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AccountingSyncAuditInput {
  queueId?: string | null;
  companyId: string;
  connectionId?: string | null;
  provider: AccountingSyncProvider;
  direction: AccountingSyncDirection;
  entityType: AccountingSyncEntityType;
  entityId?: string | null;
  externalId?: string | null;
  operation: AccountingSyncOperation;
  status: "succeeded" | "failed" | "blocked" | "needs_review" | "skipped";
  source: "trigger" | "worker" | "webhook" | "reconcile" | "operator";
  decision?: AccountingSyncDecision | null;
  opsUpdatedAt?: string | null;
  qbUpdatedAt?: string | null;
  beforeSnapshot?: Record<string, unknown>;
  afterSnapshot?: Record<string, unknown>;
  error?: string | null;
}
```

- [ ] **Step 5: Create the services**

Create `src/lib/api/services/accounting-sync-queue-service.ts` with methods:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountingSyncQueueRow, AccountingSyncProvider } from "./accounting-sync-queue-types";

function mapQueueRow(row: Record<string, unknown>): AccountingSyncQueueRow {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    connectionId: String(row.connection_id),
    provider: row.provider as AccountingSyncProvider,
    entityType: row.entity_type as AccountingSyncQueueRow["entityType"],
    entityId: String(row.entity_id),
    externalId: row.external_id ? String(row.external_id) : null,
    operation: row.operation as AccountingSyncQueueRow["operation"],
    sourceTable: String(row.source_table),
    sourceAction: String(row.source_action),
    sourceUpdatedAt: row.source_updated_at ? String(row.source_updated_at) : null,
    idempotencyKey: String(row.idempotency_key),
    status: row.status as AccountingSyncQueueRow["status"],
    attempts: Number(row.attempts ?? 0),
    maxAttempts: Number(row.max_attempts ?? 5),
    runAfter: String(row.run_after),
    lockedAt: row.locked_at ? String(row.locked_at) : null,
    lockedBy: row.locked_by ? String(row.locked_by) : null,
    lastError: row.last_error ? String(row.last_error) : null,
    payloadSnapshot: (row.payload_snapshot as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function retryDelaySeconds(attempts: number): number {
  return Math.min(60 * 60, Math.max(30, 30 * 2 ** Math.max(0, attempts - 1)));
}

export class AccountingSyncQueueService {
  constructor(private readonly supabase: SupabaseClient) {}

  async claimDue(input: { provider: AccountingSyncProvider; limit: number; workerId: string }): Promise<AccountingSyncQueueRow[]> {
    const { data, error } = await this.supabase.rpc("claim_accounting_sync_queue", {
      p_provider: input.provider,
      p_limit: input.limit,
      p_worker_id: input.workerId,
    });
    if (error) throw error;
    return ((data ?? []) as Record<string, unknown>[]).map(mapQueueRow);
  }

  async markSucceeded(id: string, input: { externalId?: string | null }): Promise<void> {
    const { error } = await this.supabase
      .from("accounting_sync_queue")
      .update({
        status: "succeeded",
        external_id: input.externalId ?? null,
        locked_at: null,
        locked_by: null,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw error;
  }

  async scheduleRetry(row: AccountingSyncQueueRow, errorMessage: string): Promise<void> {
    const exhausted = row.attempts >= row.maxAttempts;
    const runAfter = new Date(Date.now() + retryDelaySeconds(row.attempts) * 1000).toISOString();
    const { error } = await this.supabase
      .from("accounting_sync_queue")
      .update({
        status: exhausted ? "blocked" : "pending",
        run_after: exhausted ? row.runAfter : runAfter,
        locked_at: null,
        locked_by: null,
        last_error: errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (error) throw error;
  }

  async markBlocked(id: string, errorMessage: string): Promise<void> {
    const { error } = await this.supabase
      .from("accounting_sync_queue")
      .update({
        status: "blocked",
        locked_at: null,
        locked_by: null,
        last_error: errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw error;
  }

  async markNeedsReview(id: string, errorMessage: string): Promise<void> {
    const { error } = await this.supabase
      .from("accounting_sync_queue")
      .update({
        status: "needs_review",
        locked_at: null,
        locked_by: null,
        last_error: errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw error;
  }
}
```

Create `src/lib/api/services/accounting-sync-audit-service.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountingSyncAuditInput } from "./accounting-sync-queue-types";

function cleanSnapshot(input: Record<string, unknown> = {}): Record<string, unknown> {
  const blocked = new Set(["access_token", "refresh_token", "realm_id", "authorization"]);
  return Object.fromEntries(Object.entries(input).filter(([key]) => !blocked.has(key.toLowerCase())));
}

export class AccountingSyncAuditService {
  constructor(private readonly supabase: SupabaseClient) {}

  async record(input: AccountingSyncAuditInput): Promise<string> {
    const { data, error } = await this.supabase
      .from("accounting_sync_events")
      .insert({
        queue_id: input.queueId ?? null,
        company_id: input.companyId,
        connection_id: input.connectionId ?? null,
        provider: input.provider,
        direction: input.direction,
        entity_type: input.entityType,
        entity_id: input.entityId ?? null,
        external_id: input.externalId ?? null,
        operation: input.operation,
        status: input.status,
        source: input.source,
        ops_updated_at: input.opsUpdatedAt ?? null,
        qb_updated_at: input.qbUpdatedAt ?? null,
        decision: input.decision ?? null,
        before_snapshot: cleanSnapshot(input.beforeSnapshot),
        after_snapshot: cleanSnapshot(input.afterSnapshot),
        error: input.error ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id as string;
  }
}
```

- [ ] **Step 6: Run service tests**

Run:

```bash
npm test -- src/lib/api/services/__tests__/accounting-sync-queue-service.test.ts src/lib/api/services/__tests__/accounting-sync-audit-service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/lib/api/services/accounting-sync-queue-types.ts src/lib/api/services/accounting-sync-queue-service.ts src/lib/api/services/accounting-sync-audit-service.ts src/lib/api/services/__tests__/accounting-sync-queue-service.test.ts src/lib/api/services/__tests__/accounting-sync-audit-service.test.ts
git commit -m "feat(qbo): add sync queue services"
```

Expected: commit created.

## Task 3: QuickBooks Write Client, Push Mappers, And Conflict Rules

**Owner:** `QUICKBOOKS SYNC - P2-2`

**Files:**

- Create: `src/lib/api/services/quickbooks-write-service.ts`
- Create: `src/lib/api/services/qbo-push-mappers.ts`
- Create: `src/lib/api/services/qbo-conflict.ts`
- Create: `src/lib/api/services/__tests__/quickbooks-write-service.test.ts`
- Create: `src/lib/api/services/__tests__/qbo-push-mappers.test.ts`
- Create: `src/lib/api/services/__tests__/qbo-conflict.test.ts`
- Create fixtures under: `tests/fixtures/qbo/push/`

- [ ] **Step 1: Write conflict tests**

Create `src/lib/api/services/__tests__/qbo-conflict.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decideQboConflict } from "../qbo-conflict";

describe("decideQboConflict", () => {
  it("lets QB win when QB was updated after OPS", () => {
    expect(decideQboConflict({
      opsUpdatedAt: "2026-06-05T10:00:00.000Z",
      qbUpdatedAt: "2026-06-05T10:02:00.000Z",
      materialDiff: true,
    })).toEqual({ decision: "qb_won" });
  });

  it("lets OPS win when OPS was updated after QB", () => {
    expect(decideQboConflict({
      opsUpdatedAt: "2026-06-05T10:03:00.000Z",
      qbUpdatedAt: "2026-06-05T10:02:00.000Z",
      materialDiff: true,
    })).toEqual({ decision: "ops_won" });
  });

  it("requires review for equal timestamps with material money differences", () => {
    expect(decideQboConflict({
      opsUpdatedAt: "2026-06-05T10:00:00.000Z",
      qbUpdatedAt: "2026-06-05T10:00:00.000Z",
      materialDiff: true,
      moneyTouched: true,
    })).toEqual({ decision: "needs_review", reason: "equal timestamps with money difference" });
  });
});
```

- [ ] **Step 2: Write mapper tests**

Create `src/lib/api/services/__tests__/qbo-push-mappers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mapClientToQboCustomer, mapInvoiceToQboInvoice, mapPaymentToQboPayment } from "../qbo-push-mappers";

describe("QBO push mappers", () => {
  it("maps a parent client to a QuickBooks Customer create payload", () => {
    const payload = mapClientToQboCustomer({
      client: { id: "client-1", name: "Maverick Projects", email: "office@maverick.test", phoneNumber: "778-555-0100", address: "12 Yard Rd", qbId: null },
      primaryContact: { firstName: "Alex", lastName: "Maverick", email: "alex@maverick.test", phoneNumber: "778-555-0199" },
    });

    expect(payload).toEqual(expect.objectContaining({
      CompanyName: "Maverick Projects",
      DisplayName: "Maverick Projects",
      PrimaryEmailAddr: { Address: "alex@maverick.test" },
      PrimaryPhone: { FreeFormNumber: "778-555-0199" },
    }));
  });

  it("blocks invoice payloads without a linked QuickBooks customer", () => {
    expect(() => mapInvoiceToQboInvoice({
      invoice: { id: "inv-1", qbId: null, docNumber: "INV-1", total: 125, issueDate: "2026-06-05", dueDate: "2026-06-20" },
      client: { id: "client-1", qbId: null, name: "Maverick Projects" },
      lineItems: [],
    })).toThrow("QuickBooks customer link required");
  });

  it("maps a payment to a linked QuickBooks invoice", () => {
    const payload = mapPaymentToQboPayment({
      payment: { id: "pay-1", amount: 125, paymentDate: "2026-06-05", referenceNumber: "PMT-1", qbId: null },
      client: { id: "client-1", qbId: "44" },
      invoice: { id: "inv-1", qbId: "90", balanceDue: 125 },
    });

    expect(payload).toEqual(expect.objectContaining({
      CustomerRef: { value: "44" },
      TotalAmt: 125,
      Line: [expect.objectContaining({
        Amount: 125,
        LinkedTxn: [{ TxnId: "90", TxnType: "Invoice" }],
      })],
    }));
  });
});
```

- [ ] **Step 3: Write write-client tests**

Create `src/lib/api/services/__tests__/quickbooks-write-service.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { QuickBooksWriteService } from "../quickbooks-write-service";

describe("QuickBooksWriteService", () => {
  it("posts Customer create to the sandbox host and increments write count", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ Customer: { Id: "123", SyncToken: "0", MetaData: { LastUpdatedTime: "2026-06-05T10:00:00Z" } } }),
    });
    const service = new QuickBooksWriteService({
      realmId: "462081636529",
      accessToken: "token",
      environment: "sandbox",
      fetchImpl,
    });

    const result = await service.create("Customer", { DisplayName: "Maverick Projects" });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://sandbox-quickbooks.api.intuit.com/v3/company/462081636529/customer?minorversion=75",
      expect.objectContaining({ method: "POST" })
    );
    expect(result).toEqual(expect.objectContaining({ qbId: "123", syncToken: "0" }));
    expect(service.writeCalls).toBe(1);
  });

  it("rejects unsafe ids before URL interpolation", async () => {
    const service = new QuickBooksWriteService({
      realmId: "462081636529",
      accessToken: "token",
      environment: "sandbox",
      fetchImpl: vi.fn(),
    });

    await expect(service.fetchCurrent("Invoice", "1 or 1=1")).rejects.toThrow("Invalid QuickBooks id");
  });
});
```

- [ ] **Step 4: Run failing mapper/client tests**

Run:

```bash
npm test -- src/lib/api/services/__tests__/qbo-conflict.test.ts src/lib/api/services/__tests__/qbo-push-mappers.test.ts src/lib/api/services/__tests__/quickbooks-write-service.test.ts
```

Expected: fails because the services do not exist.

- [ ] **Step 5: Implement conflict decision**

Create `src/lib/api/services/qbo-conflict.ts`:

```ts
export type QboConflictDecision = "ops_won" | "qb_won" | "needs_review" | "skipped";

export interface QboConflictInput {
  opsUpdatedAt: string | null;
  qbUpdatedAt: string | null;
  materialDiff: boolean;
  moneyTouched?: boolean;
}

export function decideQboConflict(input: QboConflictInput): { decision: QboConflictDecision; reason?: string } {
  if (!input.materialDiff) return { decision: "skipped" };
  if (!input.opsUpdatedAt || !input.qbUpdatedAt) return { decision: "needs_review", reason: "missing timestamp" };

  const opsTime = Date.parse(input.opsUpdatedAt);
  const qbTime = Date.parse(input.qbUpdatedAt);
  if (!Number.isFinite(opsTime) || !Number.isFinite(qbTime)) {
    return { decision: "needs_review", reason: "invalid timestamp" };
  }
  if (qbTime > opsTime) return { decision: "qb_won" };
  if (opsTime > qbTime) return { decision: "ops_won" };
  if (input.moneyTouched) return { decision: "needs_review", reason: "equal timestamps with money difference" };
  return { decision: "needs_review", reason: "equal timestamps" };
}
```

- [ ] **Step 6: Implement push mappers**

Create `src/lib/api/services/qbo-push-mappers.ts` with pure mappers for Customer, Invoice, Estimate, and Payment. Use this signature set:

```ts
export interface OpsClientForQbo {
  id: string;
  name: string;
  email?: string | null;
  phoneNumber?: string | null;
  address?: string | null;
  qbId?: string | null;
}

export interface OpsContactForQbo {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phoneNumber?: string | null;
}

export function mapClientToQboCustomer(input: {
  client: OpsClientForQbo;
  primaryContact?: OpsContactForQbo | null;
}): Record<string, unknown> {
  const contact = input.primaryContact;
  return {
    CompanyName: input.client.name,
    DisplayName: input.client.name,
    PrimaryEmailAddr: { Address: contact?.email ?? input.client.email ?? "" },
    PrimaryPhone: { FreeFormNumber: contact?.phoneNumber ?? input.client.phoneNumber ?? "" },
    BillAddr: input.client.address ? { Line1: input.client.address } : undefined,
  };
}

export function assertQboRef(value: string | null | undefined, label: string): string {
  if (!value) throw new Error(`${label} required`);
  if (!/^\d+$/.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}
```

Add invoice, estimate, and payment functions in the same file. Required behavior:

- Invoice and estimate mapper require `client.qbId`.
- Payment mapper requires `client.qbId` and `invoice.qbId` when payment applies to an invoice.
- Line item mapper emits `SalesItemLineDetail`.
- Item fallback uses a service line item name `OPS Service`.
- Mappers do not call Supabase or QuickBooks.

- [ ] **Step 7: Implement write service**

Create `src/lib/api/services/quickbooks-write-service.ts`:

```ts
import { getQuickBooksEnvironment } from "./quickbooks-config";

type QboEntity = "Customer" | "Invoice" | "Estimate" | "Payment";

const ENTITY_PATH: Record<QboEntity, string> = {
  Customer: "customer",
  Invoice: "invoice",
  Estimate: "estimate",
  Payment: "payment",
};

function assertQboId(id: string): void {
  if (!/^\d+$/.test(id)) throw new Error("Invalid QuickBooks id");
}

function hostFor(environment: ReturnType<typeof getQuickBooksEnvironment>): string {
  return environment === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

export interface QuickBooksWriteResult {
  qbId: string;
  syncToken: string | null;
  metaUpdatedAt: string | null;
  raw: Record<string, unknown>;
}

export class QuickBooksWriteService {
  public writeCalls = 0;

  constructor(private readonly input: {
    realmId: string;
    accessToken: string;
    environment: ReturnType<typeof getQuickBooksEnvironment>;
    fetchImpl?: typeof fetch;
  }) {}

  async create(entity: QboEntity, payload: Record<string, unknown>): Promise<QuickBooksWriteResult> {
    return this.post(entity, payload);
  }

  async update(entity: QboEntity, payload: Record<string, unknown>): Promise<QuickBooksWriteResult> {
    return this.post(entity, payload);
  }

  async fetchCurrent(entity: QboEntity, id: string): Promise<Record<string, unknown>> {
    assertQboId(id);
    const fetchImpl = this.input.fetchImpl ?? fetch;
    const url = `${hostFor(this.input.environment)}/v3/company/${this.input.realmId}/${ENTITY_PATH[entity]}/${id}?minorversion=75`;
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.input.accessToken}`, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`QuickBooks fetch failed: ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  }

  private async post(entity: QboEntity, payload: Record<string, unknown>): Promise<QuickBooksWriteResult> {
    const fetchImpl = this.input.fetchImpl ?? fetch;
    const url = `${hostFor(this.input.environment)}/v3/company/${this.input.realmId}/${ENTITY_PATH[entity]}?minorversion=75`;
    this.writeCalls += 1;
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.input.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`QuickBooks write failed: ${res.status}`);
    const raw = (await res.json()) as Record<string, unknown>;
    const entityBody = raw[entity] as Record<string, unknown>;
    return {
      qbId: String(entityBody.Id),
      syncToken: entityBody.SyncToken ? String(entityBody.SyncToken) : null,
      metaUpdatedAt: ((entityBody.MetaData as Record<string, unknown> | undefined)?.LastUpdatedTime as string | undefined) ?? null,
      raw,
    };
  }
}
```

- [ ] **Step 8: Run mapper/client tests**

Run:

```bash
npm test -- src/lib/api/services/__tests__/qbo-conflict.test.ts src/lib/api/services/__tests__/qbo-push-mappers.test.ts src/lib/api/services/__tests__/quickbooks-write-service.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

Run:

```bash
git add src/lib/api/services/quickbooks-write-service.ts src/lib/api/services/qbo-push-mappers.ts src/lib/api/services/qbo-conflict.ts src/lib/api/services/__tests__/quickbooks-write-service.test.ts src/lib/api/services/__tests__/qbo-push-mappers.test.ts src/lib/api/services/__tests__/qbo-conflict.test.ts tests/fixtures/qbo/push
git commit -m "feat(qbo): add write client and push mappers"
```

Expected: commit created.

## Task 4: Push Queue Worker Route

**Owner:** `QUICKBOOKS SYNC - P2-2`

**Files:**

- Create: `src/app/api/cron/accounting/quickbooks/push-queue/route.ts`
- Create: `tests/integration/qbo-push-queue-route.test.ts`
- Modify: `src/lib/api/services/accounting-sync-queue-service.ts`
- Modify: `src/lib/api/services/accounting-sync-audit-service.ts`

- [ ] **Step 1: Write route tests**

Create `tests/integration/qbo-push-queue-route.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const claimDue = vi.fn();
const markSucceeded = vi.fn();
const scheduleRetry = vi.fn();
const record = vi.fn();

vi.mock("@/lib/api/services/accounting-sync-queue-service", () => ({
  AccountingSyncQueueService: vi.fn(() => ({ claimDue, markSucceeded, scheduleRetry })),
}));

vi.mock("@/lib/api/services/accounting-sync-audit-service", () => ({
  AccountingSyncAuditService: vi.fn(() => ({ record })),
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ from: vi.fn() }),
}));

function req(secret = "cron-secret") {
  return new Request("http://localhost/api/cron/accounting/quickbooks/push-queue", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  }) as never;
}

async function route() {
  return (await import("@/app/api/cron/accounting/quickbooks/push-queue/route")).POST;
}

describe("POST /api/cron/accounting/quickbooks/push-queue", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.CRON_SECRET = "cron-secret";
    process.env.ACCOUNTING_WRITE_ENABLED = "false";
    claimDue.mockResolvedValue([]);
  });

  it("401s without the cron bearer token", async () => {
    const POST = await route();
    const res = await POST(new Request("http://localhost/api/cron/accounting/quickbooks/push-queue", { method: "POST" }) as never);
    expect(res.status).toBe(401);
    expect(claimDue).not.toHaveBeenCalled();
  });

  it("fails closed when ACCOUNTING_WRITE_ENABLED is not true", async () => {
    const POST = await route();
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(expect.objectContaining({ code: "ACCOUNTING_WRITE_DISABLED" }));
    expect(claimDue).not.toHaveBeenCalled();
  });

  it("claims a bounded batch when the write gate is true", async () => {
    process.env.ACCOUNTING_WRITE_ENABLED = "true";
    const POST = await route();
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(claimDue).toHaveBeenCalledWith(expect.objectContaining({ provider: "quickbooks", limit: 25 }));
  });
});
```

- [ ] **Step 2: Run failing route test**

Run:

```bash
npm test -- tests/integration/qbo-push-queue-route.test.ts
```

Expected: fails because the route does not exist.

- [ ] **Step 3: Implement the route shell with the write gate**

Create `src/app/api/cron/accounting/quickbooks/push-queue/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { AccountingSyncQueueService } from "@/lib/api/services/accounting-sync-queue-service";
import { AccountingSyncAuditService } from "@/lib/api/services/accounting-sync-audit-service";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.ACCOUNTING_WRITE_ENABLED !== "true") {
    return NextResponse.json({ code: "ACCOUNTING_WRITE_DISABLED" }, { status: 409 });
  }

  const supabase = getServiceRoleClient();
  const queue = new AccountingSyncQueueService(supabase);
  const audit = new AccountingSyncAuditService(supabase);
  const workerId = `qbo-worker-${Date.now()}`;
  const rows = await queue.claimDue({ provider: "quickbooks", limit: 25, workerId });

  let processed = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      await audit.record({
        queueId: row.id,
        companyId: row.companyId,
        connectionId: row.connectionId,
        provider: "quickbooks",
        direction: "ops_to_qb",
        entityType: row.entityType,
        entityId: row.entityId,
        externalId: row.externalId,
        operation: row.operation,
        status: "blocked",
        source: "worker",
        decision: "blocked",
        error: "Worker mapper not attached",
      });
      await queue.scheduleRetry(row, "Worker mapper not attached");
      failed += 1;
    } catch (error) {
      failed += 1;
      await queue.scheduleRetry(row, error instanceof Error ? error.message : "Unknown worker error");
    }
    processed += 1;
  }

  return NextResponse.json({ processed, failed });
}
```

- [ ] **Step 4: Replace the shell with actual row processing**

Extend the route by adding a local `processQueueRow` function that:

- Reads the connection row by `connection_id`.
- Gets a valid token via `AccountingTokenService.getValidToken`.
- Decrypts realm id through existing token service/cipher flow.
- Refetches current OPS row by `entityType`.
- Uses `qbo-push-mappers.ts`.
- Calls `QuickBooksWriteService`.
- Writes returned `qbId` into the OPS row when it was a create.
- Suppresses the target OPS row with `suppress_accounting_sync(...)` before writing returned `qb_id` when the write happens through JS/Supabase REST.
- Records `accounting_sync_events`.
- Marks row succeeded, retryable, blocked, or needs_review.

Transaction-local source markers are valid only inside the same DB transaction/RPC that performs the write:

```ts
await supabase.rpc("set_config", {
  setting_name: "ops.sync_source",
  new_value: "quickbooks",
  is_local: true,
});
```

JS service-role code that performs separate Supabase REST writes must not rely on the transaction-local marker. It must create a persisted suppression row for the concrete OPS entity before the write:

```ts
await supabase.rpc("suppress_accounting_sync", {
  p_company_id: companyId,
  p_provider: "quickbooks",
  p_entity_type: "invoice",
  p_entity_id: invoiceId,
  p_source: "quickbooks",
  p_ttl_seconds: 600,
});
```

- [ ] **Step 5: Add dependency-blocking tests**

Extend `tests/integration/qbo-push-queue-route.test.ts` so missing links are blocked:

```ts
it("blocks an invoice row when the customer has no QuickBooks id", async () => {
  process.env.ACCOUNTING_WRITE_ENABLED = "true";
  claimDue.mockResolvedValue([{
    id: "q-1",
    companyId: "7a88c7d6-d4e3-49be-9d21-0a989e0f3222",
    connectionId: "91d98e28-36ec-4060-b047-3cb5cc342a12",
    provider: "quickbooks",
    entityType: "invoice",
    entityId: "inv-1",
    externalId: null,
    operation: "create",
    attempts: 1,
    maxAttempts: 5,
    payloadSnapshot: {},
  }]);

  const POST = await route();
  const res = await POST(req());

  expect(res.status).toBe(200);
  expect(record).toHaveBeenCalledWith(expect.objectContaining({
    status: "blocked",
    decision: "blocked",
  }));
});
```

- [ ] **Step 6: Run route and mapper tests**

Run:

```bash
npm test -- tests/integration/qbo-push-queue-route.test.ts src/lib/api/services/__tests__/qbo-push-mappers.test.ts src/lib/api/services/__tests__/quickbooks-write-service.test.ts src/lib/api/services/__tests__/accounting-sync-queue-service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/app/api/cron/accounting/quickbooks/push-queue/route.ts tests/integration/qbo-push-queue-route.test.ts src/lib/api/services/accounting-sync-queue-service.ts src/lib/api/services/accounting-sync-audit-service.ts
git commit -m "feat(qbo): drain outbound sync queue"
```

Expected: commit created.

## Task 5: Webhook Audit, Reconcile Cron, And Echo Prevention

**Owner:** `QUICKBOOKS SYNC - P2-3`

**Files:**

- Modify: `src/app/api/integrations/quickbooks/webhook/route.ts`
- Modify: `src/lib/api/services/quickbooks-webhook-apply-service.ts`
- Create: `src/lib/api/services/quickbooks-estimate-acceptance-service.ts`
- Create: `src/lib/api/services/quickbooks-reconcile-service.ts`
- Create: `src/app/api/cron/accounting/quickbooks/reconcile/route.ts`
- Create: `supabase/migrations/20260605110000_qbo_inbound_estimate_acceptance_bridge.sql`
- Modify: `tests/integration/qbo-webhook-route.test.ts`
- Create: `tests/unit/services/quickbooks-estimate-acceptance-service.test.ts`
- Create: `tests/unit/services/quickbooks-reconcile-service.test.ts`
- Create: `tests/unit/supabase/qbo-inbound-estimate-acceptance-bridge-migration.test.ts`
- Create: `tests/integration/qbo-reconcile-route.test.ts`

### Task 5 Acceptance Amendment

Inbound QuickBooks Estimate acceptance is in scope for Task 5. Do not treat `TxnStatus = Accepted` as a plain estimate status update. When the webhook or reconcile path sees a linked QBO Estimate become accepted, OPS must run the accepted-estimate lifecycle contract:

- The linked OPS estimate becomes approved/accepted.
- The linked opportunity moves to `won`.
- An existing linked project is reused or a project is created.
- LABOR line items become project tasks with `source_estimate_id` and `source_line_item_id` preserved.
- Tracked-inventory companies get Phase 6 booking projection rows in `project_material_demands` / `task_material_allocations`; physical stock deduction still waits for `complete_project_task`.
- Replays are idempotent and must not duplicate project, task, or demand rows.

Implementation must not service-role-update these tables ad hoc from the webhook route. Add an integration-safe acceptance bridge in SQL, grant it only to `service_role`, and call it from a focused TypeScript service. The bridge must validate:

- The `accounting_connections` row is QuickBooks, connected, `sync_enabled = true`, and not `push_only`.
- The estimate belongs to the connection company and has the expected `qb_id`.
- The estimate is linked to an opportunity.
- The acting OPS user is derived from company-owned data: prefer `companies.account_holder_id`, then the first active company admin. Never accept an actor from QuickBooks payloads or route input.
- If no safe actor/linkage exists, return a structured `needs_review` result and record audit; do not partially convert.

The migration may either introduce actor-aware private helpers or a single bridge wrapper, but it must preserve the existing Phase 6 acceptance invariants from `public.accept_estimate_to_job`: idempotent request tracking, project/task sync, booking projection, mapping warnings, overrun warnings, and no physical stock deduction.

- [ ] **Step 1: Add webhook audit tests**

Extend `tests/integration/qbo-webhook-route.test.ts`:

```ts
it("records qb_to_ops audit events and still returns 200 for a poison entity", async () => {
  applyWebhookChange.mockRejectedValueOnce(new Error("bad invoice"));
  const res = await POST(signedWebhookRequest([{ name: "Invoice", id: "99", operation: "Update" }]));
  expect(res.status).toBe(200);
  expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
    direction: "qb_to_ops",
    entityType: "invoice",
    externalId: "99",
    status: "failed",
    source: "webhook",
  }));
});
```

- [ ] **Step 2: Write reconcile tests**

Create `tests/unit/services/quickbooks-reconcile-service.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { QuickBooksReconcileService } from "@/lib/api/services/quickbooks-reconcile-service";

describe("QuickBooksReconcileService", () => {
  it("enqueues OPS -> QB when OPS is newer", async () => {
    const enqueue = vi.fn();
    const audit = { record: vi.fn() };
    const service = new QuickBooksReconcileService({ enqueue, audit } as never);

    await service.reconcileLinkedRecord({
      companyId: "7a88c7d6-d4e3-49be-9d21-0a989e0f3222",
      connectionId: "91d98e28-36ec-4060-b047-3cb5cc342a12",
      entityType: "invoice",
      entityId: "inv-1",
      externalId: "123",
      opsUpdatedAt: "2026-06-05T10:03:00Z",
      qbUpdatedAt: "2026-06-05T10:01:00Z",
      materialDiff: true,
    });

    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ entityType: "invoice", operation: "update" }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ direction: "reconcile", decision: "ops_won" }));
  });
});
```

- [ ] **Step 3: Implement audit in webhook apply service**

In `src/lib/api/services/quickbooks-webhook-apply-service.ts`:

- Import `AccountingSyncAuditService`.
- Suppress the concrete OPS entity before each JS/Supabase REST write:

```ts
await supabase.rpc("suppress_accounting_sync", {
  p_company_id: companyId,
  p_provider: "quickbooks",
  p_entity_type: entityType,
  p_entity_id: opsId,
  p_source: "quickbooks",
  p_ttl_seconds: 600,
});
```

- On successful apply, record:

```ts
await audit.record({
  companyId,
  connectionId,
  provider: "quickbooks",
  direction: "qb_to_ops",
  entityType,
  entityId: opsId,
  externalId: qbId,
  operation: "update",
  status: "succeeded",
  source: "webhook",
  decision: "qb_won",
  qbUpdatedAt,
  afterSnapshot,
});
```

- On poison record failure, record a failed audit event and keep the route response `200`.

- [ ] **Step 3A: Add inbound accepted-estimate bridge tests**

Create `tests/unit/services/quickbooks-estimate-acceptance-service.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { QuickBooksEstimateAcceptanceService } from "@/lib/api/services/quickbooks-estimate-acceptance-service";

describe("QuickBooksEstimateAcceptanceService", () => {
  it("calls the service-role bridge when a QBO estimate is accepted", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        status: "succeeded",
        estimate_id: "est-1",
        project_id: "proj-1",
        opportunity_id: "opp-1",
        project_task_result: { project_task_count: 2 },
        booking_projection_result: { booking_persistence_performed: true, demand_ids: ["demand-1"] },
      },
      error: null,
    });
    const service = new QuickBooksEstimateAcceptanceService({ rpc } as never);

    const result = await service.acceptFromQuickBooks({
      companyId: "7a88c7d6-d4e3-49be-9d21-0a989e0f3222",
      connectionId: "91d98e28-36ec-4060-b047-3cb5cc342a12",
      estimateId: "est-1",
      qbEstimateId: "99",
      qbUpdatedAt: "2026-06-05T11:00:00Z",
    });

    expect(rpc).toHaveBeenCalledWith("accept_estimate_to_job_from_quickbooks", {
      p_company_id: "7a88c7d6-d4e3-49be-9d21-0a989e0f3222",
      p_connection_id: "91d98e28-36ec-4060-b047-3cb5cc342a12",
      p_estimate_id: "est-1",
      p_qb_estimate_id: "99",
      p_idempotency_key: "qbo:estimate:accepted:91d98e28-36ec-4060-b047-3cb5cc342a12:99",
    });
    expect(result.status).toBe("succeeded");
  });

  it("returns needs_review without throwing when the bridge cannot prove actor or linkage", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { status: "needs_review", reason: "integration_acceptance_actor_not_found" },
      error: null,
    });
    const service = new QuickBooksEstimateAcceptanceService({ rpc } as never);

    await expect(service.acceptFromQuickBooks({
      companyId: "7a88c7d6-d4e3-49be-9d21-0a989e0f3222",
      connectionId: "91d98e28-36ec-4060-b047-3cb5cc342a12",
      estimateId: "est-1",
      qbEstimateId: "99",
      qbUpdatedAt: null,
    })).resolves.toEqual(expect.objectContaining({ status: "needs_review" }));
  });
});
```

- [ ] **Step 3B: Add migration contract test for the acceptance bridge**

Create `tests/unit/supabase/qbo-inbound-estimate-acceptance-bridge-migration.test.ts` for `20260605110000_qbo_inbound_estimate_acceptance_bridge.sql` that asserts:

```ts
expect(sql).toContain("create or replace function public.accept_estimate_to_job_from_quickbooks");
expect(sql).toContain("grant execute on function public.accept_estimate_to_job_from_quickbooks");
expect(sql).toContain("to service_role");
expect(sql).toContain("revoke all on function public.accept_estimate_to_job_from_quickbooks");
expect(sql).toContain("account_holder_id");
expect(sql).toContain("admin_ids");
expect(sql).toContain("accept_estimate_to_job_requests");
expect(sql).toContain("private.sync_accepted_estimate_project_tasks");
expect(sql).toContain("private.persist_estimate_material_booking_projection");
expect(sql).toContain("physical stock deduction");
```

- [ ] **Step 3C: Implement `quickbooks-estimate-acceptance-service.ts`**

Create a focused service that calls only the SQL bridge:

```ts
export interface QuickBooksEstimateAcceptanceInput {
  companyId: string;
  connectionId: string;
  estimateId: string;
  qbEstimateId: string;
  qbUpdatedAt: string | null;
}

export interface QuickBooksEstimateAcceptanceResult {
  status: "succeeded" | "needs_review" | "skipped";
  reason?: string | null;
  projectId?: string | null;
  opportunityId?: string | null;
  response?: Record<string, unknown>;
}

export class QuickBooksEstimateAcceptanceService {
  constructor(private readonly supabase: { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> }) {}

  async acceptFromQuickBooks(input: QuickBooksEstimateAcceptanceInput): Promise<QuickBooksEstimateAcceptanceResult> {
    const { data, error } = await this.supabase.rpc("accept_estimate_to_job_from_quickbooks", {
      p_company_id: input.companyId,
      p_connection_id: input.connectionId,
      p_estimate_id: input.estimateId,
      p_qb_estimate_id: input.qbEstimateId,
      p_idempotency_key: `qbo:estimate:accepted:${input.connectionId}:${input.qbEstimateId}`,
    });
    if (error) throw new Error(`QuickBooks estimate acceptance bridge failed: ${error.message}`);
    return (data ?? { status: "needs_review", reason: "empty_bridge_response" }) as QuickBooksEstimateAcceptanceResult;
  }
}
```

- [ ] **Step 3D: Implement SQL bridge**

Create `supabase/migrations/20260605110000_qbo_inbound_estimate_acceptance_bridge.sql`.

Minimum contract:

- transaction-wrapped and sentinel-guarded.
- `public.accept_estimate_to_job_from_quickbooks(p_company_id uuid, p_connection_id uuid, p_estimate_id uuid, p_qb_estimate_id text, p_idempotency_key text) returns jsonb`
- `security definer`, `set search_path = public, private, pg_temp`
- grant execute to `service_role` only.
- validate QuickBooks connection, company, `sync_enabled`, and not `push_only`.
- validate estimate company, `qb_id`, and `opportunity_id`.
- derive actor from company-owned data: `companies.account_holder_id`, then active admin from `companies.admin_ids`.
- if no actor is available, return `jsonb_build_object('status','needs_review','reason','integration_acceptance_actor_not_found')`.
- run the same acceptance-side work as `public.accept_estimate_to_job`: request idempotency row, `private.sync_accepted_estimate_project_tasks`, `private.persist_estimate_material_booking_projection`, `private.persist_catalog_mapping_notifications_from_missing_mappings`.
- return the existing response shape plus `status = 'succeeded'`, `source = 'quickbooks_webhook'`, `qb_estimate_id`, and `idempotent_replay`.
- explicitly do not call `complete_project_task` and do not write physical stock deductions.

- [ ] **Step 3E: Trigger the acceptance bridge from webhook estimate apply**

When `QuickBooksWebhookApplyService.applyEstimate(...)` maps a fetched estimate to `status = "approved"` from `TxnStatus = Accepted`, call `QuickBooksEstimateAcceptanceService.acceptFromQuickBooks(...)` after the estimate and line items have been persisted and echo suppression is in place.

Return the acceptance bridge result in `ApplyEntityResult.afterSnapshot` or equivalent so the webhook route records it in `accounting_sync_events`. If the bridge returns `needs_review`, the webhook still returns `200` but the audit event must be `status = "needs_review"` with `decision = "needs_review"`.

- [ ] **Step 4: Implement reconcile service**

Create `src/lib/api/services/quickbooks-reconcile-service.ts`:

```ts
import { decideQboConflict } from "./qbo-conflict";
import type { AccountingSyncAuditService } from "./accounting-sync-audit-service";

export interface ReconcileRecordInput {
  companyId: string;
  connectionId: string;
  entityType: "customer" | "invoice" | "estimate" | "payment";
  entityId: string;
  externalId: string;
  opsUpdatedAt: string | null;
  qbUpdatedAt: string | null;
  materialDiff: boolean;
  moneyTouched?: boolean;
}

export class QuickBooksReconcileService {
  constructor(private readonly deps: {
    enqueue: (input: { companyId: string; connectionId: string; entityType: string; entityId: string; externalId: string; operation: "update" }) => Promise<void>;
    audit: AccountingSyncAuditService;
  }) {}

  async reconcileLinkedRecord(input: ReconcileRecordInput): Promise<void> {
    const result = decideQboConflict(input);
    if (result.decision === "ops_won") {
      await this.deps.enqueue({
        companyId: input.companyId,
        connectionId: input.connectionId,
        entityType: input.entityType,
        entityId: input.entityId,
        externalId: input.externalId,
        operation: "update",
      });
    }

    await this.deps.audit.record({
      companyId: input.companyId,
      connectionId: input.connectionId,
      provider: "quickbooks",
      direction: "reconcile",
      entityType: input.entityType,
      entityId: input.entityId,
      externalId: input.externalId,
      operation: "reconcile",
      status: result.decision === "needs_review" ? "needs_review" : "succeeded",
      source: "reconcile",
      decision: result.decision === "skipped" ? "skipped" : result.decision,
      opsUpdatedAt: input.opsUpdatedAt,
      qbUpdatedAt: input.qbUpdatedAt,
      error: result.reason ?? null,
    });
  }
}
```

- [ ] **Step 5: Implement reconcile route**

Create `src/app/api/cron/accounting/quickbooks/reconcile/route.ts` with:

- `CRON_SECRET` bearer auth.
- Service-role Supabase.
- Connected QuickBooks connections only.
- `sync_direction = 'bidirectional'` only.
- Bounded batch of linked records.
- No outbound writes when `ACCOUNTING_WRITE_ENABLED !== "true"`; in that case record system audit events and return `409`.

Return shape:

```json
{ "processed": 0, "opsWon": 0, "qbWon": 0, "needsReview": 0 }
```

- [ ] **Step 6: Run tests**

Run:

```bash
npm test -- tests/integration/qbo-webhook-route.test.ts tests/unit/services/quickbooks-reconcile-service.test.ts tests/integration/qbo-reconcile-route.test.ts
npm test -- tests/unit/services/quickbooks-estimate-acceptance-service.test.ts tests/unit/supabase/qbo-inbound-estimate-acceptance-bridge-migration.test.ts
npm run type-check
git diff --check
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/app/api/integrations/quickbooks/webhook/route.ts src/lib/api/services/quickbooks-webhook-apply-service.ts src/lib/api/services/quickbooks-estimate-acceptance-service.ts src/lib/api/services/quickbooks-reconcile-service.ts src/app/api/cron/accounting/quickbooks/reconcile/route.ts supabase/migrations/20260605110000_qbo_inbound_estimate_acceptance_bridge.sql tests/integration/qbo-webhook-route.test.ts tests/unit/services/quickbooks-estimate-acceptance-service.test.ts tests/unit/services/quickbooks-reconcile-service.test.ts tests/unit/supabase/qbo-inbound-estimate-acceptance-bridge-migration.test.ts tests/integration/qbo-reconcile-route.test.ts
git commit -m "feat(qbo): audit webhook and reconcile sync"
```

Expected: commit created.

## Task 6: Settings Accounting UX And Accounting Page Cleanup

**Owner:** `QUICKBOOKS SYNC - P2-4`

**Files:**

- Modify: `src/components/settings/accounting-tab.tsx`
- Create: `src/components/settings/accounting-sync-panel.tsx`
- Create: `src/components/settings/accounting-provider-picker.tsx`
- Create: `src/components/settings/accounting-disconnect-dialog.tsx`
- Create: `src/lib/hooks/use-qbo-sync-health.ts`
- Create: `src/lib/hooks/use-qbo-sync-actions.ts`
- Modify: `src/lib/api/query-client.ts`
- Modify: `src/lib/hooks/index.ts`
- Create: `src/app/api/integrations/accounting/sync-health/route.ts`
- Create: `src/app/api/integrations/accounting/sync-actions/route.ts`
- Modify: `src/app/(dashboard)/accounting/page.tsx`
- Replace: `tests/unit/components/accounting-page-import-tab.test.tsx` with `tests/unit/components/accounting-page-tabs.test.tsx`
- Create: `tests/unit/components/settings-accounting-sync-panel.test.tsx`
- Create: `tests/unit/hooks/use-qbo-sync-health.test.tsx`
- Create: `tests/integration/accounting-sync-health-route.test.ts`
- Create: `tests/integration/accounting-sync-actions-route.test.ts`
- Modify: `src/i18n/dictionaries/en/accounting.json`
- Modify: `src/i18n/dictionaries/es/accounting.json`

- [ ] **Step 1: Write Accounting page cleanup test**

Replace `tests/unit/components/accounting-page-import-tab.test.tsx` with `tests/unit/components/accounting-page-tabs.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/expenses/expense-review-dashboard", () => ({ ExpenseReviewDashboard: () => <div /> }));
vi.mock("@/components/metrics", () => ({ MetricsHeader: () => <div /> }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("tab=integrations") }));
vi.mock("@/lib/hooks/use-page-title", () => ({ usePageTitle: () => {} }));
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (k: string) => k }),
  useLocale: () => ({ locale: "en" }),
}));
vi.mock("@/lib/hooks", () => ({
  useAccountingConnections: () => ({ data: [], isLoading: false }),
  useSyncHistory: () => ({ data: [], isLoading: false }),
  useInvoices: () => ({ data: [] }),
  useClients: () => ({ data: { clients: [] } }),
  useAccountingMetrics: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/lib/store/auth-store", () => ({ useAuthStore: () => ({ company: { id: "co" } }) }));
vi.mock("@/lib/store/permissions-store", () => ({
  usePermissionStore: (sel: (s: { can: (p: string) => boolean }) => unknown) => sel({ can: () => true }),
}));

import AccountingPage from "@/app/(dashboard)/accounting/page";

describe("AccountingPage tabs", () => {
  it("does not expose integration or import setup tabs", () => {
    render(<AccountingPage />);
    expect(screen.queryByText("tabs.integrations")).not.toBeInTheDocument();
    expect(screen.queryByText("tabs.import")).not.toBeInTheDocument();
    expect(screen.getByText("tabs.dashboard")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Write Settings panel tests**

Create `tests/unit/components/settings-accounting-sync-panel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccountingSyncPanel } from "@/components/settings/accounting-sync-panel";

vi.mock("@/i18n/client", () => ({ useDictionary: () => ({ t: (k: string) => k }) }));

describe("AccountingSyncPanel", () => {
  it("renders healthy QuickBooks sync as one quiet status panel", () => {
    render(<AccountingSyncPanel
      canManage
      health={{
        provider: "quickbooks",
        status: "sync_active",
        connectedCompanyName: "Maverick Projects",
        lastSuccessfulSyncAt: "2026-06-05T10:00:00Z",
        conflictCount: 0,
        retryCount: 0,
        action: null,
      }}
      onConnect={vi.fn()}
      onDisconnect={vi.fn()}
      onRetry={vi.fn()}
      onReviewConflicts={vi.fn()}
    />);

    expect(screen.getByText("qbo.sync.status.syncActive")).toBeInTheDocument();
    expect(screen.getByText("Maverick Projects")).toBeInTheDocument();
    expect(screen.queryByText(/read-only/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/full CRUD/i)).not.toBeInTheDocument();
    expect(screen.queryByText("qbo.sync.actions.retry")).not.toBeInTheDocument();
  });

  it("shows only the required action when review is needed", () => {
    render(<AccountingSyncPanel
      canManage
      health={{
        provider: "quickbooks",
        status: "needs_review",
        connectedCompanyName: "Maverick Projects",
        lastSuccessfulSyncAt: "2026-06-05T10:00:00Z",
        conflictCount: 2,
        retryCount: 0,
        action: "review_conflicts",
      }}
      onConnect={vi.fn()}
      onDisconnect={vi.fn()}
      onRetry={vi.fn()}
      onReviewConflicts={vi.fn()}
    />);

    expect(screen.getByText("qbo.sync.actions.reviewConflicts")).toBeInTheDocument();
    expect(screen.queryByText("qbo.sync.actions.retry")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Write sync health route test**

Create `tests/integration/accounting-sync-health-route.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const verifyAdminAuth = vi.fn();
const findUserByAuth = vi.fn();
const checkPermissionById = vi.fn();
const single = vi.fn();

vi.mock("@/lib/firebase/admin-verify", () => ({ verifyAdminAuth: (r: unknown) => verifyAdminAuth(r) }));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({ findUserByAuth: (...a: unknown[]) => findUserByAuth(...a) }));
vi.mock("@/lib/supabase/check-permission", () => ({ checkPermissionById: (...a: unknown[]) => checkPermissionById(...a) }));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: single }) }) }) }) }),
}));

async function route() {
  return (await import("@/app/api/integrations/accounting/sync-health/route")).GET;
}

describe("GET /api/integrations/accounting/sync-health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyAdminAuth.mockResolvedValue({ uid: "fb-1" });
    findUserByAuth.mockResolvedValue({ id: "user-1", company_id: "co-1" });
    checkPermissionById.mockResolvedValue(true);
    single.mockResolvedValue({ data: null, error: null });
  });

  it("requires accounting.view", async () => {
    checkPermissionById.mockResolvedValue(false);
    const GET = await route();
    const res = await GET(new Request("http://localhost/api/integrations/accounting/sync-health") as never);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 4: Run failing UI and route tests**

Run:

```bash
npm test -- tests/unit/components/accounting-page-tabs.test.tsx tests/unit/components/settings-accounting-sync-panel.test.tsx tests/integration/accounting-sync-health-route.test.ts
```

Expected: fails before implementation.

- [ ] **Step 5: Implement sync health hook and query keys**

In `src/lib/api/query-client.ts`, add:

```ts
syncHealth: (companyId: string) =>
  [...queryKeys.accounting.all, "syncHealth", companyId] as const,
```

Create `src/lib/hooks/use-qbo-sync-health.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/query-client";
import { useAuthStore } from "@/lib/store/auth-store";

export type QboSyncHealthStatus =
  | "not_connected"
  | "connected"
  | "sync_active"
  | "setup_incomplete"
  | "paused"
  | "retry_available"
  | "reconnect_required"
  | "needs_review";

export interface QboSyncHealth {
  provider: "quickbooks" | null;
  status: QboSyncHealthStatus;
  connectedCompanyName: string | null;
  lastSuccessfulSyncAt: string | null;
  conflictCount: number;
  retryCount: number;
  action: "connect" | "retry" | "reconnect" | "review_conflicts" | "resume" | null;
}

async function fetchHealth(): Promise<QboSyncHealth> {
  const res = await fetch("/api/integrations/accounting/sync-health", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load accounting sync health");
  return res.json();
}

export function useQboSyncHealth() {
  const companyId = useAuthStore((s) => s.company?.id ?? "");
  return useQuery({
    queryKey: queryKeys.accounting.syncHealth(companyId),
    queryFn: fetchHealth,
    enabled: Boolean(companyId),
    refetchInterval: 30_000,
  });
}
```

- [ ] **Step 6: Implement sync health route**

Create `src/app/api/integrations/accounting/sync-health/route.ts`:

```ts
import { NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export async function GET(request: Request) {
  const auth = await verifyAdminAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServiceRoleClient();
  const user = await findUserByAuth(supabase, auth.uid);
  if (!user?.id || !user.company_id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const allowed = await checkPermissionById(user.id as string, "accounting.view");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data: connection, error } = await supabase
    .from("accounting_connections")
    .select("id, provider, is_connected, last_sync_at, sync_enabled, sync_direction")
    .eq("company_id", String(user.company_id))
    .eq("provider", "quickbooks")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!connection?.is_connected) {
    return NextResponse.json({
      provider: null,
      status: "not_connected",
      connectedCompanyName: null,
      lastSuccessfulSyncAt: null,
      conflictCount: 0,
      retryCount: 0,
      action: "connect",
    });
  }

  return NextResponse.json({
    provider: "quickbooks",
    status: connection.sync_direction === "bidirectional" ? "sync_active" : "setup_incomplete",
    connectedCompanyName: "QuickBooks",
    lastSuccessfulSyncAt: connection.last_sync_at,
    conflictCount: 0,
    retryCount: 0,
    action: connection.sync_direction === "bidirectional" ? null : "review_conflicts",
  });
}
```

- [ ] **Step 7: Implement the Settings panel**

Create `src/components/settings/accounting-sync-panel.tsx`:

```tsx
"use client";

import { AlertTriangle, CheckCircle2, ExternalLink, Link2, RotateCcw, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useDictionary } from "@/i18n/client";
import type { QboSyncHealth } from "@/lib/hooks/use-qbo-sync-health";

interface Props {
  canManage: boolean;
  health: QboSyncHealth;
  onConnect: () => void;
  onDisconnect: () => void;
  onRetry: () => void;
  onReviewConflicts: () => void;
}

export function AccountingSyncPanel(props: Props) {
  const { t } = useDictionary("accounting");
  const connected = props.health.provider === "quickbooks";
  const requiresAction = props.health.action;

  return (
    <Card variant="default" className="p-4 max-w-[760px]">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="font-mono text-micro text-text-mute uppercase tracking-wider">// ACCOUNTING SOFTWARE</p>
          <div className="flex items-center gap-2">
            {props.health.status === "sync_active" ? (
              <CheckCircle2 className="w-[18px] h-[18px] text-status-success" />
            ) : (
              <AlertTriangle className="w-[18px] h-[18px] text-ops-amber" />
            )}
            <h2 className="font-mohave text-display-sm text-text uppercase">
              {t(`qbo.sync.status.${props.health.status === "sync_active" ? "syncActive" : props.health.status}`)}
            </h2>
          </div>
          <p className="font-mohave text-body text-text-2">
            {connected ? props.health.connectedCompanyName ?? "QuickBooks" : t("qbo.sync.copy.notConnected")}
          </p>
          <p className="font-mono text-caption-sm text-text-3">
            {t("qbo.sync.lastSync")} {props.health.lastSuccessfulSyncAt ?? "—"}
          </p>
        </div>

        {requiresAction === "connect" && props.canManage && (
          <Button onClick={props.onConnect}>
            <Link2 className="w-[14px] h-[14px] mr-1" />
            {t("qbo.sync.actions.connect")}
          </Button>
        )}
        {requiresAction === "retry" && props.canManage && (
          <Button onClick={props.onRetry}>
            <RotateCcw className="w-[14px] h-[14px] mr-1" />
            {t("qbo.sync.actions.retry")}
          </Button>
        )}
        {requiresAction === "review_conflicts" && props.canManage && (
          <Button onClick={props.onReviewConflicts}>
            <ExternalLink className="w-[14px] h-[14px] mr-1" />
            {t("qbo.sync.actions.reviewConflicts")}
          </Button>
        )}
      </div>

      {connected && props.canManage && (
        <div className="mt-4 pt-3 border-t border-border flex items-center gap-3">
          <button className="font-mono text-micro text-text-3 hover:text-text-2 uppercase" onClick={props.onDisconnect}>
            <Unlink className="inline w-[12px] h-[12px] mr-1" />
            {t("qbo.sync.actions.disconnect")}
          </button>
          <button className="font-mono text-micro text-text-3 hover:text-text-2 uppercase">
            {t("qbo.sync.actions.advanced")}
          </button>
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 8: Replace Settings accounting tab**

Modify `src/components/settings/accounting-tab.tsx` so it:

- Uses `useQboSyncHealth`.
- Renders `AccountingSyncPanel`.
- Shows `AccountingProviderPicker` only when not connected and the user clicks connect.
- Removes visible read-only/full-CRUD controls.
- Removes visible sync enabled toggle.
- Removes sync history card from the healthy primary surface.
- Uses `AccountingDisconnectDialog` for `DISCONNECT` confirmation with copy `DESTRUCTIVE. NO UNDO.`

- [ ] **Step 9: Clean `/accounting` tabs**

Modify `src/app/(dashboard)/accounting/page.tsx`:

- Change `type TabValue = "dashboard" | "expenses"`.
- Remove imports for `QuickBooksImportTab`, `useInitiateOAuth`, `useDisconnectProvider`, `useTriggerSync`, `useSyncHistory`, `AccountingProvider`, and `AccountingConnection` if unused.
- Remove `ConnectionCard`.
- Remove sync history UI.
- Remove `integrations` and `import` from `tabs`.
- Normalize invalid query tabs to `dashboard`.

The tab setup becomes:

```ts
type TabValue = "dashboard" | "expenses";

const [activeTab, setActiveTab] = useState<TabValue>(
  initialTab === "expenses" ? "expenses" : "dashboard"
);

const tabs = useMemo<{ value: TabValue; label: string }[]>(() => {
  const all: { value: TabValue; label: string; show: boolean }[] = [
    { value: "dashboard", label: t("tabs.dashboard"), show: true },
    { value: "expenses", label: t("tabs.expenses"), show: can("expenses.approve") },
  ];
  return all.filter((tab) => tab.show);
}, [t, can]);
```

- [ ] **Step 10: Add dictionary keys**

Add to `src/i18n/dictionaries/en/accounting.json` and `src/i18n/dictionaries/es/accounting.json` with parity:

```json
{
  "qbo": {
    "sync": {
      "status": {
        "not_connected": "NOT CONNECTED",
        "connected": "CONNECTED",
        "syncActive": "SYNC ACTIVE",
        "setup_incomplete": "SETUP INCOMPLETE",
        "paused": "SYNC PAUSED",
        "retry_available": "RETRY AVAILABLE",
        "reconnect_required": "RECONNECT REQUIRED",
        "needs_review": "REVIEW REQUIRED"
      },
      "copy": {
        "notConnected": "Connect QuickBooks to keep accounting in line."
      },
      "lastSync": "Last sync",
      "actions": {
        "connect": "CONNECT ACCOUNTING SOFTWARE",
        "retry": "RETRY",
        "reviewConflicts": "REVIEW CONFLICTS",
        "disconnect": "DISCONNECT",
        "advanced": "ADVANCED"
      },
      "confirm": {
        "disconnectTitle": "DISCONNECT QUICKBOOKS",
        "disconnectBody": "DESTRUCTIVE. NO UNDO.",
        "disconnectConfirm": "DISCONNECT",
        "cancel": "CANCEL"
      }
    }
  }
}
```

- [ ] **Step 11: Run UI tests**

Run:

```bash
npm test -- tests/unit/components/accounting-page-tabs.test.tsx tests/unit/components/settings-accounting-sync-panel.test.tsx tests/unit/hooks/use-qbo-sync-health.test.tsx tests/integration/accounting-sync-health-route.test.ts tests/integration/accounting-sync-actions-route.test.ts tests/unit/i18n/accounting-qbo-keys.test.ts
```

Expected: PASS.

- [ ] **Step 12: Browser verify**

Run the app:

```bash
DEV_BYPASS_AUTH=true NEXT_PUBLIC_DEV_BYPASS_AUTH=true npm run dev -- --port 3002
```

Use Browser to inspect:

- `http://localhost:3002/settings?tab=accounting`
- `http://localhost:3002/accounting?tab=integrations`

Expected:

- Settings shows one accounting sync panel.
- Healthy connected state does not show read-only/full-CRUD selector.
- `/accounting?tab=integrations` lands on dashboard content.
- No visible `Integrations` or `QuickBooks Import` tab under Accounting.
- No text overlap at desktop width.

- [ ] **Step 13: Commit**

Run:

```bash
git add src/components/settings/accounting-tab.tsx src/components/settings/accounting-sync-panel.tsx src/components/settings/accounting-provider-picker.tsx src/components/settings/accounting-disconnect-dialog.tsx src/lib/hooks/use-qbo-sync-health.ts src/lib/hooks/use-qbo-sync-actions.ts src/lib/api/query-client.ts src/lib/hooks/index.ts src/app/api/integrations/accounting/sync-health/route.ts src/app/api/integrations/accounting/sync-actions/route.ts 'src/app/(dashboard)/accounting/page.tsx' tests/unit/components/accounting-page-tabs.test.tsx tests/unit/components/settings-accounting-sync-panel.test.tsx tests/unit/hooks/use-qbo-sync-health.test.tsx tests/integration/accounting-sync-health-route.test.ts tests/integration/accounting-sync-actions-route.test.ts src/i18n/dictionaries/en/accounting.json src/i18n/dictionaries/es/accounting.json
git commit -m "feat(qbo): simplify accounting sync settings"
```

Expected: commit created.

## Task 7: Import Review Hardening And Bug-Report Regression Gates

**Owner:** `QUICKBOOKS SYNC - P2-4`

**Files:**

- Modify: `src/components/accounting/qbo/customer-match-table.tsx`
- Modify: `src/components/accounting/qbo/quickbooks-import-tab.tsx`
- Modify: `src/lib/hooks/use-qbo-import.ts`
- Modify: `src/lib/api/services/quickbooks-import-service.ts`
- Modify: `src/app/api/integrations/quickbooks/import/route.ts`
- Modify: `src/app/api/integrations/quickbooks/import/apply/route.ts`
- Modify tests:
  - `tests/unit/components/qbo-customer-match-table.test.tsx`
  - `tests/unit/components/quickbooks-import-tab.test.tsx`
  - `tests/unit/hooks/use-qbo-import.test.tsx`
  - `tests/integration/qbo-import-route.test.ts`
  - `tests/integration/qbo-import-apply-route.test.ts`
  - `src/lib/api/services/__tests__/quickbooks-import-service.test.ts`

- [ ] **Step 1: Add regression tests for the known bug reports**

Add tests proving:

- Bug `11fbc17a-b3b9-426e-a4ee-7131783357d7`: apply cannot report success when live writes fail.
- Bug `d58d63e2-2098-49ed-bc0d-a4d59e853319`: `needs_review` rows are visually marked.
- Bug `7dd3a9e0-809f-46c3-b3d3-c6b5c5ab5d43`: exact matches do not show misleading `0%`.
- Bug `d56a1ff8-6b98-4df3-8a1d-de37c1c46faa`: pull/apply status is pollable and not a frozen button.

Example exact-match assertion:

```tsx
expect(screen.getByText("EMAIL EXACT")).toBeInTheDocument();
expect(screen.queryByText("0%")).not.toBeInTheDocument();
```

Example apply failure assertion:

```ts
expect(response.status).toBe(500);
expect(await response.json()).toEqual(expect.objectContaining({
  error: expect.stringContaining("QuickBooks import apply failed"),
}));
expect(notificationInsert).not.toHaveBeenCalledWith(expect.objectContaining({
  type: "accounting_import_complete",
}));
```

- [ ] **Step 2: Run failing import tests**

Run:

```bash
npm test -- tests/unit/components/qbo-customer-match-table.test.tsx tests/unit/components/quickbooks-import-tab.test.tsx tests/unit/hooks/use-qbo-import.test.tsx tests/integration/qbo-import-route.test.ts tests/integration/qbo-import-apply-route.test.ts src/lib/api/services/__tests__/quickbooks-import-service.test.ts
```

Expected: at least one new regression test fails before fixes.

- [ ] **Step 3: Fix review table copy and row state**

Modify `src/components/accounting/qbo/customer-match-table.tsx`:

- For exact email/name matches, render basis text such as `EMAIL EXACT` or `NAME EXACT`.
- Do not render a numeric confidence suffix when confidence is exact or when the score is missing.
- Add `data-state="needs-review"` on blocking rows.
- Add OPS tokenized attention border/text only on the row where action is required.

- [ ] **Step 4: Make import run status pollable**

Modify `src/lib/hooks/use-qbo-import.ts`:

- Poll `GET /api/integrations/quickbooks/import?runId=...` while run status is `pending`, `pulling`, or `applying`.
- Stop polling when status is `staged`, `applied`, or `error`.
- Expose `isWorking`, `runStatus`, and formatted counts to `QuickBooksImportTab`.

- [ ] **Step 5: Make apply failures honest**

Modify `src/lib/api/services/quickbooks-import-service.ts` and `src/app/api/integrations/quickbooks/import/apply/route.ts`:

- Treat zero persisted core records with non-zero staged records as an error.
- Return `500` when service-role write failures occur.
- Do not emit completion notification unless apply status is `applied`.
- Preserve warning text for non-fatal rejected cross-tenant links, but do not hide persistence failures behind warnings.

- [ ] **Step 6: Run import tests**

Run:

```bash
npm test -- tests/unit/components/qbo-customer-match-table.test.tsx tests/unit/components/quickbooks-import-tab.test.tsx tests/unit/hooks/use-qbo-import.test.tsx tests/integration/qbo-import-route.test.ts tests/integration/qbo-import-apply-route.test.ts src/lib/api/services/__tests__/quickbooks-import-service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/components/accounting/qbo/customer-match-table.tsx src/components/accounting/qbo/quickbooks-import-tab.tsx src/lib/hooks/use-qbo-import.ts src/lib/api/services/quickbooks-import-service.ts src/app/api/integrations/quickbooks/import/route.ts src/app/api/integrations/quickbooks/import/apply/route.ts tests/unit/components/qbo-customer-match-table.test.tsx tests/unit/components/quickbooks-import-tab.test.tsx tests/unit/hooks/use-qbo-import.test.tsx tests/integration/qbo-import-route.test.ts tests/integration/qbo-import-apply-route.test.ts src/lib/api/services/__tests__/quickbooks-import-service.test.ts
git commit -m "fix(qbo): harden import review and apply proof"
```

Expected: commit created.

## Task 8: Notifications And Admin Actions

**Owner:** `QUICKBOOKS SYNC - P2-3`

**Files:**

- Modify: `src/app/api/cron/accounting/quickbooks/push-queue/route.ts`
- Modify: `src/app/api/cron/accounting/quickbooks/reconcile/route.ts`
- Modify: `src/app/api/integrations/accounting/sync-actions/route.ts`
- Modify notification service files used by existing routes.
- Create or modify tests under `tests/integration/notifications.test.ts` and route-specific integration tests.

- [ ] **Step 1: Write notification assertions**

Add route tests that assert persistent notifications for:

- token reconnect required
- conflicts requiring review
- retry exhaustion
- initial reconcile complete

Required notification shape:

```ts
expect(notificationInsert).toHaveBeenCalledWith(expect.objectContaining({
  persistent: true,
  action_url: "/settings?tab=accounting",
  action_label: "REVIEW CONFLICTS",
}));
```

- [ ] **Step 2: Implement sync actions route**

Create or complete `src/app/api/integrations/accounting/sync-actions/route.ts` with these actions:

```ts
type SyncAction =
  | "retry"
  | "pause"
  | "resume"
  | "review_conflicts"
  | "disconnect";
```

Rules:

- Requires Firebase auth.
- Requires same company as authenticated user.
- Requires `accounting.manage_connections`.
- `retry` only moves `blocked` or `failed` queue rows back to `pending`.
- `pause` sets `sync_enabled = false`.
- `resume` sets `sync_enabled = true` only when setup gates are complete.
- `disconnect` calls existing provider disconnect behavior and requires `confirmText === "DESTRUCTIVE. NO UNDO."`.
- `review_conflicts` returns the conflict count and route target; it does not mutate data.

- [ ] **Step 3: Wire notifications into worker and reconcile**

In worker/reconcile route failure branches:

- retry exhaustion -> persistent notification, action `RETRY`
- `needs_review` -> persistent notification, action `REVIEW CONFLICTS`
- invalid grant -> persistent notification, action `RECONNECT QUICKBOOKS`
- successful reconcile completion -> standard notification

- [ ] **Step 4: Run notification and action tests**

Run:

```bash
npm test -- tests/integration/accounting-sync-actions-route.test.ts tests/integration/qbo-push-queue-route.test.ts tests/integration/qbo-reconcile-route.test.ts tests/integration/notifications.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/app/api/cron/accounting/quickbooks/push-queue/route.ts src/app/api/cron/accounting/quickbooks/reconcile/route.ts src/app/api/integrations/accounting/sync-actions/route.ts tests/integration/accounting-sync-actions-route.test.ts tests/integration/qbo-push-queue-route.test.ts tests/integration/qbo-reconcile-route.test.ts tests/integration/notifications.test.ts
git commit -m "feat(qbo): add sync notifications and actions"
```

Expected: commit created.

## Task 9: Bible Updates And Maverick Sandbox QA

**Owner:** `QUICKBOOKS SYNC - P2-5`

**Files:**

- Modify: `/Users/jacksonsweet/Projects/OPS/ops-software-bible/04_API_AND_INTEGRATION.md`
- Modify: `/Users/jacksonsweet/Projects/OPS/ops-software-bible/09_FINANCIAL_SYSTEM.md`
- Create: `scripts/qbo-p2-maverick-smoke.ts`
- Create: `docs/qa/2026-06-05-qbo-p2-maverick-sandbox.md`

- [ ] **Step 1: Write the sandbox smoke script**

Create `scripts/qbo-p2-maverick-smoke.ts`:

```ts
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const companyId = process.env.QBO_MAVERICK_COMPANY_ID;

if (!supabaseUrl || !serviceKey || !companyId) {
  throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and QBO_MAVERICK_COMPANY_ID are required");
}

if (process.env.QB_ENVIRONMENT === "production") {
  throw new Error("Maverick smoke must run against QuickBooks sandbox");
}

if (process.env.ACCOUNTING_WRITE_ENABLED !== "true") {
  console.log("WRITE GATE OFF");
  process.exit(0);
}

const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

async function main() {
  const { data: connection, error } = await supabase
    .from("accounting_connections")
    .select("id, provider, is_connected, sync_direction, last_sync_at")
    .eq("company_id", companyId)
    .eq("provider", "quickbooks")
    .maybeSingle();

  if (error) throw error;
  if (!connection?.is_connected) throw new Error("Maverick QuickBooks connection is not active");

  const { count: pendingCount } = await supabase
    .from("accounting_sync_queue")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "pending");

  const { count: eventCount } = await supabase
    .from("accounting_sync_events")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId);

  console.log(JSON.stringify({
    connection,
    pendingQueueRows: pendingCount ?? 0,
    syncEventRows: eventCount ?? 0,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Run non-writing smoke first**

Run:

```bash
SUPABASE_URL="$SUPABASE_URL" SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" QBO_MAVERICK_COMPANY_ID="$QBO_MAVERICK_COMPANY_ID" QB_ENVIRONMENT=sandbox ACCOUNTING_WRITE_ENABLED=false npx tsx scripts/qbo-p2-maverick-smoke.ts
```

Expected:

```text
WRITE GATE OFF
```

- [ ] **Step 3: Run full local verification**

Run:

```bash
npm run type-check
npm test -- tests/unit/supabase/qbo-p2-sync-queue-migration.test.ts src/lib/api/services/__tests__/accounting-sync-queue-service.test.ts src/lib/api/services/__tests__/accounting-sync-audit-service.test.ts src/lib/api/services/__tests__/qbo-conflict.test.ts src/lib/api/services/__tests__/qbo-push-mappers.test.ts src/lib/api/services/__tests__/quickbooks-write-service.test.ts tests/integration/qbo-push-queue-route.test.ts tests/integration/qbo-reconcile-route.test.ts tests/integration/qbo-webhook-route.test.ts tests/unit/components/accounting-page-tabs.test.tsx tests/unit/components/settings-accounting-sync-panel.test.tsx tests/integration/accounting-sync-health-route.test.ts tests/integration/accounting-sync-actions-route.test.ts
```

Expected: PASS.

- [ ] **Step 4: Browser proof**

Run:

```bash
DEV_BYPASS_AUTH=true NEXT_PUBLIC_DEV_BYPASS_AUTH=true npm run dev -- --port 3002
```

Use Browser:

- Open `http://localhost:3002/settings?tab=accounting`.
- Capture healthy, not-connected, needs-review, and reconnect-required states using mocked route data or seeded test state.
- Open `http://localhost:3002/accounting?tab=integrations`.
- Confirm Accounting shows dashboard/expenses only.

Record screenshots or exact observations in `docs/qa/2026-06-05-qbo-p2-maverick-sandbox.md`.

- [ ] **Step 5: Run Maverick write proof only in sandbox**

Before this step, confirm in terminal:

```bash
node -e "console.log({ QB_ENVIRONMENT: process.env.QB_ENVIRONMENT, ACCOUNTING_WRITE_ENABLED: process.env.ACCOUNTING_WRITE_ENABLED })"
```

Expected:

```text
{ QB_ENVIRONMENT: 'sandbox', ACCOUNTING_WRITE_ENABLED: 'true' }
```

Then run controlled sandbox cases:

- Create OPS client -> verify QBO Customer.
- Update OPS client -> verify QBO Customer update.
- Create OPS estimate with lines -> verify QBO Estimate.
- Create OPS invoice with lines -> verify QBO Invoice.
- Record OPS payment -> verify QBO Payment.
- Update QBO customer -> verify OPS receives webhook or reconcile update.
- Update QBO invoice balance/status -> verify OPS reconcile.
- Void behavior -> verify OPS and QBO states match `propagate_deletes`.
- Repeat worker route -> verify no duplicate QB rows.

Record:

- queue counts before/after
- `accounting_sync_events` sample rows
- OPS `qb_id` values
- QBO sandbox record IDs
- duplicate scan result
- balance reconciliation result

- [ ] **Step 6: Update Bible**

In `/Users/jacksonsweet/Projects/OPS/ops-software-bible/04_API_AND_INTEGRATION.md`, add a QuickBooks P2 subsection covering:

- queue schema
- write gate
- worker route
- reconcile route
- webhook audit
- Settings-only customer UX
- developer/sandbox status of read-only import

In `/Users/jacksonsweet/Projects/OPS/ops-software-bible/09_FINANCIAL_SYSTEM.md`, update Accounting Integrations covering:

- `accounting_sync_queue`
- `accounting_sync_events`
- customer UI states
- delete/void semantics
- CanPro production admin block
- Maverick sandbox proof status

- [ ] **Step 7: Commit**

Run:

```bash
git add scripts/qbo-p2-maverick-smoke.ts docs/qa/2026-06-05-qbo-p2-maverick-sandbox.md /Users/jacksonsweet/Projects/OPS/ops-software-bible/04_API_AND_INTEGRATION.md /Users/jacksonsweet/Projects/OPS/ops-software-bible/09_FINANCIAL_SYSTEM.md
git commit -m "docs(qbo): capture p2 sandbox proof"
```

Expected: commit created.

## Final Review Gates

Run these from the final integration worktree:

```bash
git status --short
npm run type-check
npm test -- tests/unit/supabase/qbo-p2-sync-queue-migration.test.ts src/lib/api/services/__tests__/accounting-sync-queue-service.test.ts src/lib/api/services/__tests__/accounting-sync-audit-service.test.ts src/lib/api/services/__tests__/qbo-conflict.test.ts src/lib/api/services/__tests__/qbo-push-mappers.test.ts src/lib/api/services/__tests__/quickbooks-write-service.test.ts tests/integration/qbo-push-queue-route.test.ts tests/integration/qbo-reconcile-route.test.ts tests/integration/qbo-webhook-route.test.ts tests/unit/components/accounting-page-tabs.test.tsx tests/unit/components/settings-accounting-sync-panel.test.tsx tests/integration/accounting-sync-health-route.test.ts tests/integration/accounting-sync-actions-route.test.ts tests/unit/i18n/accounting-qbo-keys.test.ts
```

Expected:

- Type-check passes.
- Focused tests pass.
- `git status --short` contains only committed branch changes or intentionally untracked QA artifacts.

Run banned customer-surface scan:

```bash
rg -n "modeReadOnly|modeFullCrud|syncMode|syncEnabled|syncHistory|QuickBooks Import|tabs\\.integrations|tabs\\.import" src/components/settings src/app/'(dashboard)'/accounting src/i18n/dictionaries/en/accounting.json src/i18n/dictionaries/es/accounting.json
```

Expected:

- No match in the primary Settings accounting panel.
- No match in `/accounting` page.
- Import text may remain only in developer/admin import components if the route is no longer exposed from Accounting.

Run write-gate proof:

```bash
node -e "console.log(process.env.ACCOUNTING_WRITE_ENABLED === 'true' ? 'WRITE ENABLED' : 'WRITE DISABLED')"
```

Expected outside sandbox write QA:

```text
WRITE DISABLED
```

## Review Checklist

- [ ] No production QuickBooks write env vars were added or changed.
- [ ] No CanPro connection attempt was made.
- [ ] Queue triggers skip QuickBooks-originated inbound writes.
- [ ] Queue and events use `company_id uuid`; joins to `accounting_connections.company_id text` cast with `company_id::text`.
- [ ] Worker route requires `CRON_SECRET`.
- [ ] Worker route requires `ACCOUNTING_WRITE_ENABLED === "true"`.
- [ ] Webhook route remains signature-verified and returns `200` for poison entity payloads after recording failure.
- [ ] Accounting page has no integration setup tab.
- [ ] Settings page has one status-first accounting panel.
- [ ] Customer UI has no read-only/full-CRUD selector.
- [ ] `DISCONNECT` is low-prominence and requires destructive confirmation.
- [ ] `ADVANCED` is low-prominence and permission-gated.
- [ ] Import apply cannot report success while failing persistence.
- [ ] Exact QBO matches do not show misleading `0%`.
- [ ] `needs_review` rows are visible where the operator acts.
- [ ] Bible sections are current.
- [ ] Maverick sandbox proof is recorded before production write enablement is discussed.
