-- CREW SITE VISITS P1 (2026-09-18), part A: a site-visit assignee can see,
-- capture and complete that visit without any pipeline permission, and a new
-- walk-up visit (no lead, no project) requires site_visits.capture or any-scope
-- pipeline.convert. The permission itself is registered and granted in part B,
-- which ships together with the OPS-Web registry (the guarded role-permission
-- replacement requires the web and database registries to match exactly). Spec: ops-software-bible specs/2026-09-18-crew-site-visit-access.md
--
-- Assignee authority is OR-ed into the site-visit helpers and capture RPCs
-- only. Lead RLS is untouched; assignees read the lead's display fields
-- through read_site_visit_briefs. Assignees can never re-link, delete,
-- discard, book, reschedule, cancel or move the lead stage: those paths keep
-- lead/project authority. Every replaced function below is the reviewed live
-- definition with only its authority expression changed.

do $guard$
declare
  v_expected record;
  v_md5 text;
begin
  for v_expected in
    select * from (values
    ('private.current_user_can_access_site_visit_child(uuid,text,boolean)','6bb75271fc59d9351ab924db8685f1a4'),
    ('public.save_site_visit_capture(jsonb,uuid)','16162284c76eb79c1cbeef82cc3527b7'),
    ('private.apply_site_visit_rows(uuid,text,text,jsonb)','a7b85c93b05e2cf1770eebb142018324'),
    ('private.apply_site_visit_rows_v2(uuid,text,text,jsonb)','e3db1e758e3cd5ce1e6acfd6046c72bc'),
    ('private.site_visit_review_rows(uuid,text,jsonb)','4cd779f307fb6c3f4849d845e4f1f81f'),
    ('private.site_visit_review_rows_v2(uuid,text,jsonb)','fcc018b457da6abd8d95569e00867a26'),
    ('private.complete_site_visit_guarded(uuid,jsonb)','18be1c499327840f9362d6d63ae1aa81')
    ) as expected(signature, md5)
  loop
    select md5(pg_get_functiondef(v_expected.signature::regprocedure)) into v_md5;
    if v_md5 is distinct from v_expected.md5 then
      raise exception 'site visit assignee access: % drifted (md5 %); refusing to replace',
        v_expected.signature, v_md5;
    end if;
  end loop;
  select md5(pg_get_expr(p.polqual, p.polrelid)) into v_md5
    from pg_policy p
   where p.polname = 'assigned_lead_scope_select'
     and p.polrelid = 'public.site_visits'::regclass
     and not p.polpermissive;
  if v_md5 is distinct from '19ab54cbbdea88528e1a164c4af6d115' then
    raise exception 'site visit assignee access: assigned_lead_scope_select drifted (md5 %)', v_md5;
  end if;
end
$guard$;

-- READ/WRITE authority of an assignee: an active member of the visit's
-- company (company not deleted) whose id is in assignee_ids. Callers apply
-- their own deleted/closed checks (child helper: parent not deleted; capture
-- RPCs: capture_closed; completion: deleted/cancelled refusals).
create or replace function private.actor_is_site_visit_assignee(
  p_actor uuid,
  p_company text,
  p_assignee_ids text[]
)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select p_actor is not null
     and p_company is not null
     and p_assignee_ids is not null
     and exists (
       select 1
         from unnest(p_assignee_ids) as assignee(id)
        where lower(btrim(assignee.id)) = lower(p_actor::text)
     )
     and exists (
       select 1
         from public.users u
         join public.companies c
           on c.id = u.company_id
          and c.deleted_at is null
        where u.id = p_actor
          and u.company_id::text = p_company
          and u.deleted_at is null
          and coalesce(u.is_active, false)
     );
$function$;

revoke all on function private.actor_is_site_visit_assignee(uuid, text, text[])
  from public, anon, authenticated;

create or replace function private.current_user_is_site_visit_assignee(
  p_company text,
  p_assignee_ids text[]
)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select private.try_parse_uuid(p_company) is not distinct from private.get_user_company_id()
     and private.actor_is_site_visit_assignee(
       private.get_current_user_id(),
       p_company,
       p_assignee_ids
     );
