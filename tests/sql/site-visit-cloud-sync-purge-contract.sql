-- Rollback-only tenant-erasure rehearsal for the normalized site-visit data.
-- Run after the cloud-sync migration and the transactional purge migration.

begin;

insert into public.companies (
  id,
  bubble_id,
  name,
  subscription_status,
  subscription_plan
) values
  (
    'f1000000-0000-4000-8000-000000000001',
    'site-visit-purge-target',
    'Site Visit Purge Target',
    'trial',
    'trial'
  ),
  (
    'f2000000-0000-4000-8000-000000000002',
    'site-visit-purge-cross-tenant',
    'Site Visit Purge Cross Tenant',
    'trial',
    'trial'
  );

insert into public.site_visits (
  id,
  company_id,
  scheduled_at,
  created_by
) values
  (
    'f1100000-0000-4000-8000-000000000011',
    'f1000000-0000-4000-8000-000000000001',
    now(),
    'site-visit-purge-contract'
  ),
  (
    'f2200000-0000-4000-8000-000000000022',
    'f2000000-0000-4000-8000-000000000002',
    now(),
    'site-visit-purge-contract'
  );

insert into public.site_visit_artifacts (
  id,
  site_visit_id,
  company_id,
  kind,
  source,
  body,
  captured_at,
  created_by
) values
  (
    'f1110000-0000-4000-8000-000000000111',
    'f1100000-0000-4000-8000-000000000011',
    'f1000000-0000-4000-8000-000000000001',
    'note',
    'keyboard',
    'target artifact',
    now(),
    'site-visit-purge-contract'
  ),
  (
    'f2220000-0000-4000-8000-000000000222',
    'f2200000-0000-4000-8000-000000000022',
    'f2000000-0000-4000-8000-000000000002',
    'note',
    'keyboard',
    'cross_tenant artifact',
    now(),
    'site-visit-purge-contract'
  );

insert into public.site_visit_checklist_answers (
  id,
  site_visit_id,
  company_id,
  field_id,
  label,
  kind,
  answer_value,
  created_by
) values
  (
    'f1120000-0000-4000-8000-000000000112',
    'f1100000-0000-4000-8000-000000000011',
    'f1000000-0000-4000-8000-000000000001',
    'access-clear',
    'Access clear',
    'checkbox',
    '{"boolValue": true}'::jsonb,
    'site-visit-purge-contract'
  ),
  (
    'f2230000-0000-4000-8000-000000000223',
    'f2200000-0000-4000-8000-000000000022',
    'f2000000-0000-4000-8000-000000000002',
    'access-clear',
    'Access clear',
    'checkbox',
    '{"boolValue": true}'::jsonb,
    'site-visit-purge-contract'
  );

insert into public.site_visit_identity_drafts (
  id,
  site_visit_id,
  company_id,
  client_name,
  created_by
) values
  (
    'f1130000-0000-4000-8000-000000000113',
    'f1100000-0000-4000-8000-000000000011',
    'f1000000-0000-4000-8000-000000000001',
    'Target client',
    'site-visit-purge-contract'
  ),
  (
    'f2240000-0000-4000-8000-000000000224',
    'f2200000-0000-4000-8000-000000000022',
    'f2000000-0000-4000-8000-000000000002',
    'Cross tenant client',
    'site-visit-purge-contract'
  );

select public.purge_company_data(
  'f1000000-0000-4000-8000-000000000001'::uuid,
  jsonb_build_object(
    'manifest_version', '2026-08-01',
    'cycle_breakers', '[]'::jsonb,
    'steps', jsonb_build_array(
      jsonb_build_object(
        'table', 'site_visit_artifacts',
        'scope', 'company',
        'companyColumn', 'company_id',
        'companyColumnType', 'text',
        'softDeletable', true,
        'deleteStrategy', 'soft',
        'export', true,
        'definer_purged', false
      ),
      jsonb_build_object(
        'table', 'site_visit_checklist_answers',
        'scope', 'company',
        'companyColumn', 'company_id',
        'companyColumnType', 'text',
        'softDeletable', true,
        'deleteStrategy', 'soft',
        'export', true,
        'definer_purged', false
      ),
      jsonb_build_object(
        'table', 'site_visit_identity_drafts',
        'scope', 'company',
        'companyColumn', 'company_id',
        'companyColumnType', 'text',
        'softDeletable', true,
        'deleteStrategy', 'soft',
        'export', true,
        'definer_purged', false
      ),
      jsonb_build_object(
        'table', 'site_visits',
        'scope', 'company',
        'companyColumn', 'company_id',
        'companyColumnType', 'text',
        'softDeletable', true,
        'deleteStrategy', 'soft',
        'export', true,
        'definer_purged', false
      ),
      jsonb_build_object(
        'table', 'companies',
        'scope', 'company',
        'companyColumn', 'id',
        'companyColumnType', 'uuid',
        'softDeletable', true,
        'deleteStrategy', 'soft',
        'export', true,
        'definer_purged', false
      )
    )
  )
);

do $assertions$
begin
  if exists (
    select 1
      from public.site_visit_artifacts
     where company_id = 'f1000000-0000-4000-8000-000000000001'
       and deleted_at is null
  ) or exists (
    select 1
      from public.site_visit_checklist_answers
     where company_id = 'f1000000-0000-4000-8000-000000000001'
       and deleted_at is null
  ) or exists (
    select 1
      from public.site_visit_identity_drafts
     where company_id = 'f1000000-0000-4000-8000-000000000001'
       and deleted_at is null
  ) or exists (
    select 1
      from public.site_visits
     where company_id = 'f1000000-0000-4000-8000-000000000001'
       and deleted_at is null
  ) then
    raise exception 'target site-visit data survived tenant purge';
  end if;

  if not exists (
    select 1
      from public.site_visit_artifacts
     where company_id = 'f2000000-0000-4000-8000-000000000002'
       and deleted_at is null
  ) or not exists (
    select 1
      from public.site_visit_checklist_answers
     where company_id = 'f2000000-0000-4000-8000-000000000002'
       and deleted_at is null
  ) or not exists (
    select 1
      from public.site_visit_identity_drafts
     where company_id = 'f2000000-0000-4000-8000-000000000002'
       and deleted_at is null
  ) or not exists (
    select 1
      from public.site_visits
     where company_id = 'f2000000-0000-4000-8000-000000000002'
       and deleted_at is null
  ) then
    raise exception 'cross_tenant site-visit data changed during tenant purge';
  end if;
end;
$assertions$;

rollback;
