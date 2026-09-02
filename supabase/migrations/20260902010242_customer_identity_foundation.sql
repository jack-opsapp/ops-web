-- OPS Public API: customer identity foundation (P1).
--
-- This migration creates the storage and system RPCs behind the OPS customer
-- identity broker (design spec 2026-09-01-public-api-customer-identity-design,
-- plan 2026-09-01-public-api-identity-P1-plan, Task 2): one global customer
-- identity per dedicated-auth-project subject, verified contact channels,
-- opaque hashed broker sessions, broker-side OTP attempt accounting,
-- company-scoped client memberships with evidence-gated history access,
-- hosted-page integrations with pairwise public refs, an append-only identity
-- audit, `companies.public_handle`, a client-merge follow trigger, and the
-- daily dormancy re-gate. It creates no route and touches no staff verifier.
--
-- Security model:
--   * every table lives in the private schema with ALL table privileges
--     revoked from public, anon, authenticated, and service_role, and RLS
--     enabled with no policies; the only access paths are the owner-executed
--     SECURITY DEFINER functions below (design D8);
--   * public *_as_system RPCs are callable only by service_role and repeat an
--     auth-role check as defense in depth (the shipped wave pattern);
--   * session credentials are stored ONLY as SHA-256 hex digests and OTP
--     identifiers ONLY as keyed HMAC digests; no plaintext credential, code
--     or email address ever reaches the session or challenge tables (I6, I9);
--   * client matching consumes only channels verified on the identity (I1);
--     a match against an existing client starts forward-only and becomes full
--     only on on-file transaction evidence or staff confirmation (I2);
--   * every RPC re-reads current membership state; nothing is trusted from a
--     stale credential (I3);
--   * OTP sends are bounded per identifier (1 per 60s, 5 per hour) and
--     challenges invalidate after 5 attempts (I8);
--   * identities dormant for more than 180 days lose full history until the
--     evidence is re-evaluated (I7);
--   * the audit table is append-only: its single writer is the event RPC and
--     no role holds UPDATE or DELETE; it refuses secret-shaped payloads.


-- Fail closed if the primitives this migration composes with have drifted.
do $prerequisites$
declare
  v_signature text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'private') then
    raise exception 'customer_identity prerequisite missing: private schema';
  end if;

  foreach v_signature in array array[
    'private.agent_normalize_discovery_email(text)',
    'private.user_is_active_company_member(uuid,uuid)',
    'private.acquire_cron_workload_lease_internal(text,uuid,integer)',
    'private.complete_cron_workload_lease_internal(text,uuid,bigint,bigint,boolean,boolean,integer)',
    'private.is_cron_database_pressure_error(text,text)',
    'private.run_scheduled_cron_workload_controlled(text,integer,text)',
    'public.has_permission(uuid,text,text)',
    'public.users_with_permission(uuid,text,text)',
    'public.create_notification_if_new_with_identity(uuid,uuid,text,text,text,boolean,text,text,text,text,text)'
  ] loop
    if to_regprocedure(v_signature) is null then
      raise exception 'customer_identity prerequisite missing: %', v_signature;
    end if;
  end loop;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'clients'
      and column_name in ('id', 'company_id', 'name', 'email', 'deleted_at', 'merged_into_client_id')
    having count(distinct column_name) = 6
  ) then
    raise exception 'customer_identity prerequisite missing: public.clients columns';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sub_clients'
      and column_name in ('id', 'client_id', 'company_id', 'email', 'deleted_at')
    having count(distinct column_name) = 5
  ) then
    raise exception 'customer_identity prerequisite missing: public.sub_clients columns';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'sub_clients'
      and indexname = 'sub_clients_company_id_id_uidx'
  ) then
    raise exception 'customer_identity prerequisite missing: sub_clients (company_id, id) unique index';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'companies'
      and column_name in ('id', 'name', 'deleted_at')
    having count(distinct column_name) = 3
  ) then
    raise exception 'customer_identity prerequisite missing: public.companies columns';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'companies'
      and column_name = 'public_handle'
  ) then
    raise exception 'customer_identity prerequisite conflict: companies.public_handle already exists';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'estimates'
      and column_name in ('company_id', 'client_id', 'client_ref', 'status', 'deleted_at')
    having count(distinct column_name) = 5
  ) then
    raise exception 'customer_identity prerequisite missing: public.estimates columns';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'invoices'
      and column_name in ('company_id', 'client_id', 'client_ref', 'status', 'deleted_at')
    having count(distinct column_name) = 5
  ) then
    raise exception 'customer_identity prerequisite missing: public.invoices columns';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'duplicate_reviews'
      and column_name in ('company_id', 'entity_type', 'entity_a_id', 'entity_b_id', 'confidence', 'signals', 'status')
    having count(distinct column_name) = 7
  ) then
    raise exception 'customer_identity prerequisite missing: public.duplicate_reviews columns';
  end if;

  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'customer_identity prerequisite missing: pg_cron';
  end if;
end;
$prerequisites$;

-- ---------------------------------------------------------------------------
-- Existing-table changes
-- ---------------------------------------------------------------------------

-- Composite key target so a membership can bind an exact company-owned
-- client without any cross-tenant ambiguity.
do $clients_composite_key$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'clients_id_company_id_key'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_id_company_id_key unique (id, company_id);
  end if;
end;
$clients_composite_key$;

-- Companies are addressed by an opaque, URL-safe handle on every customer
-- surface; the UUID never crosses the boundary (I4).
alter table public.companies
  add column public_handle text;

create or replace function private.customer_public_handle_slug(
  p_name text
) returns text
language plpgsql
immutable
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  v_value text;
begin
  if p_name is null then
    return null;
  end if;
  -- NFKD splits accented letters into base letter + combining mark; the marks
  -- are dropped, everything else outside [a-z0-9] collapses to one hyphen.
  v_value := lower(normalize(p_name, NFKD));
  v_value := regexp_replace(v_value, '[\u0300-\u036f]', '', 'g');
  v_value := regexp_replace(v_value, '[^a-z0-9]+', '-', 'g');
  v_value := btrim(v_value, '-');
  if length(v_value) > 48 then
    v_value := btrim(left(v_value, 48), '-');
  end if;
  if length(v_value) < 3 then
    return null;
  end if;
  return v_value;
end;
$function$;

revoke all on function private.customer_public_handle_slug(text)
  from public, anon, authenticated, service_role;

-- Unique handle for a company: the slug of its name, then -2, -3, … on
-- collision. A handle is never reused, even by a deleted company, so a link
-- a customer keeps can never be captured by a later tenant.
create or replace function private.customer_next_public_handle(
  p_name text,
  p_company_id uuid
) returns text
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_base text;
  v_candidate text;
  v_suffix text;
  v_n integer := 1;
begin
  perform pg_advisory_xact_lock(hashtext('customer_public_handle'));
  v_base := coalesce(private.customer_public_handle_slug(p_name), 'company');
  loop
    if v_n = 1 then
      v_candidate := v_base;
    else
      v_suffix := '-' || v_n::text;
      v_candidate := btrim(left(v_base, 48 - length(v_suffix)), '-') || v_suffix;
    end if;
    exit when not exists (
      select 1
      from public.companies company
      where company.public_handle = v_candidate
        and company.id is distinct from p_company_id
    );
    v_n := v_n + 1;
    if v_n > 100000 then
      raise exception 'customer_public_handle_exhausted' using errcode = '55000';
    end if;
  end loop;
  return v_candidate;
