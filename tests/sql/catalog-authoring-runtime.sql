\set ON_ERROR_STOP on
create schema catalog_test;
create function catalog_test.assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL %',label;end if;raise notice 'PASS %',label;end $$;
create function catalog_test.rejects(statement text,expected text,label text) returns void language plpgsql as $$declare caught boolean:=false;begin begin execute statement;exception when others then if sqlerrm not like '%'||expected||'%' then raise exception 'FAIL % unexpected %',label,sqlerrm;end if;caught:=true;end;perform catalog_test.assert(caught,label);end $$;
set request.jwt.claim.role='service_role';
insert into private.agent_read_domains(domain) values('catalog'),('purchasing'),('tasks');
insert into public.companies(id,name,public_handle,currency_code) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Catalog fixture','catalog-fixture','CAD'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Other catalog','other-catalog','USD');
insert into public.users(id,company_id,first_name,last_name,is_company_admin) values('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Catalog','Operator',true),('10000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Second','Operator',true);
create function catalog_test.context() returns jsonb language sql as $$select jsonb_build_object('actor','10000000-0000-4000-8000-000000000001','company','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','channel','internal','manifest','2026-09-08.capability-manifest.v24','permission_keys',keys,'permission_revision',a.permission_snapshot_revision,'grant',null,'client',null,'grant_revision',null,'scopes',null) from (select array['agent.review','catalog.import','catalog.manage','catalog.products.manage','catalog.products.view','catalog.stock.adjust','catalog.view','finances.view']::text[] keys) p cross join lateral private.resolve_agent_actor_authority('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',keys) a $$;
create function catalog_test.row(key text,entity text,vals jsonb) returns jsonb language sql as $$select jsonb_build_object('row_key',key,'source_row',key,'entity',entity,'existing_id',null,'expected_sha256',null,'values',vals)$$;
create function catalog_test.request(key text) returns jsonb language sql as $$select jsonb_build_object('operation','catalog','currency','CAD','source',jsonb_build_object('key','fixture-source','name','Supplier sheet','kind','file','sha256','sha256:'||repeat('a',64)),'rows',jsonb_build_array(
 catalog_test.row('each','unit','{"name":"Each","abbreviation":"ea","dimension":"count"}'),
 catalog_test.row('materials','category','{"name":"Materials"}'),
 catalog_test.row('boards','family','{"name":"Boards","unit":"row:each","category":"row:materials","price":"10.00"}'),
 catalog_test.row('installation','product','{"name":"Installation","kind":"service","price":"12.50","unit":"hour","pricing_unit":"hour","taxable":true}'),
 catalog_test.row('black','variant','{"family":"row:boards","unit":"row:each","sku":"BOARD-BLACK","price":"10.00","choices":[{"option":"Colour","value":"Black"}]}'),
 catalog_test.row('white','variant','{"family":"row:boards","unit":"row:each","sku":"BOARD-WHITE","price":"10.00","choices":[{"option":"Colour","value":"White"}]}'),
 catalog_test.row('recipe','recipe','{"product":"row:installation","variant":"row:black","quantity":"2","unit":"row:each"}')
 ),'skipped_rows','[]'::jsonb,'idempotency_key',key) $$;
