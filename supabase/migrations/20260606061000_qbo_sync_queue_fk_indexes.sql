begin;

create index if not exists accounting_sync_queue_connection_idx
  on public.accounting_sync_queue (connection_id);

create index if not exists accounting_sync_events_queue_idx
  on public.accounting_sync_events (queue_id);

create index if not exists accounting_sync_events_connection_idx
  on public.accounting_sync_events (connection_id);

commit;
