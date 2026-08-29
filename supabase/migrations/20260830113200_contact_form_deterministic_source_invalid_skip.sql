-- Deterministic contact-form validation errors now skip instead of retrying.
--
-- `parseSubmitter` throws SOURCE_INVALID / CUSTOMER_MISMATCH as a verdict on
-- the source message itself. The failure RPC treated both as transport
-- failures, so a wrongly-enqueued forward burned all eight attempts before
-- landing in 'failed' with no usable reason. Companion to the enqueue-time
-- provenance gate (20260830113100): the gate should make this arm unreachable,
-- and this arm makes any future drift between the SQL marker mirror and the
-- TypeScript parser cost one clean skip.
--
-- The queue's completion-shape constraint is widened first so 'skipped' rows
-- may carry the new terminal reason. Drop and add are one ALTER TABLE
-- statement: the table is never observable without the constraint.

alter table public.email_assignment_contact_form_draft_queue
  drop constraint if exists email_assignment_contact_form_draft_completion_shape,
  add constraint email_assignment_contact_form_draft_completion_shape check (
    (
      status = 'completed'
      and completed_at is not null
      and draft_history_id is not null
      and nullif(btrim(mailbox_draft_id), '') is not null
      and nullif(btrim(outreach_provider_thread_id), '') is not null
      and provider_create_attempt_id is not null
      and provider_create_started_at is not null
      and result_reason = 'drafted'
    )
    or (
      status = 'skipped'
      and completed_at is not null
      and mailbox_draft_id is null
      and outreach_provider_thread_id is null
      and result_reason in (
        'autonomy_ineligible',
        'draft_unavailable',
        'lead_terminal',
        'already_replied',
        'not_contact_form'
      )
    )
    or (
      status = 'reconciliation_required'
      and completed_at is not null
      and provider_create_attempt_id is not null
      and provider_create_started_at is not null
      and result_reason = 'provider_reconciliation_required'
    )
    or (
      status not in ('completed', 'skipped', 'reconciliation_required')
      and completed_at is null
      and result_reason is null
    )
  );

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
  v_deterministic_source_invalid boolean;
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

  -- These two errors are deterministic verdicts about the source message, not
  -- transport trouble: the same body will fail the same way on every retry.
  -- Retrying them eight times only delays a terminal failure and buries the
  -- reason. The enqueue-time provenance gate should make this arm unreachable;
  -- if the SQL marker mirror ever drifts from the TypeScript parser, the drift
  -- costs one clean, self-describing skip instead of eight retries and a
  -- failure.
  v_deterministic_source_invalid := btrim(p_error) in (
    'EMAIL_ASSIGNMENT_CONTACT_FORM_DRAFT_SOURCE_INVALID',
    'EMAIL_ASSIGNMENT_CONTACT_FORM_DRAFT_CUSTOMER_MISMATCH'
  );

  -- A durable provider-create attempt still outranks everything: the draft may
  -- already exist in the operator's mailbox, and only reconciliation may
  -- resolve that. A superseded assignment likewise stays 'stale'.
  v_next_status := case
    when queue.provider_create_started_at is not null then
      'reconciliation_required'
    when not v_assignment_current then 'stale'
    when v_deterministic_source_invalid then 'skipped'
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
         mailbox_busy_since = case
           when v_mailbox_busy then
             coalesce(queue.mailbox_busy_since, clock_timestamp())
           else null
         end,
         completed_at = case
           when v_next_status in ('reconciliation_required', 'skipped') then now()
           else null
         end,
         result_reason = case
           when v_next_status = 'reconciliation_required' then
             'provider_reconciliation_required'
           when v_next_status = 'skipped' then 'not_contact_form'
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
  is 'Fails, retries, or deterministically skips a leased contact-form draft queue row; pre-provider mailbox contention returns to a condition-aware wait.';
