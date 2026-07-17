-- ============================================================================
-- LEAD ASSIGNMENT PERMISSION MIGRATION AND ATOMIC MUTATION GUARD
--
-- 161000 translates reviewed legacy lead permissions without activating the
-- Operator preset, records a deterministic before/after report, and makes role,
-- override, and user-role changes atomic with lead-responsibility resolution.
-- Operator lead access remains exclusively owned by 20260715181000.
-- ============================================================================

begin;

do $predecessors$
begin
  if not exists (
    select 1
      from pg_catalog.pg_attribute a
     where a.attrelid = 'public.opportunities'::regclass
       and a.attname = 'assignment_version'
       and not a.attisdropped
  )
    or to_regprocedure(
      'public.change_opportunity_assignment_as_system(uuid,bigint,uuid,uuid,text,uuid,uuid,jsonb)'
    ) is null
    or to_regprocedure(
      'private.effective_pipeline_scope_for_user(uuid,uuid,text)'
    ) is null
  then
    raise exception 'lead_assignment_permission_predecessor_missing'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.table_name = 'role_permissions'
       and c.column_name = 'permission'
       and c.data_type = 'text'
       and c.is_nullable = 'NO'
  )
    or not exists (
      select 1
        from information_schema.columns c
       where c.table_schema = 'public'
         and c.table_name = 'user_roles'
         and c.column_name = 'user_id'
         and c.data_type = 'text'
         and c.is_nullable = 'NO'
    )
  then
    raise exception 'lead_assignment_permission_schema_shape_changed'
      using errcode = '55000';
  end if;
end;
$predecessors$;

create table private.lead_assignment_permission_migration_snapshots (
  id uuid primary key default gen_random_uuid(),
  migration_key text not null check (migration_key = '20260715161000'),
  phase text not null check (phase in ('before', 'after')),
  subject_kind text not null check (subject_kind in ('role', 'user_override')),
  subject_id uuid not null,
  company_id uuid,
  permissions jsonb not null check (jsonb_typeof(permissions) = 'array'),
  row_count integer not null check (row_count >= 0),
  snapshot_hash text not null,
  created_at timestamptz not null default clock_timestamp()
);

create unique index lead_assignment_permission_snapshots_subject_idx
  on private.lead_assignment_permission_migration_snapshots (
    migration_key,
    phase,
    subject_kind,
    subject_id,
    coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create table private.lead_assignment_permission_migration_diffs (
  id uuid primary key default gen_random_uuid(),
  migration_key text not null check (migration_key = '20260715161000'),
  subject_kind text not null check (subject_kind in ('role', 'user_override')),
  subject_id uuid not null,
  company_id uuid,
  permission text not null,
  before_permission jsonb,
  after_permission jsonb,
  classification text not null,
  reason text not null,
  created_at timestamptz not null default clock_timestamp()
);

create unique index lead_assignment_permission_diffs_subject_idx
  on private.lead_assignment_permission_migration_diffs (
    migration_key,
    subject_kind,
    subject_id,
    coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
    permission,
    classification
  );

revoke all on table private.lead_assignment_permission_migration_snapshots
  from public, anon, authenticated, service_role;
revoke all on table private.lead_assignment_permission_migration_diffs
  from public, anon, authenticated, service_role;

-- This registry is the database copy of the product-editable permission
-- registry at migration time. Hidden compatibility bits are deliberately not
-- present, so an atomic replacement cannot rewrite pipeline.manage,
-- inbox.view_company, spec.admin, or future server-only permissions.
create table private.lead_permission_editor_registry (
  permission text primary key,
  scopes text[] not null check (cardinality(scopes) > 0)
);

insert into private.lead_permission_editor_registry (permission, scopes)
values
  ('projects.view', array['all', 'assigned']),
  ('projects.create', array['all']),
  ('projects.edit', array['all', 'assigned']),
  ('projects.delete', array['all']),
  ('projects.archive', array['all']),
  ('projects.assign_team', array['all']),
  ('projects.manage_views', array['all']),
  ('projects.view_financials', array['all']),
  ('tasks.view', array['all', 'assigned']),
  ('tasks.create', array['all']),
  ('tasks.edit', array['all', 'assigned']),
  ('tasks.delete', array['all']),
  ('tasks.assign', array['all']),
  ('tasks.change_status', array['all', 'assigned']),
  ('clients.view', array['all', 'assigned']),
  ('clients.create', array['all']),
  ('clients.edit', array['all']),
  ('clients.delete', array['all']),
  ('calendar.view', array['all', 'own']),
  ('calendar.create', array['all']),
  ('calendar.edit', array['all', 'own']),
  ('calendar.delete', array['all']),
  ('job_board.view', array['all', 'assigned']),
  ('job_board.manage_sections', array['all']),
  ('deck_builder.view', array['all', 'assigned']),
  ('deck_builder.create', array['all', 'assigned']),
  ('deck_builder.edit', array['all', 'assigned']),
  ('estimates.view', array['all', 'assigned']),
  ('estimates.create', array['all']),
  ('estimates.edit', array['all', 'own']),
  ('estimates.delete', array['all']),
  ('estimates.send', array['all']),
  ('estimates.convert', array['all']),
  ('invoices.view', array['all', 'assigned']),
  ('invoices.create', array['all']),
  ('invoices.edit', array['all']),
  ('invoices.delete', array['all']),
  ('invoices.send', array['all']),
  ('invoices.record_payment', array['all']),
  ('invoices.void', array['all']),
  ('pipeline.create', array['all']),
  ('pipeline.view', array['all', 'assigned']),
  ('pipeline.edit', array['all', 'assigned']),
  ('pipeline.assign', array['all', 'assigned']),
  ('pipeline.convert', array['all', 'assigned']),
  ('pipeline.configure_stages', array['all']),
  ('pipeline.manage_views', array['all']),
  ('products.view', array['all']),
  ('products.manage', array['all']),
  ('catalog.view', array['all']),
  ('catalog.manage', array['all']),
  ('catalog.import', array['all']),
  ('catalog.stock.adjust', array['all']),
  ('catalog.products.view', array['all']),
  ('catalog.products.manage', array['all']),
  ('catalog.orders.view', array['all']),
  ('catalog.orders.manage', array['all']),
  ('catalog.run_setup', array['all']),
  ('inventory.manage', array['all']),
  ('expenses.view', array['all', 'own']),
  ('expenses.create', array['all']),
  ('expenses.edit', array['all', 'own']),
  ('expenses.delete', array['all', 'own']),
  ('expenses.approve', array['all', 'assigned']),
  ('expenses.configure', array['all']),
  ('accounting.view', array['all']),
  ('accounting.manage_connections', array['all']),
  ('finances.view', array['all']),
  ('photos.view', array['all', 'assigned']),
  ('photos.upload', array['all']),
  ('photos.annotate', array['all']),
  ('photos.delete', array['all', 'own']),
  ('documents.view', array['all']),
  ('documents.manage_templates', array['all']),
  ('team.view', array['all']),
  ('team.manage', array['all']),
  ('team.assign_roles', array['all']),
  ('time_off.approve', array['all', 'assigned']),
  ('profile.edit', array['own']),
  ('map.view', array['all']),
  ('map.view_crew_locations', array['all']),
  ('notifications.view', array['own']),
  ('notifications.manage_preferences', array['own']),
  ('settings.company', array['all']),
  ('settings.billing', array['all']),
  ('settings.integrations', array['all']),
  ('settings.preferences', array['all']),
  ('email.connect', array['all']),
  ('email.view', array['all', 'own']),
  ('email.manage', array['all']),
  ('email.configure_ai', array['all']),
  ('inbox.view', array['all', 'assigned', 'own']),
  ('inbox.archive', array['all']),
  ('inbox.snooze', array['all']),
  ('inbox.categorize', array['all']),
  ('inbox.send', array['all', 'assigned']),
  ('inbox.configure_phase_c', array['all']),
  ('portal.view', array['all']),
  ('portal.manage_branding', array['all']),
  ('reports.view', array['all']);

revoke all on table private.lead_permission_editor_registry
  from public, anon, authenticated, service_role;

-- Snapshot first. Arrays are sorted and the hash is over the canonical JSON
-- representation, so the report is stable across repeated readbacks.
insert into private.lead_assignment_permission_migration_snapshots (
  migration_key,
  phase,
  subject_kind,
  subject_id,
  company_id,
  permissions,
  row_count,
  snapshot_hash
)
select
  '20260715161000',
  'before',
  'role',
  r.id,
  r.company_id,
  snapshot.permissions,
  snapshot.row_count,
  pg_catalog.md5(snapshot.permissions::text)
from public.roles r
cross join lateral (
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'permission', rp.permission,
          'scope', rp.scope
        )
        order by rp.permission, rp.scope
      ),
      '[]'::jsonb
    ) as permissions,
    count(rp.id)::integer as row_count
  from public.role_permissions rp
  where rp.role_id = r.id
) snapshot;

insert into private.lead_assignment_permission_migration_snapshots (
  migration_key,
  phase,
  subject_kind,
  subject_id,
  company_id,
  permissions,
  row_count,
  snapshot_hash
)
select
  '20260715161000',
  'before',
  'user_override',
  upo.user_id,
  upo.company_id,
  jsonb_agg(
    jsonb_build_object(
      'permission', upo.permission,
      'scope', upo.scope,
      'granted', upo.granted
    )
    order by upo.permission, upo.scope nulls first, upo.granted
  ),
  count(*)::integer,
  pg_catalog.md5(
    jsonb_agg(
      jsonb_build_object(
        'permission', upo.permission,
        'scope', upo.scope,
        'granted', upo.granted
      )
      order by upo.permission, upo.scope nulls first, upo.granted
    )::text
  )
from public.user_permission_overrides upo
group by upo.user_id, upo.company_id;

