-- Compile the exact-message lifecycle guard against the legacy TEXT tenant
-- identity used by notifications. The original UUID comparison was planned
-- only when recovery first invoked the private function.

begin;

create or replace function private.assert_exact_message_lifecycle_recomputable(
  p_company_id uuid,
  p_opportunity_id uuid
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  perform 1
  from public.opportunity_lifecycle_state state
  where state.company_id = p_company_id
    and state.opportunity_id = p_opportunity_id
  for update;

  if exists (
    select 1
    from public.opportunity_lifecycle_state state
    where state.company_id = p_company_id
      and state.opportunity_id = p_opportunity_id
      and (
        state.unanswered_follow_up_count <> 0
        or state.second_follow_up_sent_at is not null
        or state.operator_follow_up_miss_at is not null
        or state.stale_status is not null
        or state.stale_status_at is not null
        or state.protected_until is not null
      )
  ) or exists (
    select 1
    from public.opportunity_follow_up_drafts draft
    where draft.company_id = p_company_id
      and draft.opportunity_id = p_opportunity_id
  ) or exists (
    select 1
    from public.opportunity_lifecycle_action_audit action
    where action.company_id = p_company_id
      and action.opportunity_id = p_opportunity_id
      and action.status = 'applied'
  ) or exists (
    select 1
    from public.notifications notification
    where notification.company_id = p_company_id::text
      and notification.type = 'leads_waiting'
      and notification.dedupe_key =
        'lead_lifecycle:operator_follow_up_miss:' || p_opportunity_id::text
  ) then
    raise exception 'exact_recovery_lifecycle_not_reconstructible'
      using errcode = '55000';
  end if;
end;
$function$;

revoke all on function private.assert_exact_message_lifecycle_recomputable(
  uuid, uuid
) from public, anon, authenticated, service_role;

-- Force PostgreSQL to plan every predicate during migration application.
do $compile_repaired_lifecycle_guard$
begin
  perform private.assert_exact_message_lifecycle_recomputable(
    gen_random_uuid(),
    gen_random_uuid()
  );
end;
$compile_repaired_lifecycle_guard$;

commit;
