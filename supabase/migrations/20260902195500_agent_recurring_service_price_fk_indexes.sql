begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create index if not exists agent_recurring_service_price_policies_client_fk_idx
  on private.agent_recurring_service_price_policies (client_id);
create index if not exists agent_recurring_service_price_policies_created_by_fk_idx
  on private.agent_recurring_service_price_policies (created_by);
create index if not exists agent_recurring_service_price_policies_task_type_fk_idx
  on private.agent_recurring_service_price_policies (task_type_id);
create index if not exists agent_recurring_service_price_policies_price_source_line_item_fk_idx
  on private.agent_recurring_service_price_policies (price_source_line_item_id);

do $index_shape$
declare
  v_invalid text[];
begin
  with expected(index_name, column_name) as (
    values
      ('agent_recurring_service_price_policies_client_fk_idx', 'client_id'),
      ('agent_recurring_service_price_policies_created_by_fk_idx', 'created_by'),
      ('agent_recurring_service_price_policies_task_type_fk_idx', 'task_type_id'),
      ('agent_recurring_service_price_policies_price_source_line_item_fk_idx', 'price_source_line_item_id')
  )
  select pg_catalog.array_agg(expected.index_name order by expected.index_name)
    into v_invalid
  from expected
  where not exists (
    select 1
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_row.indexrelid
    join pg_catalog.pg_am access_method
      on access_method.oid = index_relation.relam
    join pg_catalog.pg_attribute attribute
      on attribute.attrelid = index_row.indrelid
     and attribute.attnum = index_row.indkey[0]
    where index_row.indexrelid = pg_catalog.to_regclass(
      'private.' || expected.index_name
    )
      and index_row.indrelid =
        'private.agent_recurring_service_price_policies'::regclass
      and access_method.amname = 'btree'
      and index_row.indisvalid
      and index_row.indisready
      and not index_row.indisunique
      and index_row.indnkeyatts = 1
      and index_row.indnatts = 1
      and index_row.indexprs is null
      and index_row.indpred is null
      and attribute.attname = expected.column_name
  );

  if v_invalid is not null then
    raise exception 'agent_recurring_service_price_fk_index_shape_invalid: %',
      pg_catalog.array_to_string(v_invalid, ',')
      using errcode = '55000';
  end if;
end;
$index_shape$;

commit;
