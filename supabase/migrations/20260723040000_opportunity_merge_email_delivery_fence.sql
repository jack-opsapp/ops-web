-- Preserve the durable outbound-email identity while an opportunity merge is
-- being considered. A provider claim can commit before provider delivery and
-- reconciliation complete; moving the draft/event graph during that window
-- would strand the intent on the loser or attribute the eventual delivery to
-- a deleted lead.
--
-- This is deliberately additive. The production database already records the
-- earlier site_visits cast migration, so the delivery fence wraps the current
-- guarded merge entry point instead of rewriting applied migration history.

begin;

do $opportunity_merge_email_delivery_fence_prerequisites$
begin
  if to_regprocedure(
    'public.execute_opportunity_merge_guarded(uuid,uuid,uuid,text,uuid,text,text,jsonb,jsonb,uuid,text)'
  ) is null
    or to_regprocedure('private.lock_lead_assignment_company(uuid)') is null
    or to_regclass('public.email_send_intents') is null
  then
    raise exception 'opportunity_merge_email_delivery_fence_prerequisites_missing'
      using errcode = '55000';
  end if;
end;
$opportunity_merge_email_delivery_fence_prerequisites$;

alter function public.execute_opportunity_merge_guarded(
  uuid, uuid, uuid, text, uuid, text, text, jsonb, jsonb, uuid, text
) rename to execute_opportunity_merge_guarded_delivery_fenced_inner;

revoke all on function public.execute_opportunity_merge_guarded_delivery_fenced_inner(
  uuid, uuid, uuid, text, uuid, text, text, jsonb, jsonb, uuid, text
) from public, anon, authenticated, service_role;

create or replace function public.execute_opportunity_merge_guarded(
  p_company_id uuid,
  p_winner_id uuid,
  p_loser_id uuid,
  p_merge_key text,
  p_review_id uuid default null,
  p_expected_winner_stage text default null,
  p_expected_loser_stage text default null,
  p_field_fill jsonb default '{}'::jsonb,
  p_confirmed_overrides jsonb default '{}'::jsonb,
  p_resolved_by uuid default null,
  p_run_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_locked_opportunity_count integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_company_id is null
    or p_winner_id is null
    or p_loser_id is null
    or p_winner_id = p_loser_id
    or nullif(btrim(p_merge_key), '') is null
  then
    -- Preserve the canonical implementation's exact invalid-input contract.
    return public.execute_opportunity_merge_guarded_delivery_fenced_inner(
      p_company_id,
      p_winner_id,
      p_loser_id,
      p_merge_key,
      p_review_id,
      p_expected_winner_stage,
      p_expected_loser_stage,
      p_field_fill,
      p_confirmed_overrides,
      p_resolved_by,
      p_run_id
    );
  end if;

  perform private.lock_lead_assignment_company(p_company_id);

  -- Follow the established company -> ordered opportunities -> children lock
  -- order shared by merge, conversion, correspondence, and data-review RPCs.
  select count(*)::integer
    into v_locked_opportunity_count
    from (
      select opportunity.id
        from public.opportunities opportunity
       where opportunity.company_id = p_company_id
         and opportunity.id in (p_winner_id, p_loser_id)
       order by opportunity.id
       for update
    ) locked_opportunities;

  if v_locked_opportunity_count = 2 then
    perform 1
      from public.email_send_intents intent
     where intent.company_id = p_company_id
       and intent.opportunity_id in (p_winner_id, p_loser_id)
       and intent.status in (
         'sending',
         'delivery_unknown',
         'provider_accepted',
         'reconciling',
         'reconciliation_failed'
       )
     order by intent.id
     for share;

    if found then
      return public._record_opportunity_merge_skip(
        p_company_id,
        p_winner_id,
        p_loser_id,
        p_merge_key,
        p_review_id,
        p_field_fill,
        p_confirmed_overrides,
        p_resolved_by,
        p_run_id,
        'email_delivery_in_flight',
        'Winner or loser has email delivery awaiting a definitive reconciliation outcome.'
      );
    end if;
  end if;

  return public.execute_opportunity_merge_guarded_delivery_fenced_inner(
    p_company_id,
    p_winner_id,
    p_loser_id,
    p_merge_key,
    p_review_id,
    p_expected_winner_stage,
    p_expected_loser_stage,
    p_field_fill,
    p_confirmed_overrides,
    p_resolved_by,
    p_run_id
  );
end;
$function$;

revoke all on function public.execute_opportunity_merge_guarded(
  uuid, uuid, uuid, text, uuid, text, text, jsonb, jsonb, uuid, text
) from public, anon, authenticated, service_role;

grant execute on function public.execute_opportunity_merge_guarded(
  uuid, uuid, uuid, text, uuid, text, text, jsonb, jsonb, uuid, text
) to service_role;

comment on function public.execute_opportunity_merge_guarded(
  uuid, uuid, uuid, text, uuid, text, text, jsonb, jsonb, uuid, text
) is
  'Canonical guarded opportunity merge entry point. Serializes by company and '
  'refuses to move a lead graph while provider delivery remains uncertain.';

commit;
