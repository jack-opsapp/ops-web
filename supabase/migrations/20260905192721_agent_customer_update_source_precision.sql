-- Preserve the exact record version returned by job identity reads. The shared
-- millisecond formatter and exact customer-update stale checks remain unchanged.
-- Before/after definition hashes include function security and search_path.
do $migration$
declare
  target oid;
  definition text;
  original_owner oid;
  original_acl aclitem[];
begin
  select p.oid, pg_get_functiondef(p.oid), p.proowner, p.proacl
    into strict target, definition, original_owner, original_acl
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname='read_agent_job_summary_as_system_v6_core';
  if md5(definition) = 'e8ddba2e98fb82a468aa2ce1e0a792e1' then
    return;
  end if;
  if md5(definition) <> '128a904a5ddaa81ab387fdddf95210e4' then
    raise exception 'agent_customer_update_source_precision_drift';
  end if;
  definition := replace(definition,
    $old$private.agent_rfc3339_utc(job.updated_at)$old$,
    $new$pg_catalog.to_char(job.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')$new$);
  execute definition;
  if (select md5(pg_get_functiondef(p.oid)) <> 'e8ddba2e98fb82a468aa2ce1e0a792e1'
      or p.proowner <> original_owner or p.proacl is distinct from original_acl
      from pg_proc p where p.oid=target) then
    raise exception 'agent_customer_update_source_precision_readback_failed';
  end if;
end;
$migration$;
