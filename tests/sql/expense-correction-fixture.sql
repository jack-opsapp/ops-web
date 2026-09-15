\set ON_ERROR_STOP on
-- Synthetic additions to the captured expense decision baseline. No customer data.
create schema extensions;
create extension pgcrypto with schema extensions;
alter table public.companies add column timezone text default 'UTC';
alter table public.companies add column currency_code text default 'CAD';
alter table public.expense_categories add column name text;
alter table public.expense_categories add column is_active boolean default true;
grant usage on schema public,private,auth to authenticated;
grant execute on function auth.jwt() to authenticated;
-- Table grants reproduce an authenticated direct-table caller; authoritative
-- tenant and content checks are still in the captured/P5/new trigger functions.
grant select,insert,update,delete on public.expenses,public.expense_project_allocations to authenticated;
grant select on public.expense_batches,public.notifications to authenticated;
CREATE OR REPLACE FUNCTION private.current_user_has_permission(p_permission text, p_min_scope text DEFAULT 'own'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_scope text;
BEGIN
  IF private.current_user_is_admin() THEN
    RETURN true;
  END IF;
  v_scope := private.current_user_scope_for(p_permission);
  IF v_scope IS NULL THEN
    RETURN false;
  END IF;
  IF v_scope = 'all' THEN RETURN true; END IF;
  IF v_scope = 'assigned' THEN
    RETURN p_min_scope IN ('assigned','own');
  END IF;
  IF v_scope = 'own' THEN
    RETURN p_min_scope = 'own';
  END IF;
  RETURN false;
END;
$function$
;
