-- Keep the public Data API entry point invoker-safe so the exposed RPC cannot
-- itself bypass RLS. The existing authorization-complete implementation moves
-- behind the non-exposed private schema and retains its pinned search path.

alter function public.complete_site_visit_guarded(uuid, jsonb)
  set schema private;

revoke all on function private.complete_site_visit_guarded(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function private.complete_site_visit_guarded(uuid, jsonb)
  to anon, authenticated;

create function public.complete_site_visit_guarded(
  p_site_visit_id uuid,
  p_completion jsonb default '{}'::jsonb
) returns jsonb
language sql
security invoker
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select private.complete_site_visit_guarded(p_site_visit_id, p_completion);
$function$;

revoke all on function public.complete_site_visit_guarded(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_site_visit_guarded(uuid, jsonb)
  to anon, authenticated;

comment on function private.complete_site_visit_guarded(uuid, jsonb) is
  'Privileged implementation for authorized, atomic site-visit completion. Not exposed through the Data API.';
comment on function public.complete_site_visit_guarded(uuid, jsonb) is
  'Invoker-safe Data API wrapper for authorized, atomic site-visit completion.';
