\set ON_ERROR_STOP on
\set QUIET on
begin;
select set_config('statement_timeout', '120000', true);
\echo '=== applying migration inside transaction ==='
\i customer_identity_foundation.sql
\echo '=== migration applied (uncommitted) ==='

-- Service-role claim so the *_as_system gates pass for the positive tests.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ---------------------------------------------------------------------------
-- T1 grants + gate
-- ---------------------------------------------------------------------------
\echo '--- T1 zero table grants on new private tables'
select table_name, count(*) as grants
from information_schema.role_table_grants
where table_schema = 'private'
  and table_name in ('customer_identities','customer_verified_contacts','customer_sessions',
    'customer_otp_challenges','company_client_memberships','customer_integrations',
    'customer_pairwise_refs','customer_identity_events')
  and grantee <> 'postgres'
group by 1;
select count(*) as non_owner_grants_expect_zero
from information_schema.role_table_grants
where table_schema = 'private'
  and (table_name like 'customer_%' or table_name = 'company_client_memberships')
  and grantee <> 'postgres';

\echo '--- T1 gate: anon caller -> 42501'
do $t$
declare v_state text;
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    perform public.resolve_customer_session_as_system('x');
    raise exception 'gate did not fire';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '42501' then raise exception 'wrong sqlstate %', v_state; end if;
    raise notice 'T1 gate ok: sqlstate=% message=%', v_state, sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  begin
    perform public.begin_customer_otp_challenge_as_system('1:'||repeat('a',64), repeat('b',64));
    raise exception 'gate did not fire (no jwt)';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '42501' then raise exception 'wrong sqlstate %', v_state; end if;
    raise notice 'T1 gate ok without jwt: sqlstate=%', v_state;
  end;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end $t$;

\echo '--- T1 gate as real anon role (set role anon)'
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $t$
declare v_state text;
begin
  begin
    perform public.resolve_customer_session_as_system('x');
    raise exception 'gate did not fire';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    raise notice 'T1 anon role: sqlstate=% message=%', v_state, sqlerrm;
    if v_state not in ('42501') then raise exception 'unexpected %', v_state; end if;
  end;
end $t$;
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ---------------------------------------------------------------------------
-- T2 public_handle backfill
-- ---------------------------------------------------------------------------
\echo '--- T2 public_handle backfill'
select count(*) as companies, count(public_handle) as with_handle, count(distinct public_handle) as distinct_handles,
       bool_and(public_handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(public_handle) between 3 and 48) as all_shape_ok
from public.companies;
select name, public_handle from public.companies where name ilike 'maverick%' or name ilike 'light my%' or name ilike 'jorge%' or name ilike 'hydrowod%' or name ilike 'faber%' order by public_handle;
\echo '--- T2 new company gets a handle from the trigger (rolled back)'
do $t$
declare v_id uuid; v_handle text;
begin
  insert into public.companies (name) values ('MAVERICK PROJECTS LTD') returning id, public_handle into v_id, v_handle;
  raise notice 'T2 trigger handle for duplicate name: %', v_handle;
  if v_handle !~ '^maverick-projects-ltd-[0-9]+$' then raise exception 'unexpected handle %', v_handle; end if;
end $t$;

-- ---------------------------------------------------------------------------
-- T3 trigger functions fire for non-owner roles despite revoked EXECUTE
-- ---------------------------------------------------------------------------
\echo '--- T3 trigger-fire privilege probe'
do $t$
begin
  create temp table t3_probe (id int, merged_into_client_id uuid, company_id uuid);
  grant all on t3_probe to anon;
  create trigger t3_trg before insert on t3_probe for each row execute function private.customer_touch_updated_at();
exception when others then raise notice 'T3 setup: %', sqlerrm; end $t$;
alter table t3_probe add column updated_at timestamptz;
set local role anon;
insert into t3_probe (id) values (1);
reset role;
select id, updated_at is not null as trigger_ran_as_anon from t3_probe;

-- ---------------------------------------------------------------------------
-- T4 OTP challenges
-- ---------------------------------------------------------------------------
\echo '--- T4 OTP send limits + attempts'
do $t$
declare
  v_digest text := '1:' || encode(sha256(('t4-'||gen_random_uuid()::text)::bytea), 'hex');
  v_fp text := encode(sha256('fp'::bytea), 'hex');
  r record; r2 record; v_id uuid; v_n int; v_state text;
