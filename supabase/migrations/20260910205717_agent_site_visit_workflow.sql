-- Phase 19: dormant, host-neutral site-visit review transactions.
-- No rollout seal, compatible company, OAuth grant, or public exposure is enabled.
begin;
create function private.agent_site_visit_workflow_hash(value jsonb) returns text
language sql immutable set search_path='' as $$
 select 'sha256:'||encode(extensions.digest(convert_to(value::text,'UTF8'),'sha256'),'hex')
$$;
create function private.agent_site_visit_workflow_text_hash(value text) returns text
language sql immutable set search_path='' as $$
 select 'sha256:'||encode(extensions.digest(convert_to(value,'UTF8'),'sha256'),'hex')
$$;

-- A source returning to its earlier values still invalidates an old review.
create table private.agent_site_visit_workflow_revisions(company_id uuid primary key, revision bigint not null default 0 check(revision>=0));
alter table private.agent_site_visit_workflow_revisions enable row level security;
alter table private.agent_site_visit_workflow_revisions force row level security;
revoke all on private.agent_site_visit_workflow_revisions from public,anon,authenticated,service_role;
create function private.bump_agent_site_visit_workflow_revision() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare prior_company uuid;next_company uuid;
begin
 if tg_op<>'INSERT' then prior_company:=private.try_parse_uuid(to_jsonb(old)->>'company_id');end if;
 if tg_op<>'DELETE' then next_company:=private.try_parse_uuid(to_jsonb(new)->>'company_id');end if;
 if tg_table_schema='public' and tg_table_name='companies' then
  if tg_op<>'INSERT' then prior_company:=old.id;end if;
  if tg_op<>'DELETE' then next_company:=new.id;end if;
 end if;
 insert into private.agent_site_visit_workflow_revisions(company_id,revision)
 select company,1 from (select distinct unnest(array[prior_company,next_company]) company) x where company is not null order by company
 on conflict(company_id) do update set revision=private.agent_site_visit_workflow_revisions.revision+1;
 return coalesce(new,old);
end $$;

create function private.agent_site_visit_workflow_values(entity text,row_value jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(row_value)
 where key=any(case entity when 'template' then array['id','company_id','slug','name','description_text','is_default','is_system_template','sort_order','fields','deleted_at']
 else array['id','company_id','site_visit_id','site_visit_type_id','field_id','label','kind','required','help_text','sort_order','answer_value','answer_state','answer_evidence','deleted_at'] end)
$$;
create function private.agent_site_visit_workflow_missing(answers jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('answer_id',a->'id','field_id',a->'field_id','label',a->'label','kind',a->'kind') order by (a->>'sort_order')::integer,a->>'id'),'[]')
 from jsonb_array_elements(answers) a where a->>'required'='true' and
 (not private.site_visit_value_valid(a->>'kind',a->'answer_value')
  or private.site_visit_normalized_value(a->'answer_value')='{}'
  or (a->'answer_value'?'text' and btrim(a->'answer_value'->>'text')=''))
$$;
create function private.agent_site_visit_workflow_evidence(refs jsonb,sources jsonb,p_kind text) returns jsonb
language plpgsql immutable set search_path='' as $$
declare ref jsonb;source jsonb;result jsonb:='[]';idx integer;
begin
 if jsonb_typeof(refs) is distinct from 'array' or jsonb_array_length(refs)>10 then raise exception 'SITE_VISIT_EVIDENCE_INVALID';end if;
 for ref in select value from jsonb_array_elements(refs) loop
  if jsonb_typeof(ref) is distinct from 'object' or coalesce(ref->>'source_index','')!~'^[0-9]{1,2}$' then raise exception 'SITE_VISIT_EVIDENCE_INVALID';end if;
  idx:=(ref->>'source_index')::integer;source:=sources->idx;
  if idx>19 or source is null then raise exception 'SITE_VISIT_SOURCE_NOT_FOUND';end if;
  if ref?'quote' then
   if ref-array['source_index','quote']<>'{}' or jsonb_typeof(ref->'quote') is distinct from 'string'
    or length(btrim(ref->>'quote')) not between 1 and 8000 or position(ref->>'quote' in source->>'text')=0 then raise exception 'SITE_VISIT_QUOTE_NOT_IN_SOURCE';end if;
  elsif ref-array['source_index','reference_only']<>'{}' or ref->'reference_only' is distinct from 'true'
    or source->>'kind'<>'visit_artifact' or p_kind not in ('photo','photo_markup','deck_design') then
   raise exception 'SITE_VISIT_REFERENCE_EVIDENCE_INVALID';
  end if;
  result:=result||jsonb_build_array(jsonb_build_object('source_index',idx,'quote',ref->'quote','reference_only',coalesce(ref->'reference_only','false'),
    'source_kind',source->'kind','artifact_id',source->'artifact_id','source_sha256',source->'sha256'));
 end loop;
 return result;
end $$;

create function private.agent_site_visit_workflow_compile(p_actor uuid,p_company uuid,req jsonb,seed uuid) returns jsonb
language plpgsql volatile security definer set search_path='' set timezone='UTC' as $$
declare operation text:=req->>'operation';definition jsonb;source jsonb;original jsonb;item jsonb;field jsonb;patch jsonb;values jsonb;
 template public.site_visit_types%rowtype;other public.site_visit_types%rowtype;visit public.site_visits%rowtype;
 artifact public.site_visit_artifacts%rowtype;answer public.site_visit_checklist_answers%rowtype;
 rows jsonb:='[]';answers jsonb:='[]';projected jsonb:='[]';sources jsonb:='[]';evidence jsonb;uncertainty jsonb;result jsonb;
 template_id text;answer_id uuid;field_ids text[]:='{}';source_graph jsonb:='{}';form_hash text;graph_revision bigint;
 before_value jsonb;after_value jsonb;intent text;source_text text;title text;entity text;missing jsonb:='[]';count_before int;preview jsonb;
 visit_context jsonb;visit_zone text;
