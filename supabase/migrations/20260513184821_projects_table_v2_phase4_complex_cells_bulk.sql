begin;

-- OPS-Web browser sessions arrive at PostgREST as anon with Firebase claims.
-- These RPCs are SECURITY DEFINER and enforce scoped project permissions inside
-- the function, so exposing EXECUTE to anon is the required safe browser path.
revoke execute on function public.assign_project_team_member(uuid, uuid, uuid[], timestamptz) from public;
revoke execute on function public.remove_project_team_member(uuid, uuid, uuid[], timestamptz) from public;
grant execute on function public.assign_project_team_member(uuid, uuid, uuid[], timestamptz) to anon, authenticated;
grant execute on function public.remove_project_team_member(uuid, uuid, uuid[], timestamptz) to anon, authenticated;

-- Live preflight showed broad direct table privileges. Keep Phase 4 browser
-- writes on the narrow RPC/storage/photo paths only.
revoke all privileges on table public.project_photos from anon, authenticated;
grant select, insert on table public.project_photos to anon, authenticated;
grant update (deleted_at, caption, is_client_visible) on table public.project_photos to anon, authenticated;

revoke insert on table public.project_tasks from anon;
grant select on table public.project_tasks to anon, authenticated;
grant select on table public.users to anon, authenticated;

create or replace function private.project_table_project_id_from_text(p_project_id text)
returns uuid
language sql
stable
security definer
set search_path = 'public', 'pg_temp'
as $$
  select case
    when p_project_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then p_project_id::uuid
    else null
  end;
$$;

grant execute on function private.project_table_project_id_from_text(text) to anon, authenticated;

drop policy if exists "project table photos insert requires project edit" on public.project_photos;
create policy "project table photos insert requires project edit"
on public.project_photos
as restrictive
for insert
to public
with check (
  company_id = (select private.get_user_company_id())::text
  and uploaded_by = (select private.get_current_user_id())::text
  and private.project_table_project_id_from_text(project_id) is not null
  and private.current_user_can_edit_project(private.project_table_project_id_from_text(project_id))
);

drop policy if exists "project table photos update requires project edit" on public.project_photos;
create policy "project table photos update requires project edit"
on public.project_photos
as restrictive
for update
to public
using (
  company_id = (select private.get_user_company_id())::text
  and private.project_table_project_id_from_text(project_id) is not null
  and private.current_user_can_edit_project(private.project_table_project_id_from_text(project_id))
)
with check (
  company_id = (select private.get_user_company_id())::text
  and private.project_table_project_id_from_text(project_id) is not null
  and private.current_user_can_edit_project(private.project_table_project_id_from_text(project_id))
);

drop policy if exists "project table photos delete denied" on public.project_photos;
create policy "project table photos delete denied"
on public.project_photos
as restrictive
for delete
to public
using (false);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-photos',
  'project-photos',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Anyone can view project photos" on storage.objects;
drop policy if exists "project photos select public" on storage.objects;
create policy "project photos select public"
on storage.objects
for select
to public
using (bucket_id = 'project-photos');

drop policy if exists "project photos insert scoped" on storage.objects;
create policy "project photos insert scoped"
on storage.objects
for insert
to public
with check (
  bucket_id = 'project-photos'
  and (storage.foldername(name))[1] = (select private.get_user_company_id())::text
  and private.project_table_project_id_from_text((storage.foldername(name))[2]) is not null
  and private.current_user_can_edit_project(private.project_table_project_id_from_text((storage.foldername(name))[2]))
);

drop policy if exists "project photos delete scoped" on storage.objects;
create policy "project photos delete scoped"
on storage.objects
for delete
to public
using (
  bucket_id = 'project-photos'
  and (storage.foldername(name))[1] = (select private.get_user_company_id())::text
  and private.project_table_project_id_from_text((storage.foldername(name))[2]) is not null
  and private.current_user_can_edit_project(private.project_table_project_id_from_text((storage.foldername(name))[2]))
);

create or replace function public.create_project_table_assignment_task(
  p_project_id uuid,
  p_title text,
  p_expected_updated_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_company_id uuid;
  v_current_updated_at timestamptz;
  v_task_id uuid;
begin
  if p_project_id is null or p_expected_updated_at is null then
    raise exception 'invalid input' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_title, '')), '') is null then
    raise exception 'task title required' using errcode = '22023';
  end if;

  select p.company_id, p.updated_at
    into v_company_id, v_current_updated_at
  from public.projects p
  where p.id = p_project_id
    and p.deleted_at is null
    and p.company_id = (select private.get_user_company_id())
  for update;

  if v_company_id is null then
    raise exception 'project not found' using errcode = '22023';
  end if;

  if not private.current_user_can_assign_team_on_project(p_project_id) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if v_current_updated_at is distinct from p_expected_updated_at then
    raise exception 'project conflict' using errcode = 'P0001';
  end if;

  insert into public.project_tasks (
    project_id,
    company_id,
    custom_title,
    status,
    display_order,
    team_member_ids
  )
  values (
    p_project_id,
    v_company_id,
    btrim(p_title),
    'active',
    coalesce((
      select max(pt.display_order) + 1
      from public.project_tasks pt
      where pt.project_id = p_project_id
        and pt.deleted_at is null
    ), 0),
    array[]::text[]
  )
  returning id into v_task_id;

  select p.updated_at
    into v_current_updated_at
  from public.projects p
  where p.id = p_project_id;

  return jsonb_build_object(
    'task_id', v_task_id,
    'updated_at', v_current_updated_at
  );