begin
  select * into r from public.begin_customer_otp_challenge_as_system(v_digest, v_fp);
  raise notice 'T4 first send: allowed=% retry=% id_present=%', r.allowed, r.retry_after_seconds, r.challenge_id is not null;
  if not r.allowed or r.challenge_id is null or r.retry_after_seconds <> 60 then raise exception 'first send wrong'; end if;
  v_id := r.challenge_id;

  select * into r2 from public.begin_customer_otp_challenge_as_system(v_digest, v_fp);
  raise notice 'T4 immediate resend: allowed=% retry=% id=%', r2.allowed, r2.retry_after_seconds, r2.challenge_id;
  if r2.allowed or r2.challenge_id is not null or r2.retry_after_seconds not between 1 and 60 then raise exception '60s limit wrong'; end if;

  -- attempts: 5 failures proceed, the 6th is exhausted
  for i in 1..7 loop
    select * into r2 from public.record_customer_otp_attempt_as_system(v_id, false);
    raise notice 'T4 attempt %: attempts=% exhausted=%', i, r2.attempts, r2.exhausted;
    if i <= 5 and (r2.exhausted or r2.attempts <> i) then raise exception 'attempt % wrong', i; end if;
    if i >= 6 and not r2.exhausted then raise exception 'attempt % should be exhausted', i; end if;
  end loop;
  -- success after exhaustion is refused
  select * into r2 from public.record_customer_otp_attempt_as_system(v_id, true);
  if not r2.exhausted then raise exception 'success after exhaustion accepted'; end if;
  raise notice 'T4 success after exhaustion: exhausted=%', r2.exhausted;

  -- hour limit: backdate 4 more sends inside the hour (pass the 60s gate each time)
  update private.customer_otp_challenges set created_at = created_at - interval '50 minutes' where email_digest = v_digest;
  for i in 1..4 loop
    select * into r2 from public.begin_customer_otp_challenge_as_system(v_digest, v_fp);
    if not r2.allowed then raise exception 'send % should be allowed', i+1; end if;
    update private.customer_otp_challenges set created_at = created_at - make_interval(mins => 40 - i*5) where id = r2.challenge_id;
  end loop;
  select * into r2 from public.begin_customer_otp_challenge_as_system(v_digest, v_fp);
  raise notice 'T4 sixth send in hour: allowed=% retry=%', r2.allowed, r2.retry_after_seconds;
  if r2.allowed or r2.retry_after_seconds < 60 then raise exception 'hour limit wrong'; end if;

  -- superseded challenge returns no row; live one succeeds and consumes
  select count(*) into v_n from private.customer_otp_challenges where email_digest = v_digest and invalidated_at is not null;
  raise notice 'T4 superseded challenges: %', v_n;
  select id into v_id from private.customer_otp_challenges where email_digest = v_digest and invalidated_at is null and consumed_at is null order by created_at desc limit 1;
  select * into r2 from public.record_customer_otp_attempt_as_system(v_id, false);
  select * into r2 from public.record_customer_otp_attempt_as_system(v_id, true);
  raise notice 'T4 success consumes: attempts=% exhausted=%', r2.attempts, r2.exhausted;
  select count(*) into v_n from public.record_customer_otp_attempt_as_system(v_id, false);
  raise notice 'T4 consumed challenge rows returned: % (expect 0)', v_n;
  if v_n <> 0 then raise exception 'consumed challenge still live'; end if;
  select count(*) into v_n from public.record_customer_otp_attempt_as_system(gen_random_uuid(), false);
  if v_n <> 0 then raise exception 'unknown challenge returned rows'; end if;

  begin
    perform public.begin_customer_otp_challenge_as_system('bad', v_fp);
    raise exception 'digest shape accepted';
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '22023' then raise exception 'wrong sqlstate %', v_state; end if;
    raise notice 'T4 bad digest: % %', v_state, sqlerrm;
  end;
end $t$;

-- ---------------------------------------------------------------------------
-- T5 identities + sessions
-- ---------------------------------------------------------------------------
\echo '--- T5 identity upsert, contact conflict, sessions'
do $t$
declare
  v_subject text := gen_random_uuid()::text;
  v_subject2 text := gen_random_uuid()::text;
  v_email text := 'P1.Test+' || left(replace(gen_random_uuid()::text,'-',''), 8) || '@Example.invalid';
  r record; v_identity uuid; v_hash text := encode(sha256(('s'||gen_random_uuid()::text)::bytea),'hex');
  v_fp text := encode(sha256('fp'::bytea), 'hex'); v_session uuid; v_state text; v_n int;
