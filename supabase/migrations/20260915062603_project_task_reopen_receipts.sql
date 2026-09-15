-- Apply once, in one transaction. These captured prerequisites make the
-- timestamp command, current actor and normal lifecycle side effects safe.
do $preflight$
declare
  v_expected record;
  v_oid oid;
begin
  if current_user <> 'postgres' then
    raise exception 'project_reopen_migration_owner_required' using errcode = '55000';
  end if;
  if to_regclass('private.project_task_reopen_receipts') is not null
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='public' and p.proname='reopen_project_for_task') then
    raise exception 'project_reopen_partial_or_existing_install' using errcode = '55000';
  end if;
  for v_expected in select * from (values
    ('private.get_current_user_id()', '127ffd06387933500d95f96aba24b605'),
    ('private.get_user_company_id()', '3de642ffe4b81ee8827c1cc6507f85c4'),
    ('private.user_can_edit_project(uuid,uuid)', '9c6d2bf27fe10e2788a85c9297c2ce45'),
    ('private.lock_lead_assignment_company(uuid)', '66a84a1311ffb22c79458cafbcca76bf'),
    ('private.canonicalize_address_text(text)', 'f700967f856963374263b3091a7d0c07'),
    ('private.normalize_property_address(text,boolean)', 'ef1f73d414c5c840005071c88965c3ed'),
    ('private.normalize_address(text)', '064c23779001fb85a0d08a408a2d785d'),
    ('private.project_address_dedupe_lock_key(uuid,text)', '734f1475691b2f5c3075aa2e868e3692'),
    ('private.email_project_dedupe_lock_key(uuid,uuid)', '3249d09b839e9280c4289cd1f450b049'),
    ('private.acquire_project_identity_locks(bigint[],bigint[],boolean)', 'c13bdce14cda13efd961d85af511a4c8'),
    ('private.serialize_project_email_identity_change()', '840c7c50c54b3bb821a6b0f31a5dda33'),
    ('private.bump_project_status_version()', '70fa2575cfb0d49820ee969e2d409b0f'),
    ('private.enqueue_project_status_lifecycle()', '9035f951e618e5a63211480255e39a73'),
    ('public.update_timestamp()', '93ab639fada1299eae91e1456a216b6d')
  ) expected(signature, definition_md5)
  loop
    v_oid := to_regprocedure(v_expected.signature);
    if v_oid is null or not exists (
      select 1 from pg_proc p where p.oid=v_oid
       and pg_get_userbyid(p.proowner)='postgres'
       and md5(pg_get_functiondef(p.oid))=v_expected.definition_md5
    ) then
      raise exception 'project_reopen_dependency_drift: %', v_expected.signature
        using errcode = '55000';
    end if;
  end loop;
  for v_expected in select * from (values
    ('projects_enqueue_status_lifecycle', 'CREATE TRIGGER projects_enqueue_status_lifecycle AFTER UPDATE OF status ON public.projects FOR EACH ROW WHEN ((old.status IS DISTINCT FROM new.status)) EXECUTE FUNCTION private.enqueue_project_status_lifecycle()'),
    ('projects_serialize_email_identity_change', 'CREATE TRIGGER projects_serialize_email_identity_change BEFORE INSERT OR DELETE OR UPDATE OF company_id, client_id, address, status, deleted_at, opportunity_id, opportunity_ref ON public.projects FOR EACH ROW EXECUTE FUNCTION private.serialize_project_email_identity_change()'),
    ('update_projects_timestamp', 'CREATE TRIGGER update_projects_timestamp BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION update_timestamp()'),
    ('zz_projects_bump_status_version', 'CREATE TRIGGER zz_projects_bump_status_version BEFORE UPDATE OF status, status_version ON public.projects FOR EACH ROW EXECUTE FUNCTION private.bump_project_status_version()')
  ) expected(trigger_name, definition)
  loop
    if not exists (
      select 1 from pg_trigger t
       where t.tgrelid=to_regclass('public.projects')
         and t.tgname=v_expected.trigger_name and not t.tgisinternal
         and t.tgenabled='O'
         and pg_get_triggerdef(t.oid)=v_expected.definition
    ) then
      raise exception 'project_reopen_trigger_drift: %', v_expected.trigger_name
        using errcode = '55000';
    end if;
  end loop;
  for v_expected in select * from (values
    ('public.projects', 'id', 'uuid', true),
    ('public.projects', 'company_id', 'uuid', true),
    ('public.projects', 'status', 'text', true),
    ('public.projects', 'updated_at', 'timestamp with time zone', false),
    ('public.projects', 'status_version', 'bigint', true),
    ('public.projects', 'deleted_at', 'timestamp with time zone', false),
    ('public.users', 'id', 'uuid', true),
    ('public.users', 'company_id', 'uuid', false),
    ('public.users', 'auth_id', 'text', false),
    ('public.users', 'firebase_uid', 'text', false),
    ('public.users', 'deleted_at', 'timestamp with time zone', false),
    ('public.users', 'is_active', 'boolean', false),
    ('public.companies', 'id', 'uuid', true)
  ) expected(table_name, column_name, type_name, requires_not_null)
  loop
    if not exists (
      select 1 from pg_attribute a
       where a.attrelid=to_regclass(v_expected.table_name)
         and a.attname=v_expected.column_name and not a.attisdropped
         and format_type(a.atttypid,a.atttypmod)=v_expected.type_name
         and (not v_expected.requires_not_null or a.attnotnull)
    ) then
      raise exception 'project_reopen_column_drift: %.%', v_expected.table_name, v_expected.column_name
        using errcode = '55000';
    end if;
  end loop;
