begin;

-- ============================================================================
-- QuickBooks inbound/apply safety — locked line item replacement
--
-- QBO webhooks are at-least-once and can arrive concurrently for the same
-- invoice/estimate. The app used to delete line_items by parent, then reinsert
-- rows one by one from the server process. Two duplicate webhook handlers could
-- interleave those client-side operations and leave duplicate or partial lines.
--
-- This RPC makes line replacement one database transaction:
--   1. validate exactly one parent,
--   2. take a transaction-scoped advisory lock for that parent,
--   3. lock the parent row FOR UPDATE,
--   4. delete old lines,
--   5. bulk insert the normalized QBO line set.
--
-- The function is service-role only. It deliberately does not accept/insert
-- generated `line_total`, and it never mutates invoice/estimate parent rows.
-- ============================================================================

create or replace function public.replace_qbo_line_items_locked(
  p_company_id uuid,
  p_invoice_id uuid default null,
  p_estimate_id uuid default null,
  p_lines jsonb default '[]'::jsonb
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_parent_type text;
  v_parent_id uuid;
begin
  if p_company_id is null then
    raise exception 'replace_qbo_line_items_locked: company_id is required';
  end if;

  if (p_invoice_id is null and p_estimate_id is null)
     or (p_invoice_id is not null and p_estimate_id is not null) then
    raise exception 'replace_qbo_line_items_locked: exactly one parent is required';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'replace_qbo_line_items_locked: p_lines must be a json array';
  end if;

  if p_invoice_id is not null then
    v_parent_type := 'invoice';
    v_parent_id := p_invoice_id;

    perform pg_advisory_xact_lock(
      hashtextextended(
        concat_ws(':', 'qbo-line-items', p_company_id::text, v_parent_type, v_parent_id::text),
        0
      )
    );

    perform 1
    from public.invoices
    where company_id = p_company_id
      and id = p_invoice_id
    for update;

    if not found then
      raise exception 'replace_qbo_line_items_locked: invoice parent not found';
    end if;

    delete from public.line_items
    where company_id = p_company_id
      and invoice_id = p_invoice_id;
  else
    v_parent_type := 'estimate';
    v_parent_id := p_estimate_id;

    perform pg_advisory_xact_lock(
      hashtextextended(
        concat_ws(':', 'qbo-line-items', p_company_id::text, v_parent_type, v_parent_id::text),
        0
      )
    );

    perform 1
    from public.estimates
    where company_id = p_company_id
      and id = p_estimate_id
    for update;

    if not found then
      raise exception 'replace_qbo_line_items_locked: estimate parent not found';
    end if;

    delete from public.line_items
    where company_id = p_company_id
      and estimate_id = p_estimate_id;
  end if;

  insert into public.line_items (
    company_id,
    estimate_id,
    invoice_id,
    product_id,
    name,
    description,
    quantity,
    unit,
    unit_price,
    is_taxable,
    sort_order,
    type
  )
  select
    p_company_id,
    case when v_parent_type = 'estimate' then v_parent_id else null end,
    case when v_parent_type = 'invoice' then v_parent_id else null end,
    null::uuid,
    coalesce(nullif(line.name, ''), 'Line item'),
    nullif(line.description, ''),
    coalesce(line.quantity, 1),
    null::text,
    coalesce(line.unit_price, 0),
    coalesce(line.is_taxable, false),
    coalesce(line.sort_order, 0),
    coalesce(nullif(line.type, ''), 'OTHER')
  from jsonb_to_recordset(p_lines) as line(
    name text,
    description text,
    quantity numeric,
    unit_price numeric,
    is_taxable boolean,
    sort_order integer,
    type text
  );
end;
$$;

revoke all on function public.replace_qbo_line_items_locked(
  uuid,
  uuid,
  uuid,
  jsonb
) from public, anon, authenticated;

grant execute on function public.replace_qbo_line_items_locked(
  uuid,
  uuid,
  uuid,
  jsonb
) to service_role;

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(
    'public.replace_qbo_line_items_locked(uuid, uuid, uuid, jsonb)'::regprocedure
  )
  into v_def;

  if v_def is null
     or position('pg_advisory_xact_lock' in v_def) = 0
     or position('hashtextextended' in v_def) = 0
     or position('for update' in lower(v_def)) = 0
     or position('line_total' in v_def) > 0 then
    raise exception 'qbo_locked_line_item_replacement_sentinel: function body is unsafe';
  end if;
end $$;

commit;
