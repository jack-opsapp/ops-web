begin;

-- Cover new QuickBooks mapping/link foreign keys directly. Composite indexes
-- where the FK is not the leading column do not protect parent deletes from
-- table scans.

create index if not exists idx_qbo_import_runs_connection_id
  on public.qbo_import_runs (connection_id)
  where connection_id is not null;

create index if not exists idx_qbo_item_product_mappings_connection_id
  on public.qbo_item_product_mappings (connection_id)
  where connection_id is not null
    and deleted_at is null;

create index if not exists idx_qbo_estimate_opportunity_links_connection_id
  on public.qbo_estimate_opportunity_links (connection_id)
  where deleted_at is null;

create index if not exists idx_qbo_estimate_opportunity_links_estimate_id
  on public.qbo_estimate_opportunity_links (estimate_id)
  where estimate_id is not null
    and deleted_at is null;

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'qbo_import_runs'
      and indexname = 'idx_qbo_import_runs_connection_id'
  ) then
    raise exception 'qbo_mapping_link_index_hardening_sentinel: import run connection index missing';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'qbo_item_product_mappings'
      and indexname = 'idx_qbo_item_product_mappings_connection_id'
  ) then
    raise exception 'qbo_mapping_link_index_hardening_sentinel: mapping connection index missing';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'qbo_estimate_opportunity_links'
      and indexname = 'idx_qbo_estimate_opportunity_links_connection_id'
  ) then
    raise exception 'qbo_mapping_link_index_hardening_sentinel: link connection index missing';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'qbo_estimate_opportunity_links'
      and indexname = 'idx_qbo_estimate_opportunity_links_estimate_id'
  ) then
    raise exception 'qbo_mapping_link_index_hardening_sentinel: link estimate index missing';
  end if;
end $$;

commit;
