-- PUBLIC API P1-7 — read / link / create split for customer membership.
--
-- Runs against prod inside one transaction that is always rolled back.
--   :MIGRATION  path to the migration under test (/dev/null for the RED run)
--
--   /opt/homebrew/opt/libpq/bin/psql -v MIGRATION=<path> -f contract_tests.sql
--
-- Every assertion is about the defect the 2026-09-03 live E2E found: a read
-- created tenant rows. The counts are taken before and after each call and
-- compared exactly — a single new client or membership fails the suite.

\set ON_ERROR_STOP on
\set QUIET on
begin;
select set_config('statement_timeout', '120000', true);
\echo '=== applying migration under test (uncommitted) ==='
\i :MIGRATION
\echo '=== migration applied ==='

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ---------------------------------------------------------------------------
-- R1 shape: the read RPC cannot write, and nothing but service_role may call
-- ---------------------------------------------------------------------------
\echo '--- R1 function shape, volatility and grants'
do $t$
declare
  v_vol "char";
  v_state text;
  v_n integer;
begin
  if to_regprocedure('public.read_customer_membership_as_system(uuid,uuid)') is null then
    raise exception 'R1 read_customer_membership_as_system missing';
  end if;
  if to_regprocedure('public.link_customer_membership_as_system(uuid,uuid)') is null then
    raise exception 'R1 link_customer_membership_as_system missing';
  end if;
  if to_regprocedure('public.resolve_or_create_customer_membership_as_system(uuid,uuid)') is null then
    raise exception 'R1 resolve_or_create_customer_membership_as_system missing';
  end if;
  -- The create-on-read RPC is retired under its old, ambiguous name so no
  -- caller can reach it by habit.
  if to_regprocedure('public.resolve_customer_membership_as_system(uuid,uuid)') is not null then
    raise exception 'R1 the ambiguous resolve_ name still exists';
  end if;

  -- STABLE is the structural guarantee: PostgreSQL refuses any INSERT/UPDATE/
  -- DELETE inside a non-volatile function, so the read path cannot write even
  -- if a future edit tried to.
  select p.provolatile into v_vol
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'read_customer_membership_as_system';
  raise notice 'R1 read volatility = % (expect s)', v_vol;
  if v_vol <> 's' then raise exception 'R1 read RPC is not STABLE'; end if;

  select count(*) into v_n
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
  join pg_roles grantee on grantee.oid = acl.grantee
  where n.nspname = 'public'
    and p.proname in ('read_customer_membership_as_system',
                      'link_customer_membership_as_system',
                      'resolve_or_create_customer_membership_as_system')
    and grantee.rolname in ('public', 'anon', 'authenticated');
  raise notice 'R1 grants to public/anon/authenticated = % (expect 0)', v_n;
  if v_n <> 0 then raise exception 'R1 non-service grants present'; end if;

  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    perform public.read_customer_membership_as_system(gen_random_uuid(), gen_random_uuid());
    raise exception 'R1 gate did not fire for read';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '42501' then raise exception 'R1 wrong sqlstate % on read', v_state; end if;
    raise notice 'R1 read gate ok: %', v_state;
  end;
  begin
    perform public.link_customer_membership_as_system(gen_random_uuid(), gen_random_uuid());
    raise exception 'R1 gate did not fire for link';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '42501' then raise exception 'R1 wrong sqlstate % on link', v_state; end if;
    raise notice 'R1 link gate ok: %', v_state;
  end;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end $t$;

-- ---------------------------------------------------------------------------
-- R2 the defect itself: a signed-in customer reads a company they have no
--    relationship with. Zero rows created anywhere.
-- ---------------------------------------------------------------------------
\echo '--- R2 read against a stranger company creates nothing'
do $t$
declare
  v_stranger uuid;
  v_tag text := left(replace(gen_random_uuid()::text, '-', ''), 8);
  v_email text := 'stranger-' || v_tag || '@example.invalid';
  v_identity uuid;
  v_clients_before bigint; v_clients_after bigint;
  v_members_before bigint; v_members_after bigint;
  v_subs_before bigint; v_subs_after bigint;
  v_reviews_before bigint; v_reviews_after bigint;
  v_n integer;
