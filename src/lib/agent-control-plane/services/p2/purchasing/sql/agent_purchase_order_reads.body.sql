begin;

set local timezone = 'UTC';

-- Task 19 canonical purchase-order read body. Public RPCs are fixed,
-- service-role-only wrappers; every private projection is bounded and dark.
do $prerequisites$
declare
  v_missing text[];
begin
  select pg_catalog.array_agg(required.object_name order by required.object_name)
    into v_missing
  from (
    values
      ('function', 'private.resolve_agent_actor_authority(uuid,uuid,text[])'),
      ('function', 'private.agent_p2_optional_canonical_text(text,integer,integer,boolean)'),
      ('function', 'private.agent_rfc3339_utc(timestamp with time zone)'),
      ('function', 'private.canonical_agent_projection_json(jsonb)'),
      ('function', 'private.mcp_oauth_labels_for_scopes(text[],text)'),
      ('function', 'private.agent_currency_minor_exponent_or_null(text)'),
      ('function', 'private.agent_money_to_minor_units(numeric,text)'),
      ('function', 'private.agent_p2_catalog_milliunits_v1(numeric)'),
      ('function', 'auth.role()'),
      ('function', 'extensions.digest(bytea,text)'),
      ('table', 'private.agent_read_domain_revisions'),
      ('table', 'private.mcp_oauth_clients'),
      ('table', 'private.mcp_oauth_grants'),
      ('table', 'public.companies'),
      ('table', 'public.catalog_orders'),
      ('table', 'public.catalog_order_items'),
      ('table', 'public.catalog_variants'),
      ('table', 'public.catalog_items'),
      ('table', 'public.catalog_units'),
      ('table', 'public.catalog_options'),
      ('table', 'public.catalog_option_values'),
      ('table', 'public.catalog_variant_option_values'),
      ('table', 'public.catalog_supplier_cost_profiles')
  ) required(object_kind, object_name)
  where case required.object_kind
    when 'function' then pg_catalog.to_regprocedure(required.object_name) is null
    else pg_catalog.to_regclass(required.object_name) is null
  end;
  if v_missing is not null then
    raise exception 'agent_purchase_order_reads_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;
end;
$prerequisites$;

create or replace function private.agent_p2_purchase_order_hash_ref_v1(
  p_prefix text,
  p_material jsonb
) returns text
language plpgsql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $function$
begin
  if p_prefix not in (
    'ops_proof:v1:', 'ops_evidence:v1:', 'sha256:'
  ) then
    raise exception 'invalid_agent_purchase_order_hash_prefix'
      using errcode = '22023';
  end if;
  return p_prefix || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        private.canonical_agent_projection_json(p_material),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
end;
$function$;