-- Abort rather than turn a newly-created or formerly ineffective legacy row
-- into live assigned-scope authorization.
do $reviewed_shape$
begin
  if exists (
    select 1
      from public.roles r
      join public.role_permissions rp on rp.role_id = r.id
     where not r.is_preset
       and (rp.permission like 'pipeline.%' or rp.permission like 'inbox.%')
  ) then
    raise exception 'custom_role_configuration_not_reviewed'
      using errcode = '55000';
  end if;

  if exists (
    select 1
      from public.role_permissions rp
     where rp.permission in (
       'pipeline.create',
       'pipeline.edit',
       'pipeline.assign',
       'pipeline.convert'
     )
  ) then
    raise exception 'ambiguous_legacy_permission_shape: granular role row already exists'
      using errcode = '55000';
  end if;

  if exists (
    select 1
      from public.role_permissions rp
     where (rp.permission = 'pipeline.view' and rp.scope <> 'all')
        or (rp.permission = 'pipeline.manage' and rp.scope <> 'all')
        or (rp.permission = 'inbox.view_company' and rp.scope <> 'all')
        or (rp.permission = 'inbox.send' and rp.scope <> 'all')
  ) then
    raise exception 'ambiguous_legacy_permission_shape: unsupported legacy scope including pipeline.view assigned'
      using errcode = '55000';
  end if;

  if exists (
    select 1
      from public.roles r
      join public.role_permissions view_row
        on view_row.role_id = r.id
       and view_row.permission = 'inbox.view'
     where not exists (
       select 1
         from public.role_permissions company_view
        where company_view.role_id = r.id
          and company_view.permission = 'inbox.view_company'
     )
       and not (
         r.is_preset
         and r.id = '00000000-0000-0000-0000-000000000004'::uuid
         and lower(r.name) = 'operator'
       )
  ) then
    raise exception 'standalone_inbox_view_not_reviewed'
      using errcode = '55000';
  end if;

  if exists (
    select 1
      from public.user_permission_overrides upo
     where upo.permission in (
       'pipeline.create',
       'pipeline.edit',
       'pipeline.assign',
       'pipeline.convert'
     )
        or (
          upo.permission = 'pipeline.view'
          and upo.granted
          and upo.scope is distinct from 'all'
        )
        or upo.permission = 'inbox.view'
  ) then
    raise exception 'ambiguous_legacy_permission_shape: override requires reviewed disposition'
      using errcode = '55000';
  end if;

  if exists (
    select 1
      from public.user_permission_overrides upo
     where upo.permission = 'pipeline.manage'
       and upo.granted
       and upo.scope is not null
       and upo.scope <> 'all'
  ) then
    raise exception 'ambiguous_legacy_permission_shape: pipeline manage override scope'
      using errcode = '55000';
  end if;

  if exists (
    select 1
      from public.user_permission_overrides upo
     where upo.permission = 'inbox.view_company'
       and not upo.granted
  ) then
    raise exception 'ambiguous_inbox_company_revoke'
      using errcode = '55000';
  end if;

  if exists (
    select 1
      from public.user_permission_overrides upo
     where upo.permission in ('inbox.view_company', 'inbox.send')
       and upo.granted
       and upo.scope is not null
       and upo.scope <> 'all'
  ) then
    raise exception 'ambiguous_legacy_permission_shape: inbox override scope'
      using errcode = '55000';
  end if;

  -- granted=true with scope is null is inert and intentionally creates no
  -- granular override during the compatibility translation.
end;
$reviewed_shape$;

-- pipeline.manage remains in place. Its reviewed all-scope meaning is copied
-- to the four granular write capabilities, without adding pipeline.view.
insert into public.role_permissions (role_id, permission, scope)
select rp.role_id, mapped.permission, 'all'
from public.role_permissions rp
cross join lateral (
  values
    ('pipeline.create'::text),
    ('pipeline.edit'::text),
    ('pipeline.assign'::text),
    ('pipeline.convert'::text)
) mapped(permission)
where rp.permission = 'pipeline.manage'
  and rp.scope = 'all'
on conflict (role_id, permission) do nothing;

insert into public.role_permissions (role_id, permission, scope)
select rp.role_id, 'inbox.view', 'all'
from public.role_permissions rp
where rp.permission = 'inbox.view_company'
  and rp.scope = 'all'
on conflict (role_id, permission) do nothing;

insert into public.user_permission_overrides (
  user_id,
  company_id,
  permission,
  scope,
  granted
)
select
  upo.user_id,
  upo.company_id,
  mapped.permission,
  case when upo.granted then 'all' else null end,
  upo.granted
from public.user_permission_overrides upo
cross join lateral (
  values
    ('pipeline.create'::text),
    ('pipeline.edit'::text),
    ('pipeline.assign'::text),
    ('pipeline.convert'::text)
) mapped(permission)
where upo.permission = 'pipeline.manage'
  and (
    not upo.granted
    or (upo.granted and upo.scope = 'all')
  )
on conflict (user_id, permission) do nothing;

insert into public.user_permission_overrides (
  user_id,
  company_id,
  permission,
  scope,
  granted
)
select upo.user_id, upo.company_id, 'inbox.view', 'all', true
from public.user_permission_overrides upo
where upo.permission = 'inbox.view_company'
  and upo.granted
  and upo.scope = 'all'
on conflict (user_id, permission) do nothing;

insert into private.lead_assignment_permission_migration_snapshots (
  migration_key,
  phase,
  subject_kind,
  subject_id,
  company_id,
  permissions,
  row_count,
  snapshot_hash
)
select
  '20260715161000',
  'after',
  'role',
  r.id,
  r.company_id,
  snapshot.permissions,
  snapshot.row_count,
  pg_catalog.md5(snapshot.permissions::text)
from public.roles r
cross join lateral (
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'permission', rp.permission,
          'scope', rp.scope
        )
        order by rp.permission, rp.scope
      ),
      '[]'::jsonb
    ) as permissions,
    count(rp.id)::integer as row_count
  from public.role_permissions rp
  where rp.role_id = r.id
) snapshot;

insert into private.lead_assignment_permission_migration_snapshots (
  migration_key,
  phase,
  subject_kind,
  subject_id,
  company_id,
  permissions,
  row_count,
  snapshot_hash
)
select
  '20260715161000',
  'after',
  'user_override',
  upo.user_id,
  upo.company_id,
  jsonb_agg(
    jsonb_build_object(
      'permission', upo.permission,
      'scope', upo.scope,
      'granted', upo.granted
    )
    order by upo.permission, upo.scope nulls first, upo.granted
  ),
  count(*)::integer,
  pg_catalog.md5(
    jsonb_agg(
      jsonb_build_object(
        'permission', upo.permission,
        'scope', upo.scope,
        'granted', upo.granted
      )
      order by upo.permission, upo.scope nulls first, upo.granted
    )::text
  )
from public.user_permission_overrides upo
group by upo.user_id, upo.company_id;

with before_rows as (
  select
    s.subject_kind,
    s.subject_id,
    s.company_id,
    s.permissions as full_permissions,
    item ->> 'permission' as permission,
    item
  from private.lead_assignment_permission_migration_snapshots s
  cross join lateral jsonb_array_elements(s.permissions) item
  where s.migration_key = '20260715161000'
    and s.phase = 'before'
),
after_rows as (
  select
    s.subject_kind,
    s.subject_id,
    s.company_id,
    s.permissions as full_permissions,
    item ->> 'permission' as permission,
    item
  from private.lead_assignment_permission_migration_snapshots s
  cross join lateral jsonb_array_elements(s.permissions) item
  where s.migration_key = '20260715161000'
    and s.phase = 'after'
),
changes as (
  select
    coalesce(b.subject_kind, a.subject_kind) as subject_kind,
    coalesce(b.subject_id, a.subject_id) as subject_id,
    coalesce(b.company_id, a.company_id) as company_id,
    coalesce(b.permission, a.permission) as permission,
    b.item as before_permission,
    a.item as after_permission,
    b.full_permissions as before_permissions
  from before_rows b
  full join after_rows a
    on a.subject_kind = b.subject_kind
   and a.subject_id = b.subject_id
   and a.company_id is not distinct from b.company_id
   and a.permission = b.permission
  where b.item is distinct from a.item
)
insert into private.lead_assignment_permission_migration_diffs (
  migration_key,
  subject_kind,
  subject_id,
  company_id,
  permission,
  before_permission,
  after_permission,
  classification,
  reason
)
select
  '20260715161000',
  c.subject_kind,
  c.subject_id,
  c.company_id,
  c.permission,
  c.before_permission,
  c.after_permission,
  case
    when c.before_permission is null
      and c.permission in (
        'pipeline.create',
        'pipeline.edit',
        'pipeline.assign',
        'pipeline.convert'
      )
      and exists (
        select 1
          from jsonb_array_elements(c.before_permissions) legacy
         where legacy ->> 'permission' = 'pipeline.manage'
           and (
             (
               c.subject_kind = 'role'
               and legacy ->> 'scope' = 'all'
             )
             or (
               c.subject_kind = 'user_override'
               and (
                 (
                   (c.after_permission ->> 'granted')::boolean
                   and (legacy ->> 'granted')::boolean
                   and legacy ->> 'scope' = 'all'
                 )
                 or (
                   not (c.after_permission ->> 'granted')::boolean
                   and not (legacy ->> 'granted')::boolean
                 )
               )
             )
           )
      )
      then 'equivalent_compatibility_expansion'
    when c.before_permission is null
      and c.permission = 'inbox.view'
      and exists (
        select 1
          from jsonb_array_elements(c.before_permissions) legacy
         where legacy ->> 'permission' = 'inbox.view_company'
           and legacy ->> 'scope' = 'all'
           and (
             c.subject_kind = 'role'
             or (
               c.subject_kind = 'user_override'
               and (legacy ->> 'granted')::boolean
             )
           )
      )
      then 'equivalent'
    else 'unclassified'
  end,
  case
    when c.permission like 'pipeline.%'
      then 'Legacy pipeline.manage remains authoritative during compatibility and gains an equivalent granular row.'
    when c.permission = 'inbox.view'
      then 'Legacy inbox.view_company remains and gains its equivalent granular view row.'
    else 'No reviewed mapping matched this change.'
  end
