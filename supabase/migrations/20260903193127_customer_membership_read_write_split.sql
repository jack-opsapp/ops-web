-- OPS Public API: split membership resolution into read, link and create (P1).
--
-- The 2026-09-03 live end-to-end run found a write on a read path. One RPC,
-- `resolve_customer_membership_as_system`, both reported a membership and
-- created one, and `GET /api/customer/me` called it on every request. A
-- customer signed into one business, whose browser then asked about another
-- business's public handle, caused a `clients` row and a full-access
-- membership to appear inside that second, live company.
--
-- Design invariants added the same day
-- (specs/2026-09-01-public-api-customer-identity-design.md):
--   I17  No public read path may create or mutate tenant data. Reporting a
--        membership and establishing one are different operations and may not
--        share an RPC.
--   I18  A client record is born of intent, not of sign-in. Signing in proves
--        identity only. A verified contact that matches an existing client
--        establishes a membership under the I2 evidence rules; a contact that
--        matches nothing — or matches ambiguously — establishes nothing.
--
-- This migration therefore ships three functions where there was one:
--
--   read_customer_membership_as_system         STABLE. Reports the stored
--     membership and nothing else. PostgreSQL refuses INSERT/UPDATE/DELETE
--     inside a non-volatile function, so the read path cannot write even by
--     accident. Callers: GET /api/customer/me, the per-request authority gate,
--     every hosted page render, every future read.
--
--   link_customer_membership_as_system         Sign-in (I18). Establishes a
--     membership only when the identity's verified email matches exactly one
--     live client in that company; promotes an existing forward-only
--     membership when company evidence has appeared (I2). Creates no client,
--     ever. Caller: POST /api/customer/auth/verify.
--
--   resolve_or_create_customer_membership_as_system   The create-capable path,
--     unchanged in behaviour from the retired RPC. Named so the distinction
--     cannot be missed. Permitted callers, and only these: the P2 guest
--     booking confirm, the P2 booking claim, and the P4 lead intake — moments
--     that carry real customer intent and legitimately create the client.
--     Never a read, never sign-in.
--
-- The matching itself lives in one private helper used by all three, so the
-- read, the link and the create can never drift apart on who counts as a
-- match.

do $prerequisites$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'private.customer_identity_evidence_for_client(uuid,uuid,uuid)',
    'private.customer_record_identity_event(text,uuid,uuid,uuid,uuid,text,jsonb)',
    'private.agent_normalize_discovery_email(text)',
    'public.resolve_customer_membership_as_system(uuid,uuid)'
  ] loop
    if to_regprocedure(v_signature) is null then
      raise exception 'customer membership split prerequisite missing: %', v_signature;
    end if;
  end loop;

  if to_regclass('private.company_client_memberships') is null
     or to_regclass('private.customer_verified_contacts') is null then
    raise exception 'customer membership split prerequisite missing: foundation tables';
  end if;
end;
$prerequisites$;

-- ---------------------------------------------------------------------------
-- Shared matching (design §5.3, I1)
-- ---------------------------------------------------------------------------

-- Verified channels only; phones are stored, never matched, in V1. Sorted so
-- the advisory locks below are always taken in the same order.
create or replace function private.customer_identity_verified_emails(
  p_identity_id uuid
) returns text[]
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select array_agg(contact.normalized_value order by contact.normalized_value)
  from private.customer_verified_contacts contact
  where contact.identity_id = p_identity_id
    and contact.channel = 'email'
    and contact.revoked_at is null;
$function$;

revoke all on function private.customer_identity_verified_emails(uuid)
  from public, anon, authenticated, service_role;

