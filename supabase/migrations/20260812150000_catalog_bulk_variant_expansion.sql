begin;

-- One durable receipt per company/idempotency key. The request body is kept so
-- the same key can replay identical input while changed input is rejected.
create table if not exists public.catalog_bulk_variant_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  idempotency_key text not null,
  request_payload jsonb not null,
  response_payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint catalog_bulk_variant_requests_key_not_blank
    check (btrim(idempotency_key) <> ''),
  constraint catalog_bulk_variant_requests_company_key_unique
    unique (company_id, idempotency_key)
);

alter table public.catalog_bulk_variant_requests enable row level security;

drop policy if exists catalog_bulk_variant_requests_company_authenticated
  on public.catalog_bulk_variant_requests;
create policy catalog_bulk_variant_requests_company_authenticated
  on public.catalog_bulk_variant_requests
  for all
  to authenticated
  using (
    company_id = (select private.get_user_company_id())
    and (select private.current_user_has_permission('catalog.manage', 'all'))
  )
  with check (
    company_id = (select private.get_user_company_id())
    and (select private.current_user_has_permission('catalog.manage', 'all'))
  );

drop policy if exists catalog_bulk_variant_requests_company_anon
  on public.catalog_bulk_variant_requests;
create policy catalog_bulk_variant_requests_company_anon
  on public.catalog_bulk_variant_requests
  for all
  to anon
  using (
    company_id = (select private.get_user_company_id())
    and (select private.current_user_has_permission('catalog.manage', 'all'))
  )
  with check (
    company_id = (select private.get_user_company_id())
    and (select private.current_user_has_permission('catalog.manage', 'all'))
  );

revoke all on table public.catalog_bulk_variant_requests from public, anon, authenticated;
grant select, insert on table public.catalog_bulk_variant_requests to anon, authenticated;

-- The RPC performs normalized checks too. These indexes close the concurrency
-- gap for future catalog writers without imposing a matrix-signature index on
-- the two known legacy duplicate-signature groups.
create unique index if not exists catalog_options_item_name_normalized_active_unique
  on public.catalog_options (
    catalog_item_id,
    lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))
  )
  where deleted_at is null;

create unique index if not exists catalog_option_values_value_normalized_active_unique
  on public.catalog_option_values (
    option_id,
    lower(regexp_replace(btrim(value), '[[:space:]]+', ' ', 'g'))
  )
  where deleted_at is null;