from changes c;

insert into private.lead_assignment_permission_migration_diffs (
  migration_key,
  subject_kind,
  subject_id,
  company_id,
  permission,
  before_permission,
  after_permission,
  classification,
  reason
)
select
  '20260715161000',
  'role',
  before_snapshot.subject_id,
  before_snapshot.company_id,
  'inbox.view',
  before_item.item,
  after_item.item,
  'deferred_operator_activation',
  'Operator inbox permission is retained byte-for-byte; lead activation belongs only to 181000.'
from private.lead_assignment_permission_migration_snapshots before_snapshot
join private.lead_assignment_permission_migration_snapshots after_snapshot
  on after_snapshot.migration_key = before_snapshot.migration_key
 and after_snapshot.phase = 'after'
 and after_snapshot.subject_kind = before_snapshot.subject_kind
 and after_snapshot.subject_id = before_snapshot.subject_id
 and after_snapshot.company_id is not distinct from before_snapshot.company_id
cross join lateral (
  select before_element.item
  from jsonb_array_elements(before_snapshot.permissions)
    as before_element(item)
  where before_element.item ->> 'permission' = 'inbox.view'
) before_item
cross join lateral (
  select after_element.item
  from jsonb_array_elements(after_snapshot.permissions)
    as after_element(item)
  where after_element.item ->> 'permission' = 'inbox.view'
) after_item
where before_snapshot.migration_key = '20260715161000'
  and before_snapshot.phase = 'before'
  and before_snapshot.subject_kind = 'role'
  and before_snapshot.subject_id = '00000000-0000-0000-0000-000000000004'::uuid;

do $migration_assertions$
declare
  v_operator_before jsonb;
  v_operator_after jsonb;
begin
  if exists (
    select 1
      from private.lead_assignment_permission_migration_diffs d
     where d.migration_key = '20260715161000'
       and d.classification not in (
         'equivalent',
         'equivalent_compatibility_expansion',
         'deferred_operator_activation'
       )
  ) then
    raise exception 'permission_migration_unclassified_or_widened_row'
      using errcode = '55000';
  end if;

  -- Assert expected legacy rows remain byte-for-byte in the after snapshot.
  if exists (
    select 1
      from private.lead_assignment_permission_migration_snapshots b
      join private.lead_assignment_permission_migration_snapshots a
        on a.migration_key = b.migration_key
       and a.phase = 'after'
       and a.subject_kind = b.subject_kind
       and a.subject_id = b.subject_id
       and a.company_id is not distinct from b.company_id
      cross join lateral jsonb_array_elements(b.permissions) legacy(item)
     where b.migration_key = '20260715161000'
       and b.phase = 'before'
       and legacy.item ->> 'permission' in (
         'pipeline.manage',
         'pipeline.view',
         'inbox.view_company',
         'inbox.send'
       )
       and not (a.permissions @> jsonb_build_array(legacy.item))
  ) then
    raise exception 'expected legacy rows remain assertion failed'
      using errcode = '55000';
  end if;

  if exists (
    select 1
      from public.role_permissions rp
     where rp.role_id = '00000000-0000-0000-0000-000000000004'::uuid
       and rp.permission in (
         'pipeline.create',
         'pipeline.view',
         'pipeline.edit',
         'pipeline.assign',
         'pipeline.convert'
       )
  ) then
    raise exception 'operator_pipeline_activation_forbidden'
      using errcode = '55000';
  end if;

  select coalesce(jsonb_agg(item order by item ->> 'permission'), '[]'::jsonb)
    into v_operator_before
    from private.lead_assignment_permission_migration_snapshots s
    cross join lateral jsonb_array_elements(s.permissions) item
   where s.migration_key = '20260715161000'
     and s.phase = 'before'
     and s.subject_kind = 'role'
     and s.subject_id = '00000000-0000-0000-0000-000000000004'::uuid
     and item ->> 'permission' like 'inbox.%';

  select coalesce(jsonb_agg(item order by item ->> 'permission'), '[]'::jsonb)
    into v_operator_after
    from private.lead_assignment_permission_migration_snapshots s
    cross join lateral jsonb_array_elements(s.permissions) item
   where s.migration_key = '20260715161000'
     and s.phase = 'after'
     and s.subject_kind = 'role'
     and s.subject_id = '00000000-0000-0000-0000-000000000004'::uuid
     and item ->> 'permission' like 'inbox.%';

  if v_operator_before is distinct from v_operator_after then
    raise exception 'operator inbox byte-for-byte unchanged assertion failed'
      using errcode = '55000';
  end if;

  if exists (
    select 1
      from private.lead_assignment_permission_migration_snapshots s
     where s.migration_key = '20260715161000'
       and (s.snapshot_hash is null or s.row_count < 0)
  )
    or not exists (
      select 1
        from private.lead_assignment_permission_migration_snapshots s
       where s.migration_key = '20260715161000'
         and s.phase = 'before'
         and s.subject_kind = 'role'
    )
    or not exists (
      select 1
        from private.lead_assignment_permission_migration_snapshots s
       where s.migration_key = '20260715161000'
         and s.phase = 'after'
         and s.subject_kind = 'role'
    )
  then
    raise exception 'permission_migration_snapshot_or_hash_missing'
      using errcode = '55000';
  end if;
end;
$migration_assertions$;

-- Canonical snapshots and payload validation --------------------------------

create or replace function private.canonical_role_permission_snapshot(
  p_role_id uuid
) returns jsonb
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
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
  from public.role_permissions rp
  where rp.role_id = p_role_id;
$function$;

-- Every supported assignment/create path and every supported permission
-- mutation takes this transaction-scoped company lock before any user or
-- opportunity row lock. One canonical ordering prevents a permission change
-- from racing an assignment against a statement snapshot that predates the
-- permission commit.
create or replace function private.lock_lead_assignment_company(
  p_company_id uuid
) returns void
language plpgsql
volatile security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
begin
  if p_company_id is null then
    raise exception 'lead_assignment_company_lock_required'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'lead-assignment-company:' || p_company_id::text,
      161000
    )
  );
end;
$function$;

-- Deferred direct-write guards ------------------------------------------------

