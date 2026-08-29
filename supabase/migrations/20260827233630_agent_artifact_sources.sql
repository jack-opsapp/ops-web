begin;

-- TASK 10 CANONICAL ARTIFACT SOURCE BODY.
-- The generated agent_artifact_sources migration is an exact byte copy.
-- Every index below is exercised by the checked-in PostgreSQL 17 hostile plan
-- fixture. Legacy UUID text is normalized with built-ins so index maintenance
-- never depends on EXECUTE access to a private helper.
do $prerequisites$
declare
  v_missing text[];
begin
  select pg_catalog.array_agg(required.object_name order by required.object_name)
    into v_missing
  from (
    values
      ('table', 'private.agent_read_domain_revisions'),
      ('table', 'private.agent_read_domains'),
      ('function', 'private.bump_agent_read_domain_revision()'),
      ('function', 'private.advance_agent_read_domain_revisions(uuid[],text)'),
      ('table', 'public.attachment_inspections'),
      ('table', 'public.deck_designs'),
      ('table', 'public.email_attachment_inspection_jobs'),
      ('table', 'public.email_attachments'),
      ('table', 'public.email_connections'),
      ('table', 'public.estimates'),
      ('table', 'public.expense_project_allocations'),
      ('table', 'public.expenses'),
      ('table', 'public.invoices'),
      ('table', 'public.opportunities'),
      ('table', 'public.project_notes'),
      ('table', 'public.project_photo_annotations'),
      ('table', 'public.project_photos'),
      ('table', 'public.project_tasks'),
      ('table', 'public.projects'),
      ('table', 'public.site_visit_artifacts'),
      ('table', 'public.site_visits')
  ) required(object_kind, object_name)
  where case required.object_kind
    when 'function' then pg_catalog.to_regprocedure(required.object_name) is null
    else pg_catalog.to_regclass(required.object_name) is null
  end;

  if v_missing is not null then
    raise exception 'agent_artifact_sources_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from private.agent_read_domains domain
    where domain.domain = 'artifacts'
  ) then
    raise exception 'agent_artifact_domain_missing' using errcode = '55000';
  end if;
end;
$prerequisites$;

create index if not exists idx_project_photos_agent_artifact_project_v1
  on public.project_photos (
    pg_catalog.lower(company_id),
    pg_catalog.lower(project_id),
    id
  )
  where deleted_at is null;

create index if not exists idx_project_photo_annotations_agent_artifact_latest_v1
  on public.project_photo_annotations (
    company_id,
    project_id,
    pg_catalog.md5(photo_url),
    coalesce(updated_at, created_at) desc,
    id desc
  )
  where deleted_at is null;

create index if not exists idx_project_notes_agent_artifact_project_v1
  on public.project_notes (
    pg_catalog.lower(company_id),
    pg_catalog.lower(project_id),
    id
  )
  where deleted_at is null and event_kind is null;

create index if not exists idx_projects_agent_artifact_opportunity_v1
  on public.projects (
    company_id,
    coalesce(opportunity_ref::text, pg_catalog.lower(opportunity_id)),
    id
  )
  where deleted_at is null;

-- Task 12 intentionally replays this identical child-source index.
create index if not exists idx_site_visit_artifacts_agent_context_v1
  on public.site_visit_artifacts (
    pg_catalog.lower(company_id),
    site_visit_id,
    captured_at,
    id
  )
  where deleted_at is null;

create index if not exists idx_site_visits_agent_artifact_opportunity_v1
  on public.site_visits (
    pg_catalog.lower(company_id),
    opportunity_id,
    id
  )
  where deleted_at is null and opportunity_id is not null;

create index if not exists idx_site_visits_agent_artifact_project_v1
  on public.site_visits (
    pg_catalog.lower(company_id),
    coalesce(project_ref::text, pg_catalog.lower(project_id)),
    id
  )
  where deleted_at is null;

create index if not exists idx_deck_designs_agent_artifact_opportunity_v1
  on public.deck_designs (company_id, opportunity_id, id)
  where deleted_at is null and opportunity_id is not null;

create index if not exists idx_deck_designs_agent_artifact_project_v1
  on public.deck_designs (company_id, project_id, id)
  where deleted_at is null and project_id is not null;

