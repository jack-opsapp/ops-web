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
  asset_url,
  rendered_asset_url,
  thumbnail_url,
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
    'https://site-visit-purge.invalid/company/f100/artifact.jpg',
    'https://site-visit-purge.invalid/company/f100/artifact-rendered.jpg',
    'https://site-visit-purge.invalid/company/f100/artifact-thumbnail.jpg',
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
    'https://site-visit-purge.invalid/company/f200/artifact.jpg',
    'https://site-visit-purge.invalid/company/f200/artifact-rendered.jpg',
    'https://site-visit-purge.invalid/company/f200/artifact-thumbnail.jpg',
    now(),
    'site-visit-purge-contract'
  );

insert into public.activities (
  id,
  company_id,
  type,
  subject,
  site_visit_id
) values
  (
    'f1140000-0000-4000-8000-000000000114',
    'f1000000-0000-4000-8000-000000000001',
    'site_visit',
    'Target site visit completed',
    'f1100000-0000-4000-8000-000000000011'
  ),
  (
    'f2250000-0000-4000-8000-000000000225',
    'f2000000-0000-4000-8000-000000000002',
    'site_visit',
    'Cross tenant site visit completed',
    'f2200000-0000-4000-8000-000000000022'
  );

update public.site_visits
   set activity_id = case id
     when 'f1100000-0000-4000-8000-000000000011'::uuid
       then 'f1140000-0000-4000-8000-000000000114'::uuid
     when 'f2200000-0000-4000-8000-000000000022'::uuid
       then 'f2250000-0000-4000-8000-000000000225'::uuid
   end
 where id in (
   'f1100000-0000-4000-8000-000000000011'::uuid,
   'f2200000-0000-4000-8000-000000000022'::uuid
 );

insert into public.project_photos (
  id,
  project_id,
  company_id,
  url,
  thumbnail_url,
  rendered_url,
  source,
  site_visit_id,
  uploaded_by
) values
  (
    'f1150000-0000-4000-8000-000000000115',
    'site-visit-purge-project-target',
    'f1000000-0000-4000-8000-000000000001',
    'https://site-visit-purge.invalid/company/f100/project-photo.jpg',
    'https://site-visit-purge.invalid/company/f100/project-photo-thumbnail.jpg',
    'https://site-visit-purge.invalid/company/f100/project-photo-rendered.jpg',
    'site_visit',
    'f1100000-0000-4000-8000-000000000011',
    'site-visit-purge-contract'
  ),
  (
    'f2260000-0000-4000-8000-000000000226',
    'site-visit-purge-project-cross-tenant',
    'f2000000-0000-4000-8000-000000000002',
    'https://site-visit-purge.invalid/company/f200/project-photo.jpg',
    'https://site-visit-purge.invalid/company/f200/project-photo-thumbnail.jpg',
    'https://site-visit-purge.invalid/company/f200/project-photo-rendered.jpg',
    'site_visit',
    'f2200000-0000-4000-8000-000000000022',
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
        'table', 'activities',
        'scope', 'company',
        'companyColumn', 'company_id',
        'companyColumnType', 'uuid',
        'softDeletable', false,
        'deleteStrategy', 'hard',
        'export', true,
        'definer_purged', false
      ),
      jsonb_build_object(
        'table', 'project_photos',
        'scope', 'company',
        'companyColumn', 'company_id',
        'companyColumnType', 'text',
        'softDeletable', true,
        'deleteStrategy', 'soft',
        'export', true,
        'definer_purged', false
      ),
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
  ) or exists (
    select 1
      from public.project_photos
     where company_id = 'f1000000-0000-4000-8000-000000000001'
       and deleted_at is null
  ) then
    raise exception 'target site-visit data survived tenant purge';
  end if;

  if exists (
    select 1
      from public.activities
     where company_id = 'f1000000-0000-4000-8000-000000000001'::uuid
  ) then
    raise exception 'target site-visit completion activity survived hard purge';
  end if;

  if (select count(*)
        from public.site_visit_artifacts
       where company_id = 'f1000000-0000-4000-8000-000000000001'
         and deleted_at is not null) <> 1
     or (select count(*)
           from public.site_visit_checklist_answers
          where company_id = 'f1000000-0000-4000-8000-000000000001'
            and deleted_at is not null) <> 1
     or (select count(*)
           from public.site_visit_identity_drafts
          where company_id = 'f1000000-0000-4000-8000-000000000001'
            and deleted_at is not null) <> 1
     or (select count(*)
           from public.project_photos
          where company_id = 'f1000000-0000-4000-8000-000000000001'
            and deleted_at is not null) <> 1
     or (select count(*)
           from public.site_visits
          where company_id = 'f1000000-0000-4000-8000-000000000001'
            and deleted_at is not null) <> 1 then
    raise exception 'target site-visit soft-delete shape was not preserved';
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
  ) or not exists (
    select 1
      from public.activities
     where company_id = 'f2000000-0000-4000-8000-000000000002'::uuid
       and site_visit_id = 'f2200000-0000-4000-8000-000000000022'::uuid
  ) or not exists (
    select 1
      from public.project_photos
     where company_id = 'f2000000-0000-4000-8000-000000000002'
       and site_visit_id = 'f2200000-0000-4000-8000-000000000022'::uuid
       and url = 'https://site-visit-purge.invalid/company/f200/project-photo.jpg'
       and thumbnail_url = 'https://site-visit-purge.invalid/company/f200/project-photo-thumbnail.jpg'
       and rendered_url = 'https://site-visit-purge.invalid/company/f200/project-photo-rendered.jpg'
       and deleted_at is null
  ) then
    raise exception 'cross_tenant site-visit data changed during tenant purge';
  end if;

  if not exists (
    select 1
      from public.site_visit_artifacts
     where company_id = 'f2000000-0000-4000-8000-000000000002'
       and asset_url = 'https://site-visit-purge.invalid/company/f200/artifact.jpg'
       and rendered_asset_url = 'https://site-visit-purge.invalid/company/f200/artifact-rendered.jpg'
       and thumbnail_url = 'https://site-visit-purge.invalid/company/f200/artifact-thumbnail.jpg'
       and deleted_at is null
  ) then
    raise exception 'cross_tenant site-visit media links changed during tenant purge';
  end if;

  if coalesce(
    pg_catalog.current_setting('ops.company_data_purge_company_id', true),
    ''
  ) <> '' then
    raise exception 'account-closure company marker leaked after tenant purge';
  end if;

  if coalesce(
    pg_catalog.current_setting('request.jwt.claims', true),
    ''
  ) <> '' then
    raise exception 'tenant purge did not retain maintenance-safe empty claims';
  end if;
end;
$assertions$;

rollback;
