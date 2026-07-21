-- Claim an email-connection sync lease inside PostgreSQL.
--
-- PostgREST can mis-plan an UPDATE that combines a nullable timestamp with an
-- OR filter, even while reads and simple updates of the same columns succeed.
-- Keeping the stale-or-empty comparison in one SQL statement preserves the
-- compare-and-set guarantee without relying on that REST filter path.

begin;

create or replace function public.acquire_email_connection_sync_lock_as_system(
  p_connection_id uuid,
  p_lease_seconds integer default 600
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_claimed_at timestamptz := clock_timestamp();
  v_owner_id uuid := gen_random_uuid();
  v_acquired_owner uuid;
begin
  if coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) <> 'service_role' then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  if p_connection_id is null then
    raise exception 'connection id is required'
      using errcode = '22023';
  end if;

  if p_lease_seconds is null
    or p_lease_seconds < 60
    or p_lease_seconds > 3600
  then
    raise exception 'lease seconds must be between 60 and 3600'
      using errcode = '22023';
  end if;

  update public.email_connections
     set sync_in_progress_at = v_claimed_at,
         sync_lock_owner = v_owner_id
   where id = p_connection_id
     and (
       sync_in_progress_at is null
       or sync_in_progress_at < v_claimed_at - make_interval(secs => p_lease_seconds)
     )
  returning sync_lock_owner into v_acquired_owner;

  return v_acquired_owner;
end;
$function$;

revoke all on function public.acquire_email_connection_sync_lock_as_system(
  uuid,
  integer
) from public, anon, authenticated, service_role;

grant execute on function public.acquire_email_connection_sync_lock_as_system(
  uuid,
  integer
) to service_role;

commit;