end;
$function$;

revoke all on function private.customer_next_public_handle(text, uuid)
  from public, anon, authenticated, service_role;

do $backfill_public_handles$
declare
  v_company record;
begin
  for v_company in
    select company.id, company.name
    from public.companies company
    order by company.created_at nulls last, company.id
  loop
    update public.companies company
    set public_handle = private.customer_next_public_handle(v_company.name, v_company.id)
    where company.id = v_company.id;
  end loop;
end;
$backfill_public_handles$;

alter table public.companies
  alter column public_handle set not null;

alter table public.companies
  add constraint companies_public_handle_shape check (
    public_handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    and length(public_handle) between 3 and 48
  );

create unique index companies_public_handle_key
  on public.companies (public_handle);

-- New companies receive a handle at creation with no caller involvement.
create or replace function private.customer_assign_company_public_handle()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if new.public_handle is null then
    new.public_handle := private.customer_next_public_handle(new.name, new.id);
  end if;
  return new;
end;
$function$;

revoke all on function private.customer_assign_company_public_handle()
  from public, anon, authenticated, service_role;

create trigger companies_assign_public_handle
  before insert on public.companies
  for each row
  execute function private.customer_assign_company_public_handle();

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create or replace function private.customer_touch_updated_at()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'pg_temp'
as $function$
begin
  new.updated_at := statement_timestamp();
  return new;
end;
$function$;

revoke all on function private.customer_touch_updated_at()
  from public, anon, authenticated, service_role;

create table if not exists private.customer_identities (
  id uuid primary key default gen_random_uuid(),
  auth_subject text not null
    constraint customer_identities_auth_subject_shape check (
      auth_subject ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ),
  status text not null default 'active'
    constraint customer_identities_status check (
      status in ('active', 'suspended', 'erased')
    ),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  last_seen_at timestamptz not null default statement_timestamp(),
  erased_at timestamptz,
  constraint customer_identities_auth_subject_key unique (auth_subject),
  constraint customer_identities_erased_shape check (
    (status = 'erased') = (erased_at is not null)
  )
);

alter table private.customer_identities enable row level security;
revoke all on table private.customer_identities
  from public, anon, authenticated, service_role;

create trigger customer_identities_touch_updated_at
  before update on private.customer_identities
  for each row
  execute function private.customer_touch_updated_at();

create table if not exists private.customer_verified_contacts (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null
    references private.customer_identities (id) on delete cascade,
  channel text not null
    constraint customer_verified_contacts_channel check (
      channel in ('email', 'phone')
    ),
  normalized_value text not null
    constraint customer_verified_contacts_value_bounded check (
      length(normalized_value) between 3 and 200
    ),
  verification_source text not null
    constraint customer_verified_contacts_source check (
      verification_source in ('otp', 'guest_claim', 'staff_attestation')
    ),
  verified_at timestamptz not null default statement_timestamp(),
  revoked_at timestamptz,
  revoked_reason text
    constraint customer_verified_contacts_revoked_reason_bounded check (
      revoked_reason is null or length(revoked_reason) between 1 and 200
    ),
  created_at timestamptz not null default statement_timestamp(),
  constraint customer_verified_contacts_revoked_shape check (
    (revoked_at is null) = (revoked_reason is null)
  )
);

-- A live verified channel value belongs to exactly one identity.
create unique index if not exists customer_verified_contacts_one_live_owner
  on private.customer_verified_contacts (channel, normalized_value)
  where revoked_at is null;
create index if not exists customer_verified_contacts_by_identity
  on private.customer_verified_contacts (identity_id, channel)
  where revoked_at is null;

alter table private.customer_verified_contacts enable row level security;
revoke all on table private.customer_verified_contacts
  from public, anon, authenticated, service_role;

create table if not exists private.customer_sessions (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null
    references private.customer_identities (id) on delete cascade,
  session_hash text not null
    constraint customer_sessions_hash_shape check (session_hash ~ '^[0-9a-f]{64}$'),
  network_fingerprint text not null
    constraint customer_sessions_fingerprint_shape check (
      network_fingerprint ~ '^[0-9a-f]{64}$'
    ),
  created_at timestamptz not null default statement_timestamp(),
  last_seen_at timestamptz not null default statement_timestamp(),
  absolute_expires_at timestamptz not null,
  idle_expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_reason text
    constraint customer_sessions_revoked_reason_bounded check (
      revoked_reason is null or length(revoked_reason) between 1 and 200
    ),
  constraint customer_sessions_hash_key unique (session_hash),
  constraint customer_sessions_expiry_order check (
    idle_expires_at <= absolute_expires_at
  ),
  constraint customer_sessions_revoked_shape check (
    (revoked_at is null) = (revoked_reason is null)
  )
);

create index if not exists customer_sessions_live_by_identity
  on private.customer_sessions (identity_id)
  where revoked_at is null;

alter table private.customer_sessions enable row level security;
revoke all on table private.customer_sessions
  from public, anon, authenticated, service_role;

-- Broker-side OTP accounting. The customer auth project issues and checks the
-- code; this table only counts sends and attempts so the broker can refuse
-- before proxying (I8). email_digest is the broker's keyed HMAC, labelled
-- with its key id; the address itself is never stored here.
create table if not exists private.customer_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  email_digest text not null
    constraint customer_otp_challenges_digest_shape check (
      email_digest ~ '^[1-9][0-9]{0,4}:[0-9a-f]{64}$'
    ),
  network_fingerprint text not null
    constraint customer_otp_challenges_fingerprint_shape check (
      network_fingerprint ~ '^[0-9a-f]{64}$'
    ),
  attempts integer not null default 0
    constraint customer_otp_challenges_attempts_nonnegative check (attempts >= 0),
  max_attempts integer not null default 5
    constraint customer_otp_challenges_max_attempts_bounded check (
      max_attempts between 1 and 10
    ),
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  exhausted_at timestamptz,
  invalidated_at timestamptz
);

create index if not exists customer_otp_challenges_by_digest_recency
  on private.customer_otp_challenges (email_digest, created_at desc);

alter table private.customer_otp_challenges enable row level security;
revoke all on table private.customer_otp_challenges
  from public, anon, authenticated, service_role;

