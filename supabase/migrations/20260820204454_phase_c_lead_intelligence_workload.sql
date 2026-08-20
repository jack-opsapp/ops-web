begin;

-- Every meaningful, projected email leaves one opportunity-scoped dirty marker.
-- Component acknowledgements are event-fenced: a worker processing an older
-- snapshot can never clear a newer marker that arrived while it was running.
create table if not exists public.opportunity_phase_c_work (
  opportunity_id uuid not null primary key
    references public.opportunities(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  required_event_id uuid not null
    references public.opportunity_correspondence_events(id) on delete cascade,
  required_event_at timestamptz not null,
  required_activity_id uuid references public.activities(id) on delete set null,
  required_connection_id uuid not null,
  required_provider_thread_id text not null,
  summary_completed_event_id uuid
    references public.opportunity_correspondence_events(id) on delete set null,
  lifecycle_completed_event_id uuid
    references public.opportunity_correspondence_events(id) on delete set null,
  commercial_completed_event_id uuid
    references public.opportunity_correspondence_events(id) on delete set null,
  event_handoff_completed_event_id uuid
    references public.opportunity_correspondence_events(id) on delete set null,
  component_outcomes jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_attempt_at timestamptz,
  last_error_code text,
  last_error_message text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint opportunity_phase_c_work_opportunity_company_fkey
    foreign key (company_id, opportunity_id)
    references public.opportunities(company_id, id) on delete cascade,
  constraint opportunity_phase_c_work_event_company_fkey
    foreign key (company_id, required_event_id)
    references public.opportunity_correspondence_events(company_id, id)
    on delete restrict,
  constraint opportunity_phase_c_work_lease_pair_check check (
    (lease_owner is null and lease_expires_at is null)
    or (lease_owner is not null and lease_expires_at is not null)
  ),
  constraint opportunity_phase_c_work_thread_nonblank_check check (
    btrim(required_provider_thread_id) <> ''
  )
);

create index if not exists opportunity_phase_c_work_due_idx
  on public.opportunity_phase_c_work(next_attempt_at, required_event_at, opportunity_id)
  where completed_at is null;

create index if not exists opportunity_phase_c_work_required_event_idx
  on public.opportunity_phase_c_work(required_event_id);

create table if not exists public.opportunity_lifecycle_decisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  source_event_id uuid not null
    references public.opportunity_correspondence_events(id) on delete restrict,
  decision_kind text not null,
  decision_key text not null default 'primary',
  proposed_stage text,
  proposed_outcome text,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  evidence_event_ids uuid[] not null,
  evidence_message_ids text[] not null,
  reason text not null,
  initial_status text not null,
  initial_review_reason text,
  status text not null default 'proposed',
  guard_reason text,
  review_reason text,
  review_required_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint opportunity_lifecycle_decisions_kind_check check (
    decision_kind in ('stage', 'commercial_outcome', 'relationship', 'event_handoff')
  ),
  constraint opportunity_lifecycle_decisions_status_check check (
    status in ('proposed', 'applied', 'skipped', 'review', 'failed')
  ),
  constraint opportunity_lifecycle_decisions_initial_status_check check (
    initial_status in ('proposed', 'review')
  ),
  constraint opportunity_lifecycle_decisions_key_nonblank_check check (
    btrim(decision_key) <> ''
  ),
  constraint opportunity_lifecycle_decisions_reason_nonblank_check check (
    btrim(reason) <> ''
  ),
  constraint opportunity_lifecycle_decisions_review_check check (
    (status <> 'review')
    or (nullif(btrim(review_reason), '') is not null and review_required_at is not null)
  ),
  constraint opportunity_lifecycle_decisions_source_in_evidence_check check (
    source_event_id = any(evidence_event_ids)
  ),
  constraint opportunity_lifecycle_decisions_opportunity_company_fkey
    foreign key (company_id, opportunity_id)
    references public.opportunities(company_id, id) on delete cascade,
  constraint opportunity_lifecycle_decisions_source_event_company_fkey
    foreign key (company_id, source_event_id)
    references public.opportunity_correspondence_events(company_id, id)
    on delete restrict,
  unique (opportunity_id, source_event_id, decision_kind, decision_key)
);

create index if not exists opportunity_lifecycle_decisions_review_idx
  on public.opportunity_lifecycle_decisions(company_id, review_required_at, opportunity_id)
  where status = 'review';

create index if not exists opportunity_lifecycle_decisions_source_event_idx
  on public.opportunity_lifecycle_decisions(source_event_id);

