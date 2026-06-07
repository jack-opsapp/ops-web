begin;

do $$
declare
  v_functiondef text;
begin
  select pg_get_functiondef('public.accept_estimate_to_job_from_quickbooks(uuid, uuid, uuid, text, text)'::regprocedure)
  into v_functiondef;

  if v_functiondef not ilike '%left join auth.users au%' then
    v_functiondef := replace(
      v_functiondef,
      '  select u.id, u.id, u.email
    into v_actor_id, v_actor_auth_id, v_actor_email
    from public.users u',
      '  select u.id, au.id, u.email
    into v_actor_id, v_actor_auth_id, v_actor_email
    from public.users u
    left join auth.users au
      on lower(au.email) = lower(u.email)'
    );

    v_functiondef := replace(
      v_functiondef,
      '    select u.id, u.id, u.email
      into v_actor_id, v_actor_auth_id, v_actor_email
      from public.users u',
      '    select u.id, au.id, u.email
      into v_actor_id, v_actor_auth_id, v_actor_email
      from public.users u
      left join auth.users au
        on lower(au.email) = lower(u.email)'
    );

    if v_functiondef not ilike '%left join auth.users au%' then
      raise exception 'qbo_acceptance_bridge_auth_user_actor_sentinel: auth user join patch failed';
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

  if v_functiondef not ilike '%left join auth.users au%' then
    raise exception 'qbo_acceptance_bridge_auth_user_actor_sentinel: bridge does not derive auth user id';
  end if;

  if v_functiondef not ilike '%request.jwt.claim.email%' then
    raise exception 'qbo_acceptance_bridge_auth_user_actor_sentinel: bridge does not set email claim';
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
