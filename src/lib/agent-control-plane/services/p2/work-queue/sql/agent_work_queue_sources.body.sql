begin;

set local timezone = 'UTC';

-- Task 17 canonical work-queue source body. Only queue-visible facts advance
-- the dedicated tenant fence; unrelated provider and operational internals do not.
do $prerequisites$
begin
  if pg_catalog.to_regclass('private.agent_read_domain_revisions') is null
     or pg_catalog.to_regprocedure('private.advance_agent_read_domain_revisions(uuid[],text)') is null
     or pg_catalog.to_regprocedure('private.agent_read_domain_uuid_from_text(text)') is null
     or pg_catalog.to_regclass('public.activities') is null
     or pg_catalog.to_regclass('public.email_connections') is null
     or pg_catalog.to_regclass('public.email_threads') is null
     or pg_catalog.to_regclass('public.opportunities') is null
     or pg_catalog.to_regclass('public.opportunities_agent_p2_legacy_attention_idx') is null
     or pg_catalog.to_regclass('public.projects') is null
     or pg_catalog.to_regclass('public.project_tasks') is null
     or pg_catalog.to_regclass('public.project_notes') is null then
    raise exception 'agent_work_queue_sources_prerequisite_missing'
      using errcode = '55000';
  end if;
  if not exists (
    select 1 from private.agent_read_domains where domain = 'work_queue'
  ) then
    raise exception 'agent_work_queue_domain_missing' using errcode = '55000';
  end if;
end;
$prerequisites$;

drop index if exists public.idx_activities_agent_match_review_v1;
create index idx_activities_agent_match_review_v1
  on public.activities (company_id, created_at, id)
  where match_needs_review = true
    and type = 'email';

drop index if exists public.idx_email_threads_agent_commitment_v1;
create index idx_email_threads_agent_commitment_v1
  on public.email_threads (company_id, next_commitment_due_at, id)
  where has_unresolved_commitments = true
    and archived_at is null
    and next_commitment_due_at is not null;

create or replace function private.bump_agent_work_queue_source_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_old jsonb;
  v_new jsonb;
  v_fields text[];
  v_changed boolean := true;
  v_company_ids uuid[];
  v_old_project_company_id uuid;
  v_new_project_company_id uuid;
begin
  if tg_when is distinct from 'AFTER'
     or tg_level is distinct from 'ROW'
     or tg_nargs is distinct from 0
     or tg_table_schema is distinct from 'public'
     or tg_table_name not in (
       'activities','email_connections','email_threads','opportunities',
       'projects','project_tasks','project_notes'
     )
     or tg_op not in ('INSERT', 'UPDATE', 'DELETE') then
    raise exception 'agent_work_queue_revision_trigger_misconfigured'
      using errcode = '55000';
  end if;

  if tg_op in ('UPDATE', 'DELETE') then v_old := pg_catalog.to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := pg_catalog.to_jsonb(new); end if;

  v_fields := case tg_table_name
    when 'activities' then array[
      'id', 'company_id', 'type', 'created_at', 'email_connection_id',
      'email_thread_id', 'opportunity_id', 'project_id', 'match_needs_review'
    ]
    when 'email_connections' then array[
      'id','company_id','type','user_id'
    ]
    when 'email_threads' then array[
      'id', 'company_id', 'connection_id', 'opportunity_id',
      'provider_thread_id', 'archived_at', 'next_commitment_due_at',
      'has_unresolved_commitments','subject','latest_snippet',
      'last_message_at','unread_count','snoozed_until'
    ]
    when 'opportunities' then array[
      'id', 'company_id', 'stage', 'archived_at', 'deleted_at',
      'merged_into_opportunity_id', 'next_follow_up_at',
      'operator_action_required_at','assigned_to'
    ]
    when 'projects' then array[
      'id','company_id','deleted_at'
    ]
    when 'project_tasks' then array[
      'id','company_id','project_id','deleted_at','team_member_ids'
    ]
    else array[
      'id','company_id','project_id','deleted_at','mentioned_user_ids'
    ]
  end;

  if tg_op = 'UPDATE' then
    select coalesce(pg_catalog.bool_or(v_old -> field is distinct from v_new -> field), false)
      into v_changed
    from pg_catalog.unnest(v_fields) field;
  end if;
  if not v_changed then return null; end if;

  v_company_ids := array[
    private.agent_read_domain_uuid_from_text(v_old ->> 'company_id'),
    private.agent_read_domain_uuid_from_text(v_new ->> 'company_id')
  ];
  if tg_table_name in ('project_tasks','project_notes') then
    select project.company_id into v_old_project_company_id
    from public.projects project
    where project.id=private.agent_read_domain_uuid_from_text(
      v_old ->> 'project_id'
    );
    select project.company_id into v_new_project_company_id
    from public.projects project
    where project.id=private.agent_read_domain_uuid_from_text(
      v_new ->> 'project_id'
    );
    v_company_ids := v_company_ids || array[
      v_old_project_company_id,v_new_project_company_id
    ];
  end if;
  perform private.advance_agent_read_domain_revisions(v_company_ids, 'work_queue');
  return null;
