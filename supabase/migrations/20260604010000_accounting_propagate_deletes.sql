begin;

-- ============================================================================
-- Accounting sync-mode settings: propagate_deletes flag
--
-- Sub-project 1 of the read-only ↔ full-CRUD two-way sync feature. The settings
-- toggle writes accounting_connections.sync_direction (pull_only ↔ bidirectional)
-- plus this new flag, which (once the outbound push engine exists) controls
-- whether an OPS soft-delete voids/inactivates the corresponding record in the
-- provider. Default false = never push deletes. OPS deletes are always soft.
--
-- Additive (nullable-with-default → iOS-sync-safe: iOS does not write the
-- accounting_connections push columns). Sentinel verifies the column landed.
-- NOTE: the toggle may set sync_direction='bidirectional', but the push path is
-- hard-gated by env ACCOUNTING_WRITE_ENABLED (default off), so no write to the
-- provider can fire until the engine is built and that flag is deliberately set.
-- ============================================================================

alter table public.accounting_connections
  add column if not exists propagate_deletes boolean not null default false;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'accounting_connections'
      and column_name = 'propagate_deletes'
  ) then
    raise exception 'accounting_propagate_deletes_sentinel: missing accounting_connections.propagate_deletes';
  end if;
end $$;

commit;
