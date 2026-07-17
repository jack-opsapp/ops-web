begin;

-- PostgREST emits `on conflict (sg_message_id, event, "timestamp")` for the
-- SendGrid webhook. PostgreSQL cannot infer a partial unique index for that
-- statement unless the same predicate is present in the insert, which the
-- Supabase upsert API cannot express. A normal unique index is the correct
-- contract: PostgreSQL already treats NULL values as distinct, so provider
-- events without an sg_message_id remain independently insertable.
drop index if exists public.uq_email_events_idempotency;

create unique index uq_email_events_idempotency
  on public.email_events (sg_message_id, event, "timestamp");

comment on index public.uq_email_events_idempotency is
  'Inferable SendGrid webhook idempotency key. NULL provider message IDs remain distinct under PostgreSQL unique semantics.';

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_index i
    join pg_catalog.pg_class index_class
      on index_class.oid = i.indexrelid
    join pg_catalog.pg_class table_class
      on table_class.oid = i.indrelid
    join pg_catalog.pg_namespace table_namespace
      on table_namespace.oid = table_class.relnamespace
    where table_namespace.nspname = 'public'
      and table_class.relname = 'email_events'
      and index_class.relname = 'uq_email_events_idempotency'
      and i.indisunique
      and i.indisvalid
      and i.indisready
      and not i.indnullsnotdistinct
      and i.indpred is null
      and i.indnkeyatts = 3
      and i.indnatts = 3
      and pg_catalog.pg_get_indexdef(i.indexrelid, 1, true) = 'sg_message_id'
      and pg_catalog.pg_get_indexdef(i.indexrelid, 2, true) = 'event'
      and pg_catalog.pg_get_indexdef(i.indexrelid, 3, true) = '"timestamp"'
  ) then
    raise exception 'SendGrid email event idempotency index is missing'
      using errcode = '55000';
  end if;
end;
$$;

commit;