create index if not exists idx_email_attachments_agent_artifact_opportunity_v1
  on public.email_attachments (company_id, opportunity_id, id)
  where attribution_status = 'attributed' and opportunity_id is not null;

create index if not exists idx_email_attachment_inspection_jobs_agent_artifact_v1
  on public.email_attachment_inspection_jobs (company_id, email_attachment_id)
  where email_attachment_id is not null;

create index if not exists idx_attachment_inspections_agent_artifact_v1
  on public.attachment_inspections (
    company_id,
    email_attachment_id,
    connection_id
  )
  where email_attachment_id is not null;

create index if not exists idx_estimates_agent_artifact_opportunity_v1
  on public.estimates (company_id, opportunity_id, id)
  where deleted_at is null
    and opportunity_id is not null
    and nullif(pg_catalog.btrim(pdf_storage_path), '') is not null;

create index if not exists idx_estimates_agent_artifact_project_v1
  on public.estimates (
    company_id,
    coalesce(project_ref::text, pg_catalog.lower(project_id)),
    id
  )
  where deleted_at is null
    and nullif(pg_catalog.btrim(pdf_storage_path), '') is not null;

create index if not exists idx_invoices_agent_artifact_opportunity_v1
  on public.invoices (company_id, opportunity_id, id)
  where deleted_at is null
    and opportunity_id is not null
    and nullif(pg_catalog.btrim(pdf_storage_path), '') is not null;

create index if not exists idx_invoices_agent_artifact_project_v1
  on public.invoices (
    company_id,
    coalesce(project_ref, project_id),
    id
  )
  where deleted_at is null
    and nullif(pg_catalog.btrim(pdf_storage_path), '') is not null;

create index if not exists idx_expense_project_allocations_agent_artifact_project_v1
  on public.expense_project_allocations (
    pg_catalog.lower(project_id),
    expense_id
  );

-- expense_project_allocations has no company column. Resolve both the old and
-- new expense identities before advancing the tenant-local artifact fence.
create or replace function private.bump_agent_artifact_expense_allocation_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_old_expense_id uuid;
  v_new_expense_id uuid;
  v_company_ids uuid[];
begin
  if tg_when is distinct from 'AFTER'
     or tg_level is distinct from 'ROW'
     or tg_op not in ('INSERT', 'UPDATE', 'DELETE')
     or tg_nargs is distinct from 0 then
    raise exception 'agent_artifact_expense_allocation_trigger_misconfigured'
      using errcode = '55000';
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    v_old_expense_id := old.expense_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new_expense_id := new.expense_id;
  end if;

  select pg_catalog.array_agg(source.company_id order by source.company_id)
    into v_company_ids
  from (
    select distinct expense.company_id
    from public.expenses expense
    where expense.id = any(array[v_old_expense_id, v_new_expense_id])
      and expense.company_id is not null
  ) source;

  perform private.advance_agent_read_domain_revisions(
    v_company_ids,
    'artifacts'
  );
  return null;
end;
$function$;

revoke all on function private.bump_agent_artifact_expense_allocation_revision()
  from public, anon, authenticated, service_role;

drop trigger if exists attachment_inspections_bump_agent_artifact_revision
  on public.attachment_inspections;
create trigger attachment_inspections_bump_agent_artifact_revision
after insert or update or delete on public.attachment_inspections
for each row execute function private.bump_agent_read_domain_revision('artifacts', 'company_id');

drop trigger if exists deck_designs_bump_agent_artifact_revision
  on public.deck_designs;
create trigger deck_designs_bump_agent_artifact_revision
after insert or update or delete on public.deck_designs
for each row execute function private.bump_agent_read_domain_revision('artifacts', 'company_id');

drop trigger if exists email_attachment_inspection_jobs_bump_agent_artifact_revision
  on public.email_attachment_inspection_jobs;
create trigger email_attachment_inspection_jobs_bump_agent_artifact_revision
after insert or update or delete on public.email_attachment_inspection_jobs
for each row execute function private.bump_agent_read_domain_revision('artifacts', 'company_id');

drop trigger if exists email_attachments_bump_agent_artifact_revision
  on public.email_attachments;
create trigger email_attachments_bump_agent_artifact_revision
after insert or update or delete on public.email_attachments
for each row execute function private.bump_agent_read_domain_revision('artifacts', 'company_id');

drop trigger if exists email_connections_bump_agent_artifact_revision
  on public.email_connections;
