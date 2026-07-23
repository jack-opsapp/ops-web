-- Idempotency boundary for OPS-local unanswered-lead system handoff drafts.
--
-- This migration cannot send email, mutate a provider mailbox, or change lead
-- business state. It prevents duplicate copy generation and provides the one
-- guarded insert boundary for a source-bound local lifecycle draft.

create table if not exists public.unanswered_lead_local_draft_generation_claims (
  company_id uuid not null,
  opportunity_id uuid not null,
  source_event_id uuid not null,
  claim_token uuid not null default gen_random_uuid(),
  claimed_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  primary key (company_id, opportunity_id, source_event_id),
  constraint unanswered_lead_local_draft_claim_opportunity_fkey
    foreign key (company_id, opportunity_id)
    references public.opportunities (company_id, id)
    on delete cascade,
  constraint unanswered_lead_local_draft_claim_event_fkey
    foreign key (company_id, source_event_id)
    references public.opportunity_correspondence_events (company_id, id)
    on delete cascade,
  constraint unanswered_lead_local_draft_claim_expiry_check
    check (expires_at > claimed_at)
);

alter table public.unanswered_lead_local_draft_generation_claims
  enable row level security;
alter table public.unanswered_lead_local_draft_generation_claims
  force row level security;

revoke all on table public.unanswered_lead_local_draft_generation_claims
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.unanswered_lead_local_draft_generation_claims
  to service_role;

create table if not exists public.unanswered_lead_message_projections (
  company_id uuid not null,
  opportunity_id uuid not null,
  source_event_id uuid not null,
  source_activity_id uuid not null,
  connection_id uuid not null,
  provider_thread_id text not null,
  provider_message_id text not null,
  workstream text not null check (
    workstream in ('sales', 'warranty', 'service', 'current_project')
  ),
  response_disposition text not null check (
    response_disposition in ('reply_required', 'no_reply_required')
  ),
  conversation_scope text not null check (
    conversation_scope in ('message', 'thread')
  ),
  manifest_sha256 text not null check (
    manifest_sha256 ~ '^[0-9a-f]{64}$'
  ),
  entry_sha256 text not null check (
    entry_sha256 ~ '^[0-9a-f]{64}$'
  ),
  projected_by uuid not null,
  projected_at timestamptz not null default now(),
  primary key (company_id, opportunity_id, source_event_id),
  constraint unanswered_lead_message_projection_opportunity_fkey
    foreign key (company_id, opportunity_id)
    references public.opportunities (company_id, id)
    on delete cascade,
  constraint unanswered_lead_message_projection_event_fkey
    foreign key (company_id, source_event_id)
    references public.opportunity_correspondence_events (company_id, id)
    on delete cascade,
  constraint unanswered_lead_message_projection_activity_fkey
    foreign key (company_id, source_activity_id)
    references public.activities (company_id, id)
    on delete cascade,
  constraint unanswered_lead_message_projection_connection_fkey
    foreign key (connection_id)
    references public.email_connections (id)
    on delete cascade,
  constraint unanswered_lead_message_projection_actor_fkey
    foreign key (company_id, projected_by)
    references public.users (company_id, id)
    on delete restrict
);

create unique index if not exists unanswered_lead_message_projection_provider_uidx
  on public.unanswered_lead_message_projections (
    company_id, connection_id, provider_message_id
  );

alter table public.unanswered_lead_message_projections enable row level security;
alter table public.unanswered_lead_message_projections force row level security;

revoke all on table public.unanswered_lead_message_projections
  from public, anon, authenticated;
grant select
  on table public.unanswered_lead_message_projections
  to service_role;

alter table public.opportunity_follow_up_drafts
  add column if not exists recipient_email text,
  add column if not exists recipient_name text;

create unique index if not exists opportunity_follow_up_drafts_system_handoff_source_event_uidx
  on public.opportunity_follow_up_drafts (company_id, opportunity_id, source_event_id)
  where origin = 'system_handoff'
    and source_event_id is not null;

