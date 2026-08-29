begin;

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
      ('function', 'private.bump_agent_read_domain_revision()'),
      ('table', 'public.email_connections'),
      ('table', 'public.accounting_connections')
  ) required(object_kind, object_name)
  where case required.object_kind
    when 'function' then pg_catalog.to_regprocedure(required.object_name) is null
    else pg_catalog.to_regclass(required.object_name) is null
  end;

  if v_missing is not null then
    raise exception 'agent_integration_health_sources_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from private.agent_read_domains domain
    where domain.domain = 'integrations'
  ) then
    raise exception 'agent_integrations_domain_missing' using errcode = '55000';
  end if;
end;
$prerequisites$;

do $source_shape$
declare
  v_invalid text[];
begin
  with expected(table_name, column_name, data_type) as (
    values
      ('email_connections', 'id', 'uuid'),
      ('email_connections', 'company_id', 'text'),
      ('email_connections', 'type', 'USER-DEFINED'),
      ('email_connections', 'user_id', 'text'),
      ('email_connections', 'provider', 'text'),
      ('email_connections', 'status', 'text'),
      ('email_connections', 'sync_enabled', 'boolean'),
      ('email_connections', 'webhook_subscription_id', 'text'),
      ('email_connections', 'webhook_expires_at', 'timestamp with time zone'),
      ('email_connections', 'last_synced_at', 'timestamp with time zone'),
      ('email_connections', 'provider_snapshot_at', 'timestamp with time zone'),
      ('email_connections', 'granted_scopes', 'ARRAY'),
      ('email_connections', 'created_at', 'timestamp with time zone'),
      ('accounting_connections', 'id', 'uuid'),
      ('accounting_connections', 'company_id', 'text'),
      ('accounting_connections', 'provider', 'text'),
      ('accounting_connections', 'provider_environment', 'text'),
      ('accounting_connections', 'is_connected', 'boolean'),
      ('accounting_connections', 'sync_enabled', 'boolean'),
      ('accounting_connections', 'last_sync_at', 'timestamp with time zone')
  )
  select pg_catalog.array_agg(
           expected.table_name || '.' || expected.column_name
           order by expected.table_name, expected.column_name
         )
    into v_invalid
  from expected
  left join information_schema.columns column_row
    on column_row.table_schema = 'public'
   and column_row.table_name = expected.table_name
   and column_row.column_name = expected.column_name
  where column_row.column_name is null
     or column_row.data_type is distinct from expected.data_type;

  if v_invalid is not null then
    raise exception 'agent_integration_health_source_shape_invalid: %',
      pg_catalog.array_to_string(v_invalid, ',')
      using errcode = '55000';
  end if;
end;
$source_shape$;

create index if not exists idx_email_connections_agent_integration_health_v1
  on public.email_connections (
    company_id,
    provider,
    type,
    user_id,
    id
  ) include (
    status,
    sync_enabled,
    webhook_subscription_id,
    webhook_expires_at,
    last_synced_at,
    provider_snapshot_at,
    granted_scopes,
    created_at
  );

create index if not exists idx_accounting_connections_agent_integration_health_v1
  on public.accounting_connections (
    company_id,
    provider,
    id
  ) include (
    is_connected,
    sync_enabled,
    last_sync_at
  ) where provider_environment = 'production';

drop trigger if exists email_connections_bump_agent_integrations_revision
  on public.email_connections;
create trigger email_connections_bump_agent_integrations_revision
after insert or delete or update of
  company_id,
  type,
  user_id,
  provider,
  status,
  sync_enabled,
  webhook_subscription_id,
  webhook_expires_at,
  last_synced_at,
  provider_snapshot_at,
  granted_scopes,
  created_at
on public.email_connections
for each row execute function private.bump_agent_read_domain_revision(
  'integrations', 'company_id'
);

drop trigger if exists accounting_connections_bump_agent_integrations_revision
  on public.accounting_connections;
create trigger accounting_connections_bump_agent_integrations_revision
after insert or delete or update of
  company_id,
  provider,
  provider_environment,
  is_connected,
  sync_enabled,
  last_sync_at
on public.accounting_connections
for each row execute function private.bump_agent_read_domain_revision(
  'integrations', 'company_id'
);

do $postflight$
declare
  v_expected record;
  v_valid boolean;
begin
  for v_expected in
    select * from (values
      ('idx_email_connections_agent_integration_health_v1', 'email_connections'),
      ('idx_accounting_connections_agent_integration_health_v1', 'accounting_connections')
    ) expected(index_name, table_name)
  loop
    select pg_catalog.count(*) = 1
       and pg_catalog.bool_and(
         index_row.indisvalid
         and index_row.indisready
         and index_row.indislive
         and not index_row.indisunique
         and not index_row.indisprimary
         and relation.relpersistence = 'p'
         and index_relation.relpersistence = 'p'
         and relation.relowner = current_user::regrole
         and index_relation.relowner = current_user::regrole
       )
      into v_valid
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class relation
      on relation.oid = index_row.indrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_row.indexrelid
    where namespace.nspname = 'public'
      and relation.relname = v_expected.table_name
      and index_relation.relname = v_expected.index_name;

    if not coalesce(v_valid, false) then
      raise exception 'agent_integration_health_source_index_invalid: %',
        v_expected.index_name using errcode = '55000';
    end if;
  end loop;

  for v_expected in
    select * from (values
      ('email_connections', 'email_connections_bump_agent_integrations_revision'),
      ('accounting_connections', 'accounting_connections_bump_agent_integrations_revision')
    ) expected(table_name, trigger_name)
  loop
    select pg_catalog.count(*) = 1
       and pg_catalog.bool_and(
         trigger_row.tgenabled = 'O'
         and not trigger_row.tgisinternal
         and trigger_row.tgtype = 29
         and procedure_namespace.nspname = 'private'
         and procedure.proname = 'bump_agent_read_domain_revision'
         and pg_catalog.encode(trigger_row.tgargs, 'escape') =
           'integrations' || E'\\000' || 'company_id' || E'\\000'
       )
      into v_valid
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class relation
      on relation.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    join pg_catalog.pg_proc procedure
      on procedure.oid = trigger_row.tgfoid
    join pg_catalog.pg_namespace procedure_namespace
      on procedure_namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and relation.relname = v_expected.table_name
      and trigger_row.tgname = v_expected.trigger_name;

    if not coalesce(v_valid, false) then
      raise exception 'agent_integration_health_source_trigger_invalid: %',
        v_expected.trigger_name using errcode = '55000';
    end if;
  end loop;
end;
$postflight$;

commit;
