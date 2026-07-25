begin;

create or replace function public.convert_estimate_to_invoice(
  p_estimate_id uuid,
  p_due_date date default (current_date + 30)
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_estimate estimates%rowtype;
  v_invoice_id uuid;
  v_invoice_number text;
begin
  select * into v_estimate from estimates where id = p_estimate_id;
  if not found then raise exception 'Estimate not found'; end if;
  if v_estimate.status != 'approved' then
    raise exception 'Only approved estimates can become invoices (current: %)', v_estimate.status;
  end if;

  v_invoice_number := get_next_document_number(v_estimate.company_id, 'invoice');

  insert into invoices (
    company_id, client_id, estimate_id, opportunity_id,
    invoice_number, subtotal, discount_type, discount_value, discount_amount,
    tax_rate, tax_amount, total, balance_due,
    due_date, terms, deposit_applied, created_by
  ) values (
    v_estimate.company_id, v_estimate.client_id, v_estimate.id, v_estimate.opportunity_id,
    v_invoice_number, v_estimate.subtotal, v_estimate.discount_type, v_estimate.discount_value,
    v_estimate.discount_amount, v_estimate.tax_rate, v_estimate.tax_amount, v_estimate.total,
    v_estimate.total - coalesce(v_estimate.deposit_amount, 0),
    p_due_date, v_estimate.terms, coalesce(v_estimate.deposit_amount, 0), v_estimate.created_by
  ) returning id into v_invoice_id;

  create temp table _parent_map (old_id uuid, new_id uuid) on commit drop;

  insert into line_items (
    company_id, invoice_id, product_id, name, description,
    quantity, unit, unit_id, unit_price, resolved_unit_price, minimum_charge_snapshot,
    unit_cost, estimated_hours, discount_percent,
    is_taxable, tax_rate_id, sort_order, category, type, task_type_id, task_type_ref,
    configured_options, resolved_options_label, parent_line_item_id
  )
  select
    company_id, v_invoice_id, product_id, name, description,
    quantity, unit, unit_id, unit_price, resolved_unit_price, minimum_charge_snapshot,
    unit_cost, estimated_hours, discount_percent,
    is_taxable, tax_rate_id, sort_order, category, type, task_type_id, task_type_ref,
    configured_options, resolved_options_label, null
  from line_items
  where estimate_id = p_estimate_id
    and parent_line_item_id is null
    and (is_optional = false or is_selected = true);

  insert into _parent_map (old_id, new_id)
  select est.id, inv.id
  from line_items est
  join line_items inv on inv.invoice_id = v_invoice_id
    and inv.sort_order = est.sort_order
    and inv.name = est.name
  where est.estimate_id = p_estimate_id
    and est.parent_line_item_id is null
    and (est.is_optional = false or est.is_selected = true);

  insert into line_items (
    company_id, invoice_id, product_id, name, description,
    quantity, unit, unit_id, unit_price, resolved_unit_price, minimum_charge_snapshot,
    unit_cost, estimated_hours, discount_percent,
    is_taxable, tax_rate_id, sort_order, category, type, task_type_id, task_type_ref,
    configured_options, resolved_options_label, parent_line_item_id
  )
  select
    c.company_id, v_invoice_id, c.product_id, c.name, c.description,
    c.quantity, c.unit, c.unit_id, c.unit_price, c.resolved_unit_price, c.minimum_charge_snapshot,
    c.unit_cost, c.estimated_hours, c.discount_percent,
    c.is_taxable, c.tax_rate_id, c.sort_order, c.category, c.type, c.task_type_id, c.task_type_ref,
    c.configured_options, c.resolved_options_label, pm.new_id
  from line_items c
  join _parent_map pm on pm.old_id = c.parent_line_item_id
  where c.estimate_id = p_estimate_id;

  update estimates set status = 'converted', updated_at = now() where id = p_estimate_id;

  insert into activities (
    company_id, opportunity_id, client_id, estimate_id, invoice_id,
    type, subject, created_by
  )
  values (
    v_estimate.company_id, v_estimate.opportunity_id, v_estimate.client_id,
    p_estimate_id, v_invoice_id, 'invoice_sent',
    'Invoice ' || v_invoice_number || ' created from estimate', v_estimate.created_by
  );

  return v_invoice_id;
end;
$function$;

create or replace function public.create_progress_invoice(
  p_estimate_id uuid,
  p_line_item_selections jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_estimate       estimates%rowtype;
  v_invoice_id     uuid;
  v_inv_number     text;
  v_subtotal       numeric := 0;
  v_taxable_total  numeric := 0;
  v_tax_amount     numeric := 0;
  v_total          numeric := 0;
  v_sel            jsonb;
  v_li             line_items%rowtype;
  v_pct            numeric;
  v_pro_qty        numeric;
  v_line_total     numeric;
  v_sort           int := 0;
  v_caller_company uuid;
  v_new_parent_id  uuid;
  v_child          line_items%rowtype;
  i                int;
begin
  v_caller_company := private.get_user_company_id();

  if v_caller_company is null then
    raise exception 'Unauthorized: user not found';
  end if;

  select * into v_estimate from estimates where id = p_estimate_id;
  if not found then
    raise exception 'Estimate not found';
  end if;

  if v_estimate.company_id != v_caller_company then
    raise exception 'Unauthorized: estimate belongs to a different company';
  end if;

  if v_estimate.status != 'approved' then
    raise exception 'Only approved estimates can create invoices (current: %)', v_estimate.status;
  end if;

  v_inv_number := get_next_document_number(v_estimate.company_id, 'invoice');

  insert into invoices (
    company_id, client_id, estimate_id, opportunity_id,
    invoice_number, subtotal, tax_rate, tax_amount, total, balance_due,
    due_date, terms, created_by
  ) values (
    v_estimate.company_id, v_estimate.client_id, p_estimate_id, v_estimate.opportunity_id,
    v_inv_number, 0, coalesce(v_estimate.tax_rate, 0), 0, 0, 0,
    current_date + 30, v_estimate.terms, v_estimate.created_by
  ) returning id into v_invoice_id;

  for i in 0 .. jsonb_array_length(p_line_item_selections) - 1
  loop
    v_sel := p_line_item_selections -> i;

    select * into v_li
    from line_items
    where id = (v_sel ->> 'line_item_id')::uuid
      and estimate_id = p_estimate_id;
    if not found then continue; end if;

    v_pct := (v_sel ->> 'percentage')::numeric;
    if v_pct <= 0 or v_pct > 100 then continue; end if;

    v_pro_qty := round(v_li.quantity * (v_pct / 100.0), 4);
    if v_li.line_total is not null then
      v_line_total := round(v_li.line_total * (v_pct / 100.0), 2);
    else
      v_line_total := round(
        v_pro_qty * v_li.unit_price * (1 - coalesce(v_li.discount_percent, 0) / 100.0),
        2
      );
    end if;

    v_subtotal := v_subtotal + v_line_total;

    if coalesce(v_li.is_taxable, true) then
      v_taxable_total := v_taxable_total + v_line_total;
    end if;

    v_sort := v_sort + 1;

    insert into line_items (
      company_id, invoice_id, product_id, name, description,
      quantity, unit, unit_id, unit_price, resolved_unit_price, minimum_charge_snapshot,
      unit_cost, estimated_hours, discount_percent,
      is_taxable, tax_rate_id, sort_order, category, type, task_type_id, task_type_ref,
      configured_options, resolved_options_label, parent_line_item_id
    ) values (
      v_li.company_id, v_invoice_id, v_li.product_id,
      v_li.name,
      coalesce(nullif(v_li.description, ''), v_li.name) || ' (' || v_pct || '% progress)',
      v_pro_qty, v_li.unit, v_li.unit_id, v_li.unit_price, v_li.resolved_unit_price,
      case
        when v_li.minimum_charge_snapshot is null then null
        else round(v_li.minimum_charge_snapshot * (v_pct / 100.0), 2)
      end,
      v_li.unit_cost, v_li.estimated_hours, v_li.discount_percent,
      v_li.is_taxable, v_li.tax_rate_id,
      v_sort, v_li.category, v_li.type, v_li.task_type_id, v_li.task_type_ref,
      v_li.configured_options, v_li.resolved_options_label, null
    ) returning id into v_new_parent_id;

    for v_child in
      select * from line_items
      where parent_line_item_id = v_li.id
        and estimate_id = p_estimate_id
      order by sort_order
    loop
      v_sort := v_sort + 1;
      insert into line_items (
        company_id, invoice_id, product_id, name, description,
        quantity, unit, unit_id, unit_price, resolved_unit_price, minimum_charge_snapshot,
        unit_cost, estimated_hours, discount_percent,
        is_taxable, tax_rate_id, sort_order, category, type, task_type_id, task_type_ref,
        configured_options, resolved_options_label, parent_line_item_id
      ) values (
        v_child.company_id, v_invoice_id, v_child.product_id,
        v_child.name, v_child.description,
        round(v_child.quantity * (v_pct / 100.0), 4),
        v_child.unit, v_child.unit_id, v_child.unit_price, v_child.resolved_unit_price,
        case
          when v_child.minimum_charge_snapshot is null then null
          else round(v_child.minimum_charge_snapshot * (v_pct / 100.0), 2)
        end,
        v_child.unit_cost, v_child.estimated_hours, v_child.discount_percent,
        v_child.is_taxable, v_child.tax_rate_id,
        v_sort, v_child.category, v_child.type, v_child.task_type_id, v_child.task_type_ref,
        v_child.configured_options, v_child.resolved_options_label, v_new_parent_id
      );
    end loop;
  end loop;

  if v_sort = 0 then
    delete from invoices where id = v_invoice_id;
    raise exception 'No valid line items selected for progress invoice';
  end if;

  v_tax_amount := round(v_taxable_total * coalesce(v_estimate.tax_rate, 0), 2);
  v_total := v_subtotal + v_tax_amount;

  update invoices set
    subtotal = v_subtotal,
    tax_amount = v_tax_amount,
    total = v_total,
    balance_due = v_total
  where id = v_invoice_id;

  insert into activities (
    company_id, opportunity_id, client_id, estimate_id, invoice_id,
    type, subject, created_by
  ) values (
    v_estimate.company_id, v_estimate.opportunity_id, v_estimate.client_id,
    p_estimate_id, v_invoice_id, 'invoice_created',
    'Progress invoice ' || v_inv_number || ' created from estimate',
    v_estimate.created_by
  );

  return v_invoice_id;
end;
$function$;

comment on function public.convert_estimate_to_invoice(uuid, date) is
  'Atomically converts an approved estimate and preserves signed product configuration snapshots.';

comment on function public.create_progress_invoice(uuid, jsonb) is
  'Creates a prorated invoice while preserving product configuration snapshots and decimal tax-rate semantics.';

commit;