begin
  select * into r from public.upsert_customer_identity_as_system(v_subject, v_email);
  raise notice 'T5 upsert #1 created=%', r.created; if not r.created then raise exception 'not created'; end if;
  v_identity := r.identity_id;
  select * into r from public.upsert_customer_identity_as_system(v_subject, v_email);
  raise notice 'T5 upsert #2 created=% same_id=%', r.created, r.identity_id = v_identity;
  if r.created or r.identity_id <> v_identity then raise exception 'upsert not idempotent'; end if;
  select normalized_value into v_email from private.customer_verified_contacts where identity_id = v_identity;
  raise notice 'T5 stored contact normalized: %', v_email;
  if v_email <> lower(v_email) then raise exception 'not normalized'; end if;

  begin
    perform public.upsert_customer_identity_as_system(v_subject2, v_email);
    raise exception 'contact conflict not raised';
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '23505' or sqlerrm !~ 'customer_contact_conflict' then raise exception 'wrong conflict % %', v_state, sqlerrm; end if;
    raise notice 'T5 contact conflict: % %', v_state, sqlerrm;
  end;
  begin
    perform public.upsert_customer_identity_as_system(v_subject2, 'not an email');
    raise exception 'bad email accepted';
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '22023' then raise exception 'wrong % ', v_state; end if;
    raise notice 'T5 invalid email: % %', v_state, sqlerrm;
  end;

  v_session := public.mint_customer_session_as_system(v_identity, v_hash, v_fp);
  select * into r from public.resolve_customer_session_as_system(v_hash);
  raise notice 'T5 resolve: status=% identity_match=% session_match=%', r.status, r.identity_id = v_identity, r.session_id = v_session;
  if r.status <> 'ok' then raise exception 'resolve not ok'; end if;
  select * into r from public.resolve_customer_session_as_system(repeat('0',64));
  raise notice 'T5 unknown: status=% ids null=%', r.status, r.identity_id is null and r.session_id is null;
  if r.status <> 'unknown' then raise exception 'unknown wrong'; end if;

  -- idle expiry slides: backdate idle, resolve -> expired
  update private.customer_sessions set idle_expires_at = statement_timestamp() - interval '1 second' where id = v_session;
  select * into r from public.resolve_customer_session_as_system(v_hash);
  raise notice 'T5 idle expired: status=%', r.status; if r.status <> 'expired' then raise exception 'expired wrong'; end if;
  update private.customer_sessions set idle_expires_at = statement_timestamp() + interval '1 day' where id = v_session;
  select * into r from public.resolve_customer_session_as_system(v_hash);
  if r.status <> 'ok' then raise exception 'should be ok again'; end if;
  -- slide check
  select idle_expires_at > statement_timestamp() + interval '6 days' into r from private.customer_sessions where id = v_session;
  raise notice 'T5 idle slid forward: %', r;
  -- absolute expiry
  update private.customer_sessions set absolute_expires_at = statement_timestamp() - interval '1 second', idle_expires_at = statement_timestamp() - interval '1 second' where id = v_session;
  select * into r from public.resolve_customer_session_as_system(v_hash);
  if r.status <> 'expired' then raise exception 'absolute expiry wrong'; end if;
  update private.customer_sessions set absolute_expires_at = statement_timestamp() + interval '30 days', idle_expires_at = statement_timestamp() + interval '7 days' where id = v_session;

  -- revoke
  if not public.revoke_customer_session_as_system(v_hash, 'user_signout') then raise exception 'revoke false'; end if;
  if public.revoke_customer_session_as_system(v_hash, 'user_signout') then raise exception 'double revoke true'; end if;
  select * into r from public.resolve_customer_session_as_system(v_hash);
  raise notice 'T5 after revoke: status=%', r.status; if r.status <> 'revoked' then raise exception 'revoked wrong'; end if;

  -- revoke all
  perform public.mint_customer_session_as_system(v_identity, encode(sha256(('a'||gen_random_uuid()::text)::bytea),'hex'), v_fp);
  perform public.mint_customer_session_as_system(v_identity, encode(sha256(('b'||gen_random_uuid()::text)::bytea),'hex'), v_fp);
  v_n := public.revoke_all_customer_sessions_as_system(v_identity, 'test');
  raise notice 'T5 revoke all count=% (expect 2)', v_n; if v_n <> 2 then raise exception 'revoke all wrong'; end if;

  -- suspended identity: mint refused, resolve revokes
  perform public.mint_customer_session_as_system(v_identity, v_hash || '', v_fp) ; -- hash reuse -> 23505 expected
  raise exception 'duplicate hash accepted';
