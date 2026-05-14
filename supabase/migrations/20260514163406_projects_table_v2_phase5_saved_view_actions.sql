begin;

create or replace function private.project_table_view_clean_name(p_name text)
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

create or replace function private.project_table_view_sanitize_definition(p_definition jsonb)
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
          'name',
          'status',
          'client',
          'client_email',
          'client_phone',
          'address',
          'team',
          'start_date',
          'end_date',
          'duration',
          'progress',
          'next_task',
          'task_count',
          'days_in_status',
          'estimate_total',
          'invoice_total',
          'paid_total',
          'value',
          'project_cost',
          'margin',
          'photos',
          'updated_at'
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
          'name',
          'status',
          'client',
          'client_email',
          'client_phone',
          'address',
          'team',
          'start_date',
          'end_date',
          'duration',
          'progress',
          'next_task',
          'task_count',
          'days_in_status',
          'estimate_total',
          'invoice_total',
          'paid_total',
          'value',
          'project_cost',
          'margin',
          'photos',
          'updated_at'
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

create or replace function private.project_table_view_default_definition(p_view public.project_views)
returns jsonb
language plpgsql
stable
set search_path = 'public', 'pg_temp'
as $$
begin
  if p_view.permission_key = 'projects.view_financials'
    or lower(p_view.name) = 'financial overview' then
    return jsonb_build_object(
      'columns', '[{"id":"name"},{"id":"status"},{"id":"value"},{"id":"project_cost"},{"id":"margin"},{"id":"invoice_total"},{"id":"paid_total"}]'::jsonb,
      'filters', '{"field":"status","op":"in","value":["accepted","in_progress","completed"]}'::jsonb,
      'sort', '[{"field":"value","direction":"desc"}]'::jsonb,
      'density', 'comfortable',
      'zoom_level', 1.00
    );
  end if;

  if lower(p_view.name) = 'my active work'
    or (p_view.icon = 'user-check' and p_view.sort_position = 0) then
    return jsonb_build_object(
      'columns', '[{"id":"name"},{"id":"status"},{"id":"client"},{"id":"end_date"},{"id":"next_task"},{"id":"progress"}]'::jsonb,
      'filters', '{"type":"dynamic","key":"current_user_assigned","and":[{"field":"status","op":"not_in","value":["closed","archived"]}]}'::jsonb,
      'sort', '[{"field":"end_date","direction":"asc"}]'::jsonb,
      'density', 'comfortable',
      'zoom_level', 1.00
    );
  end if;

  return jsonb_build_object(
    'columns', '[{"id":"name"},{"id":"status"},{"id":"client"},{"id":"team"},{"id":"start_date"},{"id":"end_date"},{"id":"progress"}]'::jsonb,
    'filters', '{"field":"status","op":"not_in","value":["closed","archived"]}'::jsonb,
    'sort', '[{"field":"updated_at","direction":"desc"}]'::jsonb,
    'density', 'comfortable',
    'zoom_level', 1.00
  );
end;
$$;

create or replace function public.create_project_table_view(
  p_name text,
  p_source_view_id uuid,
  p_definition jsonb
) returns public.project_views
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_current_user_id uuid;
  v_company_id uuid;
  v_name text;
  v_definition jsonb;
  v_source public.project_views%rowtype;
  v_view public.project_views%rowtype;
begin
  v_current_user_id := (select private.get_current_user_id());
  v_company_id := (select private.get_user_company_id());
  v_name := private.project_table_view_clean_name(p_name);
  v_definition := private.project_table_view_sanitize_definition(p_definition);

  if v_current_user_id is null or v_company_id is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if p_source_view_id is not null then
    select *
      into v_source
      from public.project_views
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

  insert into public.project_views (
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
      from public.project_views
      where company_id = v_company_id
        and owner_type = 'user'
        and owner_id = v_current_user_id
        and is_archived = false
    ), 100),
    coalesce(v_definition->'columns', v_source.columns, '[{"id":"name"},{"id":"status"},{"id":"client"},{"id":"team"},{"id":"start_date"},{"id":"end_date"},{"id":"progress"}]'::jsonb),
    coalesce(v_definition->'filters', v_source.filters, '{"field":"status","op":"not_in","value":["closed","archived"]}'::jsonb),
    coalesce(v_definition->'sort', v_source.sort, '[{"field":"updated_at","direction":"desc"}]'::jsonb),
    coalesce(v_definition->>'density', v_source.density, 'comfortable'),
    coalesce((v_definition->>'zoom_level')::numeric, v_source.zoom_level, 1.00),
    v_current_user_id
  )
  returning * into v_view;

  return v_view;
end;
$$;

create or replace function public.rename_project_table_view(
  p_view_id uuid,
  p_name text
) returns public.project_views
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_current_user_id uuid;
  v_company_id uuid;
  v_name text;
  v_existing public.project_views%rowtype;
  v_view public.project_views%rowtype;
