begin;

-- Bind every connected Sage grant to one explicitly selected Sage business.
-- The encrypted identifier is used for outbound routing; the deterministic
-- lookup prevents two OPS companies from claiming the same Sage business.
alter table public.accounting_connections
  add column if not exists sage_business_id text,
  add column if not exists sage_business_id_lookup text,
  add column if not exists sage_business_name text;

alter table public.accounting_connections
  drop constraint if exists accounting_connections_sage_business_binding_check;

alter table public.accounting_connections
  add constraint accounting_connections_sage_business_binding_check
  check (
    provider <> 'sage'
    or is_connected = false
    or (
      nullif(btrim(sage_business_id), '') is not null
      and sage_business_id_lookup ~ '^[0-9a-f]{64}$'
      and nullif(btrim(sage_business_name), '') is not null
    )
  );

comment on column public.accounting_connections.sage_business_id is
  'AES-256-GCM encrypted Sage business identifier. Decrypt only in server-side Sage API code.';
comment on column public.accounting_connections.sage_business_id_lookup is
  'Deterministic SHA-256 hex of the plaintext Sage business identifier. Ownership lookup only.';
comment on column public.accounting_connections.sage_business_name is
  'Last confirmed Sage business display name, captured during explicit business selection.';

create unique index if not exists accounting_connections_sage_business_owner_uniq
  on public.accounting_connections (provider_environment, sage_business_id_lookup)
  where provider = 'sage'
    and is_connected = true
    and sage_business_id_lookup is not null;

create unique index if not exists accounting_connections_one_sage_writable_per_company
  on public.accounting_connections (company_id, provider)
  where provider = 'sage'
    and is_connected = true
    and sync_enabled = true
    and sync_direction <> 'pull_only';

alter table public.estimates
  add column if not exists sage_document_kind text;

alter table public.estimates
  drop constraint if exists estimates_sage_document_kind_check;

alter table public.estimates
  add constraint estimates_sage_document_kind_check
  check (
    sage_document_kind is null
    or sage_document_kind in ('sales_estimate', 'sales_quote')
  );

-- OAuth attempts are server-only, short-lived, and consumed atomically. State
-- contains no company identity or return URL; only its digest is persisted.
create table public.accounting_oauth_attempts (
  id uuid primary key default gen_random_uuid(),
  state_digest text not null unique
    check (state_digest ~ '^[0-9a-f]{64}$'),
  actor_user_id uuid not null,
  company_id text not null,
  provider text not null default 'sage'
    check (provider = 'sage'),
  provider_environment text not null
    check (provider_environment in ('production', 'sandbox')),
  pkce_verifier text not null,
  return_surface text not null default 'books'
    check (return_surface in ('books', 'settings')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (consumed_at is null or consumed_at >= created_at)
);

comment on table public.accounting_oauth_attempts is
  'Server-only one-time Sage OAuth state and encrypted PKCE verifier. Browser roles have no privileges.';

create index accounting_oauth_attempts_unconsumed_expiry_idx
  on public.accounting_oauth_attempts (expires_at)
  where consumed_at is null;

alter table public.accounting_oauth_attempts enable row level security;
revoke all on table public.accounting_oauth_attempts from public, anon, authenticated;
grant select, insert, update, delete on table public.accounting_oauth_attempts to service_role;

-- A Sage access token may enumerate multiple businesses. The callback stores
-- the encrypted rotating grant here until the authenticated initiator selects
-- one allow-listed business. No connection becomes active before selection.
create table public.sage_business_selection_sessions (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null
    references public.accounting_connections(id) on delete cascade,
  actor_user_id uuid not null,
  company_id text not null,
  provider_environment text not null
    check (provider_environment in ('production', 'sandbox')),
  access_token text not null,
  refresh_token text not null,
  token_expires_at timestamptz not null,
  eligible_businesses jsonb not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(eligible_businesses) = 'array'),
  check (jsonb_array_length(eligible_businesses) > 0),
  check (token_expires_at > created_at),
  check (expires_at > created_at),
  check (consumed_at is null or consumed_at >= created_at)
);

comment on table public.sage_business_selection_sessions is
  'Server-only encrypted Sage grant awaiting explicit, same-user business selection.';

create index sage_business_selection_sessions_owner_idx
  on public.sage_business_selection_sessions (
    actor_user_id,
    company_id,
    expires_at
  )
  where consumed_at is null;

alter table public.sage_business_selection_sessions enable row level security;
revoke all on table public.sage_business_selection_sessions from public, anon, authenticated;
grant select, insert, update, delete on table public.sage_business_selection_sessions to service_role;

create or replace function public.consume_accounting_oauth_attempt(
  p_state_digest text
)
returns setof public.accounting_oauth_attempts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_state_digest is null or p_state_digest !~ '^[0-9a-f]{64}$' then
    return;
  end if;

  return query
  update public.accounting_oauth_attempts attempt
  set consumed_at = now()
  where attempt.id = (
    select candidate.id
    from public.accounting_oauth_attempts candidate
    where candidate.state_digest = p_state_digest
      and candidate.consumed_at is null
      and candidate.expires_at > now()
    for update skip locked
    limit 1
  )
  returning attempt.*;
end;
$$;

revoke all on function public.consume_accounting_oauth_attempt(text)
  from public, anon, authenticated;
grant execute on function public.consume_accounting_oauth_attempt(text)
  to service_role;

create or replace function public.consume_sage_business_selection_session(
  p_session_id uuid,
  p_actor_user_id uuid,
  p_company_id text
)
returns setof public.sage_business_selection_sessions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_session_id is null
     or p_actor_user_id is null
     or nullif(btrim(p_company_id), '') is null then
    return;
  end if;

  return query
  update public.sage_business_selection_sessions session
  set consumed_at = now()
  where session.id = (
    select candidate.id
    from public.sage_business_selection_sessions candidate
    where candidate.id = p_session_id
      and candidate.actor_user_id = p_actor_user_id
      and candidate.company_id = p_company_id
      and candidate.consumed_at is null
      and candidate.expires_at > now()
    for update skip locked
    limit 1
  )
  returning session.*;
end;
$$;

revoke all on function public.consume_sage_business_selection_session(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.consume_sage_business_selection_session(uuid, uuid, text)
  to service_role;

do $$
declare
  v_indexdef text;
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'accounting_connections'
      and column_name = 'sage_business_id_lookup'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'estimates'
      and column_name = 'sage_document_kind'
  ) then
    raise exception 'sage_connection_identity_sentinel: required identity columns are missing';
  end if;

  if not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'accounting_oauth_attempts'
  ) or not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'sage_business_selection_sessions'
  ) then
    raise exception 'sage_connection_identity_sentinel: server-only OAuth tables are missing';
  end if;

  select indexdef
  into v_indexdef
  from pg_indexes
  where schemaname = 'public'
    and tablename = 'accounting_connections'
    and indexname = 'accounting_connections_sage_business_owner_uniq';

  if v_indexdef is null
     or v_indexdef not ilike '%provider = ''sage''%'
     or v_indexdef not ilike '%is_connected = true%' then
    raise exception 'sage_connection_identity_sentinel: Sage business ownership index is incomplete';
  end if;

  if has_table_privilege('anon', 'public.accounting_oauth_attempts', 'select')
     or has_table_privilege('authenticated', 'public.sage_business_selection_sessions', 'select')
     or has_function_privilege(
       'anon',
       'public.consume_accounting_oauth_attempt(text)',
       'execute'
     ) then
    raise exception 'sage_connection_identity_sentinel: browser OAuth access remains';
  end if;
end;
$$;

commit;
