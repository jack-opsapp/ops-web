begin;

-- ============================================================================
-- Pipeline Table View — opportunity saved views (Tasks 7.0 + 7.1)
--
-- Mirrors the proven public.project_views architecture (foundation migration
-- 20260512234121 + phase-5 saved-view actions 20260514163406 + firebase role
-- grants 20260513034650), adapted for opportunities (the pipeline).
--
-- Purely ADDITIVE: new permission rows, a new table, new indexes, a new
-- updated_at trigger binding, new RLS policies, new SECURITY DEFINER RPCs,
-- new private helpers, default-view seeds, and a new-company seed trigger.
-- Nothing existing is altered. iOS-safe.
--
-- Firebase/anon bridge: OPS-Web browser requests reach Postgres as the anon
-- role (Firebase JWT -> PostgREST), with private.get_current_user_id()
-- resolving identity from the JWT. So anon gets SELECT on the table and the
-- read policy is PUBLIC (no role clause); the 6 RPCs are SECURITY DEFINER and
-- executable by anon + authenticated. This bakes in the equivalent of the
-- project_views firebase-role-grants overlay from the start.
--
-- NOTE ON SEEDED FILTERS: the pipeline table data hook currently filters
-- in-memory and does NOT yet consume the stored `filters` JSON. The filter
-- blobs seeded below are structurally valid and forward-looking (they mirror
-- the project_views filter conventions) so they are ready when the hook starts
-- consuming them; they are not executed by the client today.
-- ============================================================================

-- ── 7.0 — Permission seed: pipeline.manage_views ────────────────────────────
-- Mirror of the project_views section E grant. Seed pipeline.manage_views for
-- exactly the roles that already hold projects.manage_views (global Admin +
-- Owner, company_id null). Idempotent on the (role_id, permission) unique key.
with target_roles as (
  select id, name
  from public.roles
  where company_id is null
    and name in ('Admin', 'Owner')
), grants as (
  select id as role_id, 'pipeline.manage_views'::text as permission, 'all'::text as scope
  from target_roles
  where name in ('Admin', 'Owner')
)
insert into public.role_permissions (role_id, permission, scope)
select role_id, permission, scope
from grants
on conflict (role_id, permission) do update
set scope = excluded.scope;

