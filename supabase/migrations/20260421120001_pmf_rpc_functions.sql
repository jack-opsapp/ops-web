-- ============================================================================
-- PMF RPC functions consumed by pmf-queries.ts
-- ============================================================================

create or replace function public.pmf_count_tier_a_paid_delivered()
returns bigint language sql stable as $$
  select count(*) from public.pmf_deals
   where deal_type = 'tier_a'
     and stage in ('in_delivery','delivered','closed_won')
     and deposit_paid_at is not null
     and coalesce(deposit_amount_cents, 0) >= coalesce(implementation_fee_cents, 0) * 0.5;
$$;

create or replace function public.pmf_count_retained_saas()
returns bigint language sql stable as $$
  with paid as (
    select company_id, occurred_at,
           date_trunc('month', occurred_at) as paid_month
      from public.billing_events
     where event_type = 'invoice.paid' and company_id is not null
  ),
  agg as (
    select company_id,
           min(occurred_at) as first_paid_at,
           max(occurred_at) as last_paid_at,
           array_agg(distinct paid_month order by paid_month) as months
      from paid
     group by company_id
  ),
  consecutive as (
    select a.company_id from agg a
     where a.first_paid_at <= now() - interval '60 days'
       and a.last_paid_at  >= now() - interval '40 days'
       and exists (
         select 1 from unnest(a.months) with ordinality as m(month, idx)
         join unnest(a.months) with ordinality as n(month, idx)
           on n.idx = m.idx + 1 and n.month = m.month + interval '1 month'
       )
       and not exists (
         select 1 from public.billing_events b
          where b.company_id = a.company_id
            and b.event_type = 'customer.subscription.deleted'
            and b.occurred_at > a.last_paid_at
       )
  )
  select count(*) from consecutive;
$$;

create or replace function public.pmf_latest_mature_conversion()
returns numeric language sql stable as $$
  with cohort as (
    select date_trunc('month', trial_started_at) as cohort_month,
           count(*) as trials,
           count(*) filter (where first_paid_at is not null) as paid
      from public.trial_attributions
     where trial_started_at <= now() - interval '30 days'
     group by 1
     order by 1 desc
     limit 1
  )
  select case when trials > 0 then paid::numeric / trials else 0 end
    from cohort;
$$;

create or replace function public.pmf_latest_cohort_churn()
returns numeric language sql stable as $$
  -- Approximation: fraction of companies that paid in month N-1 but not in month N (latest closed month).
  with latest as (select date_trunc('month', now() - interval '1 month') as m),
  prev_m as (select date_trunc('month', now() - interval '2 months') as m),
  prev_payers as (
    select distinct company_id from public.billing_events, prev_m
     where event_type='invoice.paid'
       and date_trunc('month', occurred_at) = prev_m.m
  ),
  latest_payers as (
    select distinct company_id from public.billing_events, latest
     where event_type='invoice.paid'
       and date_trunc('month', occurred_at) = latest.m
  )
  select case when (select count(*) from prev_payers) > 0
           then (select count(*) from prev_payers p
                  where p.company_id not in (select company_id from latest_payers))::numeric
                / (select count(*) from prev_payers)
           else 0 end;
$$;

create or replace function public.pmf_sparkline(kind text)
returns numeric[] language plpgsql stable as $$
declare result numeric[] := array[]::numeric[];
declare w int;
declare start_ts timestamptz;
declare end_ts timestamptz;
declare v numeric;
begin
  for w in 0..11 loop
    start_ts := date_trunc('week', now()) - ((11 - w) || ' weeks')::interval;
    end_ts   := start_ts + interval '1 week';
    v := case kind
      when 'trials' then (
        select count(*) from public.trial_attributions
         where trial_started_at >= start_ts and trial_started_at < end_ts)
      when 'active_pipeline' then (
        select count(*) from public.pmf_deals
         where deal_type='tier_a'
           and stage in ('contacted','qualified','proposal','negotiation')
           and stage_entered_at < end_ts)
      when 'conversion' then (
        select case when count(*) > 0
                 then count(*) filter (where first_paid_at is not null)::numeric / count(*)
                 else 0 end
          from public.trial_attributions
         where trial_started_at >= start_ts and trial_started_at < end_ts)
      when 'churn' then 0 -- churn is monthly; use zero for weekly sparkline
      when 'referrals' then (
        select count(*) from public.pmf_prospects
         where source='referral' and created_at < end_ts)
      else 0 end;
    result := result || coalesce(v, 0);
  end loop;
  return result;
end $$;
