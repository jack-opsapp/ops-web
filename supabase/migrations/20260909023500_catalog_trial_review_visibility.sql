-- Review is a shared human/agent business surface, not automation enrollment.
-- This read-only hint unlocks only the existing approval desk for a currently
-- consented, exact catalog trial subject. Every queue read/save reauthorizes.
begin;
create function public.can_review_catalog_trial_as_actor(p_actor uuid,p_company uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode='42501';
  end if;
  return exists (
    select 1 from private.agent_catalog_trial_bindings b
    join private.mcp_oauth_grants g on g.client_id=b.oauth_client_id
      and g.user_id=b.actor_user_id and g.company_id=b.company_id
    where b.actor_user_id=p_actor and b.company_id=p_company
      and b.disabled_at is null and b.expires_at>statement_timestamp()
      and g.revoked_at is null
      and g.exposure_revision='2026-09-08.mcp-exposure.v19'
      and g.consent_catalog_revision='2026-09-08.mcp-consent-catalog.v14'
      and g.scopes=private.agent_catalog_trial_scopes()
      and g.accepted_labels=private.agent_catalog_labels(g.scopes,g.consent_catalog_revision)
      and private.agent_catalog_trial_current(b.oauth_client_id,p_actor,p_company)
  );
end $$;
revoke all on function public.can_review_catalog_trial_as_actor(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.can_review_catalog_trial_as_actor(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