create or replace function public.claim_unanswered_lead_local_draft_generation(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_source_event_id uuid,
  p_lease_seconds integer default 600
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_claim_token uuid;
  v_existing_draft_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_company_id is null
     or p_opportunity_id is null
     or p_source_event_id is null
     or p_lease_seconds not between 60 and 900 then
    raise exception using
      errcode = '22023',
      message = 'unanswered_lead_local_draft_claim_invalid';
  end if;

  if not exists (
    select 1
      from public.opportunity_correspondence_events event
     where event.company_id = p_company_id
       and event.opportunity_id = p_opportunity_id
       and event.id = p_source_event_id
       and event.direction = 'inbound'
       and event.party_role = 'customer'
       and event.is_meaningful is true
       and event.noise_reason is null
       and event.provider_message_id is not null
  ) then
    raise exception using
      errcode = '40001',
      message = 'unanswered_lead_local_draft_source_stale';
  end if;

  select draft.id
    into v_existing_draft_id
    from public.opportunity_follow_up_drafts draft
   where draft.company_id = p_company_id
     and draft.opportunity_id = p_opportunity_id
     and draft.origin = 'system_handoff'
     and draft.source_event_id = p_source_event_id
   limit 1;

  if v_existing_draft_id is not null then
    return jsonb_build_object(
      'acquired', false,
      'claim_token', null,
      'reason', 'existing_draft',
      'draft_id', v_existing_draft_id
    );
  end if;

  delete from public.unanswered_lead_local_draft_generation_claims claim
   where claim.company_id = p_company_id
     and claim.opportunity_id = p_opportunity_id
     and claim.source_event_id = p_source_event_id
     and claim.expires_at <= now();

  insert into public.unanswered_lead_local_draft_generation_claims (
    company_id,
    opportunity_id,
    source_event_id,
    expires_at
  ) values (
    p_company_id,
    p_opportunity_id,
    p_source_event_id,
    now() + make_interval(secs => p_lease_seconds)
  )
  on conflict (company_id, opportunity_id, source_event_id) do nothing
  returning claim_token into v_claim_token;

  return jsonb_build_object(
    'acquired', v_claim_token is not null,
    'claim_token', v_claim_token,
    'reason', case
      when v_claim_token is not null then 'acquired'
      else 'generation_in_progress'
    end
  );
end;
$function$;

create or replace function public.release_unanswered_lead_local_draft_generation(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_source_event_id uuid,
  p_claim_token uuid
) returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_deleted_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  delete from public.unanswered_lead_local_draft_generation_claims claim
   where claim.company_id = p_company_id
     and claim.opportunity_id = p_opportunity_id
     and claim.source_event_id = p_source_event_id
     and claim.claim_token = p_claim_token;
  get diagnostics v_deleted_count = row_count;
  return v_deleted_count > 0;
end;
$function$;

create or replace function public.project_unanswered_lead_recovery_message(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_opportunity_id uuid,
  p_connection_id uuid,
  p_source_event_id uuid,
  p_source_activity_id uuid,
  p_source_provider_thread_id text,
  p_source_provider_message_id text,
  p_workstream text,
  p_response_disposition text,
  p_conversation_scope text,
  p_manifest_sha256 text,
  p_entry_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_opportunity public.opportunities%rowtype;
  v_source_event public.opportunity_correspondence_events%rowtype;
  v_existing public.unanswered_lead_message_projections%rowtype;
  v_inserted_event_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_actor_user_id is null
     or p_company_id is null
     or p_opportunity_id is null
     or p_connection_id is null
     or p_source_event_id is null
     or p_source_activity_id is null
     or nullif(btrim(p_source_provider_thread_id), '') is null
     or nullif(btrim(p_source_provider_message_id), '') is null
     or p_source_provider_thread_id is distinct from btrim(p_source_provider_thread_id)
     or p_source_provider_message_id is distinct from btrim(p_source_provider_message_id)
     or p_workstream is null
     or p_workstream not in ('sales', 'warranty', 'service', 'current_project')
     or p_response_disposition is null
     or p_response_disposition not in (
       'reply_required', 'no_reply_required'
     )
     or p_conversation_scope is null
     or p_conversation_scope not in ('message', 'thread')
     or p_manifest_sha256 is null
     or p_manifest_sha256 !~ '^[0-9a-f]{64}$'
     or p_entry_sha256 is null
     or p_entry_sha256 !~ '^[0-9a-f]{64}$'
  then
    raise exception using
      errcode = '22023',
      message = 'unanswered_lead_message_projection_invalid';
  end if;

  if not public.authorize_opportunity_action_as_system(
    p_actor_user_id,
    p_opportunity_id,
    'edit'
  ) or not public.authorize_email_inbox_action_as_system(
    p_actor_user_id,
    p_connection_id,
    p_opportunity_id,
    'view'
  ) then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  select opportunity.*
    into v_opportunity
    from public.opportunities opportunity
   where opportunity.id = p_opportunity_id
     and opportunity.company_id = p_company_id
   for update;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'unanswered_lead_message_projection_opportunity_stale';
  end if;

  if p_workstream = 'sales'
     and (
       v_opportunity.deleted_at is not null
       or v_opportunity.archived_at is not null
       or v_opportunity.merged_into_opportunity_id is not null
       or v_opportunity.project_id is not null
       or v_opportunity.project_ref is not null
       or v_opportunity.stage not in (
         'new_lead', 'qualifying', 'quoting', 'quoted', 'follow_up',
         'negotiation'
       )
     )
  then
    raise exception using
      errcode = '40001',
      message = 'unanswered_lead_message_projection_lead_stale';
  end if;

  select source_event.*
    into v_source_event
    from public.opportunity_correspondence_events source_event
   where source_event.id = p_source_event_id
     and source_event.company_id = p_company_id
     and source_event.opportunity_id = p_opportunity_id
     and source_event.activity_id = p_source_activity_id
     and source_event.connection_id = p_connection_id
     and source_event.provider_thread_id = p_source_provider_thread_id
     and source_event.provider_message_id = p_source_provider_message_id
     and source_event.direction = 'inbound'
     and source_event.party_role = 'customer'
     and source_event.is_meaningful is true
     and source_event.noise_reason is null
     and source_event.opportunity_projection_applied is true
   for update;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'unanswered_lead_message_projection_source_stale';
  end if;

  if not private.opportunity_sender_is_persisted_customer(
    p_company_id,
    p_opportunity_id,
    v_source_event.from_email
  ) then
    raise exception using
      errcode = '42501',
      message = 'unanswered_lead_message_projection_sender_denied';
  end if;

  select projection.*
    into v_existing
    from public.unanswered_lead_message_projections projection
   where projection.company_id = p_company_id
     and projection.opportunity_id = p_opportunity_id
     and projection.source_event_id = p_source_event_id
   for update;
  if found then
    if v_existing.source_activity_id = p_source_activity_id
       and v_existing.connection_id = p_connection_id
       and v_existing.provider_thread_id = p_source_provider_thread_id
       and v_existing.provider_message_id = p_source_provider_message_id
       and v_existing.workstream = p_workstream
       and v_existing.response_disposition = p_response_disposition
       and v_existing.conversation_scope = p_conversation_scope
       and v_existing.manifest_sha256 = p_manifest_sha256
       and v_existing.entry_sha256 = p_entry_sha256
       and v_existing.projected_by = p_actor_user_id
    then
      return jsonb_build_object(
        'status', 'already_exists',
        'source_event_id', p_source_event_id
      );
    end if;
    raise exception using
      errcode = '23505',
      message = 'unanswered_lead_message_projection_conflict';
  end if;

  -- Permission changes remain fail-closed at the final insert boundary.
  if not public.authorize_opportunity_action_as_system(
    p_actor_user_id,
    p_opportunity_id,
    'edit'
  ) or not public.authorize_email_inbox_action_as_system(
    p_actor_user_id,
    p_connection_id,
    p_opportunity_id,
    'view'
  ) then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  insert into public.unanswered_lead_message_projections (
    company_id,
    opportunity_id,
    source_event_id,
    source_activity_id,
    connection_id,
    provider_thread_id,
    provider_message_id,
    workstream,
    response_disposition,
    conversation_scope,
    manifest_sha256,
    entry_sha256,
    projected_by
  ) values (
    p_company_id,
    p_opportunity_id,
    p_source_event_id,
    p_source_activity_id,
    p_connection_id,
    p_source_provider_thread_id,
    p_source_provider_message_id,
    p_workstream,
    p_response_disposition,
    p_conversation_scope,
    p_manifest_sha256,
    p_entry_sha256,
    p_actor_user_id
  )
  on conflict do nothing
  returning source_event_id into v_inserted_event_id;

  if v_inserted_event_id is null then
    select projection.*
      into v_existing
      from public.unanswered_lead_message_projections projection
     where projection.company_id = p_company_id
       and projection.opportunity_id = p_opportunity_id
       and projection.source_event_id = p_source_event_id;
    if found
       and v_existing.source_activity_id = p_source_activity_id
       and v_existing.connection_id = p_connection_id
       and v_existing.provider_thread_id = p_source_provider_thread_id
       and v_existing.provider_message_id = p_source_provider_message_id
       and v_existing.workstream = p_workstream
       and v_existing.response_disposition = p_response_disposition
       and v_existing.conversation_scope = p_conversation_scope
       and v_existing.manifest_sha256 = p_manifest_sha256
       and v_existing.entry_sha256 = p_entry_sha256
       and v_existing.projected_by = p_actor_user_id
    then
      return jsonb_build_object(
        'status', 'already_exists',
        'source_event_id', p_source_event_id
      );
    end if;
    raise exception using
      errcode = '23505',
      message = 'unanswered_lead_message_projection_conflict';
  end if;

  return jsonb_build_object(
    'status', 'created',
    'source_event_id', v_inserted_event_id
  );
end;
$function$;

create or replace function public.persist_unanswered_lead_local_system_handoff(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_opportunity_id uuid,
  p_connection_id uuid,
  p_recipient_name text,
  p_recipient_email text,
  p_source_event_id uuid,
  p_source_activity_id uuid,
  p_source_provider_message_id text,
  p_source_provider_thread_id text,
  p_source_occurred_at timestamptz,
  p_provider_thread_id text,
  p_subject text,
  p_body text,
  p_ai_draft_history_id uuid,
  p_expected_workstream text,
  p_expected_stage text,
  p_expected_stage_manually_set boolean,
  p_expected_assignment_version bigint,
  p_expected_assigned_to uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_opportunity public.opportunities%rowtype;
  v_source_event public.opportunity_correspondence_events%rowtype;
  v_existing_draft_id uuid;
  v_inserted_draft_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_actor_user_id is null
     or p_company_id is null
     or p_opportunity_id is null
     or p_connection_id is null
     or p_source_event_id is null
     or p_source_activity_id is null
     or nullif(btrim(p_source_provider_message_id), '') is null
     or nullif(btrim(p_source_provider_thread_id), '') is null
     or p_source_occurred_at is null
     or nullif(btrim(p_recipient_email), '') is null
     or p_recipient_email is distinct from lower(btrim(p_recipient_email))
     or (
       p_recipient_name is not null
       and nullif(btrim(p_recipient_name), '') is null
     )
     or nullif(btrim(p_subject), '') is null
     or nullif(btrim(p_body), '') is null
     or p_ai_draft_history_id is null
     or p_expected_workstream is distinct from 'sales'
     or nullif(btrim(p_expected_stage), '') is null
     or p_expected_stage_manually_set is null
     or p_expected_assignment_version is null
     or p_expected_assignment_version < 0
  then
    raise exception using
      errcode = '22023',
      message = 'unanswered_lead_local_draft_persist_invalid';
  end if;
  if p_provider_thread_id is not null
     and p_provider_thread_id is distinct from p_source_provider_thread_id
  then
    raise exception using
      errcode = '22023',
      message = 'unanswered_lead_local_draft_thread_invalid';
  end if;

  if not public.authorize_opportunity_action_as_system(
    p_actor_user_id,
    p_opportunity_id,
    'edit'
  ) or not public.authorize_email_inbox_action_as_system(
    p_actor_user_id,
    p_connection_id,
    p_opportunity_id,
    'view'
  ) then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  select opportunity.*
    into v_opportunity
    from public.opportunities opportunity
   where opportunity.id = p_opportunity_id
     and opportunity.company_id = p_company_id
   for update;

  if not found then
    return jsonb_build_object(
      'status', 'stale',
      'reason', 'opportunity_not_found'
    );
  end if;

  select draft.id
    into v_existing_draft_id
    from public.opportunity_follow_up_drafts draft
   where draft.company_id = p_company_id
     and draft.opportunity_id = p_opportunity_id
     and draft.origin = 'system_handoff'
     and draft.source_event_id = p_source_event_id
   limit 1;
  if v_existing_draft_id is not null then
    return jsonb_build_object(
      'status', 'already_exists',
      'draft_id', v_existing_draft_id
    );
  end if;

  if v_opportunity.deleted_at is not null
     or v_opportunity.archived_at is not null
     or v_opportunity.merged_into_opportunity_id is not null
     or v_opportunity.project_id is not null
     or v_opportunity.project_ref is not null
     or v_opportunity.stage not in (
       'new_lead', 'qualifying', 'quoting', 'quoted', 'follow_up', 'negotiation'
     )
     or v_opportunity.stage is distinct from p_expected_stage
     or v_opportunity.stage_manually_set
       is distinct from p_expected_stage_manually_set
     or v_opportunity.assignment_version
       is distinct from p_expected_assignment_version
     or v_opportunity.assigned_to is distinct from p_expected_assigned_to
     or (
       nullif(
         lower(
           btrim(
             coalesce(
               v_opportunity.source_metadata ->> 'email_workstream',
               v_opportunity.source_metadata ->> 'workstream',
               ''
             )
           )
         ),
         ''
       ) is not null
       and lower(
         btrim(
           coalesce(
             v_opportunity.source_metadata ->> 'email_workstream',
             v_opportunity.source_metadata ->> 'workstream',
             ''
           )
         )
       ) <> 'sales'
     )
     or exists (
       select 1
         from unnest(coalesce(v_opportunity.tags, '{}'::text[])) tag(value)
        where lower(btrim(tag.value)) in (
          'warranty', 'service', 'current_project', 'current-project'
        )
     )
  then
    return jsonb_build_object(
      'status', 'stale',
      'reason', 'opportunity_snapshot_changed'
    );
  end if;

  select source_event.*
    into v_source_event
    from public.opportunity_correspondence_events source_event
   where source_event.id = p_source_event_id
     and source_event.company_id = p_company_id
     and source_event.opportunity_id = p_opportunity_id
     and source_event.activity_id = p_source_activity_id
     and source_event.connection_id = p_connection_id
     and source_event.provider_message_id = p_source_provider_message_id
     and source_event.provider_thread_id = p_source_provider_thread_id
     and lower(btrim(source_event.from_email)) = lower(btrim(p_recipient_email))
     and source_event.occurred_at = p_source_occurred_at
     and source_event.direction = 'inbound'
     and source_event.party_role = 'customer'
     and source_event.is_meaningful is true
     and source_event.noise_reason is null
     and source_event.opportunity_projection_applied is true;
  if not found then
    return jsonb_build_object(
      'status', 'stale',
      'reason', 'source_event_changed'
    );
  end if;

  if not private.opportunity_sender_is_persisted_customer(
    p_company_id,
    p_opportunity_id,
    v_source_event.from_email
  ) then
    return jsonb_build_object(
      'status', 'stale',
      'reason', 'source_sender_not_customer'
    );
  end if;

  -- Message-scoped drafts (notably forwarded Victoria forms) are eligible
  -- only after an approved manifest has durably projected this exact event.
  if p_provider_thread_id is null
     and not exists (
       select 1
         from public.unanswered_lead_message_projections projection
        where projection.company_id = p_company_id
          and projection.opportunity_id = p_opportunity_id
          and projection.source_event_id = p_source_event_id
          and projection.source_activity_id = p_source_activity_id
          and projection.connection_id = p_connection_id
          and projection.provider_thread_id = p_source_provider_thread_id
          and projection.provider_message_id = p_source_provider_message_id
          and projection.workstream = 'sales'
          and projection.response_disposition = 'reply_required'
          and projection.conversation_scope = 'message'
     )
  then
    return jsonb_build_object(
      'status', 'stale',
      'reason', 'message_projection_unavailable'
    );
  end if;

  if p_provider_thread_id is not null
     and not exists (
       select 1
         from public.email_threads thread
        where thread.company_id = p_company_id
          and thread.connection_id = p_connection_id
          and thread.provider_thread_id = p_source_provider_thread_id
          and thread.primary_category in ('LEAD', 'CLIENT', 'CUSTOMER')
          and thread.routing is distinct from 'update_lead_only'
          and exists (
            select 1
              from unnest(coalesce(thread.labels, '{}'::text[])) label(value)
             where upper(btrim(label.value)) = 'AWAITING_REPLY'
          )
          and (
            lower(btrim(coalesce(thread.latest_sender_email, ''))) =
              lower(btrim(v_source_event.from_email))
            or exists (
              select 1
                from unnest(
                  coalesce(thread.participants, '{}'::text[])
                ) participant(email)
               where lower(btrim(participant.email)) =
                 lower(btrim(v_source_event.from_email))
            )
          )
     )
  then
    return jsonb_build_object(
      'status', 'stale',
      'reason', 'thread_projection_unavailable'
    );
  end if;

  if not (
    not exists (
      select 1
        from public.opportunity_correspondence_events newer_inbound
       where newer_inbound.company_id = p_company_id
         and newer_inbound.opportunity_id = p_opportunity_id
         and newer_inbound.direction = 'inbound'
         and newer_inbound.party_role = 'customer'
         and newer_inbound.is_meaningful is true
         and newer_inbound.noise_reason is null
         and (newer_inbound.occurred_at, newer_inbound.id)
           > (v_source_event.occurred_at, v_source_event.id)
    )
  ) then
    return jsonb_build_object(
      'status', 'stale',
      'reason', 'newer_customer_inbound'
    );
  end if;

  if not (
    not exists (
      select 1
        from public.opportunity_correspondence_events later_outbound
       where later_outbound.company_id = p_company_id
         and later_outbound.opportunity_id = p_opportunity_id
         and later_outbound.direction = 'outbound'
         and later_outbound.party_role = 'ops'
         and later_outbound.is_meaningful is true
         and later_outbound.noise_reason is null
         and (later_outbound.occurred_at, later_outbound.id)
           > (v_source_event.occurred_at, v_source_event.id)
         and (
           (
             p_provider_thread_id is not null
             and later_outbound.connection_id = p_connection_id
             and later_outbound.provider_thread_id = p_source_provider_thread_id
           )
           or exists (
             select 1
               from unnest(
                 coalesce(later_outbound.to_emails, '{}'::text[])
                 || coalesce(later_outbound.cc_emails, '{}'::text[])
               ) outbound_recipient(email)
              where lower(btrim(outbound_recipient.email)) =
                lower(btrim(v_source_event.from_email))
           )
         )
    )
  ) then
    return jsonb_build_object(
      'status', 'stale',
      'reason', 'later_ops_outbound'
    );
  end if;

  if not exists (
    select 1
      from public.ai_draft_history ai_draft
     where ai_draft.id = p_ai_draft_history_id
       and ai_draft.company_id = p_company_id
       and ai_draft.user_id = p_actor_user_id
       and ai_draft.opportunity_id = p_opportunity_id
       and ai_draft.connection_id = p_connection_id
       and ai_draft.source_message_id = p_source_provider_message_id
       and ai_draft.origin = 'system_handoff'
       and ai_draft.status = 'drafted'
       and ai_draft.mailbox_draft_id is null
  ) then
    return jsonb_build_object(
      'status', 'stale',
      'reason', 'ai_draft_unavailable'
    );
  end if;

  -- Permission changes remain fail-closed at the final insert boundary.
  if not public.authorize_opportunity_action_as_system(
    p_actor_user_id,
    p_opportunity_id,
    'edit'
  ) or not public.authorize_email_inbox_action_as_system(
    p_actor_user_id,
    p_connection_id,
    p_opportunity_id,
    'view'
  ) then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  insert into public.opportunity_follow_up_drafts (
    company_id,
    opportunity_id,
    connection_id,
    provider_thread_id,
    recipient_email,
    recipient_name,
    source_event_id,
    origin,
    sequence_number,
    subject,
    original_body,
    current_body,
    status,
    provider_draft_id,
    ai_draft_history_id,
    created_by
  ) values (
    p_company_id,
    p_opportunity_id,
    p_connection_id,
    p_provider_thread_id,
    lower(btrim(p_recipient_email)),
    nullif(btrim(p_recipient_name), ''),
    p_source_event_id,
    'system_handoff',
    null,
    btrim(p_subject),
    btrim(p_body),
    null,
    'drafted',
    null,
    p_ai_draft_history_id,
    p_actor_user_id
  )
  on conflict (company_id, opportunity_id, source_event_id)
    where origin = 'system_handoff' and source_event_id is not null
  do nothing
  returning id into v_inserted_draft_id;

  if v_inserted_draft_id is null then
    select draft.id
      into v_existing_draft_id
      from public.opportunity_follow_up_drafts draft
     where draft.company_id = p_company_id
       and draft.opportunity_id = p_opportunity_id
       and draft.origin = 'system_handoff'
       and draft.source_event_id = p_source_event_id
     limit 1;
    if v_existing_draft_id is null then
      raise exception using
        errcode = '40001',
        message = 'unanswered_lead_local_draft_conflict';
    end if;
    return jsonb_build_object(
      'status', 'already_exists',
      'draft_id', v_existing_draft_id
    );
  end if;

  return jsonb_build_object(
    'status', 'created',
    'draft_id', v_inserted_draft_id
  );
end;
$function$;

revoke all on function public.claim_unanswered_lead_local_draft_generation(
  uuid, uuid, uuid, integer
) from public, anon, authenticated;
revoke all on function public.release_unanswered_lead_local_draft_generation(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.project_unanswered_lead_recovery_message(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.persist_unanswered_lead_local_system_handoff(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, text, timestamptz,
  text, text, text, uuid, text, text, boolean, bigint, uuid
) from public, anon, authenticated;
grant execute on function public.claim_unanswered_lead_local_draft_generation(
  uuid, uuid, uuid, integer
) to service_role;
grant execute on function public.release_unanswered_lead_local_draft_generation(
  uuid, uuid, uuid, uuid
) to service_role;
grant execute on function public.project_unanswered_lead_recovery_message(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text
) to service_role;
grant execute on function public.persist_unanswered_lead_local_system_handoff(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, text, timestamptz,
  text, text, text, uuid, text, text, boolean, bigint, uuid
) to service_role;

comment on table public.unanswered_lead_local_draft_generation_claims is
  'Short-lived service-only claims preventing duplicate local unanswered-lead copy generation for one exact correspondence event.';
comment on table public.unanswered_lead_message_projections is
  'Audited service-only routing projections for exact approved recovery messages; customer body text is never classification authority.';
comment on column public.opportunity_follow_up_drafts.recipient_email is
  'Exact source-event customer identity for a local lifecycle draft; no provider mutation is implied.';
comment on column public.opportunity_follow_up_drafts.recipient_name is
  'Optional display name bound to recipient_email when the primary contact identity matches.';
comment on index public.opportunity_follow_up_drafts_system_handoff_source_event_uidx is
  'At most one OPS-local system handoff draft may represent an exact source event.';