-- ── 7.1 — Saved views table ─────────────────────────────────────────────────
-- Identical column set to public.project_views, except permission_key is
-- constrained to NULL only: pipeline money is visible to anyone with
-- pipeline.view, so there is no per-view financial permission gate. The column
-- is retained (always NULL) for structural parity with project_views.
create table if not exists public.opportunity_views (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  owner_type text not null check (owner_type in ('company', 'user')),
  owner_id uuid not null,
  name text not null check (char_length(name) between 1 and 60),
  icon text check (icon is null or char_length(icon) <= 40),
  description text check (description is null or char_length(description) <= 240),
  permission_key text check (permission_key is null),
  is_default boolean not null default false,
  is_archived boolean not null default false,
  sort_position integer not null default 0,
  columns jsonb not null check (octet_length(columns::text) <= 32768),
  filters jsonb not null check (octet_length(filters::text) <= 16384),
  sort jsonb not null check (octet_length(sort::text) <= 4096),
  density text not null default 'comfortable' check (density in ('compact', 'comfortable', 'spacious')),
  zoom_level numeric(3,2) not null default 1.00 check (zoom_level >= 0.75 and zoom_level <= 1.50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users(id)
);

create unique index if not exists opportunity_views_unique_lower_name
  on public.opportunity_views (company_id, owner_type, owner_id, lower(name))
  where is_archived = false;

create index if not exists idx_opportunity_views_company
  on public.opportunity_views(company_id)
  where is_archived = false;

create index if not exists idx_opportunity_views_owner
  on public.opportunity_views(owner_type, owner_id)
  where is_archived = false;

-- Reuse the existing generic public.fn_set_updated_at() helper (do not redefine).
drop trigger if exists opportunity_views_set_updated_at on public.opportunity_views;
create trigger opportunity_views_set_updated_at
  before update on public.opportunity_views
  for each row execute function public.fn_set_updated_at();

alter table public.opportunity_views enable row level security;

-- Grants mirror the live project_views state: anon reads, authenticated full DML.
-- Supabase default privileges auto-grant full DML to anon on new public tables,
-- so revoke everything from anon first (exactly as the project_views foundation
-- migration does) before granting SELECT only. Without the revoke, anon would
-- retain INSERT/UPDATE/DELETE table privileges (RLS would still block writes via
-- the `to authenticated` manage policies, but the grant must match project_views
-- for defense-in-depth).
grant select, insert, update, delete on table public.opportunity_views to authenticated;
revoke all on table public.opportunity_views from anon;
grant select on table public.opportunity_views to anon;

-- ── RLS policies (mirror project_views, swap projects.manage_views -> pipeline.manage_views) ──

-- Read policy is PUBLIC (no `to` clause) so the anon Firebase bridge reads
-- through it. permission_key is always NULL for pipeline, so that clause is
-- effectively always-true, but it is kept for structural parity.
drop policy if exists "read company and own opportunity views" on public.opportunity_views;
create policy "read company and own opportunity views"
on public.opportunity_views for select
using (
  company_id = (select company_id from public.users where id = (select private.get_current_user_id()))
  and (
    owner_type = 'company'
    or (owner_type = 'user' and owner_id = (select private.get_current_user_id()))
  )
  and (
    permission_key is null
    or public.has_permission((select private.get_current_user_id()), permission_key, 'all')
  )
);

drop policy if exists "users manage own opportunity views" on public.opportunity_views;
create policy "users manage own opportunity views"
on public.opportunity_views for all
to authenticated
using (
  company_id = (select company_id from public.users where id = (select private.get_current_user_id()))
  and owner_type = 'user'
  and owner_id = (select private.get_current_user_id())
)
with check (
  company_id = (select company_id from public.users where id = (select private.get_current_user_id()))
  and owner_type = 'user'
  and owner_id = (select private.get_current_user_id())
  and (
    permission_key is null
    or public.has_permission((select private.get_current_user_id()), 'pipeline.manage_views', 'all')
  )
);

drop policy if exists "admins manage company opportunity views" on public.opportunity_views;
create policy "admins manage company opportunity views"
on public.opportunity_views for all
to authenticated
using (
  company_id = (select company_id from public.users where id = (select private.get_current_user_id()))
  and owner_type = 'company'
  and public.has_permission((select private.get_current_user_id()), 'pipeline.manage_views', 'all')
)
with check (
  company_id = (select company_id from public.users where id = (select private.get_current_user_id()))
  and owner_type = 'company'
  and public.has_permission((select private.get_current_user_id()), 'pipeline.manage_views', 'all')
);

-- ── Private helpers (mirror project_table_view_* with pipeline allowlists) ───

create or replace function private.opportunity_table_view_clean_name(p_name text)
returns text
language plpgsql
immutable
set search_path = 'public', 'pg_temp'
as $$
declare
  v_name text;
begin
  v_name := nullif(btrim(coalesce(p_name, '')), '');

  if v_name is null then
    raise exception 'view name is required' using errcode = '22023';
  end if;

  if char_length(v_name) > 60 then
    raise exception 'view name is too long' using errcode = '22023';
  end if;

  return v_name;
end;
$$;

-- Sanitizer column-id + sort-field allowlists are the PIPELINE ids from
-- PIPELINE_TABLE_COLUMN_IDS (src/lib/types/pipeline-table.ts). The column-id
-- allowlist is all 15 ids (including 'select'); the sort-field allowlist is the
-- 14 sortable ids (every column except 'select', per the registry's `sortable`
-- flags — note 'weighted' IS sortable).
create or replace function private.opportunity_table_view_sanitize_definition(p_definition jsonb)
returns jsonb
language plpgsql
immutable
set search_path = 'public', 'pg_temp'
as $$
declare
  v_key text;
  v_item jsonb;
  v_zoom_level numeric;
begin
  if p_definition is null then
    return '{}'::jsonb;
  end if;

  if jsonb_typeof(p_definition) <> 'object' then
    raise exception 'view definition must be an object' using errcode = '22023';
  end if;

  for v_key in select jsonb_object_keys(p_definition)
  loop
    if v_key not in ('columns', 'filters', 'sort', 'density', 'zoom_level') then
      raise exception 'invalid view definition key: %', v_key using errcode = '22023';
    end if;
  end loop;

  if p_definition ? 'columns' then
    if jsonb_typeof(p_definition->'columns') <> 'array' then
      raise exception 'columns must be an array' using errcode = '22023';
    end if;

    if octet_length((p_definition->'columns')::text) > 32768 then
      raise exception 'columns definition is too large' using errcode = '22023';
    end if;

    for v_item in select value from jsonb_array_elements(p_definition->'columns')
    loop
      if jsonb_typeof(v_item) <> 'object'
        or not (v_item ? 'id')
        or (v_item->>'id') not in (
          'select',
          'deal',
          'stage',
          'client',
          'value',
          'win_probability',
          'weighted',
          'age_in_stage',
          'last_activity',
          'next_follow_up',
          'expected_close',
          'assignee',
          'source',
          'priority',
          'correspondence'
        ) then
        raise exception 'invalid column id' using errcode = '22023';
      end if;
    end loop;
  end if;

  if p_definition ? 'filters' then
    if jsonb_typeof(p_definition->'filters') <> 'object' then
      raise exception 'filters must be an object' using errcode = '22023';
    end if;

    if octet_length((p_definition->'filters')::text) > 16384 then
      raise exception 'filters definition is too large' using errcode = '22023';
    end if;
  end if;

  if p_definition ? 'sort' then
    if jsonb_typeof(p_definition->'sort') <> 'array' then
      raise exception 'sort must be an array' using errcode = '22023';
    end if;

    if octet_length((p_definition->'sort')::text) > 4096 then
      raise exception 'sort definition is too large' using errcode = '22023';
    end if;

    for v_item in select value from jsonb_array_elements(p_definition->'sort')
    loop
      if jsonb_typeof(v_item) <> 'object'
        or not (v_item ? 'field')
        or not (v_item ? 'direction')
        or (v_item->>'field') not in (
          'deal',
          'stage',
          'client',
          'value',
          'win_probability',
          'weighted',
          'age_in_stage',
          'last_activity',
          'next_follow_up',
          'expected_close',
          'assignee',
          'source',
          'priority',
          'correspondence'
        )
        or (v_item->>'direction') not in ('asc', 'desc') then
        raise exception 'invalid sort definition' using errcode = '22023';
      end if;
    end loop;
  end if;

  if p_definition ? 'density' then
    if (p_definition->>'density') not in ('compact', 'comfortable', 'spacious') then
      raise exception 'invalid density' using errcode = '22023';
    end if;
  end if;

  if p_definition ? 'zoom_level' then
    if jsonb_typeof(p_definition->'zoom_level') <> 'number' then
      raise exception 'zoom_level must be numeric' using errcode = '22023';
    end if;

    v_zoom_level := (p_definition->>'zoom_level')::numeric;
    if v_zoom_level < 0.75 or v_zoom_level > 1.50 then
      raise exception 'zoom_level out of range' using errcode = '22023';
    end if;
  end if;

  return p_definition;
end;
$$;

-- Default-definition helper (used by reset). Maps each seeded default view back
-- to its canonical pipeline column/filter/sort set.
create or replace function private.opportunity_table_view_default_definition(p_view public.opportunity_views)
returns jsonb
language plpgsql
stable
set search_path = 'public', 'pg_temp'
as $$
begin
  if lower(p_view.name) = 'my open'
    or (p_view.icon = 'user-check' and p_view.sort_position = 0) then
    return jsonb_build_object(
      'columns', '[{"id":"deal"},{"id":"stage"},{"id":"client"},{"id":"value"},{"id":"weighted"},{"id":"age_in_stage"},{"id":"next_follow_up"},{"id":"assignee"}]'::jsonb,
      'filters', '{"type":"dynamic","key":"current_user_assigned","and":[{"field":"stage","op":"in","value":["new_lead","qualifying","quoting","quoted","follow_up","negotiation"]}]}'::jsonb,
      'sort', '[{"field":"next_follow_up","direction":"asc"}]'::jsonb,
      'density', 'comfortable',
      'zoom_level', 1.00
    );
  end if;

  if lower(p_view.name) = 'closing this month' then
    return jsonb_build_object(
      'columns', '[{"id":"deal"},{"id":"stage"},{"id":"client"},{"id":"value"},{"id":"win_probability"},{"id":"weighted"},{"id":"expected_close"},{"id":"assignee"}]'::jsonb,
      'filters', '{"field":"stage","op":"in","value":["quoting","quoted","follow_up","negotiation"]}'::jsonb,
      'sort', '[{"field":"expected_close","direction":"asc"}]'::jsonb,
      'density', 'comfortable',
      'zoom_level', 1.00
    );
  end if;

  if lower(p_view.name) = 'no next step' then
    return jsonb_build_object(
      'columns', '[{"id":"deal"},{"id":"stage"},{"id":"client"},{"id":"value"},{"id":"age_in_stage"},{"id":"next_follow_up"},{"id":"assignee"}]'::jsonb,
      'filters', '{"and":[{"field":"stage","op":"in","value":["new_lead","qualifying","quoting","quoted","follow_up","negotiation"]},{"field":"next_follow_up","op":"is_empty"}]}'::jsonb,
      'sort', '[{"field":"age_in_stage","direction":"desc"}]'::jsonb,
      'density', 'comfortable',
      'zoom_level', 1.00
    );
  end if;

  if lower(p_view.name) = 'stale' then
    return jsonb_build_object(
      'columns', '[{"id":"deal"},{"id":"stage"},{"id":"client"},{"id":"value"},{"id":"age_in_stage"},{"id":"last_activity"},{"id":"assignee"}]'::jsonb,
      'filters', '{"field":"stage","op":"in","value":["new_lead","qualifying","quoting","quoted","follow_up","negotiation"]}'::jsonb,
      'sort', '[{"field":"last_activity","direction":"asc"}]'::jsonb,
      'density', 'comfortable',
      'zoom_level', 1.00
    );
  end if;

  if lower(p_view.name) = 'overdue follow-up' then
    return jsonb_build_object(
      'columns', '[{"id":"deal"},{"id":"stage"},{"id":"client"},{"id":"value"},{"id":"next_follow_up"},{"id":"assignee"}]'::jsonb,
      'filters', '{"and":[{"field":"stage","op":"in","value":["new_lead","qualifying","quoting","quoted","follow_up","negotiation"]},{"field":"next_follow_up","op":"before_today"}]}'::jsonb,
      'sort', '[{"field":"next_follow_up","direction":"asc"}]'::jsonb,
      'density', 'comfortable',
      'zoom_level', 1.00
    );
  end if;

  -- Fallback: the lean default visible set for a fresh pipeline table.
  return jsonb_build_object(
    'columns', '[{"id":"deal"},{"id":"stage"},{"id":"client"},{"id":"value"},{"id":"weighted"},{"id":"age_in_stage"},{"id":"next_follow_up"},{"id":"assignee"}]'::jsonb,
    'filters', '{"field":"stage","op":"in","value":["new_lead","qualifying","quoting","quoted","follow_up","negotiation"]}'::jsonb,
    'sort', '[{"field":"next_follow_up","direction":"asc"}]'::jsonb,
    'density', 'comfortable',
    'zoom_level', 1.00
  );
end;
$$;

-- ── SECURITY DEFINER RPCs (mirror the 6 project_table_view actions) ──────────

create or replace function public.create_opportunity_table_view(
  p_name text,
  p_source_view_id uuid,
  p_definition jsonb
) returns public.opportunity_views
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_current_user_id uuid;
  v_company_id uuid;
  v_name text;
  v_definition jsonb;
  v_source public.opportunity_views%rowtype;
  v_view public.opportunity_views%rowtype;
begin
  v_current_user_id := (select private.get_current_user_id());
  v_company_id := (select private.get_user_company_id());
  v_name := private.opportunity_table_view_clean_name(p_name);
  v_definition := private.opportunity_table_view_sanitize_definition(p_definition);

  if v_current_user_id is null or v_company_id is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if p_source_view_id is not null then
    select *
      into v_source
      from public.opportunity_views
      where id = p_source_view_id
        and company_id = v_company_id
        and is_archived = false
        and (
          owner_type = 'company'
          or (owner_type = 'user' and owner_id = v_current_user_id)
        )
        and (
          permission_key is null
          or public.has_permission(v_current_user_id, permission_key, 'all')
        );

    if not found then
      raise exception 'permission denied' using errcode = '42501';
    end if;
  end if;

  insert into public.opportunity_views (
    company_id,
    owner_type,
    owner_id,
    name,
    icon,
    description,
    permission_key,
    is_default,
    is_archived,
    sort_position,
    columns,
    filters,
    sort,
    density,
    zoom_level,
    created_by
  )
  values (
    v_company_id,
    'user',
    v_current_user_id,
    v_name,
    v_source.icon,
    null,
    null,
    false,
    false,
    coalesce((
      select max(sort_position) + 1
      from public.opportunity_views
      where company_id = v_company_id
        and owner_type = 'user'
        and owner_id = v_current_user_id
        and is_archived = false
    ), 100),
    coalesce(v_definition->'columns', v_source.columns, '[{"id":"deal"},{"id":"stage"},{"id":"client"},{"id":"value"},{"id":"weighted"},{"id":"age_in_stage"},{"id":"next_follow_up"},{"id":"assignee"}]'::jsonb),
    coalesce(v_definition->'filters', v_source.filters, '{"field":"stage","op":"in","value":["new_lead","qualifying","quoting","quoted","follow_up","negotiation"]}'::jsonb),
    coalesce(v_definition->'sort', v_source.sort, '[{"field":"next_follow_up","direction":"asc"}]'::jsonb),
    coalesce(v_definition->>'density', v_source.density, 'comfortable'),
    coalesce((v_definition->>'zoom_level')::numeric, v_source.zoom_level, 1.00),
    v_current_user_id
  )
  returning * into v_view;

  return v_view;
end;
$$;

create or replace function public.rename_opportunity_table_view(
  p_view_id uuid,
  p_name text
) returns public.opportunity_views
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_current_user_id uuid;
  v_company_id uuid;
  v_name text;
  v_existing public.opportunity_views%rowtype;
  v_view public.opportunity_views%rowtype;
begin
  v_current_user_id := (select private.get_current_user_id());
  v_company_id := (select private.get_user_company_id());
  v_name := private.opportunity_table_view_clean_name(p_name);

  if v_current_user_id is null or v_company_id is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select *
    into v_existing
    from public.opportunity_views
    where id = p_view_id
      and company_id = v_company_id
      and is_archived = false;

  if not found then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if v_existing.owner_type = 'company' then
    if not public.has_permission(v_current_user_id, 'pipeline.manage_views', 'all') then
      raise exception 'permission denied' using errcode = '42501';
    end if;
  elsif v_existing.owner_type <> 'user' or v_existing.owner_id <> v_current_user_id then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  update public.opportunity_views
     set name = v_name
   where id = p_view_id
  returning * into v_view;

  return v_view;
end;
$$;

create or replace function public.archive_opportunity_table_view(
  p_view_id uuid
) returns public.opportunity_views
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_current_user_id uuid;
  v_company_id uuid;
  v_existing public.opportunity_views%rowtype;
  v_view public.opportunity_views%rowtype;
begin
  v_current_user_id := (select private.get_current_user_id());
  v_company_id := (select private.get_user_company_id());

  if v_current_user_id is null or v_company_id is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select *
    into v_existing
    from public.opportunity_views
    where id = p_view_id
      and company_id = v_company_id
      and is_archived = false;

  if not found then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if v_existing.owner_type = 'company' then
    if not public.has_permission(v_current_user_id, 'pipeline.manage_views', 'all') then
      raise exception 'permission denied' using errcode = '42501';
    end if;
  elsif v_existing.owner_type <> 'user' or v_existing.owner_id <> v_current_user_id then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  update public.opportunity_views
     set is_archived = true
   where id = p_view_id
  returning * into v_view;

  return v_view;
end;
$$;

create or replace function public.reset_opportunity_table_view(
  p_view_id uuid
) returns public.opportunity_views
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_current_user_id uuid;
  v_company_id uuid;
  v_existing public.opportunity_views%rowtype;
  v_definition jsonb;
  v_view public.opportunity_views%rowtype;
begin
  v_current_user_id := (select private.get_current_user_id());
  v_company_id := (select private.get_user_company_id());

  if v_current_user_id is null or v_company_id is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select *
    into v_existing
    from public.opportunity_views
    where id = p_view_id
      and company_id = v_company_id
      and is_archived = false;

  if not found or not v_existing.is_default then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if v_existing.owner_type = 'company' then
    if not public.has_permission(v_current_user_id, 'pipeline.manage_views', 'all') then
      raise exception 'permission denied' using errcode = '42501';
    end if;
  elsif v_existing.owner_type <> 'user' or v_existing.owner_id <> v_current_user_id then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  v_definition := private.opportunity_table_view_default_definition(v_existing);

  update public.opportunity_views
     set columns = v_definition->'columns',
         filters = v_definition->'filters',
         sort = v_definition->'sort',
         density = v_definition->>'density',
         zoom_level = (v_definition->>'zoom_level')::numeric
   where id = p_view_id
  returning * into v_view;

  return v_view;
end;
$$;

create or replace function public.share_opportunity_table_view(
  p_view_id uuid
) returns public.opportunity_views
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_current_user_id uuid;
  v_company_id uuid;
  v_existing public.opportunity_views%rowtype;
  v_view public.opportunity_views%rowtype;
begin
  v_current_user_id := (select private.get_current_user_id());
  v_company_id := (select private.get_user_company_id());

  if v_current_user_id is null
    or v_company_id is null
    or not public.has_permission(v_current_user_id, 'pipeline.manage_views', 'all') then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select *
    into v_existing
    from public.opportunity_views
    where id = p_view_id
      and company_id = v_company_id
      and is_archived = false
      and (
        owner_type = 'company'
        or (owner_type = 'user' and owner_id = v_current_user_id)
      );

  if not found then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  update public.opportunity_views
     set owner_type = 'company',
         owner_id = v_company_id
   where id = p_view_id
  returning * into v_view;

  return v_view;
end;
$$;

create or replace function public.update_opportunity_table_view_definition(
  p_view_id uuid,
  p_definition jsonb
) returns public.opportunity_views
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_current_user_id uuid;
  v_company_id uuid;
  v_definition jsonb;
  v_existing public.opportunity_views%rowtype;
  v_view public.opportunity_views%rowtype;
begin
  v_current_user_id := (select private.get_current_user_id());
  v_company_id := (select private.get_user_company_id());
  v_definition := private.opportunity_table_view_sanitize_definition(p_definition);

  if v_current_user_id is null or v_company_id is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select *
    into v_existing
    from public.opportunity_views
    where id = p_view_id
      and company_id = v_company_id
      and is_archived = false;

  if not found then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if v_existing.owner_type = 'company' then
    if not public.has_permission(v_current_user_id, 'pipeline.manage_views', 'all') then
      raise exception 'permission denied' using errcode = '42501';
    end if;
  elsif v_existing.owner_type <> 'user' or v_existing.owner_id <> v_current_user_id then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  update public.opportunity_views
     set columns = coalesce(v_definition->'columns', columns),
         filters = coalesce(v_definition->'filters', filters),
         sort = coalesce(v_definition->'sort', sort),
         density = coalesce(v_definition->>'density', density),
         zoom_level = coalesce((v_definition->>'zoom_level')::numeric, zoom_level)
   where id = p_view_id
  returning * into v_view;

  return v_view;
end;
$$;

-- Execute grants: SECURITY DEFINER RPCs callable by anon (Firebase bridge) +
-- authenticated; private helpers locked down. Mirrors the project_views block.
revoke execute on function public.create_opportunity_table_view(text, uuid, jsonb) from public;
revoke execute on function public.rename_opportunity_table_view(uuid, text) from public;
revoke execute on function public.archive_opportunity_table_view(uuid) from public;
revoke execute on function public.reset_opportunity_table_view(uuid) from public;
revoke execute on function public.share_opportunity_table_view(uuid) from public;
revoke execute on function public.update_opportunity_table_view_definition(uuid, jsonb) from public;
revoke execute on function private.opportunity_table_view_clean_name(text) from public, anon, authenticated;
revoke execute on function private.opportunity_table_view_sanitize_definition(jsonb) from public, anon, authenticated;
revoke execute on function private.opportunity_table_view_default_definition(public.opportunity_views) from public, anon, authenticated;

grant execute on function public.create_opportunity_table_view(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.rename_opportunity_table_view(uuid, text) to anon, authenticated;
grant execute on function public.archive_opportunity_table_view(uuid) to anon, authenticated;
grant execute on function public.reset_opportunity_table_view(uuid) to anon, authenticated;
grant execute on function public.share_opportunity_table_view(uuid) to anon, authenticated;
grant execute on function public.update_opportunity_table_view_definition(uuid, jsonb) to anon, authenticated;

-- ── Default views seed — existing companies (mirror project_views section K) ──
-- 5 default company-scoped pipeline views per active company, idempotent on the
-- unique (company_id, owner_type, owner_id, lower(name)) index.
with company_rows as (
  select id from public.companies where deleted_at is null
), default_views as (
  -- MY OPEN
  select
    id as company_id,
    'company'::text as owner_type,
    id as owner_id,
    'MY OPEN'::text as name,
    'user-check'::text as icon,
    0 as sort_position,
    '[{"id":"deal"},{"id":"stage"},{"id":"client"},{"id":"value"},{"id":"weighted"},{"id":"age_in_stage"},{"id":"next_follow_up"},{"id":"assignee"}]'::jsonb as columns,
    '{"type":"dynamic","key":"current_user_assigned","and":[{"field":"stage","op":"in","value":["new_lead","qualifying","quoting","quoted","follow_up","negotiation"]}]}'::jsonb as filters,
    '[{"field":"next_follow_up","direction":"asc"}]'::jsonb as sort
  from company_rows
  union all
  -- CLOSING THIS MONTH
  select
    id, 'company', id, 'CLOSING THIS MONTH', 'calendar', 1,
    '[{"id":"deal"},{"id":"stage"},{"id":"client"},{"id":"value"},{"id":"win_probability"},{"id":"weighted"},{"id":"expected_close"},{"id":"assignee"}]'::jsonb,
    '{"field":"stage","op":"in","value":["quoting","quoted","follow_up","negotiation"]}'::jsonb,
    '[{"field":"expected_close","direction":"asc"}]'::jsonb
  from company_rows
  union all
  -- NO NEXT STEP
  select
    id, 'company', id, 'NO NEXT STEP', 'warning', 2,
    '[{"id":"deal"},{"id":"stage"},{"id":"client"},{"id":"value"},{"id":"age_in_stage"},{"id":"next_follow_up"},{"id":"assignee"}]'::jsonb,
    '{"and":[{"field":"stage","op":"in","value":["new_lead","qualifying","quoting","quoted","follow_up","negotiation"]},{"field":"next_follow_up","op":"is_empty"}]}'::jsonb,
    '[{"field":"age_in_stage","direction":"desc"}]'::jsonb
  from company_rows
  union all
  -- STALE
  select
    id, 'company', id, 'STALE', 'time', 3,
    '[{"id":"deal"},{"id":"stage"},{"id":"client"},{"id":"value"},{"id":"age_in_stage"},{"id":"last_activity"},{"id":"assignee"}]'::jsonb,
    '{"field":"stage","op":"in","value":["new_lead","qualifying","quoting","quoted","follow_up","negotiation"]}'::jsonb,
    '[{"field":"last_activity","direction":"asc"}]'::jsonb
  from company_rows
  union all
  -- OVERDUE FOLLOW-UP
  select
    id, 'company', id, 'OVERDUE FOLLOW-UP', 'notification', 4,
    '[{"id":"deal"},{"id":"stage"},{"id":"client"},{"id":"value"},{"id":"next_follow_up"},{"id":"assignee"}]'::jsonb,
    '{"and":[{"field":"stage","op":"in","value":["new_lead","qualifying","quoting","quoted","follow_up","negotiation"]},{"field":"next_follow_up","op":"before_today"}]}'::jsonb,
    '[{"field":"next_follow_up","direction":"asc"}]'::jsonb
  from company_rows
)
insert into public.opportunity_views (
  company_id,
  owner_type,
  owner_id,
  name,
  icon,
  permission_key,
  is_default,
  sort_position,
  columns,
  filters,
  sort,
  density,
  zoom_level,
  created_by
)
select
  company_id,
  owner_type,
  owner_id,
  name,
  icon,
  null,
  true,
  sort_position,
  columns,
  filters,
  sort,
  'comfortable',
  1.00,
  null
from default_views
on conflict (company_id, owner_type, owner_id, lower(name)) where is_archived = false
do nothing;

-- ── Default views seed — new companies (mirror project_views section L) ───────
create or replace function private.seed_default_opportunity_views_for_company()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
begin
  if new.deleted_at is not null then
    return new;
  end if;

  insert into public.opportunity_views (
    company_id,
    owner_type,
    owner_id,
    name,
    icon,
    permission_key,
    is_default,
    sort_position,
    columns,
    filters,
    sort,
    density,
    zoom_level,
    created_by
  )
  values
    (
      new.id,
      'company',
      new.id,
      'MY OPEN',
      'user-check',
      null,
      true,
      0,
      '[{"id":"deal"},{"id":"stage"},{"id":"client"},{"id":"value"},{"id":"weighted"},{"id":"age_in_stage"},{"id":"next_follow_up"},{"id":"assignee"}]'::jsonb,
      '{"type":"dynamic","key":"current_user_assigned","and":[{"field":"stage","op":"in","value":["new_lead","qualifying","quoting","quoted","follow_up","negotiation"]}]}'::jsonb,
      '[{"field":"next_follow_up","direction":"asc"}]'::jsonb,
      'comfortable',
      1.00,
      null
    ),
    (
      new.id,
      'company',
      new.id,
      'CLOSING THIS MONTH',
      'calendar',
      null,
      true,
      1,
      '[{"id":"deal"},{"id":"stage"},{"id":"client"},{"id":"value"},{"id":"win_probability"},{"id":"weighted"},{"id":"expected_close"},{"id":"assignee"}]'::jsonb,
      '{"field":"stage","op":"in","value":["quoting","quoted","follow_up","negotiation"]}'::jsonb,
      '[{"field":"expected_close","direction":"asc"}]'::jsonb,
      'comfortable',
      1.00,
      null
    ),
    (
      new.id,
      'company',
      new.id,
      'NO NEXT STEP',
      'warning',
      null,
      true,
      2,
      '[{"id":"deal"},{"id":"stage"},{"id":"client"},{"id":"value"},{"id":"age_in_stage"},{"id":"next_follow_up"},{"id":"assignee"}]'::jsonb,
      '{"and":[{"field":"stage","op":"in","value":["new_lead","qualifying","quoting","quoted","follow_up","negotiation"]},{"field":"next_follow_up","op":"is_empty"}]}'::jsonb,
      '[{"field":"age_in_stage","direction":"desc"}]'::jsonb,
      'comfortable',
      1.00,
      null
    ),
    (
      new.id,
      'company',
      new.id,
      'STALE',
      'time',
      null,
      true,
      3,
      '[{"id":"deal"},{"id":"stage"},{"id":"client"},{"id":"value"},{"id":"age_in_stage"},{"id":"last_activity"},{"id":"assignee"}]'::jsonb,
      '{"field":"stage","op":"in","value":["new_lead","qualifying","quoting","quoted","follow_up","negotiation"]}'::jsonb,
      '[{"field":"last_activity","direction":"asc"}]'::jsonb,
      'comfortable',
      1.00,
      null
    ),
    (
      new.id,
      'company',
      new.id,
      'OVERDUE FOLLOW-UP',
      'notification',
      null,
      true,
      4,
      '[{"id":"deal"},{"id":"stage"},{"id":"client"},{"id":"value"},{"id":"next_follow_up"},{"id":"assignee"}]'::jsonb,
      '{"and":[{"field":"stage","op":"in","value":["new_lead","qualifying","quoting","quoted","follow_up","negotiation"]},{"field":"next_follow_up","op":"before_today"}]}'::jsonb,
      '[{"field":"next_follow_up","direction":"asc"}]'::jsonb,
      'comfortable',
      1.00,
      null
    )
  on conflict (company_id, owner_type, owner_id, lower(name)) where is_archived = false
  do nothing;

  return new;
end;
$$;

drop trigger if exists companies_seed_default_opportunity_views on public.companies;
create trigger companies_seed_default_opportunity_views
  after insert on public.companies
  for each row execute function private.seed_default_opportunity_views_for_company();

commit;