create function catalog_test.prepare(req jsonb) returns jsonb language sql as $$select public.prepare_catalog_changes_as_system(catalog_test.context(),req,'catalog-test')$$;
create function catalog_test.commit(p jsonb,key text default 'catalog-commit-001') returns jsonb language sql as $$select public.commit_catalog_changes_as_actor('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',(p->>'action_id')::uuid,(p->>'change_set_id')::uuid,p->>'preview_sha256',key)$$;
select catalog_test.rejects($s$select catalog_test.prepare(catalog_test.request('catalog-basic-001'))$s$,'ACTIVATION_REQUIRED','migration is dormant without exact effect activation');
insert into private.agent_catalog_effect_policy values('2026-09-08.v1',private.agent_catalog_effect_revision());
do $$declare p jsonb;r jsonb;req jsonb;begin
 req:=catalog_test.request('catalog-basic-001');p:=catalog_test.prepare(req);
 perform catalog_test.assert(p->>'status'='approval_required','multi-item catalog compiles into exact approval');
 perform catalog_test.assert((select count(*)=0 from public.products) and (select count(*)=0 from public.catalog_variants),'prepare changes no business records');
 perform catalog_test.assert(catalog_test.prepare(req)->>'replayed'='true','identical preparation replay');
 r:=catalog_test.commit(p);
 perform catalog_test.assert(r->>'ok'='true','exact approval saves full graph');
 perform catalog_test.assert((select count(*)=2 and sum(quantity)=0 from public.catalog_variants),'new variants have zero physical stock');
 perform catalog_test.assert((select count(*)=1 from public.product_materials),'fixed recipe persisted');
 perform catalog_test.assert((select default_price=12.50 and base_price=12.50 from public.products),'canonical price mirror preserved');
 perform catalog_test.assert((select count(*)=0 from public.inventory_deductions),'catalog import creates no inventory movements');
 perform catalog_test.assert((select count(*)=1 from public.catalog_options),'variants reuse one family axis');
 perform catalog_test.assert(catalog_test.commit(p)=r||'{"replayed":true}'::jsonb,'identical commit returns same immutable receipt');
 perform catalog_test.assert(catalog_test.prepare(req)->>'status'='committed','lost prepare response recovers committed identity');
 perform catalog_test.assert(catalog_test.prepare(catalog_test.request('catalog-other-001'))->>'status'='needs_input','new retry key cannot duplicate existing records');
