-- An ordinary forward was being accepted as a contact-form submission.
--
-- `private.enqueue_email_assignment_contact_form_draft` gated only on the
-- message-scoped source key plus sender == canonical recipient. That key has
-- the identical shape for a contact-form notification and for a trusted
-- generic forward, so provenance was indistinguishable at enqueue time. The
-- worker's `parseSubmitter` then threw
-- EMAIL_ASSIGNMENT_CONTACT_FORM_DRAFT_SOURCE_INVALID on every one of its eight
-- attempts and the row went terminal — a hard failure for mail that should
-- never have entered the auto-draft lane at all.
--
-- This migration adds a structural marker mirror of the parser and refuses the
-- enqueue when neither the markers nor a service attestation vouch for the
-- source. Every other enqueue guard is unchanged.

-- Structural mirror of the contact-form parser's acceptance conditions
-- (`looksLikeContactFormSubmission` in src/lib/utils/email-parsing.ts). Kept
-- deliberately coarse: it answers "could this be a form notification at all",
-- never "what did the form contain". The TypeScript parser remains the
-- authority at draft time.
--
-- Three conditions, in the parser's own order:
--   1. A reply that quotes a form notification is ordinary correspondence.
--   2. A platform body marker alone is sufficient provenance.
--   3. Otherwise a generic form subject must be paired with an explicit
--      labeled submitter-email line.
create or replace function private.email_contact_form_source_markers_present(
  p_subject text,
  p_body text
) returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select
    p_subject !~* '^[[:space:]]*re[[:space:]]*:'
    and (
      p_body ~*
        '\y(submission summary|site visitor just submitted your form|submitted your form|new contact form submission|contact form submission|view submissions|this email was sent as a notification from this site)\y'
      or (
        p_subject ~*
          '\y(got a new submission|new form entry|new contact form|new submission|form submission|new inquiry|new lead|contact us form|quote request|free quote form)\y'
        and p_body ~*
          '(?n)^>?[[:space:]]*(email|email address|e-mail|e-mail address|your email|reply-to)[[:space:]]*:'
      )
    );
$function$;

revoke all on function private.email_contact_form_source_markers_present(
  text,
  text
) from public, anon, authenticated, service_role;

