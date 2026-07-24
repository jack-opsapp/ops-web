begin;

-- An edited note changes both visible copy and the authoritative access grant.
-- Keep one immutable proof for every accepted edit, including edits whose
-- server-computed newly-added recipient set is empty. The client-provided UUID
-- is the retry identity for the mutation, notification rail, and push.
create table public.project_note_mention_events (
  id uuid primary key,
  note_id uuid not null references public.project_notes(id),
  project_id text not null,
  company_id uuid not null references public.companies(id),
  actor_user_id uuid not null references public.users(id),
  requested_content text not null,
  requested_mentioned_user_ids text[] not null,
  prior_content_snapshot text not null,
  prior_mentioned_user_ids text[] not null,
  content_snapshot text not null,
  mentioned_user_ids_snapshot text[] not null,
  recipient_user_ids text[] not null,
  actor_name_snapshot text not null,
  project_title_snapshot text not null,
  note_updated_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint project_note_mention_events_requested_ids_no_null
    check (array_position(requested_mentioned_user_ids, null) is null),
  constraint project_note_mention_events_prior_ids_no_null
    check (array_position(prior_mentioned_user_ids, null) is null),
  constraint project_note_mention_events_effective_ids_no_null
    check (array_position(mentioned_user_ids_snapshot, null) is null),
  constraint project_note_mention_events_recipient_ids_no_null
    check (array_position(recipient_user_ids, null) is null),
  constraint project_note_mention_events_content_snapshot_matches
    check (content_snapshot = requested_content),
  constraint project_note_mention_events_actor_name_present
    check (nullif(btrim(actor_name_snapshot), '') is not null),
  constraint project_note_mention_events_project_title_present
    check (nullif(btrim(project_title_snapshot), '') is not null)
);

create index project_note_mention_events_note_created_idx
  on public.project_note_mention_events (note_id, created_at, id);

alter table public.project_note_mention_events enable row level security;
revoke all on table public.project_note_mention_events from public, anon, authenticated, service_role;
grant select on table public.project_note_mention_events to service_role;

create policy project_note_mention_events_no_client_access
  on public.project_note_mention_events
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create or replace function private.project_note_mention_events_are_immutable()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
begin
  raise exception 'project note mention events are immutable'
    using errcode = '55000';
end;
$function$;

revoke all on function private.project_note_mention_events_are_immutable()
  from public, anon, authenticated, service_role;

create trigger project_note_mention_events_immutable
before update or delete on public.project_note_mention_events
for each row
execute function private.project_note_mention_events_are_immutable();

comment on trigger project_note_mention_events_immutable
  on public.project_note_mention_events
  is 'project note mention events are immutable';

-- Ordinary unread-only dedupe is presentation state. This event identity must
-- survive a user reading, dismissing, or resolving the rail row before a retry.
create unique index if not exists notifications_mention_edit_event_unique
  on public.notifications (
    user_id,
    company_id,
    type,
    dedupe_key
  )
  where type = 'mention'
    and dedupe_key like 'mention-edit:%';

