-- Phase C lead-disposition feedback.
--
-- Local implementation only. Do not apply without explicit operator approval.
--
-- The operator-facing correction, the lifecycle transition, and the learning
-- signal share one actor-authorized transaction. Free-text context is retained
-- for audit only; the classifier service deliberately never selects it.

create table public.lead_disposition_feedback (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  actor_user_id uuid not null references public.users(id) on delete restrict,

  reason_code text not null check (reason_code in (
    'spam',
    'job_applicant',
    'vendor_sales',
    'internal',
    'platform_notification',
    'test_traffic',
    'duplicate',
    'not_a_fit',
    'other',
    'legacy_unspecified'
  )),
  canonical_outcome text not null check (canonical_outcome in (
    'discarded',
    'lost',
    'duplicate_review',
    'review_deferred'
  )),
  learning_polarity text not null check (learning_polarity in (
    'negative',
    'positive',
    'neutral'
  )),
  learning_state text not null default 'active' check (learning_state in (
    'active',
    'retracted'
  )),
  resolution_status text not null check (resolution_status in (
    'applied',
    'review_required',
    'undone'
  )),
  optional_note text,
  phase_c_enabled boolean not null,

  prior_stage text not null,
  prior_stage_entered_at timestamptz not null,
  prior_stage_manually_set boolean not null,
  prior_lost_reason text,
  prior_lost_notes text,
  prior_actual_close_date date,
  applied_stage text,
  applied_opportunity_updated_at timestamptz,
  prior_disposition_id uuid references public.opportunity_dispositions(id)
    on delete set null,
  disposition_id uuid references public.opportunity_dispositions(id)
    on delete set null,

  source_thread_id uuid references public.email_threads(id) on delete set null,
  source_connection_id uuid references public.email_connections(id)
    on delete set null,
  source_provider_thread_id text,
  source_message_id text,
  source_thread_key text,
  sender_email text,
  sender_domain text,
  participants_hash text,
  model_context jsonb not null default '{}'::jsonb,
  policy_context jsonb not null default '{}'::jsonb,

  apply_idempotency_key text not null,
  undo_idempotency_key text,
  retracted_at timestamptz,
  retracted_by uuid references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint lead_disposition_feedback_note_length
    check (optional_note is null or char_length(optional_note) <= 500),
  constraint lead_disposition_feedback_apply_key_length
    check (char_length(apply_idempotency_key) between 8 and 128),
  constraint lead_disposition_feedback_undo_key_length
    check (
      undo_idempotency_key is null
      or char_length(undo_idempotency_key) between 8 and 128
    ),
  constraint lead_disposition_feedback_applied_pair
    check (
      (applied_stage is null and applied_opportunity_updated_at is null)
      or (applied_stage is not null and applied_opportunity_updated_at is not null)
    ),
  unique (company_id, actor_user_id, apply_idempotency_key)
);

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.lead_disposition_feedback'::regclass
       and conname = 'lead_disposition_feedback_company_opportunity_fk'
  ) then
    alter table public.lead_disposition_feedback
      add constraint lead_disposition_feedback_company_opportunity_fk
      foreign key (company_id, opportunity_id)
      references public.opportunities(company_id, id)
      on delete cascade;
  end if;
end;
$$;

create index lead_disposition_feedback_company_sender_active_idx
  on public.lead_disposition_feedback (
    company_id,
    sender_email,
    created_at desc
  )
  where learning_state = 'active';

create index lead_disposition_feedback_company_domain_active_idx
  on public.lead_disposition_feedback (
    company_id,
    sender_domain,
    created_at desc
  )
  where learning_state = 'active' and sender_domain is not null;

create index lead_disposition_feedback_company_thread_active_idx
  on public.lead_disposition_feedback (
    company_id,
    source_connection_id,
    source_provider_thread_id,
    created_at desc
  )
  where learning_state = 'active' and source_provider_thread_id is not null;

create unique index lead_disposition_feedback_undo_key_uidx
  on public.lead_disposition_feedback (
    company_id,
    retracted_by,
    undo_idempotency_key
  )
  where undo_idempotency_key is not null;