end;
$$;

revoke execute on function public.create_project_table_assignment_task(uuid, text, timestamptz) from public;
grant execute on function public.create_project_table_assignment_task(uuid, text, timestamptz) to anon, authenticated;

create or replace function public.bulk_update_project_table(
  p_operations jsonb
) returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_operation jsonb;
  v_action text;
  v_project_id uuid;
  v_expected_updated_at timestamptz;
  v_success jsonb := '[]'::jsonb;
  v_failed jsonb := '[]'::jsonb;
  v_result jsonb;
  v_updated_at timestamptz;
begin
  if p_operations is null or jsonb_typeof(p_operations) <> 'array' then
    raise exception 'invalid operations' using errcode = '22023';
  end if;

  if jsonb_array_length(p_operations) > 100 then
    raise exception 'too many operations' using errcode = '22023';
  end if;

  for v_operation in select * from jsonb_array_elements(p_operations)
  loop
    begin
      v_action := v_operation->>'action';
      v_project_id := (v_operation->>'project_id')::uuid;
      v_expected_updated_at := (v_operation->>'expected_updated_at')::timestamptz;

      if v_project_id is null or v_expected_updated_at is null then
        raise exception 'invalid operation' using errcode = '22023';
      end if;

      if v_action = 'status' then
        v_result := public.change_project_status(
          v_project_id,
          v_operation->>'status',
          v_expected_updated_at
        );
        v_updated_at := (v_result->>'updated_at')::timestamptz;

      elsif v_action = 'date' then
        if (v_operation->>'field') not in ('start_date', 'end_date') then
          raise exception 'invalid date field' using errcode = '22023';
        end if;

        if not private.current_user_can_edit_project(v_project_id) then
          raise exception 'permission denied' using errcode = '42501';
        end if;

        if v_operation->>'field' = 'start_date' then
          update public.projects
          set start_date = nullif(v_operation->>'value', '')::date,
              updated_at = now()
          where id = v_project_id
            and deleted_at is null
            and company_id = (select private.get_user_company_id())
            and updated_at = v_expected_updated_at
          returning updated_at into v_updated_at;
        else
          update public.projects
          set end_date = nullif(v_operation->>'value', '')::date,
              updated_at = now()
          where id = v_project_id
            and deleted_at is null
            and company_id = (select private.get_user_company_id())
            and updated_at = v_expected_updated_at
          returning updated_at into v_updated_at;
        end if;

        if v_updated_at is null then
          raise exception 'project conflict' using errcode = 'P0001';
        end if;

      elsif v_action = 'assign_team' then
        v_result := public.assign_project_team_member(
          v_project_id,
          (v_operation->>'user_id')::uuid,
          array(select jsonb_array_elements_text(v_operation->'task_ids')::uuid),
          v_expected_updated_at
        );
        v_updated_at := (v_result->>'updated_at')::timestamptz;

      elsif v_action = 'remove_team' then
        v_result := public.remove_project_team_member(
          v_project_id,
          (v_operation->>'user_id')::uuid,
          case
            when v_operation ? 'task_ids' and jsonb_typeof(v_operation->'task_ids') = 'array'
              then array(select jsonb_array_elements_text(v_operation->'task_ids')::uuid)
            else null
          end,
          v_expected_updated_at
        );
        v_updated_at := (v_result->>'updated_at')::timestamptz;

      else
        raise exception 'invalid action' using errcode = '22023';
      end if;

      v_success := v_success || jsonb_build_array(jsonb_build_object(
        'project_id', v_project_id,
        'updated_at', v_updated_at,
        'action', v_action
      ));
    exception when others then
      v_failed := v_failed || jsonb_build_array(jsonb_build_object(
        'project_id', coalesce(v_operation->>'project_id', ''),
        'action', coalesce(v_action, v_operation->>'action', ''),
        'code', sqlstate,
        'message', sqlerrm
      ));
    end;
  end loop;

  return jsonb_build_object(
    'success', v_success,
    'failed', v_failed,
    'success_count', jsonb_array_length(v_success),
    'failed_count', jsonb_array_length(v_failed)
  );
end;
$$;

revoke execute on function public.bulk_update_project_table(jsonb) from public;
grant execute on function public.bulk_update_project_table(jsonb) to anon, authenticated;

commit;