end;
$preflight$;

-- Scheduling on an explicitly archived project carries one durable reopen
-- command. This is separate from task PATCHes: stale offline schedules never
-- acquire permission to reopen a project as a trigger side effect.
create table private.project_task_reopen_receipts (
  command_id uuid primary key,
  actor_user_id uuid not null references public.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  expected_updated_at timestamptz not null,
  target_status text not null check (target_status in ('accepted', 'in_progress')),
  result_updated_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);
create index project_task_reopen_receipts_actor_idx
  on private.project_task_reopen_receipts(actor_user_id);
create index project_task_reopen_receipts_company_idx
  on private.project_task_reopen_receipts(company_id);
create index project_task_reopen_receipts_project_idx
  on private.project_task_reopen_receipts(project_id);
alter table private.project_task_reopen_receipts enable row level security;
revoke all on table private.project_task_reopen_receipts
  from public, anon, authenticated, service_role;

create function public.reopen_project_for_task(
  p_command_id uuid,
  p_project_id uuid,
  p_expected_updated_at timestamptz,
  p_target_status text
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_actor_user_id uuid := private.get_current_user_id();
  v_company_id uuid := private.get_user_company_id();
  v_project public.projects%rowtype;
  v_receipt private.project_task_reopen_receipts%rowtype;
  v_updated_at timestamptz;
begin
  if coalesce(auth.role(), '') not in ('anon', 'authenticated')
     or v_actor_user_id is null or v_company_id is null then
    raise exception 'project_reopen_forbidden' using errcode = '42501';
  end if;
  if p_command_id is null or p_project_id is null
     or p_expected_updated_at is null or not isfinite(p_expected_updated_at)
     or p_target_status is null
     or p_target_status not in ('accepted', 'in_progress') then
    raise exception 'invalid_project_reopen_command' using errcode = '22023';
  end if;

  -- Same authority order as change_project_status: company advisory lock,
  -- company and actor rows, then the project. Existing status triggers keep
  -- their nonblocking provider/address identity locks and outbox attribution.
  perform private.lock_lead_assignment_company(v_company_id);
  perform 1 from public.companies company where company.id = v_company_id for share;
  if not found then
    raise exception 'project_reopen_forbidden' using errcode = '42501';
  end if;
  perform 1 from public.users actor
   where actor.id = v_actor_user_id
     and actor.company_id = v_company_id
     and actor.deleted_at is null and coalesce(actor.is_active, false)
   for share;
  -- Identity may have been unlinked while this request waited for the company
  -- lock. Re-resolve it after locking the actor row, before writes or replay.
  if not found
     or private.get_current_user_id() is distinct from v_actor_user_id
     or private.get_user_company_id() is distinct from v_company_id
     or not private.user_can_edit_project(v_actor_user_id, p_project_id) then
    raise exception 'project_reopen_forbidden' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'project-task-reopen:' || p_command_id::text, 14210950
  ));

  select * into v_project from public.projects
   where id = p_project_id and company_id = v_company_id and deleted_at is null
   for update;
  if not found
     or private.get_current_user_id() is distinct from v_actor_user_id
     or private.get_user_company_id() is distinct from v_company_id
     or not private.user_can_edit_project(v_actor_user_id, p_project_id) then
    raise exception 'project_reopen_forbidden' using errcode = '42501';
  end if;

  select * into v_receipt from private.project_task_reopen_receipts
   where command_id = p_command_id;
  if found then
    if v_receipt.actor_user_id is distinct from v_actor_user_id
       or v_receipt.company_id is distinct from v_company_id
       or v_receipt.project_id is distinct from p_project_id
       or v_receipt.expected_updated_at is distinct from p_expected_updated_at
       or v_receipt.target_status is distinct from p_target_status then
      raise exception 'project_reopen_command_conflict' using errcode = '22023';
    end if;
    -- This is historical proof, never a current-state projection. In
    -- particular a retry MUST NOT undo a later archive or status decision.
    return jsonb_build_object(
      'command_id', p_command_id, 'project_id', p_project_id,
      'company_id', v_company_id, 'status', v_receipt.target_status,
      'updated_at', v_receipt.result_updated_at, 'changed', true, 'replayed', true
    );
  end if;

  if v_project.status is distinct from 'archived'
     or v_project.updated_at is distinct from p_expected_updated_at then
    raise exception 'project_reopen_snapshot_conflict' using errcode = 'P0001';
  end if;
  update public.projects set status = p_target_status
   where id = p_project_id and company_id = v_company_id
   returning updated_at into v_updated_at;
  insert into private.project_task_reopen_receipts(
    command_id, actor_user_id, company_id, project_id,
    expected_updated_at, target_status, result_updated_at
  ) values (
    p_command_id, v_actor_user_id, v_company_id, p_project_id,
    p_expected_updated_at, p_target_status, v_updated_at
  );
  return jsonb_build_object(
    'command_id', p_command_id, 'project_id', p_project_id,
    'company_id', v_company_id, 'status', p_target_status,
    'updated_at', v_updated_at, 'changed', true, 'replayed', false
  );
end;
$function$;
revoke all on function public.reopen_project_for_task(uuid, uuid, timestamptz, text)
  from public, anon, authenticated, service_role;
-- The Firebase bridge uses anon with a resolvable signed-in actor. The body
-- always requires that actor and the canonical active-company edit scope.
grant execute on function public.reopen_project_for_task(uuid, uuid, timestamptz, text)
  to anon, authenticated;

-- Reject unexpected default grants rather than expose a new write boundary.
do $postflight$
begin
  if (select array_agg(a::text order by a::text)
        from pg_proc p, unnest(p.proacl) a
       where p.oid='public.reopen_project_for_task(uuid,uuid,timestamptz,text)'::regprocedure)
     is distinct from array['anon=X/postgres','authenticated=X/postgres','postgres=X/postgres']::text[]
     or exists (
       select 1 from pg_class c,
         lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
       where c.oid='private.project_task_reopen_receipts'::regclass
         and a.grantee<>c.relowner
     )
     or not (select relrowsecurity from pg_class
              where oid='private.project_task_reopen_receipts'::regclass) then
    raise exception 'project_reopen_unexpected_grants' using errcode = '55000';
  end if;
end;
$postflight$;
notify pgrst, 'reload schema';