create or replace function private.assert_direct_permission_user(
  p_user_id uuid
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_company_id uuid;
begin
  select u.company_id
    into v_company_id
    from public.users u
   where u.id = p_user_id
     and u.company_id is not null
     and u.deleted_at is null
     and coalesce(u.is_active, false);

  if not found then
    return;
  end if;

  perform private.lock_lead_assignment_company(v_company_id);

  if exists (
    select 1
      from public.user_permission_overrides upo
     where upo.user_id = p_user_id
       and upo.company_id is distinct from v_company_id
  ) then
    raise exception 'direct_permission_write_invalid: stale_company_override'
      using errcode = '23514';
  end if;

  begin
    perform private.assert_permission_users_valid(array[p_user_id]);
  exception
    when sqlstate '22023' then
      raise exception using
        errcode = '23514',
        message = 'direct_permission_write_invalid',
        detail = sqlerrm;
  end;

  if exists (
    select 1
      from private.stranded_permission_assignments(
        v_company_id,
        array[p_user_id]
      )
  ) then
    raise exception 'permission_change_would_strand_assignments'
      using errcode = '23514';
  end if;
end;
$function$;

create or replace function private.guard_role_permissions_final_state()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_role_id uuid;
  v_user_id uuid;
  v_role_ids uuid[] := array_remove(array[
    case when tg_op in ('UPDATE', 'DELETE') then old.role_id else null end,
    case when tg_op in ('INSERT', 'UPDATE') then new.role_id else null end
  ], null);
begin
  foreach v_role_id in array v_role_ids
  loop
    if exists (
      select 1
        from public.roles r
        join public.user_roles ur on ur.role_id = r.id
        join public.users u on u.id::text = ur.user_id
       where r.id = v_role_id
         and not r.is_preset
         and r.company_id is distinct from u.company_id
    ) then
      raise exception 'direct_permission_write_invalid: cross-company role member'
        using errcode = '23514';
    end if;

    begin
      perform private.assert_permission_role_valid(v_role_id);
    exception
      when sqlstate '22023' then
        raise exception using
          errcode = '23514',
          message = 'direct_permission_write_invalid',
          detail = sqlerrm;
    end;

    for v_user_id in
      select u.id
        from public.user_roles ur
        join public.users u on u.id::text = ur.user_id
       where ur.role_id = v_role_id
         and u.deleted_at is null
         and coalesce(u.is_active, false)
       order by u.id
    loop
      perform private.assert_direct_permission_user(v_user_id);
    end loop;
  end loop;

  return null;
end;
$function$;

create or replace function private.guard_user_overrides_final_state()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_user_id uuid;
  v_user_ids uuid[] := array_remove(array[
    case when tg_op in ('UPDATE', 'DELETE') then old.user_id else null end,
    case when tg_op in ('INSERT', 'UPDATE') then new.user_id else null end
  ], null);
begin
  foreach v_user_id in array v_user_ids
  loop
    if exists (
      select 1
        from public.users u
       where u.id = v_user_id
         and private.permission_user_is_admin(u.id, u.company_id)
    ) then
      raise exception 'target_is_admin'
        using errcode = '42501';
    end if;
    perform private.assert_direct_permission_user(v_user_id);
  end loop;
  return null;
end;
$function$;

create or replace function private.guard_user_roles_final_state()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_user_id uuid;
  v_new_user_id uuid;
  v_user_ids uuid[] := array_remove(array[
    case
      when tg_op in ('UPDATE', 'DELETE')
        then private.permission_try_parse_uuid(old.user_id)
      else null
    end,
    case
      when tg_op in ('INSERT', 'UPDATE')
        then private.permission_try_parse_uuid(new.user_id)
      else null
    end
  ], null);
begin
  if tg_op in ('INSERT', 'UPDATE')
    and private.permission_try_parse_uuid(new.user_id) is null
  then
    raise exception 'direct_permission_write_invalid: user_roles user_id'
      using errcode = '23514';
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    v_new_user_id := private.permission_try_parse_uuid(new.user_id);

    if not exists (
      select 1
        from public.users u
        join public.roles r on r.id = new.role_id
       where u.id = v_new_user_id
         and u.deleted_at is null
         and coalesce(u.is_active, false)
         and (
           (r.is_preset and r.company_id is null)
           or (not r.is_preset and r.company_id = u.company_id)
         )
    ) then
      raise exception 'direct_permission_write_invalid: role assignment'
        using errcode = '23514';
    end if;
  end if;

  foreach v_user_id in array v_user_ids
  loop
    if exists (
      select 1
        from public.users u
       where u.id = v_user_id
         and private.permission_user_is_admin(u.id, u.company_id)
    ) then
      raise exception 'target_is_admin'
        using errcode = '42501';
    end if;
    perform private.assert_direct_permission_user(v_user_id);
  end loop;
  return null;
end;
$function$;

drop trigger if exists trg_role_permissions_final_state
  on public.role_permissions;
create constraint trigger trg_role_permissions_final_state
after insert or update or delete on public.role_permissions
deferrable initially deferred
for each row execute function private.guard_role_permissions_final_state();

drop trigger if exists trg_user_permission_overrides_final_state
  on public.user_permission_overrides;
create constraint trigger trg_user_permission_overrides_final_state
after insert or update or delete on public.user_permission_overrides
deferrable initially deferred
for each row execute function private.guard_user_overrides_final_state();

drop trigger if exists trg_user_roles_final_state
  on public.user_roles;
create constraint trigger trg_user_roles_final_state
after insert or update or delete on public.user_roles
deferrable initially deferred
for each row execute function private.guard_user_roles_final_state();

-- Company-serialized guarded assignment/create facades ----------------------
--
-- Move the reviewed 160000 implementations behind private, fully-revoked
-- names, then restore their exact public signatures as small serialization
-- facades. Supported callers now acquire the same company lock as permission
-- mutation before any user/opportunity row lock. The original implementations
-- retain every validation, event, delivery, and optimistic-version contract.

alter function public.change_opportunity_assignment(
  uuid, bigint, uuid, uuid, text, uuid, jsonb
) set schema private;
alter function private.change_opportunity_assignment(
  uuid, bigint, uuid, uuid, text, uuid, jsonb
) rename to change_assignment_company_serialized_internal;
revoke all on function private.change_assignment_company_serialized_internal(
  uuid, bigint, uuid, uuid, text, uuid, jsonb
) from public, anon, authenticated, service_role;

alter function public.change_opportunity_assignment_as_system(
  uuid, bigint, uuid, uuid, text, uuid, uuid, jsonb
) set schema private;
alter function private.change_opportunity_assignment_as_system(
  uuid, bigint, uuid, uuid, text, uuid, uuid, jsonb
) rename to change_assignment_system_company_serialized_internal;
revoke all on function private.change_assignment_system_company_serialized_internal(
  uuid, bigint, uuid, uuid, text, uuid, uuid, jsonb
) from public, anon, authenticated, service_role;

alter function public.create_opportunity_guarded(jsonb, text, uuid, jsonb)
  set schema private;
alter function private.create_opportunity_guarded(jsonb, text, uuid, jsonb)
  rename to create_opportunity_company_serialized_internal;
revoke all on function private.create_opportunity_company_serialized_internal(
  jsonb, text, uuid, jsonb
) from public, anon, authenticated, service_role;

create or replace function public.change_opportunity_assignment(
  p_opportunity_id uuid,
  p_expected_assignment_version bigint,
  p_expected_assigned_to uuid,
  p_new_assigned_to uuid,
  p_source text,
  p_suggestion_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_actor_user_id uuid := private.get_current_user_id();
  v_actor_company_id uuid := private.get_user_company_id();
begin
  if v_actor_user_id is null or v_actor_company_id is null then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  perform private.lock_lead_assignment_company(v_actor_company_id);

  -- Freeze the actor's company/active state after the company boundary. The
  -- internal implementation repeats the check and retains its error contract.
  perform 1
    from public.users u
   where u.id = v_actor_user_id
     and u.company_id = v_actor_company_id
     and u.deleted_at is null
     and coalesce(u.is_active, false)
   for share;
  if not found then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  return private.change_assignment_company_serialized_internal(
    p_opportunity_id => p_opportunity_id,
    p_expected_assignment_version => p_expected_assignment_version,
    p_expected_assigned_to => p_expected_assigned_to,
    p_new_assigned_to => p_new_assigned_to,
    p_source => p_source,
    p_suggestion_id => p_suggestion_id,
    p_metadata => p_metadata
  );
end;
$function$;

revoke all on function public.change_opportunity_assignment(
  uuid, bigint, uuid, uuid, text, uuid, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.change_opportunity_assignment(
  uuid, bigint, uuid, uuid, text, uuid, jsonb
) to authenticated;

create or replace function public.change_opportunity_assignment_as_system(
  p_opportunity_id uuid,
  p_expected_assignment_version bigint,
  p_expected_assigned_to uuid,
  p_new_assigned_to uuid,
  p_system_source text,
  p_actor_user_id uuid default null,
  p_suggestion_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_company_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  select o.company_id
    into v_company_id
    from public.opportunities o
   where o.id = p_opportunity_id
     and o.deleted_at is null;
  if not found then
    raise exception 'opportunity_not_found'
      using errcode = 'P0002';
  end if;

  perform private.lock_lead_assignment_company(v_company_id);

  -- Freeze the company identity after taking its boundary. If a concurrent
  -- company move won before the lock, fail closed and require a fresh call.
  perform 1
    from public.opportunities o
   where o.id = p_opportunity_id
     and o.company_id = v_company_id
     and o.deleted_at is null
   for key share;
  if not found then
    raise exception 'opportunity_company_changed'
      using errcode = '40001';
  end if;

  return private.change_assignment_system_company_serialized_internal(
    p_opportunity_id => p_opportunity_id,
    p_expected_assignment_version => p_expected_assignment_version,
    p_expected_assigned_to => p_expected_assigned_to,
    p_new_assigned_to => p_new_assigned_to,
    p_system_source => p_system_source,
    p_actor_user_id => p_actor_user_id,
    p_suggestion_id => p_suggestion_id,
    p_metadata => p_metadata
  );
end;
$function$;

revoke all on function public.change_opportunity_assignment_as_system(
  uuid, bigint, uuid, uuid, text, uuid, uuid, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.change_opportunity_assignment_as_system(
  uuid, bigint, uuid, uuid, text, uuid, uuid, jsonb
) to service_role;

create or replace function public.create_opportunity_guarded(
  p_opportunity jsonb,
  p_assignment_mode text default 'self',
  p_initial_assigned_to uuid default null,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_actor_user_id uuid := private.get_current_user_id();
  v_company_id uuid := private.get_user_company_id();
begin
  if v_actor_user_id is null or v_company_id is null then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  perform private.lock_lead_assignment_company(v_company_id);

  perform 1
    from public.users u
   where u.id = v_actor_user_id
     and u.company_id = v_company_id
     and u.deleted_at is null
     and coalesce(u.is_active, false)
   for share;
  if not found then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  return private.create_opportunity_company_serialized_internal(
    p_opportunity => p_opportunity,
    p_assignment_mode => p_assignment_mode,
    p_initial_assigned_to => p_initial_assigned_to,
    p_metadata => p_metadata
  );
end;
$function$;

revoke all on function public.create_opportunity_guarded(
  jsonb, text, uuid, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_opportunity_guarded(
  jsonb, text, uuid, jsonb
) to authenticated;

-- Public service-only RPCs ---------------------------------------------------

create or replace function public.replace_role_permissions_as_system(
  p_actor_user_id uuid,
  p_role_id uuid,
  p_expected_permissions jsonb,
  p_new_permissions jsonb,
  p_assignment_resolutions jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_actor_company_id uuid;
  v_role record;
  v_current_permissions jsonb;
  v_affected_user_ids uuid[] := array[]::uuid[];
  v_resolved_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  select u.company_id
    into v_actor_company_id
    from public.users u
   where u.id = p_actor_user_id
     and u.company_id is not null
     and u.deleted_at is null
     and coalesce(u.is_active, false);
  if not found then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  perform private.lock_lead_assignment_company(v_actor_company_id);

  perform 1
    from public.users u
   where u.id = p_actor_user_id
     and u.company_id = v_actor_company_id
     and u.deleted_at is null
     and coalesce(u.is_active, false)
     and not exists (
       select 1
         from public.user_roles ur
         join public.roles r on r.id = ur.role_id
        where ur.user_id = u.id::text
          and not (
            (r.is_preset and r.company_id is null)
            or (not r.is_preset and r.company_id = u.company_id)
          )
     )
   for share;
  if not found
    or not public.has_permission(
      p_actor_user_id,
      'team.assign_roles',
      'all'
    )
  then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  select r.*
    into v_role
    from public.roles r
   where r.id = p_role_id
   for update;
  if not found then
    raise exception 'role_not_found'
      using errcode = 'P0002';
  end if;
  if v_role.is_preset then
    raise exception 'preset_role_immutable'
      using errcode = '42501';
  end if;
  if v_role.company_id is distinct from v_actor_company_id then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  perform 1
    from public.role_permissions rp
   where rp.role_id = p_role_id
   order by rp.permission
   for update;

  select coalesce(array_agg(u.id order by u.id), array[]::uuid[])
    into v_affected_user_ids
    from public.user_roles ur
    join public.users u on u.id::text = ur.user_id
   where ur.role_id = p_role_id
     and u.deleted_at is null
     and coalesce(u.is_active, false);

  if exists (
    select 1
      from public.users u
     where u.id = any(v_affected_user_ids)
       and u.company_id is distinct from v_actor_company_id
  ) then
    raise exception 'cross_company_role_membership'
      using errcode = '42501';
  end if;

  perform 1
    from public.users u
   where u.id = any(v_affected_user_ids)
   order by u.id
   for update;

  perform private.assert_canonical_role_permission_payload(
    p_expected_permissions,
    false,
    false
  );
  v_current_permissions := private.canonical_role_permission_snapshot(p_role_id);
  if v_current_permissions is distinct from p_expected_permissions then
    raise exception using
      errcode = '40001',
      message = 'permission_snapshot_mismatch',
      detail = jsonb_build_object(
        'expected_permissions', p_expected_permissions,
        'current_permissions', v_current_permissions
      )::text;
  end if;

  perform private.assert_canonical_role_permission_payload(
    p_new_permissions,
    true,
    true
  );

  delete from public.role_permissions rp
  using jsonb_array_elements(p_new_permissions) entry
  where rp.role_id = p_role_id
    and rp.permission = entry ->> 'permission'
    and jsonb_typeof(entry -> 'scope') = 'null';

  insert into public.role_permissions (role_id, permission, scope)
  select p_role_id, entry ->> 'permission', entry ->> 'scope'
    from jsonb_array_elements(p_new_permissions) entry
   where jsonb_typeof(entry -> 'scope') = 'string'
  on conflict (role_id, permission) do update
    set scope = excluded.scope;

  perform private.assert_permission_role_valid(p_role_id);
  perform private.assert_permission_users_valid(v_affected_user_ids);
  v_resolved_count := private.enforce_permission_assignment_resolutions(
    p_actor_user_id,
    v_actor_company_id,
    v_affected_user_ids,
    p_assignment_resolutions,
    'role_permissions',
    p_role_id
  );
  perform private.assert_permission_role_valid(p_role_id);
  perform private.assert_permission_users_valid(v_affected_user_ids);

  return jsonb_build_object(
    'ok', true,
    'role_id', p_role_id,
    'permissions', private.canonical_role_permission_snapshot(p_role_id),
    'resolved_assignments', v_resolved_count
  );
end;
$function$;

create or replace function public.apply_user_permission_overrides_as_system(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_expected_overrides jsonb,
  p_set jsonb,
  p_clear text[],
  p_assignment_resolutions jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_actor_company_id uuid;
  v_target_company_id uuid;
  v_current_overrides jsonb;
  v_resolved_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  select u.company_id
    into v_actor_company_id
    from public.users u
   where u.id = p_actor_user_id
     and u.company_id is not null
     and u.deleted_at is null
     and coalesce(u.is_active, false);
  if not found then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  perform private.lock_lead_assignment_company(v_actor_company_id);

  perform 1
    from public.users u
   where u.id = p_actor_user_id
     and u.company_id = v_actor_company_id
     and u.deleted_at is null
     and coalesce(u.is_active, false)
     and not exists (
       select 1
         from public.user_roles ur
         join public.roles r on r.id = ur.role_id
        where ur.user_id = u.id::text
          and not (
            (r.is_preset and r.company_id is null)
            or (not r.is_preset and r.company_id = u.company_id)
          )
     )
   for share;
  if not found
    or not public.has_permission(
      p_actor_user_id,
      'team.assign_roles',
      'all'
    )
  then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  select u.company_id
    into v_target_company_id
    from public.users u
   where u.id = p_target_user_id
     and u.company_id is not null
     and u.deleted_at is null
     and coalesce(u.is_active, false)
   for update;
  if not found then
    raise exception 'target_user_not_found'
      using errcode = 'P0002';
  end if;
  if v_target_company_id is distinct from v_actor_company_id then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;
  if private.permission_user_is_admin(
    p_target_user_id,
    v_target_company_id
  ) then
    raise exception 'target_is_admin'
      using errcode = '42501';
  end if;

  perform 1
    from public.user_permission_overrides upo
   where upo.user_id = p_target_user_id
   order by upo.permission
   for update;

  if exists (
    select 1
      from public.user_permission_overrides upo
     where upo.user_id = p_target_user_id
       and upo.company_id is distinct from v_target_company_id
  ) then
    raise exception 'stale_company_override'
      using errcode = '22023';
  end if;

  perform private.assert_canonical_override_payload(
    p_expected_overrides,
    false
  );
  v_current_overrides := private.canonical_user_override_snapshot(
    p_target_user_id
  );
  if v_current_overrides is distinct from p_expected_overrides then
    raise exception using
      errcode = '40001',
      message = 'permission_snapshot_mismatch',
      detail = jsonb_build_object(
        'expected_overrides', p_expected_overrides,
        'current_overrides', v_current_overrides
      )::text;
  end if;

  perform private.assert_canonical_override_payload(p_set, true);
  if p_clear is null
    or exists (select 1 from unnest(p_clear) permission where permission is null)
    or (
      select count(*) from unnest(p_clear)
    ) <> (
      select count(distinct permission) from unnest(p_clear) permission
    )
    or exists (
      select 1
        from unnest(p_clear) permission
        left join private.lead_permission_editor_registry registry
          on registry.permission = permission
       where registry.permission is null
    )
    or exists (
      select 1
        from jsonb_array_elements(p_set) entry
       where entry ->> 'permission' = any(p_clear)
    )
  then
    raise exception 'invalid_override_set_clear'
      using errcode = '22023';
  end if;

  delete from public.user_permission_overrides upo
   where upo.user_id = p_target_user_id
     and upo.permission = any(p_clear);

  insert into public.user_permission_overrides (
    user_id,
    company_id,
    permission,
    scope,
    granted
  )
  select
    p_target_user_id,
    v_target_company_id,
    entry ->> 'permission',
    case
      when jsonb_typeof(entry -> 'scope') = 'null' then null
      else entry ->> 'scope'
    end,
    (entry ->> 'granted')::boolean
  from jsonb_array_elements(p_set) entry
  on conflict (user_id, permission) do update
    set company_id = excluded.company_id,
        scope = excluded.scope,
        granted = excluded.granted,
        updated_at = now();

  perform private.assert_permission_users_valid(array[p_target_user_id]);
  v_resolved_count := private.enforce_permission_assignment_resolutions(
    p_actor_user_id,
    v_target_company_id,
    array[p_target_user_id],
    p_assignment_resolutions,
    'user_overrides',
    p_target_user_id
  );
  perform private.assert_permission_users_valid(array[p_target_user_id]);

  return jsonb_build_object(
    'ok', true,
    'user_id', p_target_user_id,
    'overrides', private.canonical_user_override_snapshot(p_target_user_id),
    'resolved_assignments', v_resolved_count
  );
end;
$function$;

create or replace function public.replace_user_role_as_system(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_expected_role_id uuid,
  p_new_role_id uuid,
  p_assignment_resolutions jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_actor_company_id uuid;
  v_target_company_id uuid;
  v_current_role_id uuid;
  v_new_role record;
  v_legacy_role text := 'unassigned';
  v_resolved_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  select u.company_id
    into v_actor_company_id
    from public.users u
   where u.id = p_actor_user_id
     and u.company_id is not null
     and u.deleted_at is null
     and coalesce(u.is_active, false);
  if not found then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  perform private.lock_lead_assignment_company(v_actor_company_id);

  perform 1
    from public.users u
   where u.id = p_actor_user_id
     and u.company_id = v_actor_company_id
     and u.deleted_at is null
     and coalesce(u.is_active, false)
     and not exists (
       select 1
         from public.user_roles ur
         join public.roles r on r.id = ur.role_id
        where ur.user_id = u.id::text
          and not (
            (r.is_preset and r.company_id is null)
            or (not r.is_preset and r.company_id = u.company_id)
          )
     )
   for share;
  if not found
    or not public.has_permission(
      p_actor_user_id,
      'team.assign_roles',
      'all'
    )
  then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  select u.company_id
    into v_target_company_id
    from public.users u
   where u.id = p_target_user_id
     and u.company_id is not null
     and u.deleted_at is null
     and coalesce(u.is_active, false)
   for update;
  if not found then
    raise exception 'target_user_not_found'
      using errcode = 'P0002';
  end if;
  if v_target_company_id is distinct from v_actor_company_id then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;
  if private.permission_user_is_admin(
    p_target_user_id,
    v_target_company_id
  ) then
    raise exception 'target_is_admin'
      using errcode = '42501';
  end if;

  select ur.role_id
    into v_current_role_id
    from public.user_roles ur
   where ur.user_id = p_target_user_id::text
   for update;

  if v_current_role_id is not distinct from p_expected_role_id then
    null;
  else
    raise exception using
      errcode = '40001',
      message = 'permission_snapshot_mismatch',
      detail = jsonb_build_object(
        'expected_role_id', p_expected_role_id,
        'current_role_id', v_current_role_id
      )::text;
  end if;

  if p_new_role_id is not null then
    select r.*
      into v_new_role
      from public.roles r
     where r.id = p_new_role_id
     for share;
    if not found then
      raise exception 'role_not_found'
        using errcode = 'P0002';
    end if;
    if not v_new_role.is_preset
      and v_new_role.company_id is distinct from v_target_company_id
    then
      raise exception 'cross_company_role_forbidden'
        using errcode = '42501';
    end if;
    if v_new_role.is_preset and v_new_role.company_id is not null then
      raise exception 'invalid_preset_role_shape'
        using errcode = '22023';
    end if;

    insert into public.user_roles (user_id, role_id)
    values (p_target_user_id::text, p_new_role_id)
    on conflict (user_id) do update
      set role_id = excluded.role_id;

    v_legacy_role := case
      when lower(v_new_role.name) in (
        'admin', 'owner', 'office', 'operator', 'crew', 'unassigned'
      ) then lower(v_new_role.name)
      else 'unassigned'
    end;
  else
    delete from public.user_roles ur
     where ur.user_id = p_target_user_id::text;
  end if;

  update public.users
     set role = v_legacy_role,
         updated_at = now()
   where id = p_target_user_id;

  perform private.assert_permission_users_valid(array[p_target_user_id]);
  v_resolved_count := private.enforce_permission_assignment_resolutions(
    p_actor_user_id,
    v_target_company_id,
    array[p_target_user_id],
    p_assignment_resolutions,
    'user_role',
    p_target_user_id
  );
  perform private.assert_permission_users_valid(array[p_target_user_id]);

  return jsonb_build_object(
    'ok', true,
    'user_id', p_target_user_id,
    'role_id', p_new_role_id,
    'legacy_role', v_legacy_role,
    'resolved_assignments', v_resolved_count
  );
end;
$function$;

create or replace function private.canonical_user_override_snapshot(
  p_user_id uuid
) returns jsonb
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'permission', upo.permission,
        'scope', upo.scope,
        'granted', upo.granted
      )
      order by upo.permission, upo.scope nulls first, upo.granted
    ),
    '[]'::jsonb
  )
  from public.user_permission_overrides upo
  where upo.user_id = p_user_id;
$function$;

create or replace function private.assert_canonical_role_permission_payload(
  p_payload jsonb,
  p_require_registry_complete boolean,
  p_allow_null_scope boolean
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_canonical jsonb;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'array' then
    raise exception 'invalid_permission_payload'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_payload) entry
     where jsonb_typeof(entry) <> 'object'
        or not (entry ?& array['permission', 'scope'])
        or (select count(*) from jsonb_object_keys(entry)) <> 2
        or jsonb_typeof(entry -> 'permission') <> 'string'
        or nullif(entry ->> 'permission', '') is null
        or (
          jsonb_typeof(entry -> 'scope') <> 'string'
          and not (
            p_allow_null_scope
            and jsonb_typeof(entry -> 'scope') = 'null'
          )
        )
  ) then
    raise exception 'invalid_permission_payload'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_payload) entry
     group by entry ->> 'permission'
    having count(*) > 1
  ) then
    raise exception 'duplicate_permission'
      using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(entry order by entry ->> 'permission'), '[]'::jsonb)
    into v_canonical
    from jsonb_array_elements(p_payload) entry;

  if p_payload is distinct from v_canonical then
    raise exception 'permission_payload_not_canonical'
      using errcode = '22023';
  end if;

  if p_require_registry_complete then
    if jsonb_array_length(p_payload) <> (
      select count(*) from private.lead_permission_editor_registry
    )
      or exists (
        select 1
          from jsonb_array_elements(p_payload) entry
          left join private.lead_permission_editor_registry registry
            on registry.permission = entry ->> 'permission'
         where registry.permission is null
            or (
              jsonb_typeof(entry -> 'scope') <> 'null'
              and not ((entry ->> 'scope') = any(registry.scopes))
            )
      )
      or exists (
        select 1
          from private.lead_permission_editor_registry registry
         where not exists (
           select 1
             from jsonb_array_elements(p_payload) entry
            where entry ->> 'permission' = registry.permission
         )
      )
    then
      raise exception 'unsupported_scope_or_unregistered_permission'
        using errcode = '22023';
    end if;
  end if;
end;
$function$;

create or replace function private.assert_canonical_override_payload(
  p_payload jsonb,
  p_require_registered boolean
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_canonical jsonb;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'array' then
    raise exception 'invalid_override_payload'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_payload) entry
     where jsonb_typeof(entry) <> 'object'
        or not (entry ?& array['permission', 'scope', 'granted'])
        or (select count(*) from jsonb_object_keys(entry)) <> 3
        or jsonb_typeof(entry -> 'permission') <> 'string'
        or nullif(entry ->> 'permission', '') is null
        or jsonb_typeof(entry -> 'scope') not in ('string', 'null')
        or jsonb_typeof(entry -> 'granted') <> 'boolean'
        or (
          p_require_registered
          and
          not (entry ->> 'granted')::boolean
          and jsonb_typeof(entry -> 'scope') <> 'null'
        )
  ) then
    raise exception 'invalid_override_payload'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_payload) entry
     group by entry ->> 'permission'
    having count(*) > 1
  ) then
    raise exception 'duplicate_permission'
      using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(entry order by entry ->> 'permission'), '[]'::jsonb)
    into v_canonical
    from jsonb_array_elements(p_payload) entry;

  if p_payload is distinct from v_canonical then
    raise exception 'override_payload_not_canonical'
      using errcode = '22023';
  end if;

  if p_require_registered and exists (
    select 1
      from jsonb_array_elements(p_payload) entry
      left join private.lead_permission_editor_registry registry
        on registry.permission = entry ->> 'permission'
     where registry.permission is null
        or (
          jsonb_typeof(entry -> 'scope') = 'string'
          and not ((entry ->> 'scope') = any(registry.scopes))
        )
  ) then
    raise exception 'unsupported_scope_or_unregistered_permission'
      using errcode = '22023';
  end if;
