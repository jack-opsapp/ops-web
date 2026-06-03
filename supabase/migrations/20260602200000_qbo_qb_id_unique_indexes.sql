begin;

-- ============================================================================
-- QuickBooks read-only sync — qb_id upsert conflict targets
--
-- Critical fix (review C1): the import "apply" step upserts pulled QuickBooks
-- records into the canonical tables with
--   .upsert(rows, { onConflict: "company_id,qb_id" })
-- PostgREST translates onConflict into an ON CONFLICT (company_id, qb_id)
-- clause, which Postgres rejects with 42P10 ("there is no unique or exclusion
-- constraint matching the ON CONFLICT specification") unless a matching unique
-- index exists. Prod has NO such index on clients/estimates/invoices/payments,
-- so apply cannot run at all.
--
-- This migration adds the missing conflict targets as PARTIAL unique indexes
-- on (company_id, qb_id) WHERE qb_id IS NOT NULL. Partial because qb_id is
-- nullable on every one of these tables — rows that did not originate from a
-- QuickBooks import carry qb_id = NULL and must not collide with one another.
-- The partial predicate lets unlimited NULL-qb_id rows coexist while still
-- guaranteeing one canonical row per (company, QuickBooks entity).
--
-- Purely ADDITIVE (iOS-sync-safe): only new indexes are created, nothing is
-- altered or dropped. Fully idempotent (IF NOT EXISTS), so re-running is a
-- no-op. Created inside the migration transaction (NOT CONCURRENTLY) to match
-- repo convention; these tables are small enough that a brief lock is fine.
-- ============================================================================

create unique index if not exists clients_company_qb_id_uniq
  on public.clients (company_id, qb_id)
  where qb_id is not null;

create unique index if not exists estimates_company_qb_id_uniq
  on public.estimates (company_id, qb_id)
  where qb_id is not null;

create unique index if not exists invoices_company_qb_id_uniq
  on public.invoices (company_id, qb_id)
  where qb_id is not null;

create unique index if not exists payments_company_qb_id_uniq
  on public.payments (company_id, qb_id)
  where qb_id is not null;

-- ── sentinel rollback guard ──────────────────────────────────────────────────
-- Re-verify all four conflict-target indexes exist before commit. Any missing
-- index RAISEs, aborting the transaction so a half-applied state cannot land.
do $$
declare
  v_index text;
begin
  foreach v_index in array array[
    'clients_company_qb_id_uniq',
    'estimates_company_qb_id_uniq',
    'invoices_company_qb_id_uniq',
    'payments_company_qb_id_uniq'
  ]
  loop
    if not exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v_index
        and c.relkind = 'i'
    ) then
      raise exception 'qbo_qb_id_uniq_sentinel: unique index public.% missing', v_index;
    end if;
  end loop;
end$$;

commit;
