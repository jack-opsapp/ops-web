-- Fixed Phase C source lookup. The internal adapter supplies only canonical
-- routing output plus the inbound activity id; this boundary proves which
-- immutable delivered turn actually triggered the reply attempt.

begin;

do $prerequisites$
begin
  if to_regclass('public.job_conversation_turns') is null
     or to_regclass('public.job_conversation_anchors') is null
     or to_regclass('public.activities') is null
     or to_regclass('public.opportunity_correspondence_events') is null
     or to_regclass('public.opportunities') is null
     or to_regclass('public.email_connections') is null
     or to_regclass('public.email_threads') is null
     or to_regclass('public.users') is null
     or to_regclass('private.agent_provider_delivery_sources') is null
     or to_regprocedure(
       'private.normalize_phase_c_email_header_address(text)'
     ) is null
     or to_regprocedure(
       'public.read_agent_job_conversation_context_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,uuid,integer,text[],uuid)'
     ) is null then
    raise exception 'agent_phase_c_source_turn_prerequisite_missing'
      using errcode = '55000';
  end if;
end;
$prerequisites$;

-- A provider-delivered activity is one immutable conversational fact. Refuse
-- an upgrade containing historical ambiguity and prevent any future cross-wire.
create unique index job_conversation_turns_company_source_activity_uidx
  on public.job_conversation_turns (company_id, source_activity_id)
  where source_activity_id is not null;