exception when unique_violation then
  raise notice 'T5 duplicate session hash rejected: %', sqlerrm;
end $t$;

do $t$
declare v_subject text := gen_random_uuid()::text; v_identity uuid; v_hash text := encode(sha256(('c'||gen_random_uuid()::text)::bytea),'hex');
  v_fp text := encode(sha256('fp'::bytea), 'hex'); r record; v_state text;
begin
  select identity_id into v_identity from public.upsert_customer_identity_as_system(v_subject, 'susp-' || left(replace(gen_random_uuid()::text,'-',''),8) || '@example.invalid');
  perform public.mint_customer_session_as_system(v_identity, v_hash, v_fp);
  update private.customer_identities set status = 'suspended' where id = v_identity;
  select * into r from public.resolve_customer_session_as_system(v_hash);
  raise notice 'T5 suspended identity resolve: status=%', r.status; if r.status <> 'revoked' then raise exception 'suspended wrong'; end if;
  begin
    perform public.mint_customer_session_as_system(v_identity, encode(sha256(('d'||gen_random_uuid()::text)::bytea),'hex'), v_fp);
    raise exception 'mint for suspended accepted';
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '42501' then raise exception 'wrong %', v_state; end if;
    raise notice 'T5 mint for suspended: % %', v_state, sqlerrm;
  end;
end $t$;

-- ---------------------------------------------------------------------------
-- T6 membership resolution matrix (Maverick, all rows rolled back)
-- ---------------------------------------------------------------------------
\echo '--- T6 membership matrix'
do $t$
declare
  v_company uuid := 'ddee107c-33cd-483e-8278-0f8d8a180181';
  v_staff uuid := '8e811f98-9f2b-4f64-b409-ed56074b7dc8';
  v_tag text := left(replace(gen_random_uuid()::text,'-',''),8);
  v_email_zero text := 'zero-'||v_tag||'@example.invalid';
  v_email_one text := 'one-'||v_tag||'@example.invalid';
  v_email_sub text := 'sub-'||v_tag||'@example.invalid';
  v_email_many text := 'many-'||v_tag||'@example.invalid';
  v_client_one uuid; v_client_org uuid; v_sub uuid; v_client_m1 uuid; v_client_m2 uuid;
  v_id_zero uuid; v_id_one uuid; v_id_sub uuid; v_id_many uuid; v_id_nomail uuid;
  r record; v_n int; v_state text; v_txt text;