create table if not exists private.company_client_memberships (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null
    references private.customer_identities (id) on delete cascade,
  company_id uuid not null
    references public.companies (id) on delete cascade,
  client_id uuid not null,
  sub_client_id uuid,
  state text not null
    constraint company_client_memberships_state check (
      state in ('active_forward_only', 'active_full', 'revoked', 'merged')
    ),
  evidence_kind text not null default 'none'
    constraint company_client_memberships_evidence_kind check (
      evidence_kind in (
        'none',
        'created_by_identity',
        'on_file_transacted',
        'staff_confirmed',
        'guest_claim'
      )
    ),
  confirmed_by_user_id uuid,
  confirmed_at timestamptz,
  revoked_by_user_id uuid,
  revoked_at timestamptz,
  revoked_reason text
    constraint company_client_memberships_revoked_reason_bounded check (
      revoked_reason is null or length(revoked_reason) between 1 and 200
    ),
  merged_into_membership_id uuid
    references private.company_client_memberships (id),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint company_client_memberships_client_fkey
    foreign key (client_id, company_id)
    references public.clients (id, company_id) on delete cascade,
  constraint company_client_memberships_sub_client_fkey
    foreign key (company_id, sub_client_id)
    references public.sub_clients (company_id, id) on delete set null,
  -- Live states carry no revocation and no merge pointer; revoked rows carry
  -- a revocation; merged rows point at their successor.
  constraint company_client_memberships_state_shape check (
    (
      state in ('active_forward_only', 'active_full')
      and revoked_at is null
      and merged_into_membership_id is null
    )
    or (
      state = 'revoked'
      and revoked_at is not null
      and merged_into_membership_id is null
    )
    or (
      state = 'merged'
      and merged_into_membership_id is not null
    )
  ),
  -- Full history requires evidence; forward-only means none is on record.
  constraint company_client_memberships_evidence_shape check (
    (state <> 'active_full' or evidence_kind <> 'none')
    and (state <> 'active_forward_only' or evidence_kind = 'none')
    and (evidence_kind <> 'staff_confirmed' or confirmed_by_user_id is not null)
  ),
  constraint company_client_memberships_revoked_shape check (
    (revoked_at is null) = (revoked_reason is null)
  )
);

create unique index if not exists company_client_memberships_one_live_per_binding
  on private.company_client_memberships (identity_id, company_id, client_id)
  where state in ('active_forward_only', 'active_full');
create index if not exists company_client_memberships_by_identity_company
  on private.company_client_memberships (identity_id, company_id, created_at desc);
create index if not exists company_client_memberships_by_client
  on private.company_client_memberships (company_id, client_id, created_at);

alter table private.company_client_memberships enable row level security;
revoke all on table private.company_client_memberships
  from public, anon, authenticated, service_role;

create trigger company_client_memberships_touch_updated_at
  before update on private.company_client_memberships
  for each row
  execute function private.customer_touch_updated_at();

-- One row per company-website connection. P1 ships hosted_pages only; the
-- kinds below reserve the credential and OAuth classes for P4 and P6.
create table if not exists private.customer_integrations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.companies (id) on delete cascade,
  public_handle text not null
    constraint customer_integrations_public_handle_shape check (
      public_handle ~ '^ci_[0-9a-f]{32}$'
    ),
  kind text not null
    constraint customer_integrations_kind check (
      kind in ('hosted_pages', 'server_credential', 'oauth_client')
    ),
  allowed_origins text[] not null default array[]::text[]
    constraint customer_integrations_allowed_origins_bounded check (
      cardinality(allowed_origins) <= 16
    ),
  status text not null default 'active'
    constraint customer_integrations_status check (
      status in ('active', 'disabled')
    ),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  disabled_at timestamptz,
  constraint customer_integrations_public_handle_key unique (public_handle),
  constraint customer_integrations_status_shape check (
    (status = 'disabled') = (disabled_at is not null)
  )
);

create unique index if not exists customer_integrations_one_hosted_per_company
  on private.customer_integrations (company_id)
  where kind = 'hosted_pages';

alter table private.customer_integrations enable row level security;
revoke all on table private.customer_integrations
  from public, anon, authenticated, service_role;

create trigger customer_integrations_touch_updated_at
  before update on private.customer_integrations
  for each row
  execute function private.customer_touch_updated_at();

create table if not exists private.customer_pairwise_refs (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null
    references private.customer_identities (id) on delete cascade,
  integration_id uuid not null
    references private.customer_integrations (id) on delete cascade,
  public_ref text not null
    constraint customer_pairwise_refs_public_ref_shape check (
      public_ref ~ '^cr_[0-9a-f]{32}$'
    ),
  created_at timestamptz not null default statement_timestamp(),
  constraint customer_pairwise_refs_binding_key unique (identity_id, integration_id),
  constraint customer_pairwise_refs_public_ref_key unique (public_ref)
);

alter table private.customer_pairwise_refs enable row level security;
revoke all on table private.customer_pairwise_refs
  from public, anon, authenticated, service_role;

-- Append-only audit. No foreign keys: an event outlives the rows it names.
create table if not exists private.customer_identity_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default statement_timestamp(),
  event_type text not null
    constraint customer_identity_events_type_shape check (
      event_type ~ '^[a-z][a-z0-9_]{2,63}$'
    ),
  identity_id uuid,
  company_id uuid,
  session_id uuid,
  membership_id uuid,
  network_fingerprint text
    constraint customer_identity_events_fingerprint_shape check (
      network_fingerprint is null or network_fingerprint ~ '^[0-9a-f]{64}$'
    ),
  metadata jsonb not null default '{}'::jsonb
    constraint customer_identity_events_metadata_object check (
      jsonb_typeof(metadata) = 'object'
    ),
  -- Never a code, token, session value or address (design §4).
  constraint customer_identity_events_metadata_no_secrets check (
    not (metadata ?| array[
      'code', 'token', 'secret', 'credential', 'password', 'hash',
      'cookie', 'session_value', 'email', 'phone'
    ])
    and metadata::text !~ '(ops_cs_|ops_mcp_|eyJ[A-Za-z0-9_-]{10,})'
    and metadata::text !~ '"[0-9]{6}"'
    and metadata::text !~ '"[0-9a-f]{64}"'
    and metadata::text !~ '@'
  )
);

create index if not exists customer_identity_events_by_identity
  on private.customer_identity_events (identity_id, occurred_at desc)
  where identity_id is not null;

alter table private.customer_identity_events enable row level security;
revoke all on table private.customer_identity_events
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Definer-internal helpers (never exposed)
-- ---------------------------------------------------------------------------

create or replace function private.customer_record_identity_event(
  p_event_type text,
  p_identity_id uuid,
  p_company_id uuid,
  p_session_id uuid,
  p_membership_id uuid,
  p_network_fingerprint text,
  p_metadata jsonb
) returns bigint
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'private', 'pg_temp'
as $function$
declare
  v_event_id bigint;
