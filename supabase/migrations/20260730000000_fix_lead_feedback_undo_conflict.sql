-- Fix: lead feedback Undo always raised `feedback_undo_conflict`.
--
-- Bug ad2b6850 (web discard capture) surfaced this the moment a real Undo ran.
--
-- ROOT CAUSE
-- `apply_lead_disposition_feedback` (and its archive sibling) write the
-- opportunity with `updated_at = v_now`, where `v_now := clock_timestamp()`,
-- and then record that SAME `v_now` into
-- `lead_disposition_feedback.applied_opportunity_updated_at` as the
-- optimistic-concurrency snapshot Undo later checks.
--
-- But `opportunities` carries a BEFORE UPDATE trigger — `trg_opp_timestamp`
-- → `public.update_timestamp()` — whose entire body is `NEW.updated_at = now()`.
-- `now()` is the TRANSACTION timestamp; `clock_timestamp()` is the wall clock
-- at statement time. The trigger therefore overwrites the value the RPC just
-- set, and the row lands ~3ms BEHIND the snapshot the feedback row recorded.
--
-- `undo_lead_disposition_feedback` guards with:
--     v_opportunity.updated_at is distinct from v_feedback.applied_opportunity_updated_at
--         -> raise feedback_undo_conflict (errcode 40001)
--
-- Since the two values can never be equal, EVERY Undo conflicted. Measured on
-- prod against two capture rows: recorded 16:29:23.822686+00 vs stored
-- 16:29:23.819340+00 (delta -3.346ms), and 07:09:20.196107 vs 07:09:20.192605
-- (delta -3.502ms). 100% reproducible, both the discard and archive paths.
--
-- THE FIX
-- Stop predicting what the row will hold and record what it ACTUALLY holds:
-- capture `updated_at` (and `archived_at` on the archive path) via `RETURNING`
-- from the same UPDATE, after every BEFORE trigger has run. The snapshot then
-- matches by construction, no matter what any current or future BEFORE trigger
-- does to those columns.
--
-- Undo's guard itself is deliberately left untouched — it is correct, and it
-- is what stops an Undo from stomping a later human decision. This migration
-- only makes the snapshot it compares against truthful.
--
-- SAFETY
-- Both functions are replaced whole, byte-identical to the deployed bodies
-- except for the declared capture variables and the RETURNING clauses. No
-- signature, grant, RLS, constraint, or table change. No backfill: at authoring
-- time `lead_disposition_feedback` held only rows created while verifying this
-- fix, so no customer row carries a stale snapshot.

begin;

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
  -- The value the row ACTUALLY lands with, after BEFORE triggers. This is the
  -- snapshot Undo compares against; predicting it is what broke Undo.
  v_applied_updated_at timestamptz;
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

    -- RETURNING, not v_now: `trg_opp_timestamp` (BEFORE UPDATE) rewrites
    -- updated_at to now(), so only the returned value matches the stored row.
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
     where id = p_opportunity_id
    returning updated_at into v_applied_updated_at;

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
    v_applied_updated_at,
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

create or replace function public.apply_lead_archive_feedback(
  p_opportunity_id uuid,
  p_reason_code text,
  p_optional_note text,
  p_idempotency_key text
)
returns table(
  feedback_id uuid,
  outcome text,
  prior_archived_at timestamptz,
  current_archived_at timestamptz,
  current_opportunity_updated_at timestamptz,
  lifecycle_changed boolean,
  idempotent_replay boolean
)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor_user_id uuid;
  v_opportunity public.opportunities%rowtype;
  v_existing public.lead_disposition_feedback%rowtype;
  v_thread public.email_threads%rowtype;
  v_feedback_id uuid := gen_random_uuid();
  v_company_id uuid;
  v_reason text := lower(trim(coalesce(p_reason_code, '')));
  v_note text := nullif(trim(coalesce(p_optional_note, '')), '');
  v_idempotency_key text := trim(coalesce(p_idempotency_key, ''));
  v_phase_c_enabled boolean;
  v_sender_email text;
  v_sender_domain text;
  v_participants_hash text;
  v_source_message_id text;
  v_source_provider_thread_id text;
  v_source_thread_candidate_count integer := 0;
  v_now timestamptz := clock_timestamp();
  -- As above: the archive path's Undo guard compares BOTH of these against the
  -- stored row, so both must be what the row actually holds.
  v_applied_archived_at timestamptz;
  v_applied_updated_at timestamptz;
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

  -- Reason is OPTIONAL for archive: an empty reason is the one-tap path.
  if v_reason = '' then
    v_reason := 'archive_unspecified';
  end if;
  if v_reason not in (
    'not_now',
    'seasonal',
    'waiting_on_client',
    'other',
    'archive_unspecified'
  ) then
    raise exception 'invalid_archive_reason' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_actor_user_id::text || ':archive:' || v_idempotency_key, 0)
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
    prior_archived_at := v_existing.prior_archived_at;
    current_archived_at := coalesce(
      v_existing.applied_archived_at,
      v_existing.prior_archived_at
    );
    current_opportunity_updated_at := coalesce(
      v_existing.applied_opportunity_updated_at,
      v_opportunity.updated_at
    );
    lifecycle_changed := v_existing.applied_archived_at is not null;
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

  if v_opportunity.stage in ('won', 'lost', 'discarded')
     or v_opportunity.merged_into_opportunity_id is not null
  then
    raise exception 'opportunity_terminal_or_merged' using errcode = '23514';
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

  -- RETURNING, not v_now: see the disposition path above. Both columns are
  -- read back so the Undo guard compares against reality.
  if v_opportunity.archived_at is null then
    update public.opportunities
       set archived_at = v_now,
           updated_at = v_now
     where id = p_opportunity_id
    returning archived_at, updated_at
      into v_applied_archived_at, v_applied_updated_at;
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
    prior_archived_at,
    applied_stage,
    applied_archived_at,
    applied_opportunity_updated_at,
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
    'archived',
    -- Parking a real lead teaches the model nothing about lead quality.
    'neutral',
    'active',
    case when v_opportunity.archived_at is null then 'applied' else 'review_required' end,
    v_note,
    v_phase_c_enabled,
    v_opportunity.stage,
    v_opportunity.stage_entered_at,
    v_opportunity.stage_manually_set,
    v_opportunity.lost_reason,
    v_opportunity.lost_notes,
    v_opportunity.actual_close_date,
    v_opportunity.archived_at,
    null,
    v_applied_archived_at,
    v_applied_updated_at,
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
      'contract_version', 'lead_archive_feedback_v1',
      'phase_c_enabled', v_phase_c_enabled,
      'reversible', true,
      'optional_note_learning_eligible', false,
      'optional_reason', true
    ),
    v_idempotency_key,
    v_now,
    v_now
  );

  feedback_id := v_feedback_id;
  outcome := 'archived';
  prior_archived_at := v_opportunity.archived_at;
  current_archived_at := coalesce(v_opportunity.archived_at, v_applied_archived_at);
  current_opportunity_updated_at := coalesce(
    v_applied_updated_at,
    v_opportunity.updated_at
  );
  lifecycle_changed := v_opportunity.archived_at is null;
  idempotent_replay := false;
  return next;
end;
$function$;

commit;
