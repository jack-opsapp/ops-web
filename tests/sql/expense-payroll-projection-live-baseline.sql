-- Read-only production function capture, 2026-09-14. Fixture provenance only.
CREATE OR REPLACE FUNCTION public.read_agent_payroll_readiness_as_system(p_actor_user_id uuid, p_company_id uuid, p_oauth_grant_id uuid, p_oauth_client_id uuid, p_grant_revision text, p_granted_scope_ceiling text[], p_permission_snapshot_revision text, p_capability_manifest_revision text, p_exposure_revision text, p_capability_id text, p_capability_revision text, p_observed_at timestamp with time zone, p_target_date date, p_recurring_obligation_limit integer, p_reimbursement_batch_limit integer, p_receivable_limit integer, p_payer_history_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_timezone text;
  v_currency_code text;
  v_business_date date;
  v_company_revision bigint;
  v_payroll_revision bigint;
  v_settings jsonb := 'null'::jsonb;
  v_recurring jsonb := '[]'::jsonb;
  v_batches jsonb := '[]'::jsonb;
  v_receivables jsonb := '[]'::jsonb;
  v_history jsonb := '[]'::jsonb;
  v_recurring_count integer := 0;
  v_batch_count integer := 0;
  v_receivable_count integer := 0;
  v_history_count integer := 0;
begin
  perform private.assert_agent_payroll_readiness_authority(
    p_actor_user_id,
    p_company_id,
    p_oauth_grant_id,
    p_oauth_client_id,
    p_grant_revision,
    p_granted_scope_ceiling,
    p_permission_snapshot_revision,
    p_capability_manifest_revision,
    p_exposure_revision,
    p_capability_id,
    p_capability_revision
  );

  if p_observed_at is null
     or not pg_catalog.isfinite(p_observed_at)
     or p_observed_at > pg_catalog.statement_timestamp() + interval '5 minutes'
     or p_target_date is null
     or not pg_catalog.isfinite(p_target_date)
     or p_recurring_obligation_limit is distinct from 40
     or p_reimbursement_batch_limit is distinct from 50
     or p_receivable_limit is distinct from 100
     or p_payer_history_limit is distinct from 500 then
    raise exception 'AGENT_PAYROLL_READINESS_INPUT_INVALID'
      using errcode = '22023';
  end if;

  select company.timezone,
         pg_catalog.upper(pg_catalog.btrim(company.currency_code))
    into v_timezone, v_currency_code
  from public.companies company
  where company.id = p_company_id
    and company.deleted_at is null;

  if v_timezone is null
     or not exists (
       select 1
       from pg_catalog.pg_timezone_names timezone_row
       where timezone_row.name = v_timezone
     )
     or v_currency_code is null
     or v_currency_code !~ '^[A-Z]{3}$' then
    raise exception 'AGENT_PAYROLL_READINESS_COMPANY_CONTEXT_INVALID'
      using errcode = '22000';
  end if;

  v_business_date := (p_observed_at at time zone v_timezone)::date;
  if p_target_date < v_business_date
     or p_target_date > v_business_date + 93 then
    raise exception 'AGENT_PAYROLL_READINESS_TARGET_DATE_INVALID'
      using errcode = '22023';
  end if;

  select revision.source_revision
    into v_company_revision
  from private.agent_read_domain_revisions revision
  where revision.company_id = p_company_id
    and revision.domain = 'company';
  select revision.source_revision
    into v_payroll_revision
  from private.agent_read_domain_revisions revision
  where revision.company_id = p_company_id
    and revision.domain = 'payroll_readiness';
  if v_company_revision is null or v_payroll_revision is null then
    raise exception 'AGENT_PAYROLL_READINESS_SOURCE_REVISION_MISSING'
      using errcode = '55000';
  end if;

  select pg_catalog.jsonb_build_object(
           'id', settings.id,
           'cash_balance', case
             when pg_catalog.lower(settings.forecast_current_balance::text)
               in ('nan', 'infinity', '-infinity')
               or pg_catalog.length(settings.forecast_current_balance::text) > 64
               then '__invalid__'
             else settings.forecast_current_balance::text
           end,
           'cash_balance_updated_at', case
             when settings.forecast_balance_updated_at is null then null
             when not pg_catalog.isfinite(
               settings.forecast_balance_updated_at
             ) or extract(
               year from settings.forecast_balance_updated_at at time zone 'UTC'
             ) not between 1 and 9999 then '__invalid__'
             else pg_catalog.to_char(
               settings.forecast_balance_updated_at at time zone 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
             )
           end,
           'obligations_confirmed_through',
             case
               when settings.forecast_obligations_confirmed_through is null
                 then null
               when not pg_catalog.isfinite(
                 settings.forecast_obligations_confirmed_through
               ) or extract(
                 year from settings.forecast_obligations_confirmed_through
               ) not between 1 and 9999 then '__invalid__'
               else settings.forecast_obligations_confirmed_through::text
             end,
           'obligations_confirmed_at', case
             when settings.forecast_obligations_confirmed_at is null then null
             when not pg_catalog.isfinite(
               settings.forecast_obligations_confirmed_at
             ) or extract(
               year from settings.forecast_obligations_confirmed_at at time zone 'UTC'
             ) not between 1 and 9999 then '__invalid__'
             else pg_catalog.to_char(
               settings.forecast_obligations_confirmed_at at time zone 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
             )
           end
         )
    into v_settings
  from public.expense_settings settings
  where settings.company_id = p_company_id;
  v_settings := coalesce(v_settings, 'null'::jsonb);

  with candidate as materialized (
    select recurring.id,
           recurring.amount,
           case
             when pg_catalog.upper(pg_catalog.btrim(recurring.currency)) =
               v_currency_code then v_currency_code
             else '__mismatch__'
           end as currency,
           case
             when pg_catalog.lower(pg_catalog.btrim(recurring.cadence)) in (
               'weekly', 'biweekly', 'monthly', 'quarterly', 'annually'
             ) then pg_catalog.lower(pg_catalog.btrim(recurring.cadence))
             else '__invalid__'
           end as cadence,
           recurring.next_due_date,
           recurring.end_date,
           recurring.obligation_kind,
           recurring.due_time_local,
           recurring.updated_at
    from public.recurring_expenses recurring
    where recurring.company_id = p_company_id
      and recurring.deleted_at is null
      and (
        not pg_catalog.isfinite(recurring.next_due_date)
        or extract(year from recurring.next_due_date)
          not between 1 and 9999
        or recurring.next_due_date <= p_target_date
      )
    order by recurring.next_due_date, recurring.id
    limit p_recurring_obligation_limit + 1
  ), retained as materialized (
    select * from candidate
    order by next_due_date, id
    limit p_recurring_obligation_limit
  )
  select least((select count(*) from candidate),
               p_recurring_obligation_limit + 1),
         coalesce(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'id', retained.id,
             'amount', case
               when pg_catalog.lower(retained.amount::text)
                 in ('nan', 'infinity', '-infinity')
                 or pg_catalog.length(retained.amount::text) > 64
                 then '__invalid__'
               else retained.amount::text
             end,
             'currency', retained.currency,
             'cadence', retained.cadence,
             'next_due_date', case
               when pg_catalog.isfinite(retained.next_due_date)
                 and extract(year from retained.next_due_date)
                   between 1 and 9999
                 then retained.next_due_date::text
               else '__invalid__'
             end,
             'end_date', case
               when retained.end_date is null then null
               when pg_catalog.isfinite(retained.end_date)
                 and extract(year from retained.end_date)
                   between 1 and 9999
                 then retained.end_date::text
               else '__invalid__'
             end,
             'obligation_kind', retained.obligation_kind,
             'due_time_local', case
               when retained.due_time_local is null then null
               else pg_catalog.to_char(retained.due_time_local, 'HH24:MI:SS.US')
             end,
             'updated_at', case
               when pg_catalog.isfinite(retained.updated_at)
                 and extract(
                   year from retained.updated_at at time zone 'UTC'
                 ) between 1 and 9999
                 then pg_catalog.to_char(
                   retained.updated_at at time zone 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
                 )
               else '__invalid__'
             end
           ) order by retained.next_due_date, retained.id
         ), '[]'::jsonb)
    into v_recurring_count, v_recurring
  from retained;

  with candidate as materialized (
    select batch.id,
           case
             when batch.status = 'partially_approved'
               then coalesce(batch.approved_amount, batch.total_amount, 0)
             when batch.approved_amount is not null
               and batch.approved_amount > 0
               then batch.approved_amount
             else coalesce(batch.total_amount, 0)
           end as owed_amount,
           coalesce(lines.line_count, 0) as line_count,
           coalesce(lines.currency_codes, array[]::text[]) as currency_codes,
           coalesce(batch.reviewed_at, batch.created_at, '-infinity'::timestamptz)
             as ordered_at
    from public.expense_batches batch
    left join lateral (
      select least(count(*), 10000::bigint)::integer as line_count,
             pg_catalog.array_agg(distinct case
               when pg_catalog.upper(pg_catalog.btrim(expense.currency)) =
                 v_currency_code then v_currency_code
               else '__mismatch__'
             end order by case
               when pg_catalog.upper(pg_catalog.btrim(expense.currency)) =
                 v_currency_code then v_currency_code
               else '__mismatch__'
             end) as currency_codes
      from public.expenses expense
      where expense.company_id = p_company_id
        and expense.batch_id = batch.id
        and expense.deleted_at is null
    ) lines on true
    where batch.company_id = p_company_id
      and batch.status in ('approved', 'partially_approved', 'auto_approved')
      and batch.paid_at is null
    order by ordered_at, batch.id
    limit p_reimbursement_batch_limit + 1
  ), retained as materialized (
    select * from candidate
    order by ordered_at, id
    limit p_reimbursement_batch_limit
  )
  select least((select count(*) from candidate),
               p_reimbursement_batch_limit + 1),
         coalesce(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'id', retained.id,
             'owed_amount', case
               when pg_catalog.lower(retained.owed_amount::text)
                 in ('nan', 'infinity', '-infinity')
                 or pg_catalog.length(retained.owed_amount::text) > 64
                 then '__invalid__'
               else retained.owed_amount::text
             end,
             'line_count', retained.line_count,
             'currency_codes', pg_catalog.to_jsonb(retained.currency_codes)
           ) order by retained.ordered_at, retained.id
         ), '[]'::jsonb)
    into v_batch_count, v_batches
  from retained;

  with payment_totals as materialized (
    select payment.invoice_id,
           coalesce(pg_catalog.sum(payment.amount), 0::numeric) as paid_amount
    from public.payments payment
    where payment.company_id = p_company_id
      and payment.voided_at is null
      and payment.payment_date <= v_business_date
    group by payment.invoice_id
  ), candidate as materialized (
    select invoice.id as invoice_id,
           invoice.client_id as payer_id,
           invoice.total,
           invoice.amount_paid,
           invoice.balance_due,
           greatest(
             invoice.total - coalesce(payment_totals.paid_amount, 0::numeric),
             0::numeric
           ) as calculated_balance,
           invoice.due_date,
           invoice.status,
           invoice.sent_at,
           (
             exists (
               select 1 from public.invoices duplicate
               where duplicate.company_id = p_company_id
                 and duplicate.id <> invoice.id
                 and duplicate.deleted_at is null
                 and (
                   (invoice.qb_id is not null and duplicate.qb_id = invoice.qb_id)
                   or (invoice.sage_id is not null and duplicate.sage_id = invoice.sage_id)
                 )
             )
             or exists (
               select 1
               from public.payments payment
               join public.payments duplicate
                on duplicate.company_id = payment.company_id
                and duplicate.id <> payment.id
                and duplicate.voided_at is null
                and duplicate.payment_date <= v_business_date
                and (
                  (payment.qb_id is not null and duplicate.qb_id = payment.qb_id)
                  or (payment.sage_id is not null and duplicate.sage_id = payment.sage_id)
                  or (
                    payment.stripe_payment_intent is not null
                    and duplicate.stripe_payment_intent = payment.stripe_payment_intent
                  )
                )
               where payment.company_id = p_company_id
                 and payment.invoice_id = invoice.id
                 and payment.voided_at is null
                 and payment.payment_date <= v_business_date
             )
           ) as identity_conflict
    from public.invoices invoice
    left join payment_totals on payment_totals.invoice_id = invoice.id
    where invoice.company_id = p_company_id
      and invoice.deleted_at is null
      and invoice.status in ('sent', 'awaiting_payment', 'partially_paid', 'past_due')
    order by invoice.due_date, invoice.id
    limit p_receivable_limit + 1
  ), retained as materialized (
    select * from candidate
    order by due_date, invoice_id
    limit p_receivable_limit
  )
  select least((select count(*) from candidate), p_receivable_limit + 1),
         coalesce(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'invoice_id', retained.invoice_id,
             'payer_id', retained.payer_id,
             'total_amount', case
               when pg_catalog.lower(retained.total::text)
                 in ('nan', 'infinity', '-infinity')
                 or pg_catalog.length(retained.total::text) > 64
                 then '__invalid__'
               else retained.total::text
             end,
             'stored_amount_paid', case
               when pg_catalog.lower(retained.amount_paid::text)
                 in ('nan', 'infinity', '-infinity')
                 or pg_catalog.length(retained.amount_paid::text) > 64
                 then '__invalid__'
               else retained.amount_paid::text
             end,
             'stored_balance_due', case
               when pg_catalog.lower(retained.balance_due::text)
                 in ('nan', 'infinity', '-infinity')
                 or pg_catalog.length(retained.balance_due::text) > 64
                 then '__invalid__'
               else retained.balance_due::text
             end,
             'calculated_balance', case
               when pg_catalog.lower(retained.calculated_balance::text)
                 in ('nan', 'infinity', '-infinity')
                 or pg_catalog.length(retained.calculated_balance::text) > 64
                 then '__invalid__'
               else retained.calculated_balance::text
             end,
             'due_date', case
               when pg_catalog.isfinite(retained.due_date)
                 and extract(year from retained.due_date)
                   between 1 and 9999
                 then retained.due_date::text
               else '__invalid__'
             end,
             'status', retained.status,
             'sent_at', case
               when retained.sent_at is null then null
               when not pg_catalog.isfinite(retained.sent_at)
                 or extract(
                   year from retained.sent_at at time zone 'UTC'
                 ) not between 1 and 9999
                 then '__invalid__'
               else pg_catalog.to_char(
                 retained.sent_at at time zone 'UTC',
                 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
               )
             end,
             'identity_conflict', retained.identity_conflict
           ) order by retained.due_date, retained.invoice_id
         ), '[]'::jsonb)
    into v_receivable_count, v_receivables
  from retained;

  with invoice_payment_source as materialized (
    select invoice.id as invoice_id,
           invoice.client_id as payer_id,
           invoice.due_date,
           invoice.total as invoice_total,
           payment.payment_date,
           payment.amount,
           (
             pg_catalog.lower(invoice.total::text) not in (
               'nan', 'infinity', '-infinity'
             )
             and pg_catalog.length(invoice.total::text) <= 64
             and pg_catalog.lower(payment.amount::text) not in (
               'nan', 'infinity', '-infinity'
             )
             and pg_catalog.length(payment.amount::text) <= 64
           ) as amount_valid,
           (
             exists (
               select 1 from public.invoices duplicate
               where duplicate.company_id = p_company_id
                 and duplicate.id <> invoice.id
                 and duplicate.deleted_at is null
                 and (
                   (invoice.qb_id is not null and duplicate.qb_id = invoice.qb_id)
                   or (invoice.sage_id is not null and duplicate.sage_id = invoice.sage_id)
                 )
             )
             or exists (
               select 1
               from public.payments same_payment
               join public.payments duplicate
                on duplicate.company_id = same_payment.company_id
                and duplicate.id <> same_payment.id
                and duplicate.voided_at is null
                and duplicate.payment_date <= v_business_date
                and (
                  (same_payment.qb_id is not null and duplicate.qb_id = same_payment.qb_id)
                  or (same_payment.sage_id is not null and duplicate.sage_id = same_payment.sage_id)
                  or (
                    same_payment.stripe_payment_intent is not null
                    and duplicate.stripe_payment_intent = same_payment.stripe_payment_intent
                  )
                )
               where same_payment.company_id = p_company_id
                 and same_payment.invoice_id = invoice.id
                 and same_payment.voided_at is null
                 and same_payment.payment_date <= v_business_date
             )
           ) as identity_conflict
    from public.invoices invoice
    join public.payments payment
     on payment.invoice_id = invoice.id
     and payment.company_id = p_company_id
     and payment.voided_at is null
     and payment.payment_date <= v_business_date
    where invoice.company_id = p_company_id
      and invoice.deleted_at is null
      and (
        invoice.total > 0
        or pg_catalog.lower(invoice.total::text) in (
          'nan', 'infinity', '-infinity'
        )
        or pg_catalog.length(invoice.total::text) > 64
      )
  ), payment_daily as materialized (
    select invoice_payment_source.invoice_id,
           invoice_payment_source.payer_id,
           invoice_payment_source.due_date,
           invoice_payment_source.invoice_total,
           invoice_payment_source.payment_date,
           pg_catalog.sum(invoice_payment_source.amount) as daily_amount,
           pg_catalog.bool_and(invoice_payment_source.amount_valid)
             as amount_valid,
           pg_catalog.bool_or(invoice_payment_source.identity_conflict)
             as identity_conflict
    from invoice_payment_source
    group by invoice_payment_source.invoice_id,
             invoice_payment_source.payer_id,
             invoice_payment_source.due_date,
             invoice_payment_source.invoice_total,
             invoice_payment_source.payment_date
  ), payment_running as materialized (
    select payment_daily.*,
           pg_catalog.sum(payment_daily.daily_amount) over (
             partition by payment_daily.invoice_id
             order by payment_daily.payment_date
             rows between unbounded preceding and current row
           ) as cumulative_amount
    from payment_daily
  ), payment_sustained as materialized (
    select payment_running.*,
           pg_catalog.min(payment_running.cumulative_amount) over (
             partition by payment_running.invoice_id
             order by payment_running.payment_date
             rows between current row and unbounded following
           ) as future_minimum_amount
    from payment_running
  ), settlement as materialized (
    select payment_sustained.invoice_id,
           payment_sustained.payer_id,
           payment_sustained.due_date,
           pg_catalog.min(payment_sustained.payment_date) filter (
             where payment_sustained.future_minimum_amount >=
               payment_sustained.invoice_total
               or not payment_sustained.amount_valid
           ) as settled_on,
           pg_catalog.bool_and(payment_sustained.amount_valid) as amount_valid,
           pg_catalog.bool_or(payment_sustained.identity_conflict)
             as identity_conflict
    from payment_sustained
    group by payment_sustained.invoice_id,
             payment_sustained.payer_id,
             payment_sustained.due_date
  ), candidate as materialized (
    select settlement.invoice_id,
           settlement.payer_id,
           settlement.due_date,
           settlement.settled_on,
           case
             when pg_catalog.isfinite(settlement.settled_on)
               and pg_catalog.isfinite(settlement.due_date)
               then (settlement.settled_on - settlement.due_date)::integer
             else 0
           end as delay_days,
           settlement.identity_conflict,
           settlement.amount_valid
    from settlement
    where settlement.settled_on is not null
    order by settlement.settled_on desc, settlement.invoice_id
    limit p_payer_history_limit + 1
  ), retained as materialized (
    select * from candidate
    order by settled_on desc, invoice_id
    limit p_payer_history_limit
  )
  select least((select count(*) from candidate), p_payer_history_limit + 1),
         coalesce(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'invoice_id', retained.invoice_id,
             'payer_id', retained.payer_id,
             'due_date', case
               when pg_catalog.isfinite(retained.due_date)
                 and extract(year from retained.due_date)
                   between 1 and 9999
                 then retained.due_date::text
               else '__invalid__'
             end,
             'settled_on', case
               when pg_catalog.isfinite(retained.settled_on)
                 and extract(year from retained.settled_on)
                   between 1 and 9999
                 then retained.settled_on::text
               else '__invalid__'
             end,
             'delay_days', retained.delay_days,
             'identity_conflict', retained.identity_conflict,
             'amount_valid', retained.amount_valid
           ) order by retained.settled_on desc, retained.invoice_id
         ), '[]'::jsonb)
    into v_history_count, v_history
  from retained;

  return pg_catalog.jsonb_build_object(
    'observed_at', pg_catalog.to_char(
      p_observed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ),
    'business_date', v_business_date,
    'target_date', p_target_date,
    'context', pg_catalog.jsonb_build_object(
      'company_id', p_company_id,
      'timezone', v_timezone,
      'currency_code', v_currency_code
    ),
    'source_revisions', pg_catalog.jsonb_build_object(
      'company', v_company_revision,
      'payroll_readiness', v_payroll_revision
    ),
    'settings', v_settings,
    'recurring_obligations', v_recurring,
    'reimbursement_batches', v_batches,
    'receivables', v_receivables,
    'payer_history', v_history,
    'source_counts', pg_catalog.jsonb_build_object(
      'recurring_obligations', v_recurring_count,
      'reimbursement_batches', v_batch_count,
      'receivables', v_receivable_count,
      'payer_history', v_history_count
    ),
    'source_bounds', pg_catalog.jsonb_build_object(
      'recurring_obligations',
        v_recurring_count > p_recurring_obligation_limit,
      'reimbursement_batches',
        v_batch_count > p_reimbursement_batch_limit,
      'receivables', v_receivable_count > p_receivable_limit,
      'payer_history', v_history_count > p_payer_history_limit
    )
  );
end;
$function$
;
