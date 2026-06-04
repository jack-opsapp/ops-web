begin;

-- ============================================================================
-- QuickBooks read-only sync — fix: FULL unique indexes for ON CONFLICT upsert
--
-- The (company_id, qb_id) unique indexes added in 20260602200000 were PARTIAL
-- (WHERE qb_id IS NOT NULL). PostgREST `.upsert({ onConflict: "company_id,
-- qb_id" })` emits `ON CONFLICT (company_id, qb_id)` WITHOUT the partial
-- predicate, and Postgres rejects a partial-only arbiter with 42P10 ("there is
-- no unique or exclusion constraint matching the ON CONFLICT specification").
-- Result: the QBO apply + inbound webhook could NEVER upsert
-- clients/sub_clients/invoices/estimates/payments — every write failed (the
-- code swallowed the error and the run falsely reported `applied`). Only the
-- link path (a plain UPDATE, no ON CONFLICT) persisted. Confirmed live 2026-06-04.
--
-- Fix: replace each PARTIAL index with a FULL unique index on (company_id,
-- qb_id). Postgres treats NULLs as DISTINCT by default, so unlimited non-QB
-- rows (qb_id IS NULL) per company still coexist — exactly the property the
-- partial index was protecting — while the index becomes a valid ON CONFLICT
-- arbiter for `(company_id, qb_id)`.
--
-- Safe: the partial index already guaranteed uniqueness among non-NULL qb_id
-- rows, and NULLs never collide, so the full index cannot fail on existing
-- data; if it somehow did, the whole transaction rolls back (no half state).
-- Index-only change (no data, no columns) → iOS-sync-safe. NOT CONCURRENTLY to
-- match repo convention (low-tenant prod, small tables, brief lock is fine).
-- The sentinel re-verifies each index exists AND is non-partial (indpred NULL).
-- ============================================================================

drop index if exists public.clients_company_qb_id_uniq;
create unique index clients_company_qb_id_uniq
  on public.clients (company_id, qb_id);

drop index if exists public.sub_clients_company_qb_id_uniq;
create unique index sub_clients_company_qb_id_uniq
  on public.sub_clients (company_id, qb_id);

drop index if exists public.invoices_company_qb_id_uniq;
create unique index invoices_company_qb_id_uniq
  on public.invoices (company_id, qb_id);

drop index if exists public.estimates_company_qb_id_uniq;
create unique index estimates_company_qb_id_uniq
  on public.estimates (company_id, qb_id);

drop index if exists public.payments_company_qb_id_uniq;
create unique index payments_company_qb_id_uniq
  on public.payments (company_id, qb_id);

-- ── sentinel rollback guard :: qbo_full_uniq ─────────────────────────────────
-- Each index must exist, be UNIQUE, and be NON-partial (pg_index.indpred IS
-- NULL) — i.e. a valid bare `ON CONFLICT (company_id, qb_id)` arbiter.
do $$
declare
  v_idx text;
begin
  foreach v_idx in array array[
    'clients_company_qb_id_uniq',
    'sub_clients_company_qb_id_uniq',
    'invoices_company_qb_id_uniq',
    'estimates_company_qb_id_uniq',
    'payments_company_qb_id_uniq'
  ]
  loop
    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_index i on i.indexrelid = c.oid
      where n.nspname = 'public'
        and c.relname = v_idx
        and c.relkind = 'i'
        and i.indisunique
        and i.indpred is null
    ) then
      raise exception 'qbo_full_uniq_sentinel: % is missing, non-unique, or still partial', v_idx;
    end if;
  end loop;
end $$;

commit;
