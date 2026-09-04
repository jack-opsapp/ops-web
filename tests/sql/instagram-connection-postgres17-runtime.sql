insert into public.social_instagram_oauth_states (
  nonce_hash,
  admin_email,
  expires_at
)
values (
  repeat('a', 64),
  'operator@opsapp.co',
  now() + interval '10 minutes'
);

do $$
declare
  v_email text;
begin
  select state.admin_email
    into v_email
    from public.consume_social_instagram_oauth_state(repeat('a', 64)) as state;
  if v_email <> 'operator@opsapp.co' then
    raise exception 'instagram_runtime_oauth_state_not_consumed';
  end if;
  if exists (
    select 1
      from public.consume_social_instagram_oauth_state(repeat('a', 64))
  ) then
    raise exception 'instagram_runtime_oauth_state_replay_not_zero';
  end if;
end;
$$;

insert into public.social_instagram_connections (
  instagram_user_id,
  username,
  access_token_ciphertext,
  required_scopes,
  token_issued_at,
  token_expires_at,
  connected_by_email
)
values (
  '17841400000000000',
  'opsjournal',
  'ig-token:v1:test-envelope',
  array['instagram_business_basic', 'instagram_business_content_publish'],
  now() - interval '30 days',
  now() + interval '3 days',
  'operator@opsapp.co'
);

do $$
declare
  v_claimed integer;
begin
  select count(*)
    into v_claimed
    from public.claim_social_instagram_refresh(
      '71000000-0000-4000-8000-000000000001',
      180
    );
  if v_claimed <> 1 then
    raise exception 'instagram_runtime_refresh_not_claimed';
  end if;

  select count(*)
    into v_claimed
    from public.claim_social_instagram_refresh(
      '71000000-0000-4000-8000-000000000002',
      180
    );
  if v_claimed <> 0 then
    raise exception 'instagram_runtime_refresh_double_claimed';
  end if;

  if public.complete_social_instagram_refresh(
    '71000000-0000-4000-8000-000000000002',
    'ig-token:v1:wrong-claim',
    now(),
    now() + interval '60 days'
  ) then
    raise exception 'instagram_runtime_wrong_claim_completed';
  end if;

  if not public.complete_social_instagram_refresh(
    '71000000-0000-4000-8000-000000000001',
    'ig-token:v1:rotated-envelope',
    now(),
    now() + interval '60 days'
  ) then
    raise exception 'instagram_runtime_refresh_not_completed';
  end if;

  if not exists (
    select 1
      from public.social_instagram_connections as connection
     where connection.id = 1
       and connection.access_token_ciphertext = 'ig-token:v1:rotated-envelope'
       and connection.last_refreshed_at is not null
       and connection.refresh_claim_token is null
       and connection.refresh_claim_expires_at is null
  ) then
    raise exception 'instagram_runtime_rotated_token_not_persisted';
  end if;
end;
$$;

do $$
begin
  if has_table_privilege('anon', 'public.social_instagram_connections', 'select')
     or has_table_privilege('authenticated', 'public.social_instagram_connections', 'select')
     or has_table_privilege('anon', 'public.social_instagram_oauth_states', 'select')
     or has_table_privilege('authenticated', 'public.social_instagram_oauth_states', 'select') then
    raise exception 'instagram_runtime_browser_table_grant_present';
  end if;
  if not has_table_privilege('service_role', 'public.social_instagram_connections', 'select')
     or not has_table_privilege('service_role', 'public.social_instagram_oauth_states', 'insert') then
    raise exception 'instagram_runtime_service_role_table_grant_missing';
  end if;
  if has_function_privilege(
    'anon',
    'public.consume_social_instagram_oauth_state(text)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.claim_social_instagram_refresh(uuid,integer)',
    'execute'
  ) then
    raise exception 'instagram_runtime_browser_function_grant_present';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.complete_social_instagram_refresh(uuid,text,timestamp with time zone,timestamp with time zone)',
    'execute'
  ) then
    raise exception 'instagram_runtime_service_role_function_grant_missing';
  end if;
end;
$$;
