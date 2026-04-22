-- pmf_mrr_weekly: weekly aggregation of paid invoices for MRR trend chart
-- Adds the RPC missed in 20260421120001_pmf_rpc_functions.sql.

create or replace function public.pmf_mrr_weekly(weeks int default 18)
returns table (week text, mrr_cents bigint)
language sql stable as $$
  with wk as (
    select generate_series(
      date_trunc('week', now()) - ((weeks - 1) || ' weeks')::interval,
      date_trunc('week', now()),
      interval '1 week'
    ) as start_ts
  )
  select to_char(wk.start_ts, 'IYYY-IW') as week,
         coalesce(sum(be.amount_cents)::bigint, 0) as mrr_cents
    from wk
    left join public.billing_events be
      on be.event_type = 'invoice.paid'
     and be.occurred_at >= wk.start_ts
     and be.occurred_at <  wk.start_ts + interval '1 week'
   group by wk.start_ts
   order by wk.start_ts;
$$;

grant execute on function public.pmf_mrr_weekly(int) to service_role;
