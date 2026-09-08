-- Phase16 owner financial-policy readiness. No company enrollment, OAuth change,
-- consent installation or effect-fingerprint renewal is performed by this migration.
begin;
set local lock_timeout='3s';
set local statement_timeout='120s';

create table private.financial_policy_previews (
 id uuid primary key default extensions.gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 actor_user_id uuid not null references public.users(id),
 operation text not null check(operation in ('enroll','revoke')),
 request jsonb not null, context jsonb not null, preview jsonb not null,
 preview_sha256 text not null check(preview_sha256 ~ '^sha256:[0-9a-f]{64}$'),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null, consumed_at timestamptz, receipt jsonb,
 check ((consumed_at is null)=(receipt is null))
);
create index financial_policy_previews_actor on private.financial_policy_previews(company_id,actor_user_id,created_at);
alter table private.financial_policy_previews enable row level security;
alter table private.financial_policy_previews force row level security;
revoke all on private.financial_policy_previews from public,anon,authenticated,service_role;
alter table private.financial_document_policies
 add column approved_by uuid references public.users(id),
 add column approved_at timestamptz,
 add column approval_preview_id uuid references private.financial_policy_previews(id);
create index financial_document_policies_approver on private.financial_document_policies(approved_by);
create index financial_document_policies_preview on private.financial_document_policies(approval_preview_id);

-- Current owner identity is a business ownership relationship, not a role-name gate.
create function private.assert_financial_policy_owner(p_actor uuid,p_company uuid) returns text
language plpgsql volatile security definer set search_path='' set timezone='UTC' as $$
declare revision text;keys text[]:=array['agent.review','clients.view','estimates.create','estimates.view','pipeline.view','projects.view','settings.company'];
begin
 if auth.role() is distinct from 'service_role' or p_actor is null or p_company is null then raise exception 'FINANCIAL_POLICY_ACCESS_DENIED' using errcode='42501'; end if;
 perform private.financial_document_lock(p_company);
 lock table public.roles,public.user_roles,public.role_permissions,public.user_permission_overrides in share mode nowait;
 perform 1 from public.companies where id=p_company for share nowait;
 perform 1 from public.users where id=p_actor for share nowait;
 if not exists(select 1 from public.companies c join public.users u on u.id=p_actor and u.company_id=c.id
 where c.id=p_company and lower(c.account_holder_id)=p_actor::text and c.deleted_at is null and u.deleted_at is null and u.is_active is true)
 then raise exception 'FINANCIAL_POLICY_OWNER_REQUIRED' using errcode='42501'; end if;
 select a.permission_snapshot_revision into revision from private.resolve_agent_actor_authority(p_actor,p_company,keys) a
 where a.effective_permissions @> (select jsonb_agg(jsonb_build_object('permission',k,'scope','all')) from unnest(keys) k);
 if revision is null then raise exception 'FINANCIAL_POLICY_PERMISSION_DENIED' using errcode='42501'; end if;
 return revision;
end $$;