begin
  -- The very company the live run polluted: a real business this identity has
  -- never dealt with, addressed only by its public handle.
  select id into v_stranger
  from public.companies
  where deleted_at is null and public_handle = 'norcut-railings';
  if v_stranger is null then
    select id into v_stranger
    from public.companies
    where deleted_at is null and id <> 'ddee107c-33cd-483e-8278-0f8d8a180181'
    order by created_at
    limit 1;
  end if;

  select identity_id into v_identity
  from public.upsert_customer_identity_as_system(gen_random_uuid()::text, v_email);

  select count(*) into v_clients_before from public.clients where company_id = v_stranger;
  select count(*) into v_members_before from private.company_client_memberships where company_id = v_stranger;
  select count(*) into v_subs_before from public.sub_clients where company_id = v_stranger;
  select count(*) into v_reviews_before from public.duplicate_reviews where company_id = v_stranger;

  select count(*) into v_n from public.read_customer_membership_as_system(v_identity, v_stranger);
  raise notice 'R2 read rows = % (expect 0)', v_n;
  if v_n <> 0 then raise exception 'R2 read reported a membership that does not exist'; end if;

  select count(*) into v_clients_after from public.clients where company_id = v_stranger;
  select count(*) into v_members_after from private.company_client_memberships where company_id = v_stranger;
  select count(*) into v_subs_after from public.sub_clients where company_id = v_stranger;
  select count(*) into v_reviews_after from public.duplicate_reviews where company_id = v_stranger;

  raise notice 'R2 clients %/%, memberships %/%, sub_clients %/%, duplicate_reviews %/% (before/after)',
    v_clients_before, v_clients_after, v_members_before, v_members_after,
    v_subs_before, v_subs_after, v_reviews_before, v_reviews_after;
  if v_clients_after <> v_clients_before then raise exception 'R2 a client was created by a read'; end if;
  if v_members_after <> v_members_before then raise exception 'R2 a membership was created by a read'; end if;
  if v_subs_after <> v_subs_before then raise exception 'R2 a sub-client was created by a read'; end if;
  if v_reviews_after <> v_reviews_before then raise exception 'R2 a duplicate review was created by a read'; end if;
end $t$;

-- ---------------------------------------------------------------------------
-- R3 sign-in with nothing on file: identity and verified contact, nothing else
-- ---------------------------------------------------------------------------
\echo '--- R3 sign-in with no matching client creates no client and no membership'
do $t$
declare
  v_company uuid := 'ddee107c-33cd-483e-8278-0f8d8a180181';
  v_tag text := left(replace(gen_random_uuid()::text, '-', ''), 8);
  v_email text := 'nomatch-' || v_tag || '@example.invalid';
  v_identity uuid;
  v_clients_before bigint; v_clients_after bigint;
  v_members_before bigint; v_members_after bigint;
  v_n integer;
begin
  select count(*) into v_clients_before from public.clients where company_id = v_company;
  select count(*) into v_members_before from private.company_client_memberships where company_id = v_company;

  select identity_id into v_identity
  from public.upsert_customer_identity_as_system(gen_random_uuid()::text, v_email);

  select count(*) into v_n from public.link_customer_membership_as_system(v_identity, v_company);
  raise notice 'R3 link rows = % (expect 0)', v_n;
  if v_n <> 0 then raise exception 'R3 sign-in established a membership out of nothing'; end if;

  select count(*) into v_clients_after from public.clients where company_id = v_company;
  select count(*) into v_members_after from private.company_client_memberships where company_id = v_company;
  raise notice 'R3 clients %/%, memberships %/% (before/after)',
    v_clients_before, v_clients_after, v_members_before, v_members_after;
  if v_clients_after <> v_clients_before then raise exception 'R3 sign-in created a client'; end if;
  if v_members_after <> v_members_before then raise exception 'R3 sign-in created a membership'; end if;

  -- What sign-in IS allowed to record: the identity and its verified contact.
  if not exists (select 1 from private.customer_identities where id = v_identity) then
    raise exception 'R3 the identity was not created';
  end if;
  select count(*) into v_n
  from private.customer_verified_contacts
  where identity_id = v_identity and channel = 'email' and revoked_at is null;
  raise notice 'R3 verified contacts = % (expect 1)', v_n;
  if v_n <> 1 then raise exception 'R3 the verified contact was not recorded'; end if;

  -- A read for the same pair still reports nothing.
  select count(*) into v_n from public.read_customer_membership_as_system(v_identity, v_company);
  if v_n <> 0 then raise exception 'R3 read disagrees with link'; end if;
end $t$;

