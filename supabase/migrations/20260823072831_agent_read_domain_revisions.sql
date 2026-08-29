-- Private, tenant-local source fences for the P2 business-read domains.
--
-- Domain source migrations attach the generic AFTER ROW trigger below with
-- exactly two arguments: the closed domain and the source row's company-key
-- column. This kernel does not attach broad source-table triggers itself.

create table if not exists private.agent_read_domains (
  domain text not null,
  constraint agent_read_domains_pkey primary key (domain)
);

revoke all on table private.agent_read_domains
  from public, anon, authenticated, service_role;

insert into private.agent_read_domains (domain) values
  ('customer'),
  ('tasks'),
  ('artifacts'),
  ('site_visits'),
  ('deck_designs'),
  ('sales_documents'),
  ('payments'),
  ('expenses'),
  ('work_queue'),
  ('catalog'),
  ('purchasing'),
  ('company'),
  ('team'),
  ('availability'),
  ('integrations')
on conflict (domain) do nothing;

create table if not exists private.agent_read_domain_revisions (
  -- Deliberately no companies FK: company deletion must retain the final
  -- revision tombstones and must not race an ON DELETE action.
  company_id uuid not null,
  domain text not null,
  source_revision bigint not null default 0,
  updated_at timestamptz not null default statement_timestamp(),
  constraint agent_read_domain_revisions_pkey
    primary key (company_id, domain),
  constraint agent_read_domain_revisions_domain_closed
    foreign key (domain)
    references private.agent_read_domains (domain),
  constraint agent_read_domain_revisions_safe_integer
    check (source_revision between 0 and 9007199254740991)
);

revoke all on table private.agent_read_domain_revisions
  from public, anon, authenticated, service_role;

create or replace function private.agent_read_domain_uuid_from_text(
  p_value text
) returns uuid
language sql
immutable
strict
parallel safe
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  select case
    when p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then lower(p_value)::uuid
  end;
$function$;

revoke all on function private.agent_read_domain_uuid_from_text(text)
  from public, anon, authenticated, service_role;

