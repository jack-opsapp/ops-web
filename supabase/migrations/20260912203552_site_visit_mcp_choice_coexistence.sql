-- MCP coexistence with the separately installed phone choice extension.
-- Preserve frozen inputs, actor authority, approval binding, receipts and ACLs.
-- No company enrollment, effect reseal, OAuth grant or provider effect.
begin;
do $$begin
 if to_regprocedure('private.site_visit_choice_value_valid(jsonb,jsonb)') is null
  or to_regprocedure('private.apply_site_visit_rows_v2(uuid,text,text,jsonb)') is null
  or to_regprocedure('private.agent_site_visit_workflow_compile(uuid,uuid,jsonb,uuid)') is null
  or to_regprocedure('private.agent_site_visit_workflow_apply(uuid,uuid,jsonb)') is null
  or not exists(select 1 from pg_attribute where attrelid='public.site_visit_checklist_answers'::regclass
    and attname='choice_snapshot' and atttypid='jsonb'::regtype and not attisdropped) then
  raise exception 'Install the reviewed phone choice migration first';end if;
end $$;

create or replace function private.agent_site_visit_workflow_compile(p_actor uuid,p_company uuid,req jsonb,seed uuid) returns jsonb
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
   -- The frozen MCP template input cannot represent choice metadata. Reject
   -- edits here, before creating an approval that the phone guard cannot save.
   if exists(select 1 from jsonb_array_elements(template.fields)f where f?'singleChoice') then
    raise exception 'SITE_VISIT_TEMPLATE_UNSUPPORTED';end if;
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
     -- A quote is evidence, not permission to invent a choice outside the
     -- visit's immutable snapshot. Keep the exact stored label comparison.
     if private.site_visit_choice_value_valid(to_jsonb(answer)->'choice_snapshot',after_value) is not true then
      raise exception 'SITE_VISIT_ANSWER_INVALID';end if;
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

create or replace function private.agent_site_visit_workflow_apply(company uuid,actor uuid,p jsonb) returns jsonb
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
  if p->>'entity'='template' and exists(select 1 from jsonb_array_elements(p->'rows')row_value,
    jsonb_array_elements(row_value->'values'->'fields')field where field?'singleChoice') then
   -- Only a collateral default toggle may carry choice fields through this
   -- frozen MCP contract. No choice authoring, conversion or metadata edits.
   -- Match the row writer's lock order before comparing the actual saved row.
   perform pg_advisory_xact_lock(hashtextextended('site-visit-writes:'||company::text,0));
   perform 1 from public.site_visit_types where company_id=company::text order by id for update;
   for r in select row_value from jsonb_array_elements(p->'rows')row_value
     where exists(select 1 from jsonb_array_elements(row_value->'values'->'fields')field where field?'singleChoice') loop
    select to_jsonb(t) into readback from public.site_visit_types t where t.id=r->>'id' and t.company_id=company::text;
    if readback is null or r->>'id' is not distinct from p->>'template_id' or readback->>'is_default' is distinct from 'true'
     or r->'values' is distinct from (private.agent_site_visit_workflow_values('template',readback)||'{"is_default":false}'::jsonb) then
     raise exception 'SITE_VISIT_TEMPLATE_UNSUPPORTED';end if;
   end loop;
   result:=private.apply_site_visit_rows_v2(actor,company::text,'template',p->'rows');
  else
   result:=private.apply_site_visit_rows(actor,company::text,p->>'entity',p->'rows');
  end if;
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

commit;