-- ---------------------------------------------------------------------------
-- R4 sign-in that matches an existing client: forward-only membership, and
--    the client record itself is not touched
-- ---------------------------------------------------------------------------
\echo '--- R4 sign-in matching an existing client links without altering it'
do $t$
declare
  v_company uuid := 'ddee107c-33cd-483e-8278-0f8d8a180181';
  v_tag text := left(replace(gen_random_uuid()::text, '-', ''), 8);
  v_email text := 'onfile-' || v_tag || '@example.invalid';
  v_client uuid;
  v_identity uuid;
  v_before text; v_after text;
  v_clients_before bigint; v_clients_after bigint;
  r record;
  v_txt text;
begin
  insert into public.clients (company_id, name, email)
  values (v_company, 'R4 On File ' || v_tag, upper(v_email))
  returning id into v_client;

  select identity_id into v_identity
  from public.upsert_customer_identity_as_system(gen_random_uuid()::text, v_email);

  select count(*) into v_clients_before from public.clients where company_id = v_company;
  select md5(client.*::text) into v_before from public.clients client where client.id = v_client;

  select * into r from public.link_customer_membership_as_system(v_identity, v_company);
  raise notice 'R4 outcome=% state=% matched=%', r.outcome, r.state, r.client_id = v_client;
  if r.outcome <> 'matched_forward_only' or r.state <> 'active_forward_only' then
    raise exception 'R4 wrong outcome/state: %/%', r.outcome, r.state;
  end if;
  if r.client_id <> v_client then raise exception 'R4 linked the wrong client'; end if;

  select count(*) into v_clients_after from public.clients where company_id = v_company;
  select md5(client.*::text) into v_after from public.clients client where client.id = v_client;
  raise notice 'R4 clients %/% ; client row unchanged = %',
    v_clients_before, v_clients_after, v_before = v_after;
  if v_clients_after <> v_clients_before then raise exception 'R4 a client was created'; end if;
  if v_before is distinct from v_after then raise exception 'R4 the client row was altered'; end if;

  select evidence_kind into v_txt from private.company_client_memberships where id = r.membership_id;
  if v_txt <> 'none' then raise exception 'R4 forward-only carried evidence %', v_txt; end if;

  -- A second sign-in reports the same membership, not a new one.
  select * into r from public.link_customer_membership_as_system(v_identity, v_company);
  if r.outcome <> 'existing' then raise exception 'R4 second sign-in outcome %', r.outcome; end if;

  -- Company evidence appears -> the next sign-in promotes to full history (I2).
  insert into public.invoices (company_id, client_id, client_ref, status, invoice_number, due_date)
  values (v_company, v_client, v_client, 'sent', 'R4-' || v_tag, current_date + 30);
  select * into r from public.link_customer_membership_as_system(v_identity, v_company);
  raise notice 'R4 after sent invoice: outcome=% state=%', r.outcome, r.state;
  if r.state <> 'active_full' then raise exception 'R4 promotion did not happen'; end if;
end $t$;

-- ---------------------------------------------------------------------------
-- R5 a match with evidence already on file links straight to full history
-- ---------------------------------------------------------------------------
\echo '--- R5 sign-in with on-file evidence links at active_full'
do $t$
declare
  v_company uuid := 'ddee107c-33cd-483e-8278-0f8d8a180181';
  v_tag text := left(replace(gen_random_uuid()::text, '-', ''), 8);
  v_email text := 'transacted-' || v_tag || '@example.invalid';
  v_client uuid; v_identity uuid; r record; v_txt text;
begin
  insert into public.clients (company_id, name, email)
  values (v_company, 'R5 Transacted ' || v_tag, v_email)
  returning id into v_client;
  insert into public.invoices (company_id, client_id, client_ref, status, invoice_number, due_date)
  values (v_company, v_client, v_client, 'paid', 'R5-' || v_tag, current_date + 30);

  select identity_id into v_identity
  from public.upsert_customer_identity_as_system(gen_random_uuid()::text, v_email);
  select * into r from public.link_customer_membership_as_system(v_identity, v_company);
  raise notice 'R5 outcome=% state=%', r.outcome, r.state;
  if r.outcome <> 'matched_full' or r.state <> 'active_full' then
    raise exception 'R5 wrong outcome/state %/%', r.outcome, r.state;
  end if;
  select evidence_kind into v_txt from private.company_client_memberships where id = r.membership_id;
  if v_txt <> 'on_file_transacted' then raise exception 'R5 evidence %', v_txt; end if;