create or replace function private.agent_p2_purchase_order_list_v1(
  p_request_id text,
  p_company_id uuid,
  p_actor_user_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_manifest_revision text,
  p_capability_id text,
  p_capability_revision text,
  p_authorization_candidates jsonb,
  p_statuses text[],
  p_supplier_label text,
  p_delivery_starts_on date,
  p_delivery_ends_on date,
  p_include_costs boolean,
  p_item_limit integer,
  p_page_fetch_limit integer,
  p_source_limit integer,
  p_line_fetch_limit integer,
  p_cursor_read_at timestamptz,
  p_cursor_source_revisions jsonb,
  p_after_delivery_sort_date date,
  p_after_updated_at timestamptz,
  p_after_order_id uuid
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_source_revisions jsonb;
  v_proof_candidates jsonb;
  v_read_at timestamptz;
  v_read_at_text text;
  v_order_ids uuid[] := array[]::uuid[];
  v_order_id uuid;
  v_order_count integer;
  v_line_count integer;
  v_all_items jsonb := '[]'::jsonb;
  v_candidate_items jsonb := '[]'::jsonb;
  v_candidate_count integer;
  v_has_more boolean;
  v_cost_state jsonb;
  v_cost_count integer := 0;
  v_cost_witness text;
  v_variant_ids uuid[] := array[]::uuid[];
  v_query jsonb;
  v_cursor_predecessor jsonb;
  v_source_inspected jsonb;
  v_proof_context jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_children jsonb := '[]'::jsonb;
  v_item jsonb;
  v_proof_ref text;
  v_evidence_ref text;
  v_returned_count integer := 0;
  v_record record;
  v_current_revisions jsonb;
begin
  if p_request_id is null
     or pg_catalog.char_length(p_request_id) not between 1 and 256
     or p_capability_manifest_revision is distinct from
          '2026-08-22.capability-manifest.v8'
     or p_capability_id is distinct from 'list_purchase_orders'
     or p_capability_revision is distinct from
          'list_purchase_orders:2026-08-22.v1'
     or p_item_limit not between 1 and 25
     or p_page_fetch_limit is distinct from p_item_limit + 1
     or p_page_fetch_limit not between 2 and 26
     or p_source_limit is distinct from 501
     or p_line_fetch_limit is distinct from 51
     or p_statuses is null
     or pg_catalog.cardinality(p_statuses) not between 1 and 5
     or not p_statuses <@ array[
          'cancelled', 'draft', 'fulfilled', 'sent', 'suggested'
        ]::text[]
     or p_statuses is distinct from (
       select pg_catalog.array_agg(
         status.value order by status.value collate "C"
       )
       from (
         select distinct source.value
         from pg_catalog.unnest(p_statuses) source(value)
       ) status
     )
     or p_supplier_label is not null and
          private.agent_p2_optional_canonical_text(
            p_supplier_label, 160, 640, true
          ) is distinct from p_supplier_label
     or (p_delivery_starts_on is null) is distinct from
          (p_delivery_ends_on is null)
     or p_delivery_starts_on is not null and (
       p_delivery_starts_on > p_delivery_ends_on
       or p_delivery_ends_on - p_delivery_starts_on > 366
     )
     or p_include_costs is null
     or p_cursor_source_revisions is null
     or pg_catalog.jsonb_typeof(p_cursor_source_revisions)
          is distinct from 'array'
     or (p_cursor_read_at is null) is distinct from (
       p_after_delivery_sort_date is null
       and p_after_updated_at is null
       and p_after_order_id is null
       and p_cursor_source_revisions = '[]'::jsonb
     )
     or p_cursor_read_at is not null and (
       not pg_catalog.isfinite(p_cursor_read_at)
       or p_cursor_read_at is distinct from pg_catalog.date_trunc(
            'milliseconds', p_cursor_read_at
          )
       or p_after_delivery_sort_date is null
       or p_after_updated_at is null
       or not pg_catalog.isfinite(p_after_updated_at)
       or p_after_updated_at is distinct from pg_catalog.date_trunc(
            'milliseconds', p_after_updated_at
          )
       or p_after_order_id is null
     ) then
    raise exception 'invalid_agent_purchase_order_list_request'
      using errcode = '22023';
  end if;

  v_context := private.agent_p2_purchase_order_read_context_v1(
    p_actor_user_id, p_company_id, p_oauth_grant_id, p_oauth_client_id,
    p_grant_revision, p_granted_scope_ceiling,
    p_permission_snapshot_revision, p_registered_permission_keys,
    p_authorization_candidates, p_include_costs
  );
  if v_context is null then
    raise exception 'agent_purchase_order_not_authorized'
      using errcode = '42501';
  end if;
  v_source_revisions := v_context -> 'source_revisions';
  v_proof_candidates := v_context -> 'proof_authorization_candidates';
  if p_cursor_read_at is not null and (
    p_cursor_source_revisions is distinct from v_source_revisions
    or p_cursor_read_at > pg_catalog.statement_timestamp()
    or p_cursor_read_at <= pg_catalog.statement_timestamp() - interval '15 minutes'
  ) then
    raise exception 'agent_purchase_order_read_stale' using errcode = '40001';
  end if;
  v_read_at := coalesce(
    p_cursor_read_at,
    pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp())
  );
  v_read_at_text := private.agent_rfc3339_utc(v_read_at);

  select coalesce(
           pg_catalog.array_agg(source.id order by source.id),
           array[]::uuid[]
         )
    into v_order_ids
  from (
    select purchase_order.id
    from public.catalog_orders purchase_order
    where purchase_order.company_id = p_company_id
      and purchase_order.deleted_at is null
    order by purchase_order.id
    limit 501
  ) source;
  v_order_count := pg_catalog.cardinality(v_order_ids);
  if v_order_count >= p_source_limit then
    raise exception 'agent_purchase_order_source_bound' using errcode = '54000';
  end if;

  select pg_catalog.count(*)::integer,
         coalesce(
           pg_catalog.array_agg(
             distinct source.catalog_variant_id
             order by source.catalog_variant_id
           ),
           array[]::uuid[]
         )
    into v_line_count, v_variant_ids
  from (
    select order_line.id, order_line.catalog_variant_id
    from public.catalog_order_items order_line
    join public.catalog_orders purchase_order
      on purchase_order.id = order_line.order_id
     and purchase_order.company_id = p_company_id
     and purchase_order.deleted_at is null
    order by order_line.order_id, order_line.id
    limit 501
  ) source;
  if v_line_count >= p_source_limit then
    raise exception 'agent_purchase_order_source_bound' using errcode = '54000';
  end if;

  foreach v_order_id in array v_order_ids loop
    v_item := private.agent_p2_purchase_order_item_v1(
      p_company_id, v_order_id, p_include_costs, p_line_fetch_limit
    );
    if v_item is null then
      raise exception 'agent_purchase_order_source_data_invalid'
        using errcode = '22000';
    end if;
    v_all_items := v_all_items || pg_catalog.jsonb_build_array(v_item);
  end loop;

  if p_include_costs then
    v_cost_state := private.agent_p2_purchase_order_cost_witness_v1(
      p_company_id, v_variant_ids, p_source_limit
    );
    v_cost_count := (v_cost_state ->> 'count')::integer;
    v_cost_witness := v_cost_state ->> 'witness';
  end if;

  select coalesce(
           pg_catalog.jsonb_agg(source.item order by source.delivery_sort_date,
             source.updated_at desc, source.order_id),
           '[]'::jsonb
         ),
         pg_catalog.count(*)::integer
    into v_candidate_items, v_candidate_count
  from (
    select item.value as item,
           coalesce(
             (item.value ->> 'expected_delivery_date')::date,
             date '9999-12-31'
           ) as delivery_sort_date,
           (item.value ->> 'updated_at')::timestamptz as updated_at,
           (item.value #>> '{purchase_order_ref,id}')::uuid as order_id
    from pg_catalog.jsonb_array_elements(v_all_items) item(value)
    where item.value ->> 'status' = any(p_statuses)
      and (
        p_supplier_label is null
        or item.value ->> 'supplier_label' is not null
           and private.agent_p2_purchase_order_normalized_text_v1(
                 item.value ->> 'supplier_label'
               ) = private.agent_p2_purchase_order_normalized_text_v1(
                 p_supplier_label
               )
      )
      and (
        p_delivery_starts_on is null
        or item.value ->> 'expected_delivery_date' is not null
           and (item.value ->> 'expected_delivery_date')::date between
                 p_delivery_starts_on and p_delivery_ends_on
      )
      and (
        p_after_delivery_sort_date is null
        or coalesce(
             (item.value ->> 'expected_delivery_date')::date,
             date '9999-12-31'
           ) > p_after_delivery_sort_date
        or coalesce(
             (item.value ->> 'expected_delivery_date')::date,
             date '9999-12-31'
           ) = p_after_delivery_sort_date
           and (item.value ->> 'updated_at')::timestamptz < p_after_updated_at
        or coalesce(
             (item.value ->> 'expected_delivery_date')::date,
             date '9999-12-31'
           ) = p_after_delivery_sort_date
           and (item.value ->> 'updated_at')::timestamptz = p_after_updated_at
           and (item.value #>> '{purchase_order_ref,id}')::uuid >
                 p_after_order_id
      )
    order by delivery_sort_date, updated_at desc, order_id
    limit p_page_fetch_limit
  ) source;
  v_has_more := v_candidate_count > p_item_limit;
  v_query := pg_catalog.jsonb_strip_nulls(
    pg_catalog.jsonb_build_object(
      'statuses', pg_catalog.to_jsonb(p_statuses),
      'supplier', case when p_supplier_label is null then null
        else pg_catalog.jsonb_build_object(
          'kind', 'exact_label', 'value', p_supplier_label
        ) end,
      'delivery_window', case when p_delivery_starts_on is null then null
        else pg_catalog.jsonb_build_object(
          'starts_on', pg_catalog.to_char(p_delivery_starts_on, 'YYYY-MM-DD'),
          'ends_on', pg_catalog.to_char(p_delivery_ends_on, 'YYYY-MM-DD')
        ) end,
      'sections', case when p_include_costs
        then pg_catalog.jsonb_build_array('costs') else '[]'::jsonb end,
      'limit', p_item_limit
    )
  );
  v_cursor_predecessor := case when p_cursor_read_at is null then null
    else pg_catalog.jsonb_build_object(
      'order', pg_catalog.jsonb_build_array(
        pg_catalog.to_char(p_after_delivery_sort_date, 'YYYY-MM-DD'),
        private.agent_rfc3339_utc(p_after_updated_at),
        p_after_order_id
      ),
      'tie_breaker', p_after_order_id
    ) end;
  v_source_inspected := pg_catalog.jsonb_build_object(
    'orders', v_order_count,
    'lines', v_line_count,
    'catalog_costs', v_cost_count
  );
  v_proof_context := pg_catalog.jsonb_build_object(
    'company_id', p_company_id,
    'actor_user_id', p_actor_user_id,
    'oauth_grant_id', p_oauth_grant_id,
    'oauth_client_id', p_oauth_client_id,
    'grant_revision', p_grant_revision,
    'granted_scope_ceiling', pg_catalog.to_jsonb(p_granted_scope_ceiling),
    'permission_snapshot_revision', p_permission_snapshot_revision,
    'capability_manifest_revision', p_capability_manifest_revision,
    'authorization_candidates', v_proof_candidates,
    'read_at', v_read_at_text,
    'source_revisions', v_source_revisions,
    'source_inspected', v_source_inspected,
    'catalog_cost_witness', v_cost_witness,
    'capability_id', p_capability_id,
    'capability_revision', p_capability_revision,
    'ranking_revision', 'purchase-order-ranking:2026-08-22.v1',
    'query', v_query,
    'cursor_read_at', case when p_cursor_read_at is null then null
      else private.agent_rfc3339_utc(p_cursor_read_at) end,
    'cursor_source_revisions', p_cursor_source_revisions,
    'cursor_predecessor', v_cursor_predecessor,
    'source_has_more', v_has_more
  );

  for v_record in
    select item.value as item, item.ordinality
    from pg_catalog.jsonb_array_elements(v_candidate_items)
      with ordinality item(value, ordinality)
    where item.ordinality <= p_item_limit
    order by item.ordinality
  loop
    v_item := v_record.item;
    v_proof_ref := private.agent_p2_purchase_order_hash_ref_v1(
      'ops_proof:v1:',
      v_proof_context || pg_catalog.jsonb_build_object(
        'proof_kind', 'purchase_order_list_entity',
        'order', v_item
      )
    );
    v_evidence_ref := private.agent_p2_purchase_order_hash_ref_v1(
      'ops_evidence:v1:',
      v_proof_context || pg_catalog.jsonb_build_object(
        'evidence_kind', 'purchase_order',
        'purchase_order_ref', v_item -> 'purchase_order_ref',
        'updated_at', v_item -> 'updated_at'
      )
    );
    v_rows := v_rows || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'purchase_order', v_item,
        'proof_ref', v_proof_ref,
        'evidence_ref', v_evidence_ref,
        'predecessor', pg_catalog.jsonb_build_object(
          'order', pg_catalog.jsonb_build_array(
            coalesce(
              v_item ->> 'expected_delivery_date', '9999-12-31'
            ),
            v_item ->> 'updated_at',
            v_item #>> '{purchase_order_ref,id}'
          ),
          'tie_breaker', v_item #>> '{purchase_order_ref,id}'
        )
      )
    );
    v_children := v_children || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'purchase_order_ref', v_item -> 'purchase_order_ref',
        'proof_ref', v_proof_ref,
        'evidence_ref', v_evidence_ref
      )
    );
    v_returned_count := v_returned_count + 1;
  end loop;

  select case when p_include_costs then pg_catalog.jsonb_build_array(
           pg_catalog.jsonb_build_object(
             'domain', 'catalog',
             'source_revision', catalog_revision.source_revision
           ),
           pg_catalog.jsonb_build_object(
             'domain', 'purchasing',
             'source_revision', purchasing_revision.source_revision
           )
         ) else pg_catalog.jsonb_build_array(
           pg_catalog.jsonb_build_object(
             'domain', 'purchasing',
             'source_revision', purchasing_revision.source_revision
           )
         ) end
    into v_current_revisions
  from private.agent_read_domain_revisions purchasing_revision
  left join private.agent_read_domain_revisions catalog_revision
    on catalog_revision.company_id = p_company_id
   and catalog_revision.domain = 'catalog'
  where purchasing_revision.company_id = p_company_id
    and purchasing_revision.domain = 'purchasing';
  if v_current_revisions is distinct from v_source_revisions then
    raise exception 'agent_purchase_order_read_stale' using errcode = '40001';
  end if;

  return pg_catalog.jsonb_build_object(
    'company_id', p_company_id,
    'actor_user_id', p_actor_user_id,
    'oauth_grant_id', p_oauth_grant_id,
    'oauth_client_id', p_oauth_client_id,
    'grant_revision', p_grant_revision,
    'granted_scope_ceiling', pg_catalog.to_jsonb(p_granted_scope_ceiling),
    'permission_snapshot_revision', p_permission_snapshot_revision,
    'capability_manifest_revision', p_capability_manifest_revision,
    'capability_id', p_capability_id,
    'capability_revision', p_capability_revision,
    'authorization_candidates', p_authorization_candidates,
    'selected_authorization_variants', case when p_include_costs
      then pg_catalog.jsonb_build_array('orders', 'costs')
      else pg_catalog.jsonb_build_array('orders') end,
    'query', v_query,
    'read_at', v_read_at_text,
    'source_revisions', v_source_revisions,
    'source_inspected', v_source_inspected,
    'catalog_cost_witness', v_cost_witness,
    'company_currency', v_context ->> 'currency_code',
    'ranking_revision', 'purchase-order-ranking:2026-08-22.v1',
    'item_limit', p_item_limit,
    'cursor_read_at', case when p_cursor_read_at is null then null
      else private.agent_rfc3339_utc(p_cursor_read_at) end,
    'cursor_source_revisions', p_cursor_source_revisions,
    'cursor_predecessor', v_cursor_predecessor,
    'source_has_more', v_has_more,
    'rows', v_rows,
    'collection_proof_ref', private.agent_p2_purchase_order_hash_ref_v1(
      'ops_proof:v1:',
      v_proof_context || pg_catalog.jsonb_build_object(
        'proof_kind', 'purchase_order_collection',
        'returned_count', v_returned_count,
        'has_more', v_has_more,
        'children', v_children
      )
    )
  );