begin
  -- fixtures
  insert into public.clients (company_id, name, email) values (v_company, 'T6 One '||v_tag, upper(v_email_one)) returning id into v_client_one;
  insert into public.clients (company_id, name) values (v_company, 'T6 Org '||v_tag) returning id into v_client_org;
  insert into public.sub_clients (company_id, client_id, name, email) values (v_company, v_client_org, 'T6 Contact', v_email_sub) returning id into v_sub;
  insert into public.clients (company_id, name, email) values (v_company, 'T6 Many A '||v_tag, v_email_many) returning id into v_client_m1;
  insert into public.clients (company_id, name, email) values (v_company, 'T6 Many B '||v_tag, v_email_many) returning id into v_client_m2;

  select identity_id into v_id_zero from public.upsert_customer_identity_as_system(gen_random_uuid()::text, v_email_zero);
  select identity_id into v_id_one from public.upsert_customer_identity_as_system(gen_random_uuid()::text, v_email_one);
  select identity_id into v_id_sub from public.upsert_customer_identity_as_system(gen_random_uuid()::text, v_email_sub);
  select identity_id into v_id_many from public.upsert_customer_identity_as_system(gen_random_uuid()::text, v_email_many);

  -- 0 -> created
  select * into r from public.resolve_customer_membership_as_system(v_id_zero, v_company);
  raise notice 'T6 zero: outcome=% state=% sub=%', r.outcome, r.state, r.sub_client_id;
  if r.outcome <> 'created' or r.state <> 'active_full' then raise exception 'zero wrong'; end if;
  select name || ' / ' || email into v_txt from public.clients where id = r.client_id;
  raise notice 'T6 zero created client: %', v_txt;
  select * into r from public.resolve_customer_membership_as_system(v_id_zero, v_company);
  if r.outcome <> 'existing' then raise exception 'existing wrong'; end if;
  raise notice 'T6 zero again: outcome=%', r.outcome;

  -- 1 direct, no docs -> forward only
  select * into r from public.resolve_customer_membership_as_system(v_id_one, v_company);
  raise notice 'T6 one: outcome=% state=% client_match=% sub=%', r.outcome, r.state, r.client_id = v_client_one, r.sub_client_id;
  if r.outcome <> 'matched_forward_only' or r.state <> 'active_forward_only' or r.client_id <> v_client_one then raise exception 'one wrong'; end if;
  select evidence_kind into v_txt from private.company_client_memberships where id = r.membership_id;
  if v_txt <> 'none' then raise exception 'evidence wrong %', v_txt; end if;

  -- add a sent invoice -> promoted on next resolve
  insert into public.invoices (company_id, client_id, client_ref, status, invoice_number, due_date) values (v_company, v_client_one, v_client_one, 'sent', 'T6-'||v_tag, current_date + 30);
  select * into r from public.resolve_customer_membership_as_system(v_id_one, v_company);
  raise notice 'T6 one after sent invoice: outcome=% state=%', r.outcome, r.state;
  if r.outcome <> 'existing' or r.state <> 'active_full' then raise exception 'promotion wrong'; end if;
  select evidence_kind into v_txt from private.company_client_memberships where id = r.membership_id;
  raise notice 'T6 one evidence now: %', v_txt; if v_txt <> 'on_file_transacted' then raise exception 'evidence kind wrong'; end if;

  -- sub-client match -> parent client, forward only, sub_client carried
  select * into r from public.resolve_customer_membership_as_system(v_id_sub, v_company);
  raise notice 'T6 sub: outcome=% state=% parent_match=% sub_match=%', r.outcome, r.state, r.client_id = v_client_org, r.sub_client_id = v_sub;
  if r.outcome <> 'matched_forward_only' or r.client_id <> v_client_org or r.sub_client_id <> v_sub then raise exception 'sub wrong'; end if;
  -- staff confirm -> full
  v_txt := public.confirm_customer_membership_as_system(r.membership_id, v_staff);
  raise notice 'T6 confirm -> %', v_txt; if v_txt <> 'active_full' then raise exception 'confirm wrong'; end if;
  select evidence_kind || '/' || confirmed_by_user_id::text into v_txt from private.company_client_memberships where id = r.membership_id;
  raise notice 'T6 confirmed evidence: %', v_txt;
  -- confirm idempotent
  if public.confirm_customer_membership_as_system(r.membership_id, v_staff) <> 'active_full' then raise exception 'confirm idempotency'; end if;
  -- revoke -> true, then resolve returns revoked/existing, no new membership
  if not public.revoke_customer_membership_as_system(r.membership_id, v_staff, 'staff_revoked') then raise exception 'revoke false'; end if;
  if public.revoke_customer_membership_as_system(r.membership_id, v_staff, 'again') then raise exception 'double revoke'; end if;
  select * into r from public.resolve_customer_membership_as_system(v_id_sub, v_company);
  raise notice 'T6 after revoke: outcome=% state=%', r.outcome, r.state;
  if r.state <> 'revoked' or r.outcome <> 'existing' then raise exception 'revoked resolve wrong'; end if;
  begin
    perform public.confirm_customer_membership_as_system(r.membership_id, v_staff);
    raise exception 'confirm revoked accepted';
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
    raise notice 'T6 confirm revoked: % %', v_state, sqlerrm; if v_state <> '22023' then raise exception 'wrong'; end if;
  end;
  -- staff from another company -> 42501
  begin
    perform public.confirm_customer_membership_as_system(r.membership_id, (select id from public.users where company_id <> v_company and deleted_at is null and coalesce(is_active,false) limit 1));
    raise exception 'foreign staff accepted';
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
    raise notice 'T6 foreign staff: % %', v_state, sqlerrm; if v_state <> '42501' then raise exception 'wrong'; end if;
  end;

  -- many -> fresh client + possible duplicate + reviews + notifications
  select * into r from public.resolve_customer_membership_as_system(v_id_many, v_company);
  raise notice 'T6 many: outcome=% state=% fresh_client=%', r.outcome, r.state, r.client_id not in (v_client_m1, v_client_m2);
  if r.outcome <> 'created_possible_duplicate' or r.state <> 'active_full' then raise exception 'many wrong'; end if;
  select count(*) into v_n from public.duplicate_reviews where company_id = v_company and entity_type='client' and status='pending'
    and (entity_a_id = r.client_id or entity_b_id = r.client_id);
  raise notice 'T6 many duplicate_reviews opened: % (expect 2)', v_n; if v_n <> 2 then raise exception 'reviews wrong'; end if;
  select count(*), min(title) into v_n, v_txt from public.notifications where company_id = v_company::text and dedupe_key = 'customer_identity:possible_duplicate:' || r.client_id::text;
  raise notice 'T6 many notifications: count=% title=%', v_n, v_txt; if v_n < 1 then raise exception 'no notification'; end if;

  -- identity without a verified email -> no row
  insert into private.customer_identities (auth_subject) values (gen_random_uuid()::text) returning id into v_id_nomail;
  select count(*) into v_n from public.resolve_customer_membership_as_system(v_id_nomail, v_company);
  raise notice 'T6 no-email identity rows: % (expect 0)', v_n; if v_n <> 0 then raise exception 'no-email wrong'; end if;
  -- unknown company -> no row
  select count(*) into v_n from public.resolve_customer_membership_as_system(v_id_zero, gen_random_uuid());
  if v_n <> 0 then raise exception 'unknown company wrong'; end if;

  -- listing for client one: masked email
  for r in select * from public.list_customer_memberships_for_client_as_system(v_company, v_client_one) loop
    raise notice 'T6 list: state=% evidence=% masked=% last_seen_null=%', r.state, r.evidence_kind, r.contact_email_masked, r.last_seen_at is null;
    if r.contact_email_masked !~ '^o\*\*\*@example\.invalid$' then raise exception 'mask wrong %', r.contact_email_masked; end if;
  end loop;

  -- tenant isolation: another company resolving the same identity creates its own client, never touches Maverick rows
  select * into r from public.resolve_customer_membership_as_system(v_id_one, (select id from public.companies where id <> v_company and deleted_at is null order by created_at limit 1));
  raise notice 'T6 other company: outcome=% (expect created)', r.outcome;
  if r.outcome <> 'created' then raise exception 'isolation wrong'; end if;