begin
 if jsonb_typeof(req) is distinct from 'object' or octet_length(req::text)>150000 or
  coalesce(req->>'idempotency_key','')!~'^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$' then raise exception 'SITE_VISIT_INPUT_INVALID' using errcode='22023';end if;
 select coalesce(revision,0) into graph_revision from private.agent_site_visit_workflow_revisions where company_id=p_company;
 graph_revision:=coalesce(graph_revision,0);
 if operation in ('book','reschedule','cancel') then
  return private.agent_site_visit_workflow_booking_preview(p_actor,p_company,req,seed);
 end if;
 if operation in ('create_template','edit_template') then
  if req-array['operation','idempotency_key','supersedes','definition','template_id','expected_revision']<>'{}' then raise exception 'SITE_VISIT_INPUT_INVALID';end if;
  definition:=req->'definition';
  if jsonb_typeof(definition) is distinct from 'object' or definition-array['name','slug','description_text','is_default','sort_order','fields']<>'{}'
   or not private.site_visit_fields_strict(definition->'fields') or jsonb_typeof(definition->'name') is distinct from 'string'
   or length(btrim(definition->>'name')) not between 1 and 120 or jsonb_typeof(definition->'slug') is distinct from 'string'
   or length(btrim(definition->>'slug')) not between 1 and 128 or (definition?'is_default' and jsonb_typeof(definition->'is_default') is distinct from 'boolean')
   or (definition?'description_text' and definition->'description_text'<>'null' and (jsonb_typeof(definition->'description_text')<>'string' or length(definition->>'description_text')>500))
   or (definition?'sort_order' and (coalesce(definition->>'sort_order','')!~'^[0-9]{1,6}$' or (definition->>'sort_order')::integer>100000)) then raise exception 'SITE_VISIT_TEMPLATE_INVALID';end if;
  template_id:=case when operation='create_template' then seed::text else req->>'template_id' end;
  if operation='edit_template' then
   select * into template from public.site_visit_types where id=template_id and company_id=p_company::text and deleted_at is null;
   if not found then raise exception 'SITE_VISIT_TEMPLATE_NOT_FOUND' using errcode='42501';end if;
   if coalesce(template.write_revision,0) is distinct from (req->>'expected_revision')::bigint then raise exception 'SITE_VISIT_TEMPLATE_STALE';end if;
   original:=to_jsonb(template);
  elsif req?'template_id' or req?'expected_revision' then raise exception 'SITE_VISIT_INPUT_INVALID';end if;
  if exists(select 1 from public.site_visit_types where company_id=p_company::text and deleted_at is null and slug=definition->>'slug' and id<>template_id) then raise exception 'SITE_VISIT_TEMPLATE_SLUG_EXISTS';end if;
  values:=jsonb_build_object('id',template_id,'company_id',p_company::text,'name',definition->'name','slug',definition->'slug',
   'description_text',coalesce(definition->'description_text',original->'description_text','null'),
   'is_default',coalesce(definition->'is_default',original->'is_default','false'),'is_system_template',coalesce(original->'is_system_template','false'),
   'sort_order',coalesce(definition->'sort_order',original->'sort_order','0'),'fields',definition->'fields','deleted_at',null);
  if values->>'is_default'='true' then
   for other in select * from public.site_visit_types where company_id=p_company::text and is_default and deleted_at is null and id<>template_id order by id loop
    rows:=rows||jsonb_build_array(jsonb_build_object('id',other.id,'base_revision',coalesce(other.write_revision,0),'before',to_jsonb(other),
      'values',private.agent_site_visit_workflow_values('template',to_jsonb(other))||'{"is_default":false}'));
   end loop;
  end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('id',template_id,'base_revision',coalesce(template.write_revision,0),'before',original,'values',values));
  source_graph:=jsonb_build_object('template',original,'defaults',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'revision',t.write_revision,'slug',t.slug,'default',t.is_default) order by t.id),'[]') from public.site_visit_types t where company_id=p_company::text and deleted_at is null));
  title:=case operation when 'create_template' then 'Create checklist: ' else 'Update checklist: ' end||(definition->>'name');entity:='template';
 elsif operation in ('select_checklist','answer_form') then
  select * into visit from public.site_visits where id=(req->>'site_visit_id')::uuid and company_id=p_company::text and deleted_at is null;
  if not found or not private.actor_can_edit_site_visit(p_actor,p_company::text,visit.opportunity_id,visit.project_id,visit.project_ref) then raise exception 'SITE_VISIT_NOT_FOUND' using errcode='42501';end if;
  if visit.status not in ('scheduled','in_progress') or visit.completed_at is not null then raise exception 'SITE_VISIT_CAPTURE_CLOSED';end if;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.sort_order,a.id),'[]') into answers from public.site_visit_checklist_answers a where a.site_visit_id=visit.id and a.company_id=p_company::text and a.deleted_at is null;
  if jsonb_array_length(answers)>200 or octet_length(answers::text)>220000 then raise exception 'SITE_VISIT_FORM_TOO_LARGE';end if;
  form_hash:=private.agent_site_visit_workflow_hash(jsonb_build_object('visit',to_jsonb(visit),'answers',answers,'revision',graph_revision));
  source_graph:=jsonb_build_object('visit',to_jsonb(visit),'answers',answers);projected:=answers;entity:='answer';
  if operation='select_checklist' then
   if req-array['operation','idempotency_key','supersedes','site_visit_id','template_id','expected_template_revision','expected_form_sha256']<>'{}' then raise exception 'SITE_VISIT_INPUT_INVALID';end if;
   if form_hash is distinct from req->>'expected_form_sha256' then raise exception 'SITE_VISIT_FORM_STALE';end if;
   select * into template from public.site_visit_types where id=req->>'template_id' and company_id=p_company::text and deleted_at is null;
   if not found then raise exception 'SITE_VISIT_TEMPLATE_NOT_FOUND' using errcode='42501';end if;
   if coalesce(template.write_revision,0) is distinct from (req->>'expected_template_revision')::bigint then raise exception 'SITE_VISIT_TEMPLATE_STALE';end if;
   if not private.site_visit_fields_strict(template.fields) then raise exception 'SITE_VISIT_TEMPLATE_UNSUPPORTED';end if;
   source_graph:=source_graph||jsonb_build_object('template',to_jsonb(template));template_id:=template.id;
   for field in select value from jsonb_array_elements(template.fields) where coalesce(value->'isVisible','true')='true' loop
    if exists(select 1 from jsonb_array_elements(answers)a where a->>'field_id'=field->>'id') then continue;end if;
    answer_id:=overlay(overlay(md5(seed::text||':'||(field->>'id')) placing '4' from 13 for 1) placing '8' from 17 for 1)::uuid;
    values:=jsonb_build_object('id',answer_id,'company_id',p_company::text,'site_visit_id',visit.id,'site_visit_type_id',template.id,
     'field_id',field->'id','label',field->'label','kind',field->'kind','required',field->'required','help_text',field->'helpText',
     'sort_order',field->'sortOrder','answer_value','{}'::jsonb,'answer_state',null,'answer_evidence',null,'deleted_at',null);
    rows:=rows||jsonb_build_array(jsonb_build_object('id',answer_id,'base_revision',0,'before',null,'values',values));
    projected:=projected||jsonb_build_array(values);
   end loop;
   if jsonb_array_length(projected)>200 then raise exception 'SITE_VISIT_FIELD_LIMIT';end if;
   title:='Use checklist: '||template.name;
  else
   if req-array['operation','idempotency_key','supersedes','site_visit_id','changes','sources']<>'{}'
    or jsonb_typeof(req->'changes') is distinct from 'array' or jsonb_array_length(req->'changes') not between 1 and 100
    or (select count(distinct p->>'answer_id') from jsonb_array_elements(req->'changes')p)<>jsonb_array_length(req->'changes')
    or jsonb_typeof(req->'sources') is distinct from 'array' or jsonb_array_length(req->'sources')>20 then raise exception 'SITE_VISIT_INPUT_INVALID';end if;
   for source in select value from jsonb_array_elements(req->'sources') loop
    if source->>'kind'='operator_notes' then
     if source-array['kind','text']<>'{}' or jsonb_typeof(source->'text') is distinct from 'string' or length(btrim(source->>'text')) not between 1 and 32000 then raise exception 'SITE_VISIT_SOURCE_INVALID';end if;
     sources:=sources||jsonb_build_array(source||jsonb_build_object('sha256',private.agent_site_visit_workflow_text_hash(source->>'text'),'artifact_id',null));
    elsif source->>'kind'='visit_artifact' then
     if source-array['kind','artifact_id','expected_sha256']<>'{}' then raise exception 'SITE_VISIT_SOURCE_INVALID';end if;
     select * into artifact from public.site_visit_artifacts where id=(source->>'artifact_id')::uuid and company_id=p_company::text and site_visit_id=visit.id and deleted_at is null;
     if not found then raise exception 'SITE_VISIT_SOURCE_NOT_FOUND' using errcode='42501';end if;
     if private.agent_site_visit_workflow_hash(to_jsonb(artifact)) is distinct from source->>'expected_sha256' then raise exception 'SITE_VISIT_SOURCE_STALE';end if;
     source_text:=concat_ws(E'\n',nullif(artifact.title,''),nullif(artifact.body,''));
     if length(source_text)>200000 then raise exception 'SITE_VISIT_SOURCE_TOO_LARGE';end if;
     sources:=sources||jsonb_build_array(jsonb_build_object('kind','visit_artifact','artifact_id',artifact.id,'sha256',source->'expected_sha256','artifact_kind',artifact.kind,
      'text',source_text,'deck_design_id',artifact.deck_design_id,'asset_url',coalesce(nullif(btrim(artifact.rendered_asset_url),''),nullif(btrim(artifact.asset_url),'')),'has_remote_asset',coalesce(nullif(btrim(artifact.rendered_asset_url),''),nullif(btrim(artifact.asset_url),'')) is not null));
     source_graph:=source_graph||jsonb_build_object('artifact:'||artifact.id::text,to_jsonb(artifact));
    else raise exception 'SITE_VISIT_SOURCE_UNSUPPORTED';end if;
   end loop;
   for patch in select value from jsonb_array_elements(req->'changes') loop
    if patch-array['answer_id','expected_revision','intent','value','evidence','reason','uncertainty']<>'{}' then raise exception 'SITE_VISIT_PATCH_INVALID';end if;
    select * into answer from public.site_visit_checklist_answers where id=(patch->>'answer_id')::uuid and company_id=p_company::text and site_visit_id=visit.id and deleted_at is null;
    if not found then raise exception 'SITE_VISIT_ANSWER_NOT_FOUND' using errcode='42501';end if;
    if coalesce(answer.write_revision,0) is distinct from (patch->>'expected_revision')::bigint then raise exception 'SITE_VISIT_ANSWER_STALE';end if;
    intent:=patch->>'intent';evidence:=private.agent_site_visit_workflow_evidence(patch->'evidence',sources,answer.kind);uncertainty:='[]';
    if patch?'uncertainty' then
     if jsonb_typeof(patch->'uncertainty') is distinct from 'array' or jsonb_array_length(patch->'uncertainty')>5 then raise exception 'SITE_VISIT_UNCERTAINTY_INVALID';end if;
     for item in select value from jsonb_array_elements(patch->'uncertainty') loop
      if item-array['reason','evidence']<>'{}' or length(btrim(coalesce(item->>'reason',''))) not between 1 and 2000 or jsonb_array_length(item->'evidence')=0 then raise exception 'SITE_VISIT_UNCERTAINTY_INVALID';end if;
      uncertainty:=uncertainty||jsonb_build_array(jsonb_build_object('reason',item->'reason','evidence',private.agent_site_visit_workflow_evidence(item->'evidence',sources,answer.kind)));
     end loop;
    end if;
    if intent='set' then
     after_value:=patch->'value';
     if jsonb_array_length(evidence)=0 or uncertainty<>'[]' or not private.site_visit_value_valid(answer.kind,after_value)
      or private.site_visit_normalized_value(after_value)='{}' or(after_value?'text' and btrim(after_value->>'text')='') then raise exception 'SITE_VISIT_ANSWER_INVALID';end if;
     if answer.kind='measurement' and not exists(select 1 from jsonb_array_elements(evidence)e where position(after_value->>'text' in e->>'quote')>0) then raise exception 'SITE_VISIT_MEASUREMENT_MUST_PRESERVE_UNITS';end if;
     if after_value?'artifactIds' and exists(select 1 from jsonb_array_elements_text(after_value->'artifactIds') id where not exists(
      select 1 from jsonb_array_elements(evidence)e join jsonb_array_elements(sources)s on s->>'artifact_id'=e->>'artifact_id'
      where s->>'artifact_id'=id and s->>'has_remote_asset'='true' and s->>'artifact_kind'=any(case when answer.kind='photo_markup' then array['annotated_photo','dimensioned_photo'] else array['photo','annotated_photo','dimensioned_photo'] end))) then raise exception 'SITE_VISIT_MEDIA_EVIDENCE_INVALID';end if;
     if after_value?'deckDesignId' and not exists(select 1 from jsonb_array_elements(evidence)e join jsonb_array_elements(sources)s on s->>'artifact_id'=e->>'artifact_id'
       where s->>'artifact_kind'='deck_design' and s->>'deck_design_id'=after_value->>'deckDesignId') then raise exception 'SITE_VISIT_DECK_EVIDENCE_INVALID';end if;
    elsif intent in ('unknown','clear') then
     if patch->'value' is distinct from 'null' or length(btrim(coalesce(patch->>'reason',''))) not between 1 and 2000 or (uncertainty<>'[]' and intent<>'unknown') then raise exception 'SITE_VISIT_ANSWER_REASON_REQUIRED';end if;
     after_value:='{}';
    else raise exception 'SITE_VISIT_ANSWER_INTENT_INVALID';end if;
    values:=private.agent_site_visit_workflow_values('answer',to_jsonb(answer))||jsonb_build_object('answer_value',after_value,
      'answer_state',case intent when 'set' then 'answered' when 'clear' then 'cleared' else 'unknown' end,
      'answer_evidence',jsonb_build_object('intent',intent,'reason',patch->'reason','evidence',evidence,'uncertainty',uncertainty,'content_kind','untrusted_business_data'));
    -- Prior provenance stays in the private source hash. It may have been
    -- derived from media that this caller is no longer permitted to read.
    rows:=rows||jsonb_build_array(jsonb_build_object('id',answer.id,'base_revision',coalesce(answer.write_revision,0),'before',(to_jsonb(answer)-'answer_evidence')||jsonb_build_object('evidence_redacted',answer.answer_evidence is not null),'values',values));
   end loop;
   select jsonb_agg(coalesce((select r->'values' from jsonb_array_elements(rows)r where r->>'id'=a->>'id'),a) order by (a->>'sort_order')::integer,a->>'id') into projected from jsonb_array_elements(answers)a;
   title:='Update site visit answers';
  end if;
  missing:=private.agent_site_visit_workflow_missing(projected);
 else raise exception 'SITE_VISIT_OPERATION_INVALID';end if;
 if visit.id is not null then
  select case when exists(select 1 from pg_timezone_names where name=c.timezone) then c.timezone else 'UTC' end into visit_zone from public.companies c where c.id=p_company;
  select jsonb_build_object('id',visit.id,'title',coalesce(o.title,p.title),'address',coalesce(o.address,p.address),
   'local_start',to_char(visit.scheduled_at at time zone visit_zone,'YYYY-MM-DD"T"HH24:MI:SS'),'timezone',visit_zone,
   'utc_offset_minutes',extract(epoch from((visit.scheduled_at at time zone visit_zone)-(visit.scheduled_at at time zone 'UTC')))::integer/60)
   into visit_context from (select 1) seed
   left join public.opportunities o on o.id=visit.opportunity_id and o.company_id=p_company and private.user_can_view_opportunity(p_actor,o.id)
   left join public.projects p on p.id=coalesce(visit.project_ref,private.try_parse_uuid(visit.project_id)) and p.company_id=p_company and private.user_can_view_project(p_actor,p.id);
 end if;
 result:=jsonb_build_object('operation',operation,'title',title,'ready',true,'entity',entity,'site_visit_id',visit.id,'template_id',template_id,'visit_context',visit_context,
  'rows',rows,'sources',sources,'missing_required',missing,'source_sha256',private.agent_site_visit_workflow_hash(source_graph||jsonb_build_object('revision',graph_revision,'sources',sources)),
  'timezone_proof',null,'effects',jsonb_build_object('records',jsonb_array_length(rows),'physical_visit_status_changed',false,'calendar_intent','not_requested','customer_messages_sent',0),
  'content_kind','untrusted_business_data');
 if octet_length(result::text)>240000 then raise exception 'SITE_VISIT_PROPOSAL_TOO_LARGE';end if;
 return result;
