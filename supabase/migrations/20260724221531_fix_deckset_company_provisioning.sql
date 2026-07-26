begin;

-- Seed the Owner role while the caller is still an unscoped user. The
-- permission guard correctly blocks role mutations after a user becomes a
-- company admin, so promoting the user before this insert made every new
-- company bootstrap fail at commit with target_is_admin.
create or replace function public.create_company_for_owner(
  p_name text,
  p_industries text[] default null::text[],
  p_email text default null::text,
  p_phone text default null::text,
  p_address text default null::text
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_firebase_uid text;
  v_user users%rowtype;
  v_company_id uuid;
  v_code text;
  v_owner_role_id uuid;
  v_attempts integer := 0;
  v_inserted boolean := false;
  v_constraint text;
  v_claim_singular text;
  v_claims_plural text;
  v_elevated text;
begin
  v_firebase_uid := nullif(auth.jwt() ->> 'sub', '');
  if v_firebase_uid is null then
    raise exception 'NO_JWT' using errcode = 'P0001';
  end if;

  select *
    into v_user
    from public.users
   where firebase_uid = v_firebase_uid
     and deleted_at is null
   limit 1;
  if v_user.id is null then
    raise exception 'NO_USER_ROW' using errcode = 'P0002';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'INVALID_NAME' using errcode = 'P0005';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('create_company_for_owner'),
    hashtext(v_user.id::text)
  );

  select company_id
    into v_user.company_id
    from public.users
   where id = v_user.id
   for update;

  select id, company_code
    into v_company_id, v_code
    from public.companies
   where account_holder_id = v_user.id::text
     and deleted_at is null
   order by created_at, id
   limit 1;
  if v_company_id is not null then
    if v_code is null then
      loop
        v_attempts := v_attempts + 1;
        if v_attempts > 20 then
          raise exception 'CODE_GENERATION_EXHAUSTED' using errcode = 'P0006';
        end if;

        v_code := (
          select string_agg(
            substr(
              'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
              (floor(random() * 32))::integer + 1,
              1
            ),
            ''
          )
          from generate_series(1, 8)
        );
        continue when exists (
          select 1
            from public.companies
           where upper(company_code) = v_code
        );

        begin
          update public.companies
             set company_code = v_code,
                 updated_at = now()
           where id = v_company_id;
          v_inserted := true;
        exception when unique_violation then
          get stacked diagnostics v_constraint = constraint_name;
          if v_constraint is distinct from 'idx_companies_company_code' then
            raise;
          end if;
          v_inserted := false;
        end;
        exit when v_inserted;
      end loop;
    end if;

    return jsonb_build_object(
      'company_id', v_company_id,
      'company_code', v_code,
      'already_existed', true
    );
  end if;

  if v_user.company_id is not null and exists (
    select 1
      from public.companies
     where id = v_user.company_id
       and deleted_at is null
  ) then
    raise exception 'ALREADY_IN_COMPANY' using errcode = 'P0003';
  end if;

  loop
    v_attempts := v_attempts + 1;
    if v_attempts > 20 then
      raise exception 'CODE_GENERATION_EXHAUSTED' using errcode = 'P0006';
    end if;

    v_code := (
      select string_agg(
        substr(
          'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
          (floor(random() * 32))::integer + 1,
          1
        ),
        ''
      )
      from generate_series(1, 8)
    );
    continue when exists (
      select 1
        from public.companies
       where upper(company_code) = v_code
    );

    begin
      insert into public.companies (
        name,
        email,
        phone,
        address,
        industries,
        company_code,
        admin_ids,
        seated_employee_ids,
        account_holder_id,
        subscription_status,
        subscription_plan,
        trial_start_date,
        trial_end_date,
        max_seats,
        created_at,
        updated_at
      )
      values (
        btrim(p_name),
        p_email,
        p_phone,
        p_address,
        coalesce(p_industries, '{}'::text[]),
        v_code,
        array[v_user.id::text],
        array[v_user.id::text],
        v_user.id::text,
        'trial',
        'trial',
        now(),
        now() + interval '30 days',
        10,
        now(),
        now()
      )
      returning id into v_company_id;
      v_inserted := true;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from 'idx_companies_company_code' then
        raise;
      end if;
      v_inserted := false;
    end;
    exit when v_inserted;
  end loop;

  -- A user detached from a deleted company can retain stale admin fields.
  -- Clear them before the guarded role seed; the transaction restores the
  -- final owner state below or rolls the entire bootstrap back.
  update public.users
     set company_id = null,
         is_company_admin = false,
         updated_at = now()
   where id = v_user.id
     and (
       company_id is not null
       or coalesce(is_company_admin, false)
     );

  select id
    into v_owner_role_id
    from public.roles
   where name = 'Owner'
     and is_preset
     and company_id is null
   limit 1;
  if v_owner_role_id is null then
    raise exception 'OWNER_ROLE_MISSING' using errcode = 'P0004';
  end if;

  set constraints trg_user_roles_final_state immediate;
  insert into public.user_roles (user_id, role_id)
  values (v_user.id::text, v_owner_role_id)
  on conflict (user_id) do update
    set role_id = excluded.role_id;
  set constraints trg_user_roles_final_state deferred;

  update public.users
     set company_id = v_company_id,
         role = 'owner',
         is_company_admin = true,
         user_type = 'company',
         updated_at = now()
   where id = v_user.id;

  v_claim_singular := current_setting('request.jwt.claim', true);
  v_claims_plural := current_setting('request.jwt.claims', true);
  v_elevated := (
    coalesce(auth.jwt(), '{}'::jsonb)
    || jsonb_build_object('role', 'service_role')
  )::text;
  perform set_config('request.jwt.claim', v_elevated, true);
  perform set_config('request.jwt.claims', v_elevated, true);

  perform public.initialize_company_defaults(v_company_id);

  perform set_config(
    'request.jwt.claim',
    coalesce(v_claim_singular, ''),
    true
  );
  perform set_config(
    'request.jwt.claims',
    coalesce(v_claims_plural, ''),
    true
  );

  return jsonb_build_object(
    'company_id', v_company_id,
    'company_code', v_code,
    'already_existed', false
  );
end;
$function$;

commit;