end $t$;

-- ---------------------------------------------------------------------------
-- T7 merge trigger re-points memberships
-- ---------------------------------------------------------------------------
\echo '--- T7 merge trigger'
do $t$
declare
  v_company uuid := 'ddee107c-33cd-483e-8278-0f8d8a180181';
  v_tag text := left(replace(gen_random_uuid()::text,'-',''),8);
  v_loser uuid; v_winner uuid; v_loser2 uuid; v_winner2 uuid;
  v_id_a uuid; v_id_b uuid; r record; v_n int; v_txt text;
begin
  -- scenario A: loser has forward-only membership, winner has none
  insert into public.clients (company_id, name, email) values (v_company, 'T7 loser '||v_tag, 'la-'||v_tag||'@example.invalid') returning id into v_loser;
  insert into public.clients (company_id, name) values (v_company, 'T7 winner '||v_tag) returning id into v_winner;
  select identity_id into v_id_a from public.upsert_customer_identity_as_system(gen_random_uuid()::text, 'la-'||v_tag||'@example.invalid');
  select * into r from public.resolve_customer_membership_as_system(v_id_a, v_company);
  if r.client_id <> v_loser then raise exception 'setup A'; end if;
  update public.clients set deleted_at = now(), merged_into_client_id = v_winner, updated_at = now() where id = v_loser;
  select string_agg(client_id::text || ':' || state || ':' || evidence_kind || ':' || coalesce(merged_into_membership_id::text,'-'), ' | ' order by created_at)
    into v_txt from private.company_client_memberships where identity_id = v_id_a and company_id = v_company;
  raise notice 'T7 A memberships after merge: %', v_txt;
  select count(*) into v_n from private.company_client_memberships where identity_id = v_id_a and client_id = v_winner and state = 'active_forward_only';
  if v_n <> 1 then raise exception 'A winner membership missing'; end if;
  select count(*) into v_n from private.company_client_memberships where identity_id = v_id_a and client_id = v_loser and state = 'merged' and merged_into_membership_id is not null;
  if v_n <> 1 then raise exception 'A loser not merged'; end if;
  -- resolve now returns the winner
  select * into r from public.resolve_customer_membership_as_system(v_id_a, v_company);
  raise notice 'T7 A resolve after merge: outcome=% winner=%', r.outcome, r.client_id = v_winner;
  if r.client_id <> v_winner then raise exception 'A resolve wrong'; end if;

  -- scenario B: both have memberships; loser full (created_by_identity), winner forward-only -> winner promoted
  insert into public.clients (company_id, name, email) values (v_company, 'T7 loserB '||v_tag, 'lb-'||v_tag||'@example.invalid') returning id into v_loser2;
  insert into public.clients (company_id, name, email) values (v_company, 'T7 winnerB '||v_tag, 'wb-'||v_tag||'@example.invalid') returning id into v_winner2;
  select identity_id into v_id_b from public.upsert_customer_identity_as_system(gen_random_uuid()::text, 'lb-'||v_tag||'@example.invalid');
  insert into private.company_client_memberships (identity_id, company_id, client_id, state, evidence_kind) values (v_id_b, v_company, v_loser2, 'active_full', 'created_by_identity');
  insert into private.company_client_memberships (identity_id, company_id, client_id, state, evidence_kind) values (v_id_b, v_company, v_winner2, 'active_forward_only', 'none');
  update public.clients set deleted_at = now(), merged_into_client_id = v_winner2, updated_at = now() where id = v_loser2;
  select string_agg(client_id::text || ':' || state || ':' || evidence_kind, ' | ' order by created_at) into v_txt from private.company_client_memberships where identity_id = v_id_b;
  raise notice 'T7 B memberships after merge: %', v_txt;
  select count(*) into v_n from private.company_client_memberships where identity_id = v_id_b and client_id = v_winner2 and state = 'active_full' and evidence_kind = 'created_by_identity';
  if v_n <> 1 then raise exception 'B winner not promoted'; end if;
  select count(*) into v_n from private.customer_identity_events where event_type = 'membership_merged' and identity_id in (v_id_a, v_id_b);
  raise notice 'T7 merge events: % (expect 2)', v_n; if v_n <> 2 then raise exception 'events wrong'; end if;
