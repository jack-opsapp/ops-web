-- Atomic, retry-safe active-stage transitions for email ingestion.
--
-- Direct opportunity updates can commit without their stage_transitions audit
-- row. This service-role-only RPC locks the opportunity and performs both
-- writes in one database transaction. A retry after an ambiguous response is
-- idempotent because the already-current stage returns changed=false.

begin;

create or replace function public.apply_email_opportunity_stage_transition(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_to_stage text,
  p_ai_signal text default null::text
) returns table (
  changed boolean,
  stage text,
  stage_manually_set boolean
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_from_stage text;
  v_stage_entered_at timestamptz;
  v_stage_manually_set boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_company_id is null or p_opportunity_id is null then
    raise exception 'company and opportunity ids are required'
      using errcode = '22023';
  end if;
  if p_to_stage not in (
    'new_lead',
    'qualifying',
    'quoting',
    'quoted',
    'follow_up',
    'negotiation'
  ) then
    raise exception 'invalid active opportunity stage'
      using errcode = '22023';
  end if;

  select opportunity.stage,
         opportunity.stage_entered_at,
         opportunity.stage_manually_set
    into v_from_stage, v_stage_entered_at, v_stage_manually_set
    from public.opportunities opportunity
   where opportunity.id = p_opportunity_id
     and opportunity.company_id = p_company_id
     and opportunity.deleted_at is null
   for update;

  if not found then
    raise exception 'opportunity_not_found' using errcode = 'P0002';
  end if;

  if coalesce(v_stage_manually_set, false)
    or v_from_stage in ('won', 'lost', 'discarded')
    or v_from_stage = p_to_stage
  then
    return query select false, v_from_stage, v_stage_manually_set;
    return;
  end if;

  update public.opportunities
     set stage = p_to_stage,
         stage_entered_at = now(),
         win_probability = case p_to_stage
           when 'new_lead' then 10
           when 'qualifying' then 20
           when 'quoting' then 40
           when 'quoted' then 60
           when 'follow_up' then 50
           when 'negotiation' then 75
         end,
         ai_stage_confidence = case
           when nullif(btrim(p_ai_signal), '') is not null then 1.0
           else ai_stage_confidence
         end,
         ai_stage_signals = case
           when nullif(btrim(p_ai_signal), '') is not null
             then array[p_ai_signal]
           else ai_stage_signals
         end,
         updated_at = now()
   where id = p_opportunity_id
     and company_id = p_company_id;

  insert into public.stage_transitions (
    company_id,
    opportunity_id,
    from_stage,
    to_stage,
    transitioned_at,
    transitioned_by,
    duration_in_stage
  ) values (
    p_company_id,
    p_opportunity_id,
    v_from_stage,
    p_to_stage,
    now(),
    null,
    now() - coalesce(v_stage_entered_at, now())
  );

  return query select true, p_to_stage, v_stage_manually_set;
end;
$function$;

revoke all on function public.apply_email_opportunity_stage_transition(
  uuid,
  uuid,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.apply_email_opportunity_stage_transition(
  uuid,
  uuid,
  text,
  text
) to service_role;

commit;
