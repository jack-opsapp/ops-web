begin;

create or replace function public.catalog_inventory_import_commit(
  p_import_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'private', 'pg_temp'
as $function$
declare
  v_company_id uuid := private.get_user_company_id();
  v_user_id uuid;
  v_import public.catalog_inventory_imports%rowtype;
  v_row public.catalog_inventory_import_rows%rowtype;
  v_stock_unit_id uuid;
  v_event_id uuid;
  v_operation_id uuid;
  v_committed integer := 0;
  v_unit_count integer;
  v_unit_index integer;
  v_is_physical boolean;
begin
  if v_company_id is null then
    raise exception 'Unauthorized: company not found';
  end if;
  select u.id
    into v_user_id
    from public.users u
   where u.company_id = v_company_id
     and u.deleted_at is null
     and (
       u.auth_id = (auth.jwt() ->> 'sub')
       or u.firebase_uid = (auth.jwt() ->> 'sub')
     )
   limit 1;
  if v_user_id is null
     or not public.has_permission(v_user_id, 'catalog.run_setup', 'all')
     or not public.has_permission(v_user_id, 'inventory.manage', 'all') then
    raise exception 'Forbidden: inventory import';
  end if;

  select *
    into v_import
    from public.catalog_inventory_imports
   where id = p_import_id
     and company_id = v_company_id
   for update;
  if not found then
    raise exception 'Inventory import not found';
  end if;
  if v_import.status = 'complete' then
    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'status', 'complete',
      'importId', p_import_id,
      'committed', coalesce(
        (v_import.summary ->> 'committed')::integer,
        0
      ),
      'summary', v_import.summary
    );
  end if;
  if v_import.status not in ('review', 'attention', 'committing') then
    raise exception 'Inventory import is not ready';
  end if;
  if exists (
    select 1
      from public.catalog_inventory_import_rows import_row
     where import_row.import_id = p_import_id
       and import_row.company_id = v_company_id
       and import_row.status in ('needs_input', 'failed')
  ) then
    return jsonb_build_object(
      'ok', false,
      'status', 'review',
      'importId', p_import_id,
      'blockers', jsonb_build_array(jsonb_build_object(
        'code', 'inventory_rows_need_input',
        'message', 'Resolve every unmatched inventory row before adding stock.'
      ))
    );
  end if;

  v_operation_id := coalesce(v_import.commit_operation_id, gen_random_uuid());
  update public.catalog_inventory_imports
     set status = 'committing',
         commit_operation_id = v_operation_id,
         error = null,
         updated_at = now()
   where id = p_import_id;

  for v_row in
    select *
      from public.catalog_inventory_import_rows
     where import_id = p_import_id
       and company_id = v_company_id
       and status in ('matched', 'committed')
     order by row_number
     for update
  loop
    if v_row.status = 'committed'
       and v_row.committed_stock_unit_id is not null then
      v_committed := v_committed + 1;
      continue;
    end if;
    if v_row.matched_variant_id is null
       or v_row.proposed_stock_unit is null then
      raise exception 'Inventory row % is not resolved', v_row.row_number;
    end if;
    if not exists (
      select 1
        from public.catalog_variants variant_row
       where variant_row.id = v_row.matched_variant_id
         and variant_row.company_id = v_company_id
         and variant_row.deleted_at is null
         and variant_row.is_active
    ) then
      raise exception 'Inventory row % points to an unavailable catalog variant',
        v_row.row_number;
    end if;

    v_is_physical :=
      coalesce(nullif(btrim(v_row.proposed_stock_unit ->> 'unit_kind'), ''), 'each')
        in ('roll', 'offcut', 'length');
    if v_is_physical then
      if coalesce((v_row.proposed_stock_unit ->> 'quantity_value')::numeric, 1) <= 0
         or trunc(coalesce(
           (v_row.proposed_stock_unit ->> 'quantity_value')::numeric,
           1
         )) is distinct from coalesce(
           (v_row.proposed_stock_unit ->> 'quantity_value')::numeric,
           1
         ) then
        raise exception
          'Inventory row % requires a whole physical-unit count',
          v_row.row_number;
      end if;
      v_unit_count :=
        coalesce((v_row.proposed_stock_unit ->> 'quantity_value')::integer, 1);
    else
      v_unit_count := 1;
    end if;

    -- One full roll, offcut, or purchased length is one physical stock row.
    -- A source quantity of seven rolls therefore becomes seven rows at qty 1.
    for v_unit_index in 1..v_unit_count loop
      insert into public.catalog_stock_units (
        company_id,
        catalog_variant_id,
        unit_kind,
        label,
        lot_code,
        width_value,
        width_unit,
        original_length_value,
        remaining_length_value,
        length_unit,
        quantity_value,
        location,
        status,
        notes
      ) values (
        v_company_id,
        v_row.matched_variant_id,
        coalesce(nullif(btrim(v_row.proposed_stock_unit ->> 'unit_kind'), ''), 'each'),
        nullif(btrim(v_row.proposed_stock_unit ->> 'label'), ''),
        nullif(btrim(v_row.proposed_stock_unit ->> 'lot_code'), ''),
        case when jsonb_typeof(v_row.proposed_stock_unit -> 'width_value') = 'number'
          then (v_row.proposed_stock_unit ->> 'width_value')::numeric else null end,
        nullif(btrim(v_row.proposed_stock_unit ->> 'width_unit'), ''),
        case when jsonb_typeof(v_row.proposed_stock_unit -> 'original_length_value') = 'number'
          then (v_row.proposed_stock_unit ->> 'original_length_value')::numeric else null end,
        case when jsonb_typeof(v_row.proposed_stock_unit -> 'remaining_length_value') = 'number'
          then (v_row.proposed_stock_unit ->> 'remaining_length_value')::numeric else null end,
        nullif(btrim(v_row.proposed_stock_unit ->> 'length_unit'), ''),
        case
          when v_is_physical then 1
          else greatest(
            coalesce(
              (v_row.proposed_stock_unit ->> 'quantity_value')::numeric,
              1
            ),
            0
          )
        end,
        coalesce(
          nullif(btrim(v_row.proposed_stock_unit ->> 'location'), ''),
          'Main Shop'
        ),
        coalesce(nullif(btrim(v_row.proposed_stock_unit ->> 'status'), ''), 'full'),
        nullif(btrim(v_row.proposed_stock_unit ->> 'notes'), '')
      )
      returning id into v_stock_unit_id;

      insert into public.catalog_stock_unit_events (
        company_id,
        catalog_stock_unit_id,
        catalog_variant_id,
        event_type,
        from_status,
        to_status,
        quantity_delta,
        remaining_length_delta,
        payload,
        marker,
        notes,
        created_by
      ) values (
        v_company_id,
        v_stock_unit_id,
        v_row.matched_variant_id,
        'receive',
        null,
        coalesce(nullif(btrim(v_row.proposed_stock_unit ->> 'status'), ''), 'full'),
        case
          when v_is_physical then 1
          else coalesce(
            (v_row.proposed_stock_unit ->> 'quantity_value')::numeric,
            1
          )
        end,
        case when jsonb_typeof(v_row.proposed_stock_unit -> 'remaining_length_value') = 'number'
          then (v_row.proposed_stock_unit ->> 'remaining_length_value')::numeric else null end,
        jsonb_build_object(
          'source', 'opening_inventory_import',
          'importId', p_import_id,
          'rowNumber', v_row.row_number,
          'unitIndex', v_unit_index,
          'unitCount', v_unit_count
        ),
        format(
          'inventory_import:%s:row:%s:unit:%s',
          p_import_id,
          v_row.row_number,
          v_unit_index
        ),
        'Opening inventory import',
        v_user_id
      )
      returning id into v_event_id;
      v_committed := v_committed + 1;
    end loop;

    update public.catalog_inventory_import_rows
       set status = 'committed',
           committed_stock_unit_id = v_stock_unit_id,
           committed_event_id = v_event_id,
           error = null,
           updated_at = now()
     where id = v_row.id;
  end loop;

  -- Physical units are authoritative, while catalog_variants.quantity remains
  -- the mirrored operational aggregate used by current stock screens.
  with affected_variants as (
    select distinct matched_variant_id as variant_id
      from public.catalog_inventory_import_rows
     where import_id = p_import_id
       and company_id = v_company_id
       and matched_variant_id is not null
  ),
  aggregates as (
    select affected.variant_id,
      coalesce(sum(
        case
          when stock.status not in ('full', 'partial') then 0
          when stock.unit_kind in ('roll', 'offcut')
               and stock.width_value is not null
               and stock.remaining_length_value is not null
               and lower(coalesce(stock.width_unit, '')) in ('in', 'inch', 'inches')
               and lower(coalesce(stock.length_unit, '')) in ('ft', 'foot', 'feet')
            then (stock.width_value / 12.0) * stock.remaining_length_value
          when stock.unit_kind in ('roll', 'offcut')
               and stock.width_value is not null
               and stock.remaining_length_value is not null
               and lower(coalesce(stock.width_unit, '')) in ('ft', 'foot', 'feet')
               and lower(coalesce(stock.length_unit, '')) in ('ft', 'foot', 'feet')
            then stock.width_value * stock.remaining_length_value
          when stock.unit_kind in ('roll', 'offcut')
               and stock.remaining_length_value is not null
            then stock.remaining_length_value
          when stock.unit_kind = 'length'
               and stock.remaining_length_value is not null
            then stock.remaining_length_value
          else stock.quantity_value
        end
      ), 0) as quantity
      from affected_variants affected
      left join public.catalog_stock_units stock
        on stock.catalog_variant_id = affected.variant_id
       and stock.company_id = v_company_id
       and stock.deleted_at is null
     group by affected.variant_id
  )
  update public.catalog_variants variant_row
     set quantity = aggregates.quantity,
         updated_at = now()
    from aggregates
   where variant_row.id = aggregates.variant_id
     and variant_row.company_id = v_company_id;

  update public.catalog_inventory_imports
     set status = 'complete',
         summary = summary || jsonb_build_object('committed', v_committed),
         completed_at = now(),
         error = null,
         updated_at = now()
   where id = p_import_id;

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'status', 'complete',
    'importId', p_import_id,
    'operationId', v_operation_id,
    'committed', v_committed
  );
exception
  when others then
    update public.catalog_inventory_imports
       set status = 'attention',
           error = jsonb_build_object(
             'code', sqlstate,
             'message', sqlerrm
           ),
           updated_at = now()
     where id = p_import_id
       and company_id = v_company_id;
    return jsonb_build_object(
      'ok', false,
      'status', 'attention',
      'importId', p_import_id,
      'blockers', jsonb_build_array(jsonb_build_object(
        'code', 'inventory_commit_failed',
        'message', sqlerrm
      ))
    );
end;
$function$;

revoke all on function public.catalog_inventory_import_commit(uuid)
  from public;
grant execute on function public.catalog_inventory_import_commit(uuid)
  to authenticated, anon;

comment on function public.catalog_inventory_import_commit(uuid) is
  'Atomically commits a server-staged opening-inventory import, writes receive events, and mirrors physical stock into catalog variant quantity.';

commit;