end;
$function$;

create or replace function private.agent_p2_purchase_order_cost_witness_v1(
  p_company_id uuid,
  p_variant_ids uuid[],
  p_source_limit integer
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_rows jsonb;
  v_count integer;
  v_invalid boolean;
begin
  if p_company_id is null
     or p_variant_ids is null
     or p_source_limit is distinct from 501 then
    raise exception 'invalid_agent_purchase_order_cost_witness_request'
      using errcode = '22023';
  end if;
  with raw as materialized (
    select profile.id,
           profile.catalog_variant_id,
           profile.label as raw_label,
           private.agent_p2_optional_canonical_text(
             profile.label, 256, 1024, true
           ) as safe_label,
           profile.unit_cost,
           profile.currency_code,
           profile.is_default,
           profile.updated_at
    from public.catalog_supplier_cost_profiles profile
    where profile.company_id = p_company_id
      and profile.deleted_at is null
      and profile.catalog_variant_id = any(p_variant_ids)
    order by profile.catalog_variant_id, profile.is_default desc,
             profile.updated_at desc, profile.id
    limit 501
  ), validated as materialized (
    select raw.*,
           raw.safe_label is null
             or raw.unit_cost < 0
             or pg_catalog.upper(raw.currency_code) is distinct from
                  raw.currency_code
             or private.agent_currency_minor_exponent_or_null(
                  raw.currency_code
                ) is null
             or not pg_catalog.isfinite(raw.updated_at)
             or raw.updated_at is distinct from pg_catalog.date_trunc(
                  'milliseconds', raw.updated_at
                ) as invalid
    from raw
  ), summarized as materialized (
    select pg_catalog.count(*)::integer as row_count,
           coalesce(pg_catalog.bool_or(validated.invalid), false) as invalid
    from validated
  )
  select summary.row_count,
         summary.invalid,
         coalesce(
           (
             select pg_catalog.jsonb_agg(
                      pg_catalog.jsonb_build_object(
                        'id', validated.id,
                        'variant_id', validated.catalog_variant_id,
                        'label', validated.safe_label,
                        'unit_cost',
                          private.agent_p2_purchase_order_money_v1(
                            validated.unit_cost,
                            validated.currency_code
                          ),
                        'default', validated.is_default,
                        'updated_at',
                          private.agent_rfc3339_utc(validated.updated_at)
                      )
                      order by validated.catalog_variant_id,
                               validated.is_default desc,
                               validated.updated_at desc,
                               validated.id
                    )
             from validated
             where not validated.invalid
           ),
           '[]'::jsonb
         )
    into v_count, v_invalid, v_rows
  from summarized summary;
  if v_count >= p_source_limit then
    raise exception 'agent_purchase_order_source_bound' using errcode = '54000';
  end if;
  if v_invalid then
    raise exception 'agent_purchase_order_source_data_invalid'
      using errcode = '22000';
  end if;
  return pg_catalog.jsonb_build_object(
    'count', v_count,
    'witness', private.agent_p2_purchase_order_hash_ref_v1(
      'sha256:', v_rows
    )
  );
end;
$function$;

create or replace function private.agent_p2_purchase_order_item_v1(
  p_company_id uuid,
  p_purchase_order_id uuid,
  p_include_costs boolean,
  p_line_fetch_limit integer
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_order record;
  v_lines jsonb := '[]'::jsonb;
  v_line_count integer := 0;
  v_priced_count integer := 0;
  v_unpriced_count integer := 0;
  v_subtotal numeric := 0;
  v_line record;
  v_quantity_milliunits bigint;
  v_variant_label text;
  v_raw_variant_label text;
  v_label_count integer;
  v_label_invalid boolean;
  v_line_json jsonb;
  v_title text;
  v_supplier text;
begin
  if p_company_id is null
     or p_purchase_order_id is null
     or p_include_costs is null
     or p_line_fetch_limit is distinct from 51 then
    raise exception 'invalid_agent_purchase_order_item_request'
      using errcode = '22023';
  end if;
  select purchase_order.*,
         pg_catalog.upper(company.currency_code) as currency_code
    into v_order
  from public.catalog_orders purchase_order
  join public.companies company
    on company.id = purchase_order.company_id
   and company.deleted_at is null
  where purchase_order.id = p_purchase_order_id
    and purchase_order.company_id = p_company_id
    and purchase_order.deleted_at is null;
  if not found then return null; end if;

  v_title := case when v_order.title is null then null
    else private.agent_p2_optional_canonical_text(
      v_order.title, 256, 1024, true
    ) end;
  v_supplier := case when v_order.supplier_name is null then null
    else private.agent_p2_optional_canonical_text(
      v_order.supplier_name, 256, 1024, true
    ) end;
  if v_order.status not in (
       'suggested', 'draft', 'sent', 'fulfilled', 'cancelled'
     )
     or v_order.title is not null and v_title is null
     or v_order.supplier_name is not null and v_supplier is null
     or private.agent_currency_minor_exponent_or_null(
          v_order.currency_code
        ) is null
     or v_order.expected_delivery_date is not null and (
       not pg_catalog.isfinite(v_order.expected_delivery_date)
       or pg_catalog.date_part(
            'year', v_order.expected_delivery_date
          ) not between 1 and 9999
     )
     or not pg_catalog.isfinite(v_order.created_at)
     or not pg_catalog.isfinite(v_order.updated_at)
     or pg_catalog.date_part(
          'year', v_order.created_at at time zone 'UTC'
        ) not between 1 and 9999
     or pg_catalog.date_part(
          'year', v_order.updated_at at time zone 'UTC'
        ) not between 1 and 9999
     or v_order.created_at is distinct from pg_catalog.date_trunc(
          'milliseconds', v_order.created_at
        )
     or v_order.updated_at is distinct from pg_catalog.date_trunc(
          'milliseconds', v_order.updated_at
        )
     or v_order.created_at > v_order.updated_at
     or v_order.sent_at is not null and (
       not pg_catalog.isfinite(v_order.sent_at)
       or pg_catalog.date_part(
            'year', v_order.sent_at at time zone 'UTC'
          ) not between 1 and 9999
       or v_order.sent_at is distinct from pg_catalog.date_trunc(
            'milliseconds', v_order.sent_at
          )
       or v_order.sent_at not between v_order.created_at and v_order.updated_at
     )
     or v_order.fulfilled_at is not null and (
       not pg_catalog.isfinite(v_order.fulfilled_at)
       or pg_catalog.date_part(
            'year', v_order.fulfilled_at at time zone 'UTC'
          ) not between 1 and 9999
       or v_order.fulfilled_at is distinct from pg_catalog.date_trunc(
            'milliseconds', v_order.fulfilled_at
          )
       or v_order.fulfilled_at not between
            v_order.created_at and v_order.updated_at
     )
     or v_order.cancelled_at is not null and (
       not pg_catalog.isfinite(v_order.cancelled_at)
       or pg_catalog.date_part(
            'year', v_order.cancelled_at at time zone 'UTC'
          ) not between 1 and 9999
       or v_order.cancelled_at is distinct from pg_catalog.date_trunc(
            'milliseconds', v_order.cancelled_at
          )
       or v_order.cancelled_at not between
            v_order.created_at and v_order.updated_at
     )
     or v_order.status in ('suggested', 'draft') and (
       v_order.sent_at is not null
       or v_order.fulfilled_at is not null
       or v_order.cancelled_at is not null
     )
     or v_order.status = 'sent' and (
       v_order.sent_at is null
       or v_order.fulfilled_at is not null
       or v_order.cancelled_at is not null
     )
     or v_order.status = 'fulfilled' and (
       v_order.sent_at is null
       or v_order.fulfilled_at is null
       or v_order.sent_at > v_order.fulfilled_at
       or v_order.cancelled_at is not null
     )
     or v_order.status = 'cancelled' and (
       v_order.cancelled_at is null
       or v_order.fulfilled_at is not null
       or v_order.sent_at is not null
          and v_order.sent_at > v_order.cancelled_at
     ) then
    raise exception 'agent_purchase_order_source_data_invalid'
      using errcode = '22000';
  end if;

  for v_line in
    select order_line.id,
           order_line.catalog_variant_id,
           order_line.quantity_requested,
           order_line.cost_per_unit,
           variant.sku as raw_sku,
           case when variant.sku is null then null
             else private.agent_p2_optional_canonical_text(
               variant.sku, 160, 640, true
             ) end as safe_sku,
           family.name as raw_family_label,
           private.agent_p2_optional_canonical_text(
             family.name, 256, 1024, true
           ) as family_label,
           coalesce(variant.unit_id, family.default_unit_id) as expected_unit_id,
           unit_row.id as unit_id,
           unit_row.display as raw_unit_label,
           case when unit_row.id is null then null
             else private.agent_p2_optional_canonical_text(
               unit_row.display, 160, 640, true
             ) end as unit_label,
           unit_row.abbreviation as raw_unit_abbreviation,
           case when unit_row.abbreviation is null then null
             else private.agent_p2_optional_canonical_text(
               unit_row.abbreviation, 160, 640, true
             ) end as unit_abbreviation
    from public.catalog_order_items order_line
    join public.catalog_variants variant
      on variant.id = order_line.catalog_variant_id
     and variant.company_id = p_company_id
     and variant.deleted_at is null
    join public.catalog_items family
      on family.id = variant.catalog_item_id
     and family.company_id = p_company_id
     and family.deleted_at is null
    left join public.catalog_units unit_row
      on unit_row.id = coalesce(variant.unit_id, family.default_unit_id)
     and unit_row.company_id = p_company_id
     and unit_row.deleted_at is null
    where order_line.order_id = p_purchase_order_id
    order by order_line.id
    limit p_line_fetch_limit
  loop
    v_line_count := v_line_count + 1;
    if v_line_count >= p_line_fetch_limit then
      raise exception 'agent_purchase_order_result_bound' using errcode = '54000';
    end if;
    v_quantity_milliunits := private.agent_p2_catalog_milliunits_v1(
      v_line.quantity_requested::numeric
    );
    if v_quantity_milliunits is null
       or v_quantity_milliunits <= 0
       or v_quantity_milliunits > 9007199254740991
       or v_line.family_label is null
       or v_line.raw_sku is not null and v_line.safe_sku is null
       or v_line.expected_unit_id is not null and v_line.unit_id is null
       or v_line.raw_unit_label is not null and v_line.unit_label is null
       or v_line.raw_unit_abbreviation is not null
          and v_line.unit_abbreviation is null then
      raise exception 'agent_purchase_order_source_data_invalid'
        using errcode = '22000';
    end if;

    with raw_values as materialized (
      select private.agent_p2_optional_canonical_text(
               value_row.value, 256, 1024, true
             ) as safe_value,
             value_row.value as raw_value,
             option_row.sort_order as option_sort_order,
             option_row.id as option_id,
             value_row.sort_order as value_sort_order,
             value_row.id as value_id,
             assignment.id as assignment_id
      from public.catalog_variant_option_values assignment
      join public.catalog_option_values value_row
        on value_row.id = assignment.option_value_id
       and value_row.deleted_at is null
      join public.catalog_options option_row
        on option_row.id = value_row.option_id
       and option_row.catalog_item_id = (
         select catalog_item_id
         from public.catalog_variants
         where id = v_line.catalog_variant_id
       )
       and option_row.deleted_at is null
      where assignment.variant_id = v_line.catalog_variant_id
        and assignment.deleted_at is null
      order by option_row.sort_order, option_row.id,
               value_row.sort_order, value_row.id, assignment.id
      limit 129
    )
    select pg_catalog.count(*)::integer,
           coalesce(
             pg_catalog.bool_or(raw_values.safe_value is null), false
           ),
           pg_catalog.string_agg(
             raw_values.safe_value,
             ' / '
             order by raw_values.option_sort_order, raw_values.option_id,
                      raw_values.value_sort_order, raw_values.value_id,
                      raw_values.assignment_id
           )
      into v_label_count, v_label_invalid, v_raw_variant_label
    from raw_values;
    v_variant_label := case when v_raw_variant_label is null then null
      else private.agent_p2_optional_canonical_text(
        v_raw_variant_label, 256, 1024, true
      ) end;
    if v_label_count >= 129
       or v_label_invalid
       or v_raw_variant_label is not null and v_variant_label is null then
      raise exception 'agent_purchase_order_source_data_invalid'
        using errcode = '22000';
    end if;

    v_line_json := pg_catalog.jsonb_build_object(
      'line_ref', pg_catalog.jsonb_build_object(
        'kind', 'purchase_order_line', 'id', v_line.id
      ),
      'variant_ref', pg_catalog.jsonb_build_object(
        'kind', 'catalog_variant', 'id', v_line.catalog_variant_id
      ),
      'family_label', v_line.family_label,
      'variant_label', v_variant_label,
      'sku', v_line.safe_sku,
      'quantity_milliunits', v_quantity_milliunits,
      'unit', case when v_line.unit_id is null then null
        else pg_catalog.jsonb_build_object(
          'label', v_line.unit_label,
          'abbreviation', v_line.unit_abbreviation
        ) end,
      'content_kind', 'untrusted_business_data'
    );
    if p_include_costs then
      if v_line.cost_per_unit is null then
        v_unpriced_count := v_unpriced_count + 1;
        v_line_json := v_line_json || pg_catalog.jsonb_build_object(
          'unit_cost', null,
          'line_total', null
        );
      else
        if v_line.cost_per_unit < 0 then
          raise exception 'agent_purchase_order_source_data_invalid'
            using errcode = '22000';
        end if;
        v_priced_count := v_priced_count + 1;
        v_subtotal := v_subtotal +
          v_line.cost_per_unit * v_line.quantity_requested::numeric;
        v_line_json := v_line_json || pg_catalog.jsonb_build_object(
          'unit_cost', private.agent_p2_purchase_order_money_v1(
            v_line.cost_per_unit, v_order.currency_code
          ),
          'line_total', private.agent_p2_purchase_order_money_v1(
            v_line.cost_per_unit * v_line.quantity_requested::numeric,
            v_order.currency_code
          )
        );
      end if;
    end if;
    v_lines := v_lines || pg_catalog.jsonb_build_array(v_line_json);
  end loop;

  if v_line_count is distinct from (
    select pg_catalog.count(*)::integer
    from public.catalog_order_items order_line
    where order_line.order_id = p_purchase_order_id
  ) then
    raise exception 'agent_purchase_order_source_data_invalid'
      using errcode = '22000';
  end if;

  v_line_json := pg_catalog.jsonb_build_object(
    'purchase_order_ref', pg_catalog.jsonb_build_object(
      'kind', 'purchase_order', 'id', v_order.id
    ),
    'display_label', v_title,
    'supplier_label', v_supplier,
    'status', v_order.status,
    'expected_delivery_date', case
      when v_order.expected_delivery_date is null then null
      else pg_catalog.to_char(v_order.expected_delivery_date, 'YYYY-MM-DD')
    end,
    'line_count', v_line_count,
    'lines', v_lines,
    'created_at', private.agent_rfc3339_utc(v_order.created_at),
    'updated_at', private.agent_rfc3339_utc(v_order.updated_at),
    'sent_at', case when v_order.sent_at is null then null
      else private.agent_rfc3339_utc(v_order.sent_at) end,
    'fulfilled_at', case when v_order.fulfilled_at is null then null
      else private.agent_rfc3339_utc(v_order.fulfilled_at) end,
    'cancelled_at', case when v_order.cancelled_at is null then null
      else private.agent_rfc3339_utc(v_order.cancelled_at) end,
    'content_kind', 'untrusted_business_data'
  );
  if p_include_costs then
    v_line_json := v_line_json || pg_catalog.jsonb_build_object(
      'costs', pg_catalog.jsonb_build_object(
        'subtotal', case when v_unpriced_count > 0 then null
          else private.agent_p2_purchase_order_money_v1(
            v_subtotal, v_order.currency_code
          ) end,
        'priced_line_count', v_priced_count,
        'unpriced_line_count', v_unpriced_count
      )
    );
  end if;
  return v_line_json;
end;
$function$;

create or replace function private.agent_p2_purchase_order_normalized_text_v1(
  p_value text
) returns text
language sql
immutable
parallel safe
security invoker
set search_path = ''
as $function$
  select pg_catalog.lower(
    pg_catalog.regexp_replace(
      pg_catalog.btrim(p_value), '[[:space:]]+', ' ', 'g'
    )
  );
$function$;

create or replace function private.agent_p2_purchase_order_money_v1(
  p_amount numeric,
  p_currency text
) returns jsonb
language plpgsql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $function$
declare
  v_currency text := pg_catalog.upper(p_currency);
  v_minor bigint;
begin
  if p_amount < 0
     or p_currency is distinct from v_currency
     or private.agent_currency_minor_exponent_or_null(v_currency) is null then
    raise exception 'agent_purchase_order_source_data_invalid'
      using errcode = '22000';
  end if;
  v_minor := private.agent_money_to_minor_units(p_amount, v_currency);
  if v_minor < 0 or v_minor > 9007199254740991 then
    raise exception 'agent_purchase_order_source_data_invalid'
      using errcode = '22000';
  end if;
  return pg_catalog.jsonb_build_object(
    'amount_minor', v_minor,
    'currency', v_currency
  );
exception
  when sqlstate '22003' or sqlstate '22023' then
    raise exception 'agent_purchase_order_source_data_invalid'
      using errcode = '22000';
end;
$function$;

create or replace function private.agent_p2_purchase_order_expected_candidate_v1(
  p_variant_key text,
  p_permissions jsonb
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_orders_scope text;
  v_products_scope text;
  v_finances_scope text;
begin
  if p_variant_key not in ('orders', 'costs')
     or p_permissions is null
     or pg_catalog.jsonb_typeof(p_permissions) is distinct from 'object' then
    return null;
  end if;
  v_orders_scope := p_permissions ->> 'catalog.orders.view';
  v_products_scope := p_permissions ->> 'catalog.products.view';
  v_finances_scope := p_permissions ->> 'finances.view';
  if p_variant_key = 'orders' then
    if v_orders_scope <> 'all' then return null; end if;
    return pg_catalog.jsonb_build_object(
      'variant_key', 'orders',
      'required_oauth_scopes',
        pg_catalog.jsonb_build_array('ops.purchasing.read'),
      'resolved_permission_scopes', pg_catalog.jsonb_build_object(
        'catalog.orders.view', 'all'
      ),
      'satisfied_permission_group_indexes',
        pg_catalog.jsonb_build_array(0)
    );
  end if;
  if v_products_scope <> 'all' or v_finances_scope <> 'all' then
    return null;
  end if;
  return pg_catalog.jsonb_build_object(
    'variant_key', 'costs',
    'required_oauth_scopes',
      pg_catalog.jsonb_build_array('ops.catalog_costs.read'),
    'resolved_permission_scopes', pg_catalog.jsonb_build_object(
      'catalog.products.view', 'all',
      'finances.view', 'all'
    ),
    'satisfied_permission_group_indexes', pg_catalog.jsonb_build_array(0)
  );
end;
$function$;

create or replace function private.agent_p2_purchase_order_proof_candidates_v1(
  p_authorization_candidates jsonb,
  p_permissions jsonb
) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'variantKey', candidate.value ->> 'variant_key',
        'requiredOAuthScopes', candidate.value -> 'required_oauth_scopes',
        'resolvedPermissionScopes',
          candidate.value -> 'resolved_permission_scopes',
        'satisfiedPermissionGroupIndexes',
          candidate.value -> 'satisfied_permission_group_indexes',
        'orderViewScope',
          candidate.value -> 'resolved_permission_scopes' ->>
            'catalog.orders.view',
        'catalogProductsViewScope',
          candidate.value -> 'resolved_permission_scopes' ->>
            'catalog.products.view',
        'financesViewScope',
          candidate.value -> 'resolved_permission_scopes' ->> 'finances.view'
      ) order by candidate.ordinality
    ),
    '[]'::jsonb
  )
  from pg_catalog.jsonb_array_elements(p_authorization_candidates)
    with ordinality candidate(value, ordinality)
  where candidate.value is not distinct from
    private.agent_p2_purchase_order_expected_candidate_v1(
      candidate.value ->> 'variant_key', p_permissions
    );