end;
$function$;

revoke all on function private.bump_agent_work_queue_source_revision()
  from public, anon, authenticated, service_role;
alter function private.bump_agent_work_queue_source_revision()
  owner to current_user;
do $canonical_acl$
declare
  v_function_oid oid := pg_catalog.to_regprocedure(
    'private.bump_agent_work_queue_source_revision()'
  )::oid;
  v_acl record;
begin
  for v_acl in
    select distinct acl.grantee,
           case when acl.grantee=0 then 'public' else role.rolname end role_name
    from pg_catalog.pg_proc procedure
    cross join lateral pg_catalog.aclexplode(coalesce(
      procedure.proacl,pg_catalog.acldefault('f',procedure.proowner)
    )) acl
    left join pg_catalog.pg_roles role on role.oid=acl.grantee
    where procedure.oid=v_function_oid
      and acl.grantee<>procedure.proowner
  loop
    execute pg_catalog.format(
      'revoke all privileges on function private.bump_agent_work_queue_source_revision() from %s',
      case when v_acl.grantee=0 then 'public'
        else pg_catalog.quote_ident(v_acl.role_name) end
    );
  end loop;
end;
$canonical_acl$;

drop trigger if exists activities_bump_agent_work_queue_revision
  on public.activities;
create trigger activities_bump_agent_work_queue_revision
after insert or update or delete on public.activities
for each row execute function private.bump_agent_work_queue_source_revision();

drop trigger if exists email_threads_bump_agent_work_queue_revision
  on public.email_threads;
create trigger email_threads_bump_agent_work_queue_revision
after insert or update or delete on public.email_threads
for each row execute function private.bump_agent_work_queue_source_revision();

drop trigger if exists opportunities_bump_agent_work_queue_revision
  on public.opportunities;
create trigger opportunities_bump_agent_work_queue_revision
after insert or update or delete on public.opportunities
for each row execute function private.bump_agent_work_queue_source_revision();

drop trigger if exists email_connections_bump_agent_work_queue_revision
  on public.email_connections;
create trigger email_connections_bump_agent_work_queue_revision
after insert or update or delete on public.email_connections
for each row execute function private.bump_agent_work_queue_source_revision();

drop trigger if exists projects_bump_agent_work_queue_revision
  on public.projects;
create trigger projects_bump_agent_work_queue_revision
after insert or update or delete on public.projects
for each row execute function private.bump_agent_work_queue_source_revision();

drop trigger if exists project_tasks_bump_agent_work_queue_revision
  on public.project_tasks;
create trigger project_tasks_bump_agent_work_queue_revision
after insert or update or delete on public.project_tasks
for each row execute function private.bump_agent_work_queue_source_revision();

