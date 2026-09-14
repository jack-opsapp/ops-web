\set ON_ERROR_STOP on
set request.jwt.claim.role='service_role';
-- Runs against both original V14 and new V23 synthetic grants after the same
-- complete real approval lifecycle. Every temporary denial is rolled back.
begin;
do $$ declare q jsonb; before_count bigint; before_business jsonb; p jsonb; begin
  select count(*) into before_count from private.agent_customer_updates;
  select to_jsonb(o) into before_business from public.opportunities o where id='30000000-0000-4000-8000-000000000001';
  q:=runtime.request(jsonb_build_object('title',before_business->>'title'),'successor-no-change');
  perform runtime.rejects(format('select runtime.prepare(%L::jsonb)',q),'AGENT_CUSTOMER_UPDATE_NO_CHANGE','unchanged request retains no-change refusal');
  update private.agent_customer_update_policy set effect_revision='sha256:'||repeat('0',64);
  q:=runtime.request('{"title":"Stale policy cannot prepare"}','successor-stale-policy');
  perform runtime.rejects(format('select runtime.prepare(%L::jsonb)',q),'AGENT_CUSTOMER_UPDATE_POLICY_CHANGED','stale business effect policy remains denied');
  perform runtime.assert((select count(*)=before_count from private.agent_customer_updates),'no-change and stale policy create no preview');
  perform runtime.assert((select to_jsonb(o)=before_business from public.opportunities o where id='30000000-0000-4000-8000-000000000001'),'no-change and stale policy leave business record untouched');
end$$;
rollback;

begin;
do $$ declare q jsonb; begin
  q:=runtime.request('{"title":"Revoked cannot prepare"}','successor-revoked');
  update private.mcp_oauth_grants set revoked_at=clock_timestamp();
  perform runtime.rejects(format('select runtime.prepare(%L::jsonb)',q),'AGENT_CUSTOMER_UPDATE_GRANT_STALE_OR_DENIED','wrapper refuses revoked grant');
end$$;
rollback;
begin;
do $$ declare q jsonb; begin
  q:=runtime.request('{"title":"Disabled cannot prepare"}','successor-disabled');
  update private.mcp_oauth_clients set disabled_at=clock_timestamp();
  perform runtime.rejects(format('select runtime.prepare(%L::jsonb)',q),'AGENT_CUSTOMER_UPDATE_GRANT_STALE_OR_DENIED','wrapper refuses disabled client');
end$$;
rollback;

-- Exact exposure must also be retained through queued approval reauthorization.
begin;
do $$ declare p jsonb; forged private.agent_customer_updates%rowtype; begin
  p:=runtime.prepare(runtime.request('{"title":"Queued authority fixture"}','successor-queued'));
  select * into strict forged from private.agent_customer_updates where id=(p->>'change_set_id')::uuid;
  forged.oauth_client_id:='90000000-0000-4000-8000-000000000001';
  perform runtime.rejects(format('select private.agent_customer_update_reauthorize(%L::private.agent_customer_updates)',forged),'AUTHORITY_REVISION_INVALID','queued client substitution cannot select an exposure');
end$$;
rollback;

select runtime.assert(not has_function_privilege('anon','public.prepare_agent_customer_update_for_grant_as_system(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text,jsonb,timestamptz)','execute') and not has_function_privilege('authenticated','public.prepare_agent_customer_update_for_grant_as_system(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text,jsonb,timestamptz)','execute') and has_function_privilege('service_role','public.prepare_agent_customer_update_for_grant_as_system(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text,jsonb,timestamptz)','execute'),'new grant-derived wrapper is service-only');

begin;
do $$declare g private.mcp_oauth_grants%rowtype; r record; begin
 select * into strict g from private.mcp_oauth_grants;
 select * into strict r from public.consume_agent_customer_update_prepare_rate_limit_as_system('successor-rate',g.id,g.user_id,g.company_id,'prepare_customer_update','mcp-customer-update-prepare:2026-09-04.v1',1,'legacy');
 perform runtime.assert(r.allowed and r.remaining_units=5,'actual customer-update limiter accepts exact versioned grant');
 perform runtime.rejects(format('select * from public.consume_agent_customer_update_prepare_rate_limit_as_system(%L,%L,%L,%L,%L,%L,1,%L)','wrong-rate',g.id,g.user_id,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','prepare_customer_update','mcp-customer-update-prepare:2026-09-04.v1','legacy'),'RATE_LIMIT_BINDING_INVALID','limiter rejects wrong grant company');
 perform runtime.rejects(format('select * from public.consume_agent_customer_update_prepare_rate_limit_as_system(%L,%L,%L,%L,%L,%L,1,%L)','wrong-policy',g.id,g.user_id,g.company_id,'prepare_customer_update','wrong-policy','legacy'),'RATE_LIMIT_REQUEST_INVALID','limiter rejects substituted policy pin');
 update private.mcp_oauth_grants set revoked_at=clock_timestamp();
 perform runtime.rejects(format('select * from public.consume_agent_customer_update_prepare_rate_limit_as_system(%L,%L,%L,%L,%L,%L,1,%L)','revoked-rate',g.id,g.user_id,g.company_id,'prepare_customer_update','mcp-customer-update-prepare:2026-09-04.v1','legacy'),'RATE_LIMIT_BINDING_INVALID','limiter rejects revoked grant');
end$$;
rollback;
