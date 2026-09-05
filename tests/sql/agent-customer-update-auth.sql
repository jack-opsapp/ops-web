-- Exact production current-user mapping with a local JWT-claims adapter.
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
CREATE OR REPLACE FUNCTION private.get_current_user_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT id FROM public.users
  WHERE (auth_id = (auth.jwt() ->> 'sub') OR firebase_uid = (auth.jwt() ->> 'sub'))
    AND deleted_at IS NULL
  LIMIT 1
$function$
;
alter table public.agent_actions enable row level security;
create policy agent_actions_company_scope on public.agent_actions for all to public using(company_id = ((select auth.jwt())->>'company_id')::uuid);
grant usage on schema public,auth to anon,authenticated;
grant select,insert,update,delete on public.agent_actions to anon,authenticated;
