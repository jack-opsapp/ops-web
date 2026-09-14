-- Current template edits leave existing visit snapshots byte-identical.
do $$ declare ctx jsonb:=pg_temp.workflow_context();tid text;template jsonb;before_answers jsonb;p jsonb;r jsonb;begin
 tid:=(select value#>>'{proposal,template_id}' from workflow_fixture_state where name='template');
 template:=public.read_site_visit_workflow_as_system('edit-template-read',ctx,jsonb_build_object('operation','get_template','template_id',tid))->'template';
 select jsonb_agg(to_jsonb(a) order by a.id) into before_answers from public.site_visit_checklist_answers a;
 p:=public.prepare_site_visit_workflow_as_system('edit-template-prepare',ctx,jsonb_build_object('operation','edit_template','template_id',tid,'expected_revision',template->'revision','idempotency_key','edit-template-001',
 'definition',jsonb_build_object('name','Updated deck checklist','slug','updated-deck-checklist','is_default',true,'fields',jsonb_build_array(jsonb_build_object('id','power','label','Power supply confirmed','kind','checkbox','required',true,'sortOrder',1,'helpText','Check at the panel.'),jsonb_build_object('id','hidden-field','label','Office note','kind','short_text','required',true,'sortOrder',2,'isVisible',false)))));
 r:=pg_temp.confirm_site_visit(p,'edit-template-commit');
 if before_answers is distinct from (select jsonb_agg(to_jsonb(a) order by a.id) from public.site_visit_checklist_answers a) then raise exception 'template edit rewrote captured answers';end if;
 if not exists(select 1 from public.site_visit_types where id=tid and slug='updated-deck-checklist') then raise exception 'template edit missing';end if;
 raise notice 'PASS: exact template edit/default changes preserve all historical answer snapshots';
end $$;
do $$ declare ctx jsonb:=pg_temp.workflow_context();t public.site_visit_types%rowtype;values jsonb;rows jsonb:='[]';i int;first_page jsonb;second_page jsonb;request jsonb;id uuid;begin
 select * into t from public.site_visit_types where deleted_at is null limit 1;
 for i in 1..26 loop
  id:=gen_random_uuid();values:=private.agent_site_visit_workflow_values('template',to_jsonb(t))||jsonb_build_object('id',id,'slug','page-fixture-'||i,'name','Page fixture '||i,'is_default',false);
  rows:=rows||jsonb_build_array(jsonb_build_object('id',id,'base_revision',0,'values',values));
 end loop;
 perform private.apply_site_visit_rows((ctx->>'actor')::uuid,ctx->>'company','template',rows);
 first_page:=public.read_site_visit_workflow_as_system('page-one',ctx,'{"operation":"list_templates","limit":25}');
 if jsonb_array_length(first_page->'items')<>25 or first_page->>'has_more'<>'true' or first_page->>'next_after_id' is null then raise exception 'page limit truncated silently';end if;
 request:=jsonb_build_object('operation','list_templates','limit',25,'after_id',first_page->>'next_after_id','expected_source_revision',first_page->'source_revision');
 second_page:=public.read_site_visit_workflow_as_system('page-two',ctx,request);
 if jsonb_array_length(second_page->'items')<>2 or second_page->>'has_more'<>'false' or second_page->>'next_after_id' is not null
  or exists(select 1 from jsonb_array_elements(first_page->'items')a join jsonb_array_elements(second_page->'items')b on a->>'id'=b->>'id') then raise exception 'page overlap or omissions';end if;
 update public.companies c set name=c.name where c.id=(ctx->>'company')::uuid;
 begin perform public.read_site_visit_workflow_as_system('page-stale',ctx,request);raise exception 'stale cursor accepted';exception when others then if sqlerrm<>'SITE_VISIT_READ_STALE' then raise;end if;end;
 raise notice 'PASS: bounded template discovery returns stable nonoverlapping pages and rejects a changed source revision';
end $$;