create or replace function private.advance_agent_read_domain_revisions(
  p_company_ids uuid[],
  p_domain text
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'private', 'pg_temp'
as $function$
declare
  v_expected_count integer;
  v_advanced_count integer;
begin
  if p_domain is null or not exists (
    select 1
    from private.agent_read_domains domain
    where domain.domain = p_domain
  ) then
    raise exception 'agent_read_domain_revision_invalid_domain'
      using errcode = '22023';
  end if;

  select count(*)::integer
    into v_expected_count
  from (
    select distinct company_id
    from unnest(coalesce(p_company_ids, array[]::uuid[])) company_id
    where company_id is not null
  ) distinct_companies;

  if v_expected_count = 0 then
    return;
  end if;

  -- One ordered statement gives cross-tenant moves a consistent lock order.
  insert into private.agent_read_domain_revisions as revision (
    company_id,
    domain,
    source_revision,
    updated_at
  )
  select
    distinct_companies.company_id,
    p_domain,
    1,
    statement_timestamp()
  from (
    select distinct company_id
    from unnest(p_company_ids) company_id
    where company_id is not null
    order by company_id
  ) distinct_companies
  on conflict (company_id, domain) do update
  set source_revision = revision.source_revision + 1,
      updated_at = excluded.updated_at
  where revision.source_revision < 9007199254740991;

  get diagnostics v_advanced_count = row_count;
  if v_advanced_count is distinct from v_expected_count then
    raise exception 'agent_read_domain_revision_exhausted'
      using errcode = '22003';
  end if;
end;
$function$;

revoke all on function private.advance_agent_read_domain_revisions(uuid[], text)
  from public, anon, authenticated, service_role;

create or replace function private.advance_agent_read_domain_revision(
  p_company_id uuid,
  p_domain text
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'private', 'pg_temp'
as $function$
begin
  perform private.advance_agent_read_domain_revisions(
    array[p_company_id],
    p_domain
  );
end;
$function$;

revoke all on function private.advance_agent_read_domain_revision(uuid, text)
  from public, anon, authenticated, service_role;

insert into private.agent_read_domain_revisions (
  company_id,
  domain,
  source_revision,
  updated_at
)
select
  company.id,
  domain.domain,
  0,
  statement_timestamp()
from public.companies company
cross join private.agent_read_domains domain
on conflict (company_id, domain) do nothing;

create or replace function private.seed_agent_read_domain_revisions()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'private', 'pg_temp'
as $function$
begin
  insert into private.agent_read_domain_revisions (
    company_id,
    domain,
    source_revision,
    updated_at
  )
  select
    new.id,
    domain.domain,
    0,
    statement_timestamp()
  from private.agent_read_domains domain
  on conflict (company_id, domain) do nothing;

  return null;
end;
$function$;

revoke all on function private.seed_agent_read_domain_revisions()
  from public, anon, authenticated, service_role;

drop trigger if exists companies_seed_agent_read_domain_revisions
  on public.companies;
create trigger companies_seed_agent_read_domain_revisions
after insert on public.companies
for each row execute function private.seed_agent_read_domain_revisions();

create or replace function private.bump_agent_read_domain_revision()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'private', 'pg_temp'
as $function$
declare
  v_old_row jsonb;
  v_new_row jsonb;
  v_old_company_id uuid;
  v_new_company_id uuid;
begin
  if tg_nargs is distinct from 2
     or nullif(tg_argv[0], '') is null
     or nullif(tg_argv[1], '') is null
     or tg_when is distinct from 'AFTER'
     or tg_level is distinct from 'ROW'
     or tg_op not in ('INSERT', 'UPDATE', 'DELETE') then
    raise exception 'agent_read_domain_revision_trigger_misconfigured'
      using errcode = '55000';
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    v_old_row := to_jsonb(old);
    if not (v_old_row ? tg_argv[1]) then
      raise exception 'agent_read_domain_revision_trigger_misconfigured'
        using errcode = '55000';
    end if;
    v_old_company_id := private.agent_read_domain_uuid_from_text(
      v_old_row ->> tg_argv[1]
    );
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    v_new_row := to_jsonb(new);
    if not (v_new_row ? tg_argv[1]) then
      raise exception 'agent_read_domain_revision_trigger_misconfigured'
        using errcode = '55000';
    end if;
    v_new_company_id := private.agent_read_domain_uuid_from_text(
      v_new_row ->> tg_argv[1]
    );
  end if;

  perform private.advance_agent_read_domain_revisions(
    array[v_old_company_id, v_new_company_id],
    tg_argv[0]
  );

  -- AFTER row-trigger return values are ignored. NULL avoids polymorphic
  -- record coercion and makes that behavior explicit.
  return null;
end;
$function$;

revoke all on function private.bump_agent_read_domain_revision()
  from public, anon, authenticated, service_role;

-- CREATE TABLE IF NOT EXISTS is replay-safe only when a pre-existing object
-- has the exact reviewed shape. This final catalog postflight makes name
-- collisions and partial/manual drift fail closed instead of appearing green.
do $postflight$
declare
  v_domain_table oid;
  v_revision_table oid;
  v_company_table oid;
  v_expected_domains constant text[] := array[
    'artifacts',
    'availability',
    'catalog',
    'company',
    'customer',
    'deck_designs',
    'expenses',
    'integrations',
    'payments',
    'purchasing',
    'sales_documents',
    'site_visits',
    'tasks',
    'team',
    'work_queue'
  ];
  v_actual_domains text[];
  v_expected_owner oid := (current_user::regrole)::oid;
  v_valid boolean;
  v_function record;
  v_role text;
begin
  select relation.oid
    into v_domain_table
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'private'
    and relation.relname = 'agent_read_domains'
    and relation.relkind = 'r'
    and relation.relpersistence = 'p'
    and relation.relowner = v_expected_owner
    and relation.relreplident = 'd'
    and not relation.relrowsecurity
    and not relation.relforcerowsecurity
    and not relation.relhasrules;

  if v_domain_table is null then
    raise exception 'agent_read_domain_catalog_domain_table_invalid'
      using errcode = '55000';
  end if;

  select count(*) = 1
     and count(*) filter (
       where attribute.attname = 'domain'
         and pg_catalog.format_type(
           attribute.atttypid,
           attribute.atttypmod
         ) = 'text'
         and attribute.attnotnull
         and attribute.attidentity = ''
         and attribute.attgenerated = ''
         and default_value.oid is null
     ) = 1
    into v_valid
  from pg_catalog.pg_attribute attribute
  left join pg_catalog.pg_attrdef default_value
    on default_value.adrelid = attribute.attrelid
   and default_value.adnum = attribute.attnum
  where attribute.attrelid = v_domain_table
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if not coalesce(v_valid, false) then
    raise exception 'agent_read_domain_catalog_domain_table_invalid'
      using errcode = '55000';
  end if;

  select count(*) = 1
     and count(*) filter (
       where constraint_row.conname = 'agent_read_domains_pkey'
         and constraint_row.contype = 'p'
         and constraint_row.conkey = array[1]::smallint[]
         and constraint_row.convalidated
         and not constraint_row.condeferrable
     ) = 1
    into v_valid
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = v_domain_table;

  if not coalesce(v_valid, false) then
    raise exception 'agent_read_domain_catalog_constraint_invalid'
      using errcode = '55000';
  end if;

  select count(*) = 1
     and bool_and(
       index_row.indisprimary
       and index_row.indisunique
       and index_row.indisvalid
       and index_row.indisready
       and index_row.indimmediate
       and not index_row.indisexclusion
       and not index_row.indnullsnotdistinct
       and index_row.indnkeyatts = 1
       and index_row.indnatts = 1
       and index_row.indkey::text = '1'
       and index_row.indexprs is null
       and index_row.indpred is null
     )
    into v_valid
  from pg_catalog.pg_index index_row
  where index_row.indrelid = v_domain_table;

  if not coalesce(v_valid, false) then
    raise exception 'agent_read_domain_catalog_index_invalid'
      using errcode = '55000';
  end if;

  select array_agg(domain.domain order by domain.domain)
    into v_actual_domains
  from private.agent_read_domains domain;

  if v_actual_domains is distinct from v_expected_domains then
    raise exception 'agent_read_domain_catalog_vocabulary_invalid'
      using errcode = '55000';
  end if;

  select relation.oid
    into v_revision_table
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'private'
    and relation.relname = 'agent_read_domain_revisions'
    and relation.relkind = 'r'
    and relation.relpersistence = 'p'
    and relation.relowner = v_expected_owner
    and relation.relreplident = 'd'
    and not relation.relrowsecurity
    and not relation.relforcerowsecurity
    and not relation.relhasrules;

  if v_revision_table is null then
    raise exception 'agent_read_domain_catalog_revision_table_invalid'
      using errcode = '55000';
  end if;

  select count(*) = 4
     and count(*) filter (
       where attribute.attname = 'company_id'
         and pg_catalog.format_type(
           attribute.atttypid,
           attribute.atttypmod
         ) = 'uuid'
         and attribute.attnotnull
         and default_value.oid is null
     ) = 1
     and count(*) filter (
       where attribute.attname = 'domain'
         and pg_catalog.format_type(
           attribute.atttypid,
           attribute.atttypmod
         ) = 'text'
         and attribute.attnotnull
         and default_value.oid is null
     ) = 1
     and count(*) filter (
       where attribute.attname = 'source_revision'
         and pg_catalog.format_type(
           attribute.atttypid,
           attribute.atttypmod
         ) = 'bigint'
         and attribute.attnotnull
         and pg_catalog.pg_get_expr(
           default_value.adbin,
           default_value.adrelid
         ) = '0'
     ) = 1
     and count(*) filter (
       where attribute.attname = 'updated_at'
         and pg_catalog.format_type(
           attribute.atttypid,
           attribute.atttypmod
         ) = 'timestamp with time zone'
         and attribute.attnotnull
         and pg_catalog.pg_get_expr(
           default_value.adbin,
           default_value.adrelid
         ) = 'statement_timestamp()'
     ) = 1
     and bool_and(
       attribute.attidentity = '' and attribute.attgenerated = ''
     )
    into v_valid
  from pg_catalog.pg_attribute attribute
  left join pg_catalog.pg_attrdef default_value
    on default_value.adrelid = attribute.attrelid
   and default_value.adnum = attribute.attnum
  where attribute.attrelid = v_revision_table
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if not coalesce(v_valid, false) then
    raise exception 'agent_read_domain_catalog_revision_table_invalid'
      using errcode = '55000';
  end if;

  select count(*) = 3
     and count(*) filter (
       where constraint_row.conname = 'agent_read_domain_revisions_pkey'
         and constraint_row.contype = 'p'
         and constraint_row.conkey = array[1, 2]::smallint[]
         and constraint_row.convalidated
         and not constraint_row.condeferrable
     ) = 1
     and count(*) filter (
       where constraint_row.conname =
         'agent_read_domain_revisions_domain_closed'
         and constraint_row.contype = 'f'
         and constraint_row.conkey = array[2]::smallint[]
         and constraint_row.confrelid = v_domain_table
         and constraint_row.confkey = array[1]::smallint[]
         and constraint_row.confupdtype = 'a'
         and constraint_row.confdeltype = 'a'
         and constraint_row.confmatchtype = 's'
         and constraint_row.convalidated
         and not constraint_row.condeferrable
     ) = 1
     and count(*) filter (
       where constraint_row.conname =
         'agent_read_domain_revisions_safe_integer'
         and constraint_row.contype = 'c'
         and constraint_row.conkey = array[3]::smallint[]
         and constraint_row.convalidated
         and pg_catalog.pg_get_constraintdef(
           constraint_row.oid,
           true
         ) =
           'CHECK (source_revision >= 0 AND source_revision <= ''9007199254740991''::bigint)'
     ) = 1
    into v_valid
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = v_revision_table;

  if not coalesce(v_valid, false) then
    raise exception 'agent_read_domain_catalog_constraint_invalid'
      using errcode = '55000';
  end if;

  select count(*) = 1
     and bool_and(
       index_row.indisprimary
       and index_row.indisunique
       and index_row.indisvalid
       and index_row.indisready
       and index_row.indimmediate
       and not index_row.indisexclusion
       and not index_row.indnullsnotdistinct
       and index_row.indnkeyatts = 2
       and index_row.indnatts = 2
       and index_row.indkey::text = '1 2'
       and index_row.indexprs is null
       and index_row.indpred is null
     )
    into v_valid
  from pg_catalog.pg_index index_row
  where index_row.indrelid = v_revision_table;

  if not coalesce(v_valid, false) then
    raise exception 'agent_read_domain_catalog_index_invalid'
      using errcode = '55000';
  end if;

  for v_function in
    select *
    from (values
      (
        'private.agent_read_domain_uuid_from_text(text)',
        false,
        'i'::"char",
        'sql',
        true,
        's'::"char",
        array['search_path=pg_catalog, pg_temp']::text[]
      ),
      (
        'private.advance_agent_read_domain_revisions(uuid[],text)',
        true,
        'v'::"char",
        'plpgsql',
        false,
        'u'::"char",
        array['search_path=pg_catalog, private, pg_temp']::text[]
      ),
      (
        'private.advance_agent_read_domain_revision(uuid,text)',
        true,
        'v'::"char",
        'plpgsql',
        false,
        'u'::"char",
        array['search_path=pg_catalog, private, pg_temp']::text[]
      ),
      (
        'private.seed_agent_read_domain_revisions()',
        true,
        'v'::"char",
        'plpgsql',
        false,
        'u'::"char",
        array['search_path=pg_catalog, private, pg_temp']::text[]
      ),
      (
        'private.bump_agent_read_domain_revision()',
        true,
        'v'::"char",
        'plpgsql',
        false,
        'u'::"char",
        array['search_path=pg_catalog, private, pg_temp']::text[]
      )
    ) expected(
      signature,
      security_definer,
      volatility,
      language_name,
      is_strict,
      parallel_mode,
      configuration
    )
  loop
    select count(*) = 1
       and bool_and(
         procedure.prosecdef = v_function.security_definer
         and procedure.provolatile = v_function.volatility
         and language.lanname = v_function.language_name
         and procedure.proisstrict = v_function.is_strict
         and procedure.proparallel = v_function.parallel_mode
         and procedure.proconfig is not distinct from
           v_function.configuration
         and procedure.prokind = 'f'
         and procedure.proowner = v_expected_owner
       )
      into v_valid
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_language language
      on language.oid = procedure.prolang
    where procedure.oid = pg_catalog.to_regprocedure(v_function.signature);

    if not coalesce(v_valid, false) then
      raise exception 'agent_read_domain_catalog_function_invalid:%',
        v_function.signature
        using errcode = '55000';
    end if;

    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
      if pg_catalog.has_function_privilege(
        v_role,
        v_function.signature,
        'execute'
      ) then
        raise exception 'agent_read_domain_catalog_acl_invalid:%:%',
          v_role,
          v_function.signature
          using errcode = '55000';
      end if;
    end loop;
  end loop;

  select relation.oid
    into v_company_table
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname = 'companies'
    and relation.relkind = 'r';

  select count(*) = 1
     and bool_and(
       trigger_row.tgenabled = 'O'
       and trigger_row.tgtype = 5
       and trigger_row.tgnargs = 0
       and trigger_row.tgfoid = pg_catalog.to_regprocedure(
         'private.seed_agent_read_domain_revisions()'
       )
       and trigger_row.tgconstraint = 0
     )
    into v_valid
  from pg_catalog.pg_trigger trigger_row
  where trigger_row.tgrelid = v_company_table
    and trigger_row.tgname = 'companies_seed_agent_read_domain_revisions'
    and not trigger_row.tgisinternal;

  if not coalesce(v_valid, false) then
    raise exception 'agent_read_domain_catalog_trigger_invalid'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid in (v_domain_table, v_revision_table)
      and not trigger_row.tgisinternal
  ) or exists (
    select 1
    from pg_catalog.pg_policy policy_row
    where policy_row.polrelid in (v_domain_table, v_revision_table)
  ) then
    raise exception 'agent_read_domain_catalog_private_trigger_invalid'
      using errcode = '55000';
  end if;

  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if pg_catalog.has_table_privilege(
      v_role,
      v_domain_table,
      'select,insert,update,delete,truncate,references,trigger'
    ) or pg_catalog.has_table_privilege(
      v_role,
      v_revision_table,
      'select,insert,update,delete,truncate,references,trigger'
    ) then
      raise exception 'agent_read_domain_catalog_acl_invalid:%', v_role
        using errcode = '55000';
    end if;
  end loop;
end;
$postflight$;