begin
  v_current_user_id := (select private.get_current_user_id());
  v_company_id := (select private.get_user_company_id());
  v_name := private.project_table_view_clean_name(p_name);

  if v_current_user_id is null or v_company_id is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select *
    into v_existing
    from public.project_views
    where id = p_view_id
      and company_id = v_company_id
      and is_archived = false;

  if not found then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if v_existing.owner_type = 'company' then
    if not public.has_permission(v_current_user_id, 'projects.manage_views', 'all') then
      raise exception 'permission denied' using errcode = '42501';
    end if;
  elsif v_existing.owner_type <> 'user' or v_existing.owner_id <> v_current_user_id then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  update public.project_views
     set name = v_name
   where id = p_view_id
  returning * into v_view;

  return v_view;
end;
$$;

create or replace function public.archive_project_table_view(
  p_view_id uuid
) returns public.project_views
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_current_user_id uuid;
  v_company_id uuid;
  v_existing public.project_views%rowtype;
  v_view public.project_views%rowtype;
begin
  v_current_user_id := (select private.get_current_user_id());
  v_company_id := (select private.get_user_company_id());

  if v_current_user_id is null or v_company_id is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select *
    into v_existing
    from public.project_views
    where id = p_view_id
      and company_id = v_company_id
      and is_archived = false;

  if not found then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if v_existing.owner_type = 'company' then
    if not public.has_permission(v_current_user_id, 'projects.manage_views', 'all') then
      raise exception 'permission denied' using errcode = '42501';
    end if;
  elsif v_existing.owner_type <> 'user' or v_existing.owner_id <> v_current_user_id then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  update public.project_views
     set is_archived = true
   where id = p_view_id
  returning * into v_view;

  return v_view;
end;
$$;

create or replace function public.reset_project_table_view(
  p_view_id uuid
) returns public.project_views
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_current_user_id uuid;
  v_company_id uuid;
  v_existing public.project_views%rowtype;
  v_definition jsonb;
  v_view public.project_views%rowtype;
begin
  v_current_user_id := (select private.get_current_user_id());
  v_company_id := (select private.get_user_company_id());

  if v_current_user_id is null or v_company_id is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select *
    into v_existing
    from public.project_views
    where id = p_view_id
      and company_id = v_company_id
      and is_archived = false;

  if not found or not v_existing.is_default then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if v_existing.owner_type = 'company' then
    if not public.has_permission(v_current_user_id, 'projects.manage_views', 'all') then
      raise exception 'permission denied' using errcode = '42501';
    end if;
  elsif v_existing.owner_type <> 'user' or v_existing.owner_id <> v_current_user_id then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  v_definition := private.project_table_view_default_definition(v_existing);

  update public.project_views
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

create or replace function public.share_project_table_view(
  p_view_id uuid
) returns public.project_views
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_current_user_id uuid;
  v_company_id uuid;
  v_existing public.project_views%rowtype;
  v_view public.project_views%rowtype;
begin
  v_current_user_id := (select private.get_current_user_id());
  v_company_id := (select private.get_user_company_id());

  if v_current_user_id is null
    or v_company_id is null
    or not public.has_permission(v_current_user_id, 'projects.manage_views', 'all') then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select *
    into v_existing
    from public.project_views
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

  update public.project_views
     set owner_type = 'company',
         owner_id = v_company_id
   where id = p_view_id
  returning * into v_view;

  return v_view;
end;
$$;

create or replace function public.update_project_table_view_definition(
  p_view_id uuid,
  p_definition jsonb
) returns public.project_views
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_current_user_id uuid;
  v_company_id uuid;
  v_definition jsonb;
  v_existing public.project_views%rowtype;
  v_view public.project_views%rowtype;
begin
  v_current_user_id := (select private.get_current_user_id());
  v_company_id := (select private.get_user_company_id());
  v_definition := private.project_table_view_sanitize_definition(p_definition);

  if v_current_user_id is null or v_company_id is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select *
    into v_existing
    from public.project_views
    where id = p_view_id
      and company_id = v_company_id
      and is_archived = false;

  if not found then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if v_existing.owner_type = 'company' then
    if not public.has_permission(v_current_user_id, 'projects.manage_views', 'all') then
      raise exception 'permission denied' using errcode = '42501';
    end if;
  elsif v_existing.owner_type <> 'user' or v_existing.owner_id <> v_current_user_id then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  update public.project_views
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

revoke execute on function public.create_project_table_view(text, uuid, jsonb) from public;
revoke execute on function public.rename_project_table_view(uuid, text) from public;
revoke execute on function public.archive_project_table_view(uuid) from public;
revoke execute on function public.reset_project_table_view(uuid) from public;
revoke execute on function public.share_project_table_view(uuid) from public;
revoke execute on function public.update_project_table_view_definition(uuid, jsonb) from public;
revoke execute on function private.project_table_view_clean_name(text) from public, anon, authenticated;
revoke execute on function private.project_table_view_sanitize_definition(jsonb) from public, anon, authenticated;
revoke execute on function private.project_table_view_default_definition(public.project_views) from public, anon, authenticated;

grant execute on function public.create_project_table_view(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.rename_project_table_view(uuid, text) to anon, authenticated;
grant execute on function public.archive_project_table_view(uuid) to anon, authenticated;
grant execute on function public.reset_project_table_view(uuid) to anon, authenticated;
grant execute on function public.share_project_table_view(uuid) to anon, authenticated;
grant execute on function public.update_project_table_view_definition(uuid, jsonb) to anon, authenticated;

commit;