create or replace function private.enqueue_email_assignment_contact_form_draft(
  p_assignment_event_id uuid,
  p_source_activity_id uuid default null
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  event public.opportunity_assignment_events%rowtype;
  opportunity public.opportunities%rowtype;
  activity public.activities%rowtype;
  connection public.email_connections%rowtype;
  client public.clients%rowtype;
  user_row public.users%rowtype;
  v_match text[];
  v_connection_id uuid;
  v_provider_message_id text;
  v_actor_user_id uuid;
  v_customer_email text;
  v_customer_name text;
begin
  select assignment_event.* into event
  from public.opportunity_assignment_events assignment_event
  where assignment_event.id = p_assignment_event_id;
  if not found or event.new_assignee_id is null then
    return;
  end if;

  v_actor_user_id := event.new_assignee_id;

  select opportunity_row.* into opportunity
  from public.opportunities opportunity_row
  where opportunity_row.id = event.opportunity_id
    and opportunity_row.company_id = event.company_id
    and opportunity_row.assigned_to = event.new_assignee_id
    and opportunity_row.assignment_version = event.assignment_version
    and opportunity_row.deleted_at is null
    and opportunity_row.archived_at is null
    and opportunity_row.stage not in ('won', 'lost', 'discarded')
    and opportunity_row.source::text = 'email';
  if not found then
    return;
  end if;

  -- A verified current event may invalidate older work. The event/version
  -- equality above prevents delayed future rendezvous from staling the current
  -- assignment.
  update public.email_assignment_contact_form_draft_queue queue
     set status = case
           when queue.provider_create_started_at is not null then
             'reconciliation_required'
           else 'stale'
         end,
         lease_holder = null,
         lease_expires_at = null,
         completed_at = case
           when queue.provider_create_started_at is not null then now()
           else null
         end,
         result_reason = case
           when queue.provider_create_started_at is not null then
             'provider_reconciliation_required'
           else null
         end,
         last_error = 'assignment superseded',
         updated_at = now()
   where queue.opportunity_id = event.opportunity_id
     and queue.assignment_version <> event.assignment_version
     and queue.status in ('pending', 'processing', 'retrying');

  if opportunity.source_thread_key is null
     or opportunity.source_thread_key !~
       '^email:[^:]+:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89ab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}:message:.+$'
  then
    return;
  end if;
  v_match := regexp_match(
    opportunity.source_thread_key,
    '^email:([^:]+):([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89ab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}):message:(.+)$'
  );
  if v_match is null or array_length(v_match, 1) <> 3 then
    return;
  end if;
  v_connection_id := v_match[2]::uuid;
  v_provider_message_id := btrim(v_match[3]);

  select connection_row.* into connection
  from public.email_connections connection_row
  where connection_row.id = v_connection_id
    and connection_row.company_id = opportunity.company_id::text
    and lower(connection_row.provider::text) = lower(v_match[1])
    and connection_row.status = 'active'
    and coalesce(connection_row.sync_enabled, false)
    and connection_row.type::text in ('company', 'individual');
  if not found then
    return;
  end if;

  select user_record.* into user_row
  from public.users user_record
  where user_record.id = v_actor_user_id
    and user_record.company_id = opportunity.company_id
    and user_record.deleted_at is null
    and coalesce(user_record.is_active, false);
  if not found then
    return;
  end if;

  if connection.type::text = 'individual'
     and connection.user_id is distinct from v_actor_user_id::text then
    return;
  elsif connection.type::text <> 'company'
     and connection.type::text <> 'individual' then
    return;
  end if;

  select activity_row.* into activity
  from public.activities activity_row
  where (p_source_activity_id is null or activity_row.id = p_source_activity_id)
    and activity_row.company_id = opportunity.company_id
    and activity_row.opportunity_id = opportunity.id
    and activity_row.email_connection_id = v_connection_id
    and activity_row.email_message_id = v_provider_message_id
    and activity_row.type = 'email'
    and activity_row.direction = 'inbound'
    and not coalesce(activity_row.match_needs_review, false)
    and nullif(btrim(coalesce(activity_row.email_thread_id, '')), '') is not null
    and nullif(btrim(coalesce(activity_row.from_email, '')), '') is not null
    and nullif(btrim(coalesce(activity_row.body_text, '')), '') is not null
  order by activity_row.created_at asc, activity_row.id asc
  limit 1;
  if not found then
    return;
  end if;

  select client_row.* into client
  from public.clients client_row
  where client_row.id = coalesce(opportunity.client_ref, opportunity.client_id)
    and client_row.company_id = opportunity.company_id
    and client_row.deleted_at is null;

  v_customer_email :=
    private.email_assignment_contact_form_draft_canonical_recipient(
      opportunity.company_id,
      opportunity.id,
      activity.id,
      connection.id,
      v_provider_message_id,
      btrim(activity.email_thread_id)
    );
  if v_customer_email is null then
    return;
  end if;

  v_customer_name := coalesce(
    nullif(btrim(opportunity.contact_name), ''),
    nullif(btrim(client.name), '')
  );
  if private.email_assignment_contact_form_draft_has_reply(
    opportunity.company_id,
    opportunity.id,
    connection.id,
    activity.created_at,
    v_customer_email
  ) then
    return;
  end if;

  -- Provenance gate. The message-scoped source key
  -- (`email:<provider>:<connection>:message:<id>`) is byte-identical for a
  -- contact-form notification and for a trusted generic forward, so the key
  -- cannot tell them apart and an ordinary forward was reaching the auto-draft
  -- worker, whose parser then failed deterministically eight times before the
  -- row went terminal. Mirror the parser's STRUCTURAL acceptance markers here
  -- and refuse to enqueue a source that carries none of them and has no
  -- service attestation: that mail takes the ordinary assignment-notification
  -- lane instead of a first-reply draft.
  --
  -- Deliberately coarser than the TypeScript parser (marker presence, not a
  -- full parse). The worker's parser stays authoritative at draft time; this
  -- gate only has to exclude wrapper-less ordinary mail.
  if not coalesce(
       private.email_contact_form_source_markers_present(
         coalesce(activity.subject, ''),
         coalesce(activity.body_text, '')
       ),
       false
     )
     and not exists (
       select 1
       from private.email_contact_form_recipient_attestations attestation
       where attestation.source_activity_id = activity.id
         and attestation.company_id = opportunity.company_id
         and attestation.opportunity_id = opportunity.id
         and attestation.connection_id = connection.id
         and attestation.provider_message_id = v_provider_message_id
         and attestation.provider_thread_id = btrim(activity.email_thread_id)
     ) then
    return;
  end if;

  insert into public.email_assignment_contact_form_draft_queue (
    assignment_event_id,
    company_id,
    opportunity_id,
    assignment_version,
    actor_user_id,
    connection_id,
    source_activity_id,
    provider_message_id,
    source_provider_thread_id,
    customer_email,
    customer_name,
    source_subject,
    source_body_text
  ) values (
    event.id,
    opportunity.company_id,
    opportunity.id,
    event.assignment_version,
    v_actor_user_id,
    connection.id,
    activity.id,
    v_provider_message_id,
    btrim(activity.email_thread_id),
    v_customer_email,
    v_customer_name,
    coalesce(activity.subject, ''),
    activity.body_text
  )
  on conflict (assignment_event_id) do nothing;
end;
$function$;

revoke all on function private.enqueue_email_assignment_contact_form_draft(
  uuid,
  uuid
) from public, anon, authenticated, service_role;
