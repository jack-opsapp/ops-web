begin;

-- ============================================================================
-- QuickBooks read-only sync — Company → client + Contact → sub_client mapping
--
-- Purely ADDITIVE (iOS-sync-safe): five nullable columns on
-- qbo_staging_customers to carry the QB CompanyName / contact / job-hierarchy
-- fields the normalizer now extracts, plus a nullable qb_id link column on
-- sub_clients with a PARTIAL unique index so the apply step can upsert one
-- canonical contact per (company, QuickBooks customer). Nothing is altered or
-- dropped; re-running is a no-op (IF NOT EXISTS everywhere). Direct prod apply
-- is authorized (low-tenant); a sentinel DO block re-verifies every object and
-- rolls the whole transaction back if any invariant is missing.
-- ============================================================================

-- ── staging: company / contact / job-hierarchy capture ──────────────────────
alter table public.qbo_staging_customers
  add column if not exists company_name  text,
  add column if not exists contact_name  text,
  add column if not exists contact_title text,
  add column if not exists parent_qb_id  text,
  add column if not exists is_job        boolean;

-- ── sub_clients: QB link column for idempotent contact upsert ────────────────
alter table public.sub_clients
  add column if not exists qb_id text;

-- Partial unique conflict target for .upsert(..., { onConflict: "company_id,qb_id" }).
-- Partial because the vast majority of sub_clients have no QB origin (qb_id is
-- null) and must be allowed to coexist; only QB-imported contacts are deduped.
create unique index if not exists sub_clients_company_qb_id_uniq
  on public.sub_clients (company_id, qb_id)
  where qb_id is not null;

-- ── sentinel rollback guard :: qbo_subclient_mapping ────────────────────────
-- Re-verifies every new column and the conflict-target index before commit.
-- Any missing object RAISEs, aborting the transaction so a half-applied state
-- cannot land on prod.
do $$
declare
  v_col text;
begin
  foreach v_col in array array[
    'company_name',
    'contact_name',
    'contact_title',
    'parent_qb_id',
    'is_job'
  ]
  loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'qbo_staging_customers' and column_name = v_col
    ) then
      raise exception 'qbo_subclient_mapping_sentinel: missing column qbo_staging_customers.%', v_col;
    end if;
  end loop;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sub_clients' and column_name = 'qb_id'
  ) then
    raise exception 'qbo_subclient_mapping_sentinel: missing column sub_clients.qb_id';
  end if;

  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'sub_clients_company_qb_id_uniq'
      and c.relkind = 'i'
  ) then
    raise exception 'qbo_subclient_mapping_sentinel: missing index sub_clients_company_qb_id_uniq';
  end if;
end $$;

commit;
