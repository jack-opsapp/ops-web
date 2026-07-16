-- Lead assignment foundation.
--
-- Assignment is an access-control boundary, not an ordinary opportunity
-- attribute. This migration makes every assignment transition optimistic,
-- audited, recipient-addressed, and impossible to perform with a raw table
-- update (including through a service-role client).

begin;

alter table public.opportunities
  add column if not exists assignment_version bigint not null default 0;

do $block$
declare
  v_assigned_to_attnum smallint;
begin
  select a.attnum
    into v_assigned_to_attnum
    from pg_catalog.pg_attribute a
   where a.attrelid = 'public.opportunities'::regclass
     and a.attname = 'assigned_to'
     and not a.attisdropped;

  if not exists (
    select 1
      from pg_catalog.pg_constraint c
     where c.conrelid = 'public.opportunities'::regclass
       and c.confrelid = 'public.users'::regclass
       and c.contype = 'f'
       and c.conkey = array[v_assigned_to_attnum]
       and c.confdeltype = 'r'
  ) then
    alter table public.opportunities
      add constraint opportunities_assigned_to_fkey
      foreign key (assigned_to)
      references public.users (id)
      on delete restrict;
  end if;
end;
$block$;

create index if not exists opportunities_company_assignee_active_idx
  on public.opportunities (company_id, assigned_to, created_at desc)
  where assigned_to is not null
    and deleted_at is null
    and archived_at is null;

create table public.opportunity_assignment_suggestions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  opportunity_id uuid not null references public.opportunities (id) on delete restrict,
  suggested_user_id uuid not null references public.users (id) on delete restrict,
  confidence double precision not null
    check (confidence >= 0 and confidence <= 1),
  reason text not null,
  signals jsonb not null default '{}'::jsonb,
  generator_version text not null,
  generated_at timestamptz not null default now(),
  resolution_state text not null default 'pending'
    check (resolution_state in (
      'pending', 'accepted', 'rejected', 'invalidated', 'superseded'
    )),
  resolved_at timestamptz,
  resolved_by uuid references public.users (id) on delete restrict,
  resolution_event_id uuid,
  resolution_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint opportunity_assignment_suggestions_resolution_shape check (
    (resolution_state = 'pending'
      and resolved_at is null
      and resolved_by is null
      and resolution_event_id is null)
    or
    (resolution_state <> 'pending' and resolved_at is not null)
  )
);

create unique index opportunity_assignment_suggestions_pending_user_idx
  on public.opportunity_assignment_suggestions (
    opportunity_id,
    suggested_user_id
  )
  where resolution_state = 'pending';

create index opportunity_assignment_suggestions_pending_opportunity_idx
  on public.opportunity_assignment_suggestions (
    company_id,
    opportunity_id,
    generated_at desc
  )
  where resolution_state = 'pending';

create table public.opportunity_assignment_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  opportunity_id uuid not null references public.opportunities (id) on delete restrict,
  previous_assignee_id uuid references public.users (id) on delete restrict,
  new_assignee_id uuid references public.users (id) on delete restrict,
  actor_user_id uuid references public.users (id) on delete restrict,
  source text not null check (source in (
    'manual',
    'suggestion_accept',
    'manual_create',
    'personal_mailbox',
    'deactivation',
    'permission_change',
    'admin_correction',
    'system_repair'
  )),
  suggestion_id uuid references public.opportunity_assignment_suggestions (id)
    on delete restrict,
  assignment_version bigint not null check (assignment_version > 0),
  previous_assignee_snapshot jsonb,
  new_assignee_snapshot jsonb,
  actor_snapshot jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint opportunity_assignment_events_changed check (
    previous_assignee_id is distinct from new_assignee_id
  ),
  constraint opportunity_assignment_events_actor_required check (
    actor_user_id is not null
    or source in (
      'personal_mailbox',
      'deactivation',
      'permission_change',
      'admin_correction',
      'system_repair'
    )
  ),
  unique (opportunity_id, assignment_version)
);

alter table public.opportunity_assignment_suggestions
  add constraint opportunity_assignment_suggestions_resolution_event_fkey
  foreign key (resolution_event_id)
  references public.opportunity_assignment_events (id)
  on delete restrict;

create index opportunity_assignment_events_company_opportunity_idx
  on public.opportunity_assignment_events (
    company_id,
    opportunity_id,
    assignment_version desc
  );

create index opportunity_assignment_events_actor_idx
  on public.opportunity_assignment_events (company_id, actor_user_id, created_at desc)
  where actor_user_id is not null;

create table public.opportunity_assignment_deliveries (
  id uuid primary key default gen_random_uuid(),
  assignment_event_id uuid not null
    references public.opportunity_assignment_events (id) on delete restrict,
  company_id uuid not null references public.companies (id) on delete restrict,
  opportunity_id uuid not null references public.opportunities (id) on delete restrict,
  assignment_version bigint not null check (assignment_version > 0),
  recipient_user_id uuid not null references public.users (id) on delete restrict,
  access_after boolean not null,
  notify boolean not null,
  state text not null default 'pending'
    check (state in ('pending', 'processing', 'delivered', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by text,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_event_id, recipient_user_id)
);

create index opportunity_assignment_deliveries_recipient_pending_idx
  on public.opportunity_assignment_deliveries (
    recipient_user_id,
    available_at,
    created_at
  )
  where state in ('pending', 'failed');

create index opportunity_assignment_deliveries_dispatch_idx
  on public.opportunity_assignment_deliveries (state, available_at, created_at);

create table public.opportunity_conversion_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  opportunity_id uuid not null references public.opportunities (id) on delete restrict,
  project_id uuid not null references public.projects (id) on delete restrict,
  event_type text not null default 'converted_to_project'
    check (event_type = 'converted_to_project'),
  actor_user_id uuid references public.users (id) on delete restrict,
  assignment_version bigint not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (opportunity_id, project_id, event_type)
);

create index opportunity_conversion_events_company_created_idx
  on public.opportunity_conversion_events (company_id, created_at, id);

-- A custom GUC alone is forgeable by any SQL caller. These single-use rows are
-- the transaction-local mutation marker instead: only the revoked private core
-- can mint one, and the trigger consumes it in the same transaction.
create table private.opportunity_assignment_write_tokens (
  transaction_id bigint not null,
  backend_pid integer not null,
  opportunity_id uuid not null,
  operation text not null check (operation in ('insert', 'update')),
  assigned_to uuid,
  assignment_version bigint not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (transaction_id, backend_pid, opportunity_id)
);

revoke all on table private.opportunity_assignment_write_tokens
  from public, anon, authenticated, service_role;