end;
$function$;

create or replace function private.permission_try_parse_uuid(p_value text)
returns uuid
language plpgsql
immutable
set search_path to 'pg_catalog', 'pg_temp'
as $function$
begin
  return p_value::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$function$;

-- Raw final-state permission evaluation -------------------------------------

create or replace function private.permission_scope_rank(p_scope text)
returns integer
language sql
immutable
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  select case p_scope
    when 'all' then 2
    when 'assigned' then 1
    else 0
  end;
$function$;

create or replace function private.permission_user_is_admin(
  p_user_id uuid,
  p_company_id uuid
) returns boolean
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select exists (
    select 1
      from public.users u
      left join public.companies c on c.id = u.company_id
     where u.id = p_user_id
       and u.company_id = p_company_id
       and u.deleted_at is null
       and coalesce(u.is_active, false)
       and (
         coalesce(u.is_company_admin, false)
         or u.id::text = c.account_holder_id
         or u.id::text = any(coalesce(c.admin_ids, array[]::text[]))
       )
  );
$function$;

create or replace function private.raw_pipeline_scope_for_user(
  p_user_id uuid,
  p_company_id uuid,
  p_permission text
) returns text
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_override_found boolean := false;
  v_override_granted boolean;
  v_override_scope text;
  v_role_scope text;
