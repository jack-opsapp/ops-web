-- Activate the reviewed Operator lead/inbox preset only after every assignment
-- and email hardening seam is present. This is intentionally the final migration
-- in the coordinated 160000-180000 chain: a failure anywhere before this file
-- leaves the legacy Operator preset unchanged and therefore cannot expose a
-- partially hardened assigned-lead workflow.

begin;

do $prerequisites$
begin
  if to_regprocedure(
      'public.change_opportunity_assignment(uuid,bigint,uuid,uuid,text,uuid,jsonb)'
    ) is null
    or to_regprocedure(
      'private.user_can_view_opportunity(uuid,uuid)'
    ) is null
    or to_regprocedure(
      'private.user_can_edit_opportunity(uuid,uuid)'
    ) is null
    or to_regprocedure(
      'private.user_can_assign_opportunity(uuid,uuid)'
    ) is null
    or to_regprocedure(
      'private.user_can_view_opportunity_inbox(uuid,uuid,uuid)'
    ) is null
    or to_regprocedure(
      'private.user_can_send_opportunity_inbox(uuid,uuid,uuid)'
    ) is null
    or to_regprocedure(
      'private.current_user_can_view_email_thread_correction(uuid,uuid)'
    ) is null
    or to_regprocedure(
      'private.current_user_can_edit_email_thread_correction(uuid,uuid)'
    ) is null
    or to_regprocedure(
      'private.assert_permission_role_valid(uuid)'
    ) is null
    or to_regprocedure(
      'private.assert_permission_users_valid(uuid[])'
    ) is null
    or to_regprocedure(
      'private.lock_lead_assignment_company(uuid)'
    ) is null
    or to_regprocedure(
      'private.permission_try_parse_uuid(text)'
    ) is null
    or to_regprocedure(
      'public.claim_opportunity_assignment_deliveries(uuid,integer,integer)'
    ) is null
    or to_regprocedure(
      'private.email_outbound_learning_guard(uuid)'
    ) is null
    or to_regclass('public.opportunity_assignment_events') is null
    or to_regclass('public.opportunity_assignment_deliveries') is null
    or to_regclass('public.user_permission_change_deliveries') is null
  then
    raise exception 'lead_assignment_operator_activation_prerequisite_missing'
      using errcode = '55000';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_publication p
     where p.pubname = 'supabase_realtime'
  ) and (
    not exists (
      select 1
        from pg_catalog.pg_publication_tables pt
       where pt.pubname = 'supabase_realtime'
         and pt.schemaname = 'public'
         and pt.tablename = 'opportunity_assignment_events'
    )
    or not exists (
      select 1
        from pg_catalog.pg_publication_tables pt
       where pt.pubname = 'supabase_realtime'
         and pt.schemaname = 'public'
         and pt.tablename = 'opportunity_assignment_deliveries'
    )
    or not exists (
      select 1
        from pg_catalog.pg_publication_tables pt
       where pt.pubname = 'supabase_realtime'
         and pt.schemaname = 'public'
         and pt.tablename = 'user_permission_change_deliveries'
    )
  ) then
    raise exception 'lead_assignment_operator_activation_realtime_missing'
      using errcode = '55000';
  end if;
end;
$prerequisites$;