create or replace function private.user_assignment_snapshot(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
  select case
    when p_user_id is null then null
    else (
      select jsonb_build_object(
        'id', u.id,
        'first_name', u.first_name,
        'last_name', u.last_name,
        'email', u.email,
        'profile_image_url', u.profile_image_url,
        'user_color', u.user_color,
        'role', u.role,
        'is_active', coalesce(u.is_active, false)
      )
      from public.users u
      where u.id = p_user_id
    )
  end;
$function$;

revoke all on function private.user_assignment_snapshot(uuid)
  from public, anon, authenticated, service_role;

-- Compatibility with the legacy pipeline.manage permission is allowed only
-- when the granular permission is genuinely absent for this user. An explicit
-- override (including a revoke) or role grant is authoritative and must never
-- be replaced by the legacy all-scope capability.
create or replace function private.should_use_pipeline_manage_compat(
  p_actor_user_id uuid,
  p_actor_company_id uuid,
  p_permission text
) returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
  select p_actor_user_id is not null
    and p_actor_company_id is not null
    and p_permission is not null
    and not exists (
      select 1
        from public.user_permission_overrides upo
       where upo.user_id = p_actor_user_id
         and upo.company_id = p_actor_company_id
         and upo.permission = p_permission
         and (not upo.granted or upo.scope is not null)
    )
    and not exists (
      select 1
        from public.user_roles ur
        join public.role_permissions rp on rp.role_id = ur.role_id
       where ur.user_id = p_actor_user_id::text
         and rp.permission = p_permission
    )
    and public.has_permission(
      p_actor_user_id,
      'pipeline.manage',
      'all'
    );
$function$;

revoke all on function private.should_use_pipeline_manage_compat(
  uuid, uuid, text
) from public, anon, authenticated, service_role;

create or replace function private.can_view_opportunity_assignment_context(
  p_opportunity_id uuid,
  p_company_id uuid
) returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_actor_user_id uuid := private.get_current_user_id();
  v_actor_company_id uuid := private.get_user_company_id();
  v_scope text;
begin
  if v_actor_user_id is null
    or v_actor_company_id is null
    or v_actor_company_id is distinct from p_company_id
    or not exists (
      select 1
        from public.users u
       where u.id = v_actor_user_id
         and u.company_id = v_actor_company_id
         and u.deleted_at is null
         and coalesce(u.is_active, false)
    )
  then
    return false;
  end if;

  v_scope := private.current_user_scope_for('pipeline.view');
  if v_scope is null
    and private.should_use_pipeline_manage_compat(
      v_actor_user_id,
      v_actor_company_id,
      'pipeline.view'
    )
  then
    v_scope := 'all';
  end if;

  if v_scope = 'all' then
    return exists (
      select 1
        from public.opportunities o
       where o.id = p_opportunity_id
         and o.company_id = p_company_id
         and o.deleted_at is null
    );
  end if;

  if v_scope = 'assigned' then
    return exists (
      select 1
        from public.opportunities o
       where o.id = p_opportunity_id
         and o.company_id = p_company_id
         and o.assigned_to = v_actor_user_id
         and o.deleted_at is null
    );
  end if;

  return false;
end;
$function$;

revoke all on function private.can_view_opportunity_assignment_context(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.can_view_opportunity_assignment_context(uuid, uuid)
  to authenticated;

alter table public.opportunity_assignment_events enable row level security;
alter table public.opportunity_assignment_suggestions enable row level security;
alter table public.opportunity_assignment_deliveries enable row level security;
alter table public.opportunity_conversion_events enable row level security;

drop policy if exists opportunity_assignment_events_authorized_select
  on public.opportunity_assignment_events;
create policy opportunity_assignment_events_authorized_select
  on public.opportunity_assignment_events
  for select
  to authenticated
  using (
    private.can_view_opportunity_assignment_context(opportunity_id, company_id)
  );

drop policy if exists opportunity_assignment_suggestions_authorized_select
  on public.opportunity_assignment_suggestions;
create policy opportunity_assignment_suggestions_authorized_select
  on public.opportunity_assignment_suggestions
  for select
  to authenticated
  using (
    private.can_view_opportunity_assignment_context(opportunity_id, company_id)
  );

drop policy if exists opportunity_assignment_deliveries_recipient_select
  on public.opportunity_assignment_deliveries;
create policy opportunity_assignment_deliveries_recipient_select
  on public.opportunity_assignment_deliveries
  for select
  to authenticated
  using (recipient_user_id = private.get_current_user_id());

drop policy if exists opportunity_conversion_events_authorized_select
  on public.opportunity_conversion_events;
create policy opportunity_conversion_events_authorized_select
  on public.opportunity_conversion_events
  for select
  to authenticated
  using (
    private.can_view_opportunity_assignment_context(opportunity_id, company_id)
  );

revoke all on table public.opportunity_assignment_events
  from public, anon, authenticated, service_role;
grant select on table public.opportunity_assignment_events
  to authenticated, service_role;
revoke update, delete on table public.opportunity_assignment_events from anon, authenticated, service_role;

revoke all on table public.opportunity_assignment_suggestions
  from public, anon, authenticated, service_role;
grant select on table public.opportunity_assignment_suggestions
  to authenticated, service_role;
grant insert, update on table public.opportunity_assignment_suggestions
  to service_role;

revoke all on table public.opportunity_assignment_deliveries
  from public, anon, authenticated, service_role;
grant select on table public.opportunity_assignment_deliveries
  to authenticated, service_role;
revoke insert, update, delete on table public.opportunity_assignment_deliveries from anon, authenticated, service_role;

revoke all on table public.opportunity_conversion_events
  from public, anon, authenticated, service_role;
grant select on table public.opportunity_conversion_events
  to authenticated, service_role;
revoke insert, update, delete on table public.opportunity_conversion_events from anon, authenticated;

create or replace function private.guard_opportunity_assignment_mutation()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_token_consumed boolean;
begin
  if tg_op = 'INSERT' then
    if new.assigned_to is null and new.assignment_version = 0 then
      return new;
    end if;

    if new.assigned_to is null or new.assignment_version <> 1 then
      raise exception 'assignment_write_forbidden'
        using errcode = '42501';
    end if;

    delete from private.opportunity_assignment_write_tokens t
     where t.transaction_id = txid_current()
       and t.backend_pid = pg_backend_pid()
       and t.opportunity_id = new.id
       and t.operation = 'insert'
       and t.assigned_to is not distinct from new.assigned_to
       and t.assignment_version = new.assignment_version
    returning true into v_token_consumed;

    if not found or not coalesce(v_token_consumed, false) then
      raise exception 'assignment_write_forbidden'
        using errcode = '42501';
    end if;

    return new;
  end if;

  if new.assigned_to is not distinct from old.assigned_to then
    if new.assignment_version is distinct from old.assignment_version then
      raise exception 'assignment_write_forbidden'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.assignment_version <> old.assignment_version + 1 then
    raise exception 'assignment_write_forbidden'
      using errcode = '42501';
  end if;

  delete from private.opportunity_assignment_write_tokens t
   where t.transaction_id = txid_current()
     and t.backend_pid = pg_backend_pid()
     and t.opportunity_id = new.id
     and t.operation = 'update'
     and t.assigned_to is not distinct from new.assigned_to
     and t.assignment_version = new.assignment_version
  returning true into v_token_consumed;

  if not found or not coalesce(v_token_consumed, false) then
    raise exception 'assignment_write_forbidden'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

revoke all on function private.guard_opportunity_assignment_mutation()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_opportunities_guard_assignment_mutation
  on public.opportunities;
create trigger trg_opportunities_guard_assignment_mutation
before insert or update of assigned_to, assignment_version on public.opportunities
for each row execute function private.guard_opportunity_assignment_mutation();

create or replace function private.change_opportunity_assignment_core(
  p_opportunity_id uuid,
  p_expected_assignment_version bigint,
  p_expected_assigned_to uuid,
  p_new_assigned_to uuid,
  p_source text,
  p_actor_user_id uuid,
  p_actor_company_id uuid,
  p_is_system boolean,
  p_suggestion_id uuid,
  p_metadata jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_opportunity public.opportunities%rowtype;
  v_scope text;
  v_event_id uuid;
  v_new_version bigint;
  v_new_notify boolean;
  v_previous_access_after boolean;
begin
  if p_opportunity_id is null
    or p_expected_assignment_version is null
    or p_expected_assignment_version < 0
  then
    raise exception 'invalid_assignment_expectation'
      using errcode = '22023';
  end if;

  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'assignment_metadata_must_be_object'
      using errcode = '22023';
  end if;

  if p_is_system is null then
    raise exception 'assignment_principal_kind_required'
      using errcode = '22023';
  elsif p_is_system then
    if p_source not in (
      'personal_mailbox',
      'deactivation',
      'permission_change',
      'admin_correction',
      'system_repair'
    ) then
      raise exception 'invalid_system_assignment_source'
        using errcode = '22023';
    end if;
  elsif p_source is null
    or p_source not in ('manual', 'suggestion_accept')
  then
    raise exception 'invalid_human_assignment_source'
      using errcode = '22023';
  end if;

  select o.*
    into v_opportunity
    from public.opportunities o
   where o.id = p_opportunity_id
   for update;

  if not found or v_opportunity.deleted_at is not null then
    raise exception 'opportunity_not_found'
      using errcode = 'P0002';
  end if;

  if p_actor_company_id is distinct from v_opportunity.company_id then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  if p_actor_user_id is not null then
    perform 1
      from public.users u
     where u.id = p_actor_user_id
       and u.company_id = v_opportunity.company_id
       and u.deleted_at is null
       and coalesce(u.is_active, false)
     for share;
    if not found then
      raise exception 'assignment_actor_ineligible'
        using errcode = '42501';
    end if;
  end if;

  if not p_is_system then
    if p_actor_user_id is null then
      raise exception 'access_denied'
        using errcode = '42501';
    end if;

    v_scope := private.current_user_scope_for('pipeline.assign');
    if v_scope is null
      and private.should_use_pipeline_manage_compat(
        p_actor_user_id,
        p_actor_company_id,
        'pipeline.assign'
      )
    then
      v_scope := 'all';
    end if;

    if v_scope is null or v_scope not in ('all', 'assigned') then
      raise exception 'access_denied'
        using errcode = '42501';
    end if;

    if v_scope = 'assigned' then
      if v_opportunity.assigned_to is distinct from p_actor_user_id then
        raise exception 'access_denied'
          using errcode = '42501';
      end if;
    end if;
  end if;

  if v_opportunity.assignment_version is distinct from p_expected_assignment_version
    or v_opportunity.assigned_to is distinct from p_expected_assigned_to
  then
    return jsonb_build_object(
      'ok', false,
      'conflict', true,
      'assigned_to', v_opportunity.assigned_to,
      'assignment_version', v_opportunity.assignment_version,
      'event_id', null
    );
  end if;

  if v_opportunity.assigned_to is not distinct from p_new_assigned_to then
    return jsonb_build_object(
      'ok', true,
      'conflict', false,
      'assigned_to', v_opportunity.assigned_to,
      'assignment_version', v_opportunity.assignment_version,
      'event_id', null
    );
  end if;

  if not p_is_system and v_scope = 'assigned' then
    if p_new_assigned_to is null then
      raise exception 'assigned_scope_cannot_unassign'
        using errcode = '42501';
    end if;
    if v_opportunity.archived_at is not null
      or v_opportunity.stage in ('won', 'lost', 'discarded')
    then
      raise exception 'assigned_scope_terminal_transfer_forbidden'
        using errcode = '42501';
    end if;
  end if;

  if p_new_assigned_to is not null then
    perform 1
      from public.users
     where id = p_new_assigned_to
       and company_id = v_opportunity.company_id
       and deleted_at is null
       and coalesce(is_active, false)
       and public.has_permission(
         p_new_assigned_to,
         'pipeline.view',
         'assigned'
       )
     for share;
    if not found then
      raise exception 'assignment_target_ineligible'
        using errcode = '22023';
    end if;
  end if;

  if p_source = 'suggestion_accept' then
    if p_suggestion_id is null
      or not exists (
        select 1
          from public.opportunity_assignment_suggestions s
         where s.id = p_suggestion_id
           and s.company_id = v_opportunity.company_id
           and s.opportunity_id = p_opportunity_id
           and s.suggested_user_id = p_new_assigned_to
           and s.resolution_state = 'pending'
      )
    then
      raise exception 'assignment_suggestion_invalid'
        using errcode = '22023';
    end if;
  elsif p_suggestion_id is not null then
    raise exception 'suggestion_id_requires_suggestion_accept'
      using errcode = '22023';
  end if;

  v_new_version := v_opportunity.assignment_version + 1;

  insert into private.opportunity_assignment_write_tokens (
    transaction_id,
    backend_pid,
    opportunity_id,
    operation,
    assigned_to,
    assignment_version
  ) values (
    txid_current(),
    pg_backend_pid(),
    p_opportunity_id,
    'update',
    p_new_assigned_to,
    v_new_version
  );

  update public.opportunities
     set assigned_to = p_new_assigned_to,
         assignment_version = assignment_version + 1,
         updated_at = now()
   where id = p_opportunity_id
  returning assignment_version into v_new_version;

  insert into public.opportunity_assignment_events (
    company_id,
    opportunity_id,
    previous_assignee_id,
    new_assignee_id,
    actor_user_id,
    source,
    suggestion_id,
    assignment_version,
    previous_assignee_snapshot,
    new_assignee_snapshot,
    actor_snapshot,
    metadata
  ) values (
    v_opportunity.company_id,
    p_opportunity_id,
    v_opportunity.assigned_to,
    p_new_assigned_to,
    p_actor_user_id,
    p_source,
    p_suggestion_id,
    v_new_version,
    private.user_assignment_snapshot(v_opportunity.assigned_to),
    private.user_assignment_snapshot(p_new_assigned_to),
    private.user_assignment_snapshot(p_actor_user_id),
    p_metadata
  )
  returning id into v_event_id;

  update public.opportunity_assignment_suggestions
     set resolution_state = case
           when id = p_suggestion_id and p_source = 'suggestion_accept'
             then 'accepted'
           else 'superseded'
         end,
         resolved_at = now(),
         resolved_by = p_actor_user_id,
         resolution_event_id = v_event_id,
         resolution_metadata = jsonb_build_object(
           'assignment_source', p_source,
           'assignment_version', v_new_version
         ),
         updated_at = now()
   where company_id = v_opportunity.company_id
     and opportunity_id = p_opportunity_id
     and resolution_state = 'pending';

  if v_opportunity.assigned_to is not null
    and v_opportunity.assigned_to is distinct from p_new_assigned_to
  then
    v_previous_access_after := exists (
      select 1
        from public.users prior_user
       where prior_user.id = v_opportunity.assigned_to
         and prior_user.company_id = v_opportunity.company_id
         and prior_user.deleted_at is null
         and coalesce(prior_user.is_active, false)
         and (
           public.has_permission(
             v_opportunity.assigned_to,
             'pipeline.view',
             'all'
           )
           or private.should_use_pipeline_manage_compat(
             v_opportunity.assigned_to,
             v_opportunity.company_id,
             'pipeline.view'
           )
         )
    );

    insert into public.opportunity_assignment_deliveries (
      assignment_event_id,
      company_id,
      opportunity_id,
      assignment_version,
      recipient_user_id,
      access_after,
      notify
    ) values (
      v_event_id,
      v_opportunity.company_id,
      p_opportunity_id,
      v_new_version,
      v_opportunity.assigned_to,
      v_previous_access_after,
      false
    )
    on conflict (assignment_event_id, recipient_user_id) do nothing;
  end if;

  if p_new_assigned_to is not null
    and p_new_assigned_to is distinct from v_opportunity.assigned_to
  then
    v_new_notify := not (
      not p_is_system
      and p_new_assigned_to = p_actor_user_id
    );

    insert into public.opportunity_assignment_deliveries (
      assignment_event_id,
      company_id,
      opportunity_id,
      assignment_version,
      recipient_user_id,
      access_after,
      notify
    ) values (
      v_event_id,
      v_opportunity.company_id,
      p_opportunity_id,
      v_new_version,
      p_new_assigned_to,
      true,
      v_new_notify
    )
    on conflict (assignment_event_id, recipient_user_id) do nothing;
  end if;

  return jsonb_build_object(
    'ok', true,
    'conflict', false,
    'assigned_to', p_new_assigned_to,
    'assignment_version', v_new_version,
    'event_id', v_event_id
  );
end;
$function$;

revoke all on function private.change_opportunity_assignment_core(
  uuid, bigint, uuid, uuid, text, uuid, uuid, boolean, uuid, jsonb
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
  if p_source is null or p_source not in ('manual', 'suggestion_accept') then
    raise exception 'invalid_human_assignment_source'
      using errcode = '22023';
  end if;

  if v_actor_user_id is null
    or v_actor_company_id is null
    or not exists (
      select 1
        from public.users u
       where u.id = v_actor_user_id
         and u.company_id = v_actor_company_id
         and u.deleted_at is null
         and coalesce(u.is_active, false)
    )
  then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  return private.change_opportunity_assignment_core(
    p_opportunity_id,
    p_expected_assignment_version,
    p_expected_assigned_to,
    p_new_assigned_to,
    p_source,
    v_actor_user_id,
    v_actor_company_id,
    false,
    p_suggestion_id,
    coalesce(p_metadata, '{}'::jsonb)
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

  if p_system_source is null or p_system_source not in (
    'personal_mailbox',
    'deactivation',
    'permission_change',
    'admin_correction',
    'system_repair'
  ) then
    raise exception 'invalid_system_assignment_source'
      using errcode = '22023';
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

  if p_actor_user_id is not null
    and not exists (
      select 1
        from public.users u
       where u.id = p_actor_user_id
         and u.company_id = v_company_id
         and u.deleted_at is null
         and coalesce(u.is_active, false)
    )
  then
    raise exception 'assignment_actor_ineligible'
      using errcode = '22023';
  end if;

  return private.change_opportunity_assignment_core(
    p_opportunity_id,
    p_expected_assignment_version,
    p_expected_assigned_to,
    p_new_assigned_to,
    p_system_source,
    p_actor_user_id,
    v_company_id,
    true,
    p_suggestion_id,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$function$;

revoke all on function public.change_opportunity_assignment_as_system(uuid, bigint, uuid, uuid, text, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.change_opportunity_assignment_as_system(uuid, bigint, uuid, uuid, text, uuid, uuid, jsonb) to service_role;

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
  v_allowed_keys text[] := array[
    'client_id',
    'client_ref',
    'title',
    'description',
    'contact_name',
    'contact_email',
    'contact_phone',
    'stage',
    'source',
    'priority',
    'estimated_value',
    'win_probability',
    'expected_close_date',
    'quote_delivery_method',
    'address',
    'latitude',
    'longitude',
    'tags'
  ];
  v_invalid_key text;
  v_actor_user_id uuid := private.get_current_user_id();
  v_company_id uuid := private.get_user_company_id();
  v_create_scope text;
  v_assign_scope text;
  v_client_id uuid;
  v_client_id_legacy uuid;
  v_client_ref uuid;
  v_assigned_to uuid;
  v_assignment_version bigint := 0;
  v_opportunity_id uuid := gen_random_uuid();
  v_stage text;
  v_tags text[];
  v_created public.opportunities%rowtype;
  v_event_id uuid;
begin
  if p_opportunity is null or jsonb_typeof(p_opportunity) <> 'object' then
    raise exception 'opportunity_payload_must_be_object'
      using errcode = '22023';
  end if;

  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'assignment_metadata_must_be_object'
      using errcode = '22023';
  end if;

  select key
    into v_invalid_key
    from jsonb_object_keys(p_opportunity) as supplied(key)
   where not (key = any (v_allowed_keys))
   order by key
   limit 1;

  if v_invalid_key is not null then
    raise exception 'unsupported_opportunity_field: %', v_invalid_key
      using errcode = '22023';
  end if;

  if p_assignment_mode is null
    or p_assignment_mode not in ('self', 'unassigned', 'explicit')
  then
    raise exception 'invalid_assignment_mode'
      using errcode = '22023';
  end if;

  if v_actor_user_id is null or v_company_id is null then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

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

  v_create_scope := private.current_user_scope_for('pipeline.create');
  if v_create_scope is null
    and private.should_use_pipeline_manage_compat(
      v_actor_user_id,
      v_company_id,
      'pipeline.create'
    )
  then
    v_create_scope := 'all';
  end if;
  if v_create_scope is distinct from 'all' then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  v_assign_scope := private.current_user_scope_for('pipeline.assign');
  if v_assign_scope is null
    and private.should_use_pipeline_manage_compat(
      v_actor_user_id,
      v_company_id,
      'pipeline.assign'
    )
  then
    v_assign_scope := 'all';
  end if;

  if p_assignment_mode in ('unassigned', 'explicit')
    and v_assign_scope is distinct from 'all'
  then
    raise exception 'pipeline.assign:all required for assignment mode'
      using errcode = '42501';
  end if;

  if nullif(btrim(p_opportunity ->> 'title'), '') is null then
    raise exception 'opportunity_title_required'
      using errcode = '22023';
  end if;

  v_stage := coalesce(nullif(p_opportunity ->> 'stage', ''), 'new_lead');
  if v_stage not in (
    'new_lead',
    'qualifying',
    'quoting',
    'quoted',
    'follow_up',
    'negotiation'
  ) then
    raise exception 'manual_create_stage_invalid'
      using errcode = '22023';
  end if;

  if p_opportunity ? 'tags'
    and p_opportunity -> 'tags' is not null
    and jsonb_typeof(p_opportunity -> 'tags') <> 'array'
  then
    raise exception 'opportunity_tags_must_be_array'
      using errcode = '22023';
  end if;
  select coalesce(array_agg(value), '{}'::text[])
    into v_tags
    from jsonb_array_elements_text(
      case
        when p_opportunity ? 'tags'
          and jsonb_typeof(p_opportunity -> 'tags') = 'array'
          then p_opportunity -> 'tags'
        else '[]'::jsonb
      end
    ) as tag(value);

  v_client_id_legacy := nullif(p_opportunity ->> 'client_id', '')::uuid;
  v_client_ref := nullif(p_opportunity ->> 'client_ref', '')::uuid;
  if v_client_id_legacy is not null
    and v_client_ref is not null
    and v_client_id_legacy is distinct from v_client_ref
  then
    raise exception 'client_mirrors_disagree'
      using errcode = '22023';
  end if;
  v_client_id := coalesce(v_client_ref, v_client_id_legacy);

  if v_client_id is not null
    and not exists (
      select 1
        from public.clients c
       where c.id = v_client_id
         and c.company_id = v_company_id
         and c.deleted_at is null
    )
  then
    raise exception 'client_not_found_in_company'
      using errcode = '22023';
  end if;

  if p_assignment_mode = 'self' then
    if p_initial_assigned_to is not null
      and p_initial_assigned_to is distinct from v_actor_user_id
    then
      raise exception 'self_assignment_target_must_be_actor'
        using errcode = '22023';
    end if;

    if exists (
      select 1
        from public.users u
       where u.id = v_actor_user_id
         and u.company_id = v_company_id
         and u.deleted_at is null
         and coalesce(u.is_active, false)
         and public.has_permission(
           v_actor_user_id,
           'pipeline.view',
           'assigned'
         )
    ) then
      v_assigned_to := v_actor_user_id;
    end if;
  elsif p_assignment_mode = 'unassigned' then
    if p_initial_assigned_to is not null then
      raise exception 'unassigned_mode_requires_null_target'
        using errcode = '22023';
    end if;
    v_assigned_to := null;
  else
    if p_initial_assigned_to is null then
      raise exception 'explicit_mode_requires_target'
        using errcode = '22023';
    end if;
    perform 1
      from public.users u
     where u.id = p_initial_assigned_to
       and u.company_id = v_company_id
       and u.deleted_at is null
       and coalesce(u.is_active, false)
       and public.has_permission(
         p_initial_assigned_to,
         'pipeline.view',
         'assigned'
       )
     for share;
    if not found then
      raise exception 'assignment_target_ineligible'
        using errcode = '22023';
    end if;
    v_assigned_to := p_initial_assigned_to;
  end if;

  if v_assigned_to is not null then
    v_assignment_version := 1;
    insert into private.opportunity_assignment_write_tokens (
      transaction_id,
      backend_pid,
      opportunity_id,
      operation,
      assigned_to,
      assignment_version
    ) values (
      txid_current(),
      pg_backend_pid(),
      v_opportunity_id,
      'insert',
      v_assigned_to,
      v_assignment_version
    );
  end if;

  insert into public.opportunities (
    id,
    company_id,
    client_id,
    client_ref,
    title,
    description,
    contact_name,
    contact_email,
    contact_phone,
    stage,
    source,
    assigned_to,
    assignment_version,
    priority,
    estimated_value,
    win_probability,
    expected_close_date,
    quote_delivery_method,
    address,
    latitude,
    longitude,
    tags
  ) values (
    v_opportunity_id,
    v_company_id,
    v_client_id,
    v_client_id,
    btrim(p_opportunity ->> 'title'),
    nullif(p_opportunity ->> 'description', ''),
    nullif(p_opportunity ->> 'contact_name', ''),
    nullif(p_opportunity ->> 'contact_email', ''),
    nullif(p_opportunity ->> 'contact_phone', ''),
    v_stage,
    nullif(p_opportunity ->> 'source', ''),
    v_assigned_to,
    v_assignment_version,
    nullif(p_opportunity ->> 'priority', ''),
    nullif(p_opportunity ->> 'estimated_value', '')::numeric,
    coalesce(nullif(p_opportunity ->> 'win_probability', '')::integer, 10),
    nullif(p_opportunity ->> 'expected_close_date', '')::date,
    nullif(p_opportunity ->> 'quote_delivery_method', ''),
    nullif(p_opportunity ->> 'address', ''),
    nullif(p_opportunity ->> 'latitude', '')::double precision,
    nullif(p_opportunity ->> 'longitude', '')::double precision,
    v_tags
  )
  returning * into v_created;

  if v_assigned_to is not null then
    insert into public.opportunity_assignment_events (
      company_id,
      opportunity_id,
      previous_assignee_id,
      new_assignee_id,
      actor_user_id,
      source,
      assignment_version,
      previous_assignee_snapshot,
      new_assignee_snapshot,
      actor_snapshot,
      metadata
    ) values (
      v_company_id,
      v_opportunity_id,
      null,
      v_assigned_to,
      v_actor_user_id,
      'manual_create',
      v_assignment_version,
      null,
      private.user_assignment_snapshot(v_assigned_to),
      private.user_assignment_snapshot(v_actor_user_id),
      p_metadata
    )
    returning id into v_event_id;

    insert into public.opportunity_assignment_deliveries (
      assignment_event_id,
      company_id,
      opportunity_id,
      assignment_version,
      recipient_user_id,
      access_after,
      notify
    ) values (
      v_event_id,
      v_company_id,
      v_opportunity_id,
      v_assignment_version,
      v_assigned_to,
      true,
      v_assigned_to is distinct from v_actor_user_id
    )
    on conflict (assignment_event_id, recipient_user_id) do nothing;
  end if;

  return jsonb_build_object(
    'ok', true,
    'conflict', false,
    'opportunity', to_jsonb(v_created),
    'assigned_to', v_assigned_to,
    'assignment_version', v_assignment_version,
    'event_id', v_event_id
  );
end;
$function$;

revoke all on function public.create_opportunity_guarded(jsonb, text, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.create_opportunity_guarded(jsonb, text, uuid, jsonb)
  to authenticated;

-- The project-link invariant predates assigned-scope conversion and normally
-- requires pipeline.manage:all before it will honor the legacy conversion GUC.
-- A GUC is caller-forgeable, so assigned conversion uses a one-use private row
-- tied to the current transaction, backend, project, opportunity, company, and
-- trigger operation. The conversion RPC mints it and the AFTER trigger consumes
-- it; every ordinary project write still follows the existing authorization and
-- invariant behavior.
create table private.opportunity_conversion_project_link_tokens (
  transaction_id bigint not null,
  backend_pid integer not null,
  project_id uuid not null,
  opportunity_id uuid not null,
  company_id uuid not null,
  operation text not null check (operation in ('insert', 'update')),
  created_at timestamptz not null default clock_timestamp(),
  primary key (transaction_id, backend_pid, project_id, operation)
);

revoke all on table private.opportunity_conversion_project_link_tokens
  from public, anon, authenticated, service_role;

create or replace function public.enforce_project_opportunity_link()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_new_opportunity_id uuid;
  v_old_opportunity_id uuid;
  v_from_stage text;
  v_stage_entered_at timestamptz;
  v_existing_project_ref uuid;
  v_existing_project_legacy uuid;
  v_existing_project_id uuid;
  v_conversion_link_owned boolean := false;
begin
  if tg_op = 'DELETE' then
    if old.opportunity_ref is not null then
      v_old_opportunity_id := old.opportunity_ref;
    elsif old.opportunity_id is not null
      and btrim(old.opportunity_id) ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then
      v_old_opportunity_id := old.opportunity_id::uuid;
    end if;

    if v_old_opportunity_id is not null
      and coalesce(auth.role(), '') <> 'service_role'
    then
      if old.company_id is distinct from private.get_user_company_id()
        or not private.current_user_has_permission('pipeline.manage', 'all')
      then
        raise exception 'access_denied'
          using errcode = '42501';
      end if;
    end if;

    if current_setting('ops.skip_project_opportunity_invariant', true) = 'on' then
      return old;
    end if;

    if v_old_opportunity_id is not null then
      update public.opportunities
         set project_ref = null,
             project_id = null,
             updated_at = now()
       where id = v_old_opportunity_id
         and company_id = old.company_id
         and (project_ref = old.id or project_id = old.id);
    end if;
    return old;
  end if;

  if new.opportunity_ref is not null then
    v_new_opportunity_id := new.opportunity_ref;
  elsif new.opportunity_id is not null
    and btrim(new.opportunity_id) ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then
    v_new_opportunity_id := new.opportunity_id::uuid;
  end if;

  if tg_op = 'UPDATE' then
    if old.opportunity_ref is not null then
      v_old_opportunity_id := old.opportunity_ref;
    elsif old.opportunity_id is not null
      and btrim(old.opportunity_id) ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then
      v_old_opportunity_id := old.opportunity_id::uuid;
    end if;
  end if;

  -- The token can only be inserted by the revoked SECURITY DEFINER conversion
  -- function. Consume it before ordinary project-write authorization so a
  -- pipeline.convert:assigned actor can reach the RPC-owned project link.
  delete from private.opportunity_conversion_project_link_tokens token
   where token.transaction_id = txid_current()
     and token.backend_pid = pg_backend_pid()
     and token.project_id = new.id
     and token.opportunity_id = v_new_opportunity_id
     and token.company_id = new.company_id
     and token.operation = lower(tg_op)
  returning true into v_conversion_link_owned;

  if coalesce(v_conversion_link_owned, false) then
    return new;
  end if;

  -- Ordinary project writes preserve the existing company-wide management
  -- authorization. The legacy GUC remains bounded behind this check for the
  -- approval-queue path; setting it never grants authority by itself.
  if v_new_opportunity_id is not null or v_old_opportunity_id is not null then
    if coalesce(auth.role(), '') <> 'service_role' then
      if new.company_id is distinct from private.get_user_company_id()
        or not private.current_user_has_permission('pipeline.manage', 'all')
      then
        raise exception 'access_denied'
          using errcode = '42501';
      end if;
    end if;
  end if;

  if current_setting('ops.skip_project_opportunity_invariant', true) = 'on' then
    return new;
  end if;

  if new.deleted_at is not null then
    if tg_op = 'UPDATE' and v_old_opportunity_id is not null then
      update public.opportunities
         set project_ref = null,
             project_id = null,
             updated_at = now()
       where id = v_old_opportunity_id
         and company_id = old.company_id
         and (project_ref = new.id or project_id = new.id);
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if v_old_opportunity_id is distinct from v_new_opportunity_id
      and v_old_opportunity_id is not null
    then
      update public.opportunities
         set project_ref = null,
             project_id = null,
             updated_at = now()
       where id = v_old_opportunity_id
         and company_id = old.company_id
         and (project_ref = new.id or project_id = new.id);
    end if;
  end if;

  if v_new_opportunity_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and v_old_opportunity_id is not distinct from v_new_opportunity_id
    and old.company_id is not distinct from new.company_id
    and not (new.status in ('accepted', 'in_progress', 'completed', 'closed'))
  then
    return new;
  end if;

  select o.stage, o.stage_entered_at, o.project_ref, o.project_id
    into v_from_stage, v_stage_entered_at,
         v_existing_project_ref, v_existing_project_legacy
    from public.opportunities o
   where o.id = v_new_opportunity_id
     and o.company_id = new.company_id
     and o.deleted_at is null
   for update;

  if not found then
    raise exception 'project opportunity link target was not found'
      using errcode = '23503';
  end if;

  if v_existing_project_ref is not null
    and v_existing_project_legacy is not null
    and v_existing_project_ref is distinct from v_existing_project_legacy
  then
    raise exception 'opportunity project mirrors disagree'
      using errcode = '23505';
  end if;

  v_existing_project_id := coalesce(
    v_existing_project_ref,
    v_existing_project_legacy
  );

  if v_existing_project_id is not null
    and v_existing_project_id is distinct from new.id
  then
    raise exception 'opportunity is already linked to another project'
      using errcode = '23505';
  end if;

  update public.opportunities
     set project_ref = new.id,
         project_id = new.id,
         stage = 'won',
         stage_entered_at = case
           when v_from_stage is distinct from 'won' then now()
           else stage_entered_at
         end,
         stage_manually_set = true,
         actual_close_date = coalesce(actual_close_date, now()::date),
         updated_at = now()
   where id = v_new_opportunity_id
     and company_id = new.company_id;

  if v_from_stage is distinct from 'won' then
    insert into public.stage_transitions (
      company_id,
      opportunity_id,
      from_stage,
      to_stage,
      transitioned_at,
      transitioned_by,
      duration_in_stage
    ) values (
      new.company_id,
      v_new_opportunity_id,
      v_from_stage,
      'won',
      now(),
      null,
      now() - coalesce(v_stage_entered_at, now())
    );
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_project_opportunity_link()
  from public, anon, authenticated, service_role;

-- Replace the legacy conversion overload with one assignment-snapshot-aware
-- contract. This definition is the union of the project-link invariant and
-- the live lead-media/deck carryover responsibilities. All retry-repair work
-- stays in the same locked transaction, and conversion emits one immutable
-- integration event for downstream attachment materializers.
drop function if exists public.convert_opportunity_to_project(
  uuid,
  uuid,
  numeric,
  text,
  uuid,
  text,
  text,
  uuid,
  text,
  boolean,
  text,
  jsonb
);

create or replace function public.convert_opportunity_to_project(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_actual_value numeric default null::numeric,
  p_expected_stage text default null::text,
  p_decided_by uuid default null::uuid,
  p_notes text default null::text,
  p_title_override text default null::text,
  p_link_to_project_id uuid default null::uuid,
  p_source_path text default null::text,
  p_win_opportunity boolean default true,
  p_project_status text default null::text,
  p_evidence jsonb default '{}'::jsonb,
  p_expected_assignment_version bigint default null::bigint
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_opp public.opportunities%rowtype;
  v_is_service boolean := coalesce(auth.role(), '') = 'service_role';
  v_actor_user_id uuid;
  v_actor_company_id uuid;
  v_decided_by uuid;
  v_convert_scope text;
  v_project_id uuid;
  v_project_opportunity_ref uuid;
  v_project_opportunity_id text;
  v_status text;
  v_value numeric;
  v_platform jsonb;
  v_disposition_id uuid;
  v_conversion_event_id uuid;
  v_relinked bigint := 0;
  v_tasks bigint := 0;
  v_photos bigint := 0;
  v_lead_photos bigint := 0;
  v_decks bigint := 0;
  v_won boolean := false;
  v_already_converted boolean := false;
  v_linked_existing boolean := p_link_to_project_id is not null;
  v_created_by uuid;
begin
  if p_company_id is null or p_opportunity_id is null then
    raise exception 'company and opportunity ids are required'
      using errcode = '22023';
  end if;

  -- Assignment authorization and every optimistic guard are evaluated from
  -- this one locked snapshot. No link, stage, disposition, projection, or
  -- conversion event is written before the guards below have passed.
  select *
    into v_opp
    from public.opportunities o
   where o.id = p_opportunity_id
     and o.company_id = p_company_id
   for update;

  if not found then
    raise exception 'opportunity_not_found'
      using errcode = 'P0002';
  end if;
  if v_opp.deleted_at is not null then
    raise exception 'opportunity is soft-deleted'
      using errcode = '22023';
  end if;

  if v_is_service then
    -- Service callers may omit an actor for system work. If supplied, the
    -- actor is always an active same-company OPS public.users.id.
    if p_decided_by is not null then
      perform 1
        from public.users service_actor
       where service_actor.id = p_decided_by
         and service_actor.company_id = p_company_id
         and service_actor.deleted_at is null
         and coalesce(service_actor.is_active, false)
       for share;
      if not found then
        raise exception 'conversion_actor_ineligible'
          using errcode = '22023';
      end if;
    end if;
    v_actor_user_id := p_decided_by;
    v_actor_company_id := p_company_id;
    v_decided_by := p_decided_by;
  else
    v_actor_user_id := private.get_current_user_id();
    v_actor_company_id := private.get_user_company_id();

    if v_actor_user_id is null
      or v_actor_company_id is null
      or v_actor_company_id is distinct from p_company_id
      or not exists (
        select 1
          from public.users actor_user
         where actor_user.id = v_actor_user_id
           and actor_user.company_id = p_company_id
           and actor_user.deleted_at is null
           and coalesce(actor_user.is_active, false)
      )
    then
      raise exception 'access_denied'
        using errcode = '42501';
    end if;

    if p_decided_by is not null
      and p_decided_by is distinct from v_actor_user_id
    then
      raise exception 'access_denied'
        using errcode = '42501';
    end if;

    -- Human attribution is server-derived even when the caller omits the
    -- legacy p_decided_by argument.
    v_decided_by := v_actor_user_id;
    v_convert_scope := private.current_user_scope_for('pipeline.convert');
    if v_convert_scope is null
      and private.should_use_pipeline_manage_compat(
        v_actor_user_id,
        v_actor_company_id,
        'pipeline.convert'
      )
    then
      v_convert_scope := 'all';
    end if;

    if v_convert_scope = 'assigned'
      and v_opp.assigned_to is distinct from v_actor_user_id
    then
      raise exception 'access_denied'
        using errcode = '42501';
    elsif v_convert_scope is distinct from 'all'
      and v_convert_scope is distinct from 'assigned'
    then
      raise exception 'access_denied'
        using errcode = '42501';
    end if;
  end if;

  if p_expected_assignment_version is not null
    and v_opp.assignment_version is distinct from p_expected_assignment_version
  then
    return jsonb_build_object(
      'converted', false,
      'already_converted', false,
      'guard_reason', 'assignment_snapshot_mismatch',
      'opportunity_id', p_opportunity_id,
      'assigned_to', v_opp.assigned_to,
      'assignment_version', v_opp.assignment_version
    );
  end if;

  if p_expected_stage is not null
    and v_opp.stage is distinct from p_expected_stage
  then
    return jsonb_build_object(
      'converted', false,
      'already_converted', false,
      'guard_reason', 'snapshot_mismatch',
      'opportunity_id', p_opportunity_id,
      'assigned_to', v_opp.assigned_to,
      'assignment_version', v_opp.assignment_version
    );
  end if;

  if v_opp.project_ref is not null
    and v_opp.project_id is not null
    and v_opp.project_ref is distinct from v_opp.project_id
  then
    raise exception 'opportunity project mirrors disagree'
      using errcode = '23505';
  end if;

  v_project_id := coalesce(v_opp.project_ref, v_opp.project_id);
  if v_project_id is not null then
    v_already_converted := true;

    if p_link_to_project_id is not null
      and p_link_to_project_id is distinct from v_project_id
    then
      raise exception 'opportunity is already linked to another project'
        using errcode = '23505';
    end if;

    select p.opportunity_ref, p.opportunity_id
      into v_project_opportunity_ref, v_project_opportunity_id
      from public.projects p
     where p.id = v_project_id
       and p.company_id = p_company_id
       and p.deleted_at is null
     for update;
    if not found then
      raise exception 'linked project not found in opportunity company'
        using errcode = 'P0002';
    end if;
    if v_project_opportunity_ref is not null
      and v_project_opportunity_ref is distinct from p_opportunity_id
    then
      raise exception 'linked project belongs to another opportunity'
        using errcode = '23505';
    end if;
    if v_project_opportunity_ref is null
      and v_project_opportunity_id is not null
      and btrim(v_project_opportunity_id) ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and v_project_opportunity_id::uuid is distinct from p_opportunity_id
    then
      raise exception 'linked project legacy mirror belongs to another opportunity'
        using errcode = '23505';
    end if;
  elsif p_link_to_project_id is not null then
    select p.id, p.opportunity_ref, p.opportunity_id
      into v_project_id, v_project_opportunity_ref, v_project_opportunity_id
      from public.projects p
     where p.id = p_link_to_project_id
       and p.company_id = p_company_id
       and p.deleted_at is null
     for update;
    if not found then
      raise exception 'link target project not found'
        using errcode = 'P0002';
    end if;
    if v_project_opportunity_ref is not null
      and v_project_opportunity_ref is distinct from p_opportunity_id
    then
      raise exception 'link target project already belongs to another opportunity'
        using errcode = '23505';
    end if;
    if v_project_opportunity_ref is null
      and v_project_opportunity_id is not null
      and btrim(v_project_opportunity_id) ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and v_project_opportunity_id::uuid is distinct from p_opportunity_id
    then
      raise exception 'link target project legacy mirror belongs to another opportunity'
        using errcode = '23505';
    end if;
  else
    v_status := coalesce(
      p_project_status,
      case when p_win_opportunity then 'accepted' else 'rfq' end
    );
    v_value := coalesce(
      p_actual_value,
      v_opp.actual_value,
      v_opp.estimated_value
    );
    v_platform := case
      when v_opp.source is not null or v_opp.source_email_id is not null
        then jsonb_build_object(
          'source', v_opp.source,
          'source_email_id', v_opp.source_email_id
        )
      else null
    end;

    -- projects.created_by references auth.users.id. Map the validated OPS
    -- actor only through canonical auth_id/firebase_uid identities; an actor
    -- without a UUID-backed auth row leaves creator attribution null.
    if v_actor_user_id is not null then
      select au.id
        into v_created_by
        from public.users actor_user
        join auth.users au
          on au.id::text = actor_user.auth_id
          or au.id::text = actor_user.firebase_uid
       where actor_user.id = v_actor_user_id
         and actor_user.company_id = p_company_id
         and actor_user.deleted_at is null
         and coalesce(actor_user.is_active, false)
       order by case
         when au.id::text = actor_user.auth_id then 0
         else 1
       end
       limit 1;
    end if;

    v_project_id := gen_random_uuid();
  end if;

  -- Mint exactly one private marker for the immediately following project
  -- write. The AFTER trigger consumes it; the BEFORE normalizer still runs.
  if v_already_converted or p_link_to_project_id is not null then
    insert into private.opportunity_conversion_project_link_tokens (
      transaction_id,
      backend_pid,
      project_id,
      opportunity_id,
      company_id,
      operation
    ) values (
      txid_current(),
      pg_backend_pid(),
      v_project_id,
      p_opportunity_id,
      p_company_id,
      'update'
    );

    update public.projects
       set opportunity_ref = p_opportunity_id,
           opportunity_id = p_opportunity_id::text,
           updated_at = now()
     where id = v_project_id
       and company_id = p_company_id;
    if not found then
      raise exception 'conversion project link update matched zero rows'
        using errcode = 'P0002';
    end if;
  else
    insert into private.opportunity_conversion_project_link_tokens (
      transaction_id,
      backend_pid,
      project_id,
      opportunity_id,
      company_id,
      operation
    ) values (
      txid_current(),
      pg_backend_pid(),
      v_project_id,
      p_opportunity_id,
      p_company_id,
      'insert'
    );

    insert into public.projects (
      id,
      company_id,
      client_id,
      opportunity_id,
      opportunity_ref,
      title,
      title_is_auto,
      address,
      latitude,
      longitude,
      status,
      source,
      estimated_value,
      platform_metadata,
      notes,
      team_member_ids,
      created_by,
      created_at,
      updated_at
    ) values (
      v_project_id,
      p_company_id,
      v_opp.client_id,
      p_opportunity_id::text,
      p_opportunity_id,
      coalesce(p_title_override, 'New project'),
      p_title_override is null,
      v_opp.address,
      v_opp.latitude,
      v_opp.longitude,
      v_status,
      v_opp.source,
      v_value,
      v_platform,
      p_notes,
      array[]::text[],
      v_created_by,
      now(),
      now()
    );
  end if;

  update public.opportunities
     set project_ref = v_project_id,
         project_id = v_project_id,
         updated_at = now()
   where id = p_opportunity_id
     and company_id = p_company_id
     and (project_ref is null or project_ref = v_project_id)
     and (project_id is null or project_id = v_project_id);
  if not found then
    raise exception 'opportunity link update matched zero rows (concurrent conversion?)'
      using errcode = 'P0002';
  end if;

  -- Common idempotent conversion projections. This block intentionally runs
  -- for both first conversions and already-converted repair calls.
  update public.estimates
     set project_ref = v_project_id,
         project_id = v_project_id::text,
         updated_at = now()
   where opportunity_id = p_opportunity_id
     and company_id = p_company_id
     and deleted_at is null;
  get diagnostics v_relinked = row_count;

  insert into public.project_tasks (
    id,
    company_id,
    project_id,
    task_type_id,
    custom_title,
    source_line_item_id,
    source_estimate_id,
    status,
    display_order,
    duration,
    task_color,
    team_member_ids,
    created_at,
    updated_at
  )
  select
    gen_random_uuid(),
    p_company_id,
    v_project_id,
    li.task_type_ref,
    li.name,
    li.id::text,
    li.estimate_id::text,
    'active',
    coalesce(li.sort_order, 0),
    coalesce(tt.default_duration, 1),
    coalesce(tt.color, '#417394'),
    array[]::text[],
    now(),
    now()
  from public.line_items li
  left join public.task_types tt on tt.id = li.task_type_ref
  where li.estimate_id in (
    select e.id
      from public.estimates e
     where e.opportunity_id = p_opportunity_id
       and e.company_id = p_company_id
       and e.deleted_at is null
  )
    and li.company_id = p_company_id
    and li.type = 'LABOR'
    and not exists (
      select 1
        from public.project_tasks pt
       where pt.project_id = v_project_id
         and pt.source_line_item_id = li.id::text
    );
  get diagnostics v_tasks = row_count;

  insert into public.project_photos (
    id,
    project_id,
    company_id,
    url,
    source,
    site_visit_id,
    uploaded_by,
    taken_at,
    created_at
  )
  select
    gen_random_uuid(),
    v_project_id::text,
    p_company_id::text,
    photo_url,
    'site_visit',
    sv.id,
    sv.created_by,
    null,
    now()
  from public.site_visits sv
  cross join lateral unnest(coalesce(sv.photos, array[]::text[])) as photo_url
  where sv.opportunity_id = p_opportunity_id
    and sv.company_id = p_company_id::text
    and sv.deleted_at is null
    and photo_url is not null
    and photo_url <> ''
    and not exists (
      select 1
        from public.project_photos pp
       where pp.project_id = v_project_id::text
         and pp.site_visit_id = sv.id
         and pp.url = photo_url
    );
  get diagnostics v_photos = row_count;

  -- Lead-owned photos follow the opportunity onto the project. Deduplicate by
  -- URL across every source so a site-visit copy is never repeated.
  insert into public.project_photos (
    id,
    project_id,
    company_id,
    url,
    source,
    uploaded_by,
    taken_at,
    created_at
  )
  select
    gen_random_uuid(),
    v_project_id::text,
    p_company_id::text,
    lead_image_url,
    'other',
    coalesce(v_decided_by::text, ''),
    null,
    now()
  from unnest(coalesce(v_opp.images, array[]::text[])) as lead_image_url
  where lead_image_url is not null
    and lead_image_url <> ''
    and not exists (
      select 1
        from public.project_photos pp
       where pp.project_id = v_project_id::text
         and pp.url = lead_image_url
    );
  get diagnostics v_lead_photos = row_count;

  -- Re-parent only unparented lead decks; opportunity_id remains intact as
  -- provenance, and a deck already attached to another project is never stolen.
  update public.deck_designs
     set project_id = v_project_id,
         updated_at = now()
   where opportunity_id = p_opportunity_id
     and company_id = p_company_id
     and deleted_at is null
     and project_id is null;
  get diagnostics v_decks = row_count;

  if p_win_opportunity then
    if v_opp.stage is distinct from 'won' then
      update public.opportunities
         set stage = 'won',
             stage_entered_at = now(),
             stage_manually_set = true,
             actual_value = coalesce(p_actual_value, actual_value),
             actual_close_date = coalesce(actual_close_date, now()::date),
             updated_at = now()
       where id = p_opportunity_id
         and company_id = p_company_id;

      insert into public.stage_transitions (
        company_id,
        opportunity_id,
        from_stage,
        to_stage,
        transitioned_at,
        transitioned_by,
        duration_in_stage
      ) values (
        p_company_id,
        p_opportunity_id,
        v_opp.stage,
        'won',
        now(),
        v_decided_by,
        now() - coalesce(v_opp.stage_entered_at, now())
      );
      v_won := true;
    else
      update public.opportunities
         set actual_value = coalesce(p_actual_value, actual_value),
             updated_at = now()
       where id = p_opportunity_id
         and company_id = p_company_id;
    end if;
  end if;

  -- Keep the disposition idempotent on repair while healing older linked rows
  -- that never received a conversion disposition.
  select od.id
    into v_disposition_id
    from public.opportunity_dispositions od
   where od.opportunity_id = p_opportunity_id
     and od.company_id = p_company_id
     and od.disposition = 'converted_to_project'
     and od.converted_project_ref = v_project_id
   order by od.created_at desc, od.id desc
   limit 1
   for update;

  if v_disposition_id is null then
    update public.opportunity_dispositions
       set superseded_at = now()
     where opportunity_id = p_opportunity_id
       and company_id = p_company_id
       and superseded_at is null;

    insert into public.opportunity_dispositions (
      company_id,
      opportunity_id,
      disposition,
      reason_code,
      decided_via,
      decided_by,
      evidence,
      converted_project_ref
    ) values (
      p_company_id,
      p_opportunity_id,
      'converted_to_project',
      null,
      'project_conversion',
      v_decided_by,
      coalesce(p_evidence, '{}'::jsonb) || jsonb_build_object(
        'source_path', p_source_path,
        'actual_value', coalesce(
          p_actual_value,
          v_opp.actual_value,
          v_opp.estimated_value
        ),
        'relinked_estimates', v_relinked,
        'linked_existing', v_linked_existing,
        'already_converted', v_already_converted,
        'won', v_won
      ),
      v_project_id
    )
    returning id into v_disposition_id;
  end if;

  insert into public.opportunity_conversion_events (
    company_id,
    opportunity_id,
    project_id,
    event_type,
    actor_user_id,
    assignment_version,
    payload
  ) values (
    p_company_id,
    p_opportunity_id,
    v_project_id,
    'converted_to_project',
    v_decided_by,
    v_opp.assignment_version,
    jsonb_build_object(
      'source_path', p_source_path,
      'disposition_id', v_disposition_id,
      'linked_existing', v_linked_existing,
      'already_converted', v_already_converted,
      'won', v_won
    )
  )
  on conflict (opportunity_id, project_id, event_type) do nothing
  returning id into v_conversion_event_id;

  if v_conversion_event_id is null then
    select oce.id
      into v_conversion_event_id
      from public.opportunity_conversion_events oce
     where oce.opportunity_id = p_opportunity_id
       and oce.project_id = v_project_id
       and oce.event_type = 'converted_to_project';
  end if;

  return jsonb_build_object(
    'converted', not v_already_converted,
    'already_converted', v_already_converted,
    'guard_reason', case
      when v_already_converted then 'already_converted'
      else null
    end,
    'project_id', v_project_id,
    'opportunity_id', p_opportunity_id,
    'assigned_to', v_opp.assigned_to,
    'assignment_version', v_opp.assignment_version,
    'disposition_id', v_disposition_id,
    'conversion_event_id', v_conversion_event_id,
    'relinked_estimates', v_relinked,
    'materialized_tasks', v_tasks,
    'attached_photos', v_photos,
    'attached_lead_photos', v_lead_photos,
    'relinked_decks', v_decks,
    'linked_existing', v_linked_existing,
    'links_repaired', true,
    'won', v_won
  );
end;
$function$;

revoke all on function public.convert_opportunity_to_project(
  uuid,
  uuid,
  numeric,
  text,
  uuid,
  text,
  text,
  uuid,
  text,
  boolean,
  text,
  jsonb,
  bigint
) from public, anon, authenticated, service_role;
grant execute on function public.convert_opportunity_to_project(
  uuid,
  uuid,
  numeric,
  text,
  uuid,
  text,
  text,
  uuid,
  text,
  boolean,
  text,
  jsonb,
  bigint
) to authenticated, service_role;

commit;