end $t$;

-- ---------------------------------------------------------------------------
-- R6 a contact (sub-client) match links the parent client and carries the
--    contact, and a revoked membership stays revoked for both read and link
-- ---------------------------------------------------------------------------
\echo '--- R6 sub-client match, revocation, and what the read reports'
do $t$
declare
  v_company uuid := 'ddee107c-33cd-483e-8278-0f8d8a180181';
  v_staff uuid := '8e811f98-9f2b-4f64-b409-ed56074b7dc8';
  v_tag text := left(replace(gen_random_uuid()::text, '-', ''), 8);
  v_email text := 'contact-' || v_tag || '@example.invalid';
  v_parent uuid; v_sub uuid; v_identity uuid; r record; v_n integer;
begin
  insert into public.clients (company_id, name)
  values (v_company, 'R6 Org ' || v_tag) returning id into v_parent;
  insert into public.sub_clients (company_id, client_id, name, email)
  values (v_company, v_parent, 'R6 Contact', v_email) returning id into v_sub;

  select identity_id into v_identity
  from public.upsert_customer_identity_as_system(gen_random_uuid()::text, v_email);
  select * into r from public.link_customer_membership_as_system(v_identity, v_company);
  raise notice 'R6 outcome=% parent=% sub=%', r.outcome, r.client_id = v_parent, r.sub_client_id = v_sub;
  if r.outcome <> 'matched_forward_only' or r.client_id <> v_parent or r.sub_client_id <> v_sub then
    raise exception 'R6 sub-client match wrong';
  end if;

  -- The read reports the same live membership without touching it.
  select * into r from public.read_customer_membership_as_system(v_identity, v_company);
  if r.outcome <> 'existing' or r.state <> 'active_forward_only' then
    raise exception 'R6 read reported %/%', r.outcome, r.state;
  end if;

  if not public.revoke_customer_membership_as_system(r.membership_id, v_staff, 'staff_revoked') then
    raise exception 'R6 revoke failed';
  end if;

  -- Revoked must survive both paths: the read reports it so the gate can deny
  -- REVOKED, and sign-in must never mint a fresh membership around it (I7).
  select * into r from public.read_customer_membership_as_system(v_identity, v_company);
  raise notice 'R6 read after revoke: outcome=% state=%', r.outcome, r.state;
  if r.state <> 'revoked' then raise exception 'R6 read lost the revocation'; end if;

  select count(*) into v_n from private.company_client_memberships
  where identity_id = v_identity and company_id = v_company;
  select * into r from public.link_customer_membership_as_system(v_identity, v_company);
  if r.state <> 'revoked' then raise exception 'R6 link ignored the revocation'; end if;
  if (select count(*) from private.company_client_memberships
      where identity_id = v_identity and company_id = v_company) <> v_n then
    raise exception 'R6 link created a membership around a revocation';
  end if;
end $t$;

-- ---------------------------------------------------------------------------
-- R7 the read never promotes: evidence on file, state stays as stored
-- ---------------------------------------------------------------------------
\echo '--- R7 a read leaves a forward-only membership exactly as it found it'
do $t$
declare
  v_company uuid := 'ddee107c-33cd-483e-8278-0f8d8a180181';
  v_tag text := left(replace(gen_random_uuid()::text, '-', ''), 8);
  v_email text := 'promote-' || v_tag || '@example.invalid';
  v_client uuid; v_identity uuid; r record; v_before text; v_after text;
begin
  insert into public.clients (company_id, name, email)
  values (v_company, 'R7 Client ' || v_tag, v_email) returning id into v_client;
  select identity_id into v_identity
  from public.upsert_customer_identity_as_system(gen_random_uuid()::text, v_email);
  select * into r from public.link_customer_membership_as_system(v_identity, v_company);
  if r.state <> 'active_forward_only' then raise exception 'R7 setup'; end if;

  insert into public.invoices (company_id, client_id, client_ref, status, invoice_number, due_date)
  values (v_company, v_client, v_client, 'sent', 'R7-' || v_tag, current_date + 30);

  select md5(member.*::text) into v_before
  from private.company_client_memberships member where member.id = r.membership_id;
  select * into r from public.read_customer_membership_as_system(v_identity, v_company);
  select md5(member.*::text) into v_after
  from private.company_client_memberships member where member.id = r.membership_id;
  raise notice 'R7 read state=% ; membership row unchanged = %', r.state, v_before = v_after;
  if r.state <> 'active_forward_only' then raise exception 'R7 the read promoted the membership'; end if;
  if v_before is distinct from v_after then raise exception 'R7 the read wrote to the membership'; end if;
