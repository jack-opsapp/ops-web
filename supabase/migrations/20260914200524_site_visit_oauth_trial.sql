-- Exact temporary site-visit trial. This migration creates no clients, consent,
-- grants, compatibility enrollment, effect seals, or business records.
begin;
do $guard$
declare item record;
begin
 lock table private.mcp_oauth_clients,private.mcp_oauth_canary_bindings,
 private.agent_catalog_trial_bindings,private.agent_site_visit_workflow_effect_policy,
 private.site_visit_concurrency_companies in share row exclusive mode nowait;
 if exists(select 1 from private.mcp_oauth_canary_bindings where disabled_at is null and expires_at>statement_timestamp() and exposure_revision='2026-09-07.mcp-exposure.v17')
 or exists(select 1 from private.agent_catalog_trial_bindings where disabled_at is null and expires_at>statement_timestamp())
 or exists(select 1 from private.agent_site_visit_workflow_effect_policy)
 or exists(select 1 from private.site_visit_concurrency_companies) then
  raise exception 'SITE_VISIT_TRIAL_ACTIVE_ROLLOUT_REQUIRES_REVIEW';
 end if;
 for item in select * from (values
 ('private.agent_site_visit_workflow_authorize(jsonb,jsonb,boolean)','fdf39c1f79fe2b580c91fef5923e63b8'),
 ('private.agent_site_visit_workflow_can_read(uuid,uuid,uuid)','271f58a4ff025fae8fcb72304e9a8323'),
 ('private.mcp_oauth_labels_for_scopes(text[],text)','d9c102fabb599ff3e04c4caf61006207'),
 ('private.mcp_oauth_canary_is_current(uuid,uuid,uuid,text,text)','4298af0938e481086ce3b52f8a05da3f'),
 ('public.resolve_mcp_oauth_canary_as_system(uuid,uuid,uuid,text,text)','7d5625606b3db7f12b820bb6eded4043'),
 ('private.enforce_mcp_v3_canary_write()','ef14490819a7a43ebe1a61efe283d4d0'),
 ('public.resolve_mcp_oauth_access_token_as_system(text,text)','4410e5660a3e619b356006a401e18795'),
 ('public.rotate_mcp_oauth_refresh_token_as_system(text,uuid,text[],text,text,timestamptz,timestamptz)','05198075d40718d61cef9070ef763951'),
 ('public.disable_mcp_oauth_canary_as_system(uuid,uuid,uuid)','54b7e11dfc0a64a03dd991626d3bb771')
 ) expected(signature,fingerprint) loop
  if md5(pg_get_functiondef(to_regprocedure(item.signature))) is distinct from item.fingerprint then
   raise exception 'SITE_VISIT_TRIAL_BASELINE_DRIFT: %',item.signature;
  end if;
 end loop;
end $guard$;

create table private.agent_site_visit_trial_bindings (
 id uuid primary key default gen_random_uuid(),
 oauth_client_id uuid not null unique references private.mcp_oauth_clients(client_id),
 actor_user_id uuid not null references public.users(id),
 company_id uuid not null references public.companies(id),
 workflow_effect_sha256 text not null check(workflow_effect_sha256 ~ '^sha256:[0-9a-f]{64}$'),
 authorization_sha256 text not null check(authorization_sha256 ~ '^sha256:[0-9a-f]{64}$'),
 created_at timestamptz not null default statement_timestamp(),
 expires_at timestamptz not null,
 disabled_at timestamptz,
 check(expires_at>created_at and expires_at<=created_at+interval '2 hours')
);
alter table private.agent_site_visit_trial_bindings enable row level security;
alter table private.agent_site_visit_trial_bindings force row level security;
revoke all on private.agent_site_visit_trial_bindings from public,anon,authenticated,service_role;

