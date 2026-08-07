-- Email provider mutation reconciliation — candidate listing
--
-- `email_provider_mutation_attempts` grants service_role nothing: the ledger is
-- reachable only through SECURITY DEFINER RPCs, by design. The reconciliation
-- resolver shipped with a direct PostgREST select against it, so every
-- production cycle failed with `permission denied for table
-- email_provider_mutation_attempts` before it scanned a single row — visible as
-- a standing `reconciliation.failed: 1` on the email-sync cron.
--
-- Reads of the ledger need their own definer entry point, exactly like every
-- write already has.

begin;

create or replace function public.list_email_provider_mutation_reconciliation_candidates(
  p_connection_id uuid,
  p_operation_kind text default 'draft_create',
  p_since timestamptz default null,
  p_limit integer default 25
)
returns setof public.email_provider_mutation_attempts
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 200);
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_connection_id is null
     or p_operation_kind not in ('draft_create', 'webhook_setup', 'webhook_renewal') then
    raise exception 'invalid_email_provider_mutation_candidate_query'
      using errcode = '22023';
  end if;

  return query
  select attempt.*
  from public.email_provider_mutation_attempts attempt
  where attempt.connection_id_snapshot = p_connection_id
    and attempt.operation_kind = p_operation_kind
    and attempt.status = 'reconciliation_required'
    and (
      p_since is null
      or coalesce(attempt.reconciliation_required_at, attempt.updated_at) >= p_since
    )
  -- Oldest first: the longest-jammed operation is the one blocking the most.
  order by coalesce(attempt.reconciliation_required_at, attempt.updated_at) asc
  limit v_limit;
end;
$function$;

revoke all on function public.list_email_provider_mutation_reconciliation_candidates(
  uuid, text, timestamptz, integer
) from public, anon, authenticated, service_role;
grant execute on function public.list_email_provider_mutation_reconciliation_candidates(
  uuid, text, timestamptz, integer
) to service_role;

commit;
