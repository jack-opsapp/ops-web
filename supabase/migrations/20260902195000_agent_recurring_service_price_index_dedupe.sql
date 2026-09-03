begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Phase 7 initially named an index that already existed under the canonical
-- provider-delivery source migration. Keep the older canonical index and
-- remove only the byte-for-byte equivalent duplicate.
do $index_shape$
declare
  v_canonical_definition text;
  v_duplicate_definition text;
begin
  select pg_catalog.pg_get_indexdef(index_row.indexrelid)
    into v_canonical_definition
  from pg_catalog.pg_index index_row
  where index_row.indexrelid = pg_catalog.to_regclass(
    'private.agent_provider_delivery_sources_company_delivered_idx'
  )
    and index_row.indisvalid
    and index_row.indisready;

  if v_canonical_definition is null then
    raise exception 'agent_recurring_service_price_index_shape_invalid'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_indexdef(index_row.indexrelid)
    into v_duplicate_definition
  from pg_catalog.pg_index index_row
  where index_row.indexrelid = pg_catalog.to_regclass(
    'private.agent_provider_delivery_sources_tenant_delivered_idx'
  )
    and index_row.indisvalid
    and index_row.indisready;

  if v_duplicate_definition is not null
     and pg_catalog.replace(
       v_canonical_definition,
       'agent_provider_delivery_sources_company_delivered_idx',
       'agent_provider_delivery_sources_delivery_idx'
     ) is distinct from pg_catalog.replace(
       v_duplicate_definition,
       'agent_provider_delivery_sources_tenant_delivered_idx',
       'agent_provider_delivery_sources_delivery_idx'
     ) then
    raise exception 'agent_recurring_service_price_index_shape_invalid'
      using errcode = '55000';
  end if;
end;
$index_shape$;

drop index if exists private.agent_provider_delivery_sources_tenant_delivered_idx;

commit;