begin
  if p_permission not in (
    'pipeline.create',
    'pipeline.view',
    'pipeline.edit',
    'pipeline.assign',
    'pipeline.convert'
  )
    or not exists (
      select 1
        from public.users u
       where u.id = p_user_id
         and u.company_id = p_company_id
         and u.deleted_at is null
         and coalesce(u.is_active, false)
    )
  then
    return null;
  end if;

  if private.permission_user_is_admin(p_user_id, p_company_id) then
    return 'all';
  end if;

  select upo.granted, upo.scope, true
    into v_override_granted, v_override_scope, v_override_found
    from public.user_permission_overrides upo
   where upo.user_id = p_user_id
     and upo.company_id = p_company_id
     and upo.permission = p_permission
   limit 1;

  if v_override_found then
    if not v_override_granted then
      return null;
    end if;
    if v_override_scope is not null then
      return v_override_scope;
    end if;
  end if;

  select rp.scope
    into v_role_scope
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
   where ur.user_id = p_user_id::text
     and rp.permission = p_permission
   limit 1;

  if found then
    return v_role_scope;
  end if;

  if private.should_use_pipeline_manage_compat(
    p_user_id,
    p_company_id,
    p_permission
  ) then
    return 'all';
  end if;

  return null;
end;
$function$;

create or replace function private.raw_pipeline_scope_for_role(
  p_role_id uuid,
  p_permission text
) returns text
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_scope text;
begin
  if p_permission not in (
    'pipeline.create',
    'pipeline.view',
    'pipeline.edit',
    'pipeline.assign',
    'pipeline.convert'
  ) then
    return null;
  end if;

  select rp.scope
    into v_scope
    from public.role_permissions rp
   where rp.role_id = p_role_id
     and rp.permission = p_permission;

  if found then
    return v_scope;
  end if;

  if exists (
    select 1
      from public.role_permissions rp
     where rp.role_id = p_role_id
       and rp.permission = 'pipeline.manage'
       and rp.scope = 'all'
  ) then
    return 'all';
  end if;

  return null;
end;
$function$;