$function$;

create or replace function private.agent_p2_purchase_order_read_context_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_authorization_candidates jsonb,
  p_include_costs boolean
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_permissions jsonb;
  v_snapshot_revision text;
  v_expected_count integer := case when p_include_costs then 2 else 1 end;
  v_result jsonb;
begin
  if p_actor_user_id is null
     or p_company_id is null
     or p_oauth_grant_id is null
     or p_oauth_client_id is null
     or p_grant_revision !~ '^[0-9a-f]{32}$'
     or p_permission_snapshot_revision !~ '^sha256:[0-9a-f]{64}$'
     or p_granted_scope_ceiling is null
     or p_registered_permission_keys is null
     or p_include_costs is null
     or pg_catalog.jsonb_typeof(p_authorization_candidates)
          is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_authorization_candidates)
          <> v_expected_count
     or p_authorization_candidates #>> '{0,variant_key}' <> 'orders'
     or p_include_costs and
          p_authorization_candidates #>> '{1,variant_key}' <> 'costs'
     or not ('ops.purchasing.read' = any(p_granted_scope_ceiling))
     or p_include_costs and
          not ('ops.catalog_costs.read' = any(p_granted_scope_ceiling))
     or p_granted_scope_ceiling is distinct from (
       select pg_catalog.array_agg(
         scope.value order by scope.value collate "C"
       )
       from (
         select distinct source.value
         from pg_catalog.unnest(p_granted_scope_ceiling) source(value)
       ) scope
     )
     or p_registered_permission_keys is distinct from (
       select pg_catalog.array_agg(
         key.value order by key.value collate "C"
       )
       from (
         select distinct source.value
         from pg_catalog.unnest(p_registered_permission_keys) source(value)
       ) key
     ) then
    return null;
  end if;

  select authority.permission_snapshot_revision,
         coalesce(
           pg_catalog.jsonb_object_agg(
             permission.value ->> 'permission',
             permission.value ->> 'scope'
             order by permission.value ->> 'permission'
           ) filter (
             where permission.value ->> 'permission' is not null
               and permission.value ->> 'scope' is not null
           ),
           '{}'::jsonb
         )
    into v_snapshot_revision, v_permissions
  from private.resolve_agent_actor_authority(
    p_actor_user_id, p_company_id, p_registered_permission_keys
  ) authority
  left join lateral pg_catalog.jsonb_array_elements(
    authority.effective_permissions
  ) permission(value) on true
  group by authority.permission_snapshot_revision;

  if v_snapshot_revision is distinct from p_permission_snapshot_revision
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(p_authorization_candidates)
         with ordinality candidate(value, ordinality)
       where candidate.value is distinct from
         private.agent_p2_purchase_order_expected_candidate_v1(
           case candidate.ordinality when 1 then 'orders' else 'costs' end,
           v_permissions
         )
     ) then
    return null;
  end if;

  select pg_catalog.jsonb_build_object(
           'permissions', v_permissions,
           'currency_code', pg_catalog.upper(company.currency_code),
           'minor_exponent',
             private.agent_currency_minor_exponent_or_null(
               pg_catalog.upper(company.currency_code)
             ),
           'source_revisions', case when p_include_costs then
             pg_catalog.jsonb_build_array(
               pg_catalog.jsonb_build_object(
                 'domain', 'catalog',
                 'source_revision', catalog_revision.source_revision
               ),
               pg_catalog.jsonb_build_object(
                 'domain', 'purchasing',
                 'source_revision', purchasing_revision.source_revision
               )
             ) else pg_catalog.jsonb_build_array(
               pg_catalog.jsonb_build_object(
                 'domain', 'purchasing',
                 'source_revision', purchasing_revision.source_revision
               )
             ) end,
           'proof_authorization_candidates',
             private.agent_p2_purchase_order_proof_candidates_v1(
               p_authorization_candidates, v_permissions
             )
         )
    into v_result
  from private.mcp_oauth_grants grant_row
  join private.mcp_oauth_clients oauth_client
    on oauth_client.client_id = grant_row.client_id
   and oauth_client.disabled_at is null
   and grant_row.scopes <@ oauth_client.scope_ceiling
   and grant_row.consent_catalog_revision =
         oauth_client.consent_catalog_revision
   and grant_row.exposure_revision = oauth_client.exposure_revision
  join public.companies company
    on company.id = p_company_id and company.deleted_at is null
  join private.agent_read_domain_revisions purchasing_revision
    on purchasing_revision.company_id = p_company_id
   and purchasing_revision.domain = 'purchasing'
   and purchasing_revision.source_revision between 0 and 9007199254740991
  left join private.agent_read_domain_revisions catalog_revision
    on catalog_revision.company_id = p_company_id
   and catalog_revision.domain = 'catalog'
   and catalog_revision.source_revision between 0 and 9007199254740991
  where grant_row.id = p_oauth_grant_id
    and grant_row.user_id = p_actor_user_id
    and grant_row.company_id = p_company_id
    and grant_row.client_id = p_oauth_client_id
    and grant_row.revision = p_grant_revision
    and grant_row.revoked_at is null
    and grant_row.scopes = p_granted_scope_ceiling
    and array['ops.purchasing.read']::text[] <@ grant_row.scopes
    and (not p_include_costs or catalog_revision.company_id is not null)
    and (
      not p_include_costs
      or array['ops.catalog_costs.read']::text[] <@ grant_row.scopes
    )
    and grant_row.accepted_labels = private.mcp_oauth_labels_for_scopes(
      grant_row.scopes, grant_row.consent_catalog_revision
    );

  if v_result is null
     or v_result -> 'minor_exponent' = 'null'::jsonb
     or pg_catalog.jsonb_array_length(
          v_result -> 'proof_authorization_candidates'
        ) <> v_expected_count then
    return null;
  end if;
  return v_result;
