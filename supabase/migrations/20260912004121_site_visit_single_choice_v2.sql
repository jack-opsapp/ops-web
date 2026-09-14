-- Additive phone v2 choice metadata. No company/MCP activation or grants change.
-- The released eight-kind and plaintext answer contracts remain valid.
alter table public.site_visit_checklist_answers add column choice_snapshot jsonb;
comment on column public.site_visit_checklist_answers.choice_snapshot is
  'Immutable single-choice option snapshot; short_text answer_value remains {} or {text: exact label}.';

create function private.site_visit_single_choice_valid(p_choice jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare option jsonb; n integer;
  whitespace text:=E' \t\n\r\f'||chr(11)||chr(133)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288);
begin
  if jsonb_typeof(p_choice) is distinct from 'object' or p_choice-array['version','options']<>'{}' or
    p_choice->'version' is distinct from '1'::jsonb or jsonb_typeof(p_choice->'options') is distinct from 'array' or
    octet_length(p_choice::text)>32768 then return false;end if;
  n:=jsonb_array_length(p_choice->'options');
  if n not between 2 and 20 then return false;end if;
  for option in select * from jsonb_array_elements(p_choice->'options') loop
    if jsonb_typeof(option) is distinct from 'object' or option-array['id','label']<>'{}' or
      jsonb_typeof(option->'id') is distinct from 'string' or
      (option->>'id')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or
      jsonb_typeof(option->'label') is distinct from 'string' or length(option->>'label') not between 1 and 120 or
      btrim(option->>'label',whitespace) is distinct from option->>'label' then return false;end if;
  end loop;
  return (select count(distinct x->>'id')=n and count(distinct lower(normalize(x->>'label',NFC) collate pg_catalog."und-x-icu"))=n from jsonb_array_elements(p_choice->'options')x);
end $$;

