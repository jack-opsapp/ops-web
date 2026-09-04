-- Cluster N / bug 2db2e0d0: stop a settled lifecycle receipt from conflicting
-- with its own replay.
--
-- record_opportunity_lifecycle_decision compared nine fields when a replay hit
-- the immutable key (opportunity_id, source_event_id, decision_kind,
-- decision_key), two of which were the evidence arrays. The deployed detector
-- derives evidence from the whole episode, so every message that landed after
-- an applied decision grew the arrays under an unchanged key and every replay
-- raised lifecycle_decision_replay_conflict. That failure ran before the Gmail
-- cursor advanced and froze ingestion for 44 hours.
--
-- The receipt's CONCLUSION stays immutable and still fails closed. Evidence is
-- reclassified as what it always was: an audit trail. The as-decided arrays are
-- never rewritten; a monotonic high-water union absorbs everything ever seen.
-- Provider delivery timestamps are re-stamped after ingest, so evidence can
-- legitimately shrink as well as grow -- neither direction is a contradiction
-- and neither may stop a mailbox.

alter table public.opportunity_lifecycle_decisions
  add column if not exists evidence_event_ids_high_water uuid[]
    not null default '{}'::uuid[],
  add column if not exists evidence_message_ids_high_water text[]
    not null default '{}'::text[],
  add column if not exists evidence_high_water_at timestamptz;

-- Seed the high-water set from each receipt's as-decided evidence so the union
-- below is well-defined for rows written before this migration.
update public.opportunity_lifecycle_decisions
   set evidence_event_ids_high_water = evidence_event_ids,
       evidence_message_ids_high_water = evidence_message_ids,
       evidence_high_water_at = coalesce(evidence_high_water_at, created_at)
 where evidence_event_ids_high_water = '{}'::uuid[]
    or evidence_message_ids_high_water = '{}'::text[];

comment on column public.opportunity_lifecycle_decisions.evidence_event_ids is
  'Immutable: the correspondence events this decision was made from. Never rewritten.';
comment on column public.opportunity_lifecycle_decisions.evidence_event_ids_high_water is
  'Monotonic union of every event id any replay has ever presented for this receipt.';
comment on column public.opportunity_lifecycle_decisions.evidence_message_ids_high_water is
  'Monotonic union of every provider message id any replay has ever presented for this receipt.';
comment on column public.opportunity_lifecycle_decisions.evidence_high_water_at is
  'When the high-water evidence union last actually changed.';

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
  v_messages text[];
  v_event_union uuid[];
  v_message_union text[];
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

  v_messages := coalesce(p_evidence_message_ids, '{}'::text[]);

  insert into public.opportunity_lifecycle_decisions (
    company_id, opportunity_id, source_event_id, decision_kind, decision_key,
    proposed_stage, proposed_outcome, confidence, evidence_event_ids,
    evidence_message_ids, reason, initial_status, initial_review_reason,
    status, review_reason, review_required_at,
    evidence_event_ids_high_water, evidence_message_ids_high_water,
    evidence_high_water_at
  ) values (
    p_company_id, p_opportunity_id, p_source_event_id, p_decision_kind,
    btrim(p_decision_key), p_proposed_stage, p_proposed_outcome, p_confidence,
    p_evidence_event_ids, v_messages,
    btrim(p_reason), p_status, nullif(btrim(p_review_reason), ''),
    p_status, nullif(btrim(p_review_reason), ''),
    case when p_status = 'review' then now() else null end,
    p_evidence_event_ids, v_messages, now()
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
     and decision.decision_key = btrim(p_decision_key)
   for update;
  if not found then
    raise exception 'lifecycle_decision_receipt_missing' using errcode = 'P0002';
  end if;

  -- The conclusion is the immutable part. A replay that reaches a different
  -- conclusion for the same decisive source event is a real contradiction and
  -- still fails closed.
  if v_existing.company_id is distinct from p_company_id
    or v_existing.proposed_stage is distinct from p_proposed_stage
    or v_existing.proposed_outcome is distinct from p_proposed_outcome
    or v_existing.confidence is distinct from p_confidence
    or v_existing.reason is distinct from btrim(p_reason)
    or v_existing.initial_status is distinct from p_status
    or v_existing.initial_review_reason is distinct from nullif(btrim(p_review_reason), '')
  then
    raise exception 'lifecycle_decision_replay_conflict' using errcode = '23505';
  end if;

  -- Evidence is an audit trail. Absorb it into the high-water union; never
  -- rewrite what the decision was actually made from.
  select array_agg(distinct value order by value) into v_event_union
    from unnest(v_existing.evidence_event_ids_high_water || p_evidence_event_ids) as value;
  select array_agg(distinct value order by value) into v_message_union
    from unnest(v_existing.evidence_message_ids_high_water || v_messages) as value;
  v_event_union := coalesce(v_event_union, '{}'::uuid[]);
  v_message_union := coalesce(v_message_union, '{}'::text[]);

  if v_event_union is distinct from v_existing.evidence_event_ids_high_water
     or v_message_union is distinct from v_existing.evidence_message_ids_high_water
  then
    update public.opportunity_lifecycle_decisions decision
       set evidence_event_ids_high_water = v_event_union,
           evidence_message_ids_high_water = v_message_union,
           evidence_high_water_at = now(),
           updated_at = now()
     where decision.id = v_existing.id
    returning decision.* into v_existing;
  end if;

  return v_existing;
end;
$function$;

revoke all on function public.record_opportunity_lifecycle_decision(
  uuid, uuid, uuid, text, text, text, text, numeric, uuid[], text[], text, text, text
) from public, anon, authenticated;
grant execute on function public.record_opportunity_lifecycle_decision(
  uuid, uuid, uuid, text, text, text, text, numeric, uuid[], text[], text, text, text
) to service_role;

comment on function public.record_opportunity_lifecycle_decision(
  uuid, uuid, uuid, text, text, text, text, numeric, uuid[], text[], text, text, text
) is
  'Immutable lifecycle receipt. The conclusion conflicts on any change; evidence is absorbed as a monotonic high-water union.';
