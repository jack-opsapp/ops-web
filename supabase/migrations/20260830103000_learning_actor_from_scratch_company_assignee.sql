-- Resolve a learning actor for company-mailbox rewrites (cc90c3ed).
--
-- `resolve_email_outbound_learning_mailbox_actor_as_system` refused every
-- `from_scratch` outcome on a company-type connection, so on a shared mailbox
-- the operator's full rewrite — the single highest-value correction we can
-- learn from — resolved no actor, skipped the learning queue entirely, and the
-- draft row was superseded with nothing captured. Five teaching sends on
-- 2026-08-06 were lost exactly this way.
--
-- This file is the definition from
-- 20260721128000_phase_c_actor_category_auto_send_guard.sql with exactly two
-- intentional differences:
--
--   1. the company-type branch no longer requires `p_outcome = 'used'`; it
--      anchors on `d.user_id`, the draft's bound user, exactly as the `used`
--      arm already does; and
--   2. the returned `proofType` distinguishes that arm as
--      `company_mailbox_assignee`.
--
-- Every downstream check is unchanged: the actor must still be an active user
-- of the company, must still be the opportunity's current `assigned_to` at
-- `assignment_version > 0`, and must still pass
-- `private.user_can_send_opportunity_inbox`. A company-type connection with no
-- opportunity still resolves nothing. The personal-mailbox arm is untouched.

begin;

create or replace function public.resolve_email_outbound_learning_mailbox_actor_as_system(
  p_company_id uuid,
  p_connection_id uuid,
  p_draft_history_id uuid,
  p_provider_message_id text,
  p_provider_thread_id text,
  p_outcome text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  c public.email_connections%rowtype;
  d public.ai_draft_history%rowtype;
  activity public.activities%rowtype;
  o public.opportunities%rowtype;
  u public.users%rowtype;
  v_actor_id uuid;
  v_assignment_event_id uuid;
  v_effective_opportunity_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_outcome not in ('used', 'from_scratch') then
    raise exception 'invalid_mailbox_draft_outcome' using errcode = '22023';
  end if;
  if nullif(btrim(p_provider_message_id), '') is null
    or nullif(btrim(p_provider_thread_id), '') is null
  then
    return null;
  end if;

  select connection.*
  into c
  from public.email_connections connection
  where connection.id = p_connection_id
    and connection.company_id = p_company_id::text
    and connection.status = 'active'
    and coalesce(connection.sync_enabled, false)
  for share;

  if c.id is null then
    return null;
  end if;

  select draft.*
  into d
  from public.ai_draft_history draft
  where draft.id = p_draft_history_id
    and draft.company_id = p_company_id
    and draft.connection_id = p_connection_id
    and draft.origin = 'phase_c'
    and draft.status = 'auto_drafted'
    and nullif(btrim(draft.mailbox_draft_id), '') is not null
    and draft.thread_id = btrim(p_provider_thread_id)
  for share;

  if d.id is null then
    return null;
  end if;

  select outbound.*
  into activity
  from public.activities outbound
  where outbound.company_id = p_company_id
    and outbound.email_connection_id = p_connection_id
    and outbound.email_message_id = btrim(p_provider_message_id)
    and outbound.email_thread_id = btrim(p_provider_thread_id)
    and outbound.direction = 'outbound'
    and outbound.created_at > d.created_at
  for share;

  if activity.id is null
    or (
      d.opportunity_id is not null
      and activity.opportunity_id is not null
      and d.opportunity_id is distinct from activity.opportunity_id
    )
  then
    return null;
  end if;
  v_effective_opportunity_id := coalesce(
    d.opportunity_id,
    activity.opportunity_id
  );

  if c.type = 'individual' then
    if c.user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return null;
    end if;
    v_actor_id := c.user_id::uuid;
    if d.user_id is distinct from v_actor_id then
      return null;
    end if;
  else
    -- Shared mailbox connector metadata is never actor authority. Only the
    -- exact current assignee who owns the OPS draft on this thread may be
    -- inferred — and that inference does not depend on the outcome. A send
    -- from a shared mailbox cannot name its author either way; whether the
    -- operator reused our wording or replaced it, the person who owns the
    -- conversation is the same, and the assignment checks below still have to
    -- prove it. Refusing the rewrite only threw the lesson away.
    v_actor_id := d.user_id;
  end if;

  select actor.*
  into u
  from public.users actor
  where actor.id = v_actor_id
    and actor.company_id = p_company_id
    and coalesce(actor.is_active, false)
    and actor.deleted_at is null
  for share;

  if u.id is null then
    return null;
  end if;

  if v_effective_opportunity_id is null then
    if c.type <> 'individual'
      or not private.user_can_send_inbox_connection(
        v_actor_id,
        p_company_id,
        c.id,
        null
      )
    then
      return null;
    end if;
    return jsonb_build_object(
      'actorUserId', v_actor_id,
      'opportunityId', null,
      'assignmentVersion', null,
      'assignmentEventId', null,
      'proofType', 'personal_mailbox_owner'
    );
  end if;

  select opportunity.*
  into o
  from public.opportunities opportunity
  where opportunity.id = v_effective_opportunity_id
    and opportunity.company_id = p_company_id
  for share;

  if o.id is null
    or o.assigned_to is distinct from v_actor_id
    or o.assignment_version <= 0
    or not private.user_can_send_opportunity_inbox(
      v_actor_id,
      o.id,
      c.id
    )
  then
    return null;
  end if;

  select event.id
  into v_assignment_event_id
  from public.opportunity_assignment_events event
  where event.opportunity_id = o.id
    and event.assignment_version = o.assignment_version
  order by event.created_at desc, event.id desc
  limit 1;

  return jsonb_build_object(
    'actorUserId', v_actor_id,
    'opportunityId', o.id,
    'assignmentVersion', o.assignment_version,
    'assignmentEventId', v_assignment_event_id,
    'proofType', case
      when c.type = 'individual' then 'personal_mailbox_owner'
      when p_outcome = 'used' then 'native_mailbox_draft'
      else 'company_mailbox_assignee'
    end
  );
end;
$function$;

revoke all on function public.resolve_email_outbound_learning_mailbox_actor_as_system(
  uuid, uuid, uuid, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.resolve_email_outbound_learning_mailbox_actor_as_system(
  uuid, uuid, uuid, text, text, text
) to service_role;

commit;