-- Live clients matched directly or through one live contact (sub-client);
-- soft-deleted and merged-away rows never match.
create or replace function private.customer_membership_candidate_clients(
  p_company_id uuid,
  p_emails text[]
) returns uuid[]
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select coalesce(array_agg(distinct matched.client_id), array[]::uuid[])
  from (
    select client.id as client_id
    from public.clients client
    where client.company_id = p_company_id
      and client.deleted_at is null
      and client.merged_into_client_id is null
      and private.agent_normalize_discovery_email(client.email) = any (p_emails)
    union all
    select sub_client.client_id
    from public.sub_clients sub_client
    join public.clients client
      on client.id = sub_client.client_id
     and client.company_id = sub_client.company_id
    where sub_client.company_id = p_company_id
      and sub_client.deleted_at is null
      and client.deleted_at is null
      and client.merged_into_client_id is null
      and private.agent_normalize_discovery_email(sub_client.email) = any (p_emails)
  ) matched;
$function$;

revoke all on function private.customer_membership_candidate_clients(uuid, text[])
  from public, anon, authenticated, service_role;

-- Prefer the client's own email over a contact's; carry the contact for
-- attribution when it was the match (D5).
create or replace function private.customer_membership_matched_sub_client(
  p_company_id uuid,
  p_client_id uuid,
  p_emails text[]
) returns uuid
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select sub_client.id
  from public.sub_clients sub_client
  where sub_client.company_id = p_company_id
    and sub_client.client_id = p_client_id
    and sub_client.deleted_at is null
    and private.agent_normalize_discovery_email(sub_client.email) = any (p_emails)
    and not exists (
      select 1
      from public.clients client
      where client.id = p_client_id
        and private.agent_normalize_discovery_email(client.email) = any (p_emails)
    )
  order by sub_client.created_at, sub_client.id
  limit 1;
$function$;

revoke all on function private.customer_membership_matched_sub_client(uuid, uuid, text[])
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The establish core, shared by sign-in and the intent paths
-- ---------------------------------------------------------------------------

-- Always exactly one row. Everything a caller needs to decide what happens
-- next, and nothing a caller has to re-derive:
--   outcome null            nothing was established. `candidate_ids` says why:
--                           null = the identity or company is unusable, or the
--                           identity has no verified email; an array = the
--                           matching came back with zero or several clients.
--   outcome 'existing'      a membership already binds this pair (live, or
--                           revoked by the company, which stands until staff
--                           act again — I7).
--   outcome 'matched_*'     exactly one client matched and a membership was
--                           established at the state the I2 evidence allows.
--
-- The advisory lock is held for the rest of the transaction, so a caller that
-- goes on to create a client is still serialized against a concurrent
-- resolution for the same company and email.
create or replace function private.customer_membership_establish_core(
  p_identity_id uuid,
  p_company_id uuid
) returns table (
  membership_id uuid,
  client_id uuid,
  sub_client_id uuid,
  state text,
  outcome text,
  candidate_ids uuid[],
  emails text[]
)
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_identity private.customer_identities%rowtype;
  v_membership private.company_client_memberships%rowtype;
  v_emails text[];
  v_email text;
  v_candidates uuid[];
  v_client_id uuid;
  v_sub_client_id uuid;
  v_evidence text;
  v_state text;
  v_outcome text;
  v_membership_id uuid;
