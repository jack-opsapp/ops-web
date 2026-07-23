begin;

create unique index if not exists
  notifications_share_photo_recovery_dedupe_key_uidx
on public.notifications (user_id, company_id, dedupe_key)
where dedupe_key like 'share-photo:recovery:%';

create or replace function public.file_share_photo_as_system(
  p_job_id uuid,
  p_project_id uuid,
  p_company_id uuid,
  p_url text,
  p_actor_user_id uuid,
  p_taken_at timestamptz
)
returns table (
  photo_id uuid,
  created boolean,
  attached boolean
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  v_existing public.project_photos%rowtype;
  v_project_id uuid;
  v_url text := nullif(pg_catalog.btrim(p_url), '');
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'service_role_required';
  end if;

  if p_job_id is null
     or p_project_id is null
     or p_company_id is null
     or v_url is null
     or p_actor_user_id is null
     or p_taken_at is null then
    raise exception using
      errcode = '22023',
      message = 'invalid_share_photo_input';
  end if;

  -- A job UUID is a global idempotency identity. This prevents two concurrent
  -- requests from binding the same job to different projects or uploaders.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'share-photo-job:' || p_job_id::text,
      0
    )
  );

  -- Every append to one project's text[] is serialized on the project row, so
  -- separate photos arriving together cannot overwrite each other.
  select project.id
    into v_project_id
  from public.projects as project
  where project.id = p_project_id
    and project.company_id = p_company_id
    and project.deleted_at is null
  for update;

  if v_project_id is null then
    raise exception using
      errcode = 'P0002',
      message = 'share_photo_project_not_found';
  end if;

  if not private.user_can_edit_project(p_actor_user_id, p_project_id) then
    raise exception using
      errcode = '42501',
      message = 'share_photo_forbidden';
  end if;

  select photo.*
    into v_existing
  from public.project_photos as photo
  where photo.id = p_job_id
  for update;

  if found then
    if v_existing.project_id is distinct from p_project_id::text
       or v_existing.company_id is distinct from p_company_id::text
       or v_existing.url is distinct from v_url
       or v_existing.uploaded_by is distinct from p_actor_user_id::text
       or v_existing.taken_at is distinct from p_taken_at then
      raise exception using
        errcode = '23505',
        message = 'share_photo_identity_conflict';
    end if;

    -- A retry may repair a previously interrupted project_images append, but a
    -- user-deleted photo is never silently resurrected.
    if v_existing.deleted_at is null then
      update public.projects as project
      set project_images = pg_catalog.array_append(
        coalesce(project.project_images, '{}'::text[]),
        v_url
      )
      where project.id = p_project_id
        and pg_catalog.array_position(
          coalesce(project.project_images, '{}'::text[]),
          v_url
        ) is null;
    end if;

    return query
    select
      v_existing.id,
      false,
      v_existing.deleted_at is null;
    return;
  end if;

  insert into public.project_photos (
    id,
    project_id,
    company_id,
    url,
    source,
    uploaded_by,
    is_client_visible,
    taken_at
  )
  values (
    p_job_id,
    p_project_id::text,
    p_company_id::text,
    v_url,
    'in_progress'::public.photo_source,
    p_actor_user_id::text,
    false,
    p_taken_at
  );

  update public.projects as project
  set project_images = pg_catalog.array_append(
    coalesce(project.project_images, '{}'::text[]),
    v_url
  )
  where project.id = p_project_id
    and pg_catalog.array_position(
      coalesce(project.project_images, '{}'::text[]),
      v_url
    ) is null;

  return query
  select p_job_id, true, true;
end;
$function$;

comment on function public.file_share_photo_as_system(
  uuid,
  uuid,
  uuid,
  text,
  uuid,
  timestamptz
) is
  'Atomically and idempotently files one authenticated iOS share photo. Service role only.';

revoke all on function public.file_share_photo_as_system(
  uuid,
  uuid,
  uuid,
  text,
  uuid,
  timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.file_share_photo_as_system(
  uuid,
  uuid,
  uuid,
  text,
  uuid,
  timestamptz
) to service_role;

commit;