end $t$;

-- ---------------------------------------------------------------------------
-- R8 many matches at sign-in: ambiguous is not an invitation to create (I18)
-- ---------------------------------------------------------------------------
\echo '--- R8 an ambiguous match at sign-in creates nothing'
do $t$
declare
  v_company uuid := 'ddee107c-33cd-483e-8278-0f8d8a180181';
  v_tag text := left(replace(gen_random_uuid()::text, '-', ''), 8);
  v_email text := 'ambiguous-' || v_tag || '@example.invalid';
  v_identity uuid;
  v_clients_before bigint; v_clients_after bigint;
  v_members_before bigint; v_members_after bigint;
  v_reviews_before bigint; v_reviews_after bigint;
  v_n integer;
begin
  insert into public.clients (company_id, name, email) values (v_company, 'R8 A ' || v_tag, v_email);
  insert into public.clients (company_id, name, email) values (v_company, 'R8 B ' || v_tag, v_email);
  select identity_id into v_identity
  from public.upsert_customer_identity_as_system(gen_random_uuid()::text, v_email);

  select count(*) into v_clients_before from public.clients where company_id = v_company;
  select count(*) into v_members_before from private.company_client_memberships where company_id = v_company;
  select count(*) into v_reviews_before from public.duplicate_reviews where company_id = v_company;

  select count(*) into v_n from public.link_customer_membership_as_system(v_identity, v_company);
  raise notice 'R8 link rows = % (expect 0)', v_n;
  if v_n <> 0 then raise exception 'R8 sign-in guessed at an ambiguous match'; end if;

  select count(*) into v_clients_after from public.clients where company_id = v_company;
  select count(*) into v_members_after from private.company_client_memberships where company_id = v_company;
  select count(*) into v_reviews_after from public.duplicate_reviews where company_id = v_company;
  raise notice 'R8 clients %/%, memberships %/%, reviews %/% (before/after)',
    v_clients_before, v_clients_after, v_members_before, v_members_after,
    v_reviews_before, v_reviews_after;
  if v_clients_after <> v_clients_before then raise exception 'R8 sign-in created a third client'; end if;
  if v_members_after <> v_members_before then raise exception 'R8 sign-in created a membership'; end if;
  if v_reviews_after <> v_reviews_before then raise exception 'R8 sign-in opened a duplicate review'; end if;

  -- The ambiguity is recorded where staff work is tracked, not in the tenant's
  -- client list: an identity event, and nothing else.
  select count(*) into v_n
  from private.customer_identity_events
  where identity_id = v_identity and event_type = 'membership_match_ambiguous';
  raise notice 'R8 ambiguity events = % (expect 1)', v_n;
  if v_n <> 1 then raise exception 'R8 the ambiguity was not recorded'; end if;
end $t$;

-- ---------------------------------------------------------------------------
-- R9 the create-capable RPC still does its job for genuine intent
-- ---------------------------------------------------------------------------
\echo '--- R9 resolve_or_create still creates for the intent paths'
do $t$
declare
  v_company uuid := 'ddee107c-33cd-483e-8278-0f8d8a180181';
  v_tag text := left(replace(gen_random_uuid()::text, '-', ''), 8);
  v_email_zero text := 'intent-zero-' || v_tag || '@example.invalid';
  v_email_many text := 'intent-many-' || v_tag || '@example.invalid';
  v_a uuid; v_b uuid; v_id_zero uuid; v_id_many uuid; r record; v_n integer; v_txt text;
