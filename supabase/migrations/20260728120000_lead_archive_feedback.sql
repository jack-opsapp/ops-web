-- Lead archive feedback — additive extension of the deployed Phase C contract.
--
-- Bug e0c8084f: discarding a lead captures a reason + optional note (Phase C,
-- shipped), but archiving captures nothing. Archive is the OTHER way a lead
-- leaves the board, and it is the reversible one — an owner parks a real job
-- ("not now", "next season") and expects to find it again. Today that context
-- evaporates: `opportunities.archived_at` is stamped by a bare PATCH with no
-- actor, no reason, no note, and no undo record.
--
-- This migration extends the SAME contract Phase C already deployed rather than
-- inventing a parallel one:
--
--   * `lead_disposition_feedback.canonical_outcome` gains 'archived'.
--   * `reason_code` gains the archive vocabulary (all OPTIONAL at the UI layer —
--     archive stays one tap; a reason is a bonus, never a toll).
--   * Two nullable snapshot columns record the archive lifecycle the existing
--     stage columns cannot express (archive does not move `stage`).
--   * `apply_lead_archive_feedback` / `undo_lead_archive_feedback` mirror their
--     disposition siblings exactly: advisory-locked, idempotency-keyed, row
--     locked FOR UPDATE, and atomic with the `opportunities` write.
--
-- ADDITIVE ONLY. Every column added is nullable; every CHECK is widened, never
-- narrowed. A shipped iOS build that knows nothing about archive feedback keeps
-- working against the legacy `archived_at` PATCH path (the client feature-detects
-- the RPC and falls back), so this is safe to apply ahead of an App Store
-- release. See ops-ios `OpportunityRepository.archiveWithFeedback`.

begin;

-- ─── 1. Archive lifecycle snapshots ────────────────────────────────────────
-- `applied_stage` / `prior_stage` describe a STAGE move. Archiving does not move
-- the stage, so the archive path needs its own before/after pair or undo has
-- nothing to restore and no way to detect a conflicting concurrent edit.

alter table public.lead_disposition_feedback
  add column if not exists prior_archived_at timestamptz,
  add column if not exists applied_archived_at timestamptz;

comment on column public.lead_disposition_feedback.prior_archived_at is
  'Archive path only: opportunities.archived_at as it stood before this feedback. NULL for stage-moving dispositions.';
comment on column public.lead_disposition_feedback.applied_archived_at is
  'Archive path only: opportunities.archived_at written by this feedback. NULL for stage-moving dispositions and for review-deferred rows.';

-- ─── 2. Widen the enumerated CHECKs ────────────────────────────────────────

alter table public.lead_disposition_feedback
  drop constraint if exists lead_disposition_feedback_canonical_outcome_check;

alter table public.lead_disposition_feedback
  add constraint lead_disposition_feedback_canonical_outcome_check
  check (canonical_outcome = any (array[
    'discarded'::text,
    'lost'::text,
    'duplicate_review'::text,
    'review_deferred'::text,
    'archived'::text
  ]));

alter table public.lead_disposition_feedback
  drop constraint if exists lead_disposition_feedback_reason_code_check;

alter table public.lead_disposition_feedback
  add constraint lead_disposition_feedback_reason_code_check
  check (reason_code = any (array[
    -- Phase C disposition vocabulary (unchanged).
    'spam'::text,
    'job_applicant'::text,
    'vendor_sales'::text,
    'internal'::text,
    'platform_notification'::text,
    'test_traffic'::text,
    'duplicate'::text,
    'not_a_fit'::text,
    'other'::text,
    'legacy_unspecified'::text,
    -- Archive vocabulary — why a REAL lead gets parked, not why it was junk.
    'not_now'::text,
    'seasonal'::text,
    'waiting_on_client'::text,
    'archive_unspecified'::text
  ]));

-- The applied-pair invariant predates archive and assumes a stage move is the
-- only way the opportunity gets written. Widen it so the archive shape (stage
-- untouched, archived_at written, updated_at snapshotted for the undo guard) is
-- expressible, while keeping the original guarantee intact for every other path.
alter table public.lead_disposition_feedback
  drop constraint if exists lead_disposition_feedback_applied_pair;

alter table public.lead_disposition_feedback
  add constraint lead_disposition_feedback_applied_pair
  check (
    -- Nothing applied (review_required rows).
    (applied_stage is null
      and applied_archived_at is null
      and applied_opportunity_updated_at is null)
    -- Stage move applied.
    or (applied_stage is not null
      and applied_archived_at is null
      and applied_opportunity_updated_at is not null)
    -- Archive applied.
    or (applied_stage is null
      and applied_archived_at is not null
      and applied_opportunity_updated_at is not null)
  );