end;
$function$;

create or replace function private.agent_p2_purchase_order_detail_v1(
  p_request_id text,
  p_company_id uuid,
  p_actor_user_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_manifest_revision text,
  p_capability_id text,
  p_capability_revision text,
  p_authorization_candidates jsonb,
  p_purchase_order_id uuid,
  p_include_costs boolean,
  p_source_limit integer,
  p_line_fetch_limit integer
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_source_revisions jsonb;
  v_proof_candidates jsonb;
  v_read_at timestamptz;
  v_read_at_text text;
  v_order jsonb;
  v_line_count integer;
  v_variant_ids uuid[] := array[]::uuid[];
  v_cost_state jsonb;
  v_cost_count integer := 0;
  v_cost_witness text;
  v_source_inspected jsonb;
  v_query jsonb;
  v_proof_context jsonb;
  v_current_revisions jsonb;
begin
  if p_request_id is null
     or pg_catalog.char_length(p_request_id) not between 1 and 256
     or p_capability_manifest_revision is distinct from
          '2026-08-22.capability-manifest.v8'
     or p_capability_id is distinct from 'get_purchase_order'
     or p_capability_revision is distinct from
          'get_purchase_order:2026-08-22.v1'
     or p_purchase_order_id is null
     or p_include_costs is null
     or p_source_limit is distinct from 501
     or p_line_fetch_limit is distinct from 51 then
    raise exception 'invalid_agent_purchase_order_detail_request'
      using errcode = '22023';
  end if;

  v_context := private.agent_p2_purchase_order_read_context_v1(
    p_actor_user_id, p_company_id, p_oauth_grant_id, p_oauth_client_id,
    p_grant_revision, p_granted_scope_ceiling,
    p_permission_snapshot_revision, p_registered_permission_keys,
    p_authorization_candidates, p_include_costs
  );
  if v_context is null then
    raise exception 'agent_purchase_order_not_authorized'
      using errcode = '42501';
  end if;
  v_source_revisions := v_context -> 'source_revisions';
  v_proof_candidates := v_context -> 'proof_authorization_candidates';
  v_read_at := pg_catalog.date_trunc(
    'milliseconds', pg_catalog.statement_timestamp()
  );
  v_read_at_text := private.agent_rfc3339_utc(v_read_at);

  v_order := private.agent_p2_purchase_order_item_v1(
    p_company_id, p_purchase_order_id, p_include_costs, p_line_fetch_limit
  );
  if v_order is null then
    return null;
  end if;
  v_line_count := (v_order ->> 'line_count')::integer;
  select coalesce(
           pg_catalog.array_agg(
             distinct order_line.catalog_variant_id
             order by order_line.catalog_variant_id
           ),
           array[]::uuid[]
         )
    into v_variant_ids
  from public.catalog_order_items order_line
  where order_line.order_id = p_purchase_order_id;

  if p_include_costs then
    v_cost_state := private.agent_p2_purchase_order_cost_witness_v1(
      p_company_id, v_variant_ids, p_source_limit
    );
    v_cost_count := (v_cost_state ->> 'count')::integer;
    v_cost_witness := v_cost_state ->> 'witness';
  end if;
  v_source_inspected := pg_catalog.jsonb_build_object(
    'orders', 1,
    'lines', v_line_count,
    'catalog_costs', v_cost_count
  );
  v_query := pg_catalog.jsonb_build_object(
    'purchase_order_ref', pg_catalog.jsonb_build_object(
      'kind', 'purchase_order', 'id', p_purchase_order_id
    ),
    'sections', case when p_include_costs
      then pg_catalog.jsonb_build_array('costs') else '[]'::jsonb end
  );
  v_proof_context := pg_catalog.jsonb_build_object(
    'company_id', p_company_id,
    'actor_user_id', p_actor_user_id,
    'oauth_grant_id', p_oauth_grant_id,
    'oauth_client_id', p_oauth_client_id,
    'grant_revision', p_grant_revision,
    'granted_scope_ceiling', pg_catalog.to_jsonb(p_granted_scope_ceiling),
    'permission_snapshot_revision', p_permission_snapshot_revision,
    'capability_manifest_revision', p_capability_manifest_revision,
    'authorization_candidates', v_proof_candidates,
    'read_at', v_read_at_text,
    'source_revisions', v_source_revisions,
    'source_inspected', v_source_inspected,
    'catalog_cost_witness', v_cost_witness,
    'capability_id', p_capability_id,
    'capability_revision', p_capability_revision,
    'query', v_query
  );

  select case when p_include_costs then pg_catalog.jsonb_build_array(
           pg_catalog.jsonb_build_object(
             'domain', 'catalog',
             'source_revision', catalog_revision.source_revision
           ),
           pg_catalog.jsonb_build_object(
             'domain', 'purchasing',
             'source_revision', purchasing_revision.source_revision
           )
         ) else pg_catalog.jsonb_build_array(
           pg_catalog.jsonb_build_object(
             'domain', 'purchasing',
             'source_revision', purchasing_revision.source_revision
           )
         ) end
    into v_current_revisions
  from private.agent_read_domain_revisions purchasing_revision
  left join private.agent_read_domain_revisions catalog_revision
    on catalog_revision.company_id = p_company_id
   and catalog_revision.domain = 'catalog'
  where purchasing_revision.company_id = p_company_id
    and purchasing_revision.domain = 'purchasing';
  if v_current_revisions is distinct from v_source_revisions then
    raise exception 'agent_purchase_order_read_stale' using errcode = '40001';
  end if;

  return pg_catalog.jsonb_build_object(
    'company_id', p_company_id,
    'actor_user_id', p_actor_user_id,
    'oauth_grant_id', p_oauth_grant_id,
    'oauth_client_id', p_oauth_client_id,
    'grant_revision', p_grant_revision,
    'granted_scope_ceiling', pg_catalog.to_jsonb(p_granted_scope_ceiling),
    'permission_snapshot_revision', p_permission_snapshot_revision,
    'capability_manifest_revision', p_capability_manifest_revision,
    'capability_id', p_capability_id,
    'capability_revision', p_capability_revision,
    'authorization_candidates', p_authorization_candidates,
    'selected_authorization_variants', case when p_include_costs
      then pg_catalog.jsonb_build_array('orders', 'costs')
      else pg_catalog.jsonb_build_array('orders') end,
    'query', v_query,
    'read_at', v_read_at_text,
    'source_revisions', v_source_revisions,
    'source_inspected', v_source_inspected,
    'catalog_cost_witness', v_cost_witness,
    'company_currency', v_context ->> 'currency_code',
    'purchase_order', v_order,
    'proof_ref', private.agent_p2_purchase_order_hash_ref_v1(
      'ops_proof:v1:',
      v_proof_context || pg_catalog.jsonb_build_object(
        'proof_kind', 'purchase_order_detail_entity',
        'order', v_order
      )
    ),
    'evidence_ref', private.agent_p2_purchase_order_hash_ref_v1(
      'ops_evidence:v1:',
      v_proof_context || pg_catalog.jsonb_build_object(
        'evidence_kind', 'purchase_order',
        'purchase_order_ref', v_order -> 'purchase_order_ref',
        'updated_at', v_order -> 'updated_at'
      )
    )
  );
end;
$function$;

create or replace function private.agent_p2_purchase_order_attention_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_authorization_candidates jsonb,
  p_attention_kind text,
  p_as_of date,
  p_due_soon_days integer,
  p_include_costs boolean,
  p_read_at timestamptz,
  p_item_limit integer,
  p_page_fetch_limit integer,
  p_source_limit integer,
  p_line_fetch_limit integer
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_order_ids uuid[] := array[]::uuid[];
  v_order_id uuid;
  v_order_count integer;
  v_line_count integer;
  v_variant_ids uuid[] := array[]::uuid[];
  v_all_items jsonb := '[]'::jsonb;
  v_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_cost_state jsonb;
  v_cost_count integer := 0;
  v_cost_witness text;
begin
  if p_attention_kind not in ('overdue', 'due_soon')
     or p_as_of is null
     or p_due_soon_days not between 1 and 31
     or p_include_costs is null
     or p_read_at is null
     or not pg_catalog.isfinite(p_read_at)
     or p_read_at is distinct from pg_catalog.date_trunc(
          'milliseconds', p_read_at
        )
     or extract(year from p_read_at at time zone 'UTC') not between 1 and 9999
     or p_item_limit not between 1 and 25
     or p_page_fetch_limit is distinct from p_item_limit + 1
     or p_page_fetch_limit not between 2 and 26
     or p_source_limit is distinct from 501
     or p_line_fetch_limit is distinct from 51 then
    raise exception 'invalid_agent_purchase_order_attention_request'
      using errcode = '22023';
  end if;
  v_context := private.agent_p2_purchase_order_read_context_v1(
    p_actor_user_id, p_company_id, p_oauth_grant_id, p_oauth_client_id,
    p_grant_revision, p_granted_scope_ceiling,
    p_permission_snapshot_revision, p_registered_permission_keys,
    p_authorization_candidates, p_include_costs
  );
  if v_context is null then
    raise exception 'agent_purchase_order_not_authorized'
      using errcode = '42501';
  end if;

  select coalesce(
           pg_catalog.array_agg(source.id order by source.id),
           array[]::uuid[]
         )
    into v_order_ids
  from (
    select purchase_order.id
    from public.catalog_orders purchase_order
    where purchase_order.company_id = p_company_id
      and purchase_order.deleted_at is null
    order by purchase_order.id
    limit 501
  ) source;
  v_order_count := pg_catalog.cardinality(v_order_ids);
  if v_order_count >= p_source_limit then
    raise exception 'agent_purchase_order_source_bound' using errcode = '54000';
  end if;

  select pg_catalog.count(*)::integer,
         coalesce(
           pg_catalog.array_agg(
             distinct source.catalog_variant_id
             order by source.catalog_variant_id
           ),
           array[]::uuid[]
         )
    into v_line_count, v_variant_ids
  from (
    select order_line.id, order_line.catalog_variant_id
    from public.catalog_order_items order_line
    join public.catalog_orders purchase_order
      on purchase_order.id = order_line.order_id
     and purchase_order.company_id = p_company_id
     and purchase_order.deleted_at is null
    order by order_line.order_id, order_line.id
    limit 501
  ) source;
  if v_line_count >= p_source_limit then
    raise exception 'agent_purchase_order_source_bound' using errcode = '54000';
  end if;

  foreach v_order_id in array v_order_ids loop
    v_item := private.agent_p2_purchase_order_item_v1(
      p_company_id, v_order_id, p_include_costs, p_line_fetch_limit
    );
    if v_item is null then
      raise exception 'agent_purchase_order_source_data_invalid'
        using errcode = '22000';
    end if;
    v_all_items := v_all_items || pg_catalog.jsonb_build_array(v_item);
  end loop;

  if p_include_costs then
    v_cost_state := private.agent_p2_purchase_order_cost_witness_v1(
      p_company_id, v_variant_ids, p_source_limit
    );
    v_cost_count := (v_cost_state ->> 'count')::integer;
    v_cost_witness := v_cost_state ->> 'witness';
  end if;

  select coalesce(
           pg_catalog.jsonb_agg(
             source.item order by source.expected_delivery_date,
             source.updated_at desc, source.order_id
           ),
           '[]'::jsonb
         )
    into v_items
  from (
    select item.value as item,
           (item.value ->> 'expected_delivery_date')::date
             as expected_delivery_date,
           (item.value ->> 'updated_at')::timestamptz as updated_at,
           (item.value #>> '{purchase_order_ref,id}')::uuid as order_id
    from pg_catalog.jsonb_array_elements(v_all_items) item(value)
    where item.value ->> 'status' in ('suggested', 'draft', 'sent')
      and item.value ->> 'expected_delivery_date' is not null
      and case p_attention_kind
        when 'overdue' then
          (item.value ->> 'expected_delivery_date')::date < p_as_of
        else
          (item.value ->> 'expected_delivery_date')::date between
            p_as_of and p_as_of + p_due_soon_days
      end
    order by expected_delivery_date, updated_at desc, order_id
    limit p_page_fetch_limit
  ) source;

  return pg_catalog.jsonb_build_object(
    'attention_kind', p_attention_kind,
    'as_of', pg_catalog.to_char(p_as_of, 'YYYY-MM-DD'),
    'due_soon_days', p_due_soon_days,
    'read_at', private.agent_rfc3339_utc(p_read_at),
    'source_revisions', v_context -> 'source_revisions',
    'selected_authorization_variants', case when p_include_costs
      then pg_catalog.jsonb_build_array('orders', 'costs')
      else pg_catalog.jsonb_build_array('orders') end,
    'source_inspected', pg_catalog.jsonb_build_object(
      'orders', v_order_count,
      'lines', v_line_count,
      'catalog_costs', v_cost_count
    ),
    'catalog_cost_witness', v_cost_witness,
    'company_currency', v_context ->> 'currency_code',
    'has_more', pg_catalog.jsonb_array_length(v_items) > p_item_limit,
    'items', case when pg_catalog.jsonb_array_length(v_items) <= p_item_limit
      then v_items
      else (
        select coalesce(
          pg_catalog.jsonb_agg(value.value order by value.ordinality),
          '[]'::jsonb
        )
        from pg_catalog.jsonb_array_elements(v_items)
          with ordinality value(value, ordinality)
        where value.ordinality <= p_item_limit
      )
    end
  );
end;
$function$;

create or replace function public.read_agent_purchase_orders_as_system(
  p_request_id text,
  p_company_id uuid,
  p_actor_user_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_manifest_revision text,
  p_capability_id text,
  p_capability_revision text,
  p_authorization_candidates jsonb,
  p_statuses text[],
  p_supplier_label text,
  p_delivery_starts_on date,
  p_delivery_ends_on date,
  p_include_costs boolean,
  p_item_limit integer,
  p_page_fetch_limit integer,
  p_source_limit integer,
  p_line_fetch_limit integer,
  p_cursor_read_at timestamptz,
  p_cursor_source_revisions jsonb,
  p_after_delivery_sort_date date,
  p_after_updated_at timestamptz,
  p_after_order_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.role() is distinct from 'service_role'
     or p_request_id is null
     or p_request_id is distinct from pg_catalog.btrim(p_request_id)
     or pg_catalog.octet_length(p_request_id) not between 1 and 256 then
    raise exception 'invalid_agent_purchase_order_list_request'
      using errcode = '22023';
  end if;
  return private.agent_p2_purchase_order_list_v1(
    p_request_id, p_company_id, p_actor_user_id, p_oauth_grant_id,
    p_oauth_client_id, p_grant_revision, p_granted_scope_ceiling,
    p_permission_snapshot_revision, p_registered_permission_keys,
    p_capability_manifest_revision, p_capability_id,
    p_capability_revision, p_authorization_candidates, p_statuses,
    p_supplier_label, p_delivery_starts_on, p_delivery_ends_on,
    p_include_costs, p_item_limit, p_page_fetch_limit, p_source_limit,
    p_line_fetch_limit, p_cursor_read_at, p_cursor_source_revisions,
    p_after_delivery_sort_date, p_after_updated_at, p_after_order_id
  );
end;
$function$;

create or replace function public.read_agent_purchase_order_as_system(
  p_request_id text,
  p_company_id uuid,
  p_actor_user_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_manifest_revision text,
  p_capability_id text,
  p_capability_revision text,
  p_authorization_candidates jsonb,
  p_purchase_order_id uuid,
  p_include_costs boolean,
  p_source_limit integer,
  p_line_fetch_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role'
     or p_request_id is null
     or p_request_id is distinct from pg_catalog.btrim(p_request_id)
     or pg_catalog.octet_length(p_request_id) not between 1 and 256 then
    raise exception 'invalid_agent_purchase_order_detail_request'
      using errcode = '22023';
  end if;
  v_result := private.agent_p2_purchase_order_detail_v1(
    p_request_id, p_company_id, p_actor_user_id, p_oauth_grant_id,
    p_oauth_client_id, p_grant_revision, p_granted_scope_ceiling,
    p_permission_snapshot_revision, p_registered_permission_keys,
    p_capability_manifest_revision, p_capability_id,
    p_capability_revision, p_authorization_candidates,
    p_purchase_order_id, p_include_costs, p_source_limit,
    p_line_fetch_limit
  );
  if v_result is null then
    raise exception 'agent_purchase_order_not_found_or_not_visible'
      using errcode = 'P0002';
  end if;
  return v_result;
end;
$function$;

do $canonical_acl$
declare
  v_signature text;
  v_function_oid oid;
  v_function_owner oid;
  v_acl record;
begin
  foreach v_signature in array array[
    'private.agent_p2_purchase_order_hash_ref_v1(text,jsonb)',
    'private.agent_p2_purchase_order_list_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text[],text,date,date,boolean,integer,integer,integer,integer,timestamp with time zone,jsonb,date,timestamp with time zone,uuid)',
    'private.agent_p2_purchase_order_cost_witness_v1(uuid,uuid[],integer)',
    'private.agent_p2_purchase_order_item_v1(uuid,uuid,boolean,integer)',
    'private.agent_p2_purchase_order_normalized_text_v1(text)',
    'private.agent_p2_purchase_order_money_v1(numeric,text)',
    'private.agent_p2_purchase_order_expected_candidate_v1(text,jsonb)',
    'private.agent_p2_purchase_order_proof_candidates_v1(jsonb,jsonb)',
    'private.agent_p2_purchase_order_read_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,boolean)',
    'private.agent_p2_purchase_order_detail_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,uuid,boolean,integer,integer)',
    'private.agent_p2_purchase_order_attention_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text,date,integer,boolean,timestamp with time zone,integer,integer,integer,integer)',
    'public.read_agent_purchase_orders_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text[],text,date,date,boolean,integer,integer,integer,integer,timestamp with time zone,jsonb,date,timestamp with time zone,uuid)',
    'public.read_agent_purchase_order_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,uuid,boolean,integer,integer)'
  ]::text[] loop
    v_function_oid := pg_catalog.to_regprocedure(v_signature)::oid;
    if v_function_oid is null then
      raise exception 'agent_purchase_order_acl_function_missing: %',
        v_signature using errcode = '55000';
    end if;
    execute pg_catalog.format(
      'alter function %s owner to current_user', v_signature
    );
    select function_row.proowner
      into v_function_owner
    from pg_catalog.pg_proc function_row
    where function_row.oid = v_function_oid;
    for v_acl in
      select distinct acl.grantee,
             case when acl.grantee = 0 then 'public'
               else role_row.rolname end as role_name
      from pg_catalog.pg_proc function_row
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          function_row.proacl,
          pg_catalog.acldefault('f', function_row.proowner)
        )
      ) acl
      left join pg_catalog.pg_roles role_row on role_row.oid = acl.grantee
      where function_row.oid = v_function_oid
        and acl.grantee <> v_function_owner
    loop
      if v_acl.role_name is null then
        raise exception 'agent_purchase_order_acl_role_missing'
          using errcode = '55000';
      end if;
      execute pg_catalog.format(
        'revoke all privileges on function %s from %s',
        v_signature,
        case when v_acl.grantee = 0 then 'public'
          else pg_catalog.quote_ident(v_acl.role_name)
        end
      );
    end loop;
  end loop;
end;
$canonical_acl$;

grant execute on function public.read_agent_purchase_orders_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,
  text[],text,date,date,boolean,integer,integer,integer,integer,
  timestamp with time zone,jsonb,date,timestamp with time zone,uuid
) to service_role;
grant execute on function public.read_agent_purchase_order_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,
  uuid,boolean,integer,integer
) to service_role;

