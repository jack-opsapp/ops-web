-- Bind Gmail and Microsoft OAuth callbacks to one authenticated OPS operator.
--
-- Browser-visible OAuth `state` values are opaque random nonces. Only their
-- SHA-256 digests and server-verified tenant context are stored. Consumption
-- is a provider-bound, expiry-checked DELETE ... RETURNING so replay and
-- concurrent callback attempts cannot attach a mailbox twice.

begin;

create table public.email_oauth_states (
  nonce_hash text primary key,
  provider text not null
    check (provider in ('gmail', 'microsoft365')),
  company_id uuid not null
    references public.companies(id) on delete cascade,
  user_id uuid not null
    references public.users(id) on delete cascade,
  connection_type text not null
    check (connection_type in ('company', 'individual')),
  source text not null
    check (source in ('wizard', 'alert')),
  connection_id uuid
    references public.email_connections(id) on delete cascade,
  expected_email text,
  return_to text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (
    (
      source = 'alert'
      and connection_id is not null
      and expected_email is not null
      and expected_email = lower(btrim(expected_email))
      and expected_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
    or (
      source = 'wizard'
      and connection_id is null
      and expected_email is null
    )
  )
);

comment on table public.email_oauth_states is
  'Short-lived, one-time server-side context for authenticated email OAuth handoffs.';

create index email_oauth_states_expires_at_idx
  on public.email_oauth_states (expires_at);

alter table public.email_oauth_states enable row level security;
revoke all on table public.email_oauth_states from public, anon, authenticated;
grant select, insert, update, delete on public.email_oauth_states to service_role;

create or replace function public.consume_email_oauth_state(
  p_nonce_hash text,
  p_provider text
)
returns table (
  company_id uuid,
  user_id uuid,
  connection_type text,
  source text,
  connection_id uuid,
  expected_email text,
  return_to text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_nonce_hash is null
     or btrim(p_nonce_hash) = ''
     or p_provider not in ('gmail', 'microsoft365') then
    return;
  end if;

  return query
  delete from public.email_oauth_states as state
   where state.nonce_hash = p_nonce_hash
     and state.provider = p_provider
     and state.expires_at > clock_timestamp()
  returning
    state.company_id,
    state.user_id,
    state.connection_type,
    state.source,
    state.connection_id,
    state.expected_email,
    state.return_to;
end;
$$;

revoke all on function public.consume_email_oauth_state(text, text) from public, anon, authenticated;
grant execute on function public.consume_email_oauth_state(text, text) to service_role;

commit;
