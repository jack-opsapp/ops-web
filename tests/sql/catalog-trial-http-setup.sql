\set ON_ERROR_STOP on
set request.jwt.claim.role='service_role';
create table catalog_test.http_delay(enabled boolean not null);
insert into catalog_test.http_delay values(true);
create function catalog_test.http_identity() returns void language plpgsql security definer as $$begin perform set_config('request.jwt.claim.role','service_role',true);end $$;
create function catalog_test.delay_category() returns trigger language plpgsql security definer as $$begin if new.name='PostgREST catalog trial' and exists(select 1 from catalog_test.http_delay where enabled) then perform pg_sleep(4);end if;return new;end $$;
create trigger catalog_trial_http_timeout before insert on public.catalog_categories for each row execute function catalog_test.delay_category();
update private.agent_catalog_effect_policy set effect_sha256=private.agent_catalog_effect_revision() where revision='2026-09-08.v1';
update catalog_test.state set value=to_jsonb(catalog_test.register_client('Synthetic HTTP catalog trial')) where key='client';
select public.provision_catalog_oauth_trial_as_system(catalog_test.client(),'10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',clock_timestamp()+interval '1 hour',private.agent_catalog_effect_revision());
insert into private.mcp_oauth_grants(user_id,company_id,client_id,scopes,revision,accepted_labels,consent_catalog_revision,exposure_revision)
values('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',catalog_test.client(),private.agent_catalog_trial_scopes(),repeat('f',32),private.agent_catalog_labels(private.agent_catalog_trial_scopes(),'2026-09-08.mcp-consent-catalog.v14'),'2026-09-08.mcp-consent-catalog.v14','2026-09-08.mcp-exposure.v19');
grant usage on schema public, catalog_test to service_role;
grant execute on function catalog_test.http_identity() to service_role;
notify pgrst,'reload schema';