end $t$;

-- ---------------------------------------------------------------------------
-- T8 integrations, pairwise refs, audit
-- ---------------------------------------------------------------------------
\echo '--- T8 integrations + pairwise refs + audit'
select count(*) as hosted_integrations, (select count(*) from public.companies where deleted_at is null) as live_companies from private.customer_integrations where kind='hosted_pages';
do $t$
declare v_company uuid := 'ddee107c-33cd-483e-8278-0f8d8a180181'; v_int uuid; v_int2 uuid; v_id uuid; v_ref text; v_ref2 text; v_state text; v_n int;
begin
  v_int := public.ensure_customer_hosted_integration_as_system(v_company);
  v_int2 := public.ensure_customer_hosted_integration_as_system(v_company);
  raise notice 'T8 hosted integration stable: %', v_int = v_int2; if v_int <> v_int2 then raise exception 'integration not stable'; end if;
  select identity_id into v_id from public.upsert_customer_identity_as_system(gen_random_uuid()::text, 'ref-'||left(replace(gen_random_uuid()::text,'-',''),8)||'@example.invalid');
  v_ref := public.ensure_customer_pairwise_ref_as_system(v_id, v_int);
  v_ref2 := public.ensure_customer_pairwise_ref_as_system(v_id, v_int);
  raise notice 'T8 pairwise ref: % stable=%', v_ref, v_ref = v_ref2;
  if v_ref !~ '^cr_[0-9a-f]{32}$' or v_ref <> v_ref2 then raise exception 'ref wrong'; end if;
  begin
    perform public.ensure_customer_pairwise_ref_as_system(v_id, gen_random_uuid());
    raise exception 'unknown integration accepted';
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
    raise notice 'T8 unknown integration: % %', v_state, sqlerrm; if v_state <> '22023' then raise exception 'wrong'; end if;
  end;
  -- audit: ok event
  perform public.append_customer_identity_event_as_system('otp_started', null, null, null, encode(sha256('fp'::bytea),'hex'), '{"stage":"start"}'::jsonb);
  -- audit: refused payloads
  begin
    perform public.append_customer_identity_event_as_system('otp_started', null, null, null, null, '{"token":"abc"}'::jsonb);
    raise exception 'secret key accepted';
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
    raise notice 'T8 secret key refused: % %', v_state, sqlerrm; if v_state <> '22023' then raise exception 'wrong'; end if;
  end;
  begin
    perform public.append_customer_identity_event_as_system('otp_started', null, null, null, null, '{"note":"someone@example.com"}'::jsonb);
    raise exception 'address accepted';
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
    raise notice 'T8 address refused: %', v_state; if v_state <> '22023' then raise exception 'wrong'; end if;
  end;
  begin
    perform public.append_customer_identity_event_as_system('Bad Type', null, null, null, null, '{}'::jsonb);
    raise exception 'bad type accepted';
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
    raise notice 'T8 bad type refused: %', v_state; if v_state <> '22023' then raise exception 'wrong'; end if;
  end;
  select count(*) into v_n from private.customer_identity_events;
  raise notice 'T8 events so far: %', v_n;