begin
  select identity_id into v_id_zero
  from public.upsert_customer_identity_as_system(gen_random_uuid()::text, v_email_zero);
  select * into r from public.resolve_or_create_customer_membership_as_system(v_id_zero, v_company);
  raise notice 'R9 zero: outcome=% state=%', r.outcome, r.state;
  if r.outcome <> 'created' or r.state <> 'active_full' then raise exception 'R9 zero wrong'; end if;
  select name || ' / ' || email into v_txt from public.clients where id = r.client_id;
  raise notice 'R9 created client: %', v_txt;
  select * into r from public.resolve_or_create_customer_membership_as_system(v_id_zero, v_company);
  if r.outcome <> 'existing' then raise exception 'R9 not idempotent'; end if;

  insert into public.clients (company_id, name, email) values (v_company, 'R9 A ' || v_tag, v_email_many) returning id into v_a;
  insert into public.clients (company_id, name, email) values (v_company, 'R9 B ' || v_tag, v_email_many) returning id into v_b;
  select identity_id into v_id_many
  from public.upsert_customer_identity_as_system(gen_random_uuid()::text, v_email_many);
  select * into r from public.resolve_or_create_customer_membership_as_system(v_id_many, v_company);
  raise notice 'R9 many: outcome=% fresh=%', r.outcome, r.client_id not in (v_a, v_b);
  if r.outcome <> 'created_possible_duplicate' then raise exception 'R9 many wrong'; end if;
  select count(*) into v_n from public.duplicate_reviews
  where company_id = v_company and entity_type = 'client' and status = 'pending'
    and (entity_a_id = r.client_id or entity_b_id = r.client_id);
  raise notice 'R9 duplicate reviews = % (expect 2)', v_n;
  if v_n <> 2 then raise exception 'R9 reviews wrong'; end if;
  select count(*) into v_n from public.notifications
  where company_id = v_company::text
    and dedupe_key = 'customer_identity:possible_duplicate:' || r.client_id::text;
  raise notice 'R9 notifications = % (expect >= 1)', v_n;
  if v_n < 1 then raise exception 'R9 no staff notification'; end if;

  -- Matching still behaves exactly as it did before the split: an identity
  -- with no verified email has nothing to match on and nothing to create from.
  insert into private.customer_identities (auth_subject)
  values (gen_random_uuid()::text) returning id into v_a;
  select count(*) into v_n
  from public.resolve_or_create_customer_membership_as_system(v_a, v_company);
  raise notice 'R9 identity without a verified email -> % rows (expect 0)', v_n;
  if v_n <> 0 then raise exception 'R9 created a client for an identity with no email'; end if;
  select count(*) into v_n from public.link_customer_membership_as_system(v_a, v_company);
  if v_n <> 0 then raise exception 'R9 link resolved an identity with no email'; end if;
  select count(*) into v_n from public.read_customer_membership_as_system(v_a, v_company);
  if v_n <> 0 then raise exception 'R9 read resolved an identity with no email'; end if;
end $t$;

-- ---------------------------------------------------------------------------
-- R10 both new RPCs refuse malformed input and unknown principals the same way
-- ---------------------------------------------------------------------------
\echo '--- R10 input handling'
do $t$
declare
  v_company uuid := 'ddee107c-33cd-483e-8278-0f8d8a180181';
  v_state text; v_n integer; v_identity uuid;
begin
  begin
    perform public.read_customer_membership_as_system(null, v_company);
    raise exception 'R10 read accepted null identity';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '22023' then raise exception 'R10 read null sqlstate %', v_state; end if;
  end;
  begin
    perform public.link_customer_membership_as_system(gen_random_uuid(), null);
    raise exception 'R10 link accepted null company';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '22023' then raise exception 'R10 link null sqlstate %', v_state; end if;
  end;

  -- Unknown identity, unknown company, and a soft-deleted company all resolve
  -- to no row rather than an error that would confirm what exists (I5).
  select count(*) into v_n from public.read_customer_membership_as_system(gen_random_uuid(), v_company);
  if v_n <> 0 then raise exception 'R10 unknown identity read rows %', v_n; end if;
  select count(*) into v_n from public.link_customer_membership_as_system(gen_random_uuid(), v_company);
  if v_n <> 0 then raise exception 'R10 unknown identity link rows %', v_n; end if;

  select identity_id into v_identity
  from public.upsert_customer_identity_as_system(gen_random_uuid()::text,
    'r10-' || left(replace(gen_random_uuid()::text, '-', ''), 8) || '@example.invalid');
  select count(*) into v_n from public.read_customer_membership_as_system(v_identity, gen_random_uuid());
  if v_n <> 0 then raise exception 'R10 unknown company read rows %', v_n; end if;
  select count(*) into v_n from public.link_customer_membership_as_system(v_identity, gen_random_uuid());
  if v_n <> 0 then raise exception 'R10 unknown company link rows %', v_n; end if;
  raise notice 'R10 input handling ok';
end $t$;

\echo '=== all assertions passed; rolling back ==='
rollback;