-- A durable, service-only hold for future messages that feedback moves into
-- the uncertainty band. It contains identifiers and structured scores only;
-- message content and feedback notes never enter this table.
create table public.lead_classification_reviews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  connection_id uuid not null references public.email_connections(id) on delete cascade,
  provider_thread_id text not null,
  provider_message_id text not null,
  sender_email text,
  sender_domain text,
  baseline_verdict text not null check (baseline_verdict in (
    'lead',
    'not_lead'
  )),
  baseline_confidence double precision not null
    check (baseline_confidence between 0 and 1),
  adjusted_lead_score double precision not null
    check (adjusted_lead_score between 0 and 1),
  review_reason text not null check (review_reason in (
    'feedback_boundary',
    'duplicate_feedback',
    'neutral_feedback',
    'positive_feedback_conflict'
  )),
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in (
    'pending',
    'resolved'
  )),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, connection_id, provider_message_id)
);

create index lead_classification_reviews_pending_idx
  on public.lead_classification_reviews (company_id, created_at)
  where status = 'pending';

alter table public.lead_disposition_feedback enable row level security;
alter table public.lead_classification_reviews enable row level security;

create policy lead_disposition_feedback_select
  on public.lead_disposition_feedback
  for select
  to anon, authenticated
  using (private.current_user_can_view_opportunity(opportunity_id));

revoke insert, update, delete on table public.lead_disposition_feedback
  from public, anon, authenticated;
revoke all on table public.lead_classification_reviews
  from public, anon, authenticated;

grant select on table public.lead_disposition_feedback
  to anon, authenticated;
grant select on table public.lead_disposition_feedback to service_role;
grant select, insert, update on table public.lead_classification_reviews
  to service_role;