end $$;
create function catalog_test.one(key text,entity text,vals jsonb,rid uuid default null) returns jsonb language sql as $$select jsonb_set(catalog_test.request(key),'{rows}',jsonb_build_array(catalog_test.row(key,entity,vals)||jsonb_build_object('existing_id',rid,'expected_sha256',case when rid is null then null else private.agent_catalog_hash(private.agent_catalog_row('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',entity,rid)) end)))$$;
-- Test helpers are outside the sealed runtime namespaces.
do $$declare p jsonb;q jsonb;r jsonb;req jsonb;rid uuid;vid uuid;uid uuid;fid uuid;old jsonb;begin
 select id into rid from public.products where name='Installation';
 select id into vid from public.catalog_variants where sku='BOARD-BLACK';
 select id into uid from public.catalog_units where display='Each';
 select id into fid from public.catalog_items where name='Boards';
 req:=catalog_test.one('catalog-price-001','product','{"price":"15.25"}',rid);
 p:=catalog_test.prepare(req);
 perform catalog_test.assert(p->'proposal'->'rows'->0->'before'->>'price'='12.50','price review contains exact prior price');
 perform catalog_test.assert(not (p->'proposal'->'rows'->0->'before')?'cost','price-only review redacts cost');
 perform catalog_test.rejects(format('select public.commit_catalog_changes_as_actor(%L,%L,%L,%L,%L,%L)','10000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',p->>'action_id',p->>'change_set_id',p->>'preview_sha256','wrong-actor-001'),'NOT_FOUND','different operator cannot approve');
 perform catalog_test.rejects(format('select catalog_test.commit(%L::jsonb)',jsonb_set(p,'{preview_sha256}',to_jsonb('sha256:'||repeat('b',64)))),'IDEMPOTENCY','modified seal cannot approve');
 r:=catalog_test.commit(p);
 perform catalog_test.assert((select unit='hour' and pricing_unit='hour' and default_price=15.25 and base_price=15.25 from public.products where id=rid),'price patch preserves pricing basis and canonical mirror');
 perform catalog_test.rejects(format('select catalog_test.commit(%L::jsonb,%L)',p,'different-commit-001'),'IDEMPOTENCY','changed commit key cannot replay');
 req:=catalog_test.one('catalog-stale-001','product','{"price":"19.00"}',rid);p:=catalog_test.prepare(req);
 update public.products set default_price=16 where id=rid;
 perform catalog_test.rejects(format('select catalog_test.commit(%L::jsonb)',p),'STALE','intervening web or iOS edit invalidates approval');
 perform catalog_test.assert((select default_price=16 from public.products where id=rid),'stale approval preserves newer edit');
 req:=catalog_test.one('catalog-dupsku-001','variant',jsonb_build_object('family',fid,'unit',uid,'sku','OTHER-SKU','choices',jsonb_build_array(jsonb_build_object('option','Colour','value','Black'))));
 perform catalog_test.assert(catalog_test.prepare(req)->>'status'='needs_input','different SKU cannot duplicate current option combination');
 req:=catalog_test.one('catalog-case-001','variant',jsonb_build_object('family',fid,'unit',uid,'sku','BLUE-SKU','choices',jsonb_build_array(jsonb_build_object('option','colour','value','Blue'))));
 perform catalog_test.assert(catalog_test.prepare(req)->>'status'='needs_input','noncanonical existing option label needs resolution before approval');
 req:=catalog_test.one('catalog-name-001','product','{"name":"Installation","sku":"NEW-SKU","price":"20.00","kind":"service","unit":"hour","pricing_unit":"hour","taxable":true}');
 perform catalog_test.assert(catalog_test.prepare(req)->>'status'='needs_input','new SKU does not bypass existing product name');
 req:=catalog_test.one('catalog-pair-001','recipe',jsonb_build_object('product',rid,'variant',(select id from public.catalog_variants where sku='BOARD-WHITE'),'unit',uid,'quantity','2'));
 req:=jsonb_set(req,'{rows}',(req->'rows')||jsonb_build_array(jsonb_set(req->'rows'->0,'{row_key}','"second-recipe"')));
 perform catalog_test.assert(catalog_test.prepare(req)->>'status'='needs_input','duplicate recipe in same batch needs resolution');
 req:=catalog_test.one('catalog-combo-001','variant',jsonb_build_object('family',fid,'unit',uid,'sku','NEW-BLUE-1','choices',jsonb_build_array(jsonb_build_object('option','Colour','value','Blue'))));
 req:=jsonb_set(req,'{rows}',(req->'rows')||jsonb_build_array(jsonb_set(jsonb_set(req->'rows'->0,'{row_key}','"second-blue"'),'{values,sku}','"NEW-BLUE-2"')));
 perform catalog_test.assert(catalog_test.prepare(req)->>'status'='needs_input','duplicate variant combination in same batch needs resolution');
 req:=catalog_test.one('catalog-expire-001','product','{"price":"20.00"}',rid);p:=catalog_test.prepare(req);
 update private.agent_catalog_proposals set created_at=clock_timestamp()-interval '32 minutes',expires_at=clock_timestamp()-interval '2 minutes' where id=(p->>'change_set_id')::uuid;
 perform catalog_test.rejects(format('select catalog_test.commit(%L::jsonb)',p),'STALE','expired approval cannot save');
 req:=catalog_test.one('catalog-reject-001','product','{"price":"20.00"}',rid);p:=catalog_test.prepare(req);
 perform public.reject_catalog_changes_as_actor('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',(p->>'action_id')::uuid);
 perform catalog_test.rejects(format('select catalog_test.commit(%L::jsonb)',p),'STALE','rejected approval cannot save');
 req:=catalog_test.one('catalog-stock-001','stock','{"quantity":"8","reason":"Verified shelf count"}',vid);req:=jsonb_set(req,'{operation}','"inventory"');p:=catalog_test.prepare(req);
 perform catalog_test.assert(p->'proposal'->'effects'->>'stock_adjustments'='1','stock adjustment has a separate explicit effect');
 r:=catalog_test.commit(p);
 perform catalog_test.assert(r->>'effect'='inventory_adjusted' and (select quantity=8 from public.catalog_variants where id=vid),'approved stock count is exact');
 perform catalog_test.assert((select count(*)=1 and min(previous_quantity)=0 and min(new_quantity)=8 and min(quantity_deducted)=-8 from public.inventory_deductions),'stock adjustment creates one auditable movement');
 perform catalog_test.commit(p);
 perform catalog_test.assert((select count(*)=1 from public.inventory_deductions),'stock replay never duplicates a movement');
 perform catalog_test.assert((select default_price=16 from public.products where id=rid),'stock approval changes no catalog price');
 perform catalog_test.rejects(format('select catalog_test.prepare(%L::jsonb)',jsonb_set(jsonb_set(req,'{operation}','"catalog"'),'{idempotency_key}','"stock-hidden-001"')),'ROW_INVALID','catalog request cannot contain stock changes');
 -- Named operator is evaluated again at commit, including role revocation.
 req:=catalog_test.one('catalog-perms-001','product','{"price":"20.00"}',rid);p:=catalog_test.prepare(req);
 update public.users set is_company_admin=false where id='10000000-0000-4000-8000-000000000001';
 perform catalog_test.rejects(format('select catalog_test.commit(%L::jsonb)',p),'AUTHORITY','permission loss after review prevents save');
 update public.users set is_company_admin=true where id='10000000-0000-4000-8000-000000000001';
 -- A foreign-company identifier never becomes a guessed or silently reassigned relationship.
 perform catalog_test.rejects(format('select catalog_test.prepare(%L::jsonb)',catalog_test.one('catalog-foreign-001','family','{"name":"Foreign","unit":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}')),'REFERENCE_NOT_FOUND','unavailable tenant reference denied');
 -- Defaults are part of the runtime effects approved by the operator.
 req:=catalog_test.one('catalog-ddl-001','product','{"price":"20.00"}',rid);p:=catalog_test.prepare(req);
 alter table public.products alter column show_in_storefront set default true;
 perform catalog_test.rejects(format('select catalog_test.commit(%L::jsonb)',p),'EFFECT','default drift invalidates approved effect closure');
 alter table public.products alter column show_in_storefront set default false;