end $t$;

-- ---------------------------------------------------------------------------
-- T9 dormancy sweep + cron
-- ---------------------------------------------------------------------------
\echo '--- T9 dormancy sweep'
do $t$
declare
  v_company uuid := 'ddee107c-33cd-483e-8278-0f8d8a180181';
  v_tag text := left(replace(gen_random_uuid()::text,'-',''),8);
  v_id uuid; v_client_ev uuid; v_client_no uuid; r record; v_txt text; v_json jsonb;
begin
  select identity_id into v_id from public.upsert_customer_identity_as_system(gen_random_uuid()::text, 'dorm-'||v_tag||'@example.invalid');
  insert into public.clients (company_id, name, email) values (v_company, 'T9 evidence '||v_tag, 'dorm-'||v_tag||'@example.invalid') returning id into v_client_ev;
  insert into public.estimates (company_id, client_id, client_ref, status, estimate_number) values (v_company, v_client_ev, v_client_ev, 'approved', 'T9-'||v_tag);
  insert into public.clients (company_id, name) values (v_company, 'T9 no evidence '||v_tag) returning id into v_client_no;
  insert into private.company_client_memberships (identity_id, company_id, client_id, state, evidence_kind, confirmed_by_user_id, confirmed_at)
    values (v_id, v_company, v_client_ev, 'active_full', 'staff_confirmed', '8e811f98-9f2b-4f64-b409-ed56074b7dc8', now());
  insert into private.company_client_memberships (identity_id, company_id, client_id, state, evidence_kind, confirmed_by_user_id, confirmed_at)
    values (v_id, v_company, v_client_no, 'active_full', 'staff_confirmed', '8e811f98-9f2b-4f64-b409-ed56074b7dc8', now());
  -- not dormant yet: sweep is a no-op
  perform private.customer_identity_dormancy_sweep();
  select string_agg(state||':'||evidence_kind, ' | ' order by client_id = v_client_ev desc) into v_txt from private.company_client_memberships where identity_id = v_id;
  raise notice 'T9 before dormancy: %', v_txt;
  update private.customer_identities set last_seen_at = now() - interval '200 days' where id = v_id;
  v_json := private.run_customer_identity_dormancy_sweep_controlled();
  raise notice 'T9 controlled run: %', v_json;
  if coalesce(v_json ->> 'completed', 'false') <> 'true' then
    raise notice 'T9 controlled runner did not complete (lease/circuit) - running the sweep directly';
    perform private.customer_identity_dormancy_sweep();
  end if;
  select state||':'||evidence_kind into v_txt from private.company_client_memberships where identity_id = v_id and client_id = v_client_ev;
  raise notice 'T9 evidence-backed membership after sweep: % (expect active_full:on_file_transacted)', v_txt;
  if v_txt <> 'active_full:on_file_transacted' then raise exception 'retain wrong'; end if;
  select state||':'||evidence_kind||':'||coalesce(confirmed_by_user_id::text,'-') into v_txt from private.company_client_memberships where identity_id = v_id and client_id = v_client_no;
  raise notice 'T9 no-evidence membership after sweep: % (expect active_forward_only:none:-)', v_txt;
  if v_txt <> 'active_forward_only:none:-' then raise exception 'demote wrong'; end if;
  select string_agg(event_type, ',' order by id) into v_txt from private.customer_identity_events where identity_id = v_id and event_type like 'membership_d%';
  raise notice 'T9 events: %', v_txt;
end $t$;
select jobname, schedule, command, active from cron.job where jobname = 'customer_identity_dormancy_daily';

\echo '--- T10 object inventory'
select 'tables' as kind, count(*) from pg_tables where schemaname='private' and (tablename like 'customer_%' or tablename='company_client_memberships')
union all select 'as_system rpcs', count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like '%customer%_as_system'
union all select 'clients merge trigger', count(*) from pg_trigger where tgname='clients_customer_memberships_follow_merge'
union all select 'companies handle trigger', count(*) from pg_trigger where tgname='companies_assign_public_handle'
union all select 'clients_id_company_id_key', count(*) from pg_constraint where conname='clients_id_company_id_key';

\echo '=== ALL CONTRACT TESTS PASSED (rolling back) ==='
rollback;
