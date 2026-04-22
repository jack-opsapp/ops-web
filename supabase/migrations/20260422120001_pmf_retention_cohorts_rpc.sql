-- pmf_retention_cohorts: 30/60/90-day retention by first-paid month cohort
-- For Marker 2 drill-in (Retained Base SaaS).

create or replace function public.pmf_retention_cohorts()
returns table (cohort_month text, size int, d30 numeric, d60 numeric, d90 numeric)
language sql stable as $$
  with first_paid as (
    select company_id, min(occurred_at) as first_paid_at
      from public.billing_events
     where event_type = 'invoice.paid'
       and company_id is not null
     group by company_id
  ),
  cohorts as (
    select to_char(date_trunc('month', first_paid_at), 'YYYY-MM') as cohort_month,
           company_id,
           first_paid_at
      from first_paid
  )
  select
    cohort_month,
    count(*)::int as size,
    count(*) filter (where exists (
      select 1 from public.billing_events b
       where b.company_id = cohorts.company_id
         and b.event_type = 'invoice.paid'
         and b.occurred_at between cohorts.first_paid_at + interval '25 days'
                              and cohorts.first_paid_at + interval '35 days'
    ))::numeric / nullif(count(*), 0) as d30,
    count(*) filter (where exists (
      select 1 from public.billing_events b
       where b.company_id = cohorts.company_id
         and b.event_type = 'invoice.paid'
         and b.occurred_at between cohorts.first_paid_at + interval '55 days'
                              and cohorts.first_paid_at + interval '65 days'
    ))::numeric / nullif(count(*), 0) as d60,
    count(*) filter (where exists (
      select 1 from public.billing_events b
       where b.company_id = cohorts.company_id
         and b.event_type = 'invoice.paid'
         and b.occurred_at between cohorts.first_paid_at + interval '85 days'
                              and cohorts.first_paid_at + interval '95 days'
    ))::numeric / nullif(count(*), 0) as d90
    from cohorts
   group by cohort_month
   order by cohort_month desc
   limit 12;
$$;

grant execute on function public.pmf_retention_cohorts() to service_role;