end $$;
-- A late failure must roll back earlier catalog writes, read revisions and receipts together.
create function catalog_test.fail_late() returns trigger language plpgsql as $$begin if current_setting('catalog_test.fail_late',true)='on' then raise exception 'CATALOG_TEST_LATE_FAILURE';end if;return new;end $$;
create trigger catalog_test_late before insert on public.product_materials for each row execute function catalog_test.fail_late();
update private.agent_catalog_effect_policy set effect_sha256=private.agent_catalog_effect_revision();
do $$declare p jsonb;r jsonb;req jsonb;uid uuid;fid uuid;vid uuid;prior_revision jsonb;begin
 select id into uid from public.catalog_units where display='Each';select id into vid from public.catalog_variants where sku='BOARD-BLACK';
 req:=catalog_test.one('catalog-rollback-001','product','{"name":"Rollback service","kind":"service","price":"18.00","unit":"each","pricing_unit":"each","taxable":false}');
 req:=jsonb_set(req,'{rows}',(req->'rows')||jsonb_build_array(catalog_test.row('late-recipe','recipe',jsonb_build_object('product','row:catalog-rollback-001','variant',vid,'unit',uid,'quantity','1'))));
 p:=catalog_test.prepare(req);select jsonb_agg(to_jsonb(x)) into prior_revision from private.agent_read_domain_revisions x;
 perform set_config('catalog_test.fail_late','on',true);
 perform catalog_test.rejects(format('select catalog_test.commit(%L::jsonb)',p),'LATE_FAILURE','late recipe failure rolls back entire save');
 perform catalog_test.assert(not exists(select 1 from public.products where name='Rollback service'),'no early catalog row survives late failure');
 perform catalog_test.assert((select status='pending' and execution_result is null from public.agent_actions where id=(p->>'action_id')::uuid),'failed transaction leaves review pending without receipt');
 perform catalog_test.assert((select jsonb_agg(to_jsonb(x)) from private.agent_read_domain_revisions x)=prior_revision,'read domain revisions roll back with failed catalog graph');
 perform set_config('catalog_test.fail_late','off',true);r:=catalog_test.commit(p);
 perform catalog_test.assert(r->>'ok'='true' and (select count(*)=1 from public.products where name='Rollback service'),'same sealed approval retries once after rollback');
 perform catalog_test.assert((select resolved_at is not null from public.notifications where dedupe_key='catalog:'||(p->>'action_id')),'successful save resolves persistent review notification');