create trigger email_connections_bump_agent_artifact_revision
after insert or update or delete on public.email_connections
for each row execute function private.bump_agent_read_domain_revision('artifacts', 'company_id');

drop trigger if exists estimates_bump_agent_artifact_revision
  on public.estimates;
create trigger estimates_bump_agent_artifact_revision
after insert or update or delete on public.estimates
for each row execute function private.bump_agent_read_domain_revision('artifacts', 'company_id');

drop trigger if exists expenses_bump_agent_artifact_revision
  on public.expenses;
create trigger expenses_bump_agent_artifact_revision
after insert or update or delete on public.expenses
for each row execute function private.bump_agent_read_domain_revision('artifacts', 'company_id');

drop trigger if exists invoices_bump_agent_artifact_revision
  on public.invoices;
create trigger invoices_bump_agent_artifact_revision
after insert or update or delete on public.invoices
for each row execute function private.bump_agent_read_domain_revision('artifacts', 'company_id');

drop trigger if exists opportunities_bump_agent_artifact_revision
  on public.opportunities;
create trigger opportunities_bump_agent_artifact_revision
after insert or update or delete on public.opportunities
for each row execute function private.bump_agent_read_domain_revision('artifacts', 'company_id');

drop trigger if exists project_notes_bump_agent_artifact_revision
  on public.project_notes;
create trigger project_notes_bump_agent_artifact_revision
after insert or update or delete on public.project_notes
for each row execute function private.bump_agent_read_domain_revision('artifacts', 'company_id');

drop trigger if exists project_photo_annotations_bump_agent_artifact_revision
  on public.project_photo_annotations;
create trigger project_photo_annotations_bump_agent_artifact_revision
after insert or update or delete on public.project_photo_annotations
for each row execute function private.bump_agent_read_domain_revision('artifacts', 'company_id');

drop trigger if exists project_photos_bump_agent_artifact_revision
  on public.project_photos;
create trigger project_photos_bump_agent_artifact_revision
after insert or update or delete on public.project_photos
for each row execute function private.bump_agent_read_domain_revision('artifacts', 'company_id');

drop trigger if exists project_tasks_bump_agent_artifact_revision
  on public.project_tasks;
create trigger project_tasks_bump_agent_artifact_revision
after insert or update or delete on public.project_tasks
for each row execute function private.bump_agent_read_domain_revision('artifacts', 'company_id');

drop trigger if exists projects_bump_agent_artifact_revision
  on public.projects;
create trigger projects_bump_agent_artifact_revision
after insert or update or delete on public.projects
for each row execute function private.bump_agent_read_domain_revision('artifacts', 'company_id');

drop trigger if exists site_visit_artifacts_bump_agent_artifact_revision
  on public.site_visit_artifacts;
create trigger site_visit_artifacts_bump_agent_artifact_revision
after insert or update or delete on public.site_visit_artifacts
for each row execute function private.bump_agent_read_domain_revision('artifacts', 'company_id');

drop trigger if exists site_visits_bump_agent_artifact_revision
  on public.site_visits;
create trigger site_visits_bump_agent_artifact_revision
after insert or update or delete on public.site_visits
for each row execute function private.bump_agent_read_domain_revision('artifacts', 'company_id');

drop trigger if exists expense_project_allocations_bump_agent_artifact_revision
  on public.expense_project_allocations;
create trigger expense_project_allocations_bump_agent_artifact_revision
after insert or update or delete on public.expense_project_allocations
for each row execute function private.bump_agent_artifact_expense_allocation_revision();

do $postflight$
declare
  v_table text;
  v_trigger text;
  v_valid boolean;
  v_index record;