$function$;

-- Evaluated inside RLS as the app roles, like current_user_can_view_site_visit.
revoke all on function private.current_user_is_site_visit_assignee(text, text[])
  from public;
grant execute on function private.current_user_is_site_visit_assignee(text, text[])
  to anon, authenticated;

CREATE OR REPLACE FUNCTION private.current_user_can_access_site_visit_child(p_site_visit_id uuid, p_company_id text, p_write boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
  select coalesce((
    select case when p_write then
      private.current_user_can_edit_site_visit(
        visit.company_id,
        visit.opportunity_id,
        visit.project_id,
        visit.project_ref
      )
    else
      private.current_user_can_view_site_visit(
        visit.company_id,
        visit.opportunity_id,
        visit.project_id,
        visit.project_ref
      )
    end
    or private.current_user_is_site_visit_assignee(
      visit.company_id,
      visit.assignee_ids
    )
      from public.site_visits visit
     where visit.id = p_site_visit_id
       and visit.company_id = p_company_id
       and visit.deleted_at is null
  ), false);
$function$;

CREATE OR REPLACE FUNCTION public.save_site_visit_capture(p_capture jsonb, p_expected_actor uuid)
 RETURNS site_visits
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor_id uuid:=private.get_current_user_id();company text:=private.get_user_company_id()::text;
  proposed public.site_visits%rowtype;current_visit public.site_visits%rowtype;saved public.site_visits%rowtype;
  assignee_only boolean:=false;
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
    -- Lead/project authority on the current AND proposed links, or assignee
    -- authority (2026-09-18) with every link column and deleted_at unchanged:
    -- an assignee captures the visit, the office decides what it belongs to.
    if current_visit.company_id<>company then
      raise exception 'SITE_VISIT_AUTHORITY_DENIED' using errcode='42501';end if;
    if not private.actor_can_edit_site_visit(actor_id,company,current_visit.opportunity_id,current_visit.project_id,current_visit.project_ref) then
      if private.actor_is_site_visit_assignee(actor_id,company,current_visit.assignee_ids)
        and proposed.opportunity_id is not distinct from current_visit.opportunity_id
        and lower(proposed.project_id) is not distinct from lower(current_visit.project_id)
        and proposed.project_ref is not distinct from current_visit.project_ref
        and lower(proposed.client_id) is not distinct from lower(current_visit.client_id)
        and proposed.client_ref is not distinct from current_visit.client_ref
        and proposed.deleted_at is not distinct from current_visit.deleted_at then
        assignee_only:=true;
      else
        raise exception 'SITE_VISIT_AUTHORITY_DENIED' using errcode='42501';
      end if;
    end if;
    if current_visit.deleted_at is not null or current_visit.status in ('completed','cancelled') then raise exception 'SITE_VISIT_CAPTURE_CLOSED' using errcode='55000';end if;
    if not assignee_only and not private.actor_can_edit_site_visit(actor_id,company,proposed.opportunity_id,proposed.project_id,proposed.project_ref) then
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
    -- A walk-up visit (no lead, no project) is its own permission (2026-09-18).
    if proposed.opportunity_id is null and proposed.project_id is null and proposed.project_ref is null
      and not (public.has_permission(actor_id,'site_visits.capture','all')
        or private.effective_pipeline_scope_for_user(actor_id,company::uuid,'pipeline.convert') is not null) then
      raise exception 'SITE_VISIT_AUTHORITY_DENIED' using errcode='42501';end if;
    insert into public.site_visits(id,company_id,opportunity_id,project_id,project_ref,client_id,client_ref,scheduled_at,duration_minutes,
      assignee_ids,status,notes,internal_notes,measurements,photos,created_by,created_at,deleted_at)
    values(proposed.id,company,proposed.opportunity_id,proposed.project_id,proposed.project_ref,proposed.client_id,proposed.client_ref,
      proposed.scheduled_at,coalesce(proposed.duration_minutes,60),coalesce(proposed.assignee_ids,array[actor_id::text]),
      proposed.status,proposed.notes,proposed.internal_notes,proposed.measurements,coalesce(proposed.photos,'{}'::text[]),
      actor_id::text,coalesce(proposed.created_at,clock_timestamp()),proposed.deleted_at) returning * into saved;
  end if;
  return saved;
end $function$;

CREATE OR REPLACE FUNCTION private.apply_site_visit_rows(p_actor uuid, p_company text, p_entity text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      if not (private.actor_can_edit_site_visit(p_actor,p_company,visit.opportunity_id,visit.project_id,visit.project_ref)
        or private.actor_is_site_visit_assignee(p_actor,p_company,visit.assignee_ids)) then
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
end $function$;

CREATE OR REPLACE FUNCTION private.apply_site_visit_rows_v2(p_actor uuid, p_company text, p_entity text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      if not (private.actor_can_edit_site_visit(p_actor,p_company,visit.opportunity_id,visit.project_id,visit.project_ref)
        or private.actor_is_site_visit_assignee(p_actor,p_company,visit.assignee_ids)) then
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
end $function$;

CREATE OR REPLACE FUNCTION private.site_visit_review_rows(p_actor uuid, p_company text, p_command jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      if not found or visit.company_id<>p_company or not (private.actor_can_edit_site_visit(p_actor,p_company,visit.opportunity_id,visit.project_id,visit.project_ref)
        or private.actor_is_site_visit_assignee(p_actor,p_company,visit.assignee_ids)) then
        raise exception 'SITE_VISIT_AUTHORITY_DENIED' using errcode='42501';end if;
      -- Include logical collisions; review can explicitly reconcile identity.
      result:=result||coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.site_visit_checklist_answers a
        where a.company_id=p_company and a.site_visit_id=visit.id and (a.id=(r->>'id')::uuid or (a.field_id=v->>'field_id' and a.deleted_at is null))),'[]');
    end loop;
    select coalesce(jsonb_agg(x order by x->>'id'),'[]') into result from (select distinct value x from jsonb_array_elements(result))q;
  else raise exception 'SITE_VISIT_COMMAND_INVALID' using errcode='22023';end if;
  return result;
end $function$;

CREATE OR REPLACE FUNCTION private.site_visit_review_rows_v2(p_actor uuid, p_company text, p_command jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      if not found or visit.company_id<>p_company or not (private.actor_can_edit_site_visit(p_actor,p_company,visit.opportunity_id,visit.project_id,visit.project_ref)
        or private.actor_is_site_visit_assignee(p_actor,p_company,visit.assignee_ids)) then
        raise exception 'SITE_VISIT_AUTHORITY_DENIED' using errcode='42501';end if;
      -- Include logical collisions; review can explicitly reconcile identity.
      result:=result||coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.site_visit_checklist_answers a
        where a.company_id=p_company and a.site_visit_id=visit.id and (a.id=(r->>'id')::uuid or (a.field_id=v->>'field_id' and a.deleted_at is null))),'[]');
    end loop;
    select coalesce(jsonb_agg(x order by x->>'id'),'[]') into result from (select distinct value x from jsonb_array_elements(result))q;
  else raise exception 'SITE_VISIT_COMMAND_INVALID' using errcode='22023';end if;
  return result;
end $function$;

CREATE OR REPLACE FUNCTION private.complete_site_visit_guarded(p_site_visit_id uuid, p_completion jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_visit public.site_visits%rowtype;
  v_company_id uuid;
  v_actor_user_id uuid;
  v_client_id uuid;
  v_activity_id uuid;
  v_photos text[];
begin
  if p_site_visit_id is null then
    raise exception 'site_visit_id_required' using errcode = '22004';
  end if;
  if p_completion is null or jsonb_typeof(p_completion) <> 'object' then
    raise exception 'site_visit_completion_must_be_an_object'
      using errcode = '22023';
  end if;
  if exists (
    select 1
      from jsonb_object_keys(p_completion) key
     where key <> all (array['notes', 'measurements', 'photos', 'internal_notes'])
  ) then
    raise exception 'site_visit_completion_has_unknown_fields'
      using errcode = '22023';
  end if;
  if (p_completion ? 'notes' and jsonb_typeof(p_completion -> 'notes') not in ('string', 'null'))
     or (p_completion ? 'measurements' and jsonb_typeof(p_completion -> 'measurements') not in ('string', 'null'))
     or (p_completion ? 'internal_notes' and jsonb_typeof(p_completion -> 'internal_notes') not in ('string', 'null'))
     or (p_completion ? 'photos' and jsonb_typeof(p_completion -> 'photos') not in ('array', 'null')) then
    raise exception 'site_visit_completion_has_invalid_types'
      using errcode = '22023';
  end if;
  if pg_column_size(p_completion) > 1048576
     or char_length(p_completion ->> 'notes') > 200000
     or char_length(p_completion ->> 'measurements') > 200000
     or char_length(p_completion ->> 'internal_notes') > 200000 then
    raise exception 'site_visit_completion_exceeds_size_limit'
      using errcode = '22001';
  end if;
  if p_completion ? 'photos'
     and jsonb_typeof(p_completion -> 'photos') = 'array'
     and (
       jsonb_array_length(p_completion -> 'photos') > 100
       or exists (
         select 1
           from jsonb_array_elements(p_completion -> 'photos') as photo(value)
          where jsonb_typeof(photo.value) <> 'string'
             or char_length(photo.value #>> '{}') > 4096
       )
     ) then
    raise exception 'site_visit_completion_has_invalid_photos'
      using errcode = '22023';
  end if;

  select *
    into v_visit
    from public.site_visits
   where id = p_site_visit_id
   for update;
  if not found then
    raise exception 'site_visit_not_found' using errcode = 'P0002';
  end if;

  if not (
    private.current_user_can_edit_site_visit(
      v_visit.company_id,
      v_visit.opportunity_id,
      v_visit.project_id,
      v_visit.project_ref
    )
    or private.current_user_is_site_visit_assignee(
      v_visit.company_id,
      v_visit.assignee_ids
    )
  ) then
    raise exception 'site_visit_edit_denied' using errcode = '42501';
  end if;

  v_company_id := private.get_user_company_id();
  v_actor_user_id := private.get_current_user_id();
  if v_company_id is null or v_visit.company_id is distinct from v_company_id::text then
    raise exception 'site_visit_company_mismatch' using errcode = '42501';
  end if;
  if v_actor_user_id is null then
    raise exception 'site_visit_actor_not_found' using errcode = '42501';
  end if;
  if v_visit.deleted_at is not null then
    raise exception 'cannot_complete_deleted_site_visit' using errcode = '55000';
  end if;
  if v_visit.status::text = 'cancelled' then
    raise exception 'cannot_complete_cancelled_site_visit' using errcode = '55000';
  end if;

  if p_completion ? 'photos' and jsonb_typeof(p_completion -> 'photos') = 'array' then
    select coalesce(array_agg(value), '{}'::text[])
      into v_photos
      from jsonb_array_elements_text(p_completion -> 'photos') value;
  elsif p_completion ? 'photos' then
    v_photos := null;
  else
    v_photos := v_visit.photos;
  end if;

  update public.site_visits
     set notes = case when p_completion ? 'notes'
                      then p_completion ->> 'notes' else notes end,
         measurements = case when p_completion ? 'measurements'
                             then p_completion ->> 'measurements' else measurements end,
         photos = case when p_completion ? 'photos' then v_photos else photos end,
         internal_notes = case when p_completion ? 'internal_notes'
                               then p_completion ->> 'internal_notes' else internal_notes end
   where id = p_site_visit_id;

  perform private.refresh_site_visit_compatibility(p_site_visit_id);

  update public.site_visits
     set status = 'completed',
         completed_at = coalesce(completed_at, clock_timestamp())
   where id = p_site_visit_id
   returning * into v_visit;

  v_activity_id := v_visit.activity_id;
  v_client_id := coalesce(
    v_visit.client_ref,
    private.try_parse_uuid(v_visit.client_id)
  );

  if v_visit.opportunity_id is not null
     or v_client_id is not null
     or coalesce(v_visit.project_ref::text, v_visit.project_id) is not null then
    insert into public.activities (
      company_id,
      opportunity_id,
      client_id,
      type,
      subject,
      content,
      duration_minutes,
      created_by,
      attachments,
      is_read,
      site_visit_id,
      project_id
    ) values (
      v_company_id,
      v_visit.opportunity_id,
      v_client_id,
      'site_visit',
      'Site visit completed',
      v_visit.notes,
      v_visit.duration_minutes,
      v_actor_user_id,
      coalesce(v_visit.photos, '{}'::text[]),
      true,
      v_visit.id,
      coalesce(v_visit.project_ref::text, v_visit.project_id)
    )
    on conflict (site_visit_id)
      where type = 'site_visit' and site_visit_id is not null
    do update set
      company_id = excluded.company_id,
      opportunity_id = excluded.opportunity_id,
      client_id = excluded.client_id,
      subject = excluded.subject,
      content = excluded.content,
      duration_minutes = excluded.duration_minutes,
      attachments = excluded.attachments,
      project_id = excluded.project_id
    returning id into v_activity_id;

    perform private.allow_site_visit_booking_write(p_site_visit_id,v_company_id::text,jsonb_build_object('activity_id',v_activity_id));
    update public.site_visits
       set activity_id = v_activity_id
     where id = p_site_visit_id
     returning * into v_visit;
  end if;

  return jsonb_build_object(
    'visit', to_jsonb(v_visit),
    'activity_id', v_activity_id
  );
end;
$function$;

-- Assignees read their visits, including cancelled and deleted ones, so the
-- cancellation or tombstone reaches their phone through the delta sync.
alter policy assigned_lead_scope_select on public.site_visits
  using (
    private.current_user_can_view_site_visit(company_id, opportunity_id, project_id, project_ref)
    or private.current_user_is_site_visit_assignee(company_id, assignee_ids)
  );

-- One row per requested visit the caller can currently read; a missing id
-- means the caller can no longer read that visit. Lead display fields are
-- filled only for a caller who can view the lead or is assigned to the visit.
create or replace function public.read_site_visit_briefs(p_site_visit_ids uuid[])
 returns table (
   site_visit_id uuid,
   opportunity_id uuid,
   contact_name text,
   title text,
   address text,
   ai_summary text,
   description text
 )
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_actor uuid := private.get_current_user_id();
  v_company uuid := private.get_user_company_id();
begin
  if v_actor is null or v_company is null then
    raise exception 'SITE_VISIT_AUTHORITY_DENIED' using errcode = '42501';
  end if;
  if p_site_visit_ids is null or cardinality(p_site_visit_ids) > 200 then
    raise exception 'SITE_VISIT_BRIEF_REQUEST_INVALID' using errcode = '22023';
  end if;

  return query
  select visit.id,
         visit.opportunity_id,
         case when lead_visible.ok then lead.contact_name end,
         case when lead_visible.ok then lead.title end,
         case when lead_visible.ok then lead.address end,
         case when lead_visible.ok then lead.ai_summary end,
         case when lead_visible.ok then lead.description end
    from public.site_visits visit
    cross join lateral (
      select private.current_user_is_site_visit_assignee(visit.company_id, visit.assignee_ids) as assigned
    ) assignment
    left join public.opportunities lead
      on lead.id = visit.opportunity_id
     and lead.company_id = v_company
     and lead.deleted_at is null
    cross join lateral (
      select lead.id is not null
         and (assignment.assigned or private.user_can_view_opportunity(v_actor, lead.id)) as ok
    ) lead_visible
   where visit.id = any(p_site_visit_ids)
     and visit.company_id = v_company::text
     and visit.deleted_at is null
     and (
       assignment.assigned
       or private.current_user_can_view_site_visit(
         visit.company_id,
         visit.opportunity_id,
         visit.project_id,
         visit.project_ref
       )
     );
end;
$function$;

revoke all on function public.read_site_visit_briefs(uuid[]) from public, anon;
grant execute on function public.read_site_visit_briefs(uuid[]) to authenticated;
