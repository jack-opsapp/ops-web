-- Row/command transaction fixture; authorization/RLS acceptance is separate.
update public.site_visits set status='in_progress' where id='10000000-0000-4000-8000-000000000001';
do $$
declare actor uuid:='10000000-0000-4000-8000-000000000003';company text:='10000000-0000-4000-8000-000000000002';
  r jsonb;v jsonb;result jsonb;stale jsonb;before_row jsonb;blocked boolean:=false;
begin
  if private.site_visit_fields_strict('[{"id":"bad"}]') then raise exception 'FAIL: missing field metadata accepted';end if;
  if private.site_visit_fields_strict('[{"id":"x","label":"X","kind":"signature","required":false,"sortOrder":0}]') then raise exception 'FAIL: unsupported signature accepted';end if;
  if not private.site_visit_value_valid('checkbox','{"boolValue":false,"artifactIds":[]}') then raise exception 'FAIL: explicit false lost';end if;
  raise notice 'PASS: strict SQL fields reject missing metadata and preserve false';
  select to_jsonb(a) into before_row from public.site_visit_checklist_answers a where id='10000000-0000-4000-8000-000000000004';
  v:=before_row-array['opportunity_id','created_by','created_at','updated_at','write_revision','write_base_revision','answer_state','answer_evidence'];
  v:=v||'{"answer_value":{"text":"immutable phone command"}}';
  r:=jsonb_build_object('id',v->'id','base_revision',before_row->'write_revision','values',v,'before',before_row);
  stale:=r;
  result:=private.apply_site_visit_rows(actor,company,'answer',jsonb_build_array(r));
  if result->>'outcome'<>'saved' or result->'rows'->0->'answer_value'<>v->'answer_value' then raise exception 'FAIL: command not saved %',result;end if;
  result:=private.apply_site_visit_rows(actor,company,'answer',jsonb_build_array(stale));
  if result->>'outcome'<>'conflict' or result->'rows'->0->'answer_value'<>v->'answer_value' then raise exception 'FAIL: stale command missing preserved server version';end if;
  raise notice 'PASS: versioned command updates existing row and returns a recoverable stale conflict';
  -- The legacy UPSERT cannot claim success; the RPC separates INSERT/UPDATE.
  begin
    insert into public.site_visit_checklist_answers(id,site_visit_id,company_id,field_id,label,kind,required,sort_order,answer_value,created_by,write_base_revision)
    values((v->>'id')::uuid,(v->>'site_visit_id')::uuid,company,v->>'field_id','Access','short_text',true,10,'{"text":"legacy upsert"}',actor::text,2)
    on conflict(id) do update set answer_value=excluded.answer_value,write_base_revision=excluded.write_base_revision;
  exception when serialization_failure then blocked:=true;end;
  if not blocked then raise exception 'FAIL: legacy upsert changed versioned row';end if;
  raise notice 'PASS: real ON CONFLICT writer cannot bypass the protocol';
  select to_jsonb(t) into before_row from public.site_visit_types t where id='fixture-type';
  v:=before_row-array['created_at','updated_at','write_revision','write_base_revision'];
  v:=v||'{"is_default":true}';
  r:=jsonb_build_object('id',v->'id','base_revision',before_row->'write_revision','values',v);
  result:=private.apply_site_visit_rows(actor,company,'template',jsonb_build_array(r));
  if result->>'outcome'<>'saved' then raise exception 'FAIL: default initial save %',result;end if;
  v:=v||'{"id":"new-default","slug":"new-default","name":"New default"}';
  r:=jsonb_build_object('id',v->'id','base_revision',0,'values',v);
  result:=private.apply_site_visit_rows(actor,company,'template',jsonb_build_array(r));
  if result->>'outcome'<>'conflict' or exists(select 1 from public.site_visit_types where id='new-default') then raise exception 'FAIL: conflicting default partially saved';end if;
  select to_jsonb(t) into before_row from public.site_visit_types t where id='fixture-type';
  v:=before_row-array['created_at','updated_at','write_revision','write_base_revision'];
  v:=v||'{"is_default":false}';
  result:=private.apply_site_visit_rows(actor,company,'template',jsonb_build_array(r,jsonb_build_object('id',v->'id','base_revision',before_row->'write_revision','values',v)));
  if result->>'outcome'<>'saved' or (select count(*) from public.site_visit_types where is_default and deleted_at is null)<>1 or
    not exists(select 1 from public.site_visit_types where id='new-default' and is_default) then raise exception 'FAIL: atomic default switch %',result;end if;
  raise notice 'PASS: default conflicts roll back and approved default switches save atomically';
end $$;