begin
  select identity.*
  into v_identity
  from private.customer_identities identity
  where identity.id = p_identity_id;
  if not found or v_identity.status <> 'active' then
    return query select null::uuid, null::uuid, null::uuid, null::text, null::text,
                        null::uuid[], null::text[];
    return;
  end if;

  if not exists (
    select 1
    from public.companies company
    where company.id = p_company_id
      and company.deleted_at is null
  ) then
    return query select null::uuid, null::uuid, null::uuid, null::text, null::text,
                        null::uuid[], null::text[];
    return;
  end if;

  v_emails := private.customer_identity_verified_emails(p_identity_id);

  -- Same lock key the intake design uses, taken in sorted order.
  if v_emails is not null then
    foreach v_email in array v_emails loop
      perform pg_advisory_xact_lock(hashtext(p_company_id::text || ':' || v_email));
    end loop;
  end if;

  select member.*
  into v_membership
  from private.company_client_memberships member
  where member.identity_id = p_identity_id
    and member.company_id = p_company_id
    and member.state in ('active_forward_only', 'active_full')
  order by member.created_at desc
  limit 1
  for update;

  if found then
    if v_membership.state = 'active_forward_only' then
      v_evidence := private.customer_identity_evidence_for_client(
        p_identity_id, p_company_id, v_membership.client_id
      );
      if v_evidence = 'on_file_transacted' then
        update private.company_client_memberships member
        set state = 'active_full',
            evidence_kind = 'on_file_transacted'
        where member.id = v_membership.id
        returning * into v_membership;
        perform private.customer_record_identity_event(
          'membership_promoted', p_identity_id, p_company_id, null,
          v_membership.id, null,
          jsonb_build_object('evidence_kind', 'on_file_transacted')
        );
      end if;
    end if;
    return query select
      v_membership.id, v_membership.client_id, v_membership.sub_client_id,
      v_membership.state, 'existing'::text, null::uuid[], v_emails;
    return;
  end if;

  -- A revocation by the company stands until staff act again (I7).
  select member.*
  into v_membership
  from private.company_client_memberships member
  where member.identity_id = p_identity_id
    and member.company_id = p_company_id
    and member.state = 'revoked'
  order by member.revoked_at desc
  limit 1;
  if found then
    return query select
      v_membership.id, v_membership.client_id, v_membership.sub_client_id,
      v_membership.state, 'existing'::text, null::uuid[], v_emails;
    return;
  end if;

  if v_emails is null then
    return query select null::uuid, null::uuid, null::uuid, null::text, null::text,
                        null::uuid[], null::text[];
    return;
  end if;

  v_candidates := private.customer_membership_candidate_clients(p_company_id, v_emails);

  if cardinality(v_candidates) <> 1 then
    -- Zero or several. Establishing anything here is the caller's decision,
    -- and only an intent path may make it (I18).
    return query select null::uuid, null::uuid, null::uuid, null::text, null::text,
                        v_candidates, v_emails;
    return;
  end if;

  v_client_id := v_candidates[1];
  v_sub_client_id := private.customer_membership_matched_sub_client(
    p_company_id, v_client_id, v_emails
  );

  v_evidence := private.customer_identity_evidence_for_client(
    p_identity_id, p_company_id, v_client_id
  );
  if v_evidence = 'on_file_transacted' then
    v_state := 'active_full';
    v_outcome := 'matched_full';
  else
    v_state := 'active_forward_only';
    v_evidence := 'none';
    v_outcome := 'matched_forward_only';
  end if;

  insert into private.company_client_memberships (
    identity_id, company_id, client_id, sub_client_id, state, evidence_kind
  ) values (
    p_identity_id, p_company_id, v_client_id, v_sub_client_id, v_state, v_evidence
  )
  returning id into v_membership_id;

  perform private.customer_record_identity_event(
    'membership_matched', p_identity_id, p_company_id, null, v_membership_id, null,
    jsonb_build_object(
      'state', v_state,
      'evidence_kind', v_evidence,
      'candidate_clients', 1,
      'via_sub_client', v_sub_client_id is not null
    )
  );

  return query select
    v_membership_id, v_client_id, v_sub_client_id, v_state, v_outcome,
    v_candidates, v_emails;
end;
$function$;