begin
  if p_event_type is null or p_event_type !~ '^[a-z][a-z0-9_]{2,63}$' then
    raise exception 'customer_identity_event_invalid' using errcode = '22023';
  end if;
  if p_metadata is not null and jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'customer_identity_event_invalid' using errcode = '22023';
  end if;
  if p_network_fingerprint is not null
     and p_network_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'customer_identity_event_invalid' using errcode = '22023';
  end if;

  insert into private.customer_identity_events (
    event_type,
    identity_id,
    company_id,
    session_id,
    membership_id,
    network_fingerprint,
    metadata
  ) values (
    p_event_type,
    p_identity_id,
    p_company_id,
    p_session_id,
    p_membership_id,
    p_network_fingerprint,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_event_id;

  return v_event_id;
exception
  when check_violation then
    raise exception 'customer_identity_event_invalid' using errcode = '22023';
end;
$function$;

revoke all on function private.customer_record_identity_event(
  text, uuid, uuid, uuid, uuid, text, jsonb
) from public, anon, authenticated, service_role;

-- First character of the mailbox plus the domain; never the mailbox.
create or replace function private.customer_mask_email(
  p_email text
) returns text
language sql
immutable
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  select case
    when p_email is null or position('@' in p_email) < 2 then '***'
    else left(p_email, 1) || '***@' || split_part(p_email, '@', 2)
  end;
$function$;

revoke all on function private.customer_mask_email(text)
  from public, anon, authenticated, service_role;

-- I2 evidence: the client's on-file email equals the verified email AND the
-- company has sent, approved, or been paid on a document for that client.
create or replace function private.customer_membership_evidence(
  p_company_id uuid,
  p_client_id uuid,
  p_normalized_email text
) returns text
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select case
    when p_normalized_email is not null
      and exists (
        select 1
        from public.clients client
        where client.id = p_client_id
          and client.company_id = p_company_id
          and client.deleted_at is null
          and private.agent_normalize_discovery_email(client.email) = p_normalized_email
      )
      and (
        exists (
          select 1
          from public.estimates estimate
          where estimate.company_id = p_company_id
            and (estimate.client_ref = p_client_id or estimate.client_id = p_client_id)
            and estimate.deleted_at is null
            and estimate.status in ('sent', 'viewed', 'approved', 'changes_requested', 'converted')
        )
        or exists (
          select 1
          from public.invoices invoice
          where invoice.company_id = p_company_id
            and (invoice.client_ref = p_client_id or invoice.client_id = p_client_id)
            and invoice.deleted_at is null
            and invoice.status in ('sent', 'awaiting_payment', 'partially_paid', 'past_due', 'paid')
        )
      )
    then 'on_file_transacted'
    else 'none'
  end;
$function$;

revoke all on function private.customer_membership_evidence(uuid, uuid, text)
  from public, anon, authenticated, service_role;

-- Strongest on-file evidence across every live verified email of an identity.
create or replace function private.customer_identity_evidence_for_client(
  p_identity_id uuid,
  p_company_id uuid,
  p_client_id uuid
) returns text
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select coalesce(
    (
      select 'on_file_transacted'
      from private.customer_verified_contacts contact
      where contact.identity_id = p_identity_id
        and contact.channel = 'email'
        and contact.revoked_at is null
        and private.customer_membership_evidence(
          p_company_id, p_client_id, contact.normalized_value
        ) = 'on_file_transacted'
      limit 1
    ),
    'none'
  );
$function$;

revoke all on function private.customer_identity_evidence_for_client(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.customer_prune_expired_artifacts()
returns void
language sql
volatile
security definer
set search_path to 'pg_catalog', 'private', 'pg_temp'
as $function$
  with pruned_challenges as (
    delete from private.customer_otp_challenges
    where expires_at < statement_timestamp() - interval '1 day'
    returning 1
  )
  delete from private.customer_sessions
  where absolute_expires_at < statement_timestamp() - interval '30 days';
$function$;

revoke all on function private.customer_prune_expired_artifacts()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- OTP challenges (I8)
-- ---------------------------------------------------------------------------

create or replace function public.begin_customer_otp_challenge_as_system(
  p_email_digest text,
  p_network_fingerprint text
) returns table (
  challenge_id uuid,
  allowed boolean,
  retry_after_seconds integer
)
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_now timestamptz := statement_timestamp();
  v_last_send_at timestamptz;
  v_window_anchor_at timestamptz;
  v_challenge_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_email_digest is null or p_email_digest !~ '^[1-9][0-9]{0,4}:[0-9a-f]{64}$' then
    raise exception 'customer_otp_digest_invalid' using errcode = '22023';
  end if;
  if p_network_fingerprint is null or p_network_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'customer_network_fingerprint_invalid' using errcode = '22023';
  end if;

  -- Serialize per identifier so two concurrent starts cannot both pass the
  -- send limits.
  perform pg_advisory_xact_lock(hashtext('customer_otp:' || p_email_digest));

  select max(challenge.created_at)
  into v_last_send_at
  from private.customer_otp_challenges challenge
  where challenge.email_digest = p_email_digest;

  -- 1 send per identifier per 60 seconds.
  if v_last_send_at is not null and v_last_send_at > v_now - interval '60 seconds' then
    return query select
      null::uuid,
      false,
      greatest(1, ceil(extract(epoch from (v_last_send_at + interval '60 seconds' - v_now)))::integer);
    return;
  end if;

  -- 5 sends per identifier per hour: the fifth-most-recent send within the
  -- window anchors when the next one becomes possible.
  select challenge.created_at
  into v_window_anchor_at
  from private.customer_otp_challenges challenge
  where challenge.email_digest = p_email_digest
    and challenge.created_at > v_now - interval '1 hour'
  order by challenge.created_at desc
  offset 4
  limit 1;

  if v_window_anchor_at is not null then
    return query select
      null::uuid,
      false,
      greatest(1, ceil(extract(epoch from (v_window_anchor_at + interval '1 hour' - v_now)))::integer);
    return;
  end if;

  -- A new code supersedes every open challenge for this identifier, matching
  -- the auth project, which invalidates the previous code on re-send.
  update private.customer_otp_challenges challenge
  set invalidated_at = v_now
  where challenge.email_digest = p_email_digest
    and challenge.consumed_at is null
    and challenge.invalidated_at is null
    and challenge.expires_at > v_now;

  insert into private.customer_otp_challenges (
    email_digest,
    network_fingerprint,
    expires_at
  ) values (
    p_email_digest,
    p_network_fingerprint,
    v_now + interval '10 minutes'
  )
  returning id into v_challenge_id;

  perform private.customer_prune_expired_artifacts();

  return query select v_challenge_id, true, 60;
end;
$function$;

revoke all on function public.begin_customer_otp_challenge_as_system(text, text)
  from public, anon, authenticated;
grant execute on function public.begin_customer_otp_challenge_as_system(text, text)
  to service_role;

-- Returns no row for a challenge that is unknown, consumed, superseded or
-- expired; the broker refuses uniformly. A failed attempt is charged before
-- the code is proxied; the sixth attempt and every later one report
-- exhausted. A success consumes the challenge.
create or replace function public.record_customer_otp_attempt_as_system(
  p_challenge_id uuid,
  p_success boolean
) returns table (
  attempts integer,
  exhausted boolean
)
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_now timestamptz := statement_timestamp();
  v_challenge private.customer_otp_challenges%rowtype;
  v_attempts integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_challenge_id is null or p_success is null then
    raise exception 'customer_otp_attempt_invalid' using errcode = '22023';
  end if;

  select challenge.*
  into v_challenge
  from private.customer_otp_challenges challenge
  where challenge.id = p_challenge_id
  for update;

  if not found
     or v_challenge.consumed_at is not null
     or v_challenge.invalidated_at is not null
     or v_challenge.expires_at <= v_now then
    return;
  end if;

  if p_success then
    if v_challenge.attempts > v_challenge.max_attempts then
      return query select v_challenge.attempts, true;
      return;
    end if;
    update private.customer_otp_challenges challenge
    set consumed_at = v_now
    where challenge.id = p_challenge_id;
    return query select v_challenge.attempts, false;
    return;
  end if;

  update private.customer_otp_challenges challenge
  set attempts = challenge.attempts + 1,
      exhausted_at = case
        when challenge.attempts + 1 > challenge.max_attempts
          then coalesce(challenge.exhausted_at, v_now)
        else challenge.exhausted_at
      end
  where challenge.id = p_challenge_id
  returning challenge.attempts into v_attempts;

  return query select v_attempts, v_attempts > v_challenge.max_attempts;
end;
$function$;

revoke all on function public.record_customer_otp_attempt_as_system(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.record_customer_otp_attempt_as_system(uuid, boolean)
  to service_role;

-- ---------------------------------------------------------------------------
-- Identities
-- ---------------------------------------------------------------------------

-- Upserts the global identity by auth subject and records the verified email.
-- A live email owned by another identity raises customer_contact_conflict
-- (23505): a contact is never silently moved between identities.
create or replace function public.upsert_customer_identity_as_system(
  p_auth_subject text,
  p_email text
) returns table (
  identity_id uuid,
  created boolean
)
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_now timestamptz := statement_timestamp();
  v_email text;
  v_identity private.customer_identities%rowtype;
  v_created boolean := false;
  v_contact_owner uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_auth_subject is null
     or p_auth_subject !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'customer_auth_subject_invalid' using errcode = '22023';
  end if;
  v_email := private.agent_normalize_discovery_email(p_email);
  if v_email is null then
    raise exception 'customer_email_invalid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('customer_identity:' || p_auth_subject));
  perform pg_advisory_xact_lock(hashtext('customer_contact:email:' || v_email));

  select identity.*
  into v_identity
  from private.customer_identities identity
  where identity.auth_subject = p_auth_subject
  for update;

  if not found then
    insert into private.customer_identities (auth_subject)
    values (p_auth_subject)
    returning * into v_identity;
    v_created := true;
  elsif v_identity.status <> 'active' then
    raise exception 'customer_identity_unavailable' using errcode = '42501';
  end if;

  select contact.identity_id
  into v_contact_owner
  from private.customer_verified_contacts contact
  where contact.channel = 'email'
    and contact.normalized_value = v_email
    and contact.revoked_at is null;

  if v_contact_owner is null then
    insert into private.customer_verified_contacts (
      identity_id,
      channel,
      normalized_value,
      verification_source
    ) values (
      v_identity.id,
      'email',
      v_email,
      'otp'
    );
  elsif v_contact_owner <> v_identity.id then
    raise exception 'customer_contact_conflict' using errcode = '23505';
  end if;

  update private.customer_identities identity
  set last_seen_at = v_now
  where identity.id = v_identity.id;

  return query select v_identity.id, v_created;
end;
$function$;

revoke all on function public.upsert_customer_identity_as_system(text, text)
  from public, anon, authenticated;
grant execute on function public.upsert_customer_identity_as_system(text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Sessions (I6)
-- ---------------------------------------------------------------------------

create or replace function public.mint_customer_session_as_system(
  p_identity_id uuid,
  p_session_hash text,
  p_network_fingerprint text
) returns uuid
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_now timestamptz := statement_timestamp();
  v_session_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'customer_session_hash_invalid' using errcode = '22023';
  end if;
  if p_network_fingerprint is null or p_network_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'customer_network_fingerprint_invalid' using errcode = '22023';
  end if;
  if p_identity_id is null or not exists (
    select 1
    from private.customer_identities identity
    where identity.id = p_identity_id
      and identity.status = 'active'
  ) then
    raise exception 'customer_identity_unavailable' using errcode = '42501';
  end if;

  insert into private.customer_sessions (
    identity_id,
    session_hash,
    network_fingerprint,
    absolute_expires_at,
    idle_expires_at
  ) values (
    p_identity_id,
    p_session_hash,
    p_network_fingerprint,
    v_now + interval '30 days',
    v_now + interval '7 days'
  )
  returning id into v_session_id;

  perform private.customer_prune_expired_artifacts();

  return v_session_id;
end;
$function$;

revoke all on function public.mint_customer_session_as_system(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.mint_customer_session_as_system(uuid, text, text)
  to service_role;

-- Always exactly one row. `ok` slides the idle expiry and stamps the identity
-- as seen (I7); every other status carries the ids it could find so the
-- broker can attribute the outcome without ever treating it as live.
create or replace function public.resolve_customer_session_as_system(
  p_session_hash text
) returns table (
  identity_id uuid,
  session_id uuid,
  status text
)
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_now timestamptz := statement_timestamp();
  v_session record;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$' then
    return query select null::uuid, null::uuid, 'unknown'::text;
    return;
  end if;

  select
    session.id,
    session.identity_id,
    session.absolute_expires_at,
    session.idle_expires_at,
    session.revoked_at,
    identity.status as identity_status
  into v_session
  from private.customer_sessions session
  join private.customer_identities identity on identity.id = session.identity_id
  where session.session_hash = p_session_hash
  for update of session;

  if not found then
    return query select null::uuid, null::uuid, 'unknown'::text;
    return;
  end if;

  if v_session.revoked_at is not null then
    return query select v_session.identity_id, v_session.id, 'revoked'::text;
    return;
  end if;

  if v_session.identity_status <> 'active' then
    update private.customer_sessions session
    set revoked_at = v_now,
        revoked_reason = 'identity_' || v_session.identity_status
    where session.id = v_session.id;
    return query select v_session.identity_id, v_session.id, 'revoked'::text;
    return;
  end if;

  if v_session.absolute_expires_at <= v_now or v_session.idle_expires_at <= v_now then
    return query select v_session.identity_id, v_session.id, 'expired'::text;
    return;
  end if;

  update private.customer_sessions session
  set last_seen_at = v_now,
      idle_expires_at = least(v_now + interval '7 days', session.absolute_expires_at)
  where session.id = v_session.id;

  update private.customer_identities identity
  set last_seen_at = v_now
  where identity.id = v_session.identity_id;

  return query select v_session.identity_id, v_session.id, 'ok'::text;
end;
$function$;

revoke all on function public.resolve_customer_session_as_system(text)
  from public, anon, authenticated;
grant execute on function public.resolve_customer_session_as_system(text)
  to service_role;

create or replace function public.revoke_customer_session_as_system(
  p_session_hash text,
  p_reason text
) returns boolean
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if v_reason is null or length(v_reason) > 200 then
    raise exception 'customer_session_reason_invalid' using errcode = '22023';
  end if;
  if p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  update private.customer_sessions session
  set revoked_at = statement_timestamp(),
      revoked_reason = v_reason
  where session.session_hash = p_session_hash
    and session.revoked_at is null;

  return found;
end;
$function$;

revoke all on function public.revoke_customer_session_as_system(text, text)
  from public, anon, authenticated;
grant execute on function public.revoke_customer_session_as_system(text, text)
  to service_role;

create or replace function public.revoke_all_customer_sessions_as_system(
  p_identity_id uuid,
  p_reason text
) returns integer
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if v_reason is null or length(v_reason) > 200 then
    raise exception 'customer_session_reason_invalid' using errcode = '22023';
  end if;
  if p_identity_id is null then
    return 0;
  end if;

  update private.customer_sessions session
  set revoked_at = statement_timestamp(),
      revoked_reason = v_reason
  where session.identity_id = p_identity_id
    and session.revoked_at is null;
  get diagnostics v_count = row_count;

  return v_count;
end;
$function$;

revoke all on function public.revoke_all_customer_sessions_as_system(uuid, text)
  from public, anon, authenticated;
grant execute on function public.revoke_all_customer_sessions_as_system(uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Memberships (design §5.3, I1, I2, D6)
-- ---------------------------------------------------------------------------

-- Company-scoped resolution for an identity. Returns no row when the identity
-- or company is unavailable, or when the identity has no verified email to
-- match with. Otherwise:
--   existing                    a live (or revoked) membership already binds
--                               this identity to this company; forward-only
--                               rows are re-checked for on-file evidence;
--   matched_full                exactly one live client matched a verified
--                               email and on-file transaction evidence exists;
--   matched_forward_only        exactly one live client matched, no evidence;
--   created                     no client matched; a new client was created
--                               and is the identity's own record;
--   created_possible_duplicate  more than one client matched; a fresh client
--                               was created, duplicate reviews were opened and
--                               staff were notified.
create or replace function public.resolve_customer_membership_as_system(
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
  v_now timestamptz := statement_timestamp();
  v_identity private.customer_identities%rowtype;
  v_membership private.company_client_memberships%rowtype;
  v_emails text[];
  v_email text;
  v_candidate_client_ids uuid[];
  v_candidate_client_id uuid;
  v_client_id uuid;
  v_sub_client_id uuid;
  v_evidence text;
  v_state text;
  v_outcome text;
  v_membership_id uuid;
  v_event_type text;
  v_staff_user_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_identity_id is null or p_company_id is null then
    raise exception 'customer_membership_input_invalid' using errcode = '22023';
  end if;

  select identity.*
  into v_identity
  from private.customer_identities identity
  where identity.id = p_identity_id;
  if not found or v_identity.status <> 'active' then
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

  -- Verified channels only (I1); phones are stored, never matched, in V1.
  select array_agg(contact.normalized_value order by contact.normalized_value)
  into v_emails
  from private.customer_verified_contacts contact
  where contact.identity_id = p_identity_id
    and contact.channel = 'email'
    and contact.revoked_at is null;

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
      v_membership.state, 'existing'::text;
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
      v_membership.state, 'existing'::text;
    return;
  end if;

  if v_emails is null then
    return;
  end if;

  -- Live clients matched directly or through one live contact (sub-client);
  -- soft-deleted and merged-away rows never match.
  select array_agg(distinct matched.client_id)
  into v_candidate_client_ids
  from (
    select client.id as client_id
    from public.clients client
    where client.company_id = p_company_id
      and client.deleted_at is null
      and client.merged_into_client_id is null
      and private.agent_normalize_discovery_email(client.email) = any (v_emails)
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
      and private.agent_normalize_discovery_email(sub_client.email) = any (v_emails)
  ) matched;

  if cardinality(coalesce(v_candidate_client_ids, array[]::uuid[])) = 1 then
    v_client_id := v_candidate_client_ids[1];
    -- Prefer the client's own email over a contact's; carry the contact for
    -- attribution when it was the match (D5).
    select sub_client.id
    into v_sub_client_id
    from public.sub_clients sub_client
    where sub_client.company_id = p_company_id
      and sub_client.client_id = v_client_id
      and sub_client.deleted_at is null
      and private.agent_normalize_discovery_email(sub_client.email) = any (v_emails)
      and not exists (
        select 1
        from public.clients client
        where client.id = v_client_id
          and private.agent_normalize_discovery_email(client.email) = any (v_emails)
      )
    order by sub_client.created_at, sub_client.id
    limit 1;

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
    v_event_type := 'membership_matched';
  else
    -- Zero or many: the lead always gets a client (D6). The identity's own
    -- new record is fully theirs from the start.
    insert into public.clients (company_id, name, email)
    values (p_company_id, v_emails[1], v_emails[1])
    returning id into v_client_id;
    v_sub_client_id := null;
    v_state := 'active_full';
    v_evidence := 'created_by_identity';
    if cardinality(coalesce(v_candidate_client_ids, array[]::uuid[])) = 0 then
      v_outcome := 'created';
      v_event_type := 'membership_created';
    else
      v_outcome := 'created_possible_duplicate';
      v_event_type := 'membership_created_possible_duplicate';
    end if;
  end if;

  insert into private.company_client_memberships (
    identity_id,
    company_id,
    client_id,
    sub_client_id,
    state,
    evidence_kind
  ) values (
    p_identity_id,
    p_company_id,
    v_client_id,
    v_sub_client_id,
    v_state,
    v_evidence
  )
  returning id into v_membership_id;

  perform private.customer_record_identity_event(
    v_event_type, p_identity_id, p_company_id, null, v_membership_id, null,
    jsonb_build_object(
      'state', v_state,
      'evidence_kind', v_evidence,
      'candidate_clients', cardinality(coalesce(v_candidate_client_ids, array[]::uuid[])),
      'via_sub_client', v_sub_client_id is not null
    )
  );

  if v_outcome = 'created_possible_duplicate' then
    -- Open a review against each candidate so the existing merge flow resolves
    -- it; the merge re-points memberships through the follow trigger below.
    foreach v_candidate_client_id in array v_candidate_client_ids loop
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
    v_membership_id, v_client_id, v_sub_client_id, v_state, v_outcome;
end;
$function$;

revoke all on function public.resolve_customer_membership_as_system(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_customer_membership_as_system(uuid, uuid)
  to service_role;

-- Staff confirm (I2 b). The staff user must be an active member of the
-- membership's company holding clients.edit at any scope.
create or replace function public.confirm_customer_membership_as_system(
  p_membership_id uuid,
  p_staff_user_id uuid
) returns text
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_membership private.company_client_memberships%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_membership_id is null or p_staff_user_id is null then
    raise exception 'customer_membership_input_invalid' using errcode = '22023';
  end if;

  select member.*
  into v_membership
  from private.company_client_memberships member
  where member.id = p_membership_id
  for update;
  if not found then
    raise exception 'customer_membership_not_found' using errcode = 'P0002';
  end if;

  if not private.user_is_active_company_member(p_staff_user_id, v_membership.company_id)
     or not public.has_permission(p_staff_user_id, 'clients.edit', 'own') then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if v_membership.state = 'active_full' then
    return v_membership.state;
  end if;
  if v_membership.state = 'merged' then
    raise exception 'customer_membership_merged' using errcode = '22023';
  end if;
  if v_membership.state = 'revoked' then
    raise exception 'customer_membership_revoked' using errcode = '22023';
  end if;

  update private.company_client_memberships member
  set state = 'active_full',
      evidence_kind = 'staff_confirmed',
      confirmed_by_user_id = p_staff_user_id,
      confirmed_at = statement_timestamp()
  where member.id = p_membership_id;

  perform private.customer_record_identity_event(
    'membership_confirmed', v_membership.identity_id, v_membership.company_id,
    null, v_membership.id, null,
    jsonb_build_object('staff_user_id', p_staff_user_id::text)
  );

  return 'active_full';
end;
$function$;

revoke all on function public.confirm_customer_membership_as_system(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.confirm_customer_membership_as_system(uuid, uuid)
  to service_role;

create or replace function public.revoke_customer_membership_as_system(
  p_membership_id uuid,
  p_staff_user_id uuid,
  p_reason text
) returns boolean
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_membership private.company_client_memberships%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_membership_id is null or p_staff_user_id is null then
    raise exception 'customer_membership_input_invalid' using errcode = '22023';
  end if;
  if v_reason is null or length(v_reason) > 200 then
    raise exception 'customer_membership_reason_invalid' using errcode = '22023';
  end if;

  select member.*
  into v_membership
  from private.company_client_memberships member
  where member.id = p_membership_id
  for update;
  if not found then
    raise exception 'customer_membership_not_found' using errcode = 'P0002';
  end if;

  if not private.user_is_active_company_member(p_staff_user_id, v_membership.company_id)
     or not public.has_permission(p_staff_user_id, 'clients.edit', 'own') then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if v_membership.state not in ('active_forward_only', 'active_full') then
    return false;
  end if;

  update private.company_client_memberships member
  set state = 'revoked',
      revoked_by_user_id = p_staff_user_id,
      revoked_at = statement_timestamp(),
      revoked_reason = v_reason
  where member.id = p_membership_id;

  perform private.customer_record_identity_event(
    'membership_revoked', v_membership.identity_id, v_membership.company_id,
    null, v_membership.id, null,
    jsonb_build_object('staff_user_id', p_staff_user_id::text, 'reason', v_reason)
  );

  return true;
end;
$function$;

revoke all on function public.revoke_customer_membership_as_system(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.revoke_customer_membership_as_system(uuid, uuid, text)
  to service_role;

-- Staff listing for one client. The email is masked; the identity's raw
-- contact never crosses this boundary.
create or replace function public.list_customer_memberships_for_client_as_system(
  p_company_id uuid,
  p_client_id uuid
) returns table (
  membership_id uuid,
  state text,
  evidence_kind text,
  contact_email_masked text,
  last_seen_at timestamptz
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

  if p_company_id is null or p_client_id is null then
    return;
  end if;

  return query
  select
    member.id,
    member.state,
    member.evidence_kind,
    private.customer_mask_email(primary_contact.normalized_value),
    identity.last_seen_at
  from private.company_client_memberships member
  join private.customer_identities identity on identity.id = member.identity_id
  left join lateral (
    select contact.normalized_value
    from private.customer_verified_contacts contact
    where contact.identity_id = member.identity_id
      and contact.channel = 'email'
      and contact.revoked_at is null
    order by contact.verified_at, contact.id
    limit 1
  ) primary_contact on true
  where member.company_id = p_company_id
    and member.client_id = p_client_id
  order by member.created_at, member.id;
end;
$function$;

revoke all on function public.list_customer_memberships_for_client_as_system(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.list_customer_memberships_for_client_as_system(uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Integrations + pairwise refs (I4)
-- ---------------------------------------------------------------------------

-- The hosted-pages integration for a company, created on first use.
create or replace function public.ensure_customer_hosted_integration_as_system(
  p_company_id uuid
) returns uuid
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_integration_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_company_id is null or not exists (
    select 1
    from public.companies company
    where company.id = p_company_id
      and company.deleted_at is null
  ) then
    raise exception 'customer_integration_company_unavailable' using errcode = '22023';
  end if;

  insert into private.customer_integrations (company_id, public_handle, kind)
  values (
    p_company_id,
    'ci_' || replace(gen_random_uuid()::text, '-', ''),
    'hosted_pages'
  )
  on conflict (company_id) where kind = 'hosted_pages' do nothing;

  select integration.id
  into v_integration_id
  from private.customer_integrations integration
  where integration.company_id = p_company_id
    and integration.kind = 'hosted_pages';

  return v_integration_id;
end;
$function$;

revoke all on function public.ensure_customer_hosted_integration_as_system(uuid)
  from public, anon, authenticated;
grant execute on function public.ensure_customer_hosted_integration_as_system(uuid)
  to service_role;

create or replace function public.ensure_customer_pairwise_ref_as_system(
  p_identity_id uuid,
  p_integration_id uuid
) returns text
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_public_ref text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_identity_id is null or not exists (
    select 1
    from private.customer_identities identity
    where identity.id = p_identity_id
      and identity.status = 'active'
  ) then
    raise exception 'customer_identity_unavailable' using errcode = '42501';
  end if;
  if p_integration_id is null or not exists (
    select 1
    from private.customer_integrations integration
    where integration.id = p_integration_id
      and integration.status = 'active'
  ) then
    raise exception 'customer_integration_unavailable' using errcode = '22023';
  end if;

  insert into private.customer_pairwise_refs (identity_id, integration_id, public_ref)
  values (
    p_identity_id,
    p_integration_id,
    'cr_' || replace(gen_random_uuid()::text, '-', '')
  )
  on conflict (identity_id, integration_id) do nothing;

  select ref.public_ref
  into v_public_ref
  from private.customer_pairwise_refs ref
  where ref.identity_id = p_identity_id
    and ref.integration_id = p_integration_id;

  return v_public_ref;
end;
$function$;

revoke all on function public.ensure_customer_pairwise_ref_as_system(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.ensure_customer_pairwise_ref_as_system(uuid, uuid)
  to service_role;

-- Seed the hosted-pages integration for every live company.
insert into private.customer_integrations (company_id, public_handle, kind)
select company.id, 'ci_' || replace(gen_random_uuid()::text, '-', ''), 'hosted_pages'
from public.companies company
where company.deleted_at is null
on conflict (company_id) where kind = 'hosted_pages' do nothing;

-- ---------------------------------------------------------------------------
-- Audit (single writer)
-- ---------------------------------------------------------------------------

create or replace function public.append_customer_identity_event_as_system(
  p_event_type text,
  p_identity_id uuid,
  p_company_id uuid,
  p_session_id uuid,
  p_network_fingerprint text,
  p_metadata jsonb
) returns void
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  perform private.customer_record_identity_event(
    p_event_type,
    p_identity_id,
    p_company_id,
    p_session_id,
    null,
    p_network_fingerprint,
    p_metadata
  );
end;
$function$;

revoke all on function public.append_customer_identity_event_as_system(
  text, uuid, uuid, uuid, text, jsonb
) from public, anon, authenticated;
grant execute on function public.append_customer_identity_event_as_system(
  text, uuid, uuid, uuid, text, jsonb
) to service_role;

-- ---------------------------------------------------------------------------
-- Memberships follow client merges (D6)
-- ---------------------------------------------------------------------------

-- execute_client_merge_guarded stamps merged_into_client_id on the loser in
-- its final step. Every live membership on the loser moves to the winner:
-- an existing winner membership absorbs it (keeping the stronger state), or
-- a copy is created. The loser row is closed as `merged` with a pointer.
create or replace function private.customer_memberships_follow_client_merge()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_loser private.company_client_memberships%rowtype;
  v_winner private.company_client_memberships%rowtype;
  v_target_id uuid;
begin
  if new.merged_into_client_id is null
     or new.merged_into_client_id is not distinct from old.merged_into_client_id then
    return new;
  end if;

  for v_loser in
    select member.*
    from private.company_client_memberships member
    where member.company_id = new.company_id
      and member.client_id = new.id
      and member.state in ('active_forward_only', 'active_full')
    order by member.created_at, member.id
    for update
  loop
    select member.*
    into v_winner
    from private.company_client_memberships member
    where member.identity_id = v_loser.identity_id
      and member.company_id = new.company_id
      and member.client_id = new.merged_into_client_id
      and member.state in ('active_forward_only', 'active_full')
    for update;

    if found then
      if v_loser.state = 'active_full' and v_winner.state <> 'active_full' then
        update private.company_client_memberships member
        set state = 'active_full',
            evidence_kind = v_loser.evidence_kind,
            confirmed_by_user_id = v_loser.confirmed_by_user_id,
            confirmed_at = v_loser.confirmed_at
        where member.id = v_winner.id;
      end if;
      v_target_id := v_winner.id;
    else
      insert into private.company_client_memberships (
        identity_id,
        company_id,
        client_id,
        sub_client_id,
        state,
        evidence_kind,
        confirmed_by_user_id,
        confirmed_at
      ) values (
        v_loser.identity_id,
        new.company_id,
        new.merged_into_client_id,
        v_loser.sub_client_id,
        v_loser.state,
        v_loser.evidence_kind,
        v_loser.confirmed_by_user_id,
        v_loser.confirmed_at
      )
      returning id into v_target_id;
    end if;

    update private.company_client_memberships member
    set state = 'merged',
        merged_into_membership_id = v_target_id
    where member.id = v_loser.id;

    perform private.customer_record_identity_event(
      'membership_merged', v_loser.identity_id, new.company_id, null,
      v_loser.id, null,
      jsonb_build_object(
        'merged_into_membership_id', v_target_id::text,
        'state', v_loser.state
      )
    );
  end loop;

  return new;
end;
$function$;

revoke all on function private.customer_memberships_follow_client_merge()
  from public, anon, authenticated, service_role;

create trigger clients_customer_memberships_follow_merge
  after update of merged_into_client_id on public.clients
  for each row
  when (new.merged_into_client_id is not null
    and new.merged_into_client_id is distinct from old.merged_into_client_id)
  execute function private.customer_memberships_follow_client_merge();

-- ---------------------------------------------------------------------------
-- Dormancy re-gate (I7), scheduled daily under the shared cron controls
-- ---------------------------------------------------------------------------

create or replace function private.customer_identity_dormancy_sweep()
returns void
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_cutoff timestamptz := statement_timestamp() - interval '180 days';
  v_membership record;
  v_evidence text;
begin
  for v_membership in
    select member.id, member.identity_id, member.company_id, member.client_id,
           member.evidence_kind
    from private.company_client_memberships member
    join private.customer_identities identity on identity.id = member.identity_id
    where member.state = 'active_full'
      and identity.status = 'active'
      and identity.last_seen_at < v_cutoff
    order by member.id
    for update of member
  loop
    v_evidence := private.customer_identity_evidence_for_client(
      v_membership.identity_id, v_membership.company_id, v_membership.client_id
    );

    if v_evidence = 'on_file_transacted' then
      -- Evidence still stands: full access continues, re-evaluated now.
      if v_membership.evidence_kind <> 'on_file_transacted' then
        update private.company_client_memberships member
        set evidence_kind = 'on_file_transacted'
        where member.id = v_membership.id;
      end if;
      perform private.customer_record_identity_event(
        'membership_dormancy_reevaluated', v_membership.identity_id,
        v_membership.company_id, null, v_membership.id, null,
        jsonb_build_object('outcome', 'retained', 'evidence_kind', 'on_file_transacted')
      );
    else
      update private.company_client_memberships member
      set state = 'active_forward_only',
          evidence_kind = 'none',
          confirmed_by_user_id = null,
          confirmed_at = null
      where member.id = v_membership.id;
      perform private.customer_record_identity_event(
        'membership_demoted_dormant', v_membership.identity_id,
        v_membership.company_id, null, v_membership.id, null,
        jsonb_build_object('previous_evidence_kind', v_membership.evidence_kind)
      );
    end if;
  end loop;

  perform private.customer_prune_expired_artifacts();
end;
$function$;

revoke all on function private.customer_identity_dormancy_sweep()
  from public, anon, authenticated, service_role;

-- Allowlist the sweep for the shared scheduled-workload runner. The body is
-- the live definition with one command added.
create or replace function private.run_scheduled_cron_workload_controlled(
  p_workload_key text,
  p_lease_seconds integer,
  p_command_name text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_owner_token uuid := gen_random_uuid();
  v_acquisition jsonb;
  v_completed boolean;
  v_sqlstate text;
  v_message text;
  v_failed boolean := false;
begin
  if p_command_name not in (
    'public.fire_due_task_reminders',
    'private.refresh_spec_board_snapshot',
    'private.capture_identity_linkage_metrics',
    'public.expense_envelope_sweep',
    'private.prune_cron_history_batch',
    'private.customer_identity_dormancy_sweep'
  ) then
    raise exception 'scheduled cron command is not allowlisted'
      using errcode = '42501';
  end if;

  v_acquisition := private.acquire_cron_workload_lease_internal(
    p_workload_key,
    v_owner_token,
    p_lease_seconds
  );
  if v_acquisition ->> 'acquired' <> 'true' then
    return v_acquisition || jsonb_build_object(
      'workload_key',
      p_workload_key
    );
  end if;

  -- Bound the database statement below the durable lease. The 30-second
  -- completion margin guarantees an overrun is cancelled and recorded before
  -- a successor can acquire the expired fence.
  perform set_config(
    'statement_timeout',
    (greatest(5, p_lease_seconds - 30) * 1000)::text,
    true
  );

  begin
    execute format('select %s()', p_command_name);
  exception
    when query_canceled then
      get stacked diagnostics
        v_sqlstate = returned_sqlstate,
        v_message = message_text;
      v_failed := true;
    when others then
      get stacked diagnostics
        v_sqlstate = returned_sqlstate,
        v_message = message_text;
      v_failed := true;
  end;

  if v_failed then
    v_completed := private.complete_cron_workload_lease_internal(
      p_workload_key,
      v_owner_token,
      (v_acquisition ->> 'fence_token')::bigint,
      (v_acquisition ->> 'global_fence_token')::bigint,
      false,
      private.is_cron_database_pressure_error(v_sqlstate, v_message),
      300
    );
    if not v_completed then
      raise exception 'scheduled cron workload lost its completion fence'
        using errcode = '55000';
    end if;

    -- Do not rethrow here: an exception escaping the pg_cron transaction
    -- would roll back the circuit update we just persisted. The failed
    -- command already ran inside this exception block's subtransaction, so
    -- its partial effects were rolled back before completion was recorded.
    raise warning
      'scheduled cron workload % failed [%]: %',
      p_workload_key,
      v_sqlstate,
      v_message;
    return jsonb_build_object(
      'acquired',
      true,
      'completed',
      false,
      'workload_key',
      p_workload_key,
      'error_sqlstate',
      v_sqlstate
    );
  end if;

  v_completed := private.complete_cron_workload_lease_internal(
    p_workload_key,
    v_owner_token,
    (v_acquisition ->> 'fence_token')::bigint,
    (v_acquisition ->> 'global_fence_token')::bigint,
    true,
    false,
    300
  );
  if not v_completed then
    raise exception 'scheduled cron workload lost its completion fence'
      using errcode = '55000';
  end if;

  return jsonb_build_object(
    'acquired',
    true,
    'completed',
    true,
    'workload_key',
    p_workload_key
  );
end;
$function$;

create or replace function private.run_customer_identity_dormancy_sweep_controlled()
returns jsonb
language sql
security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  select private.run_scheduled_cron_workload_controlled(
    'db-customer-identity-dormancy',
    300,
    'private.customer_identity_dormancy_sweep'
  );
$function$;

revoke all on function private.run_customer_identity_dormancy_sweep_controlled()
  from public, anon, authenticated, service_role;

do $schedule_dormancy_sweep$
declare
  v_job_id bigint;
begin
  v_job_id := cron.schedule(
    'customer_identity_dormancy_daily',
    '34 6 * * *',
    'select private.run_customer_identity_dormancy_sweep_controlled();'
  );
  perform cron.alter_job(
    job_id := v_job_id,
    active := true
  );
end;
$schedule_dormancy_sweep$;