-- ─── 3. apply_lead_archive_feedback ────────────────────────────────────────
-- Mirrors apply_lead_disposition_feedback: same actor resolution, same
-- idempotency-key contract (8–128 chars, advisory lock on actor+key), same
-- 500-char note ceiling, same FOR UPDATE row lock, same replay semantics. The
-- opportunity write and the feedback row land in ONE transaction.

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

  -- Idempotent replay — same actor, same key, same opportunity returns the
  -- original receipt instead of double-archiving.
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

  -- Archiving a terminal or merged lead is meaningless — it is already off the
  -- board. Matches the disposition RPC's guard.
  if v_opportunity.stage in ('won', 'lost', 'discarded')
     or v_opportunity.merged_into_opportunity_id is not null
  then
    raise exception 'opportunity_terminal_or_merged' using errcode = '23514';
  end if;

  -- Already archived: nothing to apply. Record the feedback (the reason/note is
  -- still worth keeping) but leave the lifecycle alone.
  -- Evidence derivation mirrors the disposition RPC exactly.
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

  -- Apply the archive atomically with the feedback row.
  if v_opportunity.archived_at is null then
    update public.opportunities
       set archived_at = v_now,
           updated_at = v_now
     where id = p_opportunity_id;
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
    case when v_opportunity.archived_at is null then v_now end,
    case when v_opportunity.archived_at is null then v_now end,
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
  current_archived_at := coalesce(v_opportunity.archived_at, v_now);
  current_opportunity_updated_at := case
    when v_opportunity.archived_at is null then v_now
    else v_opportunity.updated_at
  end;
  lifecycle_changed := v_opportunity.archived_at is null;
  idempotent_replay := false;
  return next;
end;
$function$;

-- ─── 4. undo_lead_archive_feedback ─────────────────────────────────────────
-- Mirrors undo_lead_disposition_feedback: optimistic-concurrency guard against
-- the applied snapshot, retract the feedback row, restore the prior state.

create or replace function public.undo_lead_archive_feedback(
  p_feedback_id uuid,
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
    hashtextextended(v_actor_user_id::text || ':archive_undo:' || v_idempotency_key, 0)
  );

  select feedback.*
    into v_feedback
    from public.lead_disposition_feedback feedback
   where feedback.id = p_feedback_id
   for update;
  if not found then
    raise exception 'feedback_not_found' using errcode = 'P0002';
  end if;
  if v_feedback.canonical_outcome <> 'archived' then
    raise exception 'feedback_not_archive' using errcode = '22023';
  end if;
  if not private.current_user_can_edit_opportunity(
    v_feedback.opportunity_id
  ) then
    raise exception 'opportunity_access_denied' using errcode = '42501';
  end if;

  if v_feedback.learning_state = 'retracted' then
    feedback_id := v_feedback.id;
    outcome := v_feedback.canonical_outcome;
    prior_archived_at := v_feedback.prior_archived_at;
    current_archived_at := v_feedback.prior_archived_at;
    current_opportunity_updated_at := v_feedback.applied_opportunity_updated_at;
    lifecycle_changed := v_feedback.applied_archived_at is not null;
    idempotent_replay := true;
    return next;
    return;
  end if;

  if v_feedback.applied_archived_at is not null then
    select opportunity.*
      into v_opportunity
      from public.opportunities opportunity
     where opportunity.id = v_feedback.opportunity_id
       and opportunity.deleted_at is null
     for update;
    if not found
       or v_opportunity.archived_at is distinct from v_feedback.applied_archived_at
       or v_opportunity.updated_at is distinct from
            v_feedback.applied_opportunity_updated_at
    then
      raise exception 'feedback_undo_conflict' using errcode = '40001';
    end if;

    update public.opportunities
       set archived_at = v_feedback.prior_archived_at,
           updated_at = v_now
     where id = v_feedback.opportunity_id;
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
  prior_archived_at := v_feedback.prior_archived_at;
  current_archived_at := v_feedback.prior_archived_at;
  current_opportunity_updated_at := case
    when v_feedback.applied_archived_at is not null then v_now
    else v_feedback.applied_opportunity_updated_at
  end;
  lifecycle_changed := v_feedback.applied_archived_at is not null;
  idempotent_replay := false;
  return next;
end;
$function$;

-- ─── 5. Grants ─────────────────────────────────────────────────────────────
-- Matches the deployed disposition RPCs. The iOS app executes as `anon` under
-- the Firebase JWT bridge, so `anon` must be able to EXECUTE or every call 403s.

grant execute on function public.apply_lead_archive_feedback(uuid, text, text, text)
  to anon, authenticated, postgres;
grant execute on function public.undo_lead_archive_feedback(uuid, text)
  to anon, authenticated, postgres;

commit;