end $$;
do $$ declare t text;begin
 foreach t in array array['public.companies','public.users','public.opportunities','public.projects','public.project_tasks',
 'public.calendar_user_events','public.site_visits','public.site_visit_types','public.site_visit_checklist_answers',
 'public.site_visit_artifacts','public.deck_designs','public.site_visit_booking_policies','public.email_connections','private.guest_booking_intents'] loop
 execute format('create trigger bump_site_visit_workflow_revision after insert or update or delete on %s for each row execute function private.bump_agent_site_visit_workflow_revision()',t);
 end loop;
end $$;

create function private.agent_site_visit_workflow_lock(p_company uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
 -- The existing shared deadline preserves a shorter caller budget and never
 -- resets a positive transaction timer to extend a request's lifetime.
 perform private.agent_catalog_deadline();
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'SITE_VISIT_ISOLATION_UNSUPPORTED' using errcode='40001';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('lead-assignment-company:'||p_company::text,161000)) or
    not pg_try_advisory_xact_lock(hashtextextended('agent-approved-capacity:'||p_company::text,140006)) then
  raise exception 'SITE_VISIT_WORKFLOW_BUSY' using errcode='55P03';
 end if;
 -- Fence insertions from ordinary phone/web writers as well as existing rows.
 -- NOWAIT prevents lock inversion with an in-flight canonical app transaction.
 lock table public.site_visits,public.site_visit_types,public.site_visit_checklist_answers,
 public.site_visit_artifacts,public.deck_designs,public.opportunities,public.projects,public.project_tasks,
 public.calendar_user_events,public.users,public.companies,public.site_visit_booking_policies,
 public.email_connections,private.guest_booking_intents in share row exclusive mode nowait;
 lock table public.roles,public.user_roles,public.role_permissions,public.user_permission_overrides in share mode nowait;
end $$;

create function private.agent_site_visit_workflow_labels(scopes text[],revision text) returns text[]
language sql immutable strict set search_path='' as $$
 select case when revision='2026-09-10.mcp-consent-catalog.v17' and count(*) filter(where label is null)=0 then array_agg(label order by ordinal) end from (
 select ordinal,case scope
 when 'ops.site_visit_templates.read' then 'See reusable company site visit checklists and their fields'
 when 'ops.site_visit_templates.prepare' then 'Prepare reusable site visit checklist and default changes for exact approval in OPS'
 when 'ops.site_visits.prepare' then 'Prepare site visit bookings, reschedules, cancellations and field answers for exact approval in OPS'
 else (private.agent_catalog_labels(array[scope],'2026-09-08.mcp-consent-catalog.v14'))[1] end label
 from unnest(scopes) with ordinality x(scope,ordinal)) labels
$$;
create function private.agent_site_visit_workflow_authorize(ctx jsonb,req jsonb,p_write boolean) returns void
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=(ctx->>'actor')::uuid;company uuid:=(ctx->>'company')::uuid;actual record;keys text[];
 scopes text[];g private.mcp_oauth_grants%rowtype;c private.mcp_oauth_clients%rowtype;
 visit public.site_visits%rowtype;op public.opportunities%rowtype;scope text;
begin
 if actor is null or company is null or ctx->>'manifest' is distinct from '2026-09-10.capability-manifest.v27'
 or coalesce(ctx->>'channel','') not in ('mcp','internal','ops_api') or jsonb_typeof(ctx) is distinct from 'object'
 or not(ctx?&array['actor','company','channel','manifest','permission_revision','permission_keys','grant','client','grant_revision','scopes'])
 or ctx-array['actor','company','channel','manifest','permission_revision','permission_keys','grant','client','grant_revision','scopes']<>'{}' then
  raise exception 'SITE_VISIT_AUTHORITY_INVALID' using errcode='42501';
 end if;
 keys:=array(select jsonb_array_elements_text(ctx->'permission_keys'));
 if cardinality(keys) not between 1 and 256 or keys is distinct from (select array_agg(distinct k collate "C" order by k collate "C") from unnest(keys) k) then
  raise exception 'SITE_VISIT_PERMISSION_KEYS_INVALID' using errcode='42501';
 end if;
 select * into actual from private.resolve_agent_actor_authority(actor,company,keys);
 if actual.permission_snapshot_revision is null or actual.permission_snapshot_revision is distinct from ctx->>'permission_revision' then
  raise exception 'SITE_VISIT_AUTHORITY_STALE' using errcode='42501';
 end if;
 if p_write and not actual.effective_permissions @> '[{"permission":"agent.review","scope":"all"}]'::jsonb then
  raise exception 'SITE_VISIT_REVIEW_PERMISSION_REQUIRED' using errcode='42501';
 end if;
 if req->>'operation' in ('list_templates','get_template','create_template','edit_template') then
  scopes:=array['ops.site_visit_templates.read'];
  if not p_write and not exists(select 1 from jsonb_array_elements(actual.effective_permissions)p
    where (p->>'permission' in('pipeline.view','projects.view') and p->>'scope' in('all','assigned'))
       or (p->>'permission'='settings.company' and p->>'scope' in('all','own'))) then
   raise exception 'SITE_VISIT_TEMPLATE_READ_PERMISSION_REQUIRED' using errcode='42501';
  end if;
  if p_write then
   scopes:=scopes||array['ops.site_visit_templates.prepare'];
   if not actual.effective_permissions @> '[{"permission":"settings.company","scope":"all"}]'::jsonb then
    raise exception 'SITE_VISIT_TEMPLATE_PERMISSION_REQUIRED' using errcode='42501';
   end if;
  end if;
 else
  scopes:=array['ops.site_visits.read'];
  if p_write then scopes:=scopes||array['ops.site_visits.prepare'];end if;
  if req->>'operation'='book' then
   select * into op from public.opportunities where id=(req->>'opportunity_id')::uuid and company_id=company and deleted_at is null;
   if not found or not private.user_can_view_opportunity(actor,op.id) then raise exception 'SITE_VISIT_NOT_FOUND' using errcode='42501';end if;
   if p_write then
    scope:=private.effective_pipeline_scope_for_user(actor,company,'pipeline.convert');
    if scope is null or not(scope='all' or(scope='assigned' and op.assigned_to=actor))
      or not private.actor_can_edit_site_visit(actor,company::text,op.id,null,null) then raise exception 'SITE_VISIT_BOOKING_PERMISSION_REQUIRED' using errcode='42501';end if;
   end if;
  elsif req->>'site_visit_id' is not null then
   select * into visit from public.site_visits where id=(req->>'site_visit_id')::uuid and company_id=company::text and deleted_at is null;
   if not found or not (
     (visit.opportunity_id is null and coalesce(visit.project_ref,private.try_parse_uuid(visit.project_id)) is null
      and actual.effective_permissions @> '[{"permission":"pipeline.view","scope":"all"}]'::jsonb)
     or private.user_can_view_opportunity(actor,visit.opportunity_id)
     or private.user_can_view_project(actor,coalesce(visit.project_ref,private.try_parse_uuid(visit.project_id)))) then
    raise exception 'SITE_VISIT_NOT_FOUND' using errcode='42501';
   end if;
   if p_write and not private.actor_can_edit_site_visit(actor,company::text,visit.opportunity_id,visit.project_id,visit.project_ref) then
    raise exception 'SITE_VISIT_EDIT_PERMISSION_REQUIRED' using errcode='42501';
   end if;
  else raise exception 'SITE_VISIT_OPERATION_INVALID' using errcode='22023';end if;
 end if;
 if req->>'operation' in ('book','reschedule','cancel') then
  scopes:=scopes||array['ops.schedule.read','ops.team.read'];
  if not actual.effective_permissions @> '[{"permission":"calendar.view","scope":"all"},{"permission":"team.view","scope":"all"}]'::jsonb then raise exception 'SITE_VISIT_AVAILABILITY_PERMISSION_REQUIRED' using errcode='42501';end if;
 end if;
 if req->>'operation'='select_checklist' then scopes:=scopes||array['ops.site_visit_templates.read'];end if;
 if req->>'operation' in('answer_form','get_source') then
  if exists(select 1 from jsonb_array_elements(coalesce(req->'changes','[]')) p join public.site_visit_checklist_answers a on a.id=(p->>'answer_id')::uuid and a.site_visit_id=visit.id where a.kind in ('photo','photo_markup'))
   or exists(select 1 from public.site_visit_artifacts a where a.site_visit_id=visit.id and a.company_id=company::text and a.kind in('photo','annotated_photo','dimensioned_photo') and(a.id::text=req->>'artifact_id' or a.id::text in(select x->>'artifact_id' from jsonb_array_elements(coalesce(req->'sources','[]'))x))) then
   scopes:=scopes||array['ops.photos.read'];
   if not exists(select 1 from jsonb_array_elements(actual.effective_permissions)p where p->>'permission'='photos.view' and p->>'scope' in ('all','assigned')) then raise exception 'SITE_VISIT_PHOTO_PERMISSION_REQUIRED' using errcode='42501';end if;
  end if;
  if exists(select 1 from jsonb_array_elements(coalesce(req->'changes','[]')) p join public.site_visit_checklist_answers a on a.id=(p->>'answer_id')::uuid and a.site_visit_id=visit.id where a.kind='deck_design')
   or exists(select 1 from public.site_visit_artifacts a where a.site_visit_id=visit.id and a.company_id=company::text and a.kind='deck_design' and(a.id::text=req->>'artifact_id' or a.id::text in(select x->>'artifact_id' from jsonb_array_elements(coalesce(req->'sources','[]'))x))) then
   scopes:=scopes||array['ops.files.read'];
   if not exists(select 1 from jsonb_array_elements(actual.effective_permissions)p where p->>'permission'='deck_builder.view' and p->>'scope' in ('all','assigned')) then raise exception 'SITE_VISIT_DECK_PERMISSION_REQUIRED' using errcode='42501';end if;
  end if;
 end if;
 if ctx->>'channel'='mcp' then
  select * into g from private.mcp_oauth_grants where id=(ctx->>'grant')::uuid for share nowait;
  select * into c from private.mcp_oauth_clients where client_id=(ctx->>'client')::uuid for share nowait;
  if g.id is null or c.client_id is null or g.user_id is distinct from actor or g.company_id is distinct from company
   or g.client_id is distinct from c.client_id or g.revoked_at is not null or c.disabled_at is not null
   or g.revision is distinct from ctx->>'grant_revision' or g.scopes is distinct from array(select jsonb_array_elements_text(ctx->'scopes'))
   or not scopes<@g.scopes or not g.scopes<@c.scope_ceiling or c.scope is distinct from array_to_string(c.scope_ceiling,' ')
   or g.exposure_revision is distinct from '2026-09-10.mcp-exposure.v22' or c.exposure_revision is distinct from g.exposure_revision
   or g.consent_catalog_revision is distinct from '2026-09-10.mcp-consent-catalog.v17' or c.consent_catalog_revision is distinct from g.consent_catalog_revision
   or g.accepted_labels is distinct from private.agent_site_visit_workflow_labels(g.scopes,g.consent_catalog_revision) then
   raise exception 'SITE_VISIT_GRANT_STALE_OR_DENIED' using errcode='42501';
  end if;
 elsif ctx->>'grant' is not null or ctx->>'client' is not null or ctx->>'grant_revision' is not null or ctx->'scopes'<>'null'::jsonb then
  raise exception 'SITE_VISIT_AUTHORITY_INVALID' using errcode='42501';
 end if;
