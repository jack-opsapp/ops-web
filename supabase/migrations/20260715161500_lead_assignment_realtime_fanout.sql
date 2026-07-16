-- Lead assignment events refresh company-wide viewers. Addressed delivery rows
-- remain the revocation channel for an old assigned-only operator after the
-- opportunity itself and its event become invisible under RLS.

begin;

-- Permission changes are also access-revocation events. A recipient-addressed
-- durable row lets an already-open browser synchronously destroy sensitive
-- lead and inbox caches before it refreshes its effective permission set.
create table if not exists public.user_permission_change_deliveries (
  id uuid primary key default gen_random_uuid(),
  transaction_id bigint not null default txid_current(),
  company_id uuid not null
    references public.companies(id) on delete cascade,
  recipient_user_id uuid not null
    references public.users(id) on delete cascade,
  change_kind text not null
    check (change_kind in (
      'role_permission',
      'user_role',
      'user_override',
      'user_authority',
      'company_authority',
      'multiple'
    )),
  changed_at timestamptz not null default clock_timestamp(),
  unique (transaction_id, recipient_user_id)
);

create index if not exists user_permission_change_deliveries_recipient_idx
  on public.user_permission_change_deliveries (
    recipient_user_id,
    changed_at desc,
    id desc
  );

alter table public.user_permission_change_deliveries enable row level security;

drop policy if exists user_permission_change_deliveries_recipient_select
  on public.user_permission_change_deliveries;
create policy user_permission_change_deliveries_recipient_select
  on public.user_permission_change_deliveries
  for select
  to authenticated
  using (recipient_user_id = private.get_current_user_id());

revoke all on table public.user_permission_change_deliveries
  from public, anon, authenticated, service_role;
grant select on table public.user_permission_change_deliveries
  to authenticated;
revoke insert, update, delete on table public.user_permission_change_deliveries
  from authenticated, service_role;

create or replace function private.permission_delivery_user_id(
  p_value text
) returns uuid
language plpgsql
immutable
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if p_value is null or btrim(p_value) = '' then
    return null;
  end if;
  return p_value::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$function$;

revoke all on function private.permission_delivery_user_id(text)
  from public, anon, authenticated, service_role;

