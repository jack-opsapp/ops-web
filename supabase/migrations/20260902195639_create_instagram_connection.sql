-- One global Instagram professional-account connection for the OPS social
-- publisher. Tokens are encrypted in the application before they reach the
-- database. Browser roles receive no table or function access.

begin;

create table public.social_instagram_connections (
  id smallint primary key default 1
    check (id = 1),
  instagram_user_id text not null,
  username text not null,
  account_type text,
  access_token_ciphertext text not null,
  required_scopes text[] not null,
  token_issued_at timestamptz not null,
  token_expires_at timestamptz not null,
  last_refreshed_at timestamptz,
  refresh_claim_token uuid,
  refresh_claim_expires_at timestamptz,
  last_refresh_error_code text,
  last_refresh_error_message text,
  last_refresh_error_at timestamptz,
  connected_by_email text not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_instagram_connection_token_lifetime
    check (token_expires_at > token_issued_at),
  constraint social_instagram_connection_required_scopes
    check (
      required_scopes @> array[
        'instagram_business_basic',
        'instagram_business_content_publish'
      ]::text[]
    ),
  constraint social_instagram_connection_admin_email
    check (
      connected_by_email = lower(btrim(connected_by_email))
      and connected_by_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ),
  constraint social_instagram_connection_refresh_claim_pair
    check (
      (refresh_claim_token is null and refresh_claim_expires_at is null)
      or
      (refresh_claim_token is not null and refresh_claim_expires_at is not null)
    )
);

comment on table public.social_instagram_connections is
  'Singleton, service-role-only Instagram publishing connection. Access tokens are application-encrypted.';

alter table public.social_instagram_connections enable row level security;
revoke all on table public.social_instagram_connections from public, anon, authenticated;
grant select, insert, update, delete on table public.social_instagram_connections to service_role;

drop trigger if exists social_instagram_connections_set_updated_at
  on public.social_instagram_connections;
create trigger social_instagram_connections_set_updated_at
  before update on public.social_instagram_connections
  for each row execute function public.fn_set_updated_at();

create table public.social_instagram_oauth_states (
  nonce_hash text primary key,
  admin_email text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint social_instagram_oauth_state_lifetime
    check (expires_at > created_at),
  constraint social_instagram_oauth_state_admin_email
    check (
      admin_email = lower(btrim(admin_email))
      and admin_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
);

comment on table public.social_instagram_oauth_states is
  'Short-lived, one-time server-side context for an admin-minted Instagram OAuth handoff.';

create index social_instagram_oauth_states_expires_at_idx
  on public.social_instagram_oauth_states (expires_at);

alter table public.social_instagram_oauth_states enable row level security;
revoke all on table public.social_instagram_oauth_states from public, anon, authenticated;
grant select, insert, update, delete on table public.social_instagram_oauth_states to service_role;

create or replace function public.consume_social_instagram_oauth_state(
  p_nonce_hash text
)
returns table (admin_email text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_nonce_hash is null or btrim(p_nonce_hash) = '' then
    return;
  end if;

  return query
  delete from public.social_instagram_oauth_states as state
   where state.nonce_hash = p_nonce_hash
     and state.expires_at > clock_timestamp()
  returning state.admin_email;
end;
$$;

revoke all on function public.consume_social_instagram_oauth_state(text)
  from public, anon, authenticated;
grant execute on function public.consume_social_instagram_oauth_state(text)
  to service_role;

create or replace function public.claim_social_instagram_refresh(
  p_claim_token uuid,
  p_claim_ttl_seconds integer default 180
)
returns table (
  instagram_user_id text,
  username text,
  access_token_ciphertext text,
  token_issued_at timestamptz,
  token_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_claim_token is null then
    raise exception 'claim token is required' using errcode = '22023';
  end if;
  if p_claim_ttl_seconds < 30 or p_claim_ttl_seconds > 900 then
    raise exception 'claim ttl must be between 30 and 900 seconds'
      using errcode = '22023';
  end if;

  return query
  with candidate as (
    select connection.id
      from public.social_instagram_connections as connection
     where connection.id = 1
       and connection.token_expires_at > clock_timestamp()
       and connection.token_expires_at <= clock_timestamp() + interval '7 days'
       and connection.token_issued_at <= clock_timestamp() - interval '24 hours'
       and (
         connection.refresh_claim_expires_at is null
         or connection.refresh_claim_expires_at <= clock_timestamp()
       )
     for update skip locked
  )
  update public.social_instagram_connections as connection
     set refresh_claim_token = p_claim_token,
         refresh_claim_expires_at = clock_timestamp()
           + make_interval(secs => p_claim_ttl_seconds),
         last_refresh_error_code = null,
         last_refresh_error_message = null,
         last_refresh_error_at = null
    from candidate
   where connection.id = candidate.id
  returning
    connection.instagram_user_id,
    connection.username,
    connection.access_token_ciphertext,
    connection.token_issued_at,
    connection.token_expires_at;
end;
$$;

revoke all on function public.claim_social_instagram_refresh(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_social_instagram_refresh(uuid, integer)
  to service_role;

create or replace function public.complete_social_instagram_refresh(
  p_claim_token uuid,
  p_access_token_ciphertext text,
  p_token_issued_at timestamptz,
  p_token_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row_count integer;
begin
  if p_claim_token is null
     or p_access_token_ciphertext is null
     or btrim(p_access_token_ciphertext) = ''
     or p_token_issued_at is null
     or p_token_expires_at is null
     or p_token_expires_at <= p_token_issued_at then
    raise exception 'valid refresh result is required' using errcode = '22023';
  end if;

  update public.social_instagram_connections as connection
     set access_token_ciphertext = p_access_token_ciphertext,
         token_issued_at = p_token_issued_at,
         token_expires_at = p_token_expires_at,
         last_refreshed_at = clock_timestamp(),
         refresh_claim_token = null,
         refresh_claim_expires_at = null,
         last_refresh_error_code = null,
         last_refresh_error_message = null,
         last_refresh_error_at = null
   where connection.id = 1
     and connection.refresh_claim_token = p_claim_token
     and connection.refresh_claim_expires_at > clock_timestamp();

  get diagnostics v_row_count = row_count;
  return v_row_count = 1;
end;
$$;

revoke all on function public.complete_social_instagram_refresh(uuid, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.complete_social_instagram_refresh(uuid, text, timestamptz, timestamptz)
  to service_role;

create or replace function public.release_social_instagram_refresh(
  p_claim_token uuid,
  p_error_code text,
  p_error_message text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row_count integer;
begin
  if p_claim_token is null then
    raise exception 'claim token is required' using errcode = '22023';
  end if;

  update public.social_instagram_connections as connection
     set refresh_claim_token = null,
         refresh_claim_expires_at = null,
         last_refresh_error_code = left(nullif(btrim(p_error_code), ''), 100),
         last_refresh_error_message = left(nullif(btrim(p_error_message), ''), 500),
         last_refresh_error_at = clock_timestamp()
   where connection.id = 1
     and connection.refresh_claim_token = p_claim_token;

  get diagnostics v_row_count = row_count;
  return v_row_count = 1;
end;
$$;

revoke all on function public.release_social_instagram_refresh(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.release_social_instagram_refresh(uuid, text, text)
  to service_role;

commit;