create or replace function public.catalog_bulk_expand_variants(
  p_company_id uuid,
  p_idempotency_key text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'private', 'pg_temp'
as $function$
declare
  v_actor_company_id uuid;
  v_existing_request jsonb;
  v_existing_response jsonb;
  v_response jsonb;
  v_saved_at timestamptz;
  v_family jsonb;
  v_family_id uuid;
  v_family_ids uuid[];
  v_family_count integer := 0;
  v_distinct_family_count integer := 0;
  v_axis_name text;
  v_axis_key text;
  v_existing_value text;
  v_existing_value_key text;
  v_new_values jsonb;
  v_new_value_text text;
  v_new_value_key text;
  v_current_source jsonb;
  v_expected_source jsonb;
  v_target_option_id uuid;
  v_existing_value_id uuid;
  v_new_value_id uuid;
  v_new_option_sort integer;
  v_new_value_sort integer;
  v_option_count integer;
  v_match_count integer;
  v_source_count integer;
  v_assignment_delta integer;
  v_existing_assignment_count integer := 0;
  v_new_variant_count integer := 0;
  v_skipped_count integer := 0;
  v_source record;
  v_new_variant_id uuid;
  v_desired_value_ids uuid[];
  v_existing_combination boolean;
begin
  v_actor_company_id := private.get_user_company_id();
  if v_actor_company_id is null or v_actor_company_id <> p_company_id then
    return jsonb_build_object(
      'ok', false,
      'replayed', false,
      'error_code', 'company_forbidden',
      'message', 'This catalog is not available to the current user.',
      'saved_at', null,
      'family_count', 0,
      'existing_variant_assignment_count', 0,
      'new_variant_count', 0,
      'options', '[]'::jsonb,
      'option_values', '[]'::jsonb,
      'variants', '[]'::jsonb,
      'variant_option_values', '[]'::jsonb
    );
  end if;

  if not private.current_user_has_permission('catalog.manage', 'all') then
    return jsonb_build_object(
      'ok', false,
      'replayed', false,
      'error_code', 'permission_denied',
      'message', 'Catalog management permission is required.',
      'saved_at', null,
      'family_count', 0,
      'existing_variant_assignment_count', 0,
      'new_variant_count', 0,
      'options', '[]'::jsonb,
      'option_values', '[]'::jsonb,
      'variants', '[]'::jsonb,
      'variant_option_values', '[]'::jsonb
    );
  end if;

  if p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or p_idempotency_key is null
     or p_idempotency_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return jsonb_build_object(
      'ok', false,
      'replayed', false,
      'error_code', 'invalid_payload',
      'message', 'The bulk variant request is incomplete.',
      'saved_at', null,
      'family_count', 0,
      'existing_variant_assignment_count', 0,
      'new_variant_count', 0,
      'options', '[]'::jsonb,
      'option_values', '[]'::jsonb,
      'variants', '[]'::jsonb,
      'variant_option_values', '[]'::jsonb
    );
  end if;

  -- Serialize company-scoped expansions so receipt checks and the complete
  -- read/validate/write sequence cannot interleave across app sessions.
  perform pg_advisory_xact_lock(
    hashtextextended('catalog_bulk_expand_variants:' || p_company_id::text, 0)
  );

  select request_payload, response_payload
    into v_existing_request, v_existing_response
    from public.catalog_bulk_variant_requests
   where company_id = p_company_id
     and idempotency_key = p_idempotency_key;

  if v_existing_response is not null then
    if v_existing_request is distinct from p_payload then
      return jsonb_build_object(
        'ok', false,
        'replayed', false,
        'error_code', 'idempotency_conflict',
        'message', 'This request key was already used for a different catalog update.',
        'saved_at', null,
        'family_count', 0,
        'existing_variant_assignment_count', 0,
        'new_variant_count', 0,
        'options', '[]'::jsonb,
        'option_values', '[]'::jsonb,
        'variants', '[]'::jsonb,
        'variant_option_values', '[]'::jsonb
      );
    end if;
    return jsonb_set(v_existing_response, '{replayed}', 'true'::jsonb, true);
  end if;

  v_axis_name := regexp_replace(btrim(coalesce(p_payload ->> 'axis_name', '')), '[[:space:]]+', ' ', 'g');
  v_axis_key := lower(v_axis_name);
  v_existing_value := regexp_replace(btrim(coalesce(p_payload ->> 'existing_value', '')), '[[:space:]]+', ' ', 'g');
  v_existing_value_key := lower(v_existing_value);
  v_new_values := coalesce(p_payload -> 'new_values', '[]'::jsonb);

  if v_axis_name = ''
     or v_existing_value = ''
     or jsonb_typeof(v_new_values) <> 'array'
     or jsonb_array_length(v_new_values) < 1
     or jsonb_array_length(v_new_values) > 20
     or jsonb_typeof(coalesce(p_payload -> 'families', 'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_payload -> 'families') < 1
     or jsonb_array_length(p_payload -> 'families') > 200 then
    return jsonb_build_object(
      'ok', false,
      'replayed', false,
      'error_code', 'invalid_payload',
      'message', 'Enter one existing value, at least one new value, and one or more families.',
      'saved_at', null,
      'family_count', 0,
      'existing_variant_assignment_count', 0,
      'new_variant_count', 0,
      'options', '[]'::jsonb,
      'option_values', '[]'::jsonb,
      'variants', '[]'::jsonb,
      'variant_option_values', '[]'::jsonb
    );
  end if;

  if exists (
    select 1
      from jsonb_array_elements(v_new_values) requested(value)
     where jsonb_typeof(requested.value) <> 'string'
  ) or exists (
    select 1
      from jsonb_array_elements_text(v_new_values) requested(value)
     where regexp_replace(btrim(requested.value), '[[:space:]]+', ' ', 'g') = ''
  ) or exists (
    select 1
      from jsonb_array_elements_text(v_new_values) requested(value)
     group by lower(regexp_replace(btrim(requested.value), '[[:space:]]+', ' ', 'g'))
    having count(*) > 1
  ) or exists (
    select 1
      from jsonb_array_elements_text(v_new_values) requested(value)
     where lower(regexp_replace(btrim(requested.value), '[[:space:]]+', ' ', 'g'))
       = v_existing_value_key
  ) then
    return jsonb_build_object(
      'ok', false,
      'replayed', false,
      'error_code', 'invalid_new_values',
      'message', 'New values must be unique and different from the existing value.',
      'saved_at', null,
      'family_count', 0,
      'existing_variant_assignment_count', 0,
      'new_variant_count', 0,
      'options', '[]'::jsonb,
      'option_values', '[]'::jsonb,
      'variants', '[]'::jsonb,
      'variant_option_values', '[]'::jsonb
    );
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_payload -> 'families') requested(entry)
     where coalesce(requested.entry ->> 'family_id', '')
             !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or coalesce(requested.entry ->> 'source_fingerprint', '') !~ '^[0-9a-f]{64}$'
        or jsonb_typeof(coalesce(requested.entry -> 'source', 'null'::jsonb)) <> 'object'
        or requested.entry #>> '{source,id}' <> requested.entry ->> 'family_id'
  ) then
    return jsonb_build_object(
      'ok', false,
      'replayed', false,
      'error_code', 'invalid_family_payload',
      'message', 'One or more selected families could not be read safely.',
      'saved_at', null,
      'family_count', 0,
      'existing_variant_assignment_count', 0,
      'new_variant_count', 0,
      'options', '[]'::jsonb,
      'option_values', '[]'::jsonb,
      'variants', '[]'::jsonb,
      'variant_option_values', '[]'::jsonb
    );
  end if;

  select
    array_agg((entry ->> 'family_id')::uuid order by (entry ->> 'family_id')::uuid),
    count(*),
    count(distinct entry ->> 'family_id')
    into v_family_ids, v_family_count, v_distinct_family_count
    from jsonb_array_elements(p_payload -> 'families') requested(entry);

  if v_family_count <> v_distinct_family_count then
    return jsonb_build_object(
      'ok', false,
      'replayed', false,
      'error_code', 'duplicate_family',
      'message', 'Each family can only be selected once.',
      'saved_at', null,
      'family_count', 0,
      'existing_variant_assignment_count', 0,
      'new_variant_count', 0,
      'options', '[]'::jsonb,
      'option_values', '[]'::jsonb,
      'variants', '[]'::jsonb,
      'variant_option_values', '[]'::jsonb
    );
  end if;

  perform 1
    from public.catalog_items ci
   where ci.id = any(v_family_ids)
   order by ci.id
   for update;

  if (
    select count(*)
      from public.catalog_items ci
     where ci.id = any(v_family_ids)
       and ci.company_id = p_company_id
       and ci.deleted_at is null
       and ci.is_active
  ) <> v_family_count then
    return jsonb_build_object(
      'ok', false,
      'replayed', false,
      'error_code', 'family_forbidden',
      'message', 'A selected family is no longer available.',
      'saved_at', null,
      'family_count', 0,
      'existing_variant_assignment_count', 0,
      'new_variant_count', 0,
      'options', '[]'::jsonb,
      'option_values', '[]'::jsonb,
      'variants', '[]'::jsonb,
      'variant_option_values', '[]'::jsonb
    );
  end if;

  perform 1
    from public.catalog_variants cv
   where cv.catalog_item_id = any(v_family_ids)
     and cv.deleted_at is null
     and cv.is_active
   order by cv.id
   for update;

  -- Complete preflight for every family before the first write.
  for v_family in
    select entry
      from jsonb_array_elements(p_payload -> 'families') requested(entry)
     order by entry ->> 'family_id'
  loop
    v_family_id := (v_family ->> 'family_id')::uuid;
    v_expected_source := v_family -> 'source';

    select jsonb_build_object(
      'id', ci.id::text,
      'name', ci.name,
      'options', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', co.id::text,
            'name', co.name,
            'sortOrder', co.sort_order,
            'values', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'id', cov.id::text,
                  'value', cov.value,
                  'sortOrder', cov.sort_order
                ) order by cov.sort_order, cov.id
              )
                from public.catalog_option_values cov
               where cov.option_id = co.id
                 and cov.deleted_at is null
            ), '[]'::jsonb)
          ) order by co.sort_order, co.id
        )
          from public.catalog_options co
         where co.catalog_item_id = ci.id
           and co.deleted_at is null
      ), '[]'::jsonb),
      'variants', coalesce((
        select jsonb_agg(
          jsonb_strip_nulls(jsonb_build_object(
            'id', cv.id::text,
            'sku', cv.sku,
            'quantity', cv.quantity,
            'priceOverride', cv.price_override,
            'unitCostOverride', cv.unit_cost_override,
            'warningThreshold', cv.warning_threshold,
            'criticalThreshold', cv.critical_threshold,
            'unitId', cv.unit_id::text,
            'isActive', cv.is_active,
            'optionValueIds', coalesce((
              select jsonb_agg(cvov.option_value_id::text order by cvov.option_value_id::text)
                from public.catalog_variant_option_values cvov
               where cvov.variant_id = cv.id
                 and cvov.deleted_at is null
            ), '[]'::jsonb)
          )) order by cv.id
        )
          from public.catalog_variants cv
         where cv.catalog_item_id = ci.id
           and cv.deleted_at is null
           and cv.is_active
      ), '[]'::jsonb)
    )
      into v_current_source
      from public.catalog_items ci
     where ci.id = v_family_id;

    if v_current_source is distinct from v_expected_source then
      return jsonb_build_object(
        'ok', false,
        'replayed', false,
        'error_code', 'stale_catalog',
        'message', 'The catalog changed while this update was being prepared. Review the latest variants and try again.',
        'saved_at', null,
        'family_count', v_family_count,
        'existing_variant_assignment_count', 0,
        'new_variant_count', 0,
        'options', '[]'::jsonb,
        'option_values', '[]'::jsonb,
        'variants', '[]'::jsonb,
        'variant_option_values', '[]'::jsonb
      );
    end if;

    if exists (
      select 1
        from public.catalog_options co
       where co.catalog_item_id = v_family_id
         and co.deleted_at is null
       group by lower(regexp_replace(btrim(co.name), '[[:space:]]+', ' ', 'g'))
      having count(*) > 1
    ) then
      return jsonb_build_object(
        'ok', false, 'replayed', false, 'error_code', 'duplicate_option_axis',
        'message', 'A selected family has duplicate option names.',
        'saved_at', null, 'family_count', v_family_count,
        'existing_variant_assignment_count', 0, 'new_variant_count', 0,
        'options', '[]'::jsonb, 'option_values', '[]'::jsonb,
        'variants', '[]'::jsonb, 'variant_option_values', '[]'::jsonb
      );
    end if;

    if exists (
      select 1
        from public.catalog_options co
        join public.catalog_option_values cov on cov.option_id = co.id and cov.deleted_at is null
       where co.catalog_item_id = v_family_id
         and co.deleted_at is null
       group by co.id, lower(regexp_replace(btrim(cov.value), '[[:space:]]+', ' ', 'g'))
      having count(*) > 1
    ) then
      return jsonb_build_object(
        'ok', false, 'replayed', false, 'error_code', 'duplicate_option_value',
        'message', 'A selected family has duplicate option values.',
        'saved_at', null, 'family_count', v_family_count,
        'existing_variant_assignment_count', 0, 'new_variant_count', 0,
        'options', '[]'::jsonb, 'option_values', '[]'::jsonb,
        'variants', '[]'::jsonb, 'variant_option_values', '[]'::jsonb
      );
    end if;

    select count(*)
      into v_option_count
      from public.catalog_options co
     where co.catalog_item_id = v_family_id
       and co.deleted_at is null;

    if not exists (
      select 1
        from public.catalog_variants cv
       where cv.catalog_item_id = v_family_id
         and cv.deleted_at is null
         and cv.is_active
    ) then
      return jsonb_build_object(
        'ok', false, 'replayed', false, 'error_code', 'source_variants_missing',
        'message', 'A selected family has no active variants to expand.',
        'saved_at', null, 'family_count', v_family_count,
        'existing_variant_assignment_count', 0, 'new_variant_count', 0,
        'options', '[]'::jsonb, 'option_values', '[]'::jsonb,
        'variants', '[]'::jsonb, 'variant_option_values', '[]'::jsonb
      );
    end if;

    if exists (
      select 1
        from public.catalog_variants cv
       where cv.catalog_item_id = v_family_id
         and cv.deleted_at is null
         and cv.is_active
         and (
           (
             select count(*)
               from public.catalog_variant_option_values cvov
              where cvov.variant_id = cv.id
                and cvov.deleted_at is null
           ) <> v_option_count
           or (
             select count(distinct co.id)
               from public.catalog_variant_option_values cvov
               join public.catalog_option_values cov
                 on cov.id = cvov.option_value_id and cov.deleted_at is null
               join public.catalog_options co
                 on co.id = cov.option_id
                and co.deleted_at is null
                and co.catalog_item_id = v_family_id
              where cvov.variant_id = cv.id
                and cvov.deleted_at is null
           ) <> v_option_count
         )
    ) then
      return jsonb_build_object(
        'ok', false, 'replayed', false, 'error_code', 'unsafe_variant_options',
        'message', 'A selected family has an incomplete or ambiguous variant combination.',
        'saved_at', null, 'family_count', v_family_count,
        'existing_variant_assignment_count', 0, 'new_variant_count', 0,
        'options', '[]'::jsonb, 'option_values', '[]'::jsonb,
        'variants', '[]'::jsonb, 'variant_option_values', '[]'::jsonb
      );
    end if;

    if exists (
      select 1
        from (
          select coalesce(
            array_agg(cvov.option_value_id order by cvov.option_value_id)
              filter (where cvov.option_value_id is not null),
            array[]::uuid[]
          )::text signature
            from public.catalog_variants cv
            left join public.catalog_variant_option_values cvov
              on cvov.variant_id = cv.id and cvov.deleted_at is null
           where cv.catalog_item_id = v_family_id
             and cv.deleted_at is null
             and cv.is_active
           group by cv.id
        ) signatures
       group by signatures.signature
      having count(*) > 1
    ) then
      return jsonb_build_object(
        'ok', false, 'replayed', false, 'error_code', 'duplicate_variant_signature',
        'message', 'A selected family has duplicate variant combinations.',
        'saved_at', null, 'family_count', v_family_count,
        'existing_variant_assignment_count', 0, 'new_variant_count', 0,
        'options', '[]'::jsonb, 'option_values', '[]'::jsonb,
        'variants', '[]'::jsonb, 'variant_option_values', '[]'::jsonb
      );
    end if;

    select count(*)
      into v_match_count
      from public.catalog_options co
     where co.catalog_item_id = v_family_id
       and co.deleted_at is null
       and lower(regexp_replace(btrim(co.name), '[[:space:]]+', ' ', 'g')) = v_axis_key;

    if v_match_count = 1 then
      select co.id
        into v_target_option_id
        from public.catalog_options co
       where co.catalog_item_id = v_family_id
         and co.deleted_at is null
         and lower(regexp_replace(btrim(co.name), '[[:space:]]+', ' ', 'g')) = v_axis_key;

      select count(*)
        into v_match_count
        from public.catalog_option_values cov
       where cov.option_id = v_target_option_id
         and cov.deleted_at is null
         and lower(regexp_replace(btrim(cov.value), '[[:space:]]+', ' ', 'g')) = v_existing_value_key;

      if v_match_count <> 1 then
        return jsonb_build_object(
          'ok', false, 'replayed', false, 'error_code', 'existing_value_missing',
          'message', 'The existing value is missing or duplicated in a selected family.',
          'saved_at', null, 'family_count', v_family_count,
          'existing_variant_assignment_count', 0, 'new_variant_count', 0,
          'options', '[]'::jsonb, 'option_values', '[]'::jsonb,
          'variants', '[]'::jsonb, 'variant_option_values', '[]'::jsonb
        );
      end if;

      select cov.id
        into v_existing_value_id
        from public.catalog_option_values cov
       where cov.option_id = v_target_option_id
         and cov.deleted_at is null
         and lower(regexp_replace(btrim(cov.value), '[[:space:]]+', ' ', 'g')) = v_existing_value_key;

      select count(*)
        into v_source_count
        from public.catalog_variants cv
        join public.catalog_variant_option_values cvov
          on cvov.variant_id = cv.id
         and cvov.option_value_id = v_existing_value_id
         and cvov.deleted_at is null
       where cv.catalog_item_id = v_family_id
         and cv.deleted_at is null
         and cv.is_active;

      if v_source_count = 0 then
        return jsonb_build_object(
          'ok', false, 'replayed', false, 'error_code', 'source_variants_missing',
          'message', 'No active variant carries the selected existing value.',
          'saved_at', null, 'family_count', v_family_count,
          'existing_variant_assignment_count', 0, 'new_variant_count', 0,
          'options', '[]'::jsonb, 'option_values', '[]'::jsonb,
          'variants', '[]'::jsonb, 'variant_option_values', '[]'::jsonb
        );
      end if;
    end if;

    v_target_option_id := null;
    v_existing_value_id := null;
  end loop;

  -- Mutation phase. Every selected family passed preflight; any later error
  -- rolls this single RPC transaction back.
  for v_family in
    select entry
      from jsonb_array_elements(p_payload -> 'families') requested(entry)
     order by entry ->> 'family_id'
  loop
    v_family_id := (v_family ->> 'family_id')::uuid;
    v_target_option_id := null;
    v_existing_value_id := null;

    select co.id
      into v_target_option_id
      from public.catalog_options co
     where co.catalog_item_id = v_family_id
       and co.deleted_at is null
       and lower(regexp_replace(btrim(co.name), '[[:space:]]+', ' ', 'g')) = v_axis_key;

    if v_target_option_id is null then
      select coalesce(max(co.sort_order), -1) + 1
        into v_new_option_sort
        from public.catalog_options co
       where co.catalog_item_id = v_family_id
         and co.deleted_at is null;

      insert into public.catalog_options (catalog_item_id, name, sort_order)
      values (v_family_id, v_axis_name, v_new_option_sort)
      returning id into v_target_option_id;

      insert into public.catalog_option_values (option_id, value, sort_order)
      values (v_target_option_id, v_existing_value, 0)
      returning id into v_existing_value_id;

      insert into public.catalog_variant_option_values (variant_id, option_value_id)
      select cv.id, v_existing_value_id
        from public.catalog_variants cv
       where cv.catalog_item_id = v_family_id
         and cv.deleted_at is null
         and cv.is_active
      on conflict do nothing;

      get diagnostics v_assignment_delta = row_count;
      v_existing_assignment_count := v_existing_assignment_count + v_assignment_delta;
    else
      select cov.id
        into v_existing_value_id
        from public.catalog_option_values cov
       where cov.option_id = v_target_option_id
         and cov.deleted_at is null
         and lower(regexp_replace(btrim(cov.value), '[[:space:]]+', ' ', 'g')) = v_existing_value_key;
    end if;

    for v_new_value_text in
      select regexp_replace(btrim(value), '[[:space:]]+', ' ', 'g')
        from jsonb_array_elements_text(v_new_values) with ordinality requested(value, position)
       order by position
    loop
      v_new_value_key := lower(v_new_value_text);
      v_new_value_id := null;

      select cov.id
        into v_new_value_id
        from public.catalog_option_values cov
       where cov.option_id = v_target_option_id
         and cov.deleted_at is null
         and lower(regexp_replace(btrim(cov.value), '[[:space:]]+', ' ', 'g')) = v_new_value_key;

      if v_new_value_id is null then
        select coalesce(max(cov.sort_order), -1) + 1
          into v_new_value_sort
          from public.catalog_option_values cov
         where cov.option_id = v_target_option_id
           and cov.deleted_at is null;

        insert into public.catalog_option_values (option_id, value, sort_order)
        values (v_target_option_id, v_new_value_text, v_new_value_sort)
        returning id into v_new_value_id;
      end if;

      for v_source in
        select cv.*
          from public.catalog_variants cv
          join public.catalog_variant_option_values cvov
            on cvov.variant_id = cv.id
           and cvov.option_value_id = v_existing_value_id
           and cvov.deleted_at is null
         where cv.catalog_item_id = v_family_id
           and cv.deleted_at is null
           and cv.is_active
         order by cv.id
      loop
        select array_agg(value_id order by value_id)
          into v_desired_value_ids
          from (
            select cvov.option_value_id value_id
              from public.catalog_variant_option_values cvov
              join public.catalog_option_values cov
                on cov.id = cvov.option_value_id and cov.deleted_at is null
             where cvov.variant_id = v_source.id
               and cvov.deleted_at is null
               and cov.option_id <> v_target_option_id
            union all
            select v_new_value_id
          ) desired;

        select exists (
          select 1
            from public.catalog_variants existing_variant
           where existing_variant.catalog_item_id = v_family_id
             and existing_variant.deleted_at is null
             and existing_variant.is_active
             and (
               select array_agg(cvov.option_value_id order by cvov.option_value_id)
                 from public.catalog_variant_option_values cvov
                where cvov.variant_id = existing_variant.id
                  and cvov.deleted_at is null
             ) = v_desired_value_ids
        ) into v_existing_combination;

        if v_existing_combination then
          v_skipped_count := v_skipped_count + 1;
          continue;
        end if;

        insert into public.catalog_variants (
          company_id,
          catalog_item_id,
          sku,
          quantity,
          price_override,
          unit_cost_override,
          warning_threshold,
          critical_threshold,
          unit_id,
          is_active
        ) values (
          p_company_id,
          v_family_id,
          null,
          0,
          v_source.price_override,
          v_source.unit_cost_override,
          v_source.warning_threshold,
          v_source.critical_threshold,
          v_source.unit_id,
          v_source.is_active
        ) returning id into v_new_variant_id;

        insert into public.catalog_variant_option_values (variant_id, option_value_id)
        select v_new_variant_id, desired_id
          from unnest(v_desired_value_ids) desired(desired_id);

        v_new_variant_count := v_new_variant_count + 1;
      end loop;
    end loop;
  end loop;

  v_saved_at := clock_timestamp();
  v_response := jsonb_build_object(
    'ok', true,
    'replayed', false,
    'error_code', null,
    'message', null,
    'saved_at', v_saved_at,
    'family_count', v_family_count,
    'existing_variant_assignment_count', v_existing_assignment_count,
    'new_variant_count', v_new_variant_count,
    'skipped_existing_combination_count', v_skipped_count,
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', co.id,
        'catalog_item_id', co.catalog_item_id,
        'name', co.name,
        'sort_order', co.sort_order,
        'created_at', co.created_at
      ) order by co.catalog_item_id, co.sort_order, co.id)
        from public.catalog_options co
       where co.catalog_item_id = any(v_family_ids)
         and co.deleted_at is null
    ), '[]'::jsonb),
    'option_values', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cov.id,
        'option_id', cov.option_id,
        'value', cov.value,
        'sort_order', cov.sort_order
      ) order by cov.option_id, cov.sort_order, cov.id)
        from public.catalog_option_values cov
        join public.catalog_options co on co.id = cov.option_id and co.deleted_at is null
       where co.catalog_item_id = any(v_family_ids)
         and cov.deleted_at is null
    ), '[]'::jsonb),
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cv.id,
        'company_id', cv.company_id,
        'catalog_item_id', cv.catalog_item_id,
        'sku', cv.sku,
        'quantity', cv.quantity,
        'price_override', cv.price_override,
        'unit_cost_override', cv.unit_cost_override,
        'warning_threshold', cv.warning_threshold,
        'critical_threshold', cv.critical_threshold,
        'unit_id', cv.unit_id,
        'is_active', cv.is_active,
        'created_at', cv.created_at,
        'updated_at', cv.updated_at,
        'deleted_at', cv.deleted_at
      ) order by cv.catalog_item_id, cv.id)
        from public.catalog_variants cv
       where cv.catalog_item_id = any(v_family_ids)
         and cv.deleted_at is null
         and cv.is_active
    ), '[]'::jsonb),
    'variant_option_values', coalesce((
      select jsonb_agg(jsonb_build_object(
        'variant_id', cvov.variant_id,
        'option_value_id', cvov.option_value_id
      ) order by cvov.variant_id, cvov.option_value_id)
        from public.catalog_variant_option_values cvov
        join public.catalog_variants cv
          on cv.id = cvov.variant_id and cv.deleted_at is null and cv.is_active
       where cv.catalog_item_id = any(v_family_ids)
         and cvov.deleted_at is null
    ), '[]'::jsonb)
  );

  insert into public.catalog_bulk_variant_requests (
    company_id,
    idempotency_key,
    request_payload,
    response_payload
  ) values (
    p_company_id,
    p_idempotency_key,
    p_payload,
    v_response
  );

  return v_response;
end;
$function$;

revoke all on function public.catalog_bulk_expand_variants(uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.catalog_bulk_expand_variants(uuid, text, jsonb)
  to anon, authenticated;

comment on function public.catalog_bulk_expand_variants(uuid, text, jsonb) is
  'Atomically adds one catalog option axis across selected families. Existing variant identities and inventory/history stay in place; cloned variants start at zero with blank SKUs. Company-scoped requests are permission-checked, stale-safe, and idempotent.';

commit;
