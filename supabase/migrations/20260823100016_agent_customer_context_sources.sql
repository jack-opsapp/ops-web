begin;

-- Customer-context source fences use the closed P2 customer domain. No new
-- lookup index is introduced here: current customer, child-contact, customer
-- job, and pending-review paths already have checked-in indexes. The live
-- PostgreSQL plan proof remains a separate apply gate.
do $prerequisites$
declare
  v_missing text[];
begin
  select pg_catalog.array_agg(required.object_name order by required.object_name)
  into v_missing
  from (
    values
      ('table', 'private.agent_read_domain_revisions'),
      ('function', 'private.bump_agent_read_domain_revision()'),
      ('table', 'public.clients'),
      ('table', 'public.sub_clients'),
      ('table', 'public.duplicate_reviews')
  ) required(object_kind, object_name)
  where case required.object_kind
    when 'function' then pg_catalog.to_regprocedure(required.object_name) is null
    else pg_catalog.to_regclass(required.object_name) is null
  end;

  if v_missing is not null then
    raise exception 'agent_customer_context_sources_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from private.agent_read_domains domain
    where domain.domain = 'customer'
  ) then
    raise exception 'agent_customer_context_domain_missing'
      using errcode = '55000';
  end if;
end;
$prerequisites$;

drop trigger if exists clients_bump_agent_customer_context_revision
  on public.clients;
create trigger clients_bump_agent_customer_context_revision
after insert or update or delete on public.clients
for each row execute function private.bump_agent_read_domain_revision('customer', 'company_id');

drop trigger if exists sub_clients_bump_agent_customer_context_revision
  on public.sub_clients;
create trigger sub_clients_bump_agent_customer_context_revision
after insert or update or delete on public.sub_clients
for each row execute function private.bump_agent_read_domain_revision('customer', 'company_id');

drop trigger if exists duplicate_reviews_bump_agent_customer_context_revision
  on public.duplicate_reviews;
create trigger duplicate_reviews_bump_agent_customer_context_revision
after insert or update or delete on public.duplicate_reviews
for each row execute function private.bump_agent_read_domain_revision('customer', 'company_id');

do $postflight$
declare
  v_expected_trigger text;
  v_table text;
  v_valid boolean;
begin
  foreach v_table in array array[
    'clients',
    'sub_clients',
    'duplicate_reviews'
  ] loop
    v_expected_trigger := v_table ||
      '_bump_agent_customer_context_revision';
    select pg_catalog.count(*) = 1
       and pg_catalog.bool_and(
         trigger_row.tgenabled = 'O'
         and not trigger_row.tgisinternal
         and procedure.proname = 'bump_agent_read_domain_revision'
         and procedure.pronamespace = 'private'::regnamespace
         and pg_catalog.encode(trigger_row.tgargs, 'escape') =
           E'customer\\000company_id\\000'
       )
    into v_valid
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class relation
      on relation.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    join pg_catalog.pg_proc procedure
      on procedure.oid = trigger_row.tgfoid
    where namespace.nspname = 'public'
      and relation.relname = v_table
      and trigger_row.tgname = v_expected_trigger;

    if not coalesce(v_valid, false) then
      raise exception 'agent_customer_context_source_trigger_invalid: %',
        v_expected_trigger
        using errcode = '55000';
    end if;
  end loop;
end;
$postflight$;

commit;