create or replace function private.pipeline_dependency_issues(
  p_create_scope text,
  p_view_scope text,
  p_edit_scope text,
  p_assign_scope text,
  p_convert_scope text
) returns jsonb
language plpgsql
immutable
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  v_issues jsonb := '[]'::jsonb;
begin
  if p_create_scope is not null and p_create_scope <> 'all' then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'code', 'unsupported_scope',
      'permission', 'pipeline.create',
      'scope', p_create_scope
    ));
  end if;

  if p_view_scope is not null and p_view_scope not in ('all', 'assigned') then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'code', 'unsupported_scope',
      'permission', 'pipeline.view',
      'scope', p_view_scope
    ));
  end if;

  if p_edit_scope is not null and p_edit_scope not in ('all', 'assigned') then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'code', 'unsupported_scope',
      'permission', 'pipeline.edit',
      'scope', p_edit_scope
    ));
  end if;

  if p_assign_scope is not null and p_assign_scope not in ('all', 'assigned') then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'code', 'unsupported_scope',
      'permission', 'pipeline.assign',
      'scope', p_assign_scope
    ));
  end if;

  if p_convert_scope is not null and p_convert_scope not in ('all', 'assigned') then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'code', 'unsupported_scope',
      'permission', 'pipeline.convert',
      'scope', p_convert_scope
    ));
  end if;

  if p_create_scope is not null
    and private.permission_scope_rank(p_view_scope) < 1
  then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'code', 'create_requires_view',
      'permission', 'pipeline.create',
      'dependency', 'pipeline.view'
    ));
  end if;

  if p_edit_scope is not null
    and private.permission_scope_rank(p_edit_scope)
      > private.permission_scope_rank(p_view_scope)
  then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'code', 'edit_exceeds_view',
      'permission', 'pipeline.edit',
      'dependency', 'pipeline.view'
    ));
  end if;

  if p_assign_scope is not null
    and private.permission_scope_rank(p_assign_scope)
      > private.permission_scope_rank(p_edit_scope)
  then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'code', 'assign_exceeds_edit',
      'permission', 'pipeline.assign',
      'dependency', 'pipeline.edit'
    ));
  end if;

  if p_convert_scope is not null
    and private.permission_scope_rank(p_convert_scope)
      > private.permission_scope_rank(p_edit_scope)
  then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'code', 'convert_exceeds_edit',
      'permission', 'pipeline.convert',
      'dependency', 'pipeline.edit'
    ));
  end if;

  return v_issues;
end;
$function$;

create or replace function private.pipeline_dependency_issues_for_user(
  p_user_id uuid,
  p_company_id uuid
) returns jsonb
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select private.pipeline_dependency_issues(
    private.raw_pipeline_scope_for_user(p_user_id, p_company_id, 'pipeline.create'),
    private.raw_pipeline_scope_for_user(p_user_id, p_company_id, 'pipeline.view'),
    private.raw_pipeline_scope_for_user(p_user_id, p_company_id, 'pipeline.edit'),
    private.raw_pipeline_scope_for_user(p_user_id, p_company_id, 'pipeline.assign'),
    private.raw_pipeline_scope_for_user(p_user_id, p_company_id, 'pipeline.convert')
  );
$function$;

create or replace function private.pipeline_dependency_issues_for_role(
  p_role_id uuid
) returns jsonb
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select private.pipeline_dependency_issues(
    private.raw_pipeline_scope_for_role(p_role_id, 'pipeline.create'),
    private.raw_pipeline_scope_for_role(p_role_id, 'pipeline.view'),
    private.raw_pipeline_scope_for_role(p_role_id, 'pipeline.edit'),
    private.raw_pipeline_scope_for_role(p_role_id, 'pipeline.assign'),
    private.raw_pipeline_scope_for_role(p_role_id, 'pipeline.convert')
  );
$function$;

create or replace function private.assert_permission_users_valid(
  p_user_ids uuid[]
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_user record;
  v_issues jsonb;
begin
  for v_user in
    select u.id, u.company_id
      from public.users u
     where u.id = any(coalesce(p_user_ids, array[]::uuid[]))
       and u.deleted_at is null
       and coalesce(u.is_active, false)
     order by u.id
  loop
    v_issues := private.pipeline_dependency_issues_for_user(
      v_user.id,
      v_user.company_id
    );
    if v_issues <> '[]'::jsonb then
      raise exception using
        errcode = '22023',
        message = 'invalid_permission_dependencies',
        detail = jsonb_build_object(
          'user_id', v_user.id,
          'issues', v_issues
        )::text;
    end if;
  end loop;
end;
$function$;

create or replace function private.assert_permission_role_valid(
  p_role_id uuid
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_issues jsonb;
begin
  v_issues := private.pipeline_dependency_issues_for_role(p_role_id);
  if v_issues <> '[]'::jsonb then
    raise exception using
      errcode = '22023',
      message = 'invalid_permission_dependencies',
      detail = jsonb_build_object(
        'role_id', p_role_id,
        'issues', v_issues
      )::text;
  end if;
end;
$function$;

-- Target eligibility intentionally matches the guarded 160000 assignment and
-- create facades exactly. Legacy pipeline.manage compatibility can authorize
-- viewing/editing during the rollout, but it does not make an OPS identity an
-- assignment target. An explicit granular revoke remains authoritative through
-- the override-aware public.has_permission() engine.
create or replace function private.user_is_guarded_assignment_target_eligible(
  p_user_id uuid,
  p_company_id uuid
) returns boolean
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
  select exists (
    select 1
      from public.users u
     where u.id = p_user_id
       and u.company_id = p_company_id
       and u.deleted_at is null
       and coalesce(u.is_active, false)
       and public.has_permission(
         p_user_id,
         'pipeline.view',
         'assigned'
       )
  );
$function$;

create or replace function private.stranded_permission_assignments(
  p_company_id uuid,
  p_user_ids uuid[]
) returns table (
  opportunity_id uuid,
  title text,
  assigned_to uuid,
  assignment_version bigint
)
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select o.id, o.title, o.assigned_to, o.assignment_version
    from public.opportunities o
   where o.company_id = p_company_id
     and o.assigned_to = any(coalesce(p_user_ids, array[]::uuid[]))
     and o.deleted_at is null
     and o.archived_at is null
     and o.stage not in ('won', 'lost', 'discarded')
     and private.raw_pipeline_scope_for_user(
       o.assigned_to,
       o.company_id,
       'pipeline.view'
     ) is distinct from 'all'
     and private.raw_pipeline_scope_for_user(
       o.assigned_to,
       o.company_id,
       'pipeline.view'
     ) is distinct from 'assigned'
   order by o.id;
$function$;

create or replace function private.enforce_permission_assignment_resolutions(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_affected_user_ids uuid[],
  p_assignment_resolutions jsonb,
  p_mutation_kind text,
  p_subject_id uuid
) returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_resolutions jsonb := coalesce(p_assignment_resolutions, '[]'::jsonb);
  v_stranded_ids uuid[] := array[]::uuid[];
  v_stranded_count integer := 0;
  v_safe_stranded jsonb := '[]'::jsonb;
  v_eligible_assignees jsonb := '[]'::jsonb;
  v_actor_can_assign_all boolean;
  v_actor_can_view_all boolean;
  v_item jsonb;
  v_opportunity_id uuid;
  v_expected_assigned_to uuid;
  v_expected_assignment_version bigint;
  v_new_assigned_to uuid;
  v_current_found boolean;
  v_current_assigned_to uuid;
  v_current_assignment_version bigint;
  v_result jsonb;
  v_applied integer := 0;
begin
  if jsonb_typeof(v_resolutions) <> 'array' then
    raise exception 'invalid_assignment_resolutions'
      using errcode = '22023';
  end if;

  -- Lock active responsibility rows in stable order before deriving the exact
  -- stranded set. Terminal assignments remain historical and are untouched.
  perform 1
    from public.opportunities o
   where o.company_id = p_company_id
     and o.assigned_to = any(coalesce(p_affected_user_ids, array[]::uuid[]))
     and o.deleted_at is null
     and o.archived_at is null
     and o.stage not in ('won', 'lost', 'discarded')
   order by o.id
   for update;

  select
    coalesce(array_agg(s.opportunity_id order by s.opportunity_id), array[]::uuid[]),
    count(*)::integer
    into v_stranded_ids, v_stranded_count
    from private.stranded_permission_assignments(
      p_company_id,
      p_affected_user_ids
    ) s;

  v_actor_can_assign_all := private.effective_pipeline_scope_for_user(
    p_actor_user_id,
    p_company_id,
    'pipeline.assign'
  ) = 'all';
  v_actor_can_view_all := private.effective_pipeline_scope_for_user(
    p_actor_user_id,
    p_company_id,
    'pipeline.view'
  ) = 'all';

  if v_actor_can_view_all then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'opportunity_id', s.opportunity_id,
          'title', s.title,
          'assigned_to', s.assigned_to,
          'assignment_version', s.assignment_version
        )
        order by s.opportunity_id
      ),
      '[]'::jsonb
    )
      into v_safe_stranded
      from private.stranded_permission_assignments(
        p_company_id,
        p_affected_user_ids
      ) s;
  end if;

  if v_actor_can_assign_all and v_actor_can_view_all then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', u.id,
          'first_name', u.first_name,
          'last_name', u.last_name,
          'profile_image_url', u.profile_image_url,
          'user_color', u.user_color,
          'role', u.role
        )
        order by u.first_name, u.last_name, u.id
      ),
      '[]'::jsonb
    )
      into v_eligible_assignees
      from public.users u
     where u.company_id = p_company_id
       and u.deleted_at is null
       and coalesce(u.is_active, false)
       and private.user_is_guarded_assignment_target_eligible(
         u.id,
         p_company_id
       );
  end if;

  if v_stranded_count > 0 and jsonb_array_length(v_resolutions) = 0 then
    raise exception using
      errcode = '40001',
      message = 'assignment_resolution_required',
      detail = jsonb_build_object(
        'code', 'assignment_resolution_required',
        'stranded_count', v_stranded_count,
        'stranded', v_safe_stranded,
        'eligible_assignees', v_eligible_assignees
      )::text;
  end if;

  if v_stranded_count = 0 and jsonb_array_length(v_resolutions) > 0 then
    raise exception using
      errcode = '22023',
      message = 'extra_resolution',
      detail = jsonb_build_object('stranded_count', 0)::text;
  end if;

  if jsonb_array_length(v_resolutions) > 0 and not v_actor_can_assign_all then
    raise exception 'access_denied: pipeline.assign all required for responsibility resolution'
      using errcode = '42501';
  end if;

  for v_item in select value from jsonb_array_elements(v_resolutions)
  loop
    if jsonb_typeof(v_item) <> 'object'
      or not (
        v_item ?& array[
          'opportunity_id',
          'expected_assigned_to',
          'expected_assignment_version',
          'new_assigned_to'
        ]
      )
      or (select count(*) from jsonb_object_keys(v_item)) <> 4
      or jsonb_typeof(v_item -> 'opportunity_id') <> 'string'
      or jsonb_typeof(v_item -> 'expected_assigned_to') <> 'string'
      or jsonb_typeof(v_item -> 'expected_assignment_version') <> 'number'
      or jsonb_typeof(v_item -> 'new_assigned_to') not in ('string', 'null')
      or (v_item ->> 'expected_assignment_version') !~ '^[0-9]+$'
    then
      raise exception 'invalid_assignment_resolutions'
        using errcode = '22023';
    end if;

    v_opportunity_id := private.permission_try_parse_uuid(
      v_item ->> 'opportunity_id'
    );
    v_expected_assigned_to := private.permission_try_parse_uuid(
      v_item ->> 'expected_assigned_to'
    );
    v_expected_assignment_version := (
      v_item ->> 'expected_assignment_version'
    )::bigint;
    v_new_assigned_to := case
      when jsonb_typeof(v_item -> 'new_assigned_to') = 'null' then null
      else private.permission_try_parse_uuid(v_item ->> 'new_assigned_to')
    end;

    if v_opportunity_id is null
      or v_expected_assigned_to is null
      or (
        jsonb_typeof(v_item -> 'new_assigned_to') = 'string'
        and v_new_assigned_to is null
      )
    then
      raise exception 'invalid_assignment_resolutions'
        using errcode = '22023';
    end if;

    if v_new_assigned_to is not distinct from v_expected_assigned_to then
      raise exception 'no_op_resolution'
        using errcode = '22023';
    end if;
  end loop;

  if (
    select count(*)
      from jsonb_array_elements(v_resolutions)
  ) <> (
    select count(distinct private.permission_try_parse_uuid(
      entry ->> 'opportunity_id'
    ))
      from jsonb_array_elements(v_resolutions) entry
  ) then
    raise exception 'duplicate_resolution'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from unnest(v_stranded_ids) stranded_id
     where not exists (
       select 1
         from jsonb_array_elements(v_resolutions) entry
        where private.permission_try_parse_uuid(
          entry ->> 'opportunity_id'
        ) = stranded_id
     )
  ) then
    raise exception 'missing_resolution'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(v_resolutions) entry
     where not (
       private.permission_try_parse_uuid(entry ->> 'opportunity_id')
       = any(v_stranded_ids)
     )
  ) then
    raise exception 'extra_resolution'
      using errcode = '22023';
  end if;

  for v_item in
    select entry
      from jsonb_array_elements(v_resolutions) entry
     order by private.permission_try_parse_uuid(entry ->> 'opportunity_id')
  loop
    v_opportunity_id := private.permission_try_parse_uuid(
      v_item ->> 'opportunity_id'
    );
    v_expected_assigned_to := private.permission_try_parse_uuid(
      v_item ->> 'expected_assigned_to'
    );
    v_expected_assignment_version := (
      v_item ->> 'expected_assignment_version'
    )::bigint;
    v_new_assigned_to := case
      when jsonb_typeof(v_item -> 'new_assigned_to') = 'null' then null
      else private.permission_try_parse_uuid(v_item ->> 'new_assigned_to')
    end;

    select o.assigned_to, o.assignment_version
      into v_current_assigned_to, v_current_assignment_version
      from public.opportunities o
     where o.id = v_opportunity_id
       and o.company_id = p_company_id;

    v_current_found := found;

    if not v_current_found
      or v_current_assigned_to is distinct from v_expected_assigned_to
      or v_current_assignment_version is distinct from v_expected_assignment_version
    then
      raise exception using
        errcode = '40001',
        message = 'assignment_resolution_conflict',
        detail = jsonb_build_object(
          'opportunity_id', v_opportunity_id,
          'assigned_to', v_current_assigned_to,
          'assignment_version', v_current_assignment_version
        )::text;
    end if;

    if v_new_assigned_to is not null
      and not private.user_is_guarded_assignment_target_eligible(
        v_new_assigned_to,
        p_company_id
      )
    then
      raise exception 'assignment_target_ineligible'
        using errcode = '22023';
    end if;

    v_result := public.change_opportunity_assignment_as_system(
      p_opportunity_id => v_opportunity_id,
      p_expected_assignment_version => v_expected_assignment_version,
      p_expected_assigned_to => v_expected_assigned_to,
      p_new_assigned_to => v_new_assigned_to,
      p_system_source => 'permission_change',
      p_actor_user_id => p_actor_user_id,
      p_suggestion_id => null,
      p_metadata => jsonb_build_object(
        'mutation_kind', p_mutation_kind,
        'subject_id', p_subject_id,
        'disposition', case
          when v_new_assigned_to is null then 'unassign'
          else 'transfer'
        end
      )
    );

    if coalesce((v_result ->> 'conflict')::boolean, false) then
      raise exception using
        errcode = '40001',
        message = 'assignment_resolution_conflict',
        detail = jsonb_build_object(
          'opportunity_id', v_opportunity_id,
          'assigned_to', v_result -> 'assigned_to',
          'assignment_version', v_result -> 'assignment_version'
        )::text;
    end if;

    v_applied := v_applied + 1;
  end loop;

  if exists (
    select 1
      from private.stranded_permission_assignments(
        p_company_id,
        p_affected_user_ids
      )
  ) then
    raise exception 'assignment_resolution_incomplete'
      using errcode = '23514';
  end if;

  return v_applied;