create or replace function public.update_project_note_mentions(
  p_note_id uuid,
  p_content text,
  p_mentioned_user_ids text[],
  p_event_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_actor_id uuid := private.get_current_user_id();
  v_company_id uuid := private.get_user_company_id();
  v_existing public.project_notes%rowtype;
  v_replay public.project_note_mention_events%rowtype;
  v_actor_name text;
  v_project_title text;
  v_effective_mentioned_user_ids text[] := '{}'::text[];
  v_added_recipient_ids text[] := '{}'::text[];
  v_updated_at timestamptz;
begin
  if p_note_id is null or p_event_id is null or p_content is null then
    raise exception 'invalid project note mention edit'
      using errcode = '22023';
  end if;
  if p_mentioned_user_ids is null then
    raise exception 'explicit mention list is required'
      using errcode = '22023';
  end if;
  if array_position(p_mentioned_user_ids, null) is not null then
    raise exception 'requested mention user id is invalid'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(p_mentioned_user_ids) requested(user_id)
    where requested.user_id !~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) then
    raise exception 'requested mention user id is invalid'
      using errcode = '22023';
  end if;
  select concat_ws(
    ' ',
    nullif(btrim(actor.first_name), ''),
    nullif(btrim(actor.last_name), '')
  )
    into v_actor_name
  from public.users actor
  where actor.id = v_actor_id
    and actor.company_id = v_company_id
    and actor.is_active
    and actor.deleted_at is null
  for share;

  if not found then
    raise exception 'project note mention edit actor is unavailable'
      using errcode = '42501';
  end if;
  if v_actor_id is null or v_company_id is null then
    raise exception 'project note mention edit actor is unavailable'
      using errcode = '42501';
  end if;
  v_actor_name := coalesce(nullif(btrim(v_actor_name), ''), 'A team member');

  -- Every edit of one note serializes here. A replay waits for the first call,
  -- then reads its immutable event instead of applying the stale mutation over
  -- any newer edit.
  select *
    into v_existing
  from public.project_notes
  where id = p_note_id
  for update;

  if not found then
    raise exception 'project note mention edit is unavailable'
      using errcode = '42501';
  end if;

  select event.*
    into v_replay
  from public.project_note_mention_events event
  where event.id = p_event_id;

  if found then
    if v_replay.note_id = p_note_id
       and v_replay.actor_user_id = v_actor_id
       and v_replay.company_id = v_company_id
       and v_replay.requested_content is not distinct from p_content
       and v_replay.requested_mentioned_user_ids is not distinct from p_mentioned_user_ids then
      return jsonb_build_object(
        'event_id', v_replay.id,
        'note_id', v_replay.note_id,
        'project_id', v_replay.project_id,
        'content', v_replay.content_snapshot,
        'mentioned_user_ids', v_replay.mentioned_user_ids_snapshot,
        'recipient_user_ids', v_replay.recipient_user_ids,
        'added_count', cardinality(v_replay.recipient_user_ids),
        'updated_at', v_replay.note_updated_at,
        'replayed', true
      );
    end if;
    raise exception 'mention edit event id was reused with a different request'
      using errcode = '22023';
  end if;

  if v_existing.author_id is distinct from v_actor_id::text
     or v_existing.company_id is distinct from v_company_id::text
     or v_existing.deleted_at is not null
     or v_existing.event_kind is not null then
    raise exception 'project note mention edit is unavailable'
      using errcode = '42501';
  end if;

  select coalesce(
    array_agg(candidate.user_id order by candidate.ordinality),
    '{}'::text[]
  )
    into v_effective_mentioned_user_ids
  from (
    select normalized.user_id, min(normalized.ordinality) as ordinality
    from (
      select
        requested.user_id::uuid::text as user_id,
        requested.ordinality
      from unnest(p_mentioned_user_ids)
        with ordinality as requested(user_id, ordinality)
    ) normalized
    group by normalized.user_id
  ) candidate
  where candidate.user_id <> v_actor_id::text;

  if exists (
    select 1
    from unnest(v_effective_mentioned_user_ids) candidate(user_id)
    where not exists (
      select 1
      from public.users user_row
      where user_row.id = candidate.user_id::uuid
        and user_row.company_id = v_company_id
        and user_row.is_active
        and user_row.deleted_at is null
    )
  ) then
    raise exception 'requested mention user is not active in actor company'
      using errcode = '22023';
  end if;

  select project.title
    into v_project_title
  from public.projects project
  where project.id::text = v_existing.project_id
    and project.company_id = v_company_id
    and project.deleted_at is null
  for share;

  if not found then
    raise exception 'project note mention edit project is unavailable'
      using errcode = '42501';
  end if;
  v_project_title := coalesce(
    nullif(btrim(v_project_title), ''),
    'Untitled project'
  );

  select coalesce(
    array_agg(candidate.user_id order by candidate.ordinality),
    '{}'::text[]
  )
    into v_added_recipient_ids
  from unnest(v_effective_mentioned_user_ids)
    with ordinality as candidate(user_id, ordinality)
  where candidate.user_id in (
    select unnest(v_effective_mentioned_user_ids)
    except
    select prior.user_id::uuid::text
    from unnest(coalesce(v_existing.mentioned_user_ids, '{}'::text[]))
      as prior(user_id)
    where prior.user_id ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );

  update public.project_notes
  set content = p_content,
      mentioned_user_ids = v_effective_mentioned_user_ids,
      updated_at = clock_timestamp()
  where id = p_note_id
  returning updated_at into v_updated_at;

  insert into public.project_note_mention_events (
    id,
    note_id,
    project_id,
    company_id,
    actor_user_id,
    requested_content,
    requested_mentioned_user_ids,
    prior_content_snapshot,
    prior_mentioned_user_ids,
    content_snapshot,
    mentioned_user_ids_snapshot,
    recipient_user_ids,
    actor_name_snapshot,
    project_title_snapshot,
    note_updated_at
  ) values (
    p_event_id,
    p_note_id,
    v_existing.project_id,
    v_company_id,
    v_actor_id,
    p_content,
    p_mentioned_user_ids,
    v_existing.content,
    coalesce(v_existing.mentioned_user_ids, '{}'::text[]),
    p_content,
    v_effective_mentioned_user_ids,
    v_added_recipient_ids,
    v_actor_name,
    v_project_title,
    v_updated_at
  );

  return jsonb_build_object(
    'event_id', p_event_id,
    'note_id', p_note_id,
    'project_id', v_existing.project_id,
    'content', p_content,
    'mentioned_user_ids', v_effective_mentioned_user_ids,
    'recipient_user_ids', v_added_recipient_ids,
    'added_count', cardinality(v_added_recipient_ids),
    'updated_at', v_updated_at,
    'replayed', false
  );
end;
$function$;

comment on function public.update_project_note_mentions(uuid, text, text[], uuid)
  is 'Atomically replaces a human-authored note and its complete mention list, recording one immutable idempotency proof for every edit.';

revoke all on function public.update_project_note_mentions(uuid, text, text[], uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.update_project_note_mentions(uuid, text, text[], uuid)
  to anon, authenticated;

commit;