end $$;
-- Synthetic OAuth grants exercise exact candidate labels, scope tiers and revocation.
insert into private.mcp_oauth_clients(client_id,client_name,redirect_uris,token_endpoint_auth_method,grant_types,response_types,scope,registration_source,scope_ceiling,consent_catalog_revision,exposure_revision)
values('40000000-0000-4000-8000-000000000001','Catalog fixture client',array['https://example.test/callback'],'none',array['authorization_code'],array['code'],'ops.catalog.prepare ops.catalog.read ops.catalog_prices.write','dynamic',array['ops.catalog.prepare','ops.catalog.read','ops.catalog_prices.write'],'2026-09-08.mcp-consent-catalog.v14','2026-09-08.mcp-exposure.v19');
insert into private.mcp_oauth_grants(id,user_id,company_id,client_id,scopes,revision,accepted_labels,consent_catalog_revision,exposure_revision)
select '50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',client_id,scope_ceiling,repeat('a',32),private.agent_catalog_labels(scope_ceiling,consent_catalog_revision),consent_catalog_revision,exposure_revision from private.mcp_oauth_clients;
create function catalog_test.mcp_context() returns jsonb language sql as $$select catalog_test.context()||jsonb_build_object('channel','mcp','grant',g.id,'client',g.client_id,'scopes',g.scopes,'grant_revision',g.revision) from private.mcp_oauth_grants g where g.id='50000000-0000-4000-8000-000000000001'$$;
do $$declare req jsonb;p jsonb;rid uuid;ctx jsonb;begin
 select id into rid from public.products where name='Installation';req:=catalog_test.one('catalog-oauth-001','product','{"price":"21.00"}',rid);ctx:=catalog_test.mcp_context();
 p:=public.prepare_catalog_changes_as_system(ctx,req,'catalog-oauth');
 perform catalog_test.assert(p->>'status'='approval_required','exact current MCP grant prepares a proposal');
 update private.mcp_oauth_grants set revoked_at=clock_timestamp() where id='50000000-0000-4000-8000-000000000001';
 perform catalog_test.rejects(format('select catalog_test.commit(%L::jsonb)',p),'GRANT','revoked grant cannot approve already prepared changes');
 update private.mcp_oauth_grants set revoked_at=null where id='50000000-0000-4000-8000-000000000001';
 perform catalog_test.rejects(format('select public.prepare_catalog_changes_as_system(%L::jsonb,%L::jsonb,%L)',ctx,catalog_test.one('catalog-cost-deny-001','product','{"cost":"5.00"}',rid),'cost-denied'),'GRANT','price grant cannot prepare supplier cost changes');
 update private.mcp_oauth_clients set disabled_at=clock_timestamp() where client_id='40000000-0000-4000-8000-000000000001';
 perform catalog_test.rejects(format('select catalog_test.commit(%L::jsonb)',p),'GRANT','disabled host client cannot approve');
 update private.mcp_oauth_clients set disabled_at=null where client_id='40000000-0000-4000-8000-000000000001';
 perform catalog_test.commit(p);
 update private.mcp_oauth_grants set revoked_at=clock_timestamp() where id='50000000-0000-4000-8000-000000000001';
 perform catalog_test.rejects(format('select catalog_test.commit(%L::jsonb)',p),'GRANT','receipt replay still requires a live grant');
