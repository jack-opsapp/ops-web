-- Forward repair of 20260830113400 (bug 8db73af6): the list function's name was
-- 67 characters; Postgres silently truncated the object to 63
-- (…_renormalization_as_sys), so PostgREST callers using the full name got
-- "function not found in the schema cache". Rename to a 51-character name.
-- ALTER … RENAME preserves ownership, security definer, and grants.

alter function public.list_agent_provider_delivery_sources_for_renormalization_as_sys(
  integer, timestamp with time zone, uuid
) rename to list_delivery_sources_for_renormalization_as_system;