-- This is the final authority read before Phase C mints a routed-actor
-- context. Every predicate executes in this one statement, so a mailbox owner,
-- provider, routing link, actor, or assignment cannot be mixed across reads.
create or replace function public.read_phase_c_routed_actor_fence_as_system(
  p_company_id uuid,
  p_connection_id uuid,
  p_connection_provider text,
  p_opportunity_id uuid,
  p_actor_user_id uuid,
  p_assignment_version bigint,
  p_internal_thread_id uuid,
  p_provider_thread_id text
)
returns table (
  actor_user_id uuid,
  company_id uuid,
  connection_id uuid,
  opportunity_id uuid,
  internal_thread_id uuid,
  provider_thread_id text,
  assignment_version bigint,
  connection_type text,
  connection_provider text,
  connection_email text
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
  select
    actor.id as actor_user_id,
    actor.company_id,
    connection.id as connection_id,
    opportunity.id as opportunity_id,
    thread.id as internal_thread_id,
    thread.provider_thread_id,
    opportunity.assignment_version,
    connection.type as connection_type,
    connection.provider as connection_provider,
    connection.email as connection_email
  from public.users actor
  join public.opportunities opportunity
    on opportunity.assigned_to = actor.id
   and opportunity.company_id = actor.company_id
  join public.email_threads thread
    on thread.opportunity_id = opportunity.id
   and thread.company_id = opportunity.company_id
  join public.email_connections connection
    on connection.id = thread.connection_id
   and connection.company_id = thread.company_id::text
  where auth.role() = 'service_role'
    and p_company_id is not null
    and p_connection_id is not null
    and p_connection_provider in ('gmail', 'microsoft365')
    and p_opportunity_id is not null
    and p_actor_user_id is not null
    and p_assignment_version is not null
    and p_assignment_version >= 0
    and p_internal_thread_id is not null
    and p_provider_thread_id is not null
    and p_provider_thread_id <> ''
    and p_provider_thread_id = btrim(p_provider_thread_id)
    and octet_length(p_provider_thread_id) <= 512
    and p_provider_thread_id !~ '[[:cntrl:]]'
    and actor.id = p_actor_user_id
    and actor.company_id = p_company_id
    and actor.deleted_at is null
    and coalesce(actor.is_active, false)
    and opportunity.id = p_opportunity_id
    and opportunity.company_id = p_company_id
    and opportunity.assigned_to = p_actor_user_id
    and opportunity.assignment_version = p_assignment_version
    and opportunity.deleted_at is null
    and thread.id = p_internal_thread_id
    and thread.company_id = p_company_id
    and thread.connection_id = p_connection_id
    and thread.provider_thread_id = p_provider_thread_id
    and thread.opportunity_id = p_opportunity_id
    and connection.id = p_connection_id
    and connection.company_id = p_company_id::text
    and connection.provider = p_connection_provider
    and connection.status = 'active'
    and connection.sync_enabled is not false
    and connection.email is not null
    and btrim(connection.email) <> ''
    and (
      connection.type = 'company'
      or (
        connection.type = 'individual'
        and btrim(connection.user_id) = p_actor_user_id::text
        and btrim(connection.user_id) ~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
    );
$function$;

revoke all on function public.read_phase_c_routed_actor_fence_as_system(
  uuid,
  uuid,
  text,
  uuid,
  uuid,
  bigint,
  uuid,
  text
) from public, anon, authenticated, service_role;

grant execute on function public.read_phase_c_routed_actor_fence_as_system(
  uuid,
  uuid,
  text,
  uuid,
  uuid,
  bigint,
  uuid,
  text
) to service_role;

create or replace function public.read_phase_c_source_turn_as_system(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_actor_user_id uuid,
  p_assignment_version bigint,
  p_connection_id uuid,
  p_internal_thread_id uuid,
  p_provider_thread_id text,
  p_source_activity_id uuid
)
returns table (
  turn_id uuid,
  conversation_id uuid
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
  select
    turn.id as turn_id,
    turn.conversation_id
  from public.activities activity
  join public.opportunities opportunity
    on opportunity.id = activity.opportunity_id
   and opportunity.company_id = activity.company_id
  join public.email_connections connection
    on connection.id = activity.email_connection_id
   and connection.company_id = activity.company_id::text
   and (
     connection.type = 'company'
     or (
       connection.type = 'individual'
       and btrim(connection.user_id) = p_actor_user_id::text
       and btrim(connection.user_id) ~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     )
   )
  join public.email_threads thread
    on thread.id = p_internal_thread_id
   and thread.company_id = activity.company_id
   and thread.connection_id = activity.email_connection_id
   and thread.provider_thread_id = activity.email_thread_id
   and thread.opportunity_id = activity.opportunity_id
  join public.job_conversation_turns turn
    on turn.company_id = activity.company_id
   and turn.source_activity_id = activity.id
   and turn.source_connection_id = activity.email_connection_id
   and turn.provider_message_id = activity.email_message_id
   and turn.direction = activity.direction
  join public.opportunity_correspondence_events event
    on event.id = turn.source_correspondence_event_id
   and event.company_id = turn.company_id
   and event.opportunity_id = activity.opportunity_id
   and event.activity_id = activity.id
   and event.connection_id = turn.source_connection_id
   and event.provider_thread_id = activity.email_thread_id
   and event.provider_message_id = turn.provider_message_id
   and event.direction = turn.direction
  join private.agent_provider_delivery_sources provider_source
    on provider_source.id = turn.provider_delivery_source_id
   and provider_source.source_sha256 = turn.provider_delivery_source_sha256
   and provider_source.company_id = turn.company_id
   and provider_source.connection_id = turn.source_connection_id
   and provider_source.provider_message_id = turn.provider_message_id
   and provider_source.provider_thread_id = activity.email_thread_id
   and provider_source.direction = turn.direction
   and provider_source.delivered_at = turn.delivered_at
  join public.job_conversation_anchors anchor
    on anchor.company_id = turn.company_id
   and anchor.conversation_id = turn.conversation_id
   and anchor.anchor_kind = 'opportunity'
   and anchor.opportunity_id = activity.opportunity_id
  where auth.role() = 'service_role'
    and p_company_id is not null
    and p_opportunity_id is not null
    and p_actor_user_id is not null
    and p_assignment_version is not null
    and p_assignment_version >= 0
    and p_connection_id is not null
    and p_internal_thread_id is not null
    and p_source_activity_id is not null
    and p_provider_thread_id is not null
    and p_provider_thread_id <> ''
    and p_provider_thread_id = btrim(p_provider_thread_id)
    and octet_length(p_provider_thread_id) <= 512
    and p_provider_thread_id !~ '[[:cntrl:]]'
    and activity.id = p_source_activity_id
    and activity.company_id = p_company_id
    and activity.opportunity_id = p_opportunity_id
    and activity.email_connection_id = p_connection_id
    and activity.email_thread_id = p_provider_thread_id
    and activity.email_message_id is not null
    and activity.type = 'email'
    and activity.direction = 'inbound'
    and cardinality(coalesce(activity.to_emails, '{}'::text[])) <= 100
    and cardinality(coalesce(activity.cc_emails, '{}'::text[])) <= 100
    and opportunity.id = p_opportunity_id
    and opportunity.company_id = p_company_id
    and opportunity.assigned_to = p_actor_user_id
    and opportunity.assignment_version = p_assignment_version
    and opportunity.deleted_at is null
    and connection.id = p_connection_id
    and connection.company_id = p_company_id::text
    and connection.status = 'active'
    and connection.sync_enabled is not false
    and thread.id = p_internal_thread_id
    and thread.company_id = p_company_id
    and thread.connection_id = p_connection_id
    and thread.provider_thread_id = p_provider_thread_id
    and thread.opportunity_id = p_opportunity_id
    and turn.company_id = p_company_id
    and turn.source_connection_id = p_connection_id
    and turn.direction = 'inbound'
    and turn.channel = 'email'
    and turn.source_correspondence_event_id = event.id
    and provider_source.company_id = p_company_id
    and provider_source.connection_id = p_connection_id
    and provider_source.provider = connection.provider
    and provider_source.provider_thread_id = p_provider_thread_id
    and provider_source.provider_message_id = activity.email_message_id
    and provider_source.direction = 'inbound'
    and provider_source.delivered_at = turn.delivered_at
    and provider_source.sender_identity =
      case
        when activity.from_email is not null
         and octet_length(activity.from_email) <= 512 then
          private.normalize_phase_c_email_header_address(activity.from_email)
        else null
      end
    and not exists (
      select 1
      from unnest(
        case
          when cardinality(coalesce(activity.to_emails, '{}'::text[])) <= 100
            then coalesce(activity.to_emails, '{}'::text[])
          else '{}'::text[]
        end
      )
        as recipient(raw_email)
      where case
        when recipient.raw_email is not null
         and octet_length(recipient.raw_email) <= 512 then
          private.normalize_phase_c_email_header_address(recipient.raw_email)
        else null
      end is null
    )
    and provider_source.recipient_identities = array(
      select distinct normalized.email collate "C"
      from unnest(
        case
          when cardinality(coalesce(activity.to_emails, '{}'::text[])) <= 100
            then coalesce(activity.to_emails, '{}'::text[])
          else '{}'::text[]
        end
      )
        as recipient(raw_email)
      cross join lateral (
        select case
          when recipient.raw_email is not null
           and octet_length(recipient.raw_email) <= 512 then
            private.normalize_phase_c_email_header_address(recipient.raw_email)
          else null
        end as email
      ) normalized
      where normalized.email is not null
      order by normalized.email collate "C"
    )
    and cardinality(provider_source.recipient_identities) =
      cardinality(coalesce(activity.to_emails, '{}'::text[]))
    and not exists (
      select 1
      from unnest(
        case
          when cardinality(coalesce(activity.cc_emails, '{}'::text[])) <= 100
            then coalesce(activity.cc_emails, '{}'::text[])
          else '{}'::text[]
        end
      )
        as recipient(raw_email)
      where case
        when recipient.raw_email is not null
         and octet_length(recipient.raw_email) <= 512 then
          private.normalize_phase_c_email_header_address(recipient.raw_email)
        else null
      end is null
    )
    and provider_source.cc_recipient_identities = array(
      select distinct normalized.email collate "C"
      from unnest(
        case
          when cardinality(coalesce(activity.cc_emails, '{}'::text[])) <= 100
            then coalesce(activity.cc_emails, '{}'::text[])
          else '{}'::text[]
        end
      )
        as recipient(raw_email)
      cross join lateral (
        select case
          when recipient.raw_email is not null
           and octet_length(recipient.raw_email) <= 512 then
            private.normalize_phase_c_email_header_address(recipient.raw_email)
          else null
        end as email
      ) normalized
      where normalized.email is not null
      order by normalized.email collate "C"
    )
    and cardinality(provider_source.cc_recipient_identities) =
      cardinality(coalesce(activity.cc_emails, '{}'::text[]))
    and case
      when connection.email is not null
       and octet_length(connection.email) <= 512 then
        private.normalize_phase_c_email_header_address(connection.email)
      else null
    end = any(
      provider_source.recipient_identities
      || provider_source.cc_recipient_identities
    )
    and anchor.opportunity_id = p_opportunity_id;
$function$;

revoke all on function public.read_phase_c_source_turn_as_system(
  uuid,
  uuid,
  uuid,
  bigint,
  uuid,
  uuid,
  text,
  uuid
) from public, anon, authenticated, service_role;

grant execute on function public.read_phase_c_source_turn_as_system(
  uuid,
  uuid,
  uuid,
  bigint,
  uuid,
  uuid,
  text,
  uuid
) to service_role;

-- Phase C may reach prompt context only while the exact route and immutable
-- delivered source remain current in the same database statement as the v6
-- actor-scoped context read. General internal and MCP callers keep the base
-- RPC unchanged.
create or replace function public.read_agent_phase_c_job_conversation_context_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_inbox_scope text,
  p_clients_scope text,
  p_job_permission text,
  p_job_scope text,
  p_job_kind text,
  p_job_id uuid,
  p_exact_turn_limit integer,
  p_sections text[],
  p_required_through_turn_id uuid,
  p_phase_c_assignment_version bigint,
  p_phase_c_connection_id uuid,
  p_phase_c_internal_thread_id uuid,
  p_phase_c_provider_thread_id text,
  p_phase_c_source_activity_id uuid,
  p_phase_c_source_turn_id uuid,
  p_phase_c_source_conversation_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_snapshot jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_capability_id is distinct from 'get_job_conversation_context'
     or p_capability_revision is distinct from
       'get_job_conversation_context:2026-08-07.v1'
     or p_capability_manifest_revision is distinct from
       '2026-08-14.capability-manifest.v6'
     or p_required_oauth_scopes is distinct from array[
       'ops.correspondence.read',
       'ops.customer_contacts.read',
       'ops.customers.read',
       'ops.jobs.read'
     ]::text[]
     or p_inbox_scope is distinct from 'all'
     or p_clients_scope is distinct from 'all'
     or p_job_permission is distinct from 'pipeline.view'
     or p_job_scope not in ('all', 'assigned')
     or p_job_kind is distinct from 'opportunity'
     or p_exact_turn_limit is distinct from 20
     or p_sections is distinct from array[
       'memory',
       'recent_turns',
       'participants',
       'gaps',
       'cross_job_seed'
     ]::text[]
     or p_required_through_turn_id is distinct from
       p_phase_c_source_turn_id
     or p_phase_c_assignment_version is null
     or p_phase_c_assignment_version < 0
     or p_phase_c_connection_id is null
     or p_phase_c_internal_thread_id is null
     or p_phase_c_source_activity_id is null
     or p_phase_c_source_turn_id is null
     or p_phase_c_source_conversation_id is null then
    raise exception 'invalid_agent_job_conversation_context_request'
      using errcode = '22023';
  end if;

  with source_candidates as materialized (
    select source.turn_id, source.conversation_id
    from public.read_phase_c_source_turn_as_system(
      p_company_id,
      p_job_id,
      p_actor_user_id,
      p_phase_c_assignment_version,
      p_phase_c_connection_id,
      p_phase_c_internal_thread_id,
      p_phase_c_provider_thread_id,
      p_phase_c_source_activity_id
    ) source
    where source.turn_id = p_phase_c_source_turn_id
      and source.conversation_id = p_phase_c_source_conversation_id
  ), source_proof as materialized (
    select candidate.turn_id, candidate.conversation_id
    from source_candidates candidate
    where (select count(*) from source_candidates) = 1
  ), context_snapshot as materialized (
    select public.read_agent_job_conversation_context_as_system(
      p_request_id,
      p_actor_user_id,
      p_company_id,
      p_permission_snapshot_revision,
      p_registered_permission_keys,
      p_capability_id,
      p_capability_revision,
      p_capability_manifest_revision,
      p_required_oauth_scopes,
      p_inbox_scope,
      p_clients_scope,
      p_job_permission,
      p_job_scope,
      p_job_kind,
      p_job_id,
      p_exact_turn_limit,
      p_sections,
      source.turn_id
    ) as snapshot
    from source_proof source
  )
  select context.snapshot
  into v_snapshot
  from source_proof source
  join context_snapshot context
    on context.snapshot ->> 'company_id' = p_company_id::text
   and context.snapshot ->> 'permission_snapshot_revision'
     = p_permission_snapshot_revision
   and context.snapshot -> 'requested_job' = jsonb_build_object(
     'kind', 'opportunity', 'id', p_job_id
   )
   and context.snapshot ->> 'conversation_id'
     = source.conversation_id::text
   and context.snapshot -> 'required_through' ->> 'turn_id'
     = source.turn_id::text;

  if v_snapshot is null then
    raise exception 'agent_job_conversation_context_not_found'
      using errcode = 'P0002';
  end if;
  return v_snapshot;
end;
$function$;

revoke all on function public.read_agent_phase_c_job_conversation_context_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, uuid, integer, text[], uuid, bigint, uuid, uuid, text,
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_phase_c_job_conversation_context_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, uuid, integer, text[], uuid, bigint, uuid, uuid, text,
  uuid, uuid, uuid
) to service_role;

commit;