create or replace function public.get_lead_disposition_context(
  p_opportunity_id uuid
) returns table (
  phase_c_enabled boolean,
  policy_version text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor_user_id uuid;
  v_company_id uuid;
begin
  v_actor_user_id := private.get_current_user_id();
  if v_actor_user_id is null then
    raise exception 'actor_not_found' using errcode = '42501';
  end if;

  select opportunity.company_id
    into v_company_id
    from public.opportunities opportunity
   where opportunity.id = p_opportunity_id
     and opportunity.deleted_at is null;

  if v_company_id is null
     or not private.current_user_can_edit_opportunity(p_opportunity_id)
  then
    raise exception 'opportunity_access_denied' using errcode = '42501';
  end if;

  return query
  select
    exists (
      select 1
        from public.admin_feature_overrides feature
       where feature.company_id = v_company_id::text
         and feature.feature_key = 'phase_c'
         and feature.enabled = true
    ),
    'phase_c_lead_feedback_v1'::text;
end;
$function$;

revoke all on function public.get_lead_disposition_context(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_lead_disposition_context(uuid)
  to anon, authenticated;

create or replace function public.apply_lead_disposition_feedback(
  p_opportunity_id uuid,
  p_reason_code text,
  p_optional_note text,
  p_idempotency_key text
) returns table (
  feedback_id uuid,
  outcome text,
  prior_stage text,
  current_stage text,
  current_stage_entered_at timestamptz,
  current_stage_manually_set boolean,
  current_lost_reason text,
  current_lost_notes text,
  current_actual_close_date date,
  lifecycle_changed boolean,
  idempotent_replay boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_user_id uuid;
  v_opportunity public.opportunities%rowtype;
  v_existing public.lead_disposition_feedback%rowtype;
  v_thread public.email_threads%rowtype;
  v_prior_disposition public.opportunity_dispositions%rowtype;
  v_feedback_id uuid := gen_random_uuid();
  v_disposition_id uuid;
  v_company_id uuid;
  v_reason text := lower(trim(coalesce(p_reason_code, '')));
  v_note text := nullif(trim(coalesce(p_optional_note, '')), '');
  v_idempotency_key text := trim(coalesce(p_idempotency_key, ''));
  v_phase_c_enabled boolean;
  v_outcome text;
  v_learning_polarity text;
  v_target_stage text;
  v_sender_email text;
  v_sender_domain text;
  v_participants_hash text;
  v_source_message_id text;
  v_source_provider_thread_id text;
  v_source_thread_candidate_count integer := 0;
  v_now timestamptz := clock_timestamp();
begin
  v_actor_user_id := private.get_current_user_id();
  if v_actor_user_id is null then
    raise exception 'actor_not_found' using errcode = '42501';
  end if;
  if char_length(v_idempotency_key) not between 8 and 128 then
    raise exception 'invalid_idempotency_key' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'feedback_note_too_long' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_actor_user_id::text || ':' || v_idempotency_key, 0)
  );

  select opportunity.*
    into v_opportunity
    from public.opportunities opportunity
   where opportunity.id = p_opportunity_id
     and opportunity.deleted_at is null
   for update;
  if not found then
    raise exception 'opportunity_not_found' using errcode = 'P0002';
  end if;

  v_company_id := v_opportunity.company_id;
  if not private.current_user_can_edit_opportunity(p_opportunity_id) then
    raise exception 'opportunity_access_denied' using errcode = '42501';
  end if;

  select feedback.*
    into v_existing
    from public.lead_disposition_feedback feedback
   where feedback.company_id = v_company_id
     and feedback.actor_user_id = v_actor_user_id
     and feedback.apply_idempotency_key = v_idempotency_key;
  if found then
    if v_existing.opportunity_id <> p_opportunity_id then
      raise exception 'idempotency_key_reused' using errcode = '23505';
    end if;
    feedback_id := v_existing.id;
    outcome := v_existing.canonical_outcome;
    prior_stage := v_existing.prior_stage;
    current_stage := coalesce(v_existing.applied_stage, v_existing.prior_stage);
    current_stage_entered_at := coalesce(
      v_existing.applied_opportunity_updated_at,
      v_existing.prior_stage_entered_at
    );
    current_stage_manually_set := case
      when v_existing.applied_stage is not null then true
      else v_existing.prior_stage_manually_set
    end;
    current_lost_reason := case
      when v_existing.canonical_outcome = 'lost' then 'other'
      when v_existing.applied_stage is not null then null
      else v_existing.prior_lost_reason
    end;
    current_lost_notes := case
      when v_existing.canonical_outcome = 'lost' then v_existing.optional_note
      when v_existing.applied_stage is not null then null
      else v_existing.prior_lost_notes
    end;
    current_actual_close_date := case
      when v_existing.canonical_outcome = 'lost'
        then v_existing.applied_opportunity_updated_at::date
      when v_existing.applied_stage is not null then null
      else v_existing.prior_actual_close_date
    end;
    lifecycle_changed := v_existing.applied_stage is not null;
    idempotent_replay := true;
    return next;
    return;
  end if;

  select exists (
    select 1
      from public.admin_feature_overrides feature
     where feature.company_id = v_company_id::text
       and feature.feature_key = 'phase_c'
       and feature.enabled = true
  )
  into v_phase_c_enabled;

  if v_phase_c_enabled then
    if v_reason not in (
      'spam',
      'job_applicant',
      'vendor_sales',
      'internal',
      'platform_notification',
      'test_traffic',
      'duplicate',
      'not_a_fit',
      'other'
    ) then
      raise exception 'invalid_phase_c_reason' using errcode = '22023';
    end if;
  elsif v_reason <> 'legacy_unspecified' then
    raise exception 'phase_c_disabled' using errcode = '22023';
  end if;

  if v_opportunity.stage in ('won', 'lost', 'discarded')
     or v_opportunity.merged_into_opportunity_id is not null
  then
    raise exception 'opportunity_terminal_or_merged' using errcode = '23514';
  end if;

  v_outcome := case
    when v_reason in (
      'spam',
      'job_applicant',
      'vendor_sales',
      'internal',
      'platform_notification',
      'test_traffic',
      'legacy_unspecified'
    ) then 'discarded'
    when v_reason = 'not_a_fit' then 'lost'
    when v_reason = 'duplicate' then 'duplicate_review'
    when v_reason = 'other' then 'review_deferred'
  end;

  v_learning_polarity := case
    when v_reason in (
      'spam',
      'job_applicant',
      'vendor_sales',
      'internal',
      'platform_notification',
      'test_traffic'
    ) then 'negative'
    when v_reason = 'not_a_fit' then 'positive'
    else 'neutral'
  end;

  if v_outcome = 'discarded' then
    v_target_stage := 'discarded';
  elsif v_outcome = 'lost' then
    v_target_stage := 'lost';
  else
    v_target_stage := null;
  end if;

  v_source_provider_thread_id := case
    when v_opportunity.source_thread_key like '%:thread:%'
      then split_part(v_opportunity.source_thread_key, ':thread:', 2)
    when v_opportunity.source_thread_key is not null
         and v_opportunity.source_thread_key not like '%:%'
      then v_opportunity.source_thread_key
    else null
  end;

  select count(*)
    into v_source_thread_candidate_count
    from public.email_threads thread
   where thread.company_id = v_company_id
     and (
       thread.opportunity_id = p_opportunity_id
       or exists (
         select 1
           from public.opportunity_email_threads link
          where link.opportunity_id = p_opportunity_id
            and link.thread_id = thread.provider_thread_id
            and (
              link.connection_id is null
              or link.connection_id = thread.connection_id
            )
       )
     )
     and (
       v_source_provider_thread_id is null
       or thread.provider_thread_id = v_source_provider_thread_id
     );

  select thread.*
    into v_thread
    from public.email_threads thread
   where thread.company_id = v_company_id
     and (
       thread.opportunity_id = p_opportunity_id
       or exists (
         select 1
           from public.opportunity_email_threads link
          where link.opportunity_id = p_opportunity_id
            and link.thread_id = thread.provider_thread_id
            and (
              link.connection_id is null
              or link.connection_id = thread.connection_id
            )
       )
     )
     and (
       v_source_provider_thread_id is null
       or thread.provider_thread_id = v_source_provider_thread_id
     )
     and v_source_thread_candidate_count = 1
   order by
     (thread.opportunity_id = p_opportunity_id) desc,
     thread.last_message_at desc,
     thread.id
   limit 1;

  v_source_message_id := coalesce(
    v_opportunity.source_message_id,
    v_opportunity.source_email_id
  );
  v_sender_email := lower(
    nullif(
      trim(
        coalesce(
          v_opportunity.contact_email,
          case
            when v_thread.latest_direction = 'inbound'
              then v_thread.latest_sender_email
          end
        )
      ),
      ''
    )
  );
  if v_sender_email like '%@%' then
    v_sender_domain := nullif(split_part(v_sender_email, '@', 2), '');
  end if;

  if coalesce(cardinality(v_thread.participants), 0) > 0 then
    select encode(
      extensions.digest(
        string_agg(distinct lower(trim(participant)), '|' order by lower(trim(participant))),
        'sha256'
      ),
      'hex'
    )
      into v_participants_hash
      from unnest(v_thread.participants) participant
     where trim(participant) <> '';
  end if;

  if v_target_stage is not null then
    select disposition.*
      into v_prior_disposition
      from public.opportunity_dispositions disposition
     where disposition.company_id = v_company_id
       and disposition.opportunity_id = p_opportunity_id
       and disposition.superseded_at is null
     for update;

    v_disposition_id := gen_random_uuid();
    if v_prior_disposition.id is not null then
      update public.opportunity_dispositions
         set superseded_at = v_now,
             superseded_by = v_disposition_id
       where id = v_prior_disposition.id;
    end if;

    insert into public.opportunity_dispositions (
      id,
      company_id,
      opportunity_id,
      disposition,
      reason_code,
      reason_notes,
      decided_via,
      decided_by,
      evidence
    ) values (
      v_disposition_id,
      v_company_id,
      p_opportunity_id,
      case when v_outcome = 'lost' then 'disqualified' else 'discarded' end,
      v_reason,
      v_note,
      'operator_manual',
      v_actor_user_id,
      jsonb_build_object(
        'lead_disposition_feedback_id', v_feedback_id,
        'policy_version', 'phase_c_lead_feedback_v1',
        'source_thread_id', v_thread.id,
        'source_message_id', v_source_message_id
      )
    );

    update public.opportunities
       set stage = v_target_stage,
           stage_entered_at = v_now,
           stage_manually_set = true,
           lost_reason = case when v_outcome = 'lost' then 'other' else null end,
           lost_notes = case when v_outcome = 'lost' then v_note else null end,
           actual_close_date = case
             when v_outcome = 'lost' then v_now::date
             else null
           end,
           updated_at = v_now
     where id = p_opportunity_id;

    insert into public.stage_transitions (
      company_id,
      opportunity_id,
      from_stage,
      to_stage,
      transitioned_at,
      transitioned_by,
      duration_in_stage
    ) values (
      v_company_id,
      p_opportunity_id,
      v_opportunity.stage,
      v_target_stage,
      v_now,
      v_actor_user_id,
      v_now - v_opportunity.stage_entered_at
    );
  end if;

  insert into public.lead_disposition_feedback (
    id,
    company_id,
    opportunity_id,
    actor_user_id,
    reason_code,
    canonical_outcome,
    learning_polarity,
    learning_state,
    resolution_status,
    optional_note,
    phase_c_enabled,
    prior_stage,
    prior_stage_entered_at,
    prior_stage_manually_set,
    prior_lost_reason,
    prior_lost_notes,
    prior_actual_close_date,
    applied_stage,
    applied_opportunity_updated_at,
    prior_disposition_id,
    disposition_id,
    source_thread_id,
    source_connection_id,
    source_provider_thread_id,
    source_message_id,
    source_thread_key,
    sender_email,
    sender_domain,
    participants_hash,
    model_context,
    policy_context,
    apply_idempotency_key,
    created_at,
    updated_at
  ) values (
    v_feedback_id,
    v_company_id,
    p_opportunity_id,
    v_actor_user_id,
    v_reason,
    v_outcome,
    v_learning_polarity,
    'active',
    case
      when v_target_stage is null then 'review_required'
      else 'applied'
    end,
    v_note,
    v_phase_c_enabled,
    v_opportunity.stage,
    v_opportunity.stage_entered_at,
    v_opportunity.stage_manually_set,
    v_opportunity.lost_reason,
    v_opportunity.lost_notes,
    v_opportunity.actual_close_date,
    v_target_stage,
    case when v_target_stage is not null then v_now end,
    v_prior_disposition.id,
    v_disposition_id,
    v_thread.id,
    v_thread.connection_id,
    v_thread.provider_thread_id,
    v_source_message_id,
    v_opportunity.source_thread_key,
    v_sender_email,
    v_sender_domain,
    v_participants_hash,
    jsonb_strip_nulls(
      jsonb_build_object(
        'opportunity_ai_stage_confidence', v_opportunity.ai_stage_confidence,
        'opportunity_ai_stage_signals', v_opportunity.ai_stage_signals,
        'opportunity_source_metadata', v_opportunity.source_metadata,
        'thread_category_classifier_version', v_thread.category_classifier_version,
        'thread_category_confidence', v_thread.category_confidence
      )
    ),
    jsonb_build_object(
      'contract_version', 'phase_c_lead_feedback_v1',
      'phase_c_enabled', v_phase_c_enabled,
      'domain_threshold_independent_threads', 3,
      'domain_threshold_independent_senders', 2,
      'optional_note_learning_eligible', false
    ),
    v_idempotency_key,
    v_now,
    v_now
  );

  feedback_id := v_feedback_id;
  outcome := v_outcome;
  prior_stage := v_opportunity.stage;
  current_stage := coalesce(v_target_stage, v_opportunity.stage);
  current_stage_entered_at := case
    when v_target_stage is not null then v_now
    else v_opportunity.stage_entered_at
  end;
  current_stage_manually_set := case
    when v_target_stage is not null then true
    else v_opportunity.stage_manually_set
  end;
  current_lost_reason := case
    when v_outcome = 'lost' then 'other'
    when v_target_stage is not null then null
    else v_opportunity.lost_reason
  end;
  current_lost_notes := case
    when v_outcome = 'lost' then v_note
    when v_target_stage is not null then null
    else v_opportunity.lost_notes
  end;
  current_actual_close_date := case
    when v_outcome = 'lost' then v_now::date
    when v_target_stage is not null then null
    else v_opportunity.actual_close_date
  end;
  lifecycle_changed := v_target_stage is not null;
  idempotent_replay := false;
  return next;
end;
$function$;

revoke all on function public.apply_lead_disposition_feedback(
  uuid,
  text,
  text,
  text
) from public, anon, authenticated, service_role;
grant execute on function public.apply_lead_disposition_feedback(
  uuid,
  text,
  text,
  text
) to anon, authenticated;

create or replace function public.undo_lead_disposition_feedback(
  p_feedback_id uuid,
  p_idempotency_key text
) returns table (
  feedback_id uuid,
  outcome text,
  prior_stage text,
  current_stage text,
  current_stage_entered_at timestamptz,
  current_stage_manually_set boolean,
  current_lost_reason text,
  current_lost_notes text,
  current_actual_close_date date,
  lifecycle_changed boolean,
  idempotent_replay boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_user_id uuid;
  v_feedback public.lead_disposition_feedback%rowtype;
  v_opportunity public.opportunities%rowtype;
  v_idempotency_key text := trim(coalesce(p_idempotency_key, ''));
  v_now timestamptz := clock_timestamp();
begin
  v_actor_user_id := private.get_current_user_id();
  if v_actor_user_id is null then
    raise exception 'actor_not_found' using errcode = '42501';
  end if;
  if char_length(v_idempotency_key) not between 8 and 128 then
    raise exception 'invalid_idempotency_key' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_actor_user_id::text || ':undo:' || v_idempotency_key, 0)
  );

  select feedback.*
    into v_feedback
    from public.lead_disposition_feedback feedback
   where feedback.id = p_feedback_id
   for update;
  if not found then
    raise exception 'feedback_not_found' using errcode = 'P0002';
  end if;
  if not private.current_user_can_edit_opportunity(
    v_feedback.opportunity_id
  ) then
    raise exception 'opportunity_access_denied' using errcode = '42501';
  end if;

  if v_feedback.learning_state = 'retracted' then
    feedback_id := v_feedback.id;
    outcome := v_feedback.canonical_outcome;
    prior_stage := v_feedback.prior_stage;
    current_stage := v_feedback.prior_stage;
    current_stage_entered_at := v_feedback.prior_stage_entered_at;
    current_stage_manually_set := v_feedback.prior_stage_manually_set;
    current_lost_reason := v_feedback.prior_lost_reason;
    current_lost_notes := v_feedback.prior_lost_notes;
    current_actual_close_date := v_feedback.prior_actual_close_date;
    lifecycle_changed := v_feedback.applied_stage is not null;
    idempotent_replay := true;
    return next;
    return;
  end if;

  if v_feedback.applied_stage is not null then
    select opportunity.*
      into v_opportunity
      from public.opportunities opportunity
     where opportunity.id = v_feedback.opportunity_id
       and opportunity.deleted_at is null
     for update;
    if not found
       or v_opportunity.stage is distinct from v_feedback.applied_stage
       or v_opportunity.updated_at is distinct from
            v_feedback.applied_opportunity_updated_at
    then
      raise exception 'feedback_undo_conflict' using errcode = '40001';
    end if;

    if v_feedback.disposition_id is not null then
      update public.opportunity_dispositions
         set superseded_at = v_now,
             superseded_by = null
       where id = v_feedback.disposition_id
         and superseded_at is null;
    end if;
    if v_feedback.prior_disposition_id is not null then
      update public.opportunity_dispositions
         set superseded_at = null,
             superseded_by = null
       where id = v_feedback.prior_disposition_id;
    end if;

    update public.opportunities
       set stage = v_feedback.prior_stage,
           stage_entered_at = v_feedback.prior_stage_entered_at,
           stage_manually_set = v_feedback.prior_stage_manually_set,
           lost_reason = v_feedback.prior_lost_reason,
           lost_notes = v_feedback.prior_lost_notes,
           actual_close_date = v_feedback.prior_actual_close_date,
           updated_at = v_now
     where id = v_feedback.opportunity_id;

    insert into public.stage_transitions (
      company_id,
      opportunity_id,
      from_stage,
      to_stage,
      transitioned_at,
      transitioned_by,
      duration_in_stage
    ) values (
      v_feedback.company_id,
      v_feedback.opportunity_id,
      v_feedback.applied_stage,
      v_feedback.prior_stage,
      v_now,
      v_actor_user_id,
      v_now - v_opportunity.stage_entered_at
    );
  end if;

  update public.lead_disposition_feedback
     set learning_state = 'retracted',
         resolution_status = 'undone',
         undo_idempotency_key = v_idempotency_key,
         retracted_at = v_now,
         retracted_by = v_actor_user_id,
         updated_at = v_now
   where id = v_feedback.id;

  feedback_id := v_feedback.id;
  outcome := v_feedback.canonical_outcome;
  prior_stage := v_feedback.prior_stage;
  current_stage := v_feedback.prior_stage;
  current_stage_entered_at := v_feedback.prior_stage_entered_at;
  current_stage_manually_set := v_feedback.prior_stage_manually_set;
  current_lost_reason := v_feedback.prior_lost_reason;
  current_lost_notes := v_feedback.prior_lost_notes;
  current_actual_close_date := v_feedback.prior_actual_close_date;
  lifecycle_changed := v_feedback.applied_stage is not null;
  idempotent_replay := false;
  return next;
end;
$function$;

revoke all on function public.undo_lead_disposition_feedback(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.undo_lead_disposition_feedback(uuid, text)
  to anon, authenticated;
