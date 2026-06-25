begin;

with ranked as (
  select
    id,
    row_number() over (
      partition by company_id, provider
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as rn
  from public.accounting_connections
  where provider = 'quickbooks'
    and is_connected = true
    and sync_enabled = true
    and sync_direction <> 'pull_only'
)
update public.accounting_connections c
set sync_enabled = false,
    sync_direction = 'pull_only',
    propagate_deletes = false,
    updated_at = now()
from ranked r
where c.id = r.id
  and r.rn > 1;

create unique index if not exists accounting_connections_one_qbo_writable_per_company
  on public.accounting_connections (company_id, provider)
  where provider = 'quickbooks'
    and is_connected = true
    and sync_enabled = true
    and sync_direction <> 'pull_only';

do $$
declare
  v_indexdef text;
begin
  select indexdef
  into v_indexdef
  from pg_indexes
  where schemaname = 'public'
    and tablename = 'accounting_connections'
    and indexname = 'accounting_connections_one_qbo_writable_per_company';

  if v_indexdef is null
     or v_indexdef not ilike '%provider = ''quickbooks''%'
     or v_indexdef not ilike '%is_connected = true%'
     or v_indexdef not ilike '%sync_enabled = true%'
     or v_indexdef not ilike '%sync_direction <> ''pull_only''%' then
    raise exception 'qbo_single_writable_connection_sentinel: writable QuickBooks uniqueness predicate is missing or incomplete';
  end if;
end $$;

commit;
