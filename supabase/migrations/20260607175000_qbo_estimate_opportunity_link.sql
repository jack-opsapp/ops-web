begin;

create table if not exists public.qbo_estimate_opportunity_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  connection_id uuid not null references public.accounting_connections(id) on delete cascade,
  qb_estimate_id text not null,
  opportunity_id uuid not null references public.opportunities(id) on delete restrict,
  estimate_id uuid references public.estimates(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists qbo_estimate_opportunity_links_active_key
  on public.qbo_estimate_opportunity_links (company_id, connection_id, qb_estimate_id)
  where deleted_at is null;

create index if not exists idx_qbo_estimate_opportunity_links_opportunity
  on public.qbo_estimate_opportunity_links (opportunity_id)
  where deleted_at is null;

alter table public.qbo_estimate_opportunity_links enable row level security;
revoke all on table public.qbo_estimate_opportunity_links from anon, authenticated;
grant select on table public.qbo_estimate_opportunity_links to authenticated;
grant all on table public.qbo_estimate_opportunity_links to service_role;

drop policy if exists "read company qbo_estimate_opportunity_links with accounting view"
  on public.qbo_estimate_opportunity_links;
create policy "read company qbo_estimate_opportunity_links with accounting view"
on public.qbo_estimate_opportunity_links for select
using (
  company_id = (select private.get_user_company_id())
  and public.has_permission((select private.get_current_user_id()), 'accounting.view', 'all')
);

create or replace function public.ensure_qbo_estimate_opportunity(
  p_company_id uuid,
  p_connection_id uuid,
  p_client_id uuid,
  p_qb_estimate_id text,
  p_estimate_id uuid default null,
  p_estimate_number text default null,
  p_title text default null,
  p_total numeric default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_connection public.accounting_connections%rowtype;
  v_link public.qbo_estimate_opportunity_links%rowtype;
  v_estimate public.estimates%rowtype;
  v_opportunity_id uuid;
  v_title text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;

  if p_company_id is null
     or p_connection_id is null
     or p_client_id is null
     or nullif(btrim(coalesce(p_qb_estimate_id, '')), '') is null then
    raise exception 'ensure_qbo_estimate_opportunity: invalid input' using errcode = '22023';
  end if;

  select *
    into v_connection
    from public.accounting_connections
   where id = p_connection_id
     and company_id::text = p_company_id::text
     and provider = 'quickbooks';

  if not found then
    raise exception 'ensure_qbo_estimate_opportunity: connection not found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(':', 'qbo-estimate-opportunity', p_company_id::text, p_connection_id::text, p_qb_estimate_id),
      0
    )
  );

  select *
    into v_link
    from public.qbo_estimate_opportunity_links
   where company_id = p_company_id
     and connection_id = p_connection_id
     and qb_estimate_id = p_qb_estimate_id
     and deleted_at is null
   for update;

  if found then
    select o.id
      into v_opportunity_id
      from public.opportunities o
     where o.id = v_link.opportunity_id
       and o.company_id = p_company_id
       and o.deleted_at is null;

    if v_opportunity_id is not null then
      update public.qbo_estimate_opportunity_links
         set estimate_id = coalesce(p_estimate_id, estimate_id),
             updated_at = now()
       where id = v_link.id;
      return v_opportunity_id;
    end if;

    update public.qbo_estimate_opportunity_links
       set deleted_at = now(), updated_at = now()
     where id = v_link.id;
  end if;

  select *
    into v_estimate
    from public.estimates
   where company_id = p_company_id
     and qb_id = p_qb_estimate_id
     and opportunity_id is not null
     and deleted_at is null
   order by created_at asc
   limit 1
   for update;

  if found then
    insert into public.qbo_estimate_opportunity_links (
      company_id,
      connection_id,
      qb_estimate_id,
      opportunity_id,
      estimate_id
    ) values (
      p_company_id,
      p_connection_id,
      p_qb_estimate_id,
      v_estimate.opportunity_id,
      v_estimate.id
    )
    on conflict do nothing;
    return v_estimate.opportunity_id;
  end if;

  v_title := coalesce(
    nullif(btrim(p_title), ''),
    case
      when nullif(btrim(coalesce(p_estimate_number, '')), '') is not null
        then 'QuickBooks estimate ' || btrim(p_estimate_number)
      else 'QuickBooks estimate ' || p_qb_estimate_id
    end
  );

  insert into public.opportunities (
    company_id,
    client_id,
    client_ref,
    title,
    stage,
    source,
    estimated_value,
    win_probability,
    quote_delivery_method,
    source_metadata,
    last_activity_at,
    created_at,
    updated_at
  ) values (
    p_company_id,
    p_client_id,
    p_client_id,
    v_title,
    'quoted',
    'other',
    p_total,
    75,
    'quickbooks',
    jsonb_build_object(
      'provider', 'quickbooks',
      'connection_id', p_connection_id,
      'qb_estimate_id', p_qb_estimate_id,
      'estimate_number', p_estimate_number,
      'created_by', 'qbo_webhook'
    ),
    now(),
    now(),
    now()
  )
  returning id into v_opportunity_id;

  insert into public.qbo_estimate_opportunity_links (
    company_id,
    connection_id,
    qb_estimate_id,
    opportunity_id,
    estimate_id
  ) values (
    p_company_id,
    p_connection_id,
    p_qb_estimate_id,
    v_opportunity_id,
    p_estimate_id
  );

  return v_opportunity_id;
end;
$$;

revoke all on function public.ensure_qbo_estimate_opportunity(
  uuid,
  uuid,
  uuid,
  text,
  uuid,
  text,
  text,
  numeric
) from public, anon, authenticated;

grant execute on function public.ensure_qbo_estimate_opportunity(
  uuid,
  uuid,
  uuid,
  text,
  uuid,
  text,
  text,
  numeric
) to service_role;

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(
    'public.ensure_qbo_estimate_opportunity(uuid, uuid, uuid, text, uuid, text, text, numeric)'::regprocedure
  )
  into v_def;

  if v_def is null
     or position('pg_advisory_xact_lock' in v_def) = 0
     or position('qbo_estimate_opportunity_links' in v_def) = 0
     or position('service_role required' in v_def) = 0
     or position('stage' in v_def) = 0
     or position('''quoted''' in v_def) = 0 then
    raise exception 'qbo_estimate_opportunity_link_sentinel: function body is unsafe';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'qbo_estimate_opportunity_links'
      and grantee = 'authenticated'
      and privilege_type <> 'SELECT'
  ) then
    raise exception 'qbo_estimate_opportunity_link_sentinel: authenticated write grant remains';
  end if;
end $$;

commit;
