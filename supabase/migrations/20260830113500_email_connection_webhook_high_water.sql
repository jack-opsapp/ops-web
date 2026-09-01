begin;

-- Bug 86c758b1 — the webhook high-water gap.
--
-- A Gmail Pub/Sub push advertises the mailbox historyId at the moment mail
-- landed. The webhook route console.logged that number and fired a manual sync
-- at it. When the push arrives while the per-connection mailbox lease is held —
-- which is exactly when a burst of mail is being ingested — that manual sync is
-- rejected ("Sync already in progress"), the advertised position is lost, and
-- the mailbox stays parked at the in-flight pass's lower historyId until the
-- next cron interval. Up to an hour of mail is invisible to the operator with
-- no signal anywhere that anything is behind.
--
-- This records the advertised position durably instead. It is a monotone
-- high-water mark, never a cursor: the sync engine compares its own pass
-- against it and drains toward it before it may report the mailbox complete.
-- It is never read as a place to resume from, so a stale or absurd value can
-- only ever cost one bounded extra fetch, never skip mail.
--
-- DEPLOY ORDER — this migration is safe to apply BEFORE the code that uses it.
-- The column is additive: nullable, no default, no backfill, no constraint on
-- existing rows, and no change to any existing function. Code already running
-- in production never selects it and never calls the new function, so the
-- deployed build stays valid at every point during the rollout. The reverse
-- order is safe too: the engine's high-water read fails open (a missing column
-- errors, is logged, and the pass completes exactly as it does today).

alter table public.email_connections
  add column if not exists webhook_history_high_water text;

comment on column public.email_connections.webhook_history_high_water is
  'Highest Gmail historyId ever advertised by a provider push notification for this connection. Monotone, advisory, and never a resume point: the sync engine only compares its own completed pass against it to decide whether the mailbox still owes a bounded drain. Null until the first push lands.';

-- Monotone max over two Gmail historyIds.
--
-- Both sides are uint64 decimal digit strings, which outgrow bigint's signed
-- range and float's exact-integer range, so the comparison goes through numeric
-- behind a strict validity guard. Anything that is not a plain bounded run of
-- digits — a structured continuation cursor, a signed or fractional value, an
-- absurdly long string — is silently ignored rather than raising: this call
-- sits on the webhook's 200-to-Pub/Sub path, where an exception would turn a
-- malformed notification into a redelivery storm. Ignoring is safe because the
-- mark is advisory; the worst case is that the drain is not requested and the
-- mailbox behaves exactly as it did before this migration.
create or replace function public.record_email_webhook_high_water(
  p_connection_id uuid,
  p_history_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_history_id text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_connection_id is null then
    raise exception 'email connection identity is required'
      using errcode = '22023';
  end if;

  v_history_id := pg_catalog.btrim(coalesce(p_history_id, ''));

  -- Unparseable input is a no-op, not a failure. 32 digits is ~12 orders of
  -- magnitude beyond any real uint64 historyId and keeps the cast bounded.
  if v_history_id !~ '^[0-9]{1,32}$' then
    return;
  end if;

  update public.email_connections as connection
     set webhook_history_high_water = v_history_id
   where connection.id = p_connection_id
     and (
       connection.webhook_history_high_water is null
       or connection.webhook_history_high_water !~ '^[0-9]{1,32}$'
       or connection.webhook_history_high_water::numeric
            < v_history_id::numeric
     );
end
$function$;

revoke all on function public.record_email_webhook_high_water(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_email_webhook_high_water(uuid, text)
  to service_role;

notify pgrst, 'reload schema';

commit;