drop trigger if exists project_notes_bump_agent_work_queue_revision
  on public.project_notes;
create trigger project_notes_bump_agent_work_queue_revision
after insert or update or delete on public.project_notes
for each row execute function private.bump_agent_work_queue_source_revision();

do $postflight$
declare
  v_trigger_count integer;
  v_function_oid oid;
begin
  select count(*)::integer into v_trigger_count
  from pg_catalog.pg_trigger trigger_row
  join pg_catalog.pg_class relation on relation.oid = trigger_row.tgrelid
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  where not trigger_row.tgisinternal
    and namespace.nspname = 'public'
    and relation.relname in (
      'activities','email_connections','email_threads','opportunities',
      'projects','project_tasks','project_notes'
    )
    and trigger_row.tgfoid =
      pg_catalog.to_regprocedure('private.bump_agent_work_queue_source_revision()')::oid;
  if v_trigger_count <> 7
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
        and not trigger_row.tgisinternal
       where namespace.oid is null
          or trigger_row.oid is null
          or trigger_row.tgfoid is distinct from pg_catalog.to_regprocedure(
               'private.bump_agent_work_queue_source_revision()'
             )::oid
          or trigger_row.tgtype is distinct from 29::smallint
          or trigger_row.tgenabled is distinct from 'O'::"char"
     ) then
    raise exception 'agent_work_queue_sources_postflight_failed'
      using errcode = '55000';
  end if;
  v_function_oid := pg_catalog.to_regprocedure(
    'private.bump_agent_work_queue_source_revision()'
  )::oid;
  if not exists (
       select 1
       from pg_catalog.pg_proc procedure
       where procedure.oid=v_function_oid
         and procedure.proowner=(select role.oid from pg_catalog.pg_roles role
                                 where role.rolname=current_user)
         and procedure.prosecdef
         and procedure.proconfig=array['search_path=""']::text[]
     )
     or exists (
       select 1
       from pg_catalog.pg_proc procedure
       cross join lateral pg_catalog.aclexplode(coalesce(
         procedure.proacl,pg_catalog.acldefault('f',procedure.proowner)
       )) acl
       where procedure.oid=v_function_oid
         and acl.grantee<>procedure.proowner
     ) then
    raise exception 'agent_work_queue_source_private_acl_failed'
      using errcode = '55000';
  end if;
  if pg_catalog.pg_get_indexdef(
       'public.idx_activities_agent_match_review_v1'::regclass
     ) is distinct from
       'CREATE INDEX idx_activities_agent_match_review_v1 ON public.activities USING btree (company_id, created_at, id) WHERE ((match_needs_review = true) AND (type = ''email''::text))'
     or pg_catalog.pg_get_indexdef(
       'public.idx_email_threads_agent_commitment_v1'::regclass
     ) is distinct from
       'CREATE INDEX idx_email_threads_agent_commitment_v1 ON public.email_threads USING btree (company_id, next_commitment_due_at, id) WHERE ((has_unresolved_commitments = true) AND (archived_at IS NULL) AND (next_commitment_due_at IS NOT NULL))'
     or pg_catalog.pg_get_indexdef(
       'public.opportunities_agent_p2_legacy_attention_idx'::regclass
     ) is distinct from
       'CREATE INDEX opportunities_agent_p2_legacy_attention_idx ON public.opportunities USING btree (company_id, LEAST(COALESCE(operator_action_required_at, ''infinity''::timestamp with time zone), COALESCE(next_follow_up_at, ''infinity''::timestamp with time zone)), id) WHERE ((deleted_at IS NULL) AND (archived_at IS NULL) AND (merged_into_opportunity_id IS NULL) AND (stage <> ALL (ARRAY[''won''::text, ''lost''::text, ''discarded''::text])))' then
    raise exception 'agent_work_queue_source_index_postflight_failed'
      using errcode = '55000';
  end if;
end;
$postflight$;

commit;
