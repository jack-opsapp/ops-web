begin;

-- ============================================================================
-- QuickBooks queue recovery — keep stale/retry duplicate checks connection-safe
--
-- The active pending unique index is already scoped by connection_id, but the
-- stale-claim recovery and retry duplicate checks still searched for "newer
-- pending" rows without connection_id. With sandbox and production QBO
-- connections in one OPS company, one connection could cancel/recover the other
-- connection's queue row for the same entity/idempotency key.
--
-- Patch the existing function definitions in place and sentinel-check the live
-- bodies. This is intentionally narrow: no table shape, trigger, or worker
-- behavior changes beyond the duplicate-row lookup predicate.
-- ============================================================================

do $$
declare
  v_claim text;
  v_retry text;
begin
  select pg_get_functiondef('public.claim_accounting_sync_queue(text, integer, text, integer)'::regprocedure)
  into v_claim;

  if v_claim is null then
    raise exception 'qbo_queue_retry_connection_scope_sentinel: claim function missing';
  end if;

  if position('pending.connection_id = v_stale.connection_id' in v_claim) = 0 then
    v_claim := replace(
      v_claim,
      'and pending.provider = v_stale.provider
      and pending.entity_type = v_stale.entity_type',
      'and pending.provider = v_stale.provider
      and pending.connection_id = v_stale.connection_id
      and pending.entity_type = v_stale.entity_type'
    );

    if position('pending.connection_id = v_stale.connection_id' in v_claim) = 0 then
      raise exception 'qbo_queue_retry_connection_scope_sentinel: claim function patch failed';
    end if;

    execute v_claim;
  end if;

  select pg_get_functiondef('public.retry_accounting_sync_queue(uuid, text, text, timestamptz)'::regprocedure)
  into v_retry;

  if v_retry is null then
    raise exception 'qbo_queue_retry_connection_scope_sentinel: retry function missing';
  end if;

  if position('connection_id = v_row.connection_id' in v_retry) = 0 then
    v_retry := replace(
      v_retry,
      'and provider = v_row.provider
    and entity_type = v_row.entity_type',
      'and provider = v_row.provider
    and connection_id = v_row.connection_id
    and entity_type = v_row.entity_type'
    );

    if position('connection_id = v_row.connection_id' in v_retry) = 0 then
      raise exception 'qbo_queue_retry_connection_scope_sentinel: retry function patch failed';
    end if;

    execute v_retry;
  end if;
end $$;

grant execute on function public.claim_accounting_sync_queue(text, integer, text, integer) to service_role;
grant execute on function public.retry_accounting_sync_queue(uuid, text, text, timestamptz) to service_role;

do $$
declare
  v_claim text;
  v_retry text;
begin
  select pg_get_functiondef('public.claim_accounting_sync_queue(text, integer, text, integer)'::regprocedure)
  into v_claim;
  select pg_get_functiondef('public.retry_accounting_sync_queue(uuid, text, text, timestamptz)'::regprocedure)
  into v_retry;

  if position('pending.connection_id = v_stale.connection_id' in coalesce(v_claim, '')) = 0 then
    raise exception 'qbo_queue_retry_connection_scope_sentinel: stale duplicate lookup is not connection-scoped';
  end if;

  if position('connection_id = v_row.connection_id' in coalesce(v_retry, '')) = 0 then
    raise exception 'qbo_queue_retry_connection_scope_sentinel: retry duplicate lookup is not connection-scoped';
  end if;
end $$;

commit;
