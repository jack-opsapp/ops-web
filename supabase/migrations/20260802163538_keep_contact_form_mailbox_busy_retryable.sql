begin;

-- A mailbox-busy result means another OPS process currently owns the physical
-- provider mailbox lease. No provider draft create has started, so this is safe to
-- retry even when ordinary delivery failures have exhausted their attempt cap.
create or replace function public.fail_email_assignment_contact_form_draft_as_system(
  p_queue_id uuid,
  p_holder text,
  p_error text
) returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  queue public.email_assignment_contact_form_draft_queue%rowtype;
  v_assignment_current boolean;
  v_mailbox_busy boolean;
  v_next_status text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_error, '')), '') is null then
    raise exception 'contact_form_draft_error_required' using errcode = '22023';
  end if;

  select work.* into queue
  from public.email_assignment_contact_form_draft_queue work
  where work.id = p_queue_id
    and work.status = 'processing'
    and work.lease_holder = btrim(p_holder)
  for update;
  if not found then
    return 'stale';
  end if;

  select exists (
    select 1
    from public.opportunities opportunity
    join public.opportunity_assignment_events event
      on event.id = queue.assignment_event_id
     and event.opportunity_id = opportunity.id
     and event.assignment_version = opportunity.assignment_version
     and event.new_assignee_id = opportunity.assigned_to
    where opportunity.id = queue.opportunity_id
      and opportunity.company_id = queue.company_id
      and opportunity.assigned_to = queue.actor_user_id
      and opportunity.assignment_version = queue.assignment_version
      and opportunity.deleted_at is null
  ) into v_assignment_current;

  v_mailbox_busy := btrim(p_error) = 'EMAIL_ASSIGNMENT_CONTACT_FORM_DRAFT_MAILBOX_BUSY';
  v_next_status := case
    when queue.provider_create_started_at is not null then
      'reconciliation_required'
    when not v_assignment_current then 'stale'
    when v_mailbox_busy then 'retrying'
    when queue.attempts >= 8 then 'failed'
    else 'retrying'
  end;

  update public.email_assignment_contact_form_draft_queue work
     set status = v_next_status,
         available_at = case
           when v_next_status = 'retrying' then
             case
               when v_mailbox_busy then
                 clock_timestamp() + make_interval(mins => 5)
               else
                 clock_timestamp() + make_interval(
                   secs => least(86400, (power(2, least(queue.attempts, 10)) * 60)::integer)
                 )
             end
           else work.available_at
         end,
         lease_holder = null,
         lease_expires_at = null,
         completed_at = case
           when v_next_status = 'reconciliation_required' then now()
           else null
         end,
         result_reason = case
           when v_next_status = 'reconciliation_required' then
             'provider_reconciliation_required'
           else null
         end,
         last_error = left(btrim(p_error), 2000),
         updated_at = now()
   where work.id = p_queue_id;
  return v_next_status;
end;
$function$;

revoke all on function public.fail_email_assignment_contact_form_draft_as_system(
  uuid, text, text
)
  from public, anon, authenticated, service_role;
grant execute on function public.fail_email_assignment_contact_form_draft_as_system(
  uuid, text, text
)
  to service_role;

comment on function public.fail_email_assignment_contact_form_draft_as_system(uuid, text, text)
  is 'Fails or retries a leased contact-form draft queue row; transient pre-provider mailbox contention always remains retryable.';

-- Repair every row terminalized solely by the former mailbox-busy attempt cap.
-- Existing claim and worker guards will safely skip stale assignments, replied
-- threads, terminal opportunities, ineligible automation, or prior placement.
update public.email_assignment_contact_form_draft_queue work
   set status = 'retrying',
       available_at = clock_timestamp() + make_interval(mins => 5),
       lease_holder = null,
       lease_expires_at = null,
       completed_at = null,
       result_reason = null,
       updated_at = now()
 where work.status = 'failed'
   and work.provider_create_attempt_id is null
   and work.provider_create_started_at is null
   and btrim(work.last_error) = 'EMAIL_ASSIGNMENT_CONTACT_FORM_DRAFT_MAILBOX_BUSY';

commit;
