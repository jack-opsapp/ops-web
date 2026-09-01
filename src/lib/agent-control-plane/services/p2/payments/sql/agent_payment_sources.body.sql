begin;

set local timezone = 'UTC';

-- Task 15 canonical payment source body. It advances only projected receipt,
-- linkage, normalized-method, payment-date, and void-state changes.
do $prerequisites$
declare
  v_missing text[];
begin
  select pg_catalog.array_agg(required.object_name order by required.object_name)
    into v_missing
  from (
    values
      ('table', 'private.agent_read_domain_revisions'),
      ('table', 'private.agent_read_domains'),
      ('function', 'private.agent_read_domain_uuid_from_text(text)'),
      ('function', 'private.advance_agent_read_domain_revisions(uuid[],text)'),
      ('table', 'public.payments')
  ) required(object_kind, object_name)
  where case required.object_kind
    when 'function' then pg_catalog.to_regprocedure(required.object_name) is null
    else pg_catalog.to_regclass(required.object_name) is null
  end;

  if v_missing is not null then
    raise exception 'agent_payment_sources_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from private.agent_read_domains domain
    where domain.domain = 'payments'
  ) then
    raise exception 'agent_payment_domain_missing'
      using errcode = '55000';
  end if;
end;
$prerequisites$;

create index if not exists idx_payments_agent_history_v1
  on public.payments (company_id, payment_date desc, id);

create or replace function private.bump_agent_payment_source_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_old_row jsonb;
  v_new_row jsonb;
  v_relevant_fields text[] := array[
    'id', 'company_id', 'invoice_id', 'client_id', 'amount',
    'payment_method', 'payment_date', 'voided_at'
  ];
  v_relevant_change boolean := true;
  v_old_company_id uuid;
  v_new_company_id uuid;
begin
  if tg_when is distinct from 'AFTER'
     or tg_level is distinct from 'ROW'
     or tg_nargs is distinct from 0
     or tg_table_schema is distinct from 'public'
     or tg_table_name is distinct from 'payments'
     or tg_op not in ('INSERT', 'UPDATE', 'DELETE') then
    raise exception 'agent_payment_revision_trigger_misconfigured'
      using errcode = '55000';
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    v_old_row := pg_catalog.to_jsonb(old);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new_row := pg_catalog.to_jsonb(new);
  end if;

  if tg_op = 'UPDATE' then
    select coalesce(
             pg_catalog.bool_or(
               v_old_row -> field.value is distinct from
                 v_new_row -> field.value
             ),
             false
           )
      into v_relevant_change
    from pg_catalog.unnest(v_relevant_fields) field(value);
  end if;

  if not v_relevant_change then
    return null;
  end if;

  v_old_company_id := private.agent_read_domain_uuid_from_text(
    v_old_row ->> 'company_id'
  );
  v_new_company_id := private.agent_read_domain_uuid_from_text(
    v_new_row ->> 'company_id'
  );

  perform private.advance_agent_read_domain_revisions(
    array[v_old_company_id, v_new_company_id],
    'payments'
  );
  return null;
end;
$function$;

revoke all on function private.bump_agent_payment_source_revision()
  from public, anon, authenticated, service_role;
alter function private.bump_agent_payment_source_revision()
  owner to current_user;

do $canonical_acl$
declare
  v_function_oid oid;
  v_function_owner oid;
  v_acl record;
begin
  v_function_oid := pg_catalog.to_regprocedure(
    'private.bump_agent_payment_source_revision()'
  )::oid;
  select function_row.proowner
    into v_function_owner
  from pg_catalog.pg_proc function_row
  where function_row.oid = v_function_oid;

  for v_acl in
    select distinct acl.grantee,
           case when acl.grantee = 0 then 'public'
             else role_row.rolname end as role_name
    from pg_catalog.pg_proc function_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        function_row.proacl,
        pg_catalog.acldefault('f', function_row.proowner)
      )
    ) acl
    left join pg_catalog.pg_roles role_row on role_row.oid = acl.grantee
    where function_row.oid = v_function_oid
      and acl.grantee <> v_function_owner
  loop
    if v_acl.role_name is null then
      raise exception 'agent_payment_source_acl_role_missing'
        using errcode = '55000';
    end if;
    execute pg_catalog.format(
      'revoke all privileges on function %s from %s',
      'private.bump_agent_payment_source_revision()',
      case when v_acl.grantee = 0 then 'public'
        else pg_catalog.quote_ident(v_acl.role_name)
      end
    );
  end loop;
end;
$canonical_acl$;

drop trigger if exists payments_bump_agent_payment_revision
  on public.payments;
create trigger payments_bump_agent_payment_revision
after insert or update or delete on public.payments
for each row execute function private.bump_agent_payment_source_revision();

do $postflight$
declare
  v_trigger record;
begin
  if pg_catalog.to_regclass(
       'public.idx_payments_agent_history_v1'
     ) is null then
    raise exception 'agent_payment_index_missing'
      using errcode = '55000';
  end if;

  if pg_catalog.to_regprocedure(
       'private.bump_agent_payment_source_revision()'
     ) is null then
    raise exception 'agent_payment_source_function_missing'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc function_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        function_row.proacl,
        pg_catalog.acldefault('f', function_row.proowner)
      )
    ) acl
    where function_row.oid = pg_catalog.to_regprocedure(
      'private.bump_agent_payment_source_revision()'
    )::oid
      and acl.grantee <> function_row.proowner
  ) then
    raise exception 'agent_payment_source_acl_invalid'
      using errcode = '55000';
  end if;

  select trigger_row.tgenabled,
         trigger_row.tgisinternal,
         procedure.proname,
         pg_catalog.encode(trigger_row.tgargs, 'hex') as trigger_args
    into v_trigger
  from pg_catalog.pg_trigger trigger_row
  join pg_catalog.pg_proc procedure
    on procedure.oid = trigger_row.tgfoid
  where trigger_row.tgrelid = 'public.payments'::regclass
    and trigger_row.tgname = 'payments_bump_agent_payment_revision';

  if not found
     or v_trigger.tgenabled is distinct from 'O'
     or v_trigger.tgisinternal
     or v_trigger.proname is distinct from
          'bump_agent_payment_source_revision'
     or v_trigger.trigger_args is distinct from '' then
    raise exception 'agent_payment_trigger_invalid'
      using errcode = '55000';
  end if;
end;
$postflight$;

commit;
