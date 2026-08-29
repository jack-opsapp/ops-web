-- Task 17 forward-ledger and replay proof. psql variables point at isolated
-- scratch databases; no production database may run this fixture.
\set ON_ERROR_STOP on

-- task17_forward_ledger
-- task17_replay_sources
-- task17_replay_read
-- task17_function_acl_stable
\ir ../../supabase/migrations/20260829110000_agent_work_queue_sources.sql
\ir ../../supabase/migrations/20260829110001_agent_work_queue_read.sql

grant execute on function private.agent_p2_work_queue_expected_source_v1(
  text,text,jsonb
) to pg_monitor;
grant execute on function private.bump_agent_work_queue_source_revision()
  to pg_monitor;
grant execute on function public.read_agent_work_queue_as_system(
  uuid,uuid,uuid,uuid,text,text[],text,text[],text,jsonb,jsonb,jsonb,
  integer,integer,integer,timestamptz,jsonb,integer,timestamptz,text,uuid
) to authenticated with grant option;
drop index public.idx_activities_agent_match_review_v1;
create index idx_activities_agent_match_review_v1 on public.activities(id);
drop index public.idx_email_threads_agent_commitment_v1;
create index idx_email_threads_agent_commitment_v1 on public.email_threads(id);
alter table public.activities disable trigger
  activities_bump_agent_work_queue_revision;

\ir ../../supabase/migrations/20260829110000_agent_work_queue_sources.sql
\ir ../../supabase/migrations/20260829110001_agent_work_queue_read.sql

begin;
do $task17_replay_catalog$
begin
  if current_setting('server_version_num')::integer < 170000 then
    raise exception 'runtime_requires_postgresql_17';
  end if;
  if pg_catalog.to_regprocedure(
       'private.bump_agent_work_queue_source_revision()'
     ) is null
     or pg_catalog.to_regprocedure(
       'private.agent_p2_work_queue_read_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,jsonb,jsonb,jsonb,integer,integer,integer,timestamp with time zone,jsonb,integer,timestamp with time zone,text,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'private.agent_p2_work_queue_expected_source_v1(text,text,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.read_agent_work_queue_as_system(uuid,uuid,uuid,uuid,text,text[],text,text[],text,jsonb,jsonb,jsonb,integer,integer,integer,timestamp with time zone,jsonb,integer,timestamp with time zone,text,uuid)'
     ) is null then
    raise exception 'task17_replay_catalog_failed';
  end if;
  if pg_catalog.has_function_privilege(
       'pg_monitor','private.agent_p2_work_queue_expected_source_v1(text,text,jsonb)','EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'pg_monitor','private.bump_agent_work_queue_source_revision()','EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.read_agent_work_queue_as_system(uuid,uuid,uuid,uuid,text,text[],text,text[],text,jsonb,jsonb,jsonb,integer,integer,integer,timestamp with time zone,jsonb,integer,timestamp with time zone,text,uuid)',
       'EXECUTE'
     )
     or pg_catalog.pg_get_indexdef(
       'public.idx_activities_agent_match_review_v1'::regclass
     ) is distinct from
       'CREATE INDEX idx_activities_agent_match_review_v1 ON public.activities USING btree (company_id, created_at, id) WHERE ((match_needs_review = true) AND (type = ''email''::text))'
     or pg_catalog.pg_get_indexdef(
       'public.idx_email_threads_agent_commitment_v1'::regclass
     ) is distinct from
       'CREATE INDEX idx_email_threads_agent_commitment_v1 ON public.email_threads USING btree (company_id, next_commitment_due_at, id) WHERE ((has_unresolved_commitments = true) AND (archived_at IS NULL) AND (next_commitment_due_at IS NOT NULL))'
     or exists (
       select 1
       from (values
         ('activities','activities_bump_agent_work_queue_revision'),
         ('email_connections','email_connections_bump_agent_work_queue_revision'),
         ('email_threads','email_threads_bump_agent_work_queue_revision'),
         ('opportunities','opportunities_bump_agent_work_queue_revision'),
         ('projects','projects_bump_agent_work_queue_revision'),
         ('project_tasks','project_tasks_bump_agent_work_queue_revision'),
         ('project_notes','project_notes_bump_agent_work_queue_revision')
       ) expected(table_name,trigger_name)
       left join pg_catalog.pg_class relation on relation.relname=expected.table_name
       left join pg_catalog.pg_namespace namespace
         on namespace.oid=relation.relnamespace and namespace.nspname='public'
       left join pg_catalog.pg_trigger trigger_row
         on trigger_row.tgrelid=relation.oid
        and trigger_row.tgname=expected.trigger_name
       where namespace.oid is null or trigger_row.oid is null
          or trigger_row.tgtype<>29 or trigger_row.tgenabled<>'O'
     ) then
    raise exception 'task17_function_acl_stable';
  end if;
end;
$task17_replay_catalog$;
rollback;