end $$;

create function private.agent_site_visit_workflow_time(p_local text,p_timezone text,p_offset integer) returns jsonb
language plpgsql stable set search_path='' set timezone='UTC' as $$
declare civil timestamp;candidates timestamptz[];instant timestamptz;
begin
 if p_local !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$' or
  not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'SITE_VISIT_LOCAL_TIME_INVALID';end if;
 civil:=p_local::timestamp;
 if to_char(civil,'YYYY-MM-DD"T"HH24:MI:SS') is distinct from p_local then raise exception 'SITE_VISIT_LOCAL_TIME_INVALID';end if;
 select array_agg(candidate order by candidate) into candidates from (
  select (civil-make_interval(mins=>offset_minutes)) at time zone 'UTC' candidate from generate_series(-840,840) offset_minutes
 ) possible where candidate at time zone p_timezone=civil;
 if coalesce(cardinality(candidates),0)=0 then raise exception 'SITE_VISIT_LOCAL_TIME_DOES_NOT_EXIST';end if;
 if p_offset is null and cardinality(candidates)>1 then raise exception 'SITE_VISIT_LOCAL_TIME_AMBIGUOUS';end if;
 instant:=case when p_offset is null then candidates[1] else (civil-make_interval(mins=>p_offset)) at time zone 'UTC' end;
 if not instant=any(candidates) then raise exception 'SITE_VISIT_LOCAL_TIME_OFFSET_INVALID';end if;
 return jsonb_build_object('local',p_local,'instant',instant,'utc_offset_minutes',extract(epoch from(civil-(instant at time zone 'UTC')))::integer/60);
end $$;
create function private.agent_site_visit_workflow_booking_preview(p_actor uuid,p_company uuid,req jsonb,seed uuid) returns jsonb
language plpgsql volatile security definer set search_path='' set timezone='UTC' as $$
declare company public.companies%rowtype;visit public.site_visits%rowtype;lead public.opportunities%rowtype;
 operation text:=req->>'operation';civil text;instant timestamptz;finish timestamptz;duration integer;reminder integer;crew text[];
 proof jsonb;appointment jsonb;conflicts jsonb:='[]';warnings jsonb:='[]';sources jsonb:='[]';members jsonb;row record;
 starts timestamptz;ends timestamptz;start_day date;end_day date;invalid boolean;source_count integer:=0;graph_revision bigint;
 before_value jsonb;stage text;change boolean;calendar_connected boolean;
