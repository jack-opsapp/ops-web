begin;

do $$
declare
  v_functiondef text;
begin
  select pg_get_functiondef('public.accept_estimate_to_job_from_quickbooks(uuid, uuid, uuid, text, text)'::regprocedure)
  into v_functiondef;

  if v_functiondef not ilike '%request.jwt.claim.email%' then
    v_functiondef := replace(
      v_functiondef,
      '  v_actor_auth_id uuid;',
      '  v_actor_auth_id uuid;
  v_actor_email text;'
    );

    v_functiondef := replace(
      v_functiondef,
      '  select u.id, private.try_parse_uuid(u.auth_id)
    into v_actor_id, v_actor_auth_id',
      '  select u.id, u.id, u.email
    into v_actor_id, v_actor_auth_id, v_actor_email'
    );

    v_functiondef := replace(
      v_functiondef,
      '    select u.id, private.try_parse_uuid(u.auth_id)
      into v_actor_id, v_actor_auth_id',
      '    select u.id, u.id, u.email
      into v_actor_id, v_actor_auth_id, v_actor_email'
    );

    v_functiondef := replace(
      v_functiondef,
      '  if v_actor_auth_id is null then',
      '  if v_actor_auth_id is null or nullif(btrim(coalesce(v_actor_email, '''')), '''') is null then'
    );

    v_functiondef := replace(
      v_functiondef,
      '  perform set_config(''request.jwt.claim.sub'', v_actor_auth_id::text, true);
  perform set_config(''request.jwt.claim.role'', ''authenticated'', true);',
      '  perform set_config(''request.jwt.claim.sub'', v_actor_auth_id::text, true);
  perform set_config(''request.jwt.claim.email'', v_actor_email, true);
  perform set_config(''request.jwt.claim.role'', ''authenticated'', true);'
    );

    v_functiondef := replace(
      v_functiondef,
      'jsonb_build_object(''sub'', v_actor_auth_id::text, ''role'', ''authenticated'')::text',
      'jsonb_build_object(''sub'', v_actor_auth_id::text, ''email'', v_actor_email, ''role'', ''authenticated'')::text'
    );

    if v_functiondef not ilike '%request.jwt.claim.email%' then
      raise exception 'qbo_acceptance_bridge_firebase_actor_sentinel: email claim patch failed';
    end if;

    execute v_functiondef;
  end if;
end $$;

do $$
declare
  v_functiondef text;
begin
  select pg_get_functiondef('public.accept_estimate_to_job_from_quickbooks(uuid, uuid, uuid, text, text)'::regprocedure)
  into v_functiondef;

  if v_functiondef not ilike '%request.jwt.claim.email%' then
    raise exception 'qbo_acceptance_bridge_firebase_actor_sentinel: bridge does not set email claim';
  end if;

  if v_functiondef ilike '%private.try_parse_uuid(u.auth_id)%' then
    raise exception 'qbo_acceptance_bridge_firebase_actor_sentinel: bridge still requires uuid auth_id';
  end if;
end $$;

revoke all on function public.accept_estimate_to_job_from_quickbooks(
  uuid,
  uuid,
  uuid,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.accept_estimate_to_job_from_quickbooks(
  uuid,
  uuid,
  uuid,
  text,
  text
) to service_role;

commit;
