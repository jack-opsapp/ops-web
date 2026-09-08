CREATE OR REPLACE FUNCTION public.enqueue_accounting_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_row_json jsonb;
  v_old_json jsonb := '{}'::jsonb;
  v_new_json jsonb := '{}'::jsonb;
  v_company_id uuid;
  v_connection record;
  v_entity_type text;
  v_entity_id uuid;
  v_external_id text;
  v_operation text;
  v_connection_operation text;
  v_source_action text;
  v_source_updated_at timestamptz;
  v_payload jsonb;
  v_parent_entity_type text;
  v_parent_entity_id text;
  v_parent_external_id text;
begin
  if current_setting('ops.sync_source', true) in ('quickbooks', 'sage') then
    return coalesce(new, old);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then v_new_json := to_jsonb(new); end if;
  if tg_op in ('UPDATE', 'DELETE') then v_old_json := to_jsonb(old); end if;
  v_row_json := case when tg_op = 'DELETE' then v_old_json else v_new_json end;
  v_company_id := nullif(v_row_json->>'company_id', '')::uuid;
  if v_company_id is null then return coalesce(new, old); end if;

  v_source_updated_at := nullif(
    coalesce(v_row_json->>'updated_at', v_row_json->>'created_at'),
    ''
  )::timestamptz;
  v_entity_type := case tg_table_name
    when 'clients' then 'customer'
    when 'sub_clients' then 'customer'
    when 'invoices' then 'invoice'
    when 'estimates' then 'estimate'
    when 'payments' then 'payment'
    when 'line_items' then case
      when nullif(v_row_json->>'invoice_id', '') is not null then 'invoice'
      when nullif(v_row_json->>'estimate_id', '') is not null then 'estimate'
      else null
    end
    else null
  end;
  v_entity_id := case tg_table_name
    when 'sub_clients' then nullif(v_row_json->>'client_id', '')::uuid
    when 'line_items' then coalesce(
      nullif(v_row_json->>'invoice_id', '')::uuid,
      nullif(v_row_json->>'estimate_id', '')::uuid
    )
    else nullif(v_row_json->>'id', '')::uuid
  end;
  if v_entity_type is null or v_entity_id is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE'
     and tg_table_name <> 'line_items'
     and (v_old_json - 'qb_id' - 'sage_id' - 'updated_at')
       = (v_new_json - 'qb_id' - 'sage_id' - 'updated_at') then
    return new;
  end if;

  v_source_action := lower(tg_op);
  v_operation := case
    when tg_op = 'DELETE'
      and tg_table_name in ('clients', 'sub_clients') then 'inactivate'
    when tg_op = 'DELETE'
      and tg_table_name = 'invoices' then 'void'
    when tg_op = 'DELETE'
      and tg_table_name = 'estimates' then 'delete'
    when tg_op = 'DELETE'
      and tg_table_name = 'payments' then 'void'
    when tg_op = 'UPDATE'
      and tg_table_name in ('clients', 'sub_clients')
      and v_new_json->>'deleted_at' is not null
      and v_old_json->>'deleted_at' is null then 'inactivate'
    when tg_op = 'UPDATE'
      and tg_table_name = 'invoices'
      and (
        (v_new_json->>'deleted_at' is not null and v_old_json->>'deleted_at' is null)
        or (v_new_json->>'status' = 'void' and v_old_json->>'status' is distinct from 'void')
      ) then 'void'
    when tg_op = 'UPDATE'
      and tg_table_name = 'estimates'
      and v_new_json->>'deleted_at' is not null
      and v_old_json->>'deleted_at' is null then 'delete'
    when tg_op = 'UPDATE'
      and tg_table_name = 'payments'
      and v_new_json->>'voided_at' is not null
      and v_old_json->>'voided_at' is null then 'void'
    when tg_op = 'INSERT' then 'create'
    else 'update'
  end;
  if v_operation in ('inactivate', 'void', 'delete') then
    v_source_action := case when v_operation = 'void' then 'void' else 'soft_delete' end;
  end if;

  v_parent_entity_type := case
    when v_entity_type in ('invoice', 'estimate') then 'customer'
    when v_entity_type = 'payment' then 'invoice'
    else null
  end;
  v_parent_entity_id := case
    when v_entity_type in ('invoice', 'estimate') then nullif(v_row_json->>'client_id', '')
    when v_entity_type = 'payment' then nullif(v_row_json->>'invoice_id', '')
    else null
  end;
  if tg_table_name = 'line_items' and v_entity_type = 'invoice' then
    select invoice.client_id::text into v_parent_entity_id
    from public.invoices invoice
    where invoice.id = v_entity_id and invoice.company_id = v_company_id;
  elsif tg_table_name = 'line_items' and v_entity_type = 'estimate' then
    select estimate.client_id::text into v_parent_entity_id
    from public.estimates estimate
    where estimate.id = v_entity_id and estimate.company_id = v_company_id;
  end if;

  for v_connection in
    select connection.id,
           connection.provider,
           connection.provider_environment,
           connection.propagate_deletes
    from public.accounting_connections connection
    where connection.company_id = v_company_id::text
      and connection.provider in ('quickbooks', 'sage')
      and connection.is_connected = true
      and connection.sync_enabled = true
      and connection.sync_direction in ('push_only', 'bidirectional')
    order by connection.provider, connection.provider_environment, connection.id
  loop
    v_connection_operation := v_operation;
    v_parent_external_id := null;

    if exists (
      select 1
      from public.accounting_sync_suppressions suppression
      where suppression.company_id = v_company_id
        and suppression.provider = v_connection.provider
        and suppression.entity_type = v_entity_type
        and suppression.entity_id = v_entity_id
        and suppression.source = v_connection.provider
        and suppression.expires_at > now()
    ) then
      continue;
    end if;

    if tg_table_name = 'line_items' then
      if v_entity_type = 'invoice' then
        select case v_connection.provider
          when 'quickbooks' then invoice.qb_id
          else invoice.sage_id
        end
        into v_external_id
        from public.invoices invoice
        where invoice.id = v_entity_id and invoice.company_id = v_company_id;
      else
        select case v_connection.provider
          when 'quickbooks' then estimate.qb_id
          else estimate.sage_id
        end
        into v_external_id
        from public.estimates estimate
        where estimate.id = v_entity_id and estimate.company_id = v_company_id;
      end if;
    else
      v_external_id := nullif(
        v_row_json->>(case
          when v_connection.provider = 'quickbooks' then 'qb_id'
          else 'sage_id'
        end),
        ''
      );
    end if;

    if v_parent_entity_id is not null then
      if v_parent_entity_type = 'customer' then
        select case v_connection.provider
          when 'quickbooks' then client.qb_id
          else client.sage_id
        end
        into v_parent_external_id
        from public.clients client
        where client.id = v_parent_entity_id::uuid
          and client.company_id = v_company_id;
      elsif v_parent_entity_type = 'invoice' then
        select case v_connection.provider
          when 'quickbooks' then invoice.qb_id
          else invoice.sage_id
        end
        into v_parent_external_id
        from public.invoices invoice
        where invoice.id = v_parent_entity_id::uuid
          and invoice.company_id = v_company_id;
      end if;
    end if;

    if tg_op = 'INSERT' and v_external_id is not null then
      v_connection_operation := 'update';
    end if;
    if v_connection_operation in ('inactivate', 'void', 'delete')
       and not v_connection.propagate_deletes then
      insert into public.accounting_sync_events (
        company_id, connection_id, provider, direction, entity_type,
        entity_id, external_id, operation, status, source, ops_updated_at,
        decision, before_snapshot, after_snapshot, error
      ) values (
        v_company_id, v_connection.id, v_connection.provider, 'system',
        v_entity_type, v_entity_id::text, v_external_id, v_connection_operation,
        'skipped', 'trigger', v_source_updated_at, 'skipped', v_old_json,
        v_new_json, 'propagate_deletes=false; outbound lifecycle change skipped'
      );
      continue;
    end if;

    v_payload := jsonb_build_object(
      'schemaVersion', 2,
      'table', tg_table_name,
      'op', tg_op,
      'provider', v_connection.provider,
      'providerEnvironment', v_connection.provider_environment,
      'entityType', v_entity_type,
      'entityId', v_entity_id,
      'sourceRowId', nullif(v_row_json->>'id', ''),
      'externalId', v_external_id,
      'parentEntityType', v_parent_entity_type,
      'parentEntityId', v_parent_entity_id,
      'parentExternalId', v_parent_external_id,
      'updatedAt', v_source_updated_at,
      'snapshot', v_row_json
    );

    insert into public.accounting_sync_queue (
      company_id, connection_id, provider, entity_type, entity_id,
      external_id, operation, source_table, source_action,
      source_updated_at, idempotency_key, payload_snapshot
    ) values (
      v_company_id, v_connection.id, v_connection.provider, v_entity_type,
      v_entity_id, v_external_id, v_connection_operation, tg_table_name,
      v_source_action, v_source_updated_at,
      concat(v_entity_type, ':', v_entity_id::text), v_payload
    )
    on conflict (
      company_id, connection_id, provider, entity_type, entity_id,
      operation, idempotency_key
    ) where status = 'pending'
    do update set
      external_id = excluded.external_id,
      source_updated_at = excluded.source_updated_at,
      payload_snapshot = excluded.payload_snapshot,
      run_after = least(public.accounting_sync_queue.run_after, excluded.run_after),
      updated_at = now();
  end loop;
  return coalesce(new, old);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_next_document_number(p_company_id uuid, p_type text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_next bigint; v_prefix text; v_year int;
BEGIN
  v_year := EXTRACT(YEAR FROM CURRENT_DATE);
  UPDATE document_sequences
  SET last_number = last_number + 1
  WHERE company_id = p_company_id AND document_type = p_type AND fiscal_year = v_year
  RETURNING last_number, prefix INTO v_next, v_prefix;

  IF NOT FOUND THEN
    v_prefix := CASE p_type WHEN 'estimate' THEN 'EST' WHEN 'invoice' THEN 'INV' END;
    INSERT INTO document_sequences (company_id, document_type, prefix, last_number, fiscal_year)
    VALUES (p_company_id, p_type, v_prefix, 1, v_year)
    RETURNING last_number, prefix INTO v_next, v_prefix;
  END IF;

  RETURN v_prefix || '-' || v_year || '-' || LPAD(v_next::text, 5, '0');
END; $function$
;
