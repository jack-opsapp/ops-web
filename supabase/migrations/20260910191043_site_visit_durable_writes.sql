-- Explicit actor authority shared by phone and exact-approved MCP transactions.
create function private.actor_can_edit_site_visit(p_actor uuid,p_company text,p_opportunity uuid,p_project_id text,p_project_ref uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare project uuid:=coalesce(p_project_ref,private.try_parse_uuid(p_project_id));
begin
  if not exists(select 1 from public.users u join public.companies c on c.id=u.company_id and c.deleted_at is null where u.id=p_actor and u.company_id::text=p_company and u.deleted_at is null and coalesce(u.is_active,false)) then return false;end if;
  if p_opportunity is not null and (p_project_id is not null or p_project_ref is not null) and
    (project is null or (p_project_id is not null and p_project_ref is not null and private.try_parse_uuid(p_project_id) is distinct from p_project_ref)
     or not private.opportunity_project_relationship_is_valid(private.try_parse_uuid(p_company),p_opportunity,project)) then return false;end if;
  if p_opportunity is null and project is null then return true;end if;
  return coalesce((p_opportunity is not null and private.user_can_edit_opportunity(p_actor,p_opportunity)) or
    (project is not null and private.user_can_view_project(p_actor,project) and private.user_can_edit_project(p_actor,project)),false);
end $$;
revoke all on function private.actor_can_edit_site_visit(uuid,text,uuid,text,uuid) from public,anon,authenticated,service_role;

-- Shared, immutable phone commands. Candidate MCP commits use the same private
-- row primitive only after their own exact transaction approval/reauthorization.
-- No company activation, public MCP exposure or live grants are introduced.
create table private.site_visit_write_receipts (
  command_id uuid primary key,
  actor_id uuid not null,
  company_id text not null,
  request jsonb not null check(octet_length(request::text)<=262144),
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table private.site_visit_write_receipts enable row level security;
revoke all on private.site_visit_write_receipts from public,anon,authenticated,service_role;
create index site_visit_write_receipts_company on private.site_visit_write_receipts(company_id,created_at);

create function private.site_visit_fields_strict(p_fields jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare f jsonb; n integer;
begin
  if jsonb_typeof(p_fields) is distinct from 'array' or octet_length(p_fields::text)>131072 then return false;end if;
  n:=jsonb_array_length(p_fields);
  if n not between 1 and 100 then return false;end if;
  if (select count(distinct x->>'id') from jsonb_array_elements(p_fields)x)<>n then return false;end if;
  if not exists(select 1 from jsonb_array_elements(p_fields)x where coalesce(x->'isVisible','true'::jsonb)='true') then return false;end if;
  for f in select * from jsonb_array_elements(p_fields) loop
    if jsonb_typeof(f) is distinct from 'object' or
      not(f ?& array['id','label','kind','required','sortOrder']) or
      f-array['id','label','kind','required','sortOrder','isVisible','helpText']<>'{}' then return false;end if;
    if jsonb_typeof(f->'id') is distinct from 'string' or length(btrim(f->>'id')) not between 1 and 256 or
      jsonb_typeof(f->'label') is distinct from 'string' or length(btrim(f->>'label')) not between 1 and 500 or
      jsonb_typeof(f->'required') is distinct from 'boolean' or
      (f->>'kind') not in ('checkbox','yes_no_na','short_text','long_text','measurement','photo','photo_markup','deck_design') or
      jsonb_typeof(f->'kind') is distinct from 'string' or
      jsonb_typeof(f->'sortOrder') is distinct from 'number' or
      (f->>'sortOrder')!~'^[0-9]{1,6}$' or (f->>'sortOrder')::integer>100000 or
      (f?'isVisible' and jsonb_typeof(f->'isVisible') is distinct from 'boolean') or
      (f?'helpText' and f->'helpText'<>'null' and
        (jsonb_typeof(f->'helpText') is distinct from 'string' or length(f->>'helpText')>2000)) then return false;end if;
  end loop;
  return true;
end $$;

create function private.site_visit_normalized_value(v jsonb) returns jsonb
language sql immutable set search_path='' as $$select case when v->'artifactIds'='[]' then v-'artifactIds' else v end$$;
revoke all on function private.site_visit_normalized_value(jsonb) from public,anon,authenticated,service_role;

create function private.site_visit_value_valid(p_kind text,p_value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare v jsonb:=p_value;
begin
  if jsonb_typeof(v) is distinct from 'object' or octet_length(v::text)>220000 then return false;end if;
  if v->'artifactIds'='[]' then v:=v-'artifactIds';end if;
  if v='{}' then return true;end if;
  if (select count(*) from jsonb_object_keys(v))<>1 then return false;end if;
  return coalesce(case p_kind
    when 'checkbox' then jsonb_typeof(v->'boolValue')='boolean'
    when 'yes_no_na' then v->>'choice' in ('YES','NO','N/A')
    when 'short_text' then jsonb_typeof(v->'text')='string' and length(v->>'text')<=2000
    when 'long_text' then jsonb_typeof(v->'text')='string' and length(v->>'text')<=200000
    when 'measurement' then jsonb_typeof(v->'text')='string' and length(v->>'text')<=200000
    when 'deck_design' then jsonb_typeof(v->'deckDesignId')='string' and (v->>'deckDesignId')~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    when 'photo' then private.site_visit_artifact_ids_valid(v->'artifactIds')
    when 'photo_markup' then private.site_visit_artifact_ids_valid(v->'artifactIds')
    else false end,false);
end $$;

create function private.site_visit_artifact_ids_valid(p_ids jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
begin
  if jsonb_typeof(p_ids) is distinct from 'array' then return false;end if;
  return jsonb_array_length(p_ids) between 1 and 100 and
    (select count(distinct v)=count(*) and bool_and(jsonb_typeof(v)='string' and
      (v#>>'{}')~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') from jsonb_array_elements(p_ids)v);
end $$;

-- Caller must hold current authority and its exact approval. No SQL execution
-- role has EXECUTE on this private primitive. Row and graph validation is shared.
create function private.apply_site_visit_rows(p_actor uuid,p_company text,p_entity text,p_rows jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  r jsonb;v jsonb;current_row jsonb;result_rows jsonb:='[]';visit public.site_visits%rowtype;
  answer public.site_visit_checklist_answers%rowtype;template public.site_visit_types%rowtype;
  row_count integer;id_text text;next_state text;next_evidence jsonb;
begin
  if p_actor is null or p_company is null or (p_entity is null or p_entity not in ('answer','template')) or
    jsonb_typeof(p_rows) is distinct from 'array' or octet_length(p_rows::text)>240000 then
    raise exception 'SITE_VISIT_COMMAND_INVALID' using errcode='22023';end if;
  row_count:=jsonb_array_length(p_rows);
  if row_count not between 1 and 100 or
    (select count(distinct item->>'id') from jsonb_array_elements(p_rows)item)<>row_count then
    raise exception 'SITE_VISIT_COMMAND_INVALID' using errcode='22023';end if;
  -- Company graph lock also covers template inserts/default phantoms. Legacy
  -- writers take this lock in the trigger once compatibility is activated.
  perform pg_advisory_xact_lock(hashtextextended('site-visit-writes:'||p_company,0));
  if not exists(select 1 from public.users u join public.companies c on c.id=u.company_id and c.deleted_at is null where u.id=p_actor and u.company_id::text=p_company and u.deleted_at is null and coalesce(u.is_active,false)) then
    raise exception 'SITE_VISIT_AUTHORITY_DENIED' using errcode='42501';end if;
  if p_entity='template' then
    if not public.has_permission(p_actor,'settings.company','own') then raise exception 'SITE_VISIT_AUTHORITY_DENIED' using errcode='42501';end if;
    perform 1 from public.site_visit_types where company_id=p_company order by id for update;
    if not public.has_permission(p_actor,'settings.company','own') then raise exception 'SITE_VISIT_AUTHORITY_DENIED' using errcode='42501';end if;
  end if;
  if p_entity='answer' and exists(select 1 from jsonb_array_elements(p_rows)x
      where x->'values'->>'deleted_at' is null group by x->'values'->>'site_visit_id',x->'values'->>'field_id' having count(*)>1) then
    raise exception 'SITE_VISIT_DUPLICATE_FIELD' using errcode='22023';end if;
  -- Validate the entire write set before changing any row. Locks remain held.
  for r in select * from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r) is distinct from 'object' or not(r?&array['id','base_revision','values']) or
       r-array['id','base_revision','values','before']<>'{}' or
       jsonb_typeof(r->'base_revision') is distinct from 'number' or (r->>'base_revision')!~'^[0-9]{1,15}$' then
      raise exception 'SITE_VISIT_COMMAND_INVALID' using errcode='22023';end if;
    v:=r->'values';id_text:=r->>'id';current_row:=null;
    if jsonb_typeof(v) is distinct from 'object' or v->>'company_id' is distinct from p_company or
       v->>'id' is distinct from id_text then raise exception 'SITE_VISIT_COMPANY_MISMATCH' using errcode='42501';end if;
    if p_entity='answer' then
      select * into visit from public.site_visits where id=(v->>'site_visit_id')::uuid for update;
      if not found or visit.company_id<>p_company then raise exception 'SITE_VISIT_PARENT_INVALID' using errcode='42501';end if;
      if not private.actor_can_edit_site_visit(p_actor,p_company,visit.opportunity_id,visit.project_id,visit.project_ref) then
        raise exception 'SITE_VISIT_AUTHORITY_DENIED' using errcode='42501';end if;
      select * into answer from public.site_visit_checklist_answers where id=id_text::uuid for update;
      if found then current_row:=to_jsonb(answer);end if;
      if current_row is not null and (answer.company_id<>p_company or answer.site_visit_id<>visit.id) then
        raise exception 'SITE_VISIT_COMPANY_MISMATCH' using errcode='42501';end if;
      if visit.deleted_at is not null or visit.status in ('completed','cancelled') then
        return jsonb_build_object('outcome','conflict','reason','capture_closed','rows',coalesce(jsonb_build_array(current_row),'[]'::jsonb));end if;
      if not private.site_visit_value_valid(v->>'kind',v->'answer_value') then
        raise exception 'SITE_VISIT_ANSWER_INVALID' using errcode='22023';end if;
      if v-array['id','company_id','site_visit_id','site_visit_type_id','field_id','label','kind','required','help_text','sort_order','answer_value','answer_state','answer_evidence','deleted_at']<>'{}' then
        raise exception 'SITE_VISIT_ANSWER_INVALID' using errcode='22023';end if;
      if (v?'answer_state' and v->'answer_state'<>'null' and (v->>'answer_state' not in ('answered','unknown','cleared') or jsonb_typeof(v->'answer_state')<>'string')) or
         (v?'answer_evidence' and v->'answer_evidence'<>'null' and (jsonb_typeof(v->'answer_evidence')<>'object' or octet_length((v->'answer_evidence')::text)>131072)) or
         (v->>'answer_state' in ('unknown','cleared') and v->'answer_value' not in ('{}','{"artifactIds":[]}')) then
        raise exception 'SITE_VISIT_EVIDENCE_INVALID' using errcode='22023';end if;
      perform 1 from public.site_visit_artifacts a where a.site_visit_id=visit.id and a.company_id=p_company
        and (a.id::text in(select jsonb_array_elements_text(coalesce(v->'answer_value'->'artifactIds','[]')))
             or a.deck_design_id::text=v->'answer_value'->>'deckDesignId') order by a.id for share;
      perform 1 from public.deck_designs d where d.id::text=v->'answer_value'->>'deckDesignId' for share;
      -- The selected artifact is evidence only if it exists on this exact visit.
      if exists(select 1 from jsonb_array_elements_text(coalesce(v->'answer_value'->'artifactIds','[]')) artifact_id
        where not exists(select 1 from public.site_visit_artifacts a where a.id=artifact_id::uuid and a.company_id=p_company
          and a.site_visit_id=visit.id and a.deleted_at is null and ((v->>'kind'='photo' and a.kind in ('photo','annotated_photo','dimensioned_photo'))
            or (v->>'kind'='photo_markup' and a.kind in ('annotated_photo','dimensioned_photo')))
          and coalesce(nullif(btrim(a.asset_url),''),nullif(btrim(a.rendered_asset_url),'')) is not null)) then
        raise exception 'SITE_VISIT_ARTIFACT_INVALID' using errcode='42501';end if;
      if v->'answer_value'->>'deckDesignId' is not null and not exists(
        select 1 from public.deck_designs d join public.site_visit_artifacts a on a.deck_design_id=d.id
        where d.id=(v->'answer_value'->>'deckDesignId')::uuid and d.company_id::text=p_company and d.deleted_at is null
          and a.company_id=p_company and a.site_visit_id=visit.id and a.deleted_at is null and a.kind='deck_design') then
        raise exception 'SITE_VISIT_DECK_INVALID' using errcode='42501';end if;
      if current_row is not null and
        (select bool_or(current_row->k is distinct from v->k) from unnest(array['site_visit_type_id','field_id','label','kind','required','help_text','sort_order'])k) then
        return jsonb_build_object('outcome','conflict','reason','snapshot_changed','rows',jsonb_build_array(current_row));end if;
      if current_row is null and exists(select 1 from public.site_visit_checklist_answers a
        where a.site_visit_id=visit.id and a.field_id=v->>'field_id' and a.deleted_at is null) then
        return jsonb_build_object('outcome','conflict','reason','field_exists','rows',
          (select jsonb_agg(to_jsonb(a)) from public.site_visit_checklist_answers a where a.site_visit_id=visit.id and a.field_id=v->>'field_id' and a.deleted_at is null));end if;
      if current_row is null and not private.site_visit_fields_strict(jsonb_build_array(jsonb_build_object(
        'id',v->'field_id','label',v->'label','kind',v->'kind','required',v->'required','sortOrder',v->'sort_order','helpText',v->'help_text'))) then
        raise exception 'SITE_VISIT_SNAPSHOT_INVALID' using errcode='22023';end if;
      if v->>'site_visit_type_id' is not null and not exists(select 1 from public.site_visit_types
        where id=v->>'site_visit_type_id' and company_id=p_company) then
        raise exception 'SITE_VISIT_TEMPLATE_MISMATCH' using errcode='42501';end if;
    else
      select * into template from public.site_visit_types where id=id_text for update;
      if found then current_row:=to_jsonb(template);end if;
      if current_row is not null and template.company_id<>p_company then raise exception 'SITE_VISIT_COMPANY_MISMATCH' using errcode='42501';end if;
      if not private.site_visit_fields_strict(v->'fields') or
        jsonb_typeof(v->'name') is distinct from 'string' or length(btrim(v->>'name')) not between 1 and 120 or
        jsonb_typeof(v->'slug') is distinct from 'string' or length(v->>'slug') not between 1 and 128 or
        jsonb_typeof(v->'is_default') is distinct from 'boolean' or
        jsonb_typeof(v->'is_system_template') is distinct from 'boolean' or
        jsonb_typeof(v->'sort_order') is distinct from 'number' or (v->>'sort_order')!~'^[0-9]{1,6}$' or
        (v->>'sort_order')::integer>100000 or
        (v->'description_text'<>'null' and (jsonb_typeof(v->'description_text') is distinct from 'string' or length(v->>'description_text')>500)) or
        v-array['id','company_id','slug','name','description_text','is_default','is_system_template','sort_order','fields','deleted_at']<>'{}' then
        raise exception 'SITE_VISIT_TEMPLATE_INVALID' using errcode='22023';end if;
      if current_row is not null and template.is_system_template is distinct from (v->>'is_system_template')::boolean then
        raise exception 'SITE_VISIT_SYSTEM_IDENTITY_IMMUTABLE' using errcode='22023';end if;
    end if;
    if (current_row is null and (r->>'base_revision')::bigint<>0) or
       (current_row is not null and (r->>'base_revision')::bigint<>coalesce((current_row->>'write_revision')::bigint,0)) then
      return jsonb_build_object('outcome','conflict','reason','stale_edit','rows',case when current_row is null then '[]'::jsonb else jsonb_build_array(current_row) end);
    end if;
  end loop;
  -- Separate INSERT and UPDATE deliberately: BEFORE INSERT runs even for an
  -- ON CONFLICT UPDATE, so an upsert cannot safely carry the original CAS base.
  begin
    for r in select x from jsonb_array_elements(p_rows)x order by coalesce((x->'values'->>'is_default')::boolean,false),x->>'id' loop
      v:=r->'values';id_text:=r->>'id';
      insert into private.site_visit_write_tokens(transaction_id,backend_pid,entity,row_id)
        values(txid_current(),pg_backend_pid(),case when p_entity='answer' then 'site_visit_checklist_answers' else 'site_visit_types' end,id_text);
      if p_entity='answer' then
        if exists(select 1 from public.site_visit_checklist_answers where id=id_text::uuid) then
          update public.site_visit_checklist_answers set answer_value=case when private.site_visit_normalized_value(answer_value)=private.site_visit_normalized_value(v->'answer_value') then answer_value else v->'answer_value' end,
            answer_state=case when v?'answer_state' then v->>'answer_state' when private.site_visit_normalized_value(answer_value)=private.site_visit_normalized_value(v->'answer_value') then answer_state when v->'answer_value' in ('{}'::jsonb,'{"artifactIds":[]}'::jsonb) then 'cleared' else 'answered' end,
            answer_evidence=case when v?'answer_evidence' then nullif(v->'answer_evidence','null') when private.site_visit_normalized_value(answer_value)=private.site_visit_normalized_value(v->'answer_value') then answer_evidence else null end,deleted_at=(v->>'deleted_at')::timestamptz,
            write_base_revision=(r->>'base_revision')::bigint where id=id_text::uuid;
        else
          select * into visit from public.site_visits where id=(v->>'site_visit_id')::uuid;
          insert into public.site_visit_checklist_answers(id,site_visit_id,company_id,opportunity_id,site_visit_type_id,
            field_id,label,kind,required,help_text,sort_order,answer_value,created_by,deleted_at,write_base_revision,answer_state,answer_evidence)
          values(id_text::uuid,visit.id,p_company,visit.opportunity_id,v->>'site_visit_type_id',v->>'field_id',v->>'label',v->>'kind',
            (v->>'required')::boolean,v->>'help_text',(v->>'sort_order')::integer,v->'answer_value',p_actor::text,(v->>'deleted_at')::timestamptz,0,case when v?'answer_state' then v->>'answer_state' when v->'answer_value' in ('{}','{"artifactIds":[]}') then null else 'answered' end,nullif(v->'answer_evidence','null'));
        end if;
        select to_jsonb(a) into current_row from public.site_visit_checklist_answers a where id=id_text::uuid;
      else
        if exists(select 1 from public.site_visit_types where id=id_text) then
          update public.site_visit_types set slug=v->>'slug',name=v->>'name',description_text=v->>'description_text',
            is_default=(v->>'is_default')::boolean,sort_order=(v->>'sort_order')::integer,fields=v->'fields',
            deleted_at=(v->>'deleted_at')::timestamptz,write_base_revision=(r->>'base_revision')::bigint where id=id_text;
        else
          insert into public.site_visit_types(id,company_id,slug,name,description_text,is_system_template,is_default,sort_order,fields,deleted_at,write_base_revision)
          values(id_text,p_company,v->>'slug',v->>'name',v->>'description_text',(v->>'is_system_template')::boolean,
            (v->>'is_default')::boolean,(v->>'sort_order')::integer,v->'fields',(v->>'deleted_at')::timestamptz,0);
        end if;
        select to_jsonb(t) into current_row from public.site_visit_types t where id=id_text;
      end if;
      result_rows:=result_rows||jsonb_build_array(current_row);
    end loop;
  exception when unique_violation then
    return jsonb_build_object('outcome','conflict','reason','identity_or_default_changed','rows',
      case when p_entity='template' then coalesce((select jsonb_agg(to_jsonb(t)) from public.site_visit_types t where company_id=p_company and (is_default or id in(select x->>'id' from jsonb_array_elements(p_rows)x) or slug in(select x->'values'->>'slug' from jsonb_array_elements(p_rows)x))),'[]'::jsonb) else '[]'::jsonb end);
  end;
  return jsonb_build_object('outcome','saved','rows',result_rows);
end $$;

-- Phone intent is not host provenance. Only an explicit empty clear can
-- request cleared; untouched empty inserts retain NULL (unanswered).
create function private.site_visit_phone_rows(p_entity text,p_rows jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare r jsonb;result jsonb:='[]';
begin
 if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'SITE_VISIT_COMMAND_INVALID' using errcode='22023';end if;
 for r in select * from jsonb_array_elements(p_rows) loop
  if r?'clear_answer' then
   if p_entity<>'answer' or r->'clear_answer' is distinct from 'true'::jsonb or
      r->'values'->'answer_value' not in ('{}'::jsonb,'{"artifactIds":[]}'::jsonb) or
      r->'values'->'answer_value' is null then
    raise exception 'SITE_VISIT_CLEAR_INVALID' using errcode='22023';end if;
  end if;
  if p_entity='answer' and r->'values' ?| array['answer_state','answer_evidence'] then
   raise exception 'SITE_VISIT_PHONE_PROVENANCE_FORBIDDEN' using errcode='22023';end if;
  if r->'clear_answer'='true'::jsonb then
   r:=(r-'clear_answer')||jsonb_build_object('values',(r->'values')||'{"answer_state":"cleared"}'::jsonb);
  end if;
  result:=result||jsonb_build_array(r);
 end loop;
 return result;
end$$;
revoke all on function private.site_visit_phone_rows(text,jsonb) from public,anon,authenticated,service_role;

create function public.apply_site_visit_write(p_command_id uuid,p_command jsonb,p_expected_actor uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor_id uuid:=private.get_current_user_id();company text:=private.get_user_company_id()::text;
  prior private.site_visit_write_receipts%rowtype;r jsonb;result jsonb;entity text:=p_command->>'entity';
begin
  if actor_id is null or actor_id is distinct from p_expected_actor or company is null or company is distinct from p_command->>'company_id' then
    raise exception 'SITE_VISIT_AUTHORITY_DENIED' using errcode='42501';end if;
  if p_command_id is null or p_command->>'protocol' is distinct from 'site-visit-writes:2026-09-10.v1' or
    p_command-array['protocol','company_id','entity','rows']<>'{}' or octet_length(p_command::text)>262144 or
    jsonb_typeof(p_command->'rows') is distinct from 'array' then raise exception 'SITE_VISIT_COMMAND_INVALID' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('site-visit-writes:'||company,0));
  if not exists(select 1 from public.users where id=actor_id and company_id::text=company and deleted_at is null and coalesce(is_active,false)) then
    raise exception 'SITE_VISIT_AUTHORITY_DENIED' using errcode='42501';end if;
  -- Authority is rechecked after graph locks, before replay as well as first attempt.
  if entity='template' then
    if not private.current_user_has_permission('settings.company','own') then raise exception 'SITE_VISIT_AUTHORITY_DENIED' using errcode='42501';end if;
  elsif entity='answer' then
    for r in select * from jsonb_array_elements(p_command->'rows') loop
      if r->'values' ?| array['answer_state','answer_evidence'] then raise exception 'SITE_VISIT_PHONE_PROVENANCE_FORBIDDEN' using errcode='22023';end if;
      perform 1 from public.site_visits where id=(r->'values'->>'site_visit_id')::uuid for update;
      if not private.current_user_can_access_site_visit_child((r->'values'->>'site_visit_id')::uuid,company,true) then
        raise exception 'SITE_VISIT_AUTHORITY_DENIED' using errcode='42501';end if;
    end loop;
  else raise exception 'SITE_VISIT_COMMAND_INVALID' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_command_id::text,19));
  select * into prior from private.site_visit_write_receipts where command_id=p_command_id for update;
  if found then
    if prior.actor_id<>actor_id or prior.company_id<>company or prior.request<>p_command then
      raise exception 'SITE_VISIT_IDEMPOTENCY_CONFLICT' using errcode='22023';end if;
    if exists(select 1 from private.site_visit_write_resolutions where original_id=p_command_id) then
      return jsonb_build_object('command_id',p_command_id,'entity',entity,'outcome','superseded','rows',
        (select resolution.result->'rows' from private.site_visit_write_resolutions resolution where resolution.original_id=p_command_id));
    end if;
    return prior.result;
  end if;
  result:=private.apply_site_visit_rows(actor_id,company,entity,private.site_visit_phone_rows(entity,p_command->'rows'))||jsonb_build_object('command_id',p_command_id,'entity',entity);
  insert into private.site_visit_write_receipts(command_id,actor_id,company_id,request,result)
    values(p_command_id,actor_id,company,p_command,result);
  return result;
end $$;
revoke all on function private.site_visit_fields_strict(jsonb),private.site_visit_value_valid(text,jsonb),
  private.site_visit_artifact_ids_valid(jsonb),private.apply_site_visit_rows(uuid,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.apply_site_visit_write(uuid,jsonb,uuid) from public,anon,authenticated,service_role;
-- Firebase sessions use the anon database role with a verified JWT. The wrapper
-- resolves that JWT through OPS's existing user/permission functions.
grant execute on function public.apply_site_visit_write(uuid,jsonb,uuid) to anon,authenticated;

-- Capture owns content and its start intent. Existing appointment scheduling,
-- calendar linkage and completion are owned by their canonical commands.
create function public.save_site_visit_capture(p_capture jsonb,p_expected_actor uuid) returns public.site_visits
language plpgsql volatile security definer set search_path='' as $$
declare actor_id uuid:=private.get_current_user_id();company text:=private.get_user_company_id()::text;
  proposed public.site_visits%rowtype;current_visit public.site_visits%rowtype;saved public.site_visits%rowtype;
begin
  if actor_id is null or actor_id is distinct from p_expected_actor or company is null or p_capture->>'company_id' is distinct from company or
    jsonb_typeof(p_capture) is distinct from 'object' or octet_length(p_capture::text)>1048576 then
    raise exception 'SITE_VISIT_AUTHORITY_DENIED' using errcode='42501';end if;
  proposed:=jsonb_populate_record(null::public.site_visits,p_capture);
  if proposed.id is null or proposed.status not in ('scheduled','in_progress') or proposed.completed_at is not null then
    raise exception 'SITE_VISIT_CAPTURE_COMMAND_INVALID' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('site-visit-capture:'||proposed.id::text,0));
  select * into current_visit from public.site_visits where id=proposed.id for update;
  if found then
    if current_visit.company_id<>company or not private.actor_can_edit_site_visit(actor_id,company,current_visit.opportunity_id,current_visit.project_id,current_visit.project_ref) then
      raise exception 'SITE_VISIT_AUTHORITY_DENIED' using errcode='42501';end if;
    if current_visit.deleted_at is not null or current_visit.status in ('completed','cancelled') then raise exception 'SITE_VISIT_CAPTURE_CLOSED' using errcode='55000';end if;
    if not private.actor_can_edit_site_visit(actor_id,company,proposed.opportunity_id,proposed.project_id,proposed.project_ref) then
      raise exception 'SITE_VISIT_AUTHORITY_DENIED' using errcode='42501';end if;
    update public.site_visits set opportunity_id=proposed.opportunity_id,project_id=proposed.project_id,project_ref=proposed.project_ref,
      client_id=proposed.client_id,client_ref=proposed.client_ref,notes=proposed.notes,internal_notes=proposed.internal_notes,
      measurements=proposed.measurements,photos=coalesce(proposed.photos,'{}'::text[]),
      status=case when current_visit.status='in_progress' then current_visit.status else proposed.status end,
      deleted_at=proposed.deleted_at
      where id=proposed.id returning * into saved;
  else
    if not private.actor_can_edit_site_visit(actor_id,company,proposed.opportunity_id,proposed.project_id,proposed.project_ref) then
      raise exception 'SITE_VISIT_AUTHORITY_DENIED' using errcode='42501';end if;
    insert into public.site_visits(id,company_id,opportunity_id,project_id,project_ref,client_id,client_ref,scheduled_at,duration_minutes,
      assignee_ids,status,notes,internal_notes,measurements,photos,created_by,created_at,deleted_at)
    values(proposed.id,company,proposed.opportunity_id,proposed.project_id,proposed.project_ref,proposed.client_id,proposed.client_ref,
      proposed.scheduled_at,coalesce(proposed.duration_minutes,60),coalesce(proposed.assignee_ids,array[actor_id::text]),
      proposed.status,proposed.notes,proposed.internal_notes,proposed.measurements,coalesce(proposed.photos,'{}'::text[]),
      actor_id::text,coalesce(proposed.created_at,clock_timestamp()),proposed.deleted_at) returning * into saved;
  end if;
  return saved;
end $$;
revoke all on function public.save_site_visit_capture(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.save_site_visit_capture(jsonb,uuid) to anon,authenticated;

-- Explicit review is itself an immutable, replayable command. A cancellation is
-- a server fact before any response is sent; the old HTTP request cannot race it.
create table private.site_visit_write_resolutions (
  original_id uuid primary key,
  resolution_id uuid not null unique,
  actor_id uuid not null,
  company_id text not null,
  request jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table private.site_visit_write_resolutions enable row level security;
revoke all on private.site_visit_write_resolutions from public,anon,authenticated,service_role;

create function private.site_visit_review_rows(p_actor uuid,p_company text,p_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare r jsonb; v jsonb; visit public.site_visits%rowtype; result jsonb:='[]';
begin
  if p_command->>'company_id' is distinct from p_company or p_command->>'protocol' is distinct from 'site-visit-writes:2026-09-10.v1'
    or jsonb_typeof(p_command->'rows') is distinct from 'array' or jsonb_array_length(p_command->'rows') not between 1 and 100
    or octet_length(p_command::text)>262144 or not exists(select 1 from public.users u join public.companies c on c.id=u.company_id and c.deleted_at is null where u.id=p_actor and u.company_id::text=p_company and u.deleted_at is null and coalesce(u.is_active,false)) then
    raise exception 'SITE_VISIT_AUTHORITY_DENIED' using errcode='42501';end if;
  perform private.site_visit_phone_rows(p_command->>'entity',p_command->'rows');
  perform pg_advisory_xact_lock(hashtextextended('site-visit-writes:'||p_company,0));
  if p_command->>'entity'='template' then
    if not public.has_permission(p_actor,'settings.company','own') then raise exception 'SITE_VISIT_AUTHORITY_DENIED' using errcode='42501';end if;
    perform 1 from public.site_visit_types where company_id=p_company order by id for update;
    select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') into result from public.site_visit_types t where company_id=p_company;
  elsif p_command->>'entity'='answer' then
    for r in select * from jsonb_array_elements(p_command->'rows') loop
      v:=r->'values';
      if v->>'company_id' is distinct from p_company or v ?| array['answer_state','answer_evidence'] then raise exception 'SITE_VISIT_AUTHORITY_DENIED' using errcode='42501';end if;
      select * into visit from public.site_visits where id=(v->>'site_visit_id')::uuid for update;
      if not found or visit.company_id<>p_company or not private.actor_can_edit_site_visit(p_actor,p_company,visit.opportunity_id,visit.project_id,visit.project_ref) then
        raise exception 'SITE_VISIT_AUTHORITY_DENIED' using errcode='42501';end if;
      -- Include logical collisions; review can explicitly reconcile identity.
      result:=result||coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.site_visit_checklist_answers a
        where a.company_id=p_company and a.site_visit_id=visit.id and (a.id=(r->>'id')::uuid or (a.field_id=v->>'field_id' and a.deleted_at is null))),'[]');
    end loop;
    select coalesce(jsonb_agg(x order by x->>'id'),'[]') into result from (select distinct value x from jsonb_array_elements(result))q;
  else raise exception 'SITE_VISIT_COMMAND_INVALID' using errcode='22023';end if;
  return result;
end $$;

create function public.review_site_visit_write(p_command jsonb,p_expected_actor uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
  if p_expected_actor is null or p_expected_actor is distinct from private.get_current_user_id() then
    raise exception 'SITE_VISIT_AUTHORITY_DENIED' using errcode='42501';end if;
  return jsonb_build_object('rows',private.site_visit_review_rows(private.get_current_user_id(),private.get_user_company_id()::text,p_command));
end $$;

create function public.resolve_site_visit_write(p_resolution_id uuid,p_original_id uuid,p_command jsonb,p_choice text,p_current jsonb,p_expected_actor uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=private.get_current_user_id();company text:=private.get_user_company_id()::text;
  current_rows jsonb; request jsonb; prior private.site_visit_write_resolutions%rowtype;
  original private.site_visit_write_receipts%rowtype; r jsonb; current_row jsonb; values jsonb; writes jsonb:='[]'; result jsonb;
begin
  if actor is null or actor is distinct from p_expected_actor then
    raise exception 'SITE_VISIT_AUTHORITY_DENIED' using errcode='42501';end if;
  if p_resolution_id is null or p_original_id is null or p_resolution_id=p_original_id or p_choice not in ('current','pending') or p_choice is null then
    raise exception 'SITE_VISIT_COMMAND_INVALID' using errcode='22023';end if;
  current_rows:=private.site_visit_review_rows(actor,company,p_command);
  request:=jsonb_build_object('original_id',p_original_id,'command',p_command,'choice',p_choice,'current',p_current);
  if octet_length(request::text)>1048576 then raise exception 'SITE_VISIT_COMMAND_INVALID' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_original_id::text,19));
  select * into prior from private.site_visit_write_resolutions where original_id=p_original_id or resolution_id=p_resolution_id for update;
  if found then
    if prior.actor_id<>actor or prior.company_id<>company or prior.resolution_id<>p_resolution_id or prior.request<>request then
      raise exception 'SITE_VISIT_IDEMPOTENCY_CONFLICT' using errcode='22023';end if;
    return prior.result;
  end if;
  select * into original from private.site_visit_write_receipts where command_id=p_original_id for update;
  if found and (original.actor_id<>actor or original.company_id<>company or original.request<>p_command) then
    raise exception 'SITE_VISIT_IDEMPOTENCY_CONFLICT' using errcode='22023';end if;
  if current_rows is distinct from p_current then
    return jsonb_build_object('command_id',p_resolution_id,'entity',p_command->>'entity','outcome','conflict','reason','review_changed','rows',current_rows);
  end if;
  if p_choice='pending' then
    for r in select * from jsonb_array_elements(p_command->'rows') loop
      select x into current_row from jsonb_array_elements(current_rows)x where x->>'id'=r->>'id';
      values:=r->'values';
      if current_row is null and p_command->>'entity'='answer' then
        select x into current_row from jsonb_array_elements(current_rows)x where x->>'site_visit_id'=values->>'site_visit_id' and x->>'field_id'=values->>'field_id' and x->>'deleted_at' is null;
        if current_row is not null then
          -- Explicit use-pending reconciles the logical collision to the server
          -- snapshot. Only the reviewed answer value/tombstone replaces it.
          values:=(current_row-array['opportunity_id','created_by','created_at','updated_at','write_revision','write_base_revision','answer_state','answer_evidence'])||jsonb_build_object('answer_value',values->'answer_value','deleted_at',values->'deleted_at');
        end if;
      end if;
      if current_row is null and p_command->>'entity'='template' then
        select x into current_row from jsonb_array_elements(current_rows)x where x->>'slug'=values->>'slug' and x->>'deleted_at' is null;
        if current_row is not null then values:=values||jsonb_build_object('id',current_row->'id');end if;
      end if;
      if r->'clear_answer'='true'::jsonb then values:=values||'{"answer_state":"cleared"}'::jsonb;end if;
      writes:=writes||jsonb_build_array(jsonb_build_object('id',values->'id','base_revision',coalesce(current_row->'write_revision','0'),'before',current_row,'values',values));
    end loop;
    if p_command->>'entity'='template' and exists(select 1 from jsonb_array_elements(writes)x where x->'values'->'is_default'='true' and x->'values'->>'deleted_at' is null) then
      for current_row in select x from jsonb_array_elements(current_rows)x where x->'is_default'='true' and x->>'deleted_at' is null
        and not exists(select 1 from jsonb_array_elements(writes)w where w->>'id'=x->>'id') loop
        writes:=writes||jsonb_build_array(jsonb_build_object('id',current_row->'id','base_revision',coalesce(current_row->'write_revision','0'),
          'before',current_row,'values',(current_row-array['created_at','updated_at','write_revision','write_base_revision'])||'{"is_default":false}'));
      end loop;
    end if;
    result:=private.apply_site_visit_rows(actor,company,p_command->>'entity',writes);
    if result->>'outcome'='conflict' then return result||jsonb_build_object('command_id',p_resolution_id,'entity',p_command->>'entity');end if;
  else result:=jsonb_build_object('outcome','resolved','rows',current_rows);end if;
  result:=result||jsonb_build_object('command_id',p_resolution_id,'entity',p_command->>'entity','resolution_choice',p_choice);
  insert into private.site_visit_write_resolutions(original_id,resolution_id,actor_id,company_id,request,result)
    values(p_original_id,p_resolution_id,actor,company,request,result);
  -- Missing receipt means the original request has not reached the server yet.
  insert into private.site_visit_write_receipts(command_id,actor_id,company_id,request,result)
    values(p_original_id,actor,company,p_command,jsonb_build_object('command_id',p_original_id,'entity',p_command->>'entity','outcome','superseded','rows',result->'rows'))
    on conflict(command_id) do nothing;
  return result;
end $$;
revoke all on function private.site_visit_review_rows(uuid,text,jsonb),public.review_site_visit_write(jsonb,uuid),public.resolve_site_visit_write(uuid,uuid,jsonb,text,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.review_site_visit_write(jsonb,uuid),public.resolve_site_visit_write(uuid,uuid,jsonb,text,jsonb,uuid) to anon,authenticated;

-- New phone-only entry point binds the durable originating actor, then delegates
-- to the existing canonical completion without changing its semantics.
create function public.complete_site_visit_capture(p_site_visit_id uuid,p_completion jsonb,p_expected_actor uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
  if p_expected_actor is null or p_expected_actor is distinct from private.get_current_user_id() then
    raise exception 'SITE_VISIT_AUTHORITY_DENIED' using errcode='42501';end if;
  return public.complete_site_visit_guarded(p_site_visit_id,p_completion);
end $$;
revoke all on function public.complete_site_visit_capture(uuid,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.complete_site_visit_capture(uuid,jsonb,uuid) to anon,authenticated;

-- Phone deletion is actor-bound and cannot erase a canonical appointment or
-- reopen a terminal capture. Booked visits go through canonical cancellation.
create function public.delete_site_visit_capture(p_site_visit_id uuid,p_deleted_at timestamptz,p_expected_actor uuid)
returns public.site_visits language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=private.get_current_user_id();company text:=private.get_user_company_id()::text;visit public.site_visits%rowtype;
begin
  if actor is null or actor is distinct from p_expected_actor or company is null then
    raise exception 'SITE_VISIT_AUTHORITY_DENIED' using errcode='42501';end if;
  if p_deleted_at is null then raise exception 'SITE_VISIT_CAPTURE_COMMAND_INVALID' using errcode='22023';end if;
  select * into visit from public.site_visits where id=p_site_visit_id for update;
  if not found or visit.company_id<>company or not private.actor_can_edit_site_visit(actor,company,visit.opportunity_id,visit.project_id,visit.project_ref) then
    raise exception 'SITE_VISIT_AUTHORITY_DENIED' using errcode='42501';end if;
  if visit.booked_at is not null then raise exception 'SITE_VISIT_USE_CANONICAL_CANCELLATION' using errcode='55000';end if;
  if visit.status in ('completed','cancelled') then raise exception 'SITE_VISIT_CAPTURE_CLOSED' using errcode='55000';end if;
  if visit.deleted_at is null then
    update public.site_visits set deleted_at=p_deleted_at where id=visit.id returning * into visit;
  end if;
  return visit;
end $$;
revoke all on function public.delete_site_visit_capture(uuid,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.delete_site_visit_capture(uuid,timestamptz,uuid) to anon,authenticated;
