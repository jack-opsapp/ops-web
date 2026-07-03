-- W3 security posture sweep (GATED batch) — add caller guards to two SECURITY
-- DEFINER functions that accept a company id but perform no caller check, so a raw
-- anon-key caller (or a bridged user from another tenant) could read/mutate another
-- company's data by passing that company's id.
--
-- Both are additive CREATE OR REPLACE with UNCHANGED signatures, so shipped iOS/web
-- builds keep calling them exactly as before; only the internal authorization
-- changes. Legitimate callers always pass their own company id (proven by the W3
-- request.jwt.claims sentinel across Canpro + Maverick identities), so behaviour is
-- unchanged for them.
--
--   * get_inbox_density_per_client(p_company_id) — returned per-client email thread
--     counts for ANY company_id (cross-company inbox-activity metadata). Only caller
--     is the client component galaxy-thread-density-halos.tsx, which passes the
--     user's own company. Guard: silently return no rows unless the caller's
--     resolved company matches p_company_id (keeps the visualization resilient).
--   * remove_seated_employee(p_company_id, p_user_id) — removed a user from ANY
--     company's seat list with no auth (seat-griefing / lockout vector). No ops-web
--     caller (iOS team-management flow only). Guard: end-user (bridge) callers must
--     be an admin of the target company; service_role (trusted server) skips the
--     check.
--
-- NOTE: apply after a quick confirmation of the iOS team-management "remove seat"
-- flow — it is the one caller path that cannot be grepped from this repo.

begin;

set local search_path = public, private, pg_temp;

-- get_inbox_density_per_client: caller-scope guard as an added WHERE predicate.
-- Silent-empty on mismatch (no exception) so the client visualization degrades
-- gracefully rather than erroring.
create or replace function public.get_inbox_density_per_client(p_company_id uuid)
  returns table(client_id uuid, thread_count integer, last_message_at timestamp with time zone)
  language sql
  stable
  security definer
  set search_path to 'public'
as $function$
  select
    et.client_id,
    count(*)::int as thread_count,
    max(et.last_message_at) as last_message_at
  from public.email_threads et
  where et.company_id = p_company_id
    and private.get_user_company_id() is not distinct from p_company_id  -- W3 caller-scope guard (private.get_user_company_id() returns uuid)
    and et.client_id is not null
    and et.archived_at is null
  group by et.client_id;
$function$;

-- remove_seated_employee: end-user callers must be an admin of the target company.
create or replace function public.remove_seated_employee(p_company_id text, p_user_id text)
  returns void
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
begin
  -- W3 caller guard. service_role (trusted server) bypasses; every other caller
  -- (anon bridge) must be an admin of the company whose seat is being removed.
  if coalesce(auth.jwt() ->> 'role', '') is distinct from 'service_role' then
    if private.get_user_company_id()::text is distinct from p_company_id  -- p_company_id is text; cast the uuid result
       or not private.current_user_is_admin() then
      raise exception 'remove_seated_employee: not authorized for company %', p_company_id
        using errcode = '42501';
    end if;
  end if;

  update companies
     set seated_employee_ids = array_remove(seated_employee_ids, p_user_id),
         updated_at = now()
   where id = p_company_id::uuid;
end;
$function$;

-- Sentinel: both function bodies must now contain their caller guard.
do $do$
declare
  v_density text;
  v_seat text;
begin
  select p.prosrc into v_density
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_inbox_density_per_client';
  if v_density is null or position('get_user_company_id()' in v_density) = 0 then
    raise exception 'sec_w3_harden_sentinel: get_inbox_density_per_client missing caller-scope guard';
  end if;

  select p.prosrc into v_seat
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'remove_seated_employee';
  if v_seat is null or position('current_user_is_admin()' in v_seat) = 0 then
    raise exception 'sec_w3_harden_sentinel: remove_seated_employee missing admin guard';
  end if;
end
$do$;

commit;