end $$;
set request.jwt.claim.role='authenticated';
select catalog_test.rejects($s$select catalog_test.prepare(catalog_test.request('catalog-direct-001'))$s$,'access_denied','direct authenticated database caller cannot invoke system save');
set request.jwt.claim.role='service_role';
select catalog_test.assert(not has_function_privilege('authenticated','public.commit_catalog_changes_as_actor(uuid,uuid,uuid,uuid,text,text)','execute'),'customer database role cannot call approval transaction directly');
select catalog_test.assert(not has_table_privilege('service_role','private.agent_catalog_proposals','select'),'generic service table reads cannot expose sealed private authority');
do $$declare p jsonb;req jsonb;rid uuid;vid uuid;fid uuid;uid uuid;other_unit uuid;ctx jsonb;decision record;begin
 select id into rid from public.products where name='Installation';select id into vid from public.catalog_variants where sku='BOARD-BLACK';select id into fid from public.catalog_items where name='Boards';select id into uid from public.catalog_units where display='Each';
 req:=catalog_test.one('catalog-mixed-name-001','product','{"name":"Mixed SKU name","kind":"service","price":"1.00","unit":"each","pricing_unit":"each","taxable":true}');req:=jsonb_set(req,'{rows}',req->'rows'||jsonb_build_array(jsonb_set(jsonb_set(req->'rows'->0,'{row_key}','"mixed-second"'),'{values,sku}','"MIXED-SKU"')));
 perform catalog_test.assert(catalog_test.prepare(req)->>'status'='needs_input','mixed SKU and no-SKU rows cannot duplicate a product name');
 -- Fill a missing link, preserve notification semantics, then reject clearing its identity.
 insert into public.notifications(user_id,company_id,type,title,body,dedupe_key) values('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','catalog_mapping_needed','Map product','Map product','catalog_mapping_needed:product:'||rid::text||':linked_catalog_item');
 p:=catalog_test.prepare(catalog_test.one('catalog-first-link-001','product',jsonb_build_object('family',fid),rid));perform catalog_test.commit(p);
 perform catalog_test.assert((select resolved_at is not null and resolution_reason='catalog_product_linked' from public.notifications where dedupe_key='catalog_mapping_needed:product:'||rid::text||':linked_catalog_item'),'first product link resolves canonical mapping notification');
 perform catalog_test.assert(catalog_test.prepare(catalog_test.one('catalog-clear-link-001','product','{"family":null}',rid))->>'status'='needs_input','explicit null cannot clear established catalog relationship');
 -- Family-default stock unit is part of the approved physical meaning.
 update public.catalog_variants set unit_id=null where id=vid;
 req:=jsonb_set(catalog_test.one('catalog-inherit-stock-001','stock','{"quantity":"10","reason":"Counted each board"}',vid),'{operation}','"inventory"');p:=catalog_test.prepare(req);
 perform catalog_test.assert(p->'proposal'->'rows'->0->>'display_name' like '%Each','stock review displays inherited counting unit');
 insert into public.catalog_units(company_id,display,abbreviation,dimension) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Carton','ctn','count') returning id into other_unit;
 update public.catalog_items set default_unit_id=other_unit where id=fid;
 perform catalog_test.rejects(format('select catalog_test.commit(%L::jsonb)',p),'STALE','inherited counting-unit drift invalidates stock approval');
 update public.catalog_items set default_unit_id=uid where id=fid;
 -- Runtime quota uses the exact admitted candidate policy, actual digest/prune functions and atomic buckets.
 update private.mcp_oauth_grants set revoked_at=null where id='50000000-0000-4000-8000-000000000001';
 for n in 1..7 loop
 select * into decision from public.consume_catalog_prepare_rate_limit_as_system('catalog-rate-'||n,'50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','prepare_catalog_changes','mcp-catalog-prepare:2026-09-08.v1',1,'legacy');
 perform catalog_test.assert(decision.allowed=(n<=6),'durable catalog quota request '||n);
 end loop;