do $postflight$
declare
  v_missing text[];
  v_invalid text[];
begin
  select pg_catalog.array_agg(required.signature order by required.signature)
    into v_missing
  from (
    values
      ('private.agent_p2_purchase_order_list_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text[],text,date,date,boolean,integer,integer,integer,integer,timestamp with time zone,jsonb,date,timestamp with time zone,uuid)'),
      ('private.agent_p2_purchase_order_detail_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,uuid,boolean,integer,integer)'),
      ('private.agent_p2_purchase_order_attention_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text,date,integer,boolean,timestamp with time zone,integer,integer,integer,integer)'),
      ('public.read_agent_purchase_orders_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text[],text,date,date,boolean,integer,integer,integer,integer,timestamp with time zone,jsonb,date,timestamp with time zone,uuid)'),
      ('public.read_agent_purchase_order_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,uuid,boolean,integer,integer)')
  ) required(signature)
  where pg_catalog.to_regprocedure(required.signature) is null;
  if v_missing is not null then
    raise exception 'agent_purchase_order_reads_postflight_missing: %',
      pg_catalog.array_to_string(v_missing, ',') using errcode = '55000';
  end if;

  select pg_catalog.array_agg(
           namespace.nspname || '.' || procedure.proname
           order by namespace.nspname, procedure.proname
         )
    into v_invalid
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where (
      namespace.nspname = 'private'
      and procedure.proname in (
        'agent_p2_purchase_order_list_v1',
        'agent_p2_purchase_order_detail_v1',
        'agent_p2_purchase_order_attention_v1'
      )
      and (
        procedure.provolatile <> 's'
        or procedure.prosecdef
        or pg_catalog.has_function_privilege(
          'service_role', procedure.oid, 'EXECUTE'
        )
      )
    ) or (
      namespace.nspname = 'public'
      and procedure.proname in (
        'read_agent_purchase_orders_as_system',
        'read_agent_purchase_order_as_system'
      )
      and (
        procedure.provolatile <> 's'
        or not procedure.prosecdef
        or not pg_catalog.has_function_privilege(
          'service_role', procedure.oid, 'EXECUTE'
        )
        or pg_catalog.has_function_privilege(
          'anon', procedure.oid, 'EXECUTE'
        )
        or pg_catalog.has_function_privilege(
          'authenticated', procedure.oid, 'EXECUTE'
        )
      )
    );
  if v_invalid is not null then
    raise exception 'agent_purchase_order_reads_postflight_invalid: %',
      pg_catalog.array_to_string(v_invalid, ',') using errcode = '55000';
  end if;
end;
$postflight$;

commit;