begin
 if operation not in ('book','reschedule','cancel') or req-array['operation','idempotency_key','supersedes','opportunity_id','site_visit_id','expected_sha256','local_start','utc_offset_minutes','duration_minutes','assignee_ids','reminder_lead_minutes']<>'{}' then raise exception 'SITE_VISIT_INPUT_INVALID';end if;
 select * into company from public.companies where id=p_company and deleted_at is null;
 if not found then raise exception 'SITE_VISIT_COMPANY_NOT_FOUND' using errcode='42501';end if;
 if not exists(select 1 from pg_timezone_names where name=company.timezone) then
  if operation='cancel' then company.timezone:='UTC';else raise exception 'SITE_VISIT_COMPANY_TIMEZONE_REQUIRED';end if;
 end if;
 select coalesce(revision,0) into graph_revision from private.agent_site_visit_workflow_revisions where company_id=p_company;
 if operation='book' then
  if req?'site_visit_id' or req?'expected_sha256' then raise exception 'SITE_VISIT_INPUT_INVALID';end if;
  select * into lead from public.opportunities where id=(req->>'opportunity_id')::uuid and company_id=p_company and deleted_at is null;
  if not found or not private.actor_can_edit_site_visit(p_actor,p_company::text,lead.id,null,null) then raise exception 'SITE_VISIT_NOT_FOUND' using errcode='42501';end if;
  if exists(select 1 from public.site_visits where opportunity_id=lead.id and company_id=p_company::text and deleted_at is null and booked_at is not null and status='scheduled') then raise exception 'SITE_VISIT_ALREADY_BOOKED';end if;
  civil:=req->>'local_start';duration:=(req->>'duration_minutes')::integer;
  if not req?'reminder_lead_minutes' then raise exception 'SITE_VISIT_REMINDER_REQUIRED';end if;
  reminder:=(req->>'reminder_lead_minutes')::integer;
 else
  if req?'opportunity_id' then raise exception 'SITE_VISIT_INPUT_INVALID';end if;
  select * into visit from public.site_visits where id=(req->>'site_visit_id')::uuid and company_id=p_company::text and deleted_at is null;
  if not found or not private.actor_can_edit_site_visit(p_actor,p_company::text,visit.opportunity_id,visit.project_id,visit.project_ref) then raise exception 'SITE_VISIT_NOT_FOUND' using errcode='42501';end if;
  if visit.booked_at is null or visit.status is distinct from 'scheduled' or visit.completed_at is not null then raise exception 'SITE_VISIT_APPOINTMENT_CLOSED';end if;
  if private.agent_site_visit_workflow_hash(to_jsonb(visit)) is distinct from req->>'expected_sha256' then raise exception 'SITE_VISIT_APPOINTMENT_STALE';end if;
  if operation='cancel' and req-array['operation','idempotency_key','supersedes','site_visit_id','expected_sha256']<>'{}' then raise exception 'SITE_VISIT_INPUT_INVALID';end if;
  if visit.opportunity_id is not null then select * into lead from public.opportunities where id=visit.opportunity_id and company_id=p_company and deleted_at is null;end if;
  civil:=coalesce(req->>'local_start',to_char(visit.scheduled_at at time zone company.timezone,'YYYY-MM-DD"T"HH24:MI:SS'));
  duration:=coalesce((req->>'duration_minutes')::integer,visit.duration_minutes);
  reminder:=case when req->>'reminder_lead_minutes'='-1' then null else coalesce((req->>'reminder_lead_minutes')::integer,visit.reminder_lead_minutes) end;
 end if;
 if operation<>'cancel' and (civil is null or duration is null or duration not between 15 and 480 or reminder not between 0 and 1440) then raise exception 'SITE_VISIT_APPOINTMENT_INVALID';end if;
 if req?'utc_offset_minutes' and not req?'local_start' then raise exception 'SITE_VISIT_OFFSET_WITHOUT_LOCAL_TIME';end if;
 if operation<>'book' and not req?'local_start' then
  instant:=visit.scheduled_at;
  proof:=jsonb_build_object('local',civil,'instant',instant,'utc_offset_minutes',extract(epoch from((instant at time zone company.timezone)-(instant at time zone 'UTC')))::integer/60);
 else
  proof:=private.agent_site_visit_workflow_time(civil,company.timezone,(req->>'utc_offset_minutes')::integer);instant:=(proof->>'instant')::timestamptz;
 end if;
 if operation<>'cancel' and instant<clock_timestamp()-interval '5 minutes' then raise exception 'SITE_VISIT_APPOINTMENT_IN_PAST';end if;
 finish:=instant+make_interval(mins=>duration);
 if req?'assignee_ids' then
  if jsonb_typeof(req->'assignee_ids') is distinct from 'array' or jsonb_array_length(req->'assignee_ids') not between 1 and 25 then raise exception 'SITE_VISIT_CREW_INVALID';end if;
  crew:=array(select jsonb_array_elements_text(req->'assignee_ids'));
 else crew:=visit.assignee_ids;end if;
 if operation<>'cancel' then
  if crew is null or cardinality(crew) not between 1 and 25 or (select count(distinct x) from unnest(crew)x)<>cardinality(crew)
   or exists(select 1 from unnest(crew)x where not exists(select 1 from public.users u where u.id::text=x and u.company_id=p_company and u.is_active and u.deleted_at is null)) then raise exception 'SITE_VISIT_CREW_INVALID';end if;
  crew:=array(select x from unnest(crew)x order by x);
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',concat_ws(' ',first_name,last_name)) order by id),'[]') into members from public.users where id::text=any(crew) and company_id=p_company;
 appointment:=jsonb_build_object('local_start',civil,'timezone',company.timezone,'starts_at',instant,'ends_at',finish,'duration_minutes',duration,'assignee_ids',crew,'crew',members,'reminder_lead_minutes',reminder);
 before_value:=case when visit.id is null then null else jsonb_build_object('starts_at',visit.scheduled_at,'local_start',to_char(visit.scheduled_at at time zone company.timezone,'YYYY-MM-DD"T"HH24:MI:SS'),'timezone',company.timezone,'crew',(select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',concat_ws(' ',u.first_name,u.last_name)) order by u.id),'[]') from public.users u where u.company_id=p_company and u.id::text=any(visit.assignee_ids)),'duration_minutes',visit.duration_minutes,'assignee_ids',visit.assignee_ids,'reminder_lead_minutes',visit.reminder_lead_minutes,'status',visit.status) end;
 change:=operation<>'reschedule' or instant is distinct from visit.scheduled_at or duration is distinct from visit.duration_minutes or crew is distinct from visit.assignee_ids or reminder is distinct from visit.reminder_lead_minutes;
 if operation<>'cancel' then
  -- Date fields in tasks encode civil dates. Their separate time columns are
  -- resolved exactly as in the existing availability read contract.
  for row in select * from public.project_tasks where company_id=p_company and deleted_at is null and status<>'cancelled' and (start_date is not null or end_date is not null) and team_member_ids&&crew
   and (start_date is null or not isfinite(start_date) or (end_date is not null and not isfinite(end_date)) or all_day is null or coalesce(project_tasks.duration,1) not between 1 and 3660
    or (end_date at time zone 'UTC')::date < (start_date at time zone 'UTC')::date
    or (not all_day and (start_time is null or end_time is null))
    or ((start_date at time zone 'UTC')::date <= (finish at time zone company.timezone)::date
     and coalesce((end_date at time zone 'UTC')::date,(start_date at time zone 'UTC')::date+greatest(coalesce(project_tasks.duration,1),1)) >= (instant at time zone company.timezone)::date))
   order by id limit 501 loop
   source_count:=source_count+1;sources:=sources||jsonb_build_array(to_jsonb(row));
   if row.start_date is null or not isfinite(row.start_date) or (row.end_date is not null and not isfinite(row.end_date)) then
    conflicts:=conflicts||jsonb_build_array(jsonb_build_object('kind','task','id',row.id,'reason','source_invalid'));continue;
   end if;
   start_day:=(row.start_date at time zone 'UTC')::date;
   end_day:=coalesce((row.end_date at time zone 'UTC')::date,start_day+case when row.all_day then greatest(coalesce(row.duration,1),1)-1 when row.end_time<=row.start_time then 1 else 0 end);
   invalid:=row.all_day is null or end_day<start_day or coalesce(row.duration,1) not between 1 and 3660;
   if row.all_day then starts:=private.agent_civil_date_start(start_day,company.timezone);ends:=private.agent_civil_date_start(end_day+1,company.timezone);
   else starts:=private.agent_unambiguous_local_instant(start_day+row.start_time,company.timezone);ends:=private.agent_unambiguous_local_instant(end_day+row.end_time,company.timezone);end if;
   if invalid or starts is null or ends is null or ends<=starts or(starts<finish and ends>instant) then conflicts:=conflicts||jsonb_build_array(jsonb_build_object('kind','task','id',row.id,'reason',case when invalid or starts is null or ends is null or ends<=starts then 'source_invalid' else 'overlap' end));end if;
  end loop;
  for row in select * from public.calendar_user_events where company_id=p_company::text and deleted_at is null and
   ((type='personal' and status='none') or(type='time_off' and status in('approved','none'))) and (user_id=any(crew) or(type='personal' and team_member_ids&&crew))
   and (all_day is null or start_date is null or end_date is null or not isfinite(start_date) or not isfinite(end_date) or end_date<start_date or (not all_day and end_date=start_date)
    or(start_date<finish+interval '1 day' and end_date>instant-interval '1 day')) order by id limit 501 loop
   source_count:=source_count+1;sources:=sources||jsonb_build_array(to_jsonb(row));
   if row.start_date is null or row.end_date is null or not isfinite(row.start_date) or not isfinite(row.end_date) then
    conflicts:=conflicts||jsonb_build_array(jsonb_build_object('kind',row.type,'id',row.id,'reason','source_invalid'));continue;
   end if;
   if row.all_day then starts:=private.agent_civil_date_start((row.start_date at time zone company.timezone)::date,company.timezone);ends:=private.agent_civil_date_start((row.end_date at time zone company.timezone)::date+1,company.timezone);
   else starts:=row.start_date;ends:=row.end_date;end if;
   if row.all_day is null or starts is null or ends is null or ends<=starts or(starts<finish and ends>instant) then conflicts:=conflicts||jsonb_build_array(jsonb_build_object('kind',row.type,'id',row.id,'reason','unavailable'));end if;
  end loop;
  for row in select * from public.site_visits where company_id=p_company::text and deleted_at is null and booked_at is not null and status in('scheduled','in_progress') and id is distinct from visit.id and assignee_ids&&crew
    and (not isfinite(scheduled_at) or duration_minutes<=0 or(scheduled_at<finish and scheduled_at+make_interval(mins=>duration_minutes)>instant)) order by id limit 501 loop
   source_count:=source_count+1;sources:=sources||jsonb_build_array(to_jsonb(row));conflicts:=conflicts||jsonb_build_array(jsonb_build_object('kind','site_visit','id',row.id,'reason','overlap'));
  end loop;
  -- Live guest holds reserve company capacity before an exact crew is assigned.
  for row in select * from private.guest_booking_intents where company_id=p_company and hold_expires_at>clock_timestamp() and state in('held','verified')
    and (slot_start_at is null or not isfinite(slot_start_at) or duration_minutes is null or duration_minutes<=0 or(slot_start_at<finish and slot_start_at+make_interval(mins=>duration_minutes)>instant)) order by id limit 501 loop
   source_count:=source_count+1;sources:=sources||jsonb_build_array(jsonb_build_object('id',row.id,'state',row.state,'expires',row.hold_expires_at,'start',row.slot_start_at,'duration',row.duration_minutes));
   conflicts:=conflicts||jsonb_build_array(jsonb_build_object('kind','guest_hold','id',row.id,'reason','reserved'));
  end loop;
  if source_count>500 then raise exception 'SITE_VISIT_AVAILABILITY_TOO_LARGE';end if;
  if company.default_work_start is null or company.default_work_end is null or company.default_work_end<=company.default_work_start then warnings:=warnings||'"working_hours_unknown"'::jsonb;
  elsif (instant at time zone company.timezone)::time<company.default_work_start or(finish at time zone company.timezone)::time>company.default_work_end or (instant at time zone company.timezone)::date<>(finish at time zone company.timezone)::date
   or(company.skip_weekends_in_auto_schedule and extract(isodow from instant at time zone company.timezone)>5) then warnings:=warnings||'"outside_company_working_hours"'::jsonb;end if;
 end if;
 select exists(select 1 from public.email_connections where company_id=p_company::text and status='active' and granted_scopes&&array['https://www.googleapis.com/auth/calendar.events','https://www.googleapis.com/auth/calendar']) into calendar_connected;
 stage:=case when operation='book' and lead.stage='new_lead' then 'qualifying' else lead.stage::text end;
 return jsonb_build_object('operation',operation,'title',case operation when 'book' then 'Book site visit' when 'reschedule' then 'Reschedule site visit' else 'Cancel site visit' end,
  'ready',conflicts='[]','entity','appointment','site_visit_id',visit.id,'opportunity_id',lead.id,'lead_title',lead.title,'before',before_value,'appointment',appointment,'rows','[]'::jsonb,'sources','[]'::jsonb,'missing_required','[]'::jsonb,
  'availability',jsonb_build_object('conflicts',conflicts,'warnings',warnings,'external_calendar_coverage','unknown'),
  'timezone_proof',case when operation='cancel' then null else jsonb_build_object('timezone',company.timezone,'probes',jsonb_build_array(proof)) end,
  'source_sha256',private.agent_site_visit_workflow_hash(jsonb_build_object('visit',to_jsonb(visit),'lead',to_jsonb(lead),'company',to_jsonb(company),'crew',members,'sources',sources,'revision',coalesce(graph_revision,0),'calendar_connected',calendar_connected)),
  'effects',jsonb_build_object('records',case when change then 1 else 0 end,'physical_visit_status_changed',false,'appointment_status',case when operation='cancel' then 'cancelled' else 'scheduled' end,
    'lead_stage',stage,'timeline',case when not change then 'unchanged' when operation='book' then 'Site visit booked' when operation='reschedule' then 'Site visit rescheduled' else 'Site visit cancelled' end,
    'calendar_intent',case when not change or not calendar_connected or(operation='reschedule' and instant is not distinct from visit.scheduled_at and duration is not distinct from visit.duration_minutes) then 'not_requested' else 'queued' end,'customer_messages_sent',0),'content_kind','untrusted_business_data');
end $$;
create table private.agent_site_visit_workflow_proposals(
 id uuid primary key,action_id uuid not null unique references public.agent_actions(id),company_id uuid not null references public.companies(id),
 actor_user_id uuid not null references public.users(id),authority jsonb not null,request jsonb not null,proposal jsonb not null,
 input_sha256 text not null,preview_sha256 text not null,effect_sha256 text not null,idempotency_key text not null,origin_key text not null,
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,
 committed_at timestamptz,commit_key text,receipt jsonb,rejected_at timestamptz,superseded_by uuid,
 unique(company_id,actor_user_id,origin_key,idempotency_key),
 check(octet_length(request::text)<=150000 and octet_length(proposal::text)<=240000),
 check((committed_at is null)=(receipt is null) and (committed_at is null)=(commit_key is null))
);
create table private.agent_site_visit_workflow_effect_policy(company_id uuid primary key references public.companies(id),revision text not null,effect_sha256 text not null);
create table private.agent_site_visit_workflow_corrections(
 id uuid primary key,company_id uuid not null references public.companies(id),actor_user_id uuid not null references public.users(id),origin_key text not null,
 idempotency_key text not null,input_sha256 text not null,authority jsonb not null,response jsonb not null,expires_at timestamptz not null,
 unique(company_id,actor_user_id,origin_key,idempotency_key),check(octet_length(response::text)<=262144)
);
alter table private.agent_site_visit_workflow_proposals enable row level security;
alter table private.agent_site_visit_workflow_proposals force row level security;
alter table private.agent_site_visit_workflow_effect_policy enable row level security;
alter table private.agent_site_visit_workflow_effect_policy force row level security;
alter table private.agent_site_visit_workflow_corrections enable row level security;
alter table private.agent_site_visit_workflow_corrections force row level security;
revoke all on private.agent_site_visit_workflow_proposals,private.agent_site_visit_workflow_effect_policy,private.agent_site_visit_workflow_corrections from public,anon,authenticated,service_role;
create function private.agent_site_visit_workflow_authorize_evidence(ctx jsonb,proposal jsonb) returns void
language plpgsql volatile security definer set search_path='' as $$
declare actual record;photo boolean;deck boolean;
begin
 select * into actual from private.resolve_agent_actor_authority((ctx->>'actor')::uuid,(ctx->>'company')::uuid,array(select jsonb_array_elements_text(ctx->'permission_keys')));
 photo:=exists(select 1 from jsonb_array_elements(proposal->'sources')s where s->>'artifact_kind' in('photo','annotated_photo','dimensioned_photo'));
 deck:=exists(select 1 from jsonb_array_elements(proposal->'sources')s where s->>'artifact_kind'='deck_design');
 if photo and (not exists(select 1 from jsonb_array_elements(actual.effective_permissions)p where p->>'permission'='photos.view' and p->>'scope' in('all','assigned'))
  or(ctx->>'channel'='mcp' and not ctx->'scopes'?'ops.photos.read')) then raise exception 'SITE_VISIT_PHOTO_PERMISSION_REQUIRED' using errcode='42501';end if;
 if deck and (not exists(select 1 from jsonb_array_elements(actual.effective_permissions)p where p->>'permission'='deck_builder.view' and p->>'scope' in('all','assigned'))
  or(ctx->>'channel'='mcp' and not ctx->'scopes'?'ops.files.read')) then raise exception 'SITE_VISIT_DECK_PERMISSION_REQUIRED' using errcode='42501';end if;
end $$;
create function private.agent_site_visit_workflow_effect_revision() returns text
language sql stable security definer set search_path='' as $$
 select private.agent_site_visit_workflow_hash(jsonb_build_object(
 'revision','2026-09-10.v1',
 'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid)) order by p.oid::regprocedure::text)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('private','public') and
  (p.proname like '%site_visit%' or p.proname in('enqueue_google_calendar_sync','move_opportunity_stage','refresh_site_visit_compatibility','guard_agent_approved_schedule_capacity','agent_current_schedule_capacity','agent_unambiguous_local_instant','agent_civil_date_start'))),
 'schema',(select jsonb_agg(jsonb_build_object('table',a.attrelid::regclass::text,'column',a.attname,'type',format_type(a.atttypid,a.atttypmod),'nullable',not a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attrelid::regclass::text,a.attnum)
  from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attnum>0 and not a.attisdropped and a.attrelid=any(array['public.site_visits'::regclass,'public.site_visit_types'::regclass,'public.site_visit_checklist_answers'::regclass,'public.site_visit_artifacts'::regclass,'public.activities'::regclass,'public.stage_transitions'::regclass,'public.google_calendar_sync_queue'::regclass,'public.agent_actions'::regclass,'public.notifications'::regclass])),
 'triggers',(select jsonb_agg(jsonb_build_object('definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled,'body',pg_get_functiondef(t.tgfoid)) order by t.tgrelid::regclass::text,t.tgname) from pg_trigger t where not t.tgisinternal and t.tgrelid=any(array['public.site_visits'::regclass,'public.site_visit_types'::regclass,'public.site_visit_checklist_answers'::regclass,'public.activities'::regclass,'public.opportunities'::regclass,'public.google_calendar_sync_queue'::regclass,'public.agent_actions'::regclass,'public.notifications'::regclass])),
 'constraints',(select jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'name',c.conname,'definition',pg_get_constraintdef(c.oid)) order by c.conrelid::regclass::text,c.conname) from pg_constraint c where c.conrelid=any(array['public.site_visits'::regclass,'public.site_visit_types'::regclass,'public.site_visit_checklist_answers'::regclass,'public.site_visit_artifacts'::regclass,'public.agent_actions'::regclass,'public.notifications'::regclass]))))
$$;
create function private.agent_site_visit_workflow_active(company uuid) returns text
language plpgsql volatile security definer set search_path='' as $$
declare effect text;begin
 lock table private.agent_site_visit_workflow_effect_policy,private.site_visit_concurrency_companies in share mode nowait;
 effect:=private.agent_site_visit_workflow_effect_revision();
 if not private.site_visit_concurrency_enabled(company::text) or not exists(select 1 from private.agent_site_visit_workflow_effect_policy p where p.company_id=company and p.revision='2026-09-10.v1' and p.effect_sha256=effect) then raise exception 'SITE_VISIT_ACTIVATION_REQUIRED';end if;
 return effect;
end $$;
create function private.agent_site_visit_workflow_response(p_request_id text,p private.agent_site_visit_workflow_proposals,p_replayed boolean) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('request_id',p_request_id,'schema_revision','2026-09-10.v1','status',case when p.committed_at is null then 'approval_required' else 'committed' end,
 'proposal',p.proposal,'action_id',p.action_id,'change_set_id',p.id,'preview_sha256',p.preview_sha256,'expires_at',p.expires_at,'replayed',p_replayed,
 'receipt',p.receipt,'content_kind','untrusted_business_data')
$$;
create function public.prepare_site_visit_workflow_as_system(p_request_id text,p_context jsonb,p_request jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set timezone='UTC' as $$
declare company uuid:=(p_context->>'company')::uuid;actor uuid:=(p_context->>'actor')::uuid;effect text;input_hash text;preview jsonb;
 id uuid:=extensions.gen_random_uuid();action uuid:=extensions.gen_random_uuid();expires timestamptz:=clock_timestamp()+interval '30 minutes';seal text;
 old private.agent_site_visit_workflow_proposals%rowtype;sibling private.agent_site_visit_workflow_proposals%rowtype;origin text:=coalesce(p_context->>'client',p_context->>'channel');replayed boolean:=false;next_proposal_id uuid;
 correction private.agent_site_visit_workflow_corrections%rowtype;response jsonb;
begin
 if auth.role() is distinct from 'service_role' or coalesce(p_request_id,'')!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then raise exception 'SITE_VISIT_ACCESS_DENIED' using errcode='42501';end if;
 perform private.agent_site_visit_workflow_lock(company);
 perform private.agent_site_visit_workflow_authorize(p_context,p_request,true);
 effect:=private.agent_site_visit_workflow_active(company);input_hash:=private.agent_site_visit_workflow_hash(p_request);
 select * into correction from private.agent_site_visit_workflow_corrections c where c.company_id=company and c.actor_user_id=actor and c.origin_key=origin and c.idempotency_key=p_request->>'idempotency_key' for update nowait;
 if found then
  if correction.input_sha256 is distinct from input_hash or correction.authority is distinct from p_context then raise exception 'SITE_VISIT_IDEMPOTENCY_CONFLICT';end if;
  if correction.expires_at<=clock_timestamp() then raise exception 'SITE_VISIT_PROPOSAL_CLOSED';end if;
  perform private.agent_site_visit_workflow_authorize_evidence(p_context,correction.response->'proposal');
  return correction.response||jsonb_build_object('request_id',p_request_id,'replayed',true);
 end if;
 select * into old from private.agent_site_visit_workflow_proposals p where p.company_id=company and p.actor_user_id=actor and p.origin_key=origin and p.idempotency_key=p_request->>'idempotency_key' for update nowait;
 if found then
  if old.input_sha256 is distinct from input_hash or old.authority is distinct from p_context then raise exception 'SITE_VISIT_IDEMPOTENCY_CONFLICT';end if;
  perform private.agent_site_visit_workflow_authorize_evidence(p_context,old.proposal);
  if old.committed_at is not null then return private.agent_site_visit_workflow_response(p_request_id,old,true);end if;
  if old.rejected_at is not null or old.superseded_by is not null or old.expires_at<=clock_timestamp() then raise exception 'SITE_VISIT_PROPOSAL_CLOSED';end if;
  id:=old.id;action:=old.action_id;expires:=old.expires_at;replayed:=true;
 end if;
 preview:=private.agent_site_visit_workflow_compile(actor,company,p_request,id);
 perform private.agent_site_visit_workflow_authorize_evidence(p_context,preview);
 if old.id is null and p_request?'supersedes' then
  select * into sibling from private.agent_site_visit_workflow_proposals p where p.id=(p_request->>'supersedes')::uuid and p.company_id=company and p.actor_user_id=actor and p.origin_key=origin for update nowait;
  if not found or sibling.committed_at is not null or sibling.rejected_at is not null or sibling.superseded_by is not null then raise exception 'SITE_VISIT_SUPERSESSION_INVALID';end if;
  next_proposal_id:=id;
  update private.agent_site_visit_workflow_proposals set superseded_by=next_proposal_id where agent_site_visit_workflow_proposals.id=sibling.id;
  update public.agent_actions set status='cancelled',reviewed_by=actor,reviewed_at=clock_timestamp() where agent_actions.id=sibling.action_id and status='pending';
  update public.notifications set is_read=true,resolved_at=clock_timestamp(),resolved_by=actor,resolution_reason='site_visit_superseded' where dedupe_key='site-visit:'||sibling.action_id::text and company_id=company::text and user_id=actor::text;
 end if;
 if preview->>'ready' is distinct from 'true' or (preview->'effects'->>'records')::int=0 then
  response:=jsonb_build_object('request_id',p_request_id,'schema_revision','2026-09-10.v1','status',case when preview->>'ready'='true' then 'unchanged' else 'needs_input' end,'proposal',preview,'action_id',null,'change_set_id',null,'preview_sha256',null,'expires_at',null,'replayed',false,'receipt',null,'content_kind','untrusted_business_data');
  insert into private.agent_site_visit_workflow_corrections(id,company_id,actor_user_id,origin_key,idempotency_key,input_sha256,authority,response,expires_at)
  values(id,company,actor,origin,p_request->>'idempotency_key',input_hash,p_context,response,expires);
  return response;
 end if;
 seal:=private.agent_site_visit_workflow_hash(jsonb_build_object('id',id,'action',action,'proposal',preview,'authority',p_context,'request',input_hash,'effects',effect,'expires',expires));
 if old.id is not null then
  if old.proposal is distinct from preview or old.preview_sha256 is distinct from seal then raise exception 'SITE_VISIT_SOURCE_STALE';end if;
 else
  insert into public.agent_actions(id,company_id,user_id,action_type,action_data,context_summary,context_source,source_id,confidence,priority,status,expires_at)
  values(action,company,actor,'approve_site_visit_changes',jsonb_build_object('change_set_id',id,'preview_sha256',seal,'proposal',preview),preview->>'title','site_visit','site-visit:'||id::text,1,'normal','pending',expires);
  insert into private.agent_site_visit_workflow_proposals(id,action_id,company_id,actor_user_id,authority,request,proposal,input_sha256,preview_sha256,effect_sha256,idempotency_key,origin_key,expires_at)
  values(id,action,company,actor,p_context,p_request,preview,input_hash,seal,effect,p_request->>'idempotency_key',origin,expires) returning * into old;
  insert into public.notifications(user_id,company_id,type,title,body,is_read,persistent,action_url,action_label,dedupe_key)
  values(actor::text,company::text,'agent_suggestion','Site visit review ready','Review the exact changes before saving.',false,true,'/agent/queue','REVIEW','site-visit:'||action::text);
 end if;
 return private.agent_site_visit_workflow_response(p_request_id,old,replayed);
end $$;
create function private.agent_site_visit_workflow_apply(company uuid,actor uuid,p jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set timezone='UTC' as $$
declare visit_id uuid;result jsonb;r jsonb;readback jsonb;records jsonb:='[]';visit public.site_visits%rowtype;operation text:=p->>'operation';
begin
 if p->>'ready' is distinct from 'true' then raise exception 'SITE_VISIT_NOT_READY';end if;
 if p->>'entity'='appointment' then
  visit_id:=(p->>'site_visit_id')::uuid;
  if operation='book' then visit_id:=private.book_site_visit_for_actor(actor,(p->>'opportunity_id')::uuid,(p->'appointment'->>'starts_at')::timestamptz,(p->'appointment'->>'duration_minutes')::int,array(select jsonb_array_elements_text(p->'appointment'->'assignee_ids')),(p->'appointment'->>'reminder_lead_minutes')::int);
  elsif operation='reschedule' then perform private.reschedule_site_visit_for_actor(actor,visit_id,(p->'appointment'->>'starts_at')::timestamptz,(p->'appointment'->>'duration_minutes')::int,array(select jsonb_array_elements_text(p->'appointment'->'assignee_ids')),coalesce((p->'appointment'->>'reminder_lead_minutes')::int,-1));
  elsif operation='cancel' then perform private.cancel_site_visit_booking_for_actor(actor,visit_id);
  else raise exception 'SITE_VISIT_OPERATION_INVALID';end if;
  select * into visit from public.site_visits where id=visit_id and company_id=company::text;
  if not found or visit.status::text is distinct from p->'effects'->>'appointment_status' or visit.booked_at is null
   or visit.scheduled_at is distinct from (p->'appointment'->>'starts_at')::timestamptz or visit.duration_minutes is distinct from (p->'appointment'->>'duration_minutes')::int
   or to_jsonb(visit.assignee_ids) is distinct from nullif(p->'appointment'->'assignee_ids','null'::jsonb)
   or visit.reminder_lead_minutes is distinct from (p->'appointment'->>'reminder_lead_minutes')::int then raise exception 'SITE_VISIT_READBACK_MISMATCH';end if;
  if p->>'opportunity_id' is not null and not exists(select 1 from public.opportunities where id=(p->>'opportunity_id')::uuid and company_id=company and stage::text=p->'effects'->>'lead_stage') then raise exception 'SITE_VISIT_STAGE_READBACK_MISMATCH';end if;
  if p->'effects'->>'calendar_intent'='queued' and not exists(select 1 from public.google_calendar_sync_queue q where q.site_visit_id=visit_id and q.status='pending' and q.operation=case p->>'operation' when 'book' then 'create' when 'reschedule' then 'update' else 'delete' end) then raise exception 'SITE_VISIT_CALENDAR_INTENT_MISSING';end if;
  records:=jsonb_build_array(jsonb_build_object('entity','site_visit','id',visit_id,'after',to_jsonb(visit),'sha256',private.agent_site_visit_workflow_hash(to_jsonb(visit))));
 else
  result:=private.apply_site_visit_rows(actor,company::text,p->>'entity',p->'rows');
  if result->>'outcome' is distinct from 'saved' then raise exception 'SITE_VISIT_SOURCE_STALE';end if;
  for r in select value from jsonb_array_elements(p->'rows') loop
   if p->>'entity'='template' then select to_jsonb(t) into readback from public.site_visit_types t where t.id=r->>'id' and t.company_id=company::text;
   else select to_jsonb(a) into readback from public.site_visit_checklist_answers a where a.id=(r->>'id')::uuid and a.company_id=company::text;end if;
   if readback is null or (private.agent_site_visit_workflow_values(p->>'entity',readback)-'answer_value') is distinct from ((r->'values')-'answer_value')
    or(p->>'entity'='answer' and private.site_visit_normalized_value(readback->'answer_value') is distinct from private.site_visit_normalized_value(r->'values'->'answer_value')) then raise exception 'SITE_VISIT_READBACK_MISMATCH';end if;
   records:=records||jsonb_build_array(jsonb_build_object('entity',p->'entity','id',r->'id','before',r->'before','after',readback,'sha256',private.agent_site_visit_workflow_hash(readback)));
  end loop;
 end if;
 return jsonb_build_object('records',records,'effects',p->'effects','missing_required',p->'missing_required','site_visit_id',coalesce(visit_id,(p->>'site_visit_id')::uuid),'calendar_reconciled',false,'customer_messages_sent',0);
end $$;
create function public.commit_site_visit_workflow_as_actor(p_actor_user_id uuid,p_company_id uuid,p_action_id uuid,p_change_set_id uuid,p_preview_sha256 text,p_idempotency_key text) returns jsonb
language plpgsql volatile security definer set search_path='' set timezone='UTC' as $$
declare p private.agent_site_visit_workflow_proposals%rowtype;a public.agent_actions%rowtype;preview jsonb;result jsonb;stamp timestamptz;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'SITE_VISIT_ACCESS_DENIED' using errcode='42501';end if;
 if p_actor_user_id is null or p_company_id is null or p_action_id is null or p_change_set_id is null or coalesce(p_preview_sha256,'')!~'^sha256:[0-9a-f]{64}$' or coalesce(p_idempotency_key,'')!~'^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$' then raise exception 'SITE_VISIT_CONFIRMATION_INVALID';end if;
 perform private.agent_site_visit_workflow_lock(p_company_id);
 select * into p from private.agent_site_visit_workflow_proposals where id=p_change_set_id and action_id=p_action_id and company_id=p_company_id and actor_user_id=p_actor_user_id for update nowait;
 if not found then raise exception 'SITE_VISIT_PROPOSAL_NOT_FOUND' using errcode='42501';end if;
 perform private.agent_site_visit_workflow_authorize(p.authority,p.request,true);
 perform private.agent_site_visit_workflow_authorize_evidence(p.authority,p.proposal);
 if p.preview_sha256 is distinct from p_preview_sha256 then raise exception 'SITE_VISIT_IDEMPOTENCY_CONFLICT';end if;
 if p.committed_at is not null then
  if p.commit_key is distinct from p_idempotency_key then raise exception 'SITE_VISIT_IDEMPOTENCY_CONFLICT';end if;
  return p.receipt||jsonb_build_object('replayed',true);
 end if;
 if p.effect_sha256 is distinct from private.agent_site_visit_workflow_active(p_company_id) then raise exception 'SITE_VISIT_EFFECT_POLICY_CHANGED';end if;
 select * into a from public.agent_actions where id=p_action_id and user_id=p_actor_user_id and company_id=p_company_id and action_type='approve_site_visit_changes' for update nowait;
 if not found or a.status is distinct from 'pending' or a.expires_at is null or a.expires_at<=clock_timestamp() or p.expires_at<=clock_timestamp() or p.rejected_at is not null or p.superseded_by is not null
  or a.action_data is distinct from jsonb_build_object('change_set_id',p.id,'preview_sha256',p.preview_sha256,'proposal',p.proposal) then raise exception 'SITE_VISIT_CONFIRMATION_STALE';end if;
 preview:=private.agent_site_visit_workflow_compile(p_actor_user_id,p_company_id,p.request,p.id);
 if preview is distinct from p.proposal then raise exception 'SITE_VISIT_SOURCE_STALE';end if;
 result:=private.agent_site_visit_workflow_apply(p_company_id,p_actor_user_id,p.proposal);stamp:=clock_timestamp();
 result:=result||jsonb_build_object('ok',true,'effect','site_visit_changes_saved','operation',p.request->'operation','appointment',p.proposal->'appointment','timezone_proof',p.proposal->'timezone_proof','actor_user_id',p_actor_user_id,'company_id',p_company_id,
  'action_id',p_action_id,'change_set_id',p.id,'confirmation_receipt_id',extensions.gen_random_uuid(),'preview_sha256',p_preview_sha256,'committed_at',stamp,'replayed',false);
 result:=result||jsonb_build_object('receipt_sha256',private.agent_site_visit_workflow_hash(result));
 update private.agent_site_visit_workflow_proposals set committed_at=stamp,commit_key=p_idempotency_key,receipt=result where id=p.id;
 update public.agent_actions set status='executed',reviewed_by=p_actor_user_id,reviewed_at=stamp,executed_at=stamp,execution_result=result,error=null where id=p_action_id and status='pending';
 if not found then raise exception 'SITE_VISIT_ACTION_CONFLICT';end if;
 update public.notifications set is_read=true,resolved_at=stamp,resolved_by=p_actor_user_id,resolution_reason='site_visit_saved' where company_id=p_company_id::text and user_id=p_actor_user_id::text and dedupe_key='site-visit:'||p_action_id::text and resolved_at is null;
 return result;
end $$;
create function public.reject_site_visit_workflow_as_actor(p_actor_user_id uuid,p_company_id uuid,p_action_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare p private.agent_site_visit_workflow_proposals%rowtype;begin
 if auth.role() is distinct from 'service_role' then raise exception 'SITE_VISIT_ACCESS_DENIED' using errcode='42501';end if;
 perform private.agent_site_visit_workflow_lock(p_company_id);
 select * into p from private.agent_site_visit_workflow_proposals where action_id=p_action_id and actor_user_id=p_actor_user_id and company_id=p_company_id for update nowait;
 if not found then raise exception 'SITE_VISIT_PROPOSAL_NOT_FOUND' using errcode='42501';end if;
 perform private.agent_site_visit_workflow_authorize(p.authority,p.request,true);
 if p.committed_at is not null then raise exception 'SITE_VISIT_ALREADY_COMMITTED';end if;
 update private.agent_site_visit_workflow_proposals set rejected_at=coalesce(rejected_at,clock_timestamp()) where id=p.id;
 update public.agent_actions set status='rejected',reviewed_by=p_actor_user_id,reviewed_at=clock_timestamp() where id=p_action_id and status='pending';
 update public.notifications set is_read=true,resolved_at=clock_timestamp(),resolved_by=p_actor_user_id,resolution_reason='site_visit_rejected' where company_id=p_company_id::text and user_id=p_actor_user_id::text and dedupe_key='site-visit:'||p_action_id::text;
 return jsonb_build_object('ok',true,'effect','rejected','action_id',p_action_id);
end $$;
create function private.agent_site_visit_workflow_can_read(actor uuid,company uuid,action uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare p private.agent_site_visit_workflow_proposals%rowtype;ctx jsonb;authority record;
begin
 select * into p from private.agent_site_visit_workflow_proposals where action_id=action and company_id=company and actor_user_id=actor;
 if not found then return false;end if;
 select * into authority from private.resolve_agent_actor_authority(actor,company,array(select jsonb_array_elements_text(p.authority->'permission_keys')));
 ctx:=p.authority||jsonb_build_object('permission_revision',authority.permission_snapshot_revision,'channel','internal','grant',null,'client',null,'grant_revision',null,'scopes',null);
 perform private.agent_site_visit_workflow_authorize(ctx,p.request,true);
 perform private.agent_site_visit_workflow_authorize_evidence(ctx,p.proposal);
 return true;
 exception when insufficient_privilege then return false;
end $$;
create function public.can_read_site_visit_workflow_action(p_action uuid,p_company uuid) returns boolean
language sql volatile security definer set search_path='' as $$ select private.agent_site_visit_workflow_can_read(private.get_current_user_id(),p_company,p_action) $$;
create function public.filter_site_visit_workflow_actions_as_actor(p_actor uuid,p_company uuid,p_actions uuid[]) returns uuid[]
language plpgsql volatile security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' or p_actor is null or p_company is null or p_actions is null or cardinality(p_actions)>500 then raise exception 'SITE_VISIT_ACCESS_DENIED' using errcode='42501';end if;
 return array(select id from unnest(p_actions)id where private.agent_site_visit_workflow_can_read(p_actor,p_company,id));
end $$;
create policy site_visit_action_select on public.agent_actions as restrictive for select to public using(action_type is distinct from 'approve_site_visit_changes' or public.can_read_site_visit_workflow_action(id,company_id));
create policy site_visit_action_insert on public.agent_actions as restrictive for insert to public with check(action_type is distinct from 'approve_site_visit_changes');
create policy site_visit_action_update on public.agent_actions as restrictive for update to public using(action_type is distinct from 'approve_site_visit_changes') with check(action_type is distinct from 'approve_site_visit_changes');
create policy site_visit_action_delete on public.agent_actions as restrictive for delete to public using(action_type is distinct from 'approve_site_visit_changes');
create function public.read_site_visit_workflow_as_system(p_request_id text,p_context jsonb,p_request jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set timezone='UTC' as $$
declare company uuid:=(p_context->>'company')::uuid;actor uuid:=(p_context->>'actor')::uuid;operation text:=p_request->>'operation';revision bigint;
 limit_count integer:=coalesce((p_request->>'limit')::integer,20);items jsonb:='[]';result jsonb;template public.site_visit_types%rowtype;
 visit public.site_visits%rowtype;artifact public.site_visit_artifacts%rowtype;answers jsonb;visible_answers jsonb;data jsonb;photo boolean;deck boolean;authority record;
begin
 if auth.role() is distinct from 'service_role' or coalesce(p_request_id,'')!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then raise exception 'SITE_VISIT_ACCESS_DENIED' using errcode='42501';end if;
 if jsonb_typeof(p_request) is distinct from 'object' or octet_length(p_request::text)>2000 or operation not in('list_templates','get_template','get_form','get_source')
  or p_request-array['operation','template_id','site_visit_id','artifact_id','limit','after_id','expected_source_revision']<>'{}' or limit_count not between 1 and 25 then raise exception 'SITE_VISIT_INPUT_INVALID';end if;
 -- One short snapshot fences source insertions and authorization changes alike.
 perform private.agent_site_visit_workflow_lock(company);
 perform private.agent_site_visit_workflow_authorize(p_context,p_request,false);
 select coalesce(r.revision,0) into revision from private.agent_site_visit_workflow_revisions r where r.company_id=company;revision:=coalesce(revision,0);
 if p_request?'after_id' and (p_request->>'expected_source_revision')::bigint is distinct from revision then raise exception 'SITE_VISIT_READ_STALE';end if;
 if operation='list_templates' then
  select coalesce(jsonb_agg(x.item order by x.id),'[]') into items from(
   select t.id,jsonb_build_object('id',t.id,'name',t.name,'slug',t.slug,'is_default',t.is_default,'revision',coalesce(t.write_revision,0),'field_count',jsonb_array_length(t.fields)) item
   from public.site_visit_types t where t.company_id=company::text and t.deleted_at is null and(p_request->>'after_id' is null or t.id>p_request->>'after_id') order by t.id limit limit_count+1)x;
  result:=jsonb_build_object('items',case when jsonb_array_length(items)>limit_count then items-limit_count else items end,'has_more',jsonb_array_length(items)>limit_count,'next_after_id',case when jsonb_array_length(items)>limit_count then items->(limit_count-1)->>'id' end);
 elsif operation='get_template' then
  select * into template from public.site_visit_types where id=p_request->>'template_id' and company_id=company::text and deleted_at is null;
  if not found then raise exception 'SITE_VISIT_TEMPLATE_NOT_FOUND' using errcode='42501';end if;
  result:=jsonb_build_object('template',private.agent_site_visit_workflow_values('template',to_jsonb(template))||jsonb_build_object('revision',coalesce(template.write_revision,0),'sha256',private.agent_site_visit_workflow_hash(to_jsonb(template))));
 else
  select * into visit from public.site_visits where id=(p_request->>'site_visit_id')::uuid and company_id=company::text and deleted_at is null;
  if not found then raise exception 'SITE_VISIT_NOT_FOUND' using errcode='42501';end if;
  if operation='get_source' then
   select * into artifact from public.site_visit_artifacts where id=(p_request->>'artifact_id')::uuid and site_visit_id=visit.id and company_id=company::text and deleted_at is null;
   if not found then raise exception 'SITE_VISIT_SOURCE_NOT_FOUND' using errcode='42501';end if;
   result:=jsonb_build_object('source',jsonb_build_object('kind','visit_artifact','artifact_id',artifact.id,'artifact_kind',artifact.kind,'text',concat_ws(E'\n',nullif(artifact.title,''),nullif(artifact.body,'')),
    'sha256',private.agent_site_visit_workflow_hash(to_jsonb(artifact)),'deck_design_id',artifact.deck_design_id,'has_remote_asset',coalesce(nullif(btrim(artifact.asset_url),''),nullif(btrim(artifact.rendered_asset_url),'')) is not null));
  else
   select * into authority from private.resolve_agent_actor_authority(actor,company,array(select jsonb_array_elements_text(p_context->'permission_keys')));
   photo:=exists(select 1 from jsonb_array_elements(authority.effective_permissions)p where p->>'permission'='photos.view' and p->>'scope' in('all','assigned')) and(p_context->>'channel'<>'mcp' or p_context->'scopes'?'ops.photos.read');
   deck:=exists(select 1 from jsonb_array_elements(authority.effective_permissions)p where p->>'permission'='deck_builder.view' and p->>'scope' in('all','assigned')) and(p_context->>'channel'<>'mcp' or p_context->'scopes'?'ops.files.read');
   select coalesce(jsonb_agg(to_jsonb(a) order by a.sort_order,a.id),'[]') into answers from public.site_visit_checklist_answers a where a.site_visit_id=visit.id and a.company_id=company::text and a.deleted_at is null;
   if jsonb_array_length(answers)>200 or octet_length(answers::text)>220000 then raise exception 'SITE_VISIT_FORM_TOO_LARGE';end if;
   select coalesce(jsonb_agg((a-array['write_revision','write_base_revision','created_at','updated_at'])||jsonb_build_object('revision',coalesce((a->>'write_revision')::bigint,0))||
    case when(a->>'kind' in('photo','photo_markup') and not photo) or(a->>'kind'='deck_design' and not deck) then '{"answer_value":null,"answer_evidence":null,"redacted":true}'::jsonb
    else jsonb_build_object('redacted',false,'answer_evidence',case when photo and deck then a->'answer_evidence' else null end,'evidence_redacted',not(photo and deck) and a->>'answer_evidence' is not null) end order by(a->>'sort_order')::int,a->>'id'),'[]') into visible_answers from jsonb_array_elements(answers)a;
   select coalesce(jsonb_agg(x.item order by x.id),'[]') into items from(
    select a.id,jsonb_build_object('artifact_id',a.id,'kind',a.kind,'title',a.title,'sha256',private.agent_site_visit_workflow_hash(to_jsonb(a))) item
    from public.site_visit_artifacts a where a.site_visit_id=visit.id and a.company_id=company::text and a.deleted_at is null and
     (a.kind not in('photo','annotated_photo','dimensioned_photo','deck_design') or(a.kind in('photo','annotated_photo','dimensioned_photo') and photo) or(a.kind='deck_design' and deck))
     and(p_request->>'after_id' is null or a.id::text>p_request->>'after_id') order by a.id limit limit_count+1)x;
   result:=jsonb_build_object('site_visit',jsonb_build_object('id',visit.id,'opportunity_id',visit.opportunity_id,'project_id',visit.project_ref,'status',visit.status,'booked_at',visit.booked_at,'scheduled_at',visit.scheduled_at,'duration_minutes',visit.duration_minutes,'assignee_ids',visit.assignee_ids,'reminder_lead_minutes',visit.reminder_lead_minutes,'notes',visit.notes,'sha256',private.agent_site_visit_workflow_hash(to_jsonb(visit))),
    'answers',visible_answers,'missing_required',private.agent_site_visit_workflow_missing(answers),'form_sha256',private.agent_site_visit_workflow_hash(jsonb_build_object('visit',to_jsonb(visit),'answers',answers,'revision',revision)),
    'sources',case when jsonb_array_length(items)>limit_count then items-limit_count else items end,'sources_has_more',jsonb_array_length(items)>limit_count,'next_after_id',case when jsonb_array_length(items)>limit_count then items->(limit_count-1)->>'artifact_id' end);
  end if;
 end if;
 result:=result||jsonb_build_object('request_id',p_request_id,'schema_revision','2026-09-10.v1','source_revision',revision,'content_kind','untrusted_business_data');
 if octet_length(result::text)>240000 then raise exception 'SITE_VISIT_RESULT_TOO_LARGE';end if;
 return result;
end $$;
-- Additional transaction participants are defined before this final privilege fence.
create function public.inspect_site_visit_workflow_as_system(p_request_id text,p_context jsonb,p_request jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set timezone='UTC' as $$
declare result jsonb;begin
 if auth.role() is distinct from 'service_role' or coalesce(p_request_id,'')!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then raise exception 'SITE_VISIT_ACCESS_DENIED' using errcode='42501';end if;
 perform private.agent_site_visit_workflow_lock((p_context->>'company')::uuid);
 perform private.agent_site_visit_workflow_authorize(p_context,p_request,true);
 result:=private.agent_site_visit_workflow_compile((p_context->>'actor')::uuid,(p_context->>'company')::uuid,p_request,extensions.gen_random_uuid());
 return jsonb_build_object('request_id',p_request_id,'schema_revision','2026-09-10.v1','proposal',result,'content_kind','untrusted_business_data');
end $$;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='private' and (p.proname like 'agent_site_visit_workflow_%' or p.proname='bump_agent_site_visit_workflow_revision'))
 or(n.nspname='public' and p.proname in('prepare_site_visit_workflow_as_system','commit_site_visit_workflow_as_actor','reject_site_visit_workflow_as_actor','read_site_visit_workflow_as_system','inspect_site_visit_workflow_as_system','can_read_site_visit_workflow_action','filter_site_visit_workflow_actions_as_actor')) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end $$;
grant execute on function public.prepare_site_visit_workflow_as_system(text,jsonb,jsonb),public.commit_site_visit_workflow_as_actor(uuid,uuid,uuid,uuid,text,text),public.reject_site_visit_workflow_as_actor(uuid,uuid,uuid) to service_role;
grant execute on function public.read_site_visit_workflow_as_system(text,jsonb,jsonb),public.filter_site_visit_workflow_actions_as_actor(uuid,uuid,uuid[]) to service_role;
grant execute on function public.inspect_site_visit_workflow_as_system(text,jsonb,jsonb) to service_role;
grant execute on function public.can_read_site_visit_workflow_action(uuid,uuid) to anon,authenticated,service_role;
commit;
