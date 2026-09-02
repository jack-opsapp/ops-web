-- OPS Public API: customer profile read + foreign-key covering indexes (P1).
--
-- Follow-up to customer_identity_foundation. Adds the one read the hosted
-- surface needs for `GET /api/customer/me` and closes the performance
-- advisor's unindexed-foreign-key notes on the new private tables.
--
-- Security model: unchanged from the foundation migration. The profile RPC is
-- a public *_as_system SECURITY DEFINER function callable only by
-- service_role, and it returns the identity's email already masked; no raw
-- identifier crosses the boundary (I4).


do $prerequisites$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'private.customer_mask_email(text)'
  ] loop
    if to_regprocedure(v_signature) is null then
      raise exception 'customer_identity prerequisite missing: %', v_signature;
    end if;
  end loop;

  if to_regclass('private.company_client_memberships') is null
     or to_regclass('private.customer_pairwise_refs') is null then
    raise exception 'customer_identity prerequisite missing: foundation tables';
  end if;
end;
$prerequisites$;

-- ---------------------------------------------------------------------------
-- Foreign-key covering indexes
-- ---------------------------------------------------------------------------

-- Leading columns in foreign-key order; the staff listing and the merge
-- trigger filter on both columns with equality, so the order is neutral.
drop index if exists private.company_client_memberships_by_client;
create index if not exists company_client_memberships_by_client
  on private.company_client_memberships (client_id, company_id, created_at);

create index if not exists company_client_memberships_by_sub_client
  on private.company_client_memberships (company_id, sub_client_id)
  where sub_client_id is not null;

create index if not exists company_client_memberships_by_merged_into
  on private.company_client_memberships (merged_into_membership_id)
  where merged_into_membership_id is not null;

create index if not exists customer_pairwise_refs_by_integration
  on private.customer_pairwise_refs (integration_id);

-- ---------------------------------------------------------------------------
-- Profile read for the hosted surface
-- ---------------------------------------------------------------------------

-- Always exactly one row. display_name is the live membership's contact
-- (sub-client) or client name, or null when there is no live membership or
-- the client record carries nothing but the customer's own address (the
-- record this identity created for itself). membership_state mirrors
-- resolve_customer_membership_as_system: a live state, `revoked` when the
-- company withdrew access, otherwise `none`.
create or replace function public.read_customer_profile_as_system(
  p_identity_id uuid,
  p_company_id uuid
) returns table (
  display_name text,
  contact_email_masked text,
  membership_state text
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_email text;
  v_membership record;
  v_display_name text;
  v_state text := 'none';
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_identity_id is null or p_company_id is null then
    raise exception 'customer_profile_input_invalid' using errcode = '22023';
  end if;

  select contact.normalized_value
  into v_email
  from private.customer_verified_contacts contact
  where contact.identity_id = p_identity_id
    and contact.channel = 'email'
    and contact.revoked_at is null
  order by contact.verified_at, contact.id
  limit 1;

  select member.client_id, member.sub_client_id, member.state
  into v_membership
  from private.company_client_memberships member
  where member.identity_id = p_identity_id
    and member.company_id = p_company_id
    and member.state in ('active_forward_only', 'active_full', 'revoked')
  order by
    case when member.state in ('active_forward_only', 'active_full') then 0 else 1 end,
    member.created_at desc
  limit 1;

  if found then
    v_state := v_membership.state;
    if v_membership.state in ('active_forward_only', 'active_full') then
      if v_membership.sub_client_id is not null then
        select nullif(btrim(sub_client.name), '')
        into v_display_name
        from public.sub_clients sub_client
        where sub_client.id = v_membership.sub_client_id
          and sub_client.company_id = p_company_id
          and sub_client.deleted_at is null;
      end if;
      if v_display_name is null then
        select nullif(btrim(client.name), '')
        into v_display_name
        from public.clients client
        where client.id = v_membership.client_id
          and client.company_id = p_company_id
          and client.deleted_at is null;
      end if;
      -- A name that is only the customer's own address is not a name.
      if v_display_name is not null
         and private.agent_normalize_discovery_email(v_display_name) is not null
         and exists (
           select 1
           from private.customer_verified_contacts contact
           where contact.identity_id = p_identity_id
             and contact.channel = 'email'
             and contact.revoked_at is null
             and contact.normalized_value = private.agent_normalize_discovery_email(v_display_name)
         ) then
        v_display_name := null;
      end if;
      if v_display_name is not null
         and v_display_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        v_display_name := null;
      end if;
    end if;
  end if;

  return query select
    left(v_display_name, 512),
    private.customer_mask_email(v_email),
    v_state;
end;
$function$;

revoke all on function public.read_customer_profile_as_system(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.read_customer_profile_as_system(uuid, uuid)
  to service_role;
