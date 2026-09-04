do $$
declare
  v_attempt_id uuid;
  v_count integer;
begin
  insert into public.accounting_oauth_attempts (
    state_digest,
    actor_user_id,
    company_id,
    provider,
    provider_environment,
    pkce_verifier,
    return_surface,
    expires_at
  ) values (
    repeat('a', 64),
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'sage',
    'sandbox',
    'enc:v1:test-verifier',
    'books',
    now() + interval '5 minutes'
  ) returning id into v_attempt_id;

  select count(*) into v_count
  from public.consume_accounting_oauth_attempt(repeat('a', 64));
  if v_count <> 1 then
    raise exception 'sage_oauth_runtime: fresh attempt was not consumed exactly once';
  end if;

  select count(*) into v_count
  from public.consume_accounting_oauth_attempt(repeat('a', 64));
  if v_count <> 0 then
    raise exception 'sage_oauth_runtime: consumed attempt replayed';
  end if;

  insert into public.accounting_oauth_attempts (
    state_digest,
    actor_user_id,
    company_id,
    provider,
    provider_environment,
    pkce_verifier,
    expires_at
  ) values (
    repeat('b', 64),
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'sage',
    'sandbox',
    'enc:v1:expired-verifier',
    now() - interval '1 second'
  );

  select count(*) into v_count
  from public.consume_accounting_oauth_attempt(repeat('b', 64));
  if v_count <> 0 then
    raise exception 'sage_oauth_runtime: expired attempt was consumed';
  end if;
end;
$$;

do $$
declare
  v_session uuid;
  v_count integer;
begin
  insert into public.accounting_connections (
    id,
    company_id,
    provider,
    provider_environment
  ) values (
    '33333333-3333-4333-8333-333333333333',
    '22222222-2222-4222-8222-222222222222',
    'sage',
    'sandbox'
  );

  insert into public.sage_business_selection_sessions (
    connection_id,
    actor_user_id,
    company_id,
    provider_environment,
    access_token,
    refresh_token,
    token_expires_at,
    eligible_businesses,
    expires_at
  ) values (
    '33333333-3333-4333-8333-333333333333',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'sandbox',
    'enc:v1:access',
    'enc:v1:refresh',
    now() + interval '5 minutes',
    '[{"id":"business-a","name":"Sandbox A"}]'::jsonb,
    now() + interval '5 minutes'
  ) returning id into v_session;

  select count(*) into v_count
  from public.consume_sage_business_selection_session(
    v_session,
    '11111111-1111-4111-8111-111111111111',
    'wrong-company'
  );
  if v_count <> 0 then
    raise exception 'sage_oauth_runtime: cross-company selection consumed';
  end if;

  select count(*) into v_count
  from public.consume_sage_business_selection_session(
    v_session,
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222'
  );
  if v_count <> 1 then
    raise exception 'sage_oauth_runtime: owned selection was not consumed';
  end if;

  select count(*) into v_count
  from public.consume_sage_business_selection_session(
    v_session,
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222'
  );
  if v_count <> 0 then
    raise exception 'sage_oauth_runtime: selection replayed';
  end if;
end;
$$;

do $$
begin
  if has_table_privilege('anon', 'public.accounting_oauth_attempts', 'select')
     or has_table_privilege('authenticated', 'public.accounting_oauth_attempts', 'select')
     or has_table_privilege('anon', 'public.sage_business_selection_sessions', 'select')
     or has_table_privilege('authenticated', 'public.sage_business_selection_sessions', 'select') then
    raise exception 'sage_oauth_runtime: browser role can read OAuth secrets';
  end if;

  if has_function_privilege(
       'anon',
       'public.consume_accounting_oauth_attempt(text)',
       'execute'
     ) or has_function_privilege(
       'authenticated',
       'public.consume_sage_business_selection_session(uuid,uuid,text)',
       'execute'
     ) then
    raise exception 'sage_oauth_runtime: browser role can consume OAuth secrets';
  end if;
end;
$$;

do $$
begin
  insert into public.accounting_connections (
    company_id,
    provider,
    provider_environment,
    sage_business_id,
    sage_business_id_lookup,
    sage_business_name,
    is_connected,
    sync_enabled,
    sync_direction
  ) values (
    '44444444-4444-4444-8444-444444444444',
    'sage',
    'sandbox',
    'enc:v1:business-a',
    repeat('c', 64),
    'Sandbox A',
    true,
    true,
    'bidirectional'
  );

  begin
    insert into public.accounting_connections (
      company_id,
      provider,
      provider_environment,
      sage_business_id,
      sage_business_id_lookup,
      sage_business_name,
      is_connected,
      sync_enabled,
      sync_direction
    ) values (
      '55555555-5555-4555-8555-555555555555',
      'sage',
      'sandbox',
      'enc:v1:business-a-copy',
      repeat('c', 64),
      'Sandbox A duplicate',
      true,
      true,
      'bidirectional'
    );
    raise exception 'sage_oauth_runtime: duplicate business owner was accepted';
  exception when unique_violation then
    null;
  end;

  begin
    insert into public.accounting_connections (
      company_id,
      provider,
      provider_environment,
      sage_business_id,
      sage_business_id_lookup,
      sage_business_name,
      is_connected,
      sync_enabled,
      sync_direction
    ) values (
      '44444444-4444-4444-8444-444444444444',
      'sage',
      'production',
      'enc:v1:business-prod',
      repeat('d', 64),
      'Production A',
      true,
      true,
      'bidirectional'
    );
    raise exception 'sage_oauth_runtime: two Sage environments became writable';
  exception when unique_violation then
    null;
  end;

  begin
    insert into public.accounting_connections (
      company_id,
      provider,
      provider_environment,
      is_connected
    ) values (
      '66666666-6666-4666-8666-666666666666',
      'sage',
      'sandbox',
      true
    );
    raise exception 'sage_oauth_runtime: connected Sage row lacks business identity';
  exception when check_violation then
    null;
  end;
end;
$$;