create table private.lead_assignment_operator_activation_audit (
  id uuid primary key default gen_random_uuid(),
  migration_key text not null
    check (migration_key = '20260715180000'),
  operator_role_id uuid not null,
  before_permissions jsonb not null
    check (jsonb_typeof(before_permissions) = 'array'),
  after_permissions jsonb not null
    check (jsonb_typeof(after_permissions) = 'array'),
  affected_user_count integer not null
    check (affected_user_count >= 0),
  intentional_narrowing jsonb not null
    check (jsonb_typeof(intentional_narrowing) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  unique (migration_key, operator_role_id)
);

revoke all on table private.lead_assignment_operator_activation_audit
  from public, anon, authenticated, service_role;

do $activate_operator$
declare
  v_operator_id constant uuid :=
    '00000000-0000-0000-0000-000000000004'::uuid;
  v_operator public.roles%rowtype;
  v_before_permissions jsonb;
  v_after_permissions jsonb;
  v_locked_company_ids uuid[] := array[]::uuid[];
  v_current_company_ids uuid[] := array[]::uuid[];
  v_company_id uuid;
  v_affected_user_ids uuid[] := array[]::uuid[];
  v_affected_user_count integer := 0;
begin
  -- Snapshot the current membership boundary without taking row locks, then
  -- acquire every company advisory lock in stable UUID order. All supported
  -- assignment and permission mutations use this same company-first order.
  select coalesce(
      array_agg(distinct u.company_id order by u.company_id)
        filter (where u.company_id is not null),
      array[]::uuid[]
    )
    into v_locked_company_ids
    from public.user_roles ur
    join public.users u
      on u.id = private.permission_try_parse_uuid(ur.user_id)
   where ur.role_id = v_operator_id;

  for v_company_id in
    select locked_company_id
      from unnest(v_locked_company_ids) locked_company_id
     order by locked_company_id
  loop
    perform private.lock_lead_assignment_company(v_company_id);
  end loop;

  select r.*
    into v_operator
    from public.roles r
   where r.id = v_operator_id
   for update;

  if not found
    or not coalesce(v_operator.is_preset, false)
    or lower(v_operator.name) is distinct from 'operator'
  then
    raise exception 'lead_assignment_operator_preset_shape_changed'
      using errcode = '55000';
  end if;

  -- Serialize the preset, its memberships, and the member rows so the before /
  -- after proof and the dependency validation describe one atomic state.
  perform 1
    from public.role_permissions rp
   where rp.role_id = v_operator_id
   order by rp.permission
   for update;

  perform 1
    from public.user_roles ur
   where ur.role_id = v_operator_id
   order by ur.user_id
   for update;

  -- The role lock prevents a supported role replacement from passing its FK
  -- check while this migration validates the snapshot. If a new-company
  -- member committed during the pre-lock gap, abort retryably; never acquire a
  -- late company lock after role/member rows are held.
  if exists (
    select 1
      from public.user_roles ur
      left join public.users u
        on u.id = private.permission_try_parse_uuid(ur.user_id)
     where ur.role_id = v_operator_id
       and (
         u.id is null
         or u.company_id is null
         or u.deleted_at is not null
         or not coalesce(u.is_active, false)
       )
  ) then
    raise exception 'lead_assignment_operator_membership_shape_changed'
      using errcode = '55000';
  end if;

  select coalesce(
      array_agg(distinct u.company_id order by u.company_id),
      array[]::uuid[]
    )
    into v_current_company_ids
    from public.user_roles ur
    join public.users u
      on u.id = private.permission_try_parse_uuid(ur.user_id)
   where ur.role_id = v_operator_id;

  if not (v_current_company_ids <@ v_locked_company_ids) then
    raise exception 'operator_membership_company_set_changed'
      using errcode = '40001';
  end if;

  perform 1
    from public.users u
    join public.user_roles ur
      on u.id = private.permission_try_parse_uuid(ur.user_id)
   where ur.role_id = v_operator_id
   order by u.id
   for update of u;

  -- A member user may have been moved, deactivated, or soft-deleted after the
  -- company snapshot but before its row lock. Repeat both validations now that
  -- the role, memberships, and every resolvable member user are frozen. Never
  -- acquire a newly discovered company lock after row locks: abort retryably so
  -- the migration can restart from a fresh company-first snapshot.
  if exists (
    select 1
      from public.user_roles ur
      left join public.users u
        on u.id = private.permission_try_parse_uuid(ur.user_id)
     where ur.role_id = v_operator_id
       and (
         u.id is null
         or u.company_id is null
         or u.deleted_at is not null
         or not coalesce(u.is_active, false)
       )
  ) then
    raise exception 'operator_membership_user_state_changed'
      using errcode = '40001';
  end if;

  select coalesce(
      array_agg(distinct u.company_id order by u.company_id),
      array[]::uuid[]
    )
    into v_current_company_ids
    from public.user_roles ur
    join public.users u
      on u.id = private.permission_try_parse_uuid(ur.user_id)
   where ur.role_id = v_operator_id;

  if not (v_current_company_ids <@ v_locked_company_ids) then
    raise exception 'operator_membership_company_set_changed_after_user_lock'
      using errcode = '40001';
  end if;

  select
    coalesce(
      array_agg(u.id order by u.id) filter (where u.id is not null),
      array[]::uuid[]
    ),
    count(ur.user_id)::integer
    into v_affected_user_ids, v_affected_user_count
    from public.user_roles ur
    left join public.users u on ur.user_id = u.id::text
   where ur.role_id = v_operator_id;

  select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'permission', rp.permission,
          'scope', rp.scope
        )
        order by rp.permission, rp.scope
      ),
      '[]'::jsonb
    )
    into v_before_permissions
    from public.role_permissions rp
   where rp.role_id = v_operator_id;

  -- 161000 deliberately retained this exact legacy row and prohibited early
  -- granular activation. Refuse to reinterpret an unreviewed intermediate
  -- preset instead of silently widening or narrowing it.
  if not exists (
    select 1
      from public.role_permissions rp
     where rp.role_id = v_operator_id
       and rp.permission = 'inbox.view'
       and rp.scope = 'all'
  )
    or exists (
      select 1
        from public.role_permissions rp
       where rp.role_id = v_operator_id
         and rp.permission in (
           'pipeline.create',
           'pipeline.view',
           'pipeline.edit',
           'pipeline.assign',
           'pipeline.convert',
           'inbox.send'
         )
    )
  then
    raise exception 'lead_assignment_operator_pre_activation_state_changed'
      using errcode = '55000';
  end if;

  -- Hidden compatibility aliases must never be able to widen the explicit
  -- reviewed preset. Deleting them is defensive; the final assertions prove
  -- neither survived activation.
  delete from public.role_permissions rp
   where rp.role_id = v_operator_id
     and rp.permission in ('pipeline.manage', 'inbox.view_company');

  insert into public.role_permissions (role_id, permission, scope)
  values
    (v_operator_id, 'pipeline.create', 'all'),
    (v_operator_id, 'pipeline.view', 'assigned'),
    (v_operator_id, 'pipeline.edit', 'assigned'),
    (v_operator_id, 'pipeline.assign', 'assigned'),
    (v_operator_id, 'pipeline.convert', 'assigned'),
    (v_operator_id, 'inbox.view', 'assigned'),
    (v_operator_id, 'inbox.send', 'assigned')
  on conflict (role_id, permission) do update
    set scope = excluded.scope;

  perform private.assert_permission_role_valid(v_operator_id);
  perform private.assert_permission_users_valid(v_affected_user_ids);

  if exists (
    select 1
      from public.role_permissions rp
     where rp.role_id = v_operator_id
       and rp.permission = 'inbox.view_company'
  ) then
    raise exception 'operator_company_inbox_compatibility_remains'
      using errcode = '55000';
  end if;

  if exists (
    select 1
      from public.role_permissions rp
     where rp.role_id = v_operator_id
       and rp.permission = 'pipeline.manage'
  ) then
    raise exception 'operator_pipeline_manage_compatibility_remains'
      using errcode = '55000';
  end if;

  if (
    select count(*)
      from public.role_permissions rp
     where rp.role_id = v_operator_id
       and rp.permission in (
         'pipeline.create',
         'pipeline.view',
         'pipeline.edit',
         'pipeline.assign',
         'pipeline.convert',
         'inbox.view',
         'inbox.send'
       )
  ) <> 7
    or exists (
      select 1
        from (
          values
            ('pipeline.create'::text, 'all'::text),
            ('pipeline.view'::text, 'assigned'::text),
            ('pipeline.edit'::text, 'assigned'::text),
            ('pipeline.assign'::text, 'assigned'::text),
            ('pipeline.convert'::text, 'assigned'::text),
            ('inbox.view'::text, 'assigned'::text),
            ('inbox.send'::text, 'assigned'::text)
        ) expected(permission, scope)
       where not exists (
         select 1
           from public.role_permissions rp
          where rp.role_id = v_operator_id
            and rp.permission = expected.permission
            and rp.scope = expected.scope
       )
    )
  then
    raise exception 'lead_assignment_operator_final_matrix_invalid'
      using errcode = '55000';
  end if;

  select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'permission', rp.permission,
          'scope', rp.scope
        )
        order by rp.permission, rp.scope
      ),
      '[]'::jsonb
    )
    into v_after_permissions
    from public.role_permissions rp
   where rp.role_id = v_operator_id;

  insert into private.lead_assignment_operator_activation_audit (
    migration_key,
    operator_role_id,
    before_permissions,
    after_permissions,
    affected_user_count,
    intentional_narrowing
  )
  values (
    '20260715180000',
    v_operator_id,
    v_before_permissions,
    v_after_permissions,
    v_affected_user_count,
    jsonb_build_object(
      'permission', 'inbox.view',
      'from', 'all',
      'to', 'assigned',
      'classification', 'intentional_narrowing',
      'reason', 'Operator visibility is restricted to assigned leads and the actor personal mailbox.'
    )
  );

  if not exists (
    select 1
      from private.lead_assignment_operator_activation_audit audit
     where audit.migration_key = '20260715180000'
       and audit.operator_role_id = v_operator_id
       and audit.before_permissions = v_before_permissions
       and audit.after_permissions = v_after_permissions
       and audit.affected_user_count = v_affected_user_count
  ) then
    raise exception 'lead_assignment_operator_activation_audit_missing'
      using errcode = '55000';
  end if;
end;
$activate_operator$;

commit;