create table if not exists public.phase_c_bilateral_event_handoffs (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  company_id uuid not null references public.companies(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  decision_id uuid references public.opportunity_lifecycle_decisions(id)
    on delete set null,
  proposal_event_id uuid not null
    references public.opportunity_correspondence_events(id) on delete restrict,
  acceptance_event_id uuid
    references public.opportunity_correspondence_events(id) on delete restrict,
  requested_owner_user_id uuid references public.users(id) on delete set null,
  event_kind text not null,
  event_title text,
  starts_at timestamptz,
  ends_at timestamptz,
  event_timezone text,
  location text,
  attendees jsonb not null default '[]'::jsonb,
  status text not null,
  review_reason text,
  canonical_event_kind text,
  canonical_event_id uuid,
  consumed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint phase_c_bilateral_event_handoffs_idempotency_nonblank_check check (
    btrim(idempotency_key) <> ''
  ),
  constraint phase_c_bilateral_event_handoffs_kind_check check (
    event_kind in ('site_visit', 'meeting', 'call', 'work')
  ),
  constraint phase_c_bilateral_event_handoffs_status_check check (
    status in ('ready', 'review', 'consumed', 'cancelled')
  ),
  constraint phase_c_bilateral_event_handoffs_attendees_array_check check (
    jsonb_typeof(attendees) = 'array'
  ),
  constraint phase_c_bilateral_event_handoffs_ready_check check (
    status <> 'ready'
    or (
      nullif(btrim(event_title), '') is not null
      and starts_at is not null
      and ends_at is not null
      and ends_at > starts_at
      and nullif(btrim(event_timezone), '') is not null
      and requested_owner_user_id is not null
      and acceptance_event_id is not null
      and proposal_event_id <> acceptance_event_id
    )
  ),
  constraint phase_c_bilateral_event_handoffs_review_check check (
    status <> 'review' or nullif(btrim(review_reason), '') is not null
  ),
  constraint phase_c_bilateral_event_handoffs_distinct_evidence_check check (
    acceptance_event_id is null or proposal_event_id <> acceptance_event_id
  ),
  constraint phase_c_bilateral_event_handoffs_opportunity_company_fkey
    foreign key (company_id, opportunity_id)
    references public.opportunities(company_id, id) on delete cascade,
  constraint phase_c_bilateral_event_handoffs_proposal_event_company_fkey
    foreign key (company_id, proposal_event_id)
    references public.opportunity_correspondence_events(company_id, id)
    on delete restrict,
  constraint phase_c_bilateral_event_handoffs_acceptance_event_company_fkey
    foreign key (company_id, acceptance_event_id)
    references public.opportunity_correspondence_events(company_id, id)
    on delete restrict
);

create index if not exists phase_c_bilateral_event_handoffs_ready_idx
  on public.phase_c_bilateral_event_handoffs(company_id, created_at, opportunity_id)
  where status = 'ready';

create index if not exists phase_c_bilateral_event_handoffs_proposal_event_idx
  on public.phase_c_bilateral_event_handoffs(proposal_event_id);

create index if not exists phase_c_bilateral_event_handoffs_acceptance_event_idx
  on public.phase_c_bilateral_event_handoffs(acceptance_event_id);

alter table public.opportunities
  add column if not exists stage_manual_boundary_event_id uuid
    references public.opportunity_correspondence_events(id) on delete set null,
  add column if not exists stage_manual_boundary_at timestamptz,
  add column if not exists stage_manual_corrected_at timestamptz;

create index if not exists opportunities_stage_manual_boundary_event_idx
  on public.opportunities(stage_manual_boundary_event_id)
  where stage_manual_boundary_event_id is not null;

create schema if not exists private;

create or replace function private.enqueue_opportunity_phase_c_work()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not new.is_meaningful or not new.opportunity_projection_applied then
    return new;
  end if;

  insert into public.opportunity_phase_c_work (
    opportunity_id,
    company_id,
    required_event_id,
    required_event_at,
    required_activity_id,
    required_connection_id,
    required_provider_thread_id,
    next_attempt_at,
    completed_at,
    updated_at
  ) values (
    new.opportunity_id,
    new.company_id,
    new.id,
    new.occurred_at,
    new.activity_id,
    new.connection_id,
    new.provider_thread_id,
    now(),
    null,
    now()
  )
  on conflict (opportunity_id) do update
    set company_id = excluded.company_id,
        required_event_id = excluded.required_event_id,
        required_event_at = excluded.required_event_at,
        required_activity_id = excluded.required_activity_id,
        required_connection_id = excluded.required_connection_id,
        required_provider_thread_id = excluded.required_provider_thread_id,
        next_attempt_at = least(
          public.opportunity_phase_c_work.next_attempt_at,
          excluded.next_attempt_at
        ),
        completed_at = null,
        updated_at = now()
  where (excluded.required_event_at, excluded.required_event_id)
      > (opportunity_phase_c_work.required_event_at, opportunity_phase_c_work.required_event_id);

  return new;
end;
$function$;

drop trigger if exists trg_enqueue_opportunity_phase_c_work
  on public.opportunity_correspondence_events;
create trigger trg_enqueue_opportunity_phase_c_work
after insert or update of is_meaningful, opportunity_projection_applied
on public.opportunity_correspondence_events
for each row execute function private.enqueue_opportunity_phase_c_work();

create or replace function private.protect_opportunity_lifecycle_decision_evidence()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.company_id is distinct from old.company_id
    or new.opportunity_id is distinct from old.opportunity_id
    or new.source_event_id is distinct from old.source_event_id
    or new.decision_kind is distinct from old.decision_kind
    or new.decision_key is distinct from old.decision_key
    or new.proposed_stage is distinct from old.proposed_stage
    or new.proposed_outcome is distinct from old.proposed_outcome
    or new.confidence is distinct from old.confidence
    or new.evidence_event_ids is distinct from old.evidence_event_ids
    or new.evidence_message_ids is distinct from old.evidence_message_ids
    or new.reason is distinct from old.reason
    or new.initial_status is distinct from old.initial_status
    or new.initial_review_reason is distinct from old.initial_review_reason
    or new.review_reason is distinct from old.review_reason
    or new.review_required_at is distinct from old.review_required_at
    or new.created_at is distinct from old.created_at
  then
    raise exception 'lifecycle_decision_evidence_is_immutable'
      using errcode = '22000';
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists trg_protect_opportunity_lifecycle_decision_evidence
  on public.opportunity_lifecycle_decisions;
create trigger trg_protect_opportunity_lifecycle_decision_evidence
before update on public.opportunity_lifecycle_decisions
for each row execute function private.protect_opportunity_lifecycle_decision_evidence();

create or replace function private.capture_opportunity_manual_stage_boundary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_event_id uuid;
  v_event_at timestamptz;
begin
  if coalesce(current_setting('ops.phase_c_stage_apply', true), '') = '1' then
    return new;
  end if;
  if not new.stage_manually_set then
    return new;
  end if;
  if new.stage is not distinct from old.stage
    and old.stage_manually_set is not distinct from new.stage_manually_set
  then
    return new;
  end if;

  select event.id, event.occurred_at
    into v_event_id, v_event_at
    from public.opportunity_correspondence_events event
   where event.company_id = new.company_id
     and event.opportunity_id = new.id
     and event.is_meaningful
     and event.opportunity_projection_applied
   order by event.occurred_at desc, event.id desc
   limit 1;

  new.stage_manual_boundary_event_id := v_event_id;
  new.stage_manual_boundary_at := v_event_at;
  new.stage_manual_corrected_at := now();
  return new;
end;
$function$;

drop trigger if exists trg_capture_opportunity_manual_stage_boundary
  on public.opportunities;
create trigger trg_capture_opportunity_manual_stage_boundary
before update of stage, stage_manually_set on public.opportunities
for each row execute function private.capture_opportunity_manual_stage_boundary();

-- Historical manual flags are fenced at the correspondence high-water mark
-- present during this additive migration. Only strictly newer evidence may
-- supersede that correction; no existing stage is changed by this backfill.
with latest as (
  select distinct on (event.company_id, event.opportunity_id)
         event.company_id,
         event.opportunity_id,
         event.id,
         event.occurred_at
    from public.opportunity_correspondence_events event
   where event.is_meaningful
     and event.opportunity_projection_applied
   order by event.company_id, event.opportunity_id,
            event.occurred_at desc, event.id desc
)
update public.opportunities opportunity
   set stage_manual_boundary_event_id = latest.id,
       stage_manual_boundary_at = latest.occurred_at,
       stage_manual_corrected_at = coalesce(
         opportunity.stage_entered_at,
         opportunity.updated_at,
         now()
       )
  from latest
 where opportunity.company_id = latest.company_id
   and opportunity.id = latest.opportunity_id
   and opportunity.stage_manually_set
   and opportunity.stage_manual_boundary_at is null;

create or replace function public.claim_opportunity_phase_c_work(
  p_worker_id text,
  p_limit integer default 10,
  p_lease_seconds integer default 120
) returns table (
  company_id uuid,
  opportunity_id uuid,
  required_event_id uuid,
  required_event_at timestamptz,
  required_activity_id uuid,
  required_connection_id uuid,
  required_provider_thread_id text,
  attempt_count integer,
  component_outcomes jsonb
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if nullif(btrim(p_worker_id), '') is null
    or p_limit < 1 or p_limit > 50
    or p_lease_seconds < 30 or p_lease_seconds > 900
  then
    raise exception 'invalid_phase_c_claim' using errcode = '22023';
  end if;

  return query
  with claimed as (
    select work.opportunity_id
      from public.opportunity_phase_c_work work
     where work.completed_at is null
       and work.next_attempt_at <= now()
       and (work.lease_expires_at is null or work.lease_expires_at <= now())
       and not (
         work.summary_completed_event_id = work.required_event_id
         and work.lifecycle_completed_event_id = work.required_event_id
         and work.commercial_completed_event_id = work.required_event_id
         and work.event_handoff_completed_event_id = work.required_event_id
       )
     order by work.next_attempt_at, work.required_event_at, work.opportunity_id
     for update skip locked
     limit p_limit
  ), leased as (
    update public.opportunity_phase_c_work work
       set lease_owner = btrim(p_worker_id),
           lease_expires_at = now() + make_interval(secs => p_lease_seconds),
           attempt_count = work.attempt_count + 1,
           last_attempt_at = now(),
           updated_at = now()
      from claimed
     where work.opportunity_id = claimed.opportunity_id
    returning work.*
  )
  select leased.company_id,
         leased.opportunity_id,
         leased.required_event_id,
         leased.required_event_at,
         leased.required_activity_id,
         leased.required_connection_id,
         leased.required_provider_thread_id,
         leased.attempt_count,
         leased.component_outcomes
    from leased
   order by leased.required_event_at, leased.opportunity_id;
end;
$function$;

create or replace function public.acknowledge_opportunity_phase_c_component(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_expected_required_event_id uuid,
  p_worker_id text,
  p_component text,
  p_outcome text,
  p_detail jsonb default '{}'::jsonb
) returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_work public.opportunity_phase_c_work%rowtype;
  v_completed boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_component not in ('summary', 'lifecycle', 'commercial', 'event_handoff')
    or p_outcome not in ('applied', 'unchanged', 'skipped', 'review')
  then
    raise exception 'invalid_phase_c_component_ack' using errcode = '22023';
  end if;

  select work.* into v_work
    from public.opportunity_phase_c_work work
   where work.company_id = p_company_id
     and work.opportunity_id = p_opportunity_id
   for update;
  if not found then
    raise exception 'phase_c_work_not_found' using errcode = 'P0002';
  end if;
  if v_work.required_event_id is distinct from p_expected_required_event_id then
    update public.opportunity_phase_c_work work
       set lease_owner = null,
           lease_expires_at = null,
           next_attempt_at = least(work.next_attempt_at, now()),
           updated_at = now()
     where work.opportunity_id = p_opportunity_id
       and work.lease_owner = btrim(p_worker_id);
    return 'superseded'::text;
  end if;
  if v_work.lease_owner is distinct from btrim(p_worker_id)
    or v_work.lease_expires_at is null
    or v_work.lease_expires_at <= now()
  then
    return 'lease_lost'::text;
  end if;

  update public.opportunity_phase_c_work work
     set summary_completed_event_id = case
           when p_component = 'summary' then p_expected_required_event_id
           else work.summary_completed_event_id
         end,
         lifecycle_completed_event_id = case
           when p_component = 'lifecycle' then p_expected_required_event_id
           else work.lifecycle_completed_event_id
         end,
         commercial_completed_event_id = case
           when p_component = 'commercial' then p_expected_required_event_id
           else work.commercial_completed_event_id
         end,
         event_handoff_completed_event_id = case
           when p_component = 'event_handoff' then p_expected_required_event_id
           else work.event_handoff_completed_event_id
         end,
         component_outcomes = jsonb_set(
           work.component_outcomes,
           array[p_component],
           jsonb_build_object(
             'outcome', p_outcome,
             'event_id', p_expected_required_event_id,
             'detail', coalesce(p_detail, '{}'::jsonb),
             'acknowledged_at', now()
           ),
           true
         ),
         last_error_code = null,
         last_error_message = null,
         updated_at = now()
   where work.opportunity_id = p_opportunity_id
     and work.required_event_id = p_expected_required_event_id;

  select (
    work.summary_completed_event_id = work.required_event_id
    and work.lifecycle_completed_event_id = work.required_event_id
    and work.commercial_completed_event_id = work.required_event_id
    and work.event_handoff_completed_event_id = work.required_event_id
  ) into v_completed
    from public.opportunity_phase_c_work work
   where work.opportunity_id = p_opportunity_id
   for update;

  if v_completed then
    update public.opportunity_phase_c_work work
       set lease_owner = null,
           lease_expires_at = null,
           completed_at = now(),
           updated_at = now()
     where work.opportunity_id = p_opportunity_id
       and work.required_event_id = p_expected_required_event_id;
    return 'completed'::text;
  end if;
  return 'acknowledged'::text;
end;
$function$;

create or replace function public.fail_opportunity_phase_c_work(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_expected_required_event_id uuid,
  p_worker_id text,
  p_error_code text,
  p_error_message text,
  p_retry_seconds integer default 60
) returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_updated integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if nullif(btrim(p_error_code), '') is null
    or p_retry_seconds < 1 or p_retry_seconds > 86400
  then
    raise exception 'invalid_phase_c_retry' using errcode = '22023';
  end if;

  update public.opportunity_phase_c_work work
     set lease_owner = null,
         lease_expires_at = null,
         next_attempt_at = now() + make_interval(secs => p_retry_seconds),
         last_error_code = left(btrim(p_error_code), 160),
         last_error_message = left(coalesce(p_error_message, ''), 2000),
         completed_at = null,
         updated_at = now()
   where work.company_id = p_company_id
     and work.opportunity_id = p_opportunity_id
     and work.required_event_id = p_expected_required_event_id
     and work.lease_owner = btrim(p_worker_id);
  get diagnostics v_updated = row_count;
  if v_updated = 1 then
    return 'retry_scheduled'::text;
  end if;

  if exists (
    select 1 from public.opportunity_phase_c_work work
     where work.company_id = p_company_id
       and work.opportunity_id = p_opportunity_id
       and work.required_event_id <> p_expected_required_event_id
  ) then
    return 'superseded'::text;
  end if;
  return 'lease_lost'::text;
end;
$function$;

create or replace function public.record_opportunity_lifecycle_decision(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_source_event_id uuid,
  p_decision_kind text,
  p_decision_key text,
  p_proposed_stage text,
  p_proposed_outcome text,
  p_confidence numeric,
  p_evidence_event_ids uuid[],
  p_evidence_message_ids text[],
  p_reason text,
  p_status text default 'proposed',
  p_review_reason text default null
) returns public.opportunity_lifecycle_decisions
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_existing public.opportunity_lifecycle_decisions%rowtype;
  v_inserted public.opportunity_lifecycle_decisions%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_status not in ('proposed', 'review')
    or nullif(btrim(p_reason), '') is null
    or p_source_event_id is null
    or not (p_source_event_id = any(coalesce(p_evidence_event_ids, '{}'::uuid[])))
  then
    raise exception 'invalid_lifecycle_decision' using errcode = '22023';
  end if;

  insert into public.opportunity_lifecycle_decisions (
    company_id, opportunity_id, source_event_id, decision_kind, decision_key,
    proposed_stage, proposed_outcome, confidence, evidence_event_ids,
    evidence_message_ids, reason, initial_status, initial_review_reason,
    status, review_reason, review_required_at
  ) values (
    p_company_id, p_opportunity_id, p_source_event_id, p_decision_kind,
    btrim(p_decision_key), p_proposed_stage, p_proposed_outcome, p_confidence,
    p_evidence_event_ids, coalesce(p_evidence_message_ids, '{}'::text[]),
    btrim(p_reason), p_status, nullif(btrim(p_review_reason), ''),
    p_status, nullif(btrim(p_review_reason), ''),
    case when p_status = 'review' then now() else null end
  )
  on conflict (opportunity_id, source_event_id, decision_kind, decision_key)
  do nothing
  returning * into v_inserted;
  if found then
    return v_inserted;
  end if;

  select decision.* into v_existing
    from public.opportunity_lifecycle_decisions decision
   where decision.opportunity_id = p_opportunity_id
     and decision.source_event_id = p_source_event_id
     and decision.decision_kind = p_decision_kind
     and decision.decision_key = btrim(p_decision_key);
  if v_existing.company_id is distinct from p_company_id
    or v_existing.proposed_stage is distinct from p_proposed_stage
    or v_existing.proposed_outcome is distinct from p_proposed_outcome
    or v_existing.confidence is distinct from p_confidence
    or v_existing.evidence_event_ids is distinct from p_evidence_event_ids
    or v_existing.evidence_message_ids is distinct from coalesce(p_evidence_message_ids, '{}'::text[])
    or v_existing.reason is distinct from btrim(p_reason)
    or v_existing.initial_status is distinct from p_status
    or v_existing.initial_review_reason is distinct from nullif(btrim(p_review_reason), '')
  then
    raise exception 'lifecycle_decision_replay_conflict' using errcode = '23505';
  end if;
  return v_existing;
end;
$function$;

create or replace function private.phase_c_active_stage_rank(p_stage text)
returns integer
language sql
immutable
strict
set search_path = ''
as $function$
  select case p_stage
    when 'new_lead' then 10
    when 'qualifying' then 20
    when 'quoting' then 30
    when 'quoted' then 40
    when 'follow_up' then 50
    when 'negotiation' then 60
    else null
  end;
$function$;

create or replace function public.settle_opportunity_lifecycle_decision(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_decision_id uuid,
  p_status text,
  p_guard_reason text default null
) returns public.opportunity_lifecycle_decisions
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_decision public.opportunity_lifecycle_decisions%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_status not in ('applied', 'skipped', 'failed') then
    raise exception 'invalid_lifecycle_decision_settlement' using errcode = '22023';
  end if;

  update public.opportunity_lifecycle_decisions decision
     set status = p_status,
         guard_reason = nullif(btrim(p_guard_reason), ''),
         applied_at = case when p_status = 'applied' then coalesce(decision.applied_at, now()) else decision.applied_at end
   where decision.id = p_decision_id
     and decision.company_id = p_company_id
     and decision.opportunity_id = p_opportunity_id
  returning decision.* into v_decision;
  if not found then
    raise exception 'lifecycle_decision_not_found' using errcode = 'P0002';
  end if;
  return v_decision;
end;
$function$;

create or replace function public.apply_phase_c_opportunity_stage_decision(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_decision_id uuid,
  p_expected_stage text,
  p_expected_assignment_version bigint
) returns table (
  changed boolean,
  stage text,
  stage_manually_set boolean,
  guard_reason text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_decision public.opportunity_lifecycle_decisions%rowtype;
  v_opportunity public.opportunities%rowtype;
  v_source_event_at timestamptz;
  v_source_is_newer_than_manual boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_expected_assignment_version is null or p_expected_assignment_version < 0 then
    raise exception 'assignment_snapshot_required' using errcode = '22023';
  end if;

  select decision, source_event.occurred_at
    into v_decision, v_source_event_at
    from public.opportunity_lifecycle_decisions decision
    join public.opportunity_correspondence_events source_event
      on source_event.id = decision.source_event_id
     and source_event.company_id = decision.company_id
   where decision.id = p_decision_id
     and decision.company_id = p_company_id
     and decision.opportunity_id = p_opportunity_id
   for update of decision;
  if not found then
    raise exception 'lifecycle_decision_not_found' using errcode = 'P0002';
  end if;
  if v_decision.decision_kind <> 'stage'
    or v_decision.status not in ('proposed', 'applied', 'skipped')
    or private.phase_c_active_stage_rank(v_decision.proposed_stage) is null
  then
    raise exception 'invalid_stage_decision' using errcode = '22023';
  end if;

  select opportunity.* into v_opportunity
    from public.opportunities opportunity
   where opportunity.id = p_opportunity_id
     and opportunity.company_id = p_company_id
     and opportunity.deleted_at is null
   for update;
  if not found then
    raise exception 'opportunity_not_found' using errcode = 'P0002';
  end if;

  if v_decision.status = 'applied'
    and v_opportunity.stage = v_decision.proposed_stage
  then
    return query select false, v_opportunity.stage,
      v_opportunity.stage_manually_set, 'already_applied'::text;
    return;
  end if;
  if v_opportunity.assignment_version is distinct from p_expected_assignment_version then
    update public.opportunity_lifecycle_decisions
       set status = 'skipped', guard_reason = 'assignment_snapshot_mismatch'
     where id = p_decision_id;
    return query select false, v_opportunity.stage,
      v_opportunity.stage_manually_set, 'assignment_snapshot_mismatch'::text;
    return;
  end if;
  if v_opportunity.stage is distinct from p_expected_stage then
    update public.opportunity_lifecycle_decisions
       set status = 'skipped', guard_reason = 'snapshot_mismatch'
     where id = p_decision_id;
    return query select false, v_opportunity.stage,
      v_opportunity.stage_manually_set, 'snapshot_mismatch'::text;
    return;
  end if;
  if private.phase_c_active_stage_rank(v_opportunity.stage) is null then
    update public.opportunity_lifecycle_decisions
       set status = 'skipped', guard_reason = 'terminal_stage'
     where id = p_decision_id;
    return query select false, v_opportunity.stage,
      v_opportunity.stage_manually_set, 'terminal_stage'::text;
    return;
  end if;
  if private.phase_c_active_stage_rank(v_decision.proposed_stage)
      <= private.phase_c_active_stage_rank(v_opportunity.stage)
  then
    update public.opportunity_lifecycle_decisions
       set status = 'skipped', guard_reason = 'stage_regression_blocked'
     where id = p_decision_id;
    return query select false, v_opportunity.stage,
      v_opportunity.stage_manually_set, 'stage_regression_blocked'::text;
    return;
  end if;

  v_source_is_newer_than_manual :=
    v_opportunity.stage_manual_boundary_at is null
    or v_source_event_at > v_opportunity.stage_manual_boundary_at
    or (
      v_source_event_at = v_opportunity.stage_manual_boundary_at
      and v_opportunity.stage_manual_boundary_event_id is not null
      and v_decision.source_event_id > v_opportunity.stage_manual_boundary_event_id
    );
  if coalesce(v_opportunity.stage_manually_set, false)
    and not v_source_is_newer_than_manual
  then
    update public.opportunity_lifecycle_decisions
       set status = 'skipped', guard_reason = 'manual_correction_is_newer'
     where id = p_decision_id;
    return query select false, v_opportunity.stage,
      v_opportunity.stage_manually_set, 'manual_correction_is_newer'::text;
    return;
  end if;

  perform set_config('ops.phase_c_stage_apply', '1', true);
  update public.opportunities opportunity
     set stage = v_decision.proposed_stage,
         stage_entered_at = now(),
         stage_manually_set = false,
         win_probability = case v_decision.proposed_stage
           when 'new_lead' then 10
           when 'qualifying' then 20
           when 'quoting' then 40
           when 'quoted' then 60
           when 'follow_up' then 50
           when 'negotiation' then 75
         end,
         ai_stage_confidence = v_decision.confidence,
         ai_stage_signals = array(
           select distinct signal
             from unnest(
               coalesce(opportunity.ai_stage_signals, '{}'::text[])
               || array[v_decision.reason]
             ) signal
         ),
         updated_at = now()
   where opportunity.id = p_opportunity_id
     and opportunity.company_id = p_company_id;

  insert into public.stage_transitions (
    company_id, opportunity_id, from_stage, to_stage, transitioned_at,
    transitioned_by, duration_in_stage
  ) values (
    p_company_id, p_opportunity_id, v_opportunity.stage,
    v_decision.proposed_stage, now(), null,
    now() - coalesce(v_opportunity.stage_entered_at, now())
  );

  update public.opportunity_lifecycle_decisions
     set status = 'applied', guard_reason = null, applied_at = now()
   where id = p_decision_id;

  return query select true, v_decision.proposed_stage, false, null::text;
end;
$function$;

create or replace function public.record_phase_c_bilateral_event_handoff(
  p_idempotency_key text,
  p_company_id uuid,
  p_opportunity_id uuid,
  p_decision_id uuid,
  p_proposal_event_id uuid,
  p_acceptance_event_id uuid,
  p_requested_owner_user_id uuid,
  p_event_kind text,
  p_event_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_event_timezone text,
  p_location text,
  p_attendees jsonb,
  p_status text,
  p_review_reason text
) returns public.phase_c_bilateral_event_handoffs
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_inserted public.phase_c_bilateral_event_handoffs%rowtype;
  v_existing public.phase_c_bilateral_event_handoffs%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_status not in ('ready', 'review') then
    raise exception 'invalid_bilateral_event_handoff_status' using errcode = '22023';
  end if;

  insert into public.phase_c_bilateral_event_handoffs (
    idempotency_key, company_id, opportunity_id, decision_id,
    proposal_event_id, acceptance_event_id, requested_owner_user_id,
    event_kind, event_title, starts_at, ends_at, event_timezone, location,
    attendees, status, review_reason
  ) values (
    btrim(p_idempotency_key), p_company_id, p_opportunity_id, p_decision_id,
    p_proposal_event_id, p_acceptance_event_id, p_requested_owner_user_id,
    p_event_kind, nullif(btrim(p_event_title), ''), p_starts_at, p_ends_at,
    nullif(btrim(p_event_timezone), ''), nullif(btrim(p_location), ''),
    coalesce(p_attendees, '[]'::jsonb), p_status,
    nullif(btrim(p_review_reason), '')
  )
  on conflict (idempotency_key) do nothing
  returning * into v_inserted;
  if found then
    return v_inserted;
  end if;

  select handoff.* into v_existing
    from public.phase_c_bilateral_event_handoffs handoff
   where handoff.idempotency_key = btrim(p_idempotency_key);
  if v_existing.company_id is distinct from p_company_id
    or v_existing.opportunity_id is distinct from p_opportunity_id
    or v_existing.decision_id is distinct from p_decision_id
    or v_existing.proposal_event_id is distinct from p_proposal_event_id
    or v_existing.acceptance_event_id is distinct from p_acceptance_event_id
    or v_existing.requested_owner_user_id is distinct from p_requested_owner_user_id
    or v_existing.event_kind is distinct from p_event_kind
    or v_existing.event_title is distinct from nullif(btrim(p_event_title), '')
    or v_existing.starts_at is distinct from p_starts_at
    or v_existing.ends_at is distinct from p_ends_at
    or v_existing.event_timezone is distinct from nullif(btrim(p_event_timezone), '')
    or v_existing.location is distinct from nullif(btrim(p_location), '')
    or v_existing.attendees is distinct from coalesce(p_attendees, '[]'::jsonb)
    or v_existing.status is distinct from p_status
    or v_existing.review_reason is distinct from nullif(btrim(p_review_reason), '')
  then
    raise exception 'bilateral_event_handoff_replay_conflict' using errcode = '23505';
  end if;
  return v_existing;
end;
$function$;

alter table public.opportunity_phase_c_work enable row level security;
alter table public.opportunity_phase_c_work force row level security;
alter table public.opportunity_lifecycle_decisions enable row level security;
alter table public.opportunity_lifecycle_decisions force row level security;
alter table public.phase_c_bilateral_event_handoffs enable row level security;
alter table public.phase_c_bilateral_event_handoffs force row level security;

revoke all on table public.opportunity_phase_c_work from public, anon, authenticated;
revoke all on table public.opportunity_lifecycle_decisions from public, anon, authenticated;
revoke all on table public.phase_c_bilateral_event_handoffs from public, anon, authenticated;
grant select, insert, update on table public.opportunity_phase_c_work to service_role;
grant select, insert on table public.opportunity_lifecycle_decisions to service_role;
grant select, insert, update on table public.phase_c_bilateral_event_handoffs to service_role;

revoke all on function private.enqueue_opportunity_phase_c_work() from public;
revoke all on function private.protect_opportunity_lifecycle_decision_evidence() from public;
revoke all on function private.capture_opportunity_manual_stage_boundary() from public;
revoke all on function private.phase_c_active_stage_rank(text) from public;

revoke all on function public.claim_opportunity_phase_c_work(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_opportunity_phase_c_work(text, integer, integer)
  to service_role;

revoke all on function public.acknowledge_opportunity_phase_c_component(
  uuid, uuid, uuid, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.acknowledge_opportunity_phase_c_component(
  uuid, uuid, uuid, text, text, text, jsonb
) to service_role;

revoke all on function public.fail_opportunity_phase_c_work(
  uuid, uuid, uuid, text, text, text, integer
) from public, anon, authenticated;
grant execute on function public.fail_opportunity_phase_c_work(
  uuid, uuid, uuid, text, text, text, integer
) to service_role;

revoke all on function public.record_opportunity_lifecycle_decision(
  uuid, uuid, uuid, text, text, text, text, numeric, uuid[], text[], text, text, text
) from public, anon, authenticated;
grant execute on function public.record_opportunity_lifecycle_decision(
  uuid, uuid, uuid, text, text, text, text, numeric, uuid[], text[], text, text, text
) to service_role;

revoke all on function public.settle_opportunity_lifecycle_decision(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.settle_opportunity_lifecycle_decision(
  uuid, uuid, uuid, text, text
) to service_role;

revoke all on function public.apply_phase_c_opportunity_stage_decision(
  uuid, uuid, uuid, text, bigint
) from public, anon, authenticated;
grant execute on function public.apply_phase_c_opportunity_stage_decision(
  uuid, uuid, uuid, text, bigint
) to service_role;

revoke all on function public.record_phase_c_bilateral_event_handoff(
  text, uuid, uuid, uuid, uuid, uuid, uuid, text, text,
  timestamptz, timestamptz, text, text, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.record_phase_c_bilateral_event_handoff(
  text, uuid, uuid, uuid, uuid, uuid, uuid, text, text,
  timestamptz, timestamptz, text, text, jsonb, text, text
) to service_role;

commit;