revoke all on function private.customer_membership_establish_core(uuid, uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Read (I17)
-- ---------------------------------------------------------------------------

-- Reports the membership that binds this identity to this company: the live
-- one, or the revoked one that stands in its place, or no row at all. It never
-- matches, never promotes, never creates. Declared STABLE so the database
-- itself refuses any write inside it.
--
-- `outcome` is always 'existing' — a read reports what is, and the resolution
-- outcomes describe an act of establishing that a read never performs.
create or replace function public.read_customer_membership_as_system(
  p_identity_id uuid,
  p_company_id uuid
) returns table (
  membership_id uuid,
  client_id uuid,
  sub_client_id uuid,
  state text,
  outcome text
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_membership private.company_client_memberships%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_identity_id is null or p_company_id is null then
    raise exception 'customer_membership_input_invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from private.customer_identities identity
    where identity.id = p_identity_id
      and identity.status = 'active'
  ) then
    return;
  end if;

  if not exists (
    select 1
    from public.companies company
    where company.id = p_company_id
      and company.deleted_at is null
  ) then
    return;
  end if;

  select member.*
  into v_membership
  from private.company_client_memberships member
  where member.identity_id = p_identity_id
    and member.company_id = p_company_id
    and member.state in ('active_forward_only', 'active_full', 'revoked')
  order by
    case when member.state in ('active_forward_only', 'active_full') then 0 else 1 end,
    member.created_at desc
  limit 1;
  if not found then
    return;
  end if;

  return query select
    v_membership.id, v_membership.client_id, v_membership.sub_client_id,
    v_membership.state, 'existing'::text;
end;
$function$;

revoke all on function public.read_customer_membership_as_system(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.read_customer_membership_as_system(uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Link — the sign-in path (I18)
-- ---------------------------------------------------------------------------

-- Sign-in proves identity, not authority (I3), and a client record is born of
-- intent, not of sign-in (I18). So this establishes a membership only against
-- a client that already exists in that company and matches unambiguously. Zero
-- matches and several matches both resolve to no row: the customer sees an
-- honest empty state, and the company's data is untouched. Nothing here writes
-- to any tenant table.
create or replace function public.link_customer_membership_as_system(
  p_identity_id uuid,
  p_company_id uuid
) returns table (
  membership_id uuid,
  client_id uuid,
  sub_client_id uuid,
  state text,
  outcome text
)
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_core record;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_identity_id is null or p_company_id is null then
    raise exception 'customer_membership_input_invalid' using errcode = '22023';
  end if;

  select * into v_core
  from private.customer_membership_establish_core(p_identity_id, p_company_id);

  if v_core.outcome is not null then
    return query select
      v_core.membership_id, v_core.client_id, v_core.sub_client_id,
      v_core.state, v_core.outcome;
    return;
  end if;

  -- Several clients in this company carry the verified email. Guessing one
  -- would hand a customer the wrong history, and minting a third record would
  -- make the company's duplicates worse. The ambiguity is recorded against the
  -- identity — never in the tenant's data — and resolves itself once staff
  -- merge the duplicates: the next sign-in matches exactly one.
  if v_core.candidate_ids is not null and cardinality(v_core.candidate_ids) > 1 then
    perform private.customer_record_identity_event(
      'membership_match_ambiguous', p_identity_id, p_company_id, null, null, null,
      jsonb_build_object('candidate_clients', cardinality(v_core.candidate_ids))
    );
  end if;

  return;
end;
$function$;

revoke all on function public.link_customer_membership_as_system(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.link_customer_membership_as_system(uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Resolve or create — the intent paths only (design §5.3, D6)
-- ---------------------------------------------------------------------------

-- MAY ONLY BE CALLED FROM A GENUINE CUSTOMER INTENT: the P2 guest booking
-- confirm, the P2 booking claim, and the P4 lead intake. Those moments create
-- the client legitimately, because the customer asked this business for
-- something. Never call this from a read, from sign-in, or from anything a
-- browser can trigger by naming a public handle — that is the defect this
-- split exists to prevent (I17, I18).
--
-- Outcomes:
--   existing                    a membership already binds this pair;
--   matched_full                one client matched, with on-file evidence;
--   matched_forward_only        one client matched, no evidence yet;
--   created                     nothing matched; the customer's own record was
--                               created and is fully theirs;
--   created_possible_duplicate  several matched; a fresh client was created,
--                               duplicate reviews were opened and staff were
--                               notified (D6).
create or replace function public.resolve_or_create_customer_membership_as_system(
  p_identity_id uuid,
  p_company_id uuid
) returns table (
  membership_id uuid,
  client_id uuid,
  sub_client_id uuid,
  state text,
  outcome text
)
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_core record;
  v_emails text[];
  v_candidates uuid[];
  v_candidate_client_id uuid;
  v_client_id uuid;
  v_membership_id uuid;
  v_outcome text;
  v_event_type text;
  v_staff_user_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_identity_id is null or p_company_id is null then
    raise exception 'customer_membership_input_invalid' using errcode = '22023';
  end if;

  select * into v_core
  from private.customer_membership_establish_core(p_identity_id, p_company_id);

  if v_core.outcome is not null then
    return query select
      v_core.membership_id, v_core.client_id, v_core.sub_client_id,
      v_core.state, v_core.outcome;
    return;
  end if;

  -- The identity or the company is unusable, or there is no verified email to
  -- match with: there is nothing to create a record from.
  if v_core.candidate_ids is null then
    return;
  end if;

  v_emails := v_core.emails;
  v_candidates := v_core.candidate_ids;

  -- Zero or many: the lead always gets a client (D6). The identity's own new
  -- record is fully theirs from the start.
  insert into public.clients (company_id, name, email)
  values (p_company_id, v_emails[1], v_emails[1])
  returning id into v_client_id;

  if cardinality(v_candidates) = 0 then
    v_outcome := 'created';
    v_event_type := 'membership_created';
  else
    v_outcome := 'created_possible_duplicate';
    v_event_type := 'membership_created_possible_duplicate';
  end if;

  insert into private.company_client_memberships (
    identity_id, company_id, client_id, sub_client_id, state, evidence_kind
  ) values (
    p_identity_id, p_company_id, v_client_id, null, 'active_full', 'created_by_identity'
  )
  returning id into v_membership_id;

  perform private.customer_record_identity_event(
    v_event_type, p_identity_id, p_company_id, null, v_membership_id, null,
    jsonb_build_object(
      'state', 'active_full',
      'evidence_kind', 'created_by_identity',
      'candidate_clients', cardinality(v_candidates),
      'via_sub_client', false
    )
  );

  if v_outcome = 'created_possible_duplicate' then
    -- Open a review against each candidate so the existing merge flow resolves
    -- it; the merge re-points memberships through the follow trigger.
    foreach v_candidate_client_id in array v_candidates loop
      insert into public.duplicate_reviews (
        company_id,
        entity_type,
        entity_a_id,
        entity_b_id,
        confidence,
        signals,
        status
      ) values (
        p_company_id,
        'client',
        least(v_client_id, v_candidate_client_id),
        greatest(v_client_id, v_candidate_client_id),
        'high',
        jsonb_build_array(jsonb_build_object('type', 'same_email', 'detail', v_emails[1])),
        'pending'
      )
      on conflict (company_id, entity_type, entity_a_id, entity_b_id) do nothing;
    end loop;

    for v_staff_user_id in
      select recipient
      from public.users_with_permission(p_company_id, 'pipeline.manage', 'all') recipient
    loop
      perform public.create_notification_if_new_with_identity(
        v_staff_user_id,
        p_company_id,
        'duplicates_found',
        'Potential duplicates found',
        'A customer signed in with an email on more than one client record. Review and merge.',
        true,
        null,
        'Review',
        null,
        null,
        'customer_identity:possible_duplicate:' || v_client_id::text
      );
    end loop;
  end if;

  return query select
    v_membership_id, v_client_id, null::uuid, 'active_full'::text, v_outcome;
end;
$function$;

revoke all on function public.resolve_or_create_customer_membership_as_system(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_or_create_customer_membership_as_system(uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Retire the ambiguous name
-- ---------------------------------------------------------------------------

-- Nothing in the database referenced it (verified against pg_proc on prod
-- 2026-09-03) and the only application callers are rewritten in the same
-- change. Dropping it rather than leaving it aliased is the point: a name that
-- reads like a read and behaves like a write must not survive this fix.
drop function if exists public.resolve_customer_membership_as_system(uuid, uuid);