begin
  foreach v_table in array array[
    'attachment_inspections',
    'deck_designs',
    'email_attachment_inspection_jobs',
    'email_attachments',
    'email_connections',
    'estimates',
    'expenses',
    'invoices',
    'opportunities',
    'project_notes',
    'project_photo_annotations',
    'project_photos',
    'project_tasks',
    'projects',
    'site_visit_artifacts',
    'site_visits'
  ] loop
    v_trigger := v_table || '_bump_agent_artifact_revision';
    select pg_catalog.count(*) = 1
       and pg_catalog.bool_and(
         trigger_row.tgenabled = 'O'
         and not trigger_row.tgisinternal
         and procedure.proname = 'bump_agent_read_domain_revision'
         and procedure_namespace.nspname = 'private'
         and pg_catalog.encode(trigger_row.tgargs, 'escape') =
           E'artifacts\\000company_id\\000'
       )
      into v_valid
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class relation
      on relation.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    join pg_catalog.pg_proc procedure
      on procedure.oid = trigger_row.tgfoid
    join pg_catalog.pg_namespace procedure_namespace
      on procedure_namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and relation.relname = v_table
      and trigger_row.tgname = v_trigger;

    if not coalesce(v_valid, false) then
      raise exception 'agent_artifact_source_trigger_invalid: %', v_trigger
        using errcode = '55000';
    end if;
  end loop;

  select pg_catalog.count(*) = 1
     and pg_catalog.bool_and(
       trigger_row.tgenabled = 'O'
       and not trigger_row.tgisinternal
       and procedure.proname =
         'bump_agent_artifact_expense_allocation_revision'
       and procedure_namespace.nspname = 'private'
     )
    into v_valid
  from pg_catalog.pg_trigger trigger_row
  join pg_catalog.pg_class relation
    on relation.oid = trigger_row.tgrelid
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  join pg_catalog.pg_proc procedure
    on procedure.oid = trigger_row.tgfoid
  join pg_catalog.pg_namespace procedure_namespace
    on procedure_namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and relation.relname = 'expense_project_allocations'
    and trigger_row.tgname =
      'expense_project_allocations_bump_agent_artifact_revision';

  if not coalesce(v_valid, false) then
    raise exception 'agent_artifact_expense_allocation_trigger_invalid'
      using errcode = '55000';
  end if;

  for v_index in
    select expected.index_name, expected.table_name,
           expected.index_definition
    from (values
      (
        'idx_project_photos_agent_artifact_project_v1',
        'project_photos',
        'CREATE INDEX idx_project_photos_agent_artifact_project_v1 ON public.project_photos USING btree (lower(company_id), lower(project_id), id) WHERE (deleted_at IS NULL)'
      ),
      (
        'idx_project_photo_annotations_agent_artifact_latest_v1',
        'project_photo_annotations',
        'CREATE INDEX idx_project_photo_annotations_agent_artifact_latest_v1 ON public.project_photo_annotations USING btree (company_id, project_id, md5(photo_url), COALESCE(updated_at, created_at) DESC, id DESC) WHERE (deleted_at IS NULL)'
      ),
      (
        'idx_project_notes_agent_artifact_project_v1',
        'project_notes',
        'CREATE INDEX idx_project_notes_agent_artifact_project_v1 ON public.project_notes USING btree (lower(company_id), lower(project_id), id) WHERE ((deleted_at IS NULL) AND (event_kind IS NULL))'
      ),
      (
        'idx_projects_agent_artifact_opportunity_v1',
        'projects',
        'CREATE INDEX idx_projects_agent_artifact_opportunity_v1 ON public.projects USING btree (company_id, COALESCE((opportunity_ref)::text, lower(opportunity_id)), id) WHERE (deleted_at IS NULL)'
      ),
      (
        'idx_site_visit_artifacts_agent_context_v1',
        'site_visit_artifacts',
        'CREATE INDEX idx_site_visit_artifacts_agent_context_v1 ON public.site_visit_artifacts USING btree (lower(company_id), site_visit_id, captured_at, id) WHERE (deleted_at IS NULL)'
      ),
      (
        'idx_site_visits_agent_artifact_opportunity_v1',
        'site_visits',
        'CREATE INDEX idx_site_visits_agent_artifact_opportunity_v1 ON public.site_visits USING btree (lower(company_id), opportunity_id, id) WHERE ((deleted_at IS NULL) AND (opportunity_id IS NOT NULL))'
      ),
      (
        'idx_site_visits_agent_artifact_project_v1',
        'site_visits',
        'CREATE INDEX idx_site_visits_agent_artifact_project_v1 ON public.site_visits USING btree (lower(company_id), COALESCE((project_ref)::text, lower(project_id)), id) WHERE (deleted_at IS NULL)'
      ),
      (
        'idx_deck_designs_agent_artifact_opportunity_v1',
        'deck_designs',
        'CREATE INDEX idx_deck_designs_agent_artifact_opportunity_v1 ON public.deck_designs USING btree (company_id, opportunity_id, id) WHERE ((deleted_at IS NULL) AND (opportunity_id IS NOT NULL))'
      ),
      (
        'idx_deck_designs_agent_artifact_project_v1',
        'deck_designs',
        'CREATE INDEX idx_deck_designs_agent_artifact_project_v1 ON public.deck_designs USING btree (company_id, project_id, id) WHERE ((deleted_at IS NULL) AND (project_id IS NOT NULL))'
      ),
      (
        'idx_email_attachments_agent_artifact_opportunity_v1',
        'email_attachments',
        'CREATE INDEX idx_email_attachments_agent_artifact_opportunity_v1 ON public.email_attachments USING btree (company_id, opportunity_id, id) WHERE ((attribution_status = ''attributed''::text) AND (opportunity_id IS NOT NULL))'
      ),
      (
        'idx_email_attachment_inspection_jobs_agent_artifact_v1',
        'email_attachment_inspection_jobs',
        'CREATE INDEX idx_email_attachment_inspection_jobs_agent_artifact_v1 ON public.email_attachment_inspection_jobs USING btree (company_id, email_attachment_id) WHERE (email_attachment_id IS NOT NULL)'
      ),
      (
        'idx_attachment_inspections_agent_artifact_v1',
        'attachment_inspections',
        'CREATE INDEX idx_attachment_inspections_agent_artifact_v1 ON public.attachment_inspections USING btree (company_id, email_attachment_id, connection_id) WHERE (email_attachment_id IS NOT NULL)'
      ),
      (
        'idx_estimates_agent_artifact_opportunity_v1',
        'estimates',
        'CREATE INDEX idx_estimates_agent_artifact_opportunity_v1 ON public.estimates USING btree (company_id, opportunity_id, id) WHERE ((deleted_at IS NULL) AND (opportunity_id IS NOT NULL) AND (NULLIF(btrim(pdf_storage_path), ''''::text) IS NOT NULL))'
      ),
      (
        'idx_estimates_agent_artifact_project_v1',
        'estimates',
        'CREATE INDEX idx_estimates_agent_artifact_project_v1 ON public.estimates USING btree (company_id, COALESCE((project_ref)::text, lower(project_id)), id) WHERE ((deleted_at IS NULL) AND (NULLIF(btrim(pdf_storage_path), ''''::text) IS NOT NULL))'
      ),
      (
        'idx_invoices_agent_artifact_opportunity_v1',
        'invoices',
        'CREATE INDEX idx_invoices_agent_artifact_opportunity_v1 ON public.invoices USING btree (company_id, opportunity_id, id) WHERE ((deleted_at IS NULL) AND (opportunity_id IS NOT NULL) AND (NULLIF(btrim(pdf_storage_path), ''''::text) IS NOT NULL))'
      ),
      (
        'idx_invoices_agent_artifact_project_v1',
        'invoices',
        'CREATE INDEX idx_invoices_agent_artifact_project_v1 ON public.invoices USING btree (company_id, COALESCE(project_ref, project_id), id) WHERE ((deleted_at IS NULL) AND (NULLIF(btrim(pdf_storage_path), ''''::text) IS NOT NULL))'
      ),
      (
        'idx_expense_project_allocations_agent_artifact_project_v1',
        'expense_project_allocations',
        'CREATE INDEX idx_expense_project_allocations_agent_artifact_project_v1 ON public.expense_project_allocations USING btree (lower(project_id), expense_id)'
      )
    ) expected(index_name, table_name, index_definition)
  loop
    select pg_catalog.count(*) = 1
       and pg_catalog.bool_and(
         index_row.indisvalid
         and index_row.indisready
         and index_row.indislive
         and not index_row.indisunique
         and relation.relname = v_index.table_name
         and namespace.nspname = 'public'
         and pg_catalog.pg_get_indexdef(index_row.indexrelid) =
           v_index.index_definition
       )
      into v_valid
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_row.indexrelid
    join pg_catalog.pg_class relation
      on relation.oid = index_row.indrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where index_relation.relname = v_index.index_name
      and namespace.nspname = 'public';

    if not coalesce(v_valid, false) then
      raise exception 'agent_artifact_source_index_invalid: %',
        v_index.index_name using errcode = '55000';
    end if;
  end loop;
end;
$postflight$;

commit;