create or replace function private.enqueue_user_permission_change(
  p_user_id uuid,
  p_company_id uuid,
  p_change_kind text
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if p_user_id is null
    or p_company_id is null
    or p_change_kind not in (
      'role_permission',
      'user_role',
      'user_override',
      'user_authority',
      'company_authority'
    )
    or not exists (
      select 1
        from public.users u
       where u.id = p_user_id
    )
    or not exists (
      select 1
        from public.companies c
       where c.id = p_company_id
    )
  then
    return;
  end if;

  insert into public.user_permission_change_deliveries (
    transaction_id,
    company_id,
    recipient_user_id,
    change_kind
  ) values (
    txid_current(),
    p_company_id,
    p_user_id,
    p_change_kind
  )
  on conflict (transaction_id, recipient_user_id) do update
    set company_id = excluded.company_id,
        change_kind = case
          when user_permission_change_deliveries.change_kind = excluded.change_kind
            then excluded.change_kind
          else 'multiple'
        end,
        changed_at = clock_timestamp();
end;
$function$;

revoke all on function private.enqueue_user_permission_change(uuid, uuid, text)
  from public, anon, authenticated, service_role;

create or replace function private.enqueue_role_permission_change()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_role_ids uuid[] := array[]::uuid[];
  v_member record;
begin
  if tg_op <> 'INSERT' then
    v_role_ids := array_append(v_role_ids, old.role_id);
  end if;
  if tg_op <> 'DELETE' then
    v_role_ids := array_append(v_role_ids, new.role_id);
  end if;

  for v_member in
    select distinct u.id, u.company_id
      from public.user_roles ur
      join public.users u
        on u.id = private.permission_delivery_user_id(ur.user_id)
     where ur.role_id = any(v_role_ids)
       and u.company_id is not null
  loop
    perform private.enqueue_user_permission_change(
      v_member.id,
      v_member.company_id,
      'role_permission'
    );
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

create or replace function private.enqueue_user_role_change()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_user_ids uuid[] := array[]::uuid[];
  v_member record;
begin
  if tg_op <> 'INSERT' then
    v_user_ids := array_append(
      v_user_ids,
      private.permission_delivery_user_id(old.user_id)
    );
  end if;
  if tg_op <> 'DELETE' then
    v_user_ids := array_append(
      v_user_ids,
      private.permission_delivery_user_id(new.user_id)
    );
  end if;

  for v_member in
    select distinct u.id, u.company_id
      from public.users u
     where u.id = any(v_user_ids)
       and u.company_id is not null
  loop
    perform private.enqueue_user_permission_change(
      v_member.id,
      v_member.company_id,
      'user_role'
    );
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

create or replace function private.enqueue_user_override_change()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if tg_op <> 'INSERT' then
    perform private.enqueue_user_permission_change(
      old.user_id,
      old.company_id,
      'user_override'
    );
  end if;
  if tg_op <> 'DELETE' then
    perform private.enqueue_user_permission_change(
      new.user_id,
      new.company_id,
      'user_override'
    );
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

create or replace function private.enqueue_user_authority_change()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if old.company_id is not null then
    perform private.enqueue_user_permission_change(
      old.id,
      old.company_id,
      'user_authority'
    );
  end if;
  if new.company_id is not null then
    perform private.enqueue_user_permission_change(
      new.id,
      new.company_id,
      'user_authority'
    );
  end if;
  return new;
end;
$function$;

create or replace function private.enqueue_company_authority_change()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_user_id uuid;
begin
  for v_user_id in
    select distinct private.permission_delivery_user_id(candidate.user_id)
      from unnest(
        array[old.account_holder_id, new.account_holder_id]
        || coalesce(old.admin_ids, '{}'::text[])
        || coalesce(new.admin_ids, '{}'::text[])
      ) candidate(user_id)
     where private.permission_delivery_user_id(candidate.user_id) is not null
  loop
    perform private.enqueue_user_permission_change(
      v_user_id,
      new.id,
      'company_authority'
    );
  end loop;
  return new;
end;
$function$;

revoke all on function private.enqueue_role_permission_change()
  from public, anon, authenticated, service_role;
revoke all on function private.enqueue_user_role_change()
  from public, anon, authenticated, service_role;
revoke all on function private.enqueue_user_override_change()
  from public, anon, authenticated, service_role;
revoke all on function private.enqueue_user_authority_change()
  from public, anon, authenticated, service_role;
revoke all on function private.enqueue_company_authority_change()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_enqueue_role_permission_change
  on public.role_permissions;
create trigger trg_enqueue_role_permission_change
after insert or update or delete on public.role_permissions
for each row execute function private.enqueue_role_permission_change();

drop trigger if exists trg_enqueue_user_role_change
  on public.user_roles;
create trigger trg_enqueue_user_role_change
after insert or update or delete on public.user_roles
for each row execute function private.enqueue_user_role_change();

drop trigger if exists trg_enqueue_user_override_change
  on public.user_permission_overrides;
create trigger trg_enqueue_user_override_change
after insert or update or delete on public.user_permission_overrides
for each row execute function private.enqueue_user_override_change();

drop trigger if exists trg_enqueue_user_authority_change
  on public.users;
create trigger trg_enqueue_user_authority_change
after update of company_id, is_company_admin, is_active, deleted_at
  on public.users
for each row
when (
  old.company_id is distinct from new.company_id
  or old.is_company_admin is distinct from new.is_company_admin
  or old.is_active is distinct from new.is_active
  or old.deleted_at is distinct from new.deleted_at
)
execute function private.enqueue_user_authority_change();

drop trigger if exists trg_enqueue_company_authority_change
  on public.companies;
create trigger trg_enqueue_company_authority_change
after update of account_holder_id, admin_ids on public.companies
for each row
when (
  old.account_holder_id is distinct from new.account_holder_id
  or old.admin_ids is distinct from new.admin_ids
)
execute function private.enqueue_company_authority_change();

do $do$
begin
  if exists (
    select 1
      from pg_catalog.pg_publication
     where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
      from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'opportunity_assignment_events'
  ) then
    execute 'alter publication supabase_realtime add table public.opportunity_assignment_events';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_publication
     where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
      from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'opportunity_assignment_deliveries'
  ) then
    execute 'alter publication supabase_realtime add table public.opportunity_assignment_deliveries';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_publication
     where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
      from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'user_permission_change_deliveries'
  ) then
    execute 'alter publication supabase_realtime add table public.user_permission_change_deliveries';
  end if;
end
$do$;

commit;
