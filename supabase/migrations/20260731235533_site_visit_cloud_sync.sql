-- Durable, tenant-safe site-visit capture shared by web and iOS.
--
-- The phone keeps its transport queue locally. Supabase stores only customer
-- business data plus one idempotent lifecycle RPC; there is deliberately no
-- server receipt, event, delivery, queue, or outbox table in this migration.

create table public.site_visit_artifacts (
  id uuid primary key default gen_random_uuid(),
  site_visit_id uuid not null
    references public.site_visits(id) on delete cascade,
  company_id text not null,
  opportunity_id uuid
    references public.opportunities(id) on delete set null,
  kind text not null
    constraint site_visit_artifacts_kind_check check (
      kind in (
        'photo',
        'annotated_photo',
        'dimensioned_photo',
        'note',
        'transcript',
        'measurement',
        'deck_design'
      )
    ),
  source text not null
    constraint site_visit_artifacts_source_check check (
      source in (
        'camera',
        'gallery',
        'microphone',
        'keyboard',
        'laser',
        'lidar',
        'deck_builder',
        'manual'
      )
    ),
  title text
    constraint site_visit_artifacts_title_length check (
      title is null or char_length(title) <= 500
    ),
  body text
    constraint site_visit_artifacts_body_length check (
      body is null or char_length(body) <= 200000
    ),
  asset_url text
    constraint site_visit_artifacts_asset_url_length check (
      asset_url is null or char_length(asset_url) <= 4096
    ),
  rendered_asset_url text
    constraint site_visit_artifacts_rendered_url_length check (
      rendered_asset_url is null or char_length(rendered_asset_url) <= 4096
    ),
  thumbnail_url text
    constraint site_visit_artifacts_thumbnail_url_length check (
      thumbnail_url is null or char_length(thumbnail_url) <= 4096
    ),
  dimensions jsonb
    constraint site_visit_artifacts_dimensions_shape check (
      dimensions is null
      or (
        jsonb_typeof(dimensions) = 'object'
        and pg_column_size(dimensions) <= 1048576
      )
    ),
  deck_design_id uuid
    references public.deck_designs(id) on delete set null,
  included_in_project_review boolean not null default true,
  captured_at timestamptz not null,
  created_by text not null
    constraint site_visit_artifacts_created_by_length check (
      char_length(created_by) between 1 and 256
    ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.site_visit_checklist_answers (
  id uuid primary key default gen_random_uuid(),
  site_visit_id uuid not null
    references public.site_visits(id) on delete cascade,
  company_id text not null,
  opportunity_id uuid
    references public.opportunities(id) on delete set null,
  site_visit_type_id text
    constraint site_visit_checklist_answers_type_id_length check (
      site_visit_type_id is null or char_length(site_visit_type_id) <= 256
    ),
  field_id text not null
    constraint site_visit_checklist_answers_field_id_length check (
      char_length(field_id) between 1 and 256
    ),
  label text not null
    constraint site_visit_checklist_answers_label_length check (
      char_length(label) between 1 and 500
    ),
  kind text not null
    constraint site_visit_checklist_answers_kind_check check (
      kind in (
        'checkbox',
        'yes_no_na',
        'short_text',
        'long_text',
        'measurement',
        'photo',
        'photo_markup',
        'deck_design'
      )
    ),
  required boolean not null default false,
  help_text text
    constraint site_visit_checklist_answers_help_length check (
      help_text is null or char_length(help_text) <= 2000
    ),
  sort_order integer not null default 0,
  answer_value jsonb not null default '{}'::jsonb
    constraint site_visit_checklist_answers_value_shape check (
      jsonb_typeof(answer_value) = 'object'
      and pg_column_size(answer_value) <= 1048576
    ),
  created_by text not null
    constraint site_visit_checklist_answers_created_by_length check (
      char_length(created_by) between 1 and 256
    ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.site_visit_identity_drafts (
  id uuid primary key default gen_random_uuid(),
  site_visit_id uuid not null
    references public.site_visits(id) on delete cascade,
  company_id text not null,
  opportunity_id uuid
    references public.opportunities(id) on delete set null,
  client_id uuid
    references public.clients(id) on delete set null,
  sub_client_id uuid
    references public.sub_clients(id) on delete set null,
  client_name text not null default ''
    constraint site_visit_identity_drafts_client_name_length check (
      char_length(client_name) <= 500
    ),
  contact_name text not null default ''
    constraint site_visit_identity_drafts_contact_name_length check (
      char_length(contact_name) <= 500
    ),
  preferred_email text not null default ''
    constraint site_visit_identity_drafts_email_length check (
      char_length(preferred_email) <= 320
    ),
  additional_emails text[] not null default '{}'
    constraint site_visit_identity_drafts_emails_size check (
      cardinality(additional_emails) <= 20
      and char_length(array_to_string(additional_emails, ',')) <= 6420
    ),
  phone_number text not null default ''
    constraint site_visit_identity_drafts_phone_length check (
      char_length(phone_number) <= 128
    ),
  address text not null default ''
    constraint site_visit_identity_drafts_address_length check (
      char_length(address) <= 4000
    ),
  notes text not null default ''
    constraint site_visit_identity_drafts_notes_length check (
      char_length(notes) <= 200000
    ),
  created_by text not null
    constraint site_visit_identity_drafts_created_by_length check (
      char_length(created_by) between 1 and 256
    ),
  last_committed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Foreign-key lookups, active tenant reads, and retry identities all have
-- dedicated indexes. Postgres does not create child-side FK indexes itself.
create index site_visit_artifacts_site_visit_idx
  on public.site_visit_artifacts(site_visit_id);
create index site_visit_artifacts_active_company_visit_idx
  on public.site_visit_artifacts(company_id, site_visit_id)
  where deleted_at is null;
create index site_visit_artifacts_active_opportunity_idx
  on public.site_visit_artifacts(opportunity_id)
  where deleted_at is null and opportunity_id is not null;
create index site_visit_artifacts_deck_design_idx
  on public.site_visit_artifacts(deck_design_id)
  where deck_design_id is not null;

create index site_visit_checklist_answers_site_visit_idx
  on public.site_visit_checklist_answers(site_visit_id);
create index site_visit_checklist_answers_active_company_visit_idx
  on public.site_visit_checklist_answers(company_id, site_visit_id)
  where deleted_at is null;
create index site_visit_checklist_answers_active_opportunity_idx
  on public.site_visit_checklist_answers(opportunity_id)
  where deleted_at is null and opportunity_id is not null;
create unique index site_visit_checklist_answers_active_field_uidx
  on public.site_visit_checklist_answers(site_visit_id, field_id)
  where deleted_at is null;

create index site_visit_identity_drafts_site_visit_idx
  on public.site_visit_identity_drafts(site_visit_id);
create index site_visit_identity_drafts_active_company_visit_idx
  on public.site_visit_identity_drafts(company_id, site_visit_id)
  where deleted_at is null;
create index site_visit_identity_drafts_active_opportunity_idx
  on public.site_visit_identity_drafts(opportunity_id)
  where deleted_at is null and opportunity_id is not null;
create index site_visit_identity_drafts_client_idx
  on public.site_visit_identity_drafts(client_id)
  where client_id is not null;
create index site_visit_identity_drafts_sub_client_idx
  on public.site_visit_identity_drafts(sub_client_id)
  where sub_client_id is not null;
create unique index site_visit_identity_drafts_active_visit_uidx
  on public.site_visit_identity_drafts(site_visit_id)
  where deleted_at is null;

-- Project conversion may be retried after an interrupted response. The phone
-- reuses the visit object's URL, and this active identity makes that retry a
-- single gallery row across devices. Fail the migration with a specific
-- preflight error instead of discovering historical duplicates during index
-- creation with an opaque constraint message.
do $block$
begin
  if exists (
    select 1
      from public.project_photos photo
     where photo.site_visit_id is not null
       and photo.deleted_at is null
     group by photo.company_id, photo.project_id, photo.site_visit_id, photo.url
    having count(*) > 1
  ) then
    raise exception 'duplicate_active_site_visit_project_photos';
  end if;
end;
$block$;

create unique index project_photos_active_site_visit_url_uidx
  on public.project_photos(company_id, project_id, site_visit_id, url)
  where site_visit_id is not null and deleted_at is null;

-- A child always carries the exact text company identity and opportunity
-- binding of its visit. The direct single-column FK remains visible to the
-- account-purge validator; the trigger supplies the denormalized guarantees.
create or replace function private.require_site_visit_child_company_match()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_parent_company_id text;
  v_parent_opportunity_id uuid;
begin
  select visit.company_id, visit.opportunity_id
    into v_parent_company_id, v_parent_opportunity_id
    from public.site_visits visit
   where visit.id = new.site_visit_id
   for key share;

  if not found then
    raise exception 'site_visit_child_parent_not_found'
      using errcode = '23503';
  end if;
  if new.company_id is distinct from v_parent_company_id then
    raise exception 'site_visit_child_company_mismatch'
      using errcode = '23514';
  end if;
  if new.opportunity_id is distinct from v_parent_opportunity_id then
    raise exception 'site_visit_child_opportunity_mismatch'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

revoke all on function private.require_site_visit_child_company_match()
  from public, anon, authenticated, service_role;

create trigger site_visit_artifacts_parent_guard
before insert or update of site_visit_id, company_id, opportunity_id
on public.site_visit_artifacts
for each row execute function private.require_site_visit_child_company_match();

create trigger site_visit_checklist_answers_parent_guard
before insert or update of site_visit_id, company_id, opportunity_id
on public.site_visit_checklist_answers
for each row execute function private.require_site_visit_child_company_match();

create trigger site_visit_identity_drafts_parent_guard
before insert or update of site_visit_id, company_id, opportunity_id
on public.site_visit_identity_drafts
for each row execute function private.require_site_visit_child_company_match();

-- A stale phone may amend captured rows, but it cannot reopen a visit that a
-- newer device already completed or cancelled, nor move active work backward.
create or replace function private.enforce_site_visit_status_monotonicity()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if old.status::text in ('completed', 'cancelled')
     and new.status is distinct from old.status then
    raise exception 'site_visit_terminal_status_is_monotonic'
      using errcode = '55000';
  end if;
  if old.status::text = 'in_progress' and new.status::text = 'scheduled' then
    raise exception 'site_visit_status_cannot_regress'
      using errcode = '55000';
  end if;
  return new;
end;
$function$;

revoke all on function private.enforce_site_visit_status_monotonicity()
  from public, anon, authenticated, service_role;

create trigger site_visits_status_monotonicity
before update of status on public.site_visits
for each row execute function private.enforce_site_visit_status_monotonicity();

-- Parent rebinding is authoritative. Propagate it after the guarded parent
-- update so denormalized child filters cannot become stale.
create or replace function private.propagate_site_visit_child_opportunity()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  update public.site_visit_artifacts
     set opportunity_id = new.opportunity_id
   where site_visit_id = new.id
     and opportunity_id is distinct from new.opportunity_id;
  update public.site_visit_checklist_answers
     set opportunity_id = new.opportunity_id
   where site_visit_id = new.id
     and opportunity_id is distinct from new.opportunity_id;
  update public.site_visit_identity_drafts
     set opportunity_id = new.opportunity_id
   where site_visit_id = new.id
     and opportunity_id is distinct from new.opportunity_id;
  return new;
end;
$function$;

revoke all on function private.propagate_site_visit_child_opportunity()
  from public, anon, authenticated, service_role;

create trigger site_visits_propagate_child_opportunity
after update of opportunity_id on public.site_visits
for each row
when (old.opportunity_id is distinct from new.opportunity_id)
execute function private.propagate_site_visit_child_opportunity();

create trigger site_visit_artifacts_set_updated_at
before update on public.site_visit_artifacts
for each row execute function public.fn_set_updated_at();
create trigger site_visit_checklist_answers_set_updated_at
before update on public.site_visit_checklist_answers
for each row execute function public.fn_set_updated_at();
create trigger site_visit_identity_drafts_set_updated_at
before update on public.site_visit_identity_drafts
for each row execute function public.fn_set_updated_at();

-- One security-definer lookup keeps every child policy tied to the current
-- parent authorization model. It checks both supplied identities before
-- delegating to the existing Firebase-aware visit helpers.
create or replace function private.current_user_can_access_site_visit_child(
  p_site_visit_id uuid,
  p_company_id text,
  p_write boolean
) returns boolean
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select coalesce((
    select case when p_write then
      private.current_user_can_edit_site_visit(
        visit.company_id,
        visit.opportunity_id,
        visit.project_id,
        visit.project_ref
      )
    else
      private.current_user_can_view_site_visit(
        visit.company_id,
        visit.opportunity_id,
        visit.project_id,
        visit.project_ref
      )
    end
      from public.site_visits visit
     where visit.id = p_site_visit_id
       and visit.company_id = p_company_id
       and visit.deleted_at is null
  ), false);
$function$;

revoke all on function private.current_user_can_access_site_visit_child(uuid, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function private.current_user_can_access_site_visit_child(uuid, text, boolean)
  to anon, authenticated;

alter table public.site_visit_artifacts enable row level security;
alter table public.site_visit_checklist_answers enable row level security;
alter table public.site_visit_identity_drafts enable row level security;

create policy site_visit_artifacts_company_isolation
  on public.site_visit_artifacts
  for all to public
  using (company_id = (select private.get_user_company_id())::text)
  with check (company_id = (select private.get_user_company_id())::text);
create policy site_visit_artifacts_parent_select
  on public.site_visit_artifacts as restrictive for select to public
  using ((select private.current_user_can_access_site_visit_child(
    site_visit_id, company_id, false
  )));
create policy site_visit_artifacts_parent_insert
  on public.site_visit_artifacts as restrictive for insert to public
  with check ((select private.current_user_can_access_site_visit_child(
    site_visit_id, company_id, true
  )));
create policy site_visit_artifacts_parent_update
  on public.site_visit_artifacts as restrictive for update to public
  using ((select private.current_user_can_access_site_visit_child(
    site_visit_id, company_id, true
  )))
  with check ((select private.current_user_can_access_site_visit_child(
    site_visit_id, company_id, true
  )));

create policy site_visit_checklist_answers_company_isolation
  on public.site_visit_checklist_answers
  for all to public
  using (company_id = (select private.get_user_company_id())::text)
  with check (company_id = (select private.get_user_company_id())::text);
create policy site_visit_checklist_answers_parent_select
  on public.site_visit_checklist_answers as restrictive for select to public
  using ((select private.current_user_can_access_site_visit_child(
    site_visit_id, company_id, false
  )));
create policy site_visit_checklist_answers_parent_insert
  on public.site_visit_checklist_answers as restrictive for insert to public
  with check ((select private.current_user_can_access_site_visit_child(
    site_visit_id, company_id, true
  )));
create policy site_visit_checklist_answers_parent_update
  on public.site_visit_checklist_answers as restrictive for update to public
  using ((select private.current_user_can_access_site_visit_child(
    site_visit_id, company_id, true
  )))
  with check ((select private.current_user_can_access_site_visit_child(
    site_visit_id, company_id, true
  )));

create policy site_visit_identity_drafts_company_isolation
  on public.site_visit_identity_drafts
  for all to public
  using (company_id = (select private.get_user_company_id())::text)
  with check (company_id = (select private.get_user_company_id())::text);
create policy site_visit_identity_drafts_parent_select
  on public.site_visit_identity_drafts as restrictive for select to public
  using ((select private.current_user_can_access_site_visit_child(
    site_visit_id, company_id, false
  )));
create policy site_visit_identity_drafts_parent_insert
  on public.site_visit_identity_drafts as restrictive for insert to public
  with check ((select private.current_user_can_access_site_visit_child(
    site_visit_id, company_id, true
  )));
create policy site_visit_identity_drafts_parent_update
  on public.site_visit_identity_drafts as restrictive for update to public
  using ((select private.current_user_can_access_site_visit_child(
    site_visit_id, company_id, true
  )))
  with check ((select private.current_user_can_access_site_visit_child(
    site_visit_id, company_id, true
  )));

-- Explicit Data API exposure. Both app roles are required by OPS's Firebase
-- bridge. Hard deletion remains server-only; mobile/web tombstone with UPDATE.
revoke all on table public.site_visit_artifacts
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.site_visit_artifacts to anon, authenticated;
grant select, insert, update, delete on table public.site_visit_artifacts to service_role;

revoke all on table public.site_visit_checklist_answers
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.site_visit_checklist_answers to anon, authenticated;
grant select, insert, update, delete on table public.site_visit_checklist_answers to service_role;

revoke all on table public.site_visit_identity_drafts
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.site_visit_identity_drafts to anon, authenticated;
grant select, insert, update, delete on table public.site_visit_identity_drafts to service_role;

-- Fail closed rather than choosing a winner if legacy web retries have already
-- created two completion activities. Production was read-only checked before
-- authoring this migration and had no duplicates.
do $block$
begin
  if exists (
    select 1
      from public.activities
     where type = 'site_visit'
       and site_visit_id is not null
     group by site_visit_id
    having count(*) > 1
  ) then
    raise exception 'duplicate_site_visit_completion_activities'
      using errcode = '23505';
  end if;
end;
$block$;

create unique index activities_site_visit_completion_uidx
  on public.activities(site_visit_id)
  where type = 'site_visit' and site_visit_id is not null;

-- Normalized capture owns each legacy projection after at least one row of the
-- corresponding kind has existed. This lets a tombstone clear stale legacy
-- values while preserving web-only fields for visits that never used children.
create or replace function private.refresh_site_visit_compatibility(
  p_site_visit_id uuid
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_notes text;
  v_measurements text;
  v_photos text[];
  v_owns_notes boolean;
  v_owns_measurements boolean;
  v_owns_photos boolean;
begin
  select exists (
    select 1 from public.site_visit_artifacts
     where site_visit_id = p_site_visit_id and kind in ('note', 'transcript')
  ) or exists (
    select 1 from public.site_visit_checklist_answers
     where site_visit_id = p_site_visit_id
       and kind in ('checkbox', 'yes_no_na', 'short_text', 'long_text')
  ) into v_owns_notes;

  select string_agg(rendered, E'\n\n' order by captured_at, id)
    into v_notes
    from (
      select artifact.id,
             artifact.captured_at,
             concat_ws(E'\n', nullif(btrim(artifact.title), ''),
                                  nullif(btrim(artifact.body), '')) as rendered
        from public.site_visit_artifacts artifact
       where artifact.site_visit_id = p_site_visit_id
         and artifact.deleted_at is null
         and artifact.kind in ('note', 'transcript')
         and coalesce(nullif(btrim(artifact.title), ''),
                      nullif(btrim(artifact.body), '')) is not null
      union all
      select answer.id,
             answer.created_at as captured_at,
             answer.label || ': ' || coalesce(
               nullif(answer.answer_value ->> 'text', ''),
               nullif(answer.answer_value ->> 'choice', ''),
               nullif(answer.answer_value ->> 'boolValue', '')
             ) as rendered
        from public.site_visit_checklist_answers answer
       where answer.site_visit_id = p_site_visit_id
         and answer.deleted_at is null
         and answer.kind in ('checkbox', 'yes_no_na', 'short_text', 'long_text')
         and coalesce(
           nullif(answer.answer_value ->> 'text', ''),
           nullif(answer.answer_value ->> 'choice', ''),
           nullif(answer.answer_value ->> 'boolValue', '')
         ) is not null
    ) normalized_notes;

  select exists (
    select 1 from public.site_visit_artifacts
     where site_visit_id = p_site_visit_id
       and kind in ('measurement', 'dimensioned_photo')
  ) or exists (
    select 1 from public.site_visit_checklist_answers
     where site_visit_id = p_site_visit_id and kind = 'measurement'
  ) into v_owns_measurements;

  select string_agg(rendered, E'\n' order by captured_at, id)
    into v_measurements
    from (
      select artifact.id,
             artifact.captured_at,
             coalesce(nullif(btrim(artifact.body), ''), artifact.dimensions::text) as rendered
        from public.site_visit_artifacts artifact
       where artifact.site_visit_id = p_site_visit_id
         and artifact.deleted_at is null
         and artifact.kind in ('measurement', 'dimensioned_photo')
         and coalesce(nullif(btrim(artifact.body), ''), artifact.dimensions::text) is not null
      union all
      select answer.id,
             answer.created_at as captured_at,
             answer.label || ': ' || (answer.answer_value ->> 'text') as rendered
        from public.site_visit_checklist_answers answer
       where answer.site_visit_id = p_site_visit_id
         and answer.deleted_at is null
         and answer.kind = 'measurement'
         and nullif(answer.answer_value ->> 'text', '') is not null
    ) normalized_measurements;

  select exists (
    select 1 from public.site_visit_artifacts
     where site_visit_id = p_site_visit_id
       and kind in ('photo', 'annotated_photo', 'dimensioned_photo')
  ) into v_owns_photos;

  select coalesce(array_agg(url order by captured_at, id), '{}'::text[])
    into v_photos
    from (
      select artifact.id,
             artifact.captured_at,
             coalesce(
               nullif(btrim(artifact.rendered_asset_url), ''),
               nullif(btrim(artifact.asset_url), ''),
               nullif(btrim(artifact.thumbnail_url), '')
             ) as url
        from public.site_visit_artifacts artifact
       where artifact.site_visit_id = p_site_visit_id
         and artifact.deleted_at is null
         and artifact.kind in ('photo', 'annotated_photo', 'dimensioned_photo')
    ) normalized_photos
   where url is not null;

  update public.site_visits
     set notes = case when v_owns_notes then v_notes else notes end,
         measurements = case
           when v_owns_measurements then v_measurements else measurements
         end,
         photos = case when v_owns_photos then v_photos else photos end
   where id = p_site_visit_id;
end;
$function$;

revoke all on function private.refresh_site_visit_compatibility(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.complete_site_visit_guarded(
  p_site_visit_id uuid,
  p_completion jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_visit public.site_visits%rowtype;
  v_company_id uuid;
  v_actor_user_id uuid;
  v_client_id uuid;
  v_activity_id uuid;
  v_photos text[];
begin
  if p_site_visit_id is null then
    raise exception 'site_visit_id_required' using errcode = '22004';
  end if;
  if p_completion is null or jsonb_typeof(p_completion) <> 'object' then
    raise exception 'site_visit_completion_must_be_an_object'
      using errcode = '22023';
  end if;
  if exists (
    select 1
      from jsonb_object_keys(p_completion) key
     where key <> all (array['notes', 'measurements', 'photos', 'internal_notes'])
  ) then
    raise exception 'site_visit_completion_has_unknown_fields'
      using errcode = '22023';
  end if;
  if (p_completion ? 'notes' and jsonb_typeof(p_completion -> 'notes') not in ('string', 'null'))
     or (p_completion ? 'measurements' and jsonb_typeof(p_completion -> 'measurements') not in ('string', 'null'))
     or (p_completion ? 'internal_notes' and jsonb_typeof(p_completion -> 'internal_notes') not in ('string', 'null'))
     or (p_completion ? 'photos' and jsonb_typeof(p_completion -> 'photos') not in ('array', 'null')) then
    raise exception 'site_visit_completion_has_invalid_types'
      using errcode = '22023';
  end if;
  if pg_column_size(p_completion) > 1048576
     or char_length(p_completion ->> 'notes') > 200000
     or char_length(p_completion ->> 'measurements') > 200000
     or char_length(p_completion ->> 'internal_notes') > 200000 then
    raise exception 'site_visit_completion_exceeds_size_limit'
      using errcode = '22001';
  end if;
  if p_completion ? 'photos'
     and jsonb_typeof(p_completion -> 'photos') = 'array'
     and (
       jsonb_array_length(p_completion -> 'photos') > 100
       or exists (
         select 1
           from jsonb_array_elements(p_completion -> 'photos') as photo(value)
          where jsonb_typeof(photo.value) <> 'string'
             or char_length(photo.value #>> '{}') > 4096
       )
     ) then
    raise exception 'site_visit_completion_has_invalid_photos'
      using errcode = '22023';
  end if;

  select *
    into v_visit
    from public.site_visits
   where id = p_site_visit_id
   for update;
  if not found then
    raise exception 'site_visit_not_found' using errcode = 'P0002';
  end if;

  if not private.current_user_can_edit_site_visit(
    v_visit.company_id,
    v_visit.opportunity_id,
    v_visit.project_id,
    v_visit.project_ref
  ) then
    raise exception 'site_visit_edit_denied' using errcode = '42501';
  end if;

  v_company_id := private.get_user_company_id();
  v_actor_user_id := private.get_current_user_id();
  if v_company_id is null or v_visit.company_id is distinct from v_company_id::text then
    raise exception 'site_visit_company_mismatch' using errcode = '42501';
  end if;
  if v_actor_user_id is null then
    raise exception 'site_visit_actor_not_found' using errcode = '42501';
  end if;
  if v_visit.deleted_at is not null then
    raise exception 'cannot_complete_deleted_site_visit' using errcode = '55000';
  end if;
  if v_visit.status::text = 'cancelled' then
    raise exception 'cannot_complete_cancelled_site_visit' using errcode = '55000';
  end if;

  if p_completion ? 'photos' and jsonb_typeof(p_completion -> 'photos') = 'array' then
    select coalesce(array_agg(value), '{}'::text[])
      into v_photos
      from jsonb_array_elements_text(p_completion -> 'photos') value;
  elsif p_completion ? 'photos' then
    v_photos := null;
  else
    v_photos := v_visit.photos;
  end if;

  update public.site_visits
     set notes = case when p_completion ? 'notes'
                      then p_completion ->> 'notes' else notes end,
         measurements = case when p_completion ? 'measurements'
                             then p_completion ->> 'measurements' else measurements end,
         photos = case when p_completion ? 'photos' then v_photos else photos end,
         internal_notes = case when p_completion ? 'internal_notes'
                               then p_completion ->> 'internal_notes' else internal_notes end
   where id = p_site_visit_id;

  perform private.refresh_site_visit_compatibility(p_site_visit_id);

  update public.site_visits
     set status = 'completed',
         completed_at = coalesce(completed_at, clock_timestamp())
   where id = p_site_visit_id
   returning * into v_visit;

  v_activity_id := v_visit.activity_id;
  v_client_id := coalesce(
    v_visit.client_ref,
    private.try_parse_uuid(v_visit.client_id)
  );

  if v_visit.opportunity_id is not null
     or v_client_id is not null
     or coalesce(v_visit.project_ref::text, v_visit.project_id) is not null then
    insert into public.activities (
      company_id,
      opportunity_id,
      client_id,
      type,
      subject,
      content,
      duration_minutes,
      created_by,
      attachments,
      is_read,
      site_visit_id,
      project_id
    ) values (
      v_company_id,
      v_visit.opportunity_id,
      v_client_id,
      'site_visit',
      'Site visit completed',
      v_visit.notes,
      v_visit.duration_minutes,
      v_actor_user_id,
      coalesce(v_visit.photos, '{}'::text[]),
      true,
      v_visit.id,
      coalesce(v_visit.project_ref::text, v_visit.project_id)
    )
    on conflict (site_visit_id)
      where type = 'site_visit' and site_visit_id is not null
    do update set
      company_id = excluded.company_id,
      opportunity_id = excluded.opportunity_id,
      client_id = excluded.client_id,
      subject = excluded.subject,
      content = excluded.content,
      duration_minutes = excluded.duration_minutes,
      attachments = excluded.attachments,
      project_id = excluded.project_id
    returning id into v_activity_id;

    update public.site_visits
       set activity_id = v_activity_id
     where id = p_site_visit_id
     returning * into v_visit;
  end if;

  return jsonb_build_object(
    'visit', to_jsonb(v_visit),
    'activity_id', v_activity_id
  );
end;
$function$;

revoke all on function public.complete_site_visit_guarded(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.complete_site_visit_guarded(uuid, jsonb) to anon, authenticated;

comment on function public.complete_site_visit_guarded(uuid, jsonb) is
  'Atomically completes one authorized site visit, refreshes legacy projections, and inserts or reuses its single timeline activity.';

alter table public.site_visits replica identity full;
alter table public.site_visit_artifacts replica identity full;
alter table public.site_visit_checklist_answers replica identity full;
alter table public.site_visit_identity_drafts replica identity full;

do $publication$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'site_visits'
  ) then
    alter publication supabase_realtime add table public.site_visits;
  end if;
end;
$publication$;

do $publication$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'site_visit_artifacts'
  ) then
    alter publication supabase_realtime add table public.site_visit_artifacts;
  end if;
end;
$publication$;

do $publication$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'site_visit_checklist_answers'
  ) then
    alter publication supabase_realtime add table public.site_visit_checklist_answers;
  end if;
end;
$publication$;

do $publication$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'site_visit_identity_drafts'
  ) then
    alter publication supabase_realtime add table public.site_visit_identity_drafts;
  end if;
end;
$publication$;
