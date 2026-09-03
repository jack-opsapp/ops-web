-- OPS Public API: the staff read behind request handling (P2-4).
--
-- P2-1 gives staff the two verbs for a `request`-mode submission — accept
-- (`confirm_booking_request_as_system`) and decline
-- (`decline_booking_request_as_system`) — but no way to see what they are
-- deciding. `private.guest_booking_intents` holds every privilege revoked
-- from every role (design D8), so the lead surface cannot reach it at all.
-- This migration adds the one read that makes the decision possible, and
-- nothing else.
--
-- Security model, unchanged from the wave it joins:
--   * service_role only, with the auth-role check repeated inside the body as
--     defense in depth;
--   * the operator's authority on this specific lead is re-checked with
--     `private.user_can_edit_opportunity`, the same scope-aware predicate the
--     staff-actor booking path uses — a `pipeline.edit` scope of `assigned`
--     therefore sees only its own leads;
--   * an operator whose scope does not reach the lead gets an empty result,
--     never an error, so the read cannot be used to learn that a request
--     exists on a lead they cannot open;
--   * no contact channel crosses the boundary. The intent stores a keyed
--     digest and broker-owned ciphertext, never a readable address (I1), so
--     no column here could carry one even masked. Staff reach the person
--     through the client the confirm resolves.
--
-- Idempotent: `create or replace` plus grants that restate the wave's shape.

create or replace function public.read_booking_request_for_opportunity_as_system(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_actor_user_id uuid
) returns table (
  request_id uuid,
  slot_start_at timestamptz,
  duration_minutes integer,
  contact_name text,
  answers jsonb,
  requested_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_company_id is null or p_opportunity_id is null or p_actor_user_id is null then
    raise exception 'booking_request_read_input_invalid' using errcode = '22023';
  end if;

  -- An operator who is not a live member of this company, or whose pipeline
  -- scope does not cover this lead, learns nothing at all.
  if not exists (
    select 1 from public.users u
     where u.id = p_actor_user_id
       and u.company_id = p_company_id
       and u.deleted_at is null
       and coalesce(u.is_active, false)
  ) then
    return;
  end if;

  if not private.user_can_edit_opportunity(p_actor_user_id, p_opportunity_id) then
    return;
  end if;

  -- At most one row: `submitted` is the request-mode terminal, and an
  -- opportunity carries one open booking at a time. Ordered newest-first so a
  -- lead that somehow holds two pending intents still resolves deterministically
  -- to the one the customer sent last.
  return query
  select
    intent.id,
    intent.slot_start_at,
    intent.duration_minutes,
    intent.contact_name,
    intent.answers,
    coalesce(intent.verified_at, intent.created_at)
  from private.guest_booking_intents intent
  where intent.company_id = p_company_id
    and intent.resolved_opportunity_id = p_opportunity_id
    and intent.state = 'submitted'
  order by coalesce(intent.verified_at, intent.created_at) desc
  limit 1;
end;
$function$;

comment on function public.read_booking_request_for_opportunity_as_system(uuid, uuid, uuid) is
  'The public booking request one lead is waiting on, for the staff accept/decline surface (P2-4). Scope-aware on `private.user_can_edit_opportunity`; returns no rows rather than an error when the operator cannot reach the lead. Carries no contact channel (I1).';

revoke all on function public.read_booking_request_for_opportunity_as_system(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.read_booking_request_for_opportunity_as_system(uuid, uuid, uuid)
  to service_role;
