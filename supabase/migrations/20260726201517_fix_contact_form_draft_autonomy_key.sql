-- Keep the provider-boundary authorization gate aligned with the canonical
-- case-sensitive Phase C category key used by the application and stored
-- mailbox policy.
-- Live migration version: 20260726201517.

begin;

create or replace function private.email_assignment_contact_form_draft_authorized(
  p_queue_id uuid,
  p_require_customer_autonomy boolean
) returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.email_assignment_contact_form_draft_queue queue
    join public.opportunity_assignment_events event
      on queue.assignment_event_id = event.id
     and queue.company_id = event.company_id
     and queue.opportunity_id = event.opportunity_id
     and queue.assignment_version = event.assignment_version
     and queue.actor_user_id = event.new_assignee_id
    join public.opportunities opportunity
      on opportunity.id = queue.opportunity_id
     and opportunity.company_id = queue.company_id
     and opportunity.assigned_to = queue.actor_user_id
     and queue.assignment_version = opportunity.assignment_version
     and opportunity.deleted_at is null
     and opportunity.archived_at is null
     and opportunity.stage not in ('won', 'lost', 'discarded')
     and opportunity.source::text = 'email'
    join public.users user_row
      on user_row.id = queue.actor_user_id
     and user_row.company_id = queue.company_id
     and user_row.deleted_at is null
     and coalesce(user_row.is_active, false)
    join public.email_connections connection
      on queue.connection_id = connection.id
     and connection.company_id = queue.company_id::text
     and connection.status = 'active'
     and coalesce(connection.sync_enabled, false)
     and connection.type::text in ('company', 'individual')
    join public.activities activity
      on queue.source_activity_id = activity.id
     and activity.company_id = queue.company_id
     and activity.opportunity_id = opportunity.id
     and activity.email_connection_id = connection.id
     and activity.email_message_id = queue.provider_message_id
     and activity.email_thread_id = queue.source_provider_thread_id
     and activity.type = 'email'
     and activity.direction = 'inbound'
     and not coalesce(activity.match_needs_review, false)
     and lower(btrim(coalesce(activity.from_email, ''))) =
       lower(btrim(queue.customer_email))
     and coalesce(activity.subject, '') = queue.source_subject
     and activity.body_text = queue.source_body_text
     and nullif(btrim(coalesce(activity.body_text, '')), '') is not null
    left join public.clients client
      on client.id = coalesce(opportunity.client_ref, opportunity.client_id)
     and client.company_id = queue.company_id
     and client.deleted_at is null
    where queue.id = p_queue_id
      and event.new_assignee_id is not null
      and event.new_assignee_id = queue.actor_user_id
      and opportunity.source_thread_key =
        'email:' || lower(connection.provider::text) || ':' ||
        connection.id::text || ':message:' || queue.provider_message_id
      and (
        lower(btrim(coalesce(opportunity.contact_email, ''))) =
          lower(btrim(queue.customer_email))
        or lower(btrim(coalesce(client.email, ''))) =
          lower(btrim(queue.customer_email))
      )
      and private.user_can_send_opportunity_inbox(
        queue.actor_user_id,
        opportunity.id,
        connection.id
      )
      and not private.email_assignment_contact_form_draft_has_reply(
        queue.company_id,
        queue.opportunity_id,
        queue.connection_id,
        activity.created_at,
        queue.customer_email
      )
      and (
        not p_require_customer_autonomy
        or coalesce(
          connection.auto_send_settings
            -> 'category_autonomy'
            ->> 'primary:CUSTOMER',
          'off'
        ) in ('auto_draft', 'auto_send', 'auto_follow_up')
      )
  );
$function$;

revoke all on function private.email_assignment_contact_form_draft_authorized(uuid, boolean)
  from public, anon, authenticated, service_role;

commit;