end $$;
do $$declare req jsonb;p jsonb;vid uuid;uid uuid;fid uuid;begin
 select id into vid from public.catalog_variants where sku='BOARD-BLACK';select id into fid from public.catalog_items where name='Boards';select id into uid from public.catalog_units where display='Each';
 req:=catalog_test.one('catalog-inherit-price-001','variant','{"price":null}',vid);p:=catalog_test.prepare(req);
 perform catalog_test.assert((p->'proposal'->'rows'->0->'after'->>'effective_price')::numeric=10,'clearing price override shows exact inherited unit price');
 perform catalog_test.commit(p);
 req:=catalog_test.one('catalog-observe-001','family','{"name":"Unresolved family","unit":"row:missing"}');
 perform catalog_test.assert(catalog_test.prepare(req)->>'status'='needs_input','unresolved rows return actionable review state');
 req:=catalog_test.request('catalog-case-batch-001');req:=jsonb_set(req,'{rows}',jsonb_build_array(catalog_test.row('newfamily','family',jsonb_build_object('name','Batch case family','unit',uid)),catalog_test.row('vone','variant',jsonb_build_object('family','row:newfamily','unit',uid,'sku','CASE-V1','choices',jsonb_build_array(jsonb_build_object('option','Colour','value','Blue')))),catalog_test.row('vtwo','variant',jsonb_build_object('family','row:newfamily','unit',uid,'sku','CASE-V2','choices',jsonb_build_array(jsonb_build_object('option','colour','value','Red'))))));
 perform catalog_test.assert(catalog_test.prepare(req)->>'status'='needs_input','new family option casing is reconciled before approval');
end $$;

-- Final review: named relationship removals and prospective category cycles.
do $$declare req jsonb;p jsonb;rid uuid;root uuid;child uuid;begin
 select id into rid from public.products where name='Installation';select id into root from public.catalog_categories where name='Materials';
 update public.products set category_id=root where id=rid;
 p:=catalog_test.prepare(catalog_test.one('catalog-clearcategory-001','product','{"category":null}',rid));
 perform catalog_test.assert(p->'proposal'->'rows'->0->'before_reference_labels'->>'category'='Materials','category removal retains exact prior category name');
 perform catalog_test.commit(p);
 perform catalog_test.assert((select category_id is null from public.products where id=rid),'approved category removal persists');
 p:=catalog_test.prepare(catalog_test.one('catalog-selfparent-001','category',jsonb_build_object('parent',root),root));
 perform catalog_test.assert(p->>'status'='needs_input','category self-cycle never reaches approval');
 insert into public.catalog_categories(company_id,name,parent_id) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Child category',root) returning id into child;
 p:=catalog_test.prepare(catalog_test.one('catalog-descendant-001','category',jsonb_build_object('parent',child),root));
 perform catalog_test.assert(p->>'status'='needs_input','category descendant-cycle never reaches approval');
end $$;

do $$declare req jsonb;p jsonb;root uuid;vid uuid;mid uuid;begin
 select id into root from public.catalog_categories where name='Materials';
 req:=catalog_test.one('catalog-unresolved-chain-001','category','{"parent":"row:missing"}',root);
 req:=jsonb_set(req,'{rows}',(req->'rows')||jsonb_build_array(catalog_test.row('dependent-category','category',jsonb_build_object('name','Incomplete category chain','parent',root))));
 p:=catalog_test.prepare(req);
 perform catalog_test.assert(p->>'status'='needs_input' and jsonb_array_length(p->'proposal'->'rows')=2,'unresolved staged ancestor remains actionable for dependent category');
 select id into vid from public.catalog_variants where sku='BOARD-WHITE';
 insert into public.catalog_stock_units(company_id,catalog_variant_id) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',vid);
 req:=jsonb_set(catalog_test.one('catalog-physical-001','stock','{"quantity":"9","reason":"Shelf count"}',vid),'{operation}','"inventory"');
 perform catalog_test.assert(catalog_test.prepare(req)->>'status'='needs_input','physical stock units require the existing capture workflow');
 select id into mid from public.product_materials limit 1;
 update public.product_materials set variant_selector='{"size":"selected"}' where id=mid;
 perform catalog_test.assert(catalog_test.prepare(catalog_test.one('catalog-selector-001','recipe','{"quantity":"3"}',mid))->>'status'='needs_input','selected recipe cannot silently become fixed');
end $$;