create function private.agent_site_visit_trial_scopes() returns text[]
language sql immutable set search_path='' as $$
 select array['ops.company.read','ops.correspondence.read','ops.customer_contacts.read','ops.customers.read','ops.files.read','ops.financials.read','ops.jobs.read','ops.photos.read','ops.schedule.read','ops.site_visit_templates.prepare','ops.site_visit_templates.read','ops.site_visits.prepare','ops.site_visits.read','ops.team.read']::text[]
$$;

-- Seal the OAuth lifecycle as well as the separately reviewed business effect.
-- Only definitions and security metadata are hashed; no credentials or rows.
create function private.agent_site_visit_trial_authorization_revision() returns text
language sql stable security definer set search_path='' as $$
 select private.agent_site_visit_workflow_hash(jsonb_build_object(
 'revision','site-visit-oauth-trial:2026-09-14.v1',
 'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'acl',p.proacl,'owner',pg_get_userbyid(p.proowner)) order by p.oid::regprocedure::text)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.prokind='f' and
  (p.proname like '%mcp_oauth%' or p.proname like '%mcp_v3_canary%' or p.proname like '%site_visit_trial%' or p.proname in('resolve_agent_actor_authority','user_is_active_company_member'))),
 'tables',(select jsonb_agg(jsonb_build_object('table',c.oid::regclass::text,'acl',c.relacl,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'owner',pg_get_userbyid(c.relowner)) order by c.oid::regclass::text)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and (c.relname like 'mcp_oauth_%' or c.relname='agent_site_visit_trial_bindings') and c.relkind='r'),
 'columns',(select jsonb_agg(jsonb_build_object('table',a.attrelid::regclass::text,'column',a.attname,'type',format_type(a.atttypid,a.atttypmod),'nullable',not a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attrelid::regclass::text,a.attnum)
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attnum>0 and not a.attisdropped and n.nspname='private' and c.relkind='r' and (c.relname like 'mcp_oauth_%' or c.relname='agent_site_visit_trial_bindings')),
 'constraints',(select jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'name',c.conname,'definition',pg_get_constraintdef(c.oid)) order by c.conrelid::regclass::text,c.conname)
  from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname='private' and(t.relname like 'mcp_oauth_%' or t.relname='agent_site_visit_trial_bindings')),
 'triggers',(select jsonb_agg(jsonb_build_object('definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled,'body',pg_get_functiondef(t.tgfoid)) order by t.tgrelid::regclass::text,t.tgname)
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname='private' and(c.relname like 'mcp_oauth_%' or c.relname='agent_site_visit_trial_bindings')),
 'policies',(select jsonb_agg(jsonb_build_object('table',p.polrelid::regclass::text,'name',p.polname,'command',p.polcmd,'roles',p.polroles,'permissive',p.polpermissive,'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polrelid::regclass::text,p.polname)
  from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and(c.relname like 'mcp_oauth_%' or c.relname='agent_site_visit_trial_bindings'))))
$$;

create function private.agent_site_visit_trial_current(p_client uuid,p_actor uuid,p_company uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from private.agent_site_visit_trial_bindings b
  join private.mcp_oauth_clients c on c.client_id=b.oauth_client_id
  join private.agent_site_visit_workflow_effect_policy e on e.company_id=b.company_id and e.revision='2026-09-10.v1' and e.effect_sha256=b.workflow_effect_sha256
  join private.site_visit_concurrency_companies compatibility on compatibility.company_id=b.company_id::text and compatibility.protocol_revision='site-visit-writes:2026-09-10.v1'
  cross join lateral private.resolve_agent_actor_authority(p_actor,p_company,array['agent.review','settings.integrations'])a
  where b.oauth_client_id=p_client and b.actor_user_id=p_actor and b.company_id=p_company
   and b.disabled_at is null and b.expires_at>statement_timestamp() and c.disabled_at is null
   and c.exposure_revision='2026-09-10.mcp-exposure.v22' and c.consent_catalog_revision='2026-09-10.mcp-consent-catalog.v17'
   and c.scope_ceiling=private.agent_site_visit_trial_scopes() and c.scope=array_to_string(c.scope_ceiling,' ')
   and private.user_is_active_company_member(p_actor,p_company)
   and a.effective_permissions @> '[{"permission":"agent.review","scope":"all"},{"permission":"settings.integrations","scope":"all"}]'::jsonb
   and b.workflow_effect_sha256=private.agent_site_visit_workflow_effect_revision()
   and b.authorization_sha256=private.agent_site_visit_trial_authorization_revision()
 )
$$;

create function private.guard_site_visit_trial_binding() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'SITE_VISIT_TRIAL_BINDING_IMMUTABLE' using errcode='22023';end if;
 perform private.lock_mcp_v3_canary_client(new.oauth_client_id);
 if tg_op='UPDATE' and (
  (to_jsonb(new)-'disabled_at') is distinct from (to_jsonb(old)-'disabled_at')
  or(old.disabled_at is not null and new.disabled_at is distinct from old.disabled_at)
  or(new.disabled_at is not null and new.disabled_at<new.created_at)
 ) then raise exception 'SITE_VISIT_TRIAL_BINDING_IMMUTABLE' using errcode='22023';end if;
 return new;
end $$;
create trigger agent_site_visit_trial_binding_immutable before insert or update or delete
on private.agent_site_visit_trial_bindings for each row execute function private.guard_site_visit_trial_binding();

create function public.provision_site_visit_oauth_trial_as_system(
 p_oauth_client_id uuid,p_actor_user_id uuid,p_company_id uuid,p_expires_at timestamptz,
 p_reviewed_workflow_effect_sha256 text,p_reviewed_authorization_sha256 text
) returns uuid language plpgsql security definer set search_path='' as $$
declare existing private.agent_site_visit_trial_bindings%rowtype;result uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'access_denied' using errcode='42501';end if;
 perform private.lock_mcp_v3_canary_client(p_oauth_client_id);
 lock table private.agent_site_visit_workflow_effect_policy,private.site_visit_concurrency_companies in share mode nowait;
 perform 1 from private.mcp_oauth_clients c where c.client_id=p_oauth_client_id and c.disabled_at is null
  and c.exposure_revision='2026-09-10.mcp-exposure.v22' and c.consent_catalog_revision='2026-09-10.mcp-consent-catalog.v17'
  and c.scope_ceiling=private.agent_site_visit_trial_scopes() and c.scope=array_to_string(c.scope_ceiling,' ') for share nowait;
 if not found or p_expires_at is null or p_expires_at<=clock_timestamp() or p_expires_at>statement_timestamp()+interval '2 hours'
 or p_reviewed_workflow_effect_sha256 is distinct from private.agent_site_visit_workflow_effect_revision()
 or p_reviewed_authorization_sha256 is distinct from private.agent_site_visit_trial_authorization_revision()
 then raise exception 'SITE_VISIT_TRIAL_PROVISION_DENIED' using errcode='42501';end if;
 select * into existing from private.agent_site_visit_trial_bindings where oauth_client_id=p_oauth_client_id for share nowait;
 if found then
  if existing.actor_user_id is distinct from p_actor_user_id or existing.company_id is distinct from p_company_id
  or existing.expires_at is distinct from p_expires_at or existing.workflow_effect_sha256 is distinct from p_reviewed_workflow_effect_sha256
  or existing.authorization_sha256 is distinct from p_reviewed_authorization_sha256
  or not private.agent_site_visit_trial_current(p_oauth_client_id,p_actor_user_id,p_company_id)
  then raise exception 'SITE_VISIT_TRIAL_PROVISION_DENIED' using errcode='42501';end if;
  return existing.id;
 end if;
 if exists(select 1 from private.mcp_oauth_grants where client_id=p_oauth_client_id)
 or exists(select 1 from private.mcp_oauth_canary_bindings where oauth_client_id=p_oauth_client_id)
 or exists(select 1 from private.agent_catalog_trial_bindings where oauth_client_id=p_oauth_client_id)
 or exists(select 1 from private.mcp_oauth_authorization_codes where client_id=p_oauth_client_id)
 or exists(select 1 from private.mcp_oauth_consent_previews where client_id=p_oauth_client_id)
 then raise exception 'SITE_VISIT_TRIAL_PROVISION_DENIED' using errcode='42501';end if;
 insert into private.agent_site_visit_trial_bindings(oauth_client_id,actor_user_id,company_id,workflow_effect_sha256,authorization_sha256,expires_at)
 values(p_oauth_client_id,p_actor_user_id,p_company_id,p_reviewed_workflow_effect_sha256,p_reviewed_authorization_sha256,p_expires_at) returning id into result;
 if not private.agent_site_visit_trial_current(p_oauth_client_id,p_actor_user_id,p_company_id)
 then raise exception 'SITE_VISIT_TRIAL_PROVISION_DENIED' using errcode='42501';end if;
 return result;
end $$;

create function private.agent_site_visit_trial_authorize(ctx jsonb) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
 if ctx->>'channel' is distinct from 'mcp' then raise exception 'SITE_VISIT_TRIAL_REQUIRED' using errcode='42501';end if;
 if nullif(ctx->>'client','') is null then raise exception 'SITE_VISIT_TRIAL_UNAVAILABLE' using errcode='42501';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('ops-mcp-v3-canary:'||(ctx->>'client'),0))
 then raise exception 'SITE_VISIT_TRIAL_BUSY' using errcode='55P03';end if;
 perform 1 from private.agent_site_visit_trial_bindings where oauth_client_id=(ctx->>'client')::uuid for share nowait;
 if not found or not private.agent_site_visit_trial_current((ctx->>'client')::uuid,(ctx->>'actor')::uuid,(ctx->>'company')::uuid)
 then raise exception 'SITE_VISIT_TRIAL_UNAVAILABLE' using errcode='42501';end if;
end $$;
revoke all on function private.agent_site_visit_trial_scopes(),private.agent_site_visit_trial_authorization_revision(),private.agent_site_visit_trial_current(uuid,uuid,uuid),private.guard_site_visit_trial_binding(),private.agent_site_visit_trial_authorize(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.provision_site_visit_oauth_trial_as_system(uuid,uuid,uuid,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.provision_site_visit_oauth_trial_as_system(uuid,uuid,uuid,timestamptz,text,text) to service_role;

-- Exact reviewed deltas preserve every prior branch, function setting and ACL.
-- Each anchor must occur exactly once; the baseline guard above prevents drift.
do $patch$
declare item record;definition text;changed text;
begin
 for item in select * from (values
 ('private.mcp_oauth_labels_for_scopes(text[],text)',
 $old$           case requested.scope$old$,
 $new$           case requested.scope
             when 'ops.site_visit_templates.read' then case when p_consent_catalog_revision='2026-09-10.mcp-consent-catalog.v17' then 'See reusable company site visit checklists and their fields' end
             when 'ops.site_visit_templates.prepare' then case when p_consent_catalog_revision='2026-09-10.mcp-consent-catalog.v17' then 'Prepare reusable site visit checklist and default changes for exact approval in OPS' end
             when 'ops.site_visits.prepare' then case when p_consent_catalog_revision='2026-09-10.mcp-consent-catalog.v17' then 'Prepare site visit bookings, reschedules, cancellations and field answers for exact approval in OPS' end$new$),
 ('private.mcp_oauth_labels_for_scopes(text[],text)',
 $old$    when p_consent_catalog_revision not in ($old$,
 $new$    when p_consent_catalog_revision not in (
           '2026-09-10.mcp-consent-catalog.v17',$new$),
 ('private.mcp_oauth_canary_is_current(uuid,uuid,uuid,text,text)',
 $old$  select (p_exposure_revision='2026-09-08.mcp-exposure.v19'$old$,
 $new$  select (p_exposure_revision='2026-09-10.mcp-exposure.v22' and p_consent_catalog_revision='2026-09-10.mcp-consent-catalog.v17'
    and private.agent_site_visit_trial_current(p_oauth_client_id,p_user_id,p_company_id)) or (p_exposure_revision='2026-09-08.mcp-exposure.v19'$new$),
 ('public.resolve_mcp_oauth_canary_as_system(uuid,uuid,uuid,text,text)',
 $old$    and private.agent_catalog_trial_current(p_oauth_client_id,p_user_id,p_company_id);$old$,
 $new$    and private.agent_catalog_trial_current(p_oauth_client_id,p_user_id,p_company_id)
  union all
  select '2026-09-10.mcp-exposure.v22','2026-09-10.mcp-consent-catalog.v17',binding.expires_at
  from private.agent_site_visit_trial_bindings binding
  where auth.role() is not distinct from 'service_role'
    and binding.oauth_client_id=p_oauth_client_id and binding.actor_user_id=p_user_id and binding.company_id=p_company_id
    and p_exposure_revision='2026-09-10.mcp-exposure.v22' and p_consent_catalog_revision='2026-09-10.mcp-consent-catalog.v17'
    and private.agent_site_visit_trial_current(p_oauth_client_id,p_user_id,p_company_id);$new$),
 ('private.enforce_mcp_v3_canary_write()',
 $old$  if v_exposure_revision='2026-09-08.mcp-exposure.v19' then$old$,
 $new$  if v_exposure_revision='2026-09-10.mcp-exposure.v22' then
    perform private.lock_mcp_v3_canary_client(v_client_id);
    if v_consent_catalog_revision is distinct from '2026-09-10.mcp-consent-catalog.v17' or not private.agent_site_visit_trial_current(v_client_id,v_user_id,v_company_id) then
      raise exception 'SITE_VISIT_TRIAL_UNAVAILABLE' using errcode='42501';
    end if;
  end if;
  if v_exposure_revision='2026-09-08.mcp-exposure.v19' then$new$),
 ('public.resolve_mcp_oauth_access_token_as_system(text,text)',
 $old$        or (grant_record.exposure_revision = '2026-08-30.mcp-exposure.v3'$old$,
 $new$        or (p_active_exposure_revision='2026-09-10.mcp-exposure.v23'
            and grant_record.exposure_revision='2026-09-10.mcp-exposure.v22' and grant_record.consent_catalog_revision='2026-09-10.mcp-consent-catalog.v17'
            and client_record.scope_ceiling=private.agent_site_visit_trial_scopes())
        or (grant_record.exposure_revision = '2026-08-30.mcp-exposure.v3'$new$),
 ('public.resolve_mcp_oauth_access_token_as_system(text,text)',
 $old$grant_record.exposure_revision not in ('2026-08-30.mcp-exposure.v3','2026-09-07.mcp-exposure.v17','2026-09-08.mcp-exposure.v19')$old$,
 $new$grant_record.exposure_revision not in ('2026-08-30.mcp-exposure.v3','2026-09-07.mcp-exposure.v17','2026-09-08.mcp-exposure.v19','2026-09-10.mcp-exposure.v22')$new$),
 ('public.rotate_mcp_oauth_refresh_token_as_system(text,uuid,text[],text,text,timestamptz,timestamptz)',
 $old$client.exposure_revision in ('2026-08-30.mcp-exposure.v3','2026-09-07.mcp-exposure.v17','2026-09-08.mcp-exposure.v19')$old$,
 $new$client.exposure_revision in ('2026-08-30.mcp-exposure.v3','2026-09-07.mcp-exposure.v17','2026-09-08.mcp-exposure.v19','2026-09-10.mcp-exposure.v22')$new$),
 ('public.rotate_mcp_oauth_refresh_token_as_system(text,uuid,text[],text,text,timestamptz,timestamptz)',
 $old$  if v_exposure_revision='2026-09-08.mcp-exposure.v19' then$old$,
 $new$  if v_exposure_revision='2026-09-10.mcp-exposure.v22' then
    if v_consent_catalog_revision is distinct from '2026-09-10.mcp-consent-catalog.v17' or not private.agent_site_visit_trial_current(p_client_id,v_user_id,v_company_id) then
      update private.mcp_oauth_tokens t set revoked_at=coalesce(t.revoked_at,statement_timestamp()) where t.family_id=v_family_id;
      update private.mcp_oauth_grants g set revoked_at=coalesce(g.revoked_at,statement_timestamp()) where g.id=v_grant_id;
      return;
    end if;
    v_effective_grantable_scopes:=private.agent_site_visit_trial_scopes();
  end if;
  if v_exposure_revision='2026-09-08.mcp-exposure.v19' then$new$),
 ('public.disable_mcp_oauth_canary_as_system(uuid,uuid,uuid)',
 $old$  if exists(select 1 from private.agent_catalog_trial_bindings where oauth_client_id=p_oauth_client_id) then$old$,
 $new$  if exists(select 1 from private.agent_site_visit_trial_bindings where oauth_client_id=p_oauth_client_id) then
    update private.agent_site_visit_trial_bindings b set disabled_at=coalesce(b.disabled_at,statement_timestamp())
    where b.oauth_client_id=p_oauth_client_id and b.actor_user_id=p_user_id and b.company_id=p_company_id;
    v_found:=found;
    if not v_found then return false;end if;
    update private.mcp_oauth_clients c set disabled_at=coalesce(c.disabled_at,statement_timestamp()) where c.client_id=p_oauth_client_id and c.exposure_revision='2026-09-10.mcp-exposure.v22';
    update private.mcp_oauth_grants g set revoked_at=coalesce(g.revoked_at,statement_timestamp()) where g.client_id=p_oauth_client_id and g.user_id=p_user_id and g.company_id=p_company_id and g.exposure_revision='2026-09-10.mcp-exposure.v22';
    update private.mcp_oauth_tokens t set revoked_at=coalesce(t.revoked_at,statement_timestamp()) from private.mcp_oauth_grants g where t.grant_id=g.id and g.client_id=p_oauth_client_id and g.user_id=p_user_id and g.company_id=p_company_id and g.exposure_revision='2026-09-10.mcp-exposure.v22';
    return true;
  end if;
  if exists(select 1 from private.agent_catalog_trial_bindings where oauth_client_id=p_oauth_client_id) then$new$),
 ('private.agent_site_visit_workflow_authorize(jsonb,jsonb,boolean)',
 $old$begin
 if actor is null$old$,
 $new$begin
 if p_write or ctx->>'channel'='mcp' then perform private.agent_site_visit_trial_authorize(ctx);end if;
 if actor is null$new$),
 ('private.agent_site_visit_workflow_can_read(uuid,uuid,uuid)',
 $old$ ctx:=p.authority||jsonb_build_object('permission_revision',authority.permission_snapshot_revision,'channel','internal','grant',null,'client',null,'grant_revision',null,'scopes',null);$old$,
 $new$ -- OPS review retains the originating consent and trial while refreshing
 -- current permissions. A review read must not invent an internal write actor.
 ctx:=p.authority||jsonb_build_object('permission_revision',authority.permission_snapshot_revision);$new$)
 ) patch(signature,anchor,replacement) loop
  definition:=pg_get_functiondef(item.signature::regprocedure);
  if (length(definition)-length(replace(definition,item.anchor,'')))/length(item.anchor)<>1 then
   raise exception 'SITE_VISIT_TRIAL_PATCH_ANCHOR_DRIFT: %',item.signature;
  end if;
  changed:=replace(definition,item.anchor,item.replacement);
  execute changed;
 end loop;
end $patch$;
commit;