create function private.site_visit_choice_value_valid(p_snapshot jsonb,p_value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare normalized_value jsonb:=private.site_visit_normalized_value(p_value);
begin
  if p_snapshot is null or p_snapshot='null' then return true;end if;
  if not private.site_visit_single_choice_valid(p_snapshot) then return false;end if;
  if normalized_value='{}' then return true;end if;
  return coalesce(jsonb_typeof(normalized_value)='object' and normalized_value-'text'='{}' and jsonb_typeof(normalized_value->'text')='string' and
    exists(select 1 from jsonb_array_elements(p_snapshot->'options')x where x->>'label'=normalized_value->>'text'),false);
end $$;

create function private.site_visit_fields_strict_v2(p_fields jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare f jsonb; plain_fields jsonb;
begin
  if jsonb_typeof(p_fields) is distinct from 'array' or octet_length(p_fields::text)>131072 then return false;end if;
  select jsonb_agg(x-'singleChoice' order by ord) into plain_fields from jsonb_array_elements(p_fields) with ordinality a(x,ord);
  if not private.site_visit_fields_strict(plain_fields) then return false;end if;
  for f in select * from jsonb_array_elements(p_fields) loop
    if f?'singleChoice' and (f->>'kind' is distinct from 'short_text' or not private.site_visit_single_choice_valid(f->'singleChoice')) then return false;end if;
  end loop;
  return true;
end $$;

create table private.site_visit_choice_write_tokens (
  transaction_id bigint not null, backend_pid integer not null, entity text not null, row_id text not null,
  primary key(transaction_id,backend_pid,entity,row_id)
);
alter table private.site_visit_choice_write_tokens enable row level security;
revoke all on private.site_visit_choice_write_tokens from public,anon,authenticated,service_role;

-- The extra one-use token distinguishes v2's deliberate template conversion
-- from an older client silently re-encoding and dropping unknown metadata.
create function private.site_visit_guard_choice_write() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare authorized boolean:=false; had_choice boolean:=false; has_choice boolean:=false;
begin
  delete from private.site_visit_choice_write_tokens where transaction_id=txid_current() and backend_pid=pg_backend_pid()
    and entity=tg_table_name and row_id=new.id::text returning true into authorized;
  if tg_table_name='site_visit_types' then
    select exists(select 1 from jsonb_array_elements(new.fields)x where x?'singleChoice') into has_choice;
    if tg_op='UPDATE' then
      select exists(select 1 from jsonb_array_elements(old.fields)x where x?'singleChoice') into had_choice;
    end if;
    if (has_choice or had_choice) and (tg_op='INSERT' or new.fields is distinct from old.fields) then
      if not coalesce(authorized,false) then
        raise exception 'SITE_VISIT_WRITE_CONFLICT' using errcode='40001',detail='{"reason":"client_update_required"}';end if;
      if not private.site_visit_fields_strict_v2(new.fields) then raise exception 'SITE_VISIT_TEMPLATE_INVALID' using errcode='22023';end if;
    end if;
  else
    if tg_op='UPDATE' and new.choice_snapshot is distinct from old.choice_snapshot then
      raise exception 'SITE_VISIT_SNAPSHOT_IMMUTABLE' using errcode='55000';end if;
    if tg_op='INSERT' then
      if new.choice_snapshot is not null and not coalesce(authorized,false) then
        raise exception 'SITE_VISIT_WRITE_CONFLICT' using errcode='40001',detail='{"reason":"client_update_required"}';end if;
      if new.choice_snapshot is null and not coalesce(authorized,false) and exists(select 1 from public.site_visit_types t, jsonb_array_elements(t.fields)f
        where t.id=new.site_visit_type_id and t.company_id=new.company_id and f->>'id'=new.field_id and f?'singleChoice') then
        raise exception 'SITE_VISIT_WRITE_CONFLICT' using errcode='40001',detail='{"reason":"client_update_required"}';end if;
    end if;
    if new.choice_snapshot is not null and
      (new.kind<>'short_text' or not private.site_visit_single_choice_valid(new.choice_snapshot) or
       not private.site_visit_choice_value_valid(new.choice_snapshot,new.answer_value)) then
      raise exception 'SITE_VISIT_CHOICE_INVALID' using errcode='22023';end if;
  end if;
  return new;
end $$;
create trigger zy_site_visit_types_choice before insert or update on public.site_visit_types
for each row execute function private.site_visit_guard_choice_write();
create trigger zy_site_visit_answers_choice before insert or update on public.site_visit_checklist_answers
for each row execute function private.site_visit_guard_choice_write();
revoke all on function private.site_visit_single_choice_valid(jsonb),private.site_visit_choice_value_valid(jsonb,jsonb),
  private.site_visit_fields_strict_v2(jsonb),private.site_visit_guard_choice_write() from public,anon,authenticated,service_role;

create function private.apply_site_visit_rows_v2(p_actor uuid,p_company text,p_entity text,p_rows jsonb)
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
      if v-array['id','company_id','site_visit_id','site_visit_type_id','field_id','label','kind','required','help_text','sort_order','answer_value','answer_state','answer_evidence','deleted_at','choice_snapshot']<>'{}' then
        raise exception 'SITE_VISIT_ANSWER_INVALID' using errcode='22023';end if;
      if nullif(v->'choice_snapshot','null') is not null and
        (v->>'kind' is distinct from 'short_text' or not private.site_visit_single_choice_valid(v->'choice_snapshot') or
         not private.site_visit_choice_value_valid(v->'choice_snapshot',v->'answer_value')) then
        raise exception 'SITE_VISIT_CHOICE_INVALID' using errcode='22023';end if;
      if current_row is not null and nullif(current_row->'choice_snapshot','null') is distinct from nullif(v->'choice_snapshot','null') then
        return jsonb_build_object('outcome','conflict','reason','snapshot_changed','rows',jsonb_build_array(current_row));end if;
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
      if not private.site_visit_fields_strict_v2(v->'fields') or
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
      insert into private.site_visit_choice_write_tokens(transaction_id,backend_pid,entity,row_id)
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
            field_id,label,kind,required,help_text,sort_order,answer_value,created_by,deleted_at,write_base_revision,answer_state,answer_evidence,choice_snapshot)
          values(id_text::uuid,visit.id,p_company,visit.opportunity_id,v->>'site_visit_type_id',v->>'field_id',v->>'label',v->>'kind',
            (v->>'required')::boolean,v->>'help_text',(v->>'sort_order')::integer,v->'answer_value',p_actor::text,(v->>'deleted_at')::timestamptz,0,case when v?'answer_state' then v->>'answer_state' when v->'answer_value' in ('{}','{"artifactIds":[]}') then null else 'answered' end,nullif(v->'answer_evidence','null'),nullif(v->'choice_snapshot','null'));
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

create function public.apply_site_visit_write_v2(p_command_id uuid,p_command jsonb,p_expected_actor uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor_id uuid:=private.get_current_user_id();company text:=private.get_user_company_id()::text;
  prior private.site_visit_write_receipts%rowtype;r jsonb;result jsonb;entity text:=p_command->>'entity';
begin
  if actor_id is null or actor_id is distinct from p_expected_actor or company is null or company is distinct from p_command->>'company_id' then
    raise exception 'SITE_VISIT_AUTHORITY_DENIED' using errcode='42501';end if;
  if p_command_id is null or p_command->>'protocol' is distinct from 'site-visit-writes:2026-09-11.v2' or
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
  result:=private.apply_site_visit_rows_v2(actor_id,company,entity,private.site_visit_phone_rows(entity,p_command->'rows'))||jsonb_build_object('command_id',p_command_id,'entity',entity);
  insert into private.site_visit_write_receipts(command_id,actor_id,company_id,request,result)
    values(p_command_id,actor_id,company,p_command,result);
  return result;
end $$;

create function private.site_visit_review_rows_v2(p_actor uuid,p_company text,p_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare r jsonb; v jsonb; visit public.site_visits%rowtype; result jsonb:='[]';
begin
  -- Explicit review can supersede a retained v1 request without rewriting its
  -- immutable receipt identity. First-attempt apply_v2 still requires v2.
  if p_command->>'company_id' is distinct from p_company or p_command->>'protocol' is null or
    p_command->>'protocol' not in ('site-visit-writes:2026-09-10.v1','site-visit-writes:2026-09-11.v2')
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

create function public.review_site_visit_write_v2(p_command jsonb,p_expected_actor uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
  if p_expected_actor is null or p_expected_actor is distinct from private.get_current_user_id() then
    raise exception 'SITE_VISIT_AUTHORITY_DENIED' using errcode='42501';end if;
  return jsonb_build_object('rows',private.site_visit_review_rows_v2(private.get_current_user_id(),private.get_user_company_id()::text,p_command));
end $$;

create function public.resolve_site_visit_write_v2(p_resolution_id uuid,p_original_id uuid,p_command jsonb,p_choice text,p_current jsonb,p_expected_actor uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=private.get_current_user_id();company text:=private.get_user_company_id()::text;
  current_rows jsonb; request jsonb; prior private.site_visit_write_resolutions%rowtype;
  original private.site_visit_write_receipts%rowtype; r jsonb; current_row jsonb; values jsonb; writes jsonb:='[]'; result jsonb;
begin
  if actor is null or actor is distinct from p_expected_actor then
    raise exception 'SITE_VISIT_AUTHORITY_DENIED' using errcode='42501';end if;
  if p_resolution_id is null or p_original_id is null or p_resolution_id=p_original_id or p_choice not in ('current','pending') or p_choice is null then
    raise exception 'SITE_VISIT_COMMAND_INVALID' using errcode='22023';end if;
  current_rows:=private.site_visit_review_rows_v2(actor,company,p_command);
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
      -- A reviewed v1 answer knows only the released text shape. Carry the
      -- canonical immutable snapshot into this derived write, never into the
      -- original request/receipt. New v2 requests still cannot replace it.
      if p_command->>'protocol'='site-visit-writes:2026-09-10.v1' and p_command->>'entity'='answer'
        and current_row is not null and not(values?'choice_snapshot') then
        values:=values||jsonb_build_object('choice_snapshot',current_row->'choice_snapshot');
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
    result:=private.apply_site_visit_rows_v2(actor,company,p_command->>'entity',writes);
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

-- Preserve the v1 closed value contract when resolving a logical collision.
-- The new column stays on the row; v1 never receives mutation authority over it.
create or replace function public.resolve_site_visit_write(p_resolution_id uuid,p_original_id uuid,p_command jsonb,p_choice text,p_current jsonb,p_expected_actor uuid)
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
          values:=(current_row-array['opportunity_id','created_by','created_at','updated_at','write_revision','write_base_revision','answer_state','answer_evidence','choice_snapshot'])||jsonb_build_object('answer_value',values->'answer_value','deleted_at',values->'deleted_at');
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

revoke all on function private.apply_site_visit_rows_v2(uuid,text,text,jsonb),private.site_visit_review_rows_v2(uuid,text,jsonb),
  public.apply_site_visit_write_v2(uuid,jsonb,uuid),public.review_site_visit_write_v2(jsonb,uuid),
  public.resolve_site_visit_write_v2(uuid,uuid,jsonb,text,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.apply_site_visit_write_v2(uuid,jsonb,uuid),public.review_site_visit_write_v2(jsonb,uuid),
  public.resolve_site_visit_write_v2(uuid,uuid,jsonb,text,jsonb,uuid) to anon,authenticated;