end;
$function$;

-- Validate only the members whose effective lead permissions changed during
-- this migration. Operator is intentionally absent: its preset is activated
-- separately by 20260715181000 after the full dependent email and notification chain lands.
do $mapped_member_assertions$
declare
  v_role_id uuid;
  v_user_id uuid;
  v_user_ids uuid[];
  v_company_id uuid;
begin
  for v_role_id in
    select distinct d.subject_id
      from private.lead_assignment_permission_migration_diffs d
     where d.migration_key = '20260715161000'
       and d.subject_kind = 'role'
       and d.classification <> 'deferred_operator_activation'
     order by d.subject_id
  loop
    perform private.assert_permission_role_valid(v_role_id);

    select coalesce(array_agg(u.id order by u.id), array[]::uuid[])
      into v_user_ids
      from public.user_roles ur
      join public.users u on u.id::text = ur.user_id
     where ur.role_id = v_role_id
       and u.deleted_at is null
       and coalesce(u.is_active, false);

    perform private.assert_permission_users_valid(v_user_ids);

    for v_company_id in
      select distinct u.company_id
        from public.users u
       where u.id = any(v_user_ids)
         and u.company_id is not null
       order by u.company_id
    loop
      if exists (
        select 1
          from private.stranded_permission_assignments(
            v_company_id,
            v_user_ids
          )
      ) then
        raise exception 'mapped_permission_change_would_strand_assignments'
          using errcode = '55000';
      end if;
    end loop;
  end loop;

  for v_user_id in
    select distinct d.subject_id
      from private.lead_assignment_permission_migration_diffs d
     where d.migration_key = '20260715161000'
       and d.subject_kind = 'user_override'
     order by d.subject_id
  loop
    select u.company_id
      into v_company_id
      from public.users u
     where u.id = v_user_id
       and u.deleted_at is null
       and coalesce(u.is_active, false);

    if found then
      perform private.assert_permission_users_valid(array[v_user_id]);

      if exists (
        select 1
          from private.stranded_permission_assignments(
            v_company_id,
            array[v_user_id]
          )
      ) then
        raise exception 'mapped_permission_change_would_strand_assignments'
          using errcode = '55000';
      end if;
    end if;
  end loop;

end;
$mapped_member_assertions$;

-- Private helpers are never application APIs.
revoke all on function private.canonical_role_permission_snapshot(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.lock_lead_assignment_company(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.canonical_user_override_snapshot(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.assert_canonical_role_permission_payload(jsonb, boolean, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.assert_canonical_override_payload(jsonb, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.permission_try_parse_uuid(text)
  from public, anon, authenticated, service_role;
revoke all on function private.permission_scope_rank(text)
  from public, anon, authenticated, service_role;
revoke all on function private.permission_user_is_admin(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.raw_pipeline_scope_for_user(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.raw_pipeline_scope_for_role(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.pipeline_dependency_issues(text, text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.pipeline_dependency_issues_for_user(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.pipeline_dependency_issues_for_role(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.assert_permission_users_valid(uuid[])
  from public, anon, authenticated, service_role;
revoke all on function private.assert_permission_role_valid(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.user_is_guarded_assignment_target_eligible(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.stranded_permission_assignments(uuid, uuid[])
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_permission_assignment_resolutions(uuid, uuid, uuid[], jsonb, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.assert_direct_permission_user(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.guard_role_permissions_final_state()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_user_overrides_final_state()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_user_roles_final_state()
  from public, anon, authenticated, service_role;

revoke all on function public.replace_role_permissions_as_system(
  uuid, uuid, jsonb, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.replace_role_permissions_as_system(
  uuid, uuid, jsonb, jsonb, jsonb
) to service_role;

revoke all on function public.apply_user_permission_overrides_as_system(
  uuid, uuid, jsonb, jsonb, text[], jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.apply_user_permission_overrides_as_system(
  uuid, uuid, jsonb, jsonb, text[], jsonb
) to service_role;

revoke all on function public.replace_user_role_as_system(
  uuid, uuid, uuid, uuid, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.replace_user_role_as_system(
  uuid, uuid, uuid, uuid, jsonb
) to service_role;

commit;