create function private.financial_policy_context(p_actor uuid,p_company uuid,p_request jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set timezone='UTC' as $$
declare authority text;source public.project_notes%rowtype;company public.companies%rowtype;tax public.tax_rates%rowtype;prior private.financial_document_policies%rowtype;units text[];kinds text[];
begin
 authority:=private.assert_financial_policy_owner(p_actor,p_company);
 if jsonb_typeof(p_request) is distinct from 'object' or p_request-array['revision','source_document_id','source_sha256','expected_policy_sha256','currency_code','terms','permitted_price_sources','permitted_units']<>'{}'
 or not p_request ?& array['revision','source_document_id','source_sha256','expected_policy_sha256','currency_code','terms','permitted_price_sources','permitted_units']
 or exists(select 1 from unnest(array['revision','source_document_id','source_sha256','currency_code','terms']) k where jsonb_typeof(p_request->k) is distinct from 'string')
 or coalesce(p_request->>'revision','') !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$'
 or p_request->>'source_document_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 or p_request->>'source_sha256' !~ '^sha256:[0-9a-f]{64}$'
 or (jsonb_typeof(p_request->'expected_policy_sha256') is distinct from 'null' and (jsonb_typeof(p_request->'expected_policy_sha256') is distinct from 'string' or p_request->>'expected_policy_sha256' !~ '^sha256:[0-9a-f]{64}$'))
 or p_request->>'currency_code' not in ('CAD','USD')
 or length(p_request->>'terms') not between 1 and 8000 or btrim(p_request->>'terms')<>p_request->>'terms'
 or jsonb_typeof(p_request->'permitted_units') is distinct from 'array' or jsonb_typeof(p_request->'permitted_price_sources') is distinct from 'array'
 then raise exception 'FINANCIAL_POLICY_INPUT_INVALID'; end if;
 if jsonb_array_length(p_request->'permitted_units') not between 1 and 100 or jsonb_array_length(p_request->'permitted_price_sources') not between 1 and 3
 or exists(select 1 from jsonb_array_elements(p_request->'permitted_units') u where jsonb_typeof(u)<>'string' or length(u#>>'{}') not between 1 and 40 or btrim(u#>>'{}')<>u#>>'{}')
 or exists(select 1 from jsonb_array_elements(p_request->'permitted_price_sources') u where jsonb_typeof(u)<>'string' or u#>>'{}' not in ('catalog','historical_line','operator'))
 then raise exception 'FINANCIAL_POLICY_INPUT_INVALID'; end if;
 units:=array(select jsonb_array_elements_text(p_request->'permitted_units'));kinds:=array(select jsonb_array_elements_text(p_request->'permitted_price_sources'));
 if cardinality(units)<>(select count(distinct u) from unnest(units) u) or cardinality(kinds)<>(select count(distinct k) from unnest(kinds) k) then raise exception 'FINANCIAL_POLICY_INPUT_INVALID'; end if;
 select * into company from public.companies where id=p_company;
 if company.currency_code is distinct from p_request->>'currency_code' then raise exception 'FINANCIAL_POLICY_CURRENCY_UNAVAILABLE'; end if;
 select * into prior from private.financial_document_policies where company_id=p_company and status in ('active','conflicting');
 if (case when prior.id is null then null else private.financial_document_hash(to_jsonb(prior)) end) is distinct from p_request->>'expected_policy_sha256' then raise exception 'FINANCIAL_POLICY_PRIOR_STALE'; end if;
 select n.* into source from public.project_notes n join public.projects j on j.id::text=n.project_id and j.company_id=p_company and j.deleted_at is null
 join public.users u on u.id::text=n.author_id and u.company_id=p_company
 where n.id=(p_request->>'source_document_id')::uuid and n.company_id=p_company::text and n.deleted_at is null;
 if source.id is null or source.content is null or length(source.content) not between 1 and 32000 or private.financial_document_hash(to_jsonb(source)) is distinct from p_request->>'source_sha256' then raise exception 'FINANCIAL_POLICY_SOURCE_STALE'; end if;
 if (select count(*) from public.tax_rates where company_id=p_company and is_active and is_default)<>1 then raise exception 'FINANCIAL_POLICY_TAX_UNAVAILABLE'; end if;
 select * into tax from public.tax_rates where company_id=p_company and is_active and is_default;
 if tax.rate is null or tax.rate::text in ('NaN','Infinity','-Infinity') or tax.rate<0 or tax.rate>1 then raise exception 'FINANCIAL_POLICY_TAX_UNAVAILABLE'; end if;
 return jsonb_build_object('authority',authority,'owner',p_actor,'company',jsonb_build_object('id',company.id,'name',company.name,'currency',company.currency_code,'owner',company.account_holder_id),
 'source',to_jsonb(source),'tax',to_jsonb(tax),'prior',case when prior.id is null then null else to_jsonb(prior) end);
end $$;

create function public.preview_financial_policy_as_actor(p_actor uuid,p_company uuid,p_request jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set timezone='UTC' as $$
declare ctx jsonb;preview jsonb;seal text;id uuid:=extensions.gen_random_uuid();expires timestamptz:=clock_timestamp()+interval '15 minutes';operator_name text;
begin
 ctx:=private.financial_policy_context(p_actor,p_company,p_request);
 if exists(select 1 from private.financial_document_policies where company_id=p_company and revision=p_request->>'revision') then raise exception 'FINANCIAL_POLICY_REVISION_EXISTS';end if;
 if (select count(*) from private.financial_policy_previews where company_id=p_company and created_at>clock_timestamp()-interval '1 minute')>=10 then raise exception 'FINANCIAL_POLICY_RATE_LIMITED'; end if;
 select concat_ws(' ',u.first_name,u.last_name) into operator_name from public.users u where u.id=p_actor;
 preview:=jsonb_build_object('operation','enroll','company_id',p_company,'actor_user_id',p_actor,'company_name',ctx#>>'{company,name}','operator_name',operator_name,'policy',p_request,
 'source',jsonb_build_object('id',ctx#>>'{source,id}','project_id',ctx#>>'{source,project_id}','author_id',ctx#>>'{source,author_id}','content',ctx#>>'{source,content}','sha256',p_request->>'source_sha256'),
 'tax',jsonb_build_object('id',ctx#>>'{tax,id}','name',ctx#>>'{tax,name}','rate',ctx#>>'{tax,rate}'),'preparation_only',true);
 seal:=private.financial_document_hash(jsonb_build_object('id',id,'preview',preview,'context',ctx,'expires_at',expires));
 preview:=preview||jsonb_build_object('preview_id',id,'preview_sha256',seal,'expires_at',expires);
 insert into private.financial_policy_previews(id,company_id,actor_user_id,operation,request,context,preview,preview_sha256,expires_at) values(id,p_company,p_actor,'enroll',p_request,ctx,preview,seal,expires);
 return preview;
end $$;

create function public.enroll_financial_policy_as_actor(p_actor uuid,p_company uuid,p_preview uuid,p_sha256 text) returns jsonb
language plpgsql volatile security definer set search_path='' set timezone='UTC' as $$
declare p private.financial_policy_previews%rowtype;policy private.financial_document_policies%rowtype;ctx jsonb;r jsonb;
begin
 perform private.assert_financial_policy_owner(p_actor,p_company);
 select * into p from private.financial_policy_previews where id=p_preview and actor_user_id=p_actor and company_id=p_company for update nowait;
 if not found or p.operation<>'enroll' or p.preview_sha256 is distinct from p_sha256 then raise exception 'FINANCIAL_POLICY_PREVIEW_UNAVAILABLE';end if;
 if p.consumed_at is not null then
  select * into policy from private.financial_document_policies where approval_preview_id=p.id and status='active';
  if policy.id is null or private.financial_document_hash(to_jsonb(policy)) is distinct from p.receipt->>'policy_sha256' then raise exception 'FINANCIAL_POLICY_REPLAY_STALE'; end if;
  -- Ignore the consumed preview's previous-policy pointer only; all live source,
  -- tax, company and authority evidence must still match its exact snapshot.
  ctx:=private.financial_policy_context(p_actor,p_company,jsonb_set(p.request,'{expected_policy_sha256}',to_jsonb(private.financial_document_hash(to_jsonb(policy)))));
  if ctx-'prior' is distinct from p.context-'prior' then raise exception 'FINANCIAL_POLICY_SOURCE_STALE';end if;
  return p.receipt||jsonb_build_object('replayed',true);
 end if;
 if p.expires_at<=clock_timestamp() then raise exception 'FINANCIAL_POLICY_PREVIEW_EXPIRED';end if;
 ctx:=private.financial_policy_context(p_actor,p_company,p.request);
 if ctx is distinct from p.context then raise exception 'FINANCIAL_POLICY_SOURCE_STALE';end if;
 update private.financial_document_policies set status='retired' where company_id=p_company and status in ('active','conflicting');
 insert into private.financial_document_policies(company_id,revision,status,currency_code,terms,permitted_price_sources,permitted_units,source_document_id,source_sha256,approved_by,approved_at,approval_preview_id)
 values(p_company,p.request->>'revision','active',p.request->>'currency_code',p.request->>'terms',array(select jsonb_array_elements_text(p.request->'permitted_price_sources')),array(select jsonb_array_elements_text(p.request->'permitted_units')),
 (p.request->>'source_document_id')::uuid,p.request->>'source_sha256',p_actor,clock_timestamp(),p.id) returning * into policy;
 r:=jsonb_build_object('operation','enroll','preview_id',p.id,'policy_id',policy.id,'policy_sha256',private.financial_document_hash(to_jsonb(policy)),'revision',policy.revision,'source_sha256',policy.source_sha256,'actor_user_id',p_actor,'company_id',p_company,'preparation_only',true,'financial_documents_created',0,'completed_at',clock_timestamp(),'replayed',false);
 update private.financial_policy_previews set consumed_at=clock_timestamp(),receipt=r where id=p.id;
 insert into public.notifications(user_id,company_id,type,title,body,is_read,persistent,action_url,action_label,dedupe_key)
 values(p_actor::text,p_company::text,'agent_suggestion','Financial rules enrolled','Draft preparation follows the approved rules. Every draft save still requires approval.',false,false,'/settings/financial-policy','VIEW RULES','financial-policy:'||p.id::text);
 return r;
end $$;

-- Exact revocation remains possible when the policy's original source is gone.
create function public.revoke_financial_policy_as_actor(p_actor uuid,p_company uuid,p_policy uuid,p_sha256 text) returns jsonb
language plpgsql volatile security definer set search_path='' set timezone='UTC' as $$
declare policy private.financial_document_policies%rowtype;p private.financial_policy_previews%rowtype;r jsonb;id uuid:=extensions.gen_random_uuid();authority text;
begin
 authority:=private.assert_financial_policy_owner(p_actor,p_company);
 select fp.* into policy from private.financial_document_policies fp where fp.id=p_policy and fp.company_id=p_company for update nowait;
 if not found then raise exception 'FINANCIAL_POLICY_UNAVAILABLE';end if;
 select * into p from private.financial_policy_previews where operation='revoke' and actor_user_id=p_actor and company_id=p_company and request=jsonb_build_object('policy_id',p_policy,'policy_sha256',p_sha256);
 if found and policy.status='retired' then return p.receipt||jsonb_build_object('replayed',true);end if;
 if policy.status not in ('active','conflicting') or private.financial_document_hash(to_jsonb(policy)) is distinct from p_sha256 then raise exception 'FINANCIAL_POLICY_PRIOR_STALE';end if;
 update private.financial_document_policies fp set status='retired' where fp.id=p_policy returning * into policy;
 r:=jsonb_build_object('operation','revoke','preview_id',id,'policy_id',policy.id,'policy_sha256',private.financial_document_hash(to_jsonb(policy)),'revision',policy.revision,'source_sha256',policy.source_sha256,'actor_user_id',p_actor,'company_id',p_company,'preparation_only',true,'financial_documents_created',0,'completed_at',clock_timestamp(),'replayed',false);
 insert into private.financial_policy_previews(id,company_id,actor_user_id,operation,request,context,preview,preview_sha256,expires_at,consumed_at,receipt)
 values(id,p_company,p_actor,'revoke',jsonb_build_object('policy_id',p_policy,'policy_sha256',p_sha256),jsonb_build_object('authority',authority),to_jsonb(policy),p_sha256,clock_timestamp(),clock_timestamp(),r);
 insert into public.notifications(user_id,company_id,type,title,body,is_read,persistent,action_url,action_label,dedupe_key)
 values(p_actor::text,p_company::text,'agent_suggestion','Financial rules revoked','Preparation is stopped. Existing private drafts remain held.',false,false,'/settings/financial-policy','VIEW RULES','financial-policy:'||id::text);
 return r;
end $$;

create function public.get_financial_policy_readiness_as_actor(p_actor uuid,p_company uuid,p_source uuid default null) returns jsonb
language plpgsql volatile security definer set search_path='' set timezone='UTC' as $$
declare policy private.financial_document_policies%rowtype;company public.companies%rowtype;n public.project_notes%rowtype;blocks text[]:='{}';source jsonb;operator_name text;
begin
 perform private.assert_financial_policy_owner(p_actor,p_company);
 select * into company from public.companies where id=p_company;
 select concat_ws(' ',u.first_name,u.last_name) into operator_name from public.users u where u.id=p_actor;
 select * into policy from private.financial_document_policies where company_id=p_company and status in ('active','conflicting');
 if policy.id is null then blocks:=array_append(blocks,'POLICY_MISSING');elsif policy.status='conflicting' then blocks:=array_append(blocks,'POLICY_CONFLICTING');end if;
 if company.currency_code is null or company.currency_code not in ('CAD','USD') then blocks:=array_append(blocks,'CURRENCY_UNSUPPORTED');end if;
 if (select count(*) from public.tax_rates where company_id=p_company and is_active and is_default)<>1
 or not exists(select 1 from public.tax_rates where company_id=p_company and is_active and is_default and rate between 0 and 1 and rate::text not in ('NaN','Infinity','-Infinity'))
 or (policy.id is not null and not exists(select 1 from private.financial_policy_previews fp join public.tax_rates tr on tr.company_id=p_company and tr.is_active and tr.is_default where fp.id=policy.approval_preview_id and fp.context->'tax'=to_jsonb(tr)))
 then blocks:=array_append(blocks,'TAX_UNAVAILABLE');end if;
 if not exists(select 1 from private.financial_document_effect_policy where revision='financial-document-draft:2026-09-07.v1' and effect_revision=private.financial_document_effect_revision()) then blocks:=array_append(blocks,'EFFECT_REVIEW_REQUIRED');end if;
 if policy.id is not null and (policy.approved_by is distinct from p_actor or policy.currency_code is distinct from company.currency_code or not exists(select 1 from public.project_notes pn join public.projects j on j.id::text=pn.project_id and j.company_id=p_company and j.deleted_at is null where pn.id=policy.source_document_id and pn.company_id=p_company::text and pn.deleted_at is null and private.financial_document_hash(to_jsonb(pn))=policy.source_sha256)) then blocks:=array_append(blocks,'SOURCE_STALE');end if;
 select pn.* into n from public.project_notes pn join public.projects j on j.id::text=pn.project_id and j.company_id=p_company and j.deleted_at is null
 where pn.id=coalesce(p_source,policy.source_document_id) and pn.company_id=p_company::text and pn.deleted_at is null;
 if n.id is not null and n.author_id is not null and n.content is not null and length(n.content)<=32000 then source:=jsonb_build_object('id',n.id,'project_id',n.project_id,'author_id',n.author_id,'content',n.content,'sha256',private.financial_document_hash(to_jsonb(n)));end if;
 return jsonb_build_object('company_id',p_company,'company_name',company.name,'actor_user_id',p_actor,'operator_name',operator_name,'currency_code',company.currency_code,
 'policy',case when policy.id is null then null else jsonb_build_object('id',policy.id,'revision',policy.revision,'sha256',private.financial_document_hash(to_jsonb(policy)),'status',policy.status,'source_document_id',policy.source_document_id) end,
 'source',source,'blockers',to_jsonb(blocks),'preparation_only',true);
end $$;

create function private.guard_financial_policy_revision() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or (to_jsonb(new)-'status') is distinct from (to_jsonb(old)-'status') or old.status='retired' or new.status<>'retired' then raise exception 'FINANCIAL_POLICY_REVISION_IMMUTABLE';end if;
 return new;
end $$;
create trigger financial_policy_revision_immutable before update or delete on private.financial_document_policies for each row execute function private.guard_financial_policy_revision();

-- Reviewed, exact splice adds enrollment proof to the existing source gate.
-- Any unexpected Phase15 definition aborts this migration; its effect seal is NOT renewed.
do $$ declare definition text;needle text:='-- The exact attributable policy source must remain readable and unchanged.';begin
 if md5(pg_get_functiondef('private.financial_document_source(uuid,uuid,jsonb)'::regprocedure))<>'45bcfccd1d5b2f9203cf0113022d3ada' then raise exception 'FINANCIAL_POLICY_SOURCE_DEFINITION_DRIFT';end if;
 definition:=pg_get_functiondef('private.financial_document_source(uuid,uuid,jsonb)'::regprocedure);
 if strpos(definition,needle)=0 then raise exception 'FINANCIAL_POLICY_SOURCE_DEFINITION_DRIFT';end if;
 execute replace(definition,needle,$splice$
 if policy.approved_by is null or policy.approval_preview_id is null or not exists(
 select 1 from public.companies c join public.users u on u.id=policy.approved_by and u.company_id=c.id and u.is_active and u.deleted_at is null
 join private.financial_policy_previews fp on fp.id=policy.approval_preview_id and fp.actor_user_id=u.id and fp.company_id=c.id and fp.operation='enroll' and fp.consumed_at is not null
 where c.id=p_company and lower(c.account_holder_id)=u.id::text and c.deleted_at is null
 and fp.receipt->>'policy_sha256'=private.financial_document_hash(to_jsonb(policy))
 and (select count(*) from public.tax_rates tr where tr.company_id=p_company and tr.is_active and tr.is_default)=1
 and fp.context->'tax'=(select to_jsonb(tr) from public.tax_rates tr where tr.company_id=p_company and tr.is_active and tr.is_default)) then raise exception 'FINANCIAL_DOCUMENT_POLICY_APPROVAL_UNAVAILABLE';end if;
 -- The exact attributable policy source must remain readable and unchanged.
 $splice$);
end $$;

revoke all on function private.assert_financial_policy_owner(uuid,uuid),private.financial_policy_context(uuid,uuid,jsonb),private.guard_financial_policy_revision() from public,anon,authenticated,service_role;
revoke all on function public.preview_financial_policy_as_actor(uuid,uuid,jsonb),public.enroll_financial_policy_as_actor(uuid,uuid,uuid,text),public.revoke_financial_policy_as_actor(uuid,uuid,uuid,text),public.get_financial_policy_readiness_as_actor(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.preview_financial_policy_as_actor(uuid,uuid,jsonb),public.enroll_financial_policy_as_actor(uuid,uuid,uuid,text),public.revoke_financial_policy_as_actor(uuid,uuid,uuid,text),public.get_financial_policy_readiness_as_actor(uuid,uuid,uuid) to service_role;
commit;
