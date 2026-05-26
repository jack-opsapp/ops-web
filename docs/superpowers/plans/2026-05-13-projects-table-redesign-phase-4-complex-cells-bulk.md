# Projects Table V2 Phase 4 Complex Cells + Bulk Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Projects Table V2 complex cells and selection-aware bulk action layer: team assignment, photo upload, and bulk status/team/date edits.

**Architecture:** Phase 4 keeps the read model on `public.project_table_rows` and adds focused service/hook/UI slices for task-backed team membership, Supabase Storage-backed photo uploads, and bulk mutations. Team writes remain RPC-only; photo writes use Storage-first with inline cleanup; bulk actions call one safe server path that reports per-project success/failure and feeds one undo entry.

**Tech Stack:** Next.js 15, React 19, Supabase Postgres/RLS/RPC/Storage, TanStack Query/Table/Virtual, Zustand auth state, Radix Popover/Dropdown/Dialog, Lucide React, OPS design system v2, Vitest, React Testing Library, Playwright/browser verification.

---

## PM Check-In Protocol

Execution agents work one milestone at a time. At the end of each milestone, stop and report:

- Files changed.
- Exact commands run.
- Pass/fail summary.
- Migration name and whether it was only written or applied.
- Browser observations when a browser gate ran.
- Any blocker or deviation from this plan.

Do not start the next milestone until the PM approves the check-in.

## Source Documents

- Spec: `/Users/jacksonsweet/Projects/OPS/OPS-Web/docs/superpowers/specs/2026-05-12-projects-table-redesign-design.md`
- Phase 3 plan: `/Users/jacksonsweet/Projects/OPS/OPS-Web/docs/superpowers/plans/2026-05-13-projects-table-redesign-phase-3-edit-core.md`
- Root standards: `/Users/jacksonsweet/Projects/OPS/CLAUDE.md`
- OPS-Web standards: `/Users/jacksonsweet/Projects/OPS/OPS-Web/CLAUDE.md`
- OPS design skill: `/Users/jacksonsweet/Projects/OPS/ops-design-system/project/SKILL.md`
- Canonical visual spec: `/Users/jacksonsweet/Projects/OPS/ops-design-system/project/uploads/system.md`
- Bible lifecycle reference: `/Users/jacksonsweet/Projects/OPS/ops-software-bible/10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md`
- Generated schema: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/types/database.types.ts`

## Supabase Verification Notes

Pre-plan MCP check against `ijeekuhbatykdomumfjx` succeeded once and confirmed live `public.photo_source` values:

```text
site_visit, in_progress, completion, other, measurement
```

Schema surprise: `measurement` exists live but is not in the Phase 4 spec text. Phase 4 table uploads still use `source = 'other'`; never write `web`.

Connector blocker: follow-up Supabase MCP calls failed with `ReauthenticationRequired`, then `Unknown tool: supabase_execute_sql` / `unsupported call`. The implementation agent must rerun the preflight SQL in Task 1 before applying any migration. If MCP is still unavailable, stop and ask the PM to fix Supabase connector auth; do not apply Phase 4 DDL from local assumptions alone.

Local cross-checks from committed migrations and generated types:

- `project_photos.uploaded_by` is required.
- `project_photos.project_id` and `company_id` are text/string columns.
- `project_tasks.project_id` is uuid/string typed in TS and `team_member_ids` is `string[] | null`.
- `projects.team_member_ids` is a denormalized cache and must not be written by table code.
- Phase 3 currently grants `anon` execute on `change_project_status` only; team RPCs are intentionally revoked from `anon`.
- No local migration currently creates a Supabase Storage bucket named `project-photos`.

## Scope

In scope:

- `cell-team` with task cascade, create-first-task edge case, and `assign_project_team_member` / `remove_project_team_member`.
- Safe Firebase/anon auth migration so browser table sessions can call team, first-task, photo, and bulk write paths without broad table writes.
- `cell-photos` with Supabase Storage upload, `project_photos` insert/delete, and upload cleanup rules.
- `projects-bulk-bar` with selection-aware status, assignment, due-date, archive, and clear actions. Archive uses the status path to set `archived`; destructive delete is not rendered unless a safe delete RPC is added in this same phase.
- Batch RPC `bulk_update_project_table` for status/team/date changes with per-project results.
- RPC `create_project_table_assignment_task` for the no-task team-assignment edge; do not grant direct browser inserts into `project_tasks`.
- One undo entry per bulk operation.
- Partial bulk failure UI with success/failed counts plus Retry / Discard.
- Selection clear on filter/view changes and selection never applying to hidden rows.
- Bible and dictionary updates.

Out of scope:

- Phase 5 saved-view management: create/rename/share/archive/reset views, URL deep-link management, view persistence controls.
- Column drag reorder/resize persistence unless already needed to fix regressions. The Phase 4 ship gate is complex cells + bulk actions only.
- Writing `projects.team_member_ids` from client code.
- Calling `ProjectService.update()` from table work.

## Non-Negotiables

- Team assignment must go through `assign_project_team_member` and `remove_project_team_member`.
- Do not mutate `projects.team_member_ids` in table client code, services, tests, or fixtures except SQL contract fixtures explicitly checking trigger behavior.
- Do not call `ProjectService.update()` from table code.
- Photo uploads use `project_photos.source = 'other'`.
- Photo uploads pass `project_photos.uploaded_by = useAuthStore.getState().currentUser.id`.
- `project_photos` browser writes require restrictive RLS that composes `private.current_user_can_edit_project`; company isolation alone is not enough.
- Do not grant browser `DELETE` on `project_photos`; photo deletion is soft-delete via `deleted_at` update. Storage blob delete is separate and policy-scoped.
- Do not grant browser `INSERT` on `project_tasks`; create-first-task goes through `create_project_table_assignment_task`.
- Storage failure means no `project_photos` row.
- DB insert failure after Storage success removes the uploaded blob inline before surfacing the error.
- All user-facing strings live in both `src/i18n/dictionaries/en/projects.json` and `src/i18n/dictionaries/es/projects.json`.
- OPS design system v2 only: `.glass-dense` popovers/bulk bar, tokenized colors, 12px modal/popover radius, 5px buttons, one easing curve, no decorative gradients/orbs, no hardcoded English.
- Bulk operations act only on currently visible selected row IDs. Clear selection on active view, search, sort, or filter changes.

## File Map

- Create via CLI: `/Users/jacksonsweet/Projects/OPS/OPS-Web/supabase/migrations/<generated>_projects_table_v2_phase4_complex_cells_bulk.sql`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/sql/projects-table-phase1-contract.sql`
- Modify after migration is applied to a schema: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/types/database.types.ts`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/types/project-table.ts`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/api/query-client.ts`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/api/services/project-table-service.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/api/services/project-table-team-service.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/api/services/project-table-photo-service.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-project-table-team.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-cell-photo-upload.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-projects-bulk-actions.ts`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-cell-edit.ts`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-table-selection.ts`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-table-shell.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-table.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-table-row.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-bulk-bar.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/cells/cell-team.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/cells/cell-photos.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/i18n/dictionaries/en/projects.json`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/i18n/dictionaries/es/projects.json`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/projects-table/project-table-team-service.test.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/projects-table/project-table-photo-service.test.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/projects-table/project-table-bulk-service.test.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/hooks/use-project-table-team.test.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/hooks/use-cell-photo-upload.test.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/hooks/use-projects-bulk-actions.test.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/integration/projects-table-v2-edit-core.test.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/integration/projects-table-v2-phase4.test.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/e2e/projects-table-v2-phase4.spec.ts`
- Modify: `/Users/jacksonsweet/Projects/OPS/ops-software-bible/10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md`

---

### Task 1: Live Preflight + Phase 4 Auth/Storage/Bulk Migration

**Files:**
- Create via CLI: `/Users/jacksonsweet/Projects/OPS/OPS-Web/supabase/migrations/<generated>_projects_table_v2_phase4_complex_cells_bulk.sql`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/sql/projects-table-phase1-contract.sql`
- Modify after apply/typegen: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/types/database.types.ts`

- [ ] **Step 1: Rerun live Supabase preflight via MCP**

Run this read-only SQL through Supabase MCP against `ijeekuhbatykdomumfjx`:

```sql
select
  c.table_name,
  c.ordinal_position,
  c.column_name,
  c.data_type,
  c.udt_name,
  c.is_nullable,
  c.column_default
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in ('project_photos', 'project_tasks', 'projects', 'users')
order by c.table_name, c.ordinal_position;

select
  t.typname as enum_name,
  e.enumlabel as enum_value
from pg_type t
join pg_enum e on e.enumtypid = t.oid
join pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public'
  and t.typname = 'photo_source'
order by e.enumsortorder;

select
  n.nspname,
  p.proname,
  pg_get_function_identity_arguments(p.oid) as args,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
  p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where (n.nspname, p.proname) in (
  ('public', 'assign_project_team_member'),
  ('public', 'remove_project_team_member'),
  ('public', 'change_project_status'),
  ('private', 'current_user_can_assign_team_on_project'),
  ('private', 'current_user_can_edit_project')
)
order by n.nspname, p.proname;

select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname in ('public', 'storage')
  and tablename in ('project_photos', 'project_tasks', 'projects', 'objects')
order by schemaname, tablename, policyname;

select
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
from storage.buckets
where id in ('project-photos', 'images', 'bug-reports')
order by id;

select
  has_table_privilege('anon', 'public.project_photos', 'SELECT') as anon_project_photos_select,
  has_table_privilege('anon', 'public.project_photos', 'INSERT') as anon_project_photos_insert,
  has_table_privilege('anon', 'public.project_photos', 'UPDATE') as anon_project_photos_update,
  has_table_privilege('anon', 'public.project_photos', 'DELETE') as anon_project_photos_delete;
```

Expected:

```text
photo_source includes other and may include measurement.
anon cannot currently execute assign_project_team_member/remove_project_team_member.
project_photos.uploaded_by is NOT NULL.
storage.buckets may not include project-photos.
```

If MCP is unavailable, stop here for PM action. Do not proceed to migration.

- [ ] **Step 2: Create migration file**

Run:

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web
npx supabase migration new projects_table_v2_phase4_complex_cells_bulk
```

Expected: one timestamped migration file exists. Do not hand-invent the timestamp.

- [ ] **Step 3: Add safe auth and Storage DDL**

Add this SQL at the top of the migration, adjusting only if the Step 1 preflight proves the live bucket already exists with equivalent policies:

```sql
begin;

-- OPS-Web browser sessions arrive at PostgREST as anon with Firebase claims.
-- These RPCs are SECURITY DEFINER and enforce scoped project permissions inside
-- the function, so exposing EXECUTE to anon is the required safe browser path.
grant execute on function public.assign_project_team_member(uuid, uuid, uuid[], timestamptz) to anon, authenticated;
grant execute on function public.remove_project_team_member(uuid, uuid, uuid[], timestamptz) to anon, authenticated;

grant select, insert on table public.project_photos to anon, authenticated;
grant update (deleted_at, caption, is_client_visible) on table public.project_photos to anon, authenticated;
grant select on table public.project_tasks to anon, authenticated;
grant select on table public.users to anon, authenticated;

create or replace function private.project_table_project_id_from_text(p_project_id text)
returns uuid
language sql
stable
security definer
set search_path = 'public', 'pg_temp'
as $$
  select case
    when p_project_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then p_project_id::uuid
    else null
  end;
$$;

grant execute on function private.project_table_project_id_from_text(text) to anon, authenticated;

drop policy if exists "project table photos insert requires project edit" on public.project_photos;
create policy "project table photos insert requires project edit"
on public.project_photos
as restrictive
for insert
to public
with check (
  company_id = (select private.get_user_company_id())::text
  and uploaded_by = (select private.get_current_user_id())::text
  and private.project_table_project_id_from_text(project_id) is not null
  and private.current_user_can_edit_project(private.project_table_project_id_from_text(project_id))
);

drop policy if exists "project table photos update requires project edit" on public.project_photos;
create policy "project table photos update requires project edit"
on public.project_photos
as restrictive
for update
to public
using (
  company_id = (select private.get_user_company_id())::text
  and private.project_table_project_id_from_text(project_id) is not null
  and private.current_user_can_edit_project(private.project_table_project_id_from_text(project_id))
)
with check (
  company_id = (select private.get_user_company_id())::text
  and private.project_table_project_id_from_text(project_id) is not null
  and private.current_user_can_edit_project(private.project_table_project_id_from_text(project_id))
);

drop policy if exists "project table photos delete denied" on public.project_photos;
create policy "project table photos delete denied"
on public.project_photos
as restrictive
for delete
to public
using (false);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-photos',
  'project-photos',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "project photos select public" on storage.objects;
create policy "project photos select public"
on storage.objects
for select
to public
using (bucket_id = 'project-photos');

drop policy if exists "project photos insert scoped" on storage.objects;
create policy "project photos insert scoped"
on storage.objects
for insert
to public
with check (
  bucket_id = 'project-photos'
  and (storage.foldername(name))[1] = (select private.get_user_company_id())::text
  and private.project_table_project_id_from_text((storage.foldername(name))[2]) is not null
  and private.current_user_can_edit_project(private.project_table_project_id_from_text((storage.foldername(name))[2]))
);

drop policy if exists "project photos delete scoped" on storage.objects;
create policy "project photos delete scoped"
on storage.objects
for delete
to public
using (
  bucket_id = 'project-photos'
  and (storage.foldername(name))[1] = (select private.get_user_company_id())::text
  and private.project_table_project_id_from_text((storage.foldername(name))[2]) is not null
  and private.current_user_can_edit_project(private.project_table_project_id_from_text((storage.foldername(name))[2]))
);
```

Storage decision: this plan creates a public Supabase Storage bucket so `project_photos.url` can remain a stable public URL and existing gallery surfaces keep rendering. The path is still unguessable (`company/project/uuid.ext`) and DB visibility remains RLS-gated. PM risk review: Supabase Storage usage may affect project storage/egress costs depending on plan and volume.

- [ ] **Step 4: Add first-task and bulk RPCs**

Append this SQL before `commit;`:

```sql
create or replace function public.create_project_table_assignment_task(
  p_project_id uuid,
  p_title text,
  p_expected_updated_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_company_id text;
  v_current_updated_at timestamptz;
  v_task_id uuid;
begin
  if p_project_id is null or p_expected_updated_at is null then
    raise exception 'invalid input' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_title, '')), '') is null then
    raise exception 'task title required' using errcode = '22023';
  end if;

  select p.company_id::text, p.updated_at
    into v_company_id, v_current_updated_at
  from public.projects p
  where p.id = p_project_id
    and p.deleted_at is null
    and p.company_id = (select private.get_user_company_id())::text;

  if v_company_id is null then
    raise exception 'project not found' using errcode = '22023';
  end if;

  if not private.current_user_can_assign_team_on_project(p_project_id) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if v_current_updated_at is distinct from p_expected_updated_at then
    raise exception 'project conflict' using errcode = 'P0001';
  end if;

  insert into public.project_tasks (
    project_id,
    company_id,
    custom_title,
    status,
    display_order,
    team_member_ids
  )
  values (
    p_project_id,
    v_company_id,
    btrim(p_title),
    'active',
    coalesce((
      select max(pt.display_order) + 1
      from public.project_tasks pt
      where pt.project_id = p_project_id
        and pt.deleted_at is null
    ), 0),
    array[]::text[]
  )
  returning id into v_task_id;

  return jsonb_build_object(
    'task_id', v_task_id,
    'updated_at', v_current_updated_at
  );
end;
$$;

revoke execute on function public.create_project_table_assignment_task(uuid, text, timestamptz) from public;
grant execute on function public.create_project_table_assignment_task(uuid, text, timestamptz) to anon, authenticated;

create or replace function public.bulk_update_project_table(
  p_operations jsonb
) returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_operation jsonb;
  v_action text;
  v_project_id uuid;
  v_expected_updated_at timestamptz;
  v_success jsonb := '[]'::jsonb;
  v_failed jsonb := '[]'::jsonb;
  v_result jsonb;
  v_updated_at timestamptz;
begin
  if p_operations is null or jsonb_typeof(p_operations) <> 'array' then
    raise exception 'invalid operations' using errcode = '22023';
  end if;

  if jsonb_array_length(p_operations) > 100 then
    raise exception 'too many operations' using errcode = '22023';
  end if;

  for v_operation in select * from jsonb_array_elements(p_operations)
  loop
    begin
      v_action := v_operation->>'action';
      v_project_id := (v_operation->>'project_id')::uuid;
      v_expected_updated_at := (v_operation->>'expected_updated_at')::timestamptz;

      if v_project_id is null or v_expected_updated_at is null then
        raise exception 'invalid operation' using errcode = '22023';
      end if;

      if v_action = 'status' then
        v_result := public.change_project_status(
          v_project_id,
          v_operation->>'status',
          v_expected_updated_at
        );
        v_updated_at := (v_result->>'updated_at')::timestamptz;

      elsif v_action = 'date' then
        if (v_operation->>'field') not in ('start_date', 'end_date') then
          raise exception 'invalid date field' using errcode = '22023';
        end if;

        if not private.current_user_can_edit_project(v_project_id) then
          raise exception 'permission denied' using errcode = '42501';
        end if;

        if v_operation->>'field' = 'start_date' then
          update public.projects
          set start_date = nullif(v_operation->>'value', '')::date,
              updated_at = now()
          where id = v_project_id
            and deleted_at is null
            and updated_at = v_expected_updated_at
          returning updated_at into v_updated_at;
        else
          update public.projects
          set end_date = nullif(v_operation->>'value', '')::date,
              updated_at = now()
          where id = v_project_id
            and deleted_at is null
            and updated_at = v_expected_updated_at
          returning updated_at into v_updated_at;
        end if;

        if v_updated_at is null then
          raise exception 'project conflict' using errcode = 'P0001';
        end if;

      elsif v_action = 'assign_team' then
        v_result := public.assign_project_team_member(
          v_project_id,
          (v_operation->>'user_id')::uuid,
          array(select jsonb_array_elements_text(v_operation->'task_ids')::uuid),
          v_expected_updated_at
        );
        v_updated_at := (v_result->>'updated_at')::timestamptz;

      elsif v_action = 'remove_team' then
        v_result := public.remove_project_team_member(
          v_project_id,
          (v_operation->>'user_id')::uuid,
          case
            when v_operation ? 'task_ids' and jsonb_typeof(v_operation->'task_ids') = 'array'
              then array(select jsonb_array_elements_text(v_operation->'task_ids')::uuid)
            else null
          end,
          v_expected_updated_at
        );
        v_updated_at := (v_result->>'updated_at')::timestamptz;

      else
        raise exception 'invalid action' using errcode = '22023';
      end if;

      v_success := v_success || jsonb_build_array(jsonb_build_object(
        'project_id', v_project_id,
        'updated_at', v_updated_at,
        'action', v_action
      ));
    exception when others then
      v_failed := v_failed || jsonb_build_array(jsonb_build_object(
        'project_id', coalesce(v_operation->>'project_id', ''),
        'action', coalesce(v_action, v_operation->>'action', ''),
        'code', sqlstate,
        'message', sqlerrm
      ));
    end;
  end loop;

  return jsonb_build_object(
    'success', v_success,
    'failed', v_failed,
    'success_count', jsonb_array_length(v_success),
    'failed_count', jsonb_array_length(v_failed)
  );
end;
$$;

revoke execute on function public.bulk_update_project_table(jsonb) from public;
grant execute on function public.bulk_update_project_table(jsonb) to anon, authenticated;

commit;
```

- [ ] **Step 5: Extend SQL contract tests**

Append checks to `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/sql/projects-table-phase1-contract.sql`:

```sql
select
  'projects_table_v2_phase4_anon_team_rpc_execute' as check_name,
  has_function_privilege('anon', 'public.assign_project_team_member(uuid, uuid, uuid[], timestamp with time zone)', 'EXECUTE')
  and has_function_privilege('anon', 'public.remove_project_team_member(uuid, uuid, uuid[], timestamp with time zone)', 'EXECUTE')
  as passed;

select
  'projects_table_v2_phase4_bulk_rpc_execute' as check_name,
  has_function_privilege('anon', 'public.bulk_update_project_table(jsonb)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.bulk_update_project_table(jsonb)', 'EXECUTE')
  as passed;

select
  'projects_table_v2_phase4_create_assignment_task_rpc_execute' as check_name,
  has_function_privilege('anon', 'public.create_project_table_assignment_task(uuid, text, timestamp with time zone)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.create_project_table_assignment_task(uuid, text, timestamp with time zone)', 'EXECUTE')
  as passed;

select
  'projects_table_v2_phase4_no_anon_project_tasks_insert' as check_name,
  not has_table_privilege('anon', 'public.project_tasks', 'INSERT')
  as passed;

select
  'projects_table_v2_phase4_project_photos_soft_delete_only' as check_name,
  has_table_privilege('anon', 'public.project_photos', 'INSERT')
  and has_column_privilege('anon', 'public.project_photos', 'deleted_at', 'UPDATE')
  and has_column_privilege('anon', 'public.project_photos', 'caption', 'UPDATE')
  and has_column_privilege('anon', 'public.project_photos', 'is_client_visible', 'UPDATE')
  and not has_column_privilege('anon', 'public.project_photos', 'url', 'UPDATE')
  and not has_table_privilege('anon', 'public.project_photos', 'DELETE')
  as passed;

select
  'projects_table_v2_phase4_project_photos_storage_bucket' as check_name,
  exists (
    select 1
    from storage.buckets
    where id = 'project-photos'
      and public = true
      and file_size_limit = 10485760
  ) as passed;

select
  'projects_table_v2_phase4_photo_source_other_valid' as check_name,
  exists (
    select 1
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'photo_source'
      and e.enumlabel = 'other'
  ) as passed;
```

- [ ] **Step 6: Static-check migration**

Run:

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web
git diff --check -- supabase/migrations tests/sql/projects-table-phase1-contract.sql
rg -n "projects\\.team_member_ids|ProjectService\\.update\\(" src/app/\\(dashboard\\)/projects/_components/table-v2 src/lib/hooks/projects-table src/lib/api/services/project-table*.ts
```

Expected:

```text
git diff --check exits 0.
rg returns no matches for client writes/calls except comments that explicitly say do not write.
```

- [ ] **Step 7: PM checkpoint before live apply**

Stop and report:

- MCP preflight output summary.
- Migration filename.
- Whether `project-photos` existed live before migration.
- Static-check output.
- Cost/risk note for Supabase Storage.

Do not apply the migration until PM approves.

**Milestone 1 Check-In:** migration written and contract tests updated; no UI implementation yet.

---

### Task 2: Service Contracts For Team, Photos, And Bulk

**Files:**
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/api/query-client.ts`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/api/services/project-table-service.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/api/services/project-table-team-service.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/api/services/project-table-photo-service.ts`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/types/project-table.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/projects-table/project-table-team-service.test.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/projects-table/project-table-photo-service.test.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/projects-table/project-table-bulk-service.test.ts`

- [ ] **Step 1: Write failing team-service tests**

Create tests that assert:

- Company team query reads `users` where `company_id`, `is_active = true`, `deleted_at IS NULL`.
- Project tasks query reads `project_tasks` by `project_id`, excludes deleted/cancelled tasks, orders `display_order`.
- Assign calls `assign_project_team_member` with `p_project_id`, `p_user_id`, `p_task_ids`, `p_expected_updated_at`.
- Remove calls `remove_project_team_member` and passes `p_task_ids: null` for remove-all.
- Create-first-task calls `create_project_table_assignment_task` with `p_project_id`, `p_title`, and `p_expected_updated_at`, then returns the inserted task id.
- No test expects a `projects.team_member_ids` update.

Run:

```bash
npm test -- tests/unit/projects-table/project-table-team-service.test.ts
```

Expected: FAIL because service does not exist.

- [ ] **Step 2: Implement `ProjectTableTeamService`**

Create `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/api/services/project-table-team-service.ts` with typed helpers:

```ts
export interface ProjectTableTeamMember {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
  profileImageUrl: string | null;
  userColor: string | null;
}

export interface ProjectTableTaskOption {
  id: string;
  title: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  teamMemberIds: string[];
}
```

Methods:

- `fetchCompanyTeamMembers(companyId)`
- `fetchProjectTasks(projectId)`
- `createFirstTask({ projectId, title, expectedUpdatedAt })`
- `assignTeamMember({ projectId, userId, taskIds, expectedUpdatedAt })`
- `removeTeamMember({ projectId, userId, taskIds, expectedUpdatedAt })`

All Supabase access goes through `requireSupabase()`. Normalize RPC errors with the existing `ProjectTableMutationError` shape from `project-table-service.ts`; export shared normalizer if needed.

- [ ] **Step 3: Write failing photo-service tests**

Create tests that assert:

- `fetchProjectPhotos(projectId, companyId)` reads non-deleted rows ordered newest first.
- `uploadProjectPhoto` uploads to bucket `project-photos` at `${companyId}/${projectId}/${uuid}.${ext}` with `cacheControl: "3600"` and `upsert: false`.
- Insert payload includes `source: "other"`, `uploaded_by`, `company_id`, `project_id`, `url`, `thumbnail_url`, `is_client_visible: false`.
- Storage upload error does not call `.from("project_photos").insert`.
- DB insert error calls `storage.from("project-photos").remove([path])` before throwing.
- Delete updates `project_photos.deleted_at`, not hard delete.

Run:

```bash
npm test -- tests/unit/projects-table/project-table-photo-service.test.ts
```

Expected: FAIL because service does not exist.

- [ ] **Step 4: Implement `ProjectTablePhotoService`**

Create `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/api/services/project-table-photo-service.ts`.

Rules:

- Accept only image MIME types from the migration allowlist.
- Resolve extension from the file name/type; default to `jpg`.
- Generate path with `crypto.randomUUID()`.
- Use `supabase.storage.from("project-photos").upload(path, file, { cacheControl: "3600", upsert: false })`.
- Use `getPublicUrl(path)` and insert the returned public URL into `project_photos.url`.
- Pass `source: "other"` and the required public `users.id` as `uploaded_by`.
- On insert failure, remove the uploaded path inline.
- Return the created photo plus the object path for cleanup/debug.

- [ ] **Step 5: Write failing bulk-service tests**

Extend `project-table-service` tests or create `project-table-bulk-service.test.ts` to assert:

- `bulkUpdateProjects` calls `bulk_update_project_table` once with JSON array operations.
- Status operations serialize `ProjectStatus.InProgress` to `in_progress`.
- Date operations use `action: "date"`, `field: "end_date"` or `start_date`.
- Assign operations include task ids per project.
- Partial failure returns `{ success, failed, successCount, failedCount }` without throwing.
- RPC transport error still throws normalized mutation error.

Run:

```bash
npm test -- tests/unit/projects-table/project-table-bulk-service.test.ts
```

Expected: FAIL until implemented.

- [ ] **Step 6: Implement bulk wrapper and query keys**

Modify:

- `src/lib/api/services/project-table-service.ts`: add `bulkUpdateProjects(params)` and shared response types.
- `src/lib/types/project-table.ts`: add `ProjectTableBulkAction`, `ProjectTableBulkOperation`, `ProjectTableBulkResult`.
- `src/lib/api/query-client.ts`: add `projects.tableTeam(projectId)`, `projects.tablePhotos(projectId)`, or equivalent focused keys.

- [ ] **Step 7: Run service tests**

Run:

```bash
npm test -- tests/unit/projects-table/project-table-team-service.test.ts tests/unit/projects-table/project-table-photo-service.test.ts tests/unit/projects-table/project-table-bulk-service.test.ts tests/unit/projects-table/project-table-service-mutations.test.ts
```

Expected: PASS.

**Milestone 2 Check-In:** service contracts pass and no UI is wired yet.

---

### Task 3: Hooks, Bulk Undo Model, And Selection Safety

**Files:**
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-project-table-team.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-cell-photo-upload.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-projects-bulk-actions.ts`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-cell-edit.ts`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-table-selection.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/hooks/use-project-table-team.test.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/hooks/use-cell-photo-upload.test.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/hooks/use-projects-bulk-actions.test.tsx`

- [ ] **Step 1: Write hook tests**

Tests must cover:

- Team hook derives assigned/available members from `row.teamMemberIds`.
- Team hook refuses assign with empty task ids and surfaces validation code `22023`.
- Photo upload hook reads `company.id` and `currentUser.id` from `useAuthStore`; missing user/company rejects before Storage upload.
- Photo upload hook invalidates `projectPhotos.byProject(projectId)` and `projects.tableRows(...)`.
- Bulk hook builds operations only from visible selected rows passed by the table shell.
- Bulk hook records one undo entry for the entire operation.
- Partial bulk failure exposes success/failed counts and retry/discard callbacks.
- Selection clears when the caller changes `resetKey`.

Run:

```bash
npm test -- tests/unit/hooks/use-project-table-team.test.tsx tests/unit/hooks/use-cell-photo-upload.test.tsx tests/unit/hooks/use-projects-bulk-actions.test.tsx
```

Expected: FAIL until hooks are implemented.

- [ ] **Step 2: Extend undo types**

Modify `use-cell-edit.ts` so the undo stack supports:

```ts
type ProjectTableUndoEntry =
  | ProjectTableCellUndoEntry
  | ProjectTableBulkUndoEntry;

interface ProjectTableBulkUndoEntry {
  id: string;
  kind: "bulk";
  action: "status" | "date" | "assign_team" | "remove_team";
  projectIds: string[];
  before: Array<{ projectId: string; columnId: "status" | "start_date" | "end_date" | "team"; value: unknown; updatedAt: string | null }>;
  after: Array<{ projectId: string; value: unknown; updatedAt: string | null }>;
  labelKey: string;
  createdAt: number;
}
```

Expose `pushBulkUndo(entry)` and `undoBulk(entry)` from `useCellEdit`, or pass a `recordUndo` callback into `useProjectsBulkActions`. Do not break existing single-cell undo tests.

- [ ] **Step 3: Implement hooks**

Implement:

- `useProjectTableTeam({ row })`: team members/tasks queries, assign/remove/create-first-task mutations, cache updates.
- `useCellPhotoUpload({ row })`: fetch photos, upload, soft-delete, count cache update.
- `useProjectsBulkActions({ visibleRows, selectedIds, onClearSelection, recordBulkUndo })`: status/date/team bulk actions, partial failure state, retry/discard.

Bulk behavior:

- `visibleRows.filter((row) => selectedIds.has(row.id))` is the only source of bulk targets.
- Never apply actions to IDs absent from `visibleRows`.
- On success/partial success, update TanStack cache for successful project IDs only.
- One bulk undo entry captures successful rows only.
- Retry sends failed operations only.

- [ ] **Step 4: Update selection hook**

Modify `useTableSelection(visibleRowIds, resetKey)`:

- Continue pruning hidden rows on every visible set change.
- Clear all selection when `resetKey` changes.
- Return `selectAllVisible()` for `Cmd/Ctrl+A` and bulk bar "select visible" behavior.

The shell will pass a reset key built from active view id, search, sorting, and the serialized view filter definition.

- [ ] **Step 5: Run hook tests**

Run:

```bash
npm test -- tests/unit/hooks/use-cell-edit.test.tsx tests/unit/hooks/use-project-table-team.test.tsx tests/unit/hooks/use-cell-photo-upload.test.tsx tests/unit/hooks/use-projects-bulk-actions.test.tsx
```

Expected: PASS.

**Milestone 3 Check-In:** hooks pass, selection safety verified in unit tests.

---

### Task 4: `cell-team` UI

**Files:**
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/cells/cell-team.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-table-row.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/types/project-table.ts`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/integration/projects-table-v2-phase4.test.tsx`

- [ ] **Step 1: Write integration test for team cell**

Test:

- All Active view renders team avatars/count instead of a number-only cell.
- Clicking available member opens task cascade.
- Checking two tasks calls assign hook with those task ids.
- Removing assigned member with "remove from all" calls remove hook with `taskIds: null`.
- Zero-task project shows create-first-task form and then calls assign with the created task id.
- Read-only/permission denial renders dictionary-backed read-only message, not a silent no-op.

Run:

```bash
npm test -- tests/integration/projects-table-v2-phase4.test.tsx
```

Expected: FAIL until UI exists.

- [ ] **Step 2: Implement visual component**

`CellTeam` requirements:

- Use Radix Popover or existing local popover primitive.
- Use Lucide icons (`Search`, `ChevronRight`, `Check`, `UserPlus`, `X`) at 1.5px stroke.
- `.glass-dense`, `rounded-modal`, token borders, no shadows beyond existing approved dropdown token if the local primitive applies it.
- Primary title: `table.cell.team.title`.
- Sections: `table.cell.team.assigned`, `table.cell.team.available`.
- Search placeholder: `table.cell.team.search`.
- Empty task copy: `table.cell.team.noTasks`.
- Create task copy: `table.cell.team.createFirstTask`.
- Buttons use existing button variants/tokens.
- iPad/narrow behavior stacks secondary task panel below primary panel.

Data:

- Assigned members = company members whose id is in `row.teamMemberIds`.
- Available members = active company members not assigned.
- Secondary task list uses `project_tasks` rows from the team hook.
- Completed/cancelled tasks are not assignment targets unless PM explicitly changes this; default to non-deleted and `status != "cancelled"`.

- [ ] **Step 3: Wire row renderer**

In `projects-table-row.tsx`, render `CellTeam` for `column.id === "team"` and keep keyboard event isolation so arrow keys inside the popover do not move table focus.

- [ ] **Step 4: Run team UI tests**

Run:

```bash
npm test -- tests/integration/projects-table-v2-phase4.test.tsx tests/unit/hooks/use-project-table-team.test.tsx
npm run type-check
```

Expected: PASS.

**Milestone 4 Check-In:** team cell works in mocked integration tests.

---

### Task 5: `cell-photos` UI And Upload Flow

**Files:**
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/cells/cell-photos.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-table-row.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/integration/projects-table-v2-phase4.test.tsx`

- [ ] **Step 1: Write integration tests for photos cell**

Test:

- Cell shows photo count and opens a thumbnail popover.
- Drop zone and file picker call upload hook.
- Upload happy path increments the cached count.
- Storage failure shows `table.cell.photos.uploadFailed` and does not insert.
- DB failure after upload calls cleanup and shows `table.cell.photos.uploadFailed`.
- Delete action soft-deletes and decrements count.

Run:

```bash
npm test -- tests/integration/projects-table-v2-phase4.test.tsx tests/unit/hooks/use-cell-photo-upload.test.tsx
```

Expected: FAIL until UI exists.

- [ ] **Step 2: Implement `CellPhotos`**

Requirements:

- Popover uses `.glass-dense`.
- Thumbnails are 68x68, object-cover, stable dimensions.
- Count is mono, tabular.
- Drop zone copy keys:
  - `table.cell.photos.title`
  - `table.cell.photos.drop`
  - `table.cell.photos.select`
  - `table.cell.photos.uploading`
  - `table.cell.photos.uploadFailed`
  - `table.cell.photos.delete`
- No decorative gradients/orbs.
- Multiple files upload serially or with a bounded concurrency of 2; each file preserves cleanup guarantees.
- Uploads use `source = "other"` only.

- [ ] **Step 3: Wire row renderer**

Render `CellPhotos` for `column.id === "photos"`. Keep the old `CellNumber` fallback only if the photos hook cannot load; do not hide upload errors.

- [ ] **Step 4: Run photo tests**

Run:

```bash
npm test -- tests/unit/projects-table/project-table-photo-service.test.ts tests/unit/hooks/use-cell-photo-upload.test.tsx tests/integration/projects-table-v2-phase4.test.tsx
npm run type-check
```

Expected: PASS.

**Milestone 5 Check-In:** photo cell upload/delete passes mocked tests.

---

### Task 6: Bulk Bar And Selection-Aware Actions

**Files:**
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-bulk-bar.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-table-shell.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-table.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-table-keyboard-nav.ts`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/integration/projects-table-v2-phase4.test.tsx`

- [ ] **Step 1: Write integration tests for bulk actions**

Test:

- Selecting rows shows `ProjectsBulkBar`.
- Bar count comes from visible selected rows only.
- Search/filter/view reset clears selection.
- Bulk status calls bulk hook with selected visible rows.
- Bulk archive calls the same status operation with `ProjectStatus.Archived`.
- Bulk due date writes `end_date`.
- Bulk assign requires task selection per project or a deliberate "assign to all active tasks" option.
- Partial failure shows success/failed counts and Retry / Discard.
- Undo after a bulk status action reverts all successful rows with one undo.
- Hidden selected IDs are pruned and never sent to bulk service.

Run:

```bash
npm test -- tests/integration/projects-table-v2-phase4.test.tsx tests/unit/hooks/use-projects-bulk-actions.test.tsx
```

Expected: FAIL until bulk bar exists.

- [ ] **Step 2: Implement `ProjectsBulkBar`**

Visual:

- Sticky bottom bar, `.glass-dense`, 48px height, `rounded-modal` only if floating; otherwise squared to container edge.
- Left: `table.bulk.selectedCount`.
- Actions:
  - `table.bulk.changeStatus`
  - `table.bulk.assignTo`
  - `table.bulk.setDueDate`
  - `table.bulk.archive`
  - `table.bulk.clear`
- Include Archive as a status-to-`archived` bulk action. Do not render Delete unless Task 1 is expanded in the same execution to add a permission-scoped soft-delete branch and matching tests.
- >25 row operations show confirmation modal using `table.bulk.confirmLarge`.
- Partial failure copy:
  - `table.bulk.partialFailure`
  - `table.bulk.retry`
  - `table.bulk.discard`

Behavior:

- Uses `useProjectsBulkActions`.
- Calls `selection.clearSelection()` after full success.
- Keeps selection after partial failure so Retry can target failed visible rows.
- Discard clears partial failure state and selection.

- [ ] **Step 3: Wire shell and keyboard**

In `projects-table-shell.tsx`:

- Build `selectionResetKey = JSON.stringify({ activeViewId, search, sorting, filters: activeView?.filters })`.
- Pass reset key into `useTableSelection`.
- Render `ProjectsBulkBar` when `selection.selectedCount > 0`.
- Pass `cellEdit.pushBulkUndo` / `undoLatest` into the bulk hook.

In keyboard nav:

- `Cmd/Ctrl+A` calls `selectAllVisible`, not all fetched/hidden DB rows.
- Escape clears selection when not editing.

- [ ] **Step 4: Run bulk tests**

Run:

```bash
npm test -- tests/integration/projects-table-v2-phase4.test.tsx tests/unit/hooks/use-projects-bulk-actions.test.tsx tests/unit/hooks/use-cell-edit.test.tsx
npm run type-check
```

Expected: PASS.

**Milestone 6 Check-In:** bulk bar actions and selection safety pass.

---

### Task 7: Dictionaries, Notifications, Analytics, And Bible

**Files:**
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/i18n/dictionaries/en/projects.json`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/i18n/dictionaries/es/projects.json`
- Modify if needed: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/api/services/notification-dispatch.ts`
- Modify if used: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/analytics/analytics-service.ts` call sites only
- Modify: `/Users/jacksonsweet/Projects/OPS/ops-software-bible/10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md`

- [ ] **Step 1: Add dictionary keys**

Add matching keys to EN and ES:

```json
{
  "table.cell.team.readOnly": "// READ-ONLY - no team permission",
  "table.cell.team.taskSearch": "Search tasks...",
  "table.cell.team.assignToTasks": "Assign to tasks",
  "table.cell.team.createTaskPlaceholder": "Task name",
  "table.cell.team.createTaskRequired": "Task name required",
  "table.cell.photos.title": "// PHOTOS - {project}",
  "table.cell.photos.drop": "Drop photos here",
  "table.cell.photos.select": "Select photos",
  "table.cell.photos.uploading": "Uploading...",
  "table.cell.photos.uploadFailed": "// ERROR - UPLOAD FAILED",
  "table.cell.photos.delete": "Delete photo",
  "table.cell.photos.empty": "—",
  "table.bulk.selectedCount": "// {count} SELECTED",
  "table.bulk.changeStatus": "Change status",
  "table.bulk.assignTo": "Assign to",
  "table.bulk.setDueDate": "Set due date",
  "table.bulk.archive": "Archive",
  "table.bulk.clear": "Clear",
  "table.bulk.confirmLarge": "Apply this to {count} projects?",
  "table.bulk.partialFailure": "Updated {success} of {total}. {failed} failed.",
  "table.bulk.retry": "Retry",
  "table.bulk.discard": "Discard",
  "table.bulk.undoTitle": "// BULK CHANGE SAVED",
  "table.bulk.undoBody": "{count} projects updated."
}
```

Spanish copy must preserve OPS tactical tone, not literal cheerful SaaS phrasing.

- [ ] **Step 2: Notification discipline**

After team RPC success:

- Call `dispatchProjectAssignment` for new member ids only.
- Do not write `project_notes` for team changes.
- Photo upload should create a photo timeline event only if reusing `useCreateProjectPhoto`; if table upload bypasses that hook, either call the same ProjectNoteService system event or explicitly document why the table gallery is source of truth. Prefer consistency with `useCreateProjectPhoto`.

If `notification-dispatch.ts` strings are touched, move any new user-facing strings to dictionaries or a server-side notification dictionary. Do not add hardcoded new English strings in Phase 4 UI components.

- [ ] **Step 3: Analytics**

Track without PII:

- `project_table_team_rpc` with `action`, `latency_ms`, `task_count`, `conflict`.
- `project_table_photo_uploaded` with `project_id`, `file_count`, `success_count`, `failed_count`.
- `project_table_bulk_applied` with `action`, `row_count`, `partial_failure_count`.
- `project_table_undo_invoked` already exists conceptually; include `action: "bulk"` when bulk undo runs.

Never log file names, search text, user names, or emails.

- [ ] **Step 4: Bible update**

Update `/Users/jacksonsweet/Projects/OPS/ops-software-bible/10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md` with:

- Projects Table V2 Phase 4 status.
- Team cell canonical rule: task-backed membership through RPC only.
- Firebase/anon RPC exposure rationale and helper-gated safety.
- `project-photos` Supabase Storage bucket path: `<company_id>/<project_id>/<uuid>.<ext>`.
- Table uploads write `project_photos.source = 'other'`.
- `uploaded_by` resolved from public `users.id`.
- Bulk RPC partial-failure and undo contract.

- [ ] **Step 5: Run dictionary/docs checks**

Run:

```bash
npm test -- tests/integration/projects-table-v2-phase4.test.tsx
npm run type-check
git diff --check -- src/i18n/dictionaries/en/projects.json src/i18n/dictionaries/es/projects.json /Users/jacksonsweet/Projects/OPS/ops-software-bible/10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md
```

Expected: PASS.

**Milestone 7 Check-In:** copy, notifications, analytics, and bible are current.

---

### Task 8: Browser Gate And Full Verification

**Files:**
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/e2e/projects-table-v2-phase4.spec.ts`
- Modify if needed: `/Users/jacksonsweet/Projects/OPS/OPS-Web/playwright.config.ts`

- [ ] **Step 1: Write Playwright coverage**

Create E2E specs for:

- Team assignment happy path: open team cell, assign member to two tasks, avatar/count updates, notification rail entry appears.
- Team permission path: user without assign permission sees read-only team popover.
- Photo happy path: upload file, Storage succeeds, DB row appears, thumbnail/count updates.
- Photo Storage failure: mocked upload failure leaves no DB row.
- Photo DB failure: mocked insert failure removes Storage blob.
- Bulk status: select visible rows, change status, one undo reverts all.
- Bulk due date: select visible rows, set due date, table updates.
- Bulk team assignment: assign member to selected visible projects.
- Partial failure: one stale `updated_at` returns failed count; Retry resubmits failed only; Discard clears state.
- Selection clears on view switch/search/filter/sort.
- Frozen columns and virtualization: scroll to row 500, horizontal scroll, frozen select/name/status remain aligned and no hidden selected row is included in bulk payload.

- [ ] **Step 2: Run full unit/integration suite for touched surface**

Run:

```bash
npm test -- \
  tests/unit/projects-table/project-table-service-mutations.test.ts \
  tests/unit/projects-table/project-table-team-service.test.ts \
  tests/unit/projects-table/project-table-photo-service.test.ts \
  tests/unit/projects-table/project-table-bulk-service.test.ts \
  tests/unit/hooks/use-cell-edit.test.tsx \
  tests/unit/hooks/use-table-keyboard-nav.test.tsx \
  tests/unit/hooks/use-project-table-team.test.tsx \
  tests/unit/hooks/use-cell-photo-upload.test.tsx \
  tests/unit/hooks/use-projects-bulk-actions.test.tsx \
  tests/integration/projects-table-v2-read-only.test.tsx \
  tests/integration/projects-table-v2-edit-core.test.tsx \
  tests/integration/projects-table-v2-phase4.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run static checks**

Run:

```bash
npm run type-check
npm run lint
git diff --check
rg -n "ProjectService\\.update\\(|projects\\.team_member_ids|source:\\s*[\"']web[\"']|uploaded_by:\\s*(undefined|null)" src/app/\\(dashboard\\)/projects/_components/table-v2 src/lib/hooks/projects-table src/lib/api/services/project-table*.ts
```

Expected:

```text
type-check passes.
lint passes or reports only pre-existing unrelated warnings approved by PM.
git diff --check exits 0.
rg returns no matches except SQL/test comments that explicitly assert forbidden behavior.
```

- [ ] **Step 4: Browser gate**

Start dev server:

```bash
DEV_BYPASS_AUTH=true NEXT_PUBLIC_DEV_BYPASS_AUTH=true npm run dev -- --port 3002
```

Open:

```text
http://localhost:3002/projects
```

Manual/browser checks:

1. Team assignment happy path works and count/avatar updates without full page reload.
2. Team create-first-task path works on a no-task project.
3. Photo upload happy path works end-to-end.
4. Force Storage upload failure; verify no DB row.
5. Force DB insert failure after Storage upload; verify uploaded blob removed.
6. Bulk status works; one undo reverts all successful rows.
7. Bulk due date works.
8. Bulk assignment works.
9. Partial bulk failure shows counts and Retry / Discard.
10. Selection clears on view/search/sort/filter changes.
11. Horizontal scroll plus row virtualization remain aligned at desktop and iPad portrait widths.
12. `prefers-reduced-motion` disables nonessential transitions.

- [ ] **Step 5: Run Playwright**

Run:

```bash
npm run test:e2e -- tests/e2e/projects-table-v2-phase4.spec.ts --project=chromium
```

Expected: PASS.

**Milestone 8 Check-In:** browser ship gate passed with screenshots/video paths if Playwright saved any.

---

## Final Verification Commands

Run before Phase 4 is considered complete:

```bash
npm test -- \
  tests/unit/projects-table/project-table-service-mutations.test.ts \
  tests/unit/projects-table/project-table-team-service.test.ts \
  tests/unit/projects-table/project-table-photo-service.test.ts \
  tests/unit/projects-table/project-table-bulk-service.test.ts \
  tests/unit/hooks/use-cell-edit.test.tsx \
  tests/unit/hooks/use-table-selection.test.tsx \
  tests/unit/hooks/use-project-table-team.test.tsx \
  tests/unit/hooks/use-cell-photo-upload.test.tsx \
  tests/unit/hooks/use-projects-bulk-actions.test.tsx \
  tests/integration/projects-table-v2-read-only.test.tsx \
  tests/integration/projects-table-v2-edit-core.test.tsx \
  tests/integration/projects-table-v2-phase4.test.tsx

npm run type-check
npm run lint
npm run test:e2e -- tests/e2e/projects-table-v2-phase4.spec.ts --project=chromium
git diff --check
```

SQL verification after migration apply:

```bash
psql "$SUPABASE_DB_URL" -f tests/sql/projects-table-phase1-contract.sql
```

If using Supabase MCP instead of `psql`, run the contract file statements through MCP and verify every `passed` column is true.

## Self-Review: Phase 4 Spec Mapping

- `cell-team` with cascading popover: Tasks 2, 3, 4.
- `assign_project_team_member` / `remove_project_team_member` integration: Tasks 1, 2, 4.
- Safe Firebase/anon team RPC migration: Task 1.
- No implicit writes to `projects.team_member_ids`: Non-negotiables, Tasks 2 and 8 static grep.
- Do not call `ProjectService.update()`: Non-negotiables, Task 8 static grep.
- `cell-photos` with Supabase Storage upload: Tasks 1, 2, 3, 5.
- `project_photos` insert/delete handling: Tasks 2, 5.
- `project_photos.source = 'other'`: Non-negotiables, Tasks 2, 5, 8 static grep.
- `uploaded_by` required and resolved from public `users.id`: Non-negotiables, Tasks 2, 3.
- Storage failure means no DB row: Tasks 2, 5, 8.
- DB insert failure cleans Storage blob: Tasks 2, 5, 8.
- `projects-bulk-bar` with selection-aware bulk actions: Tasks 3, 6.
- Batch RPC or safe server path for bulk status/assignment/date: Task 1 bulk RPC, Task 2 service, Task 6 UI.
- Bulk undo as one entry: Tasks 3, 6, 8.
- Partial bulk failure with counts and Retry/Discard: Tasks 3, 6, 8.
- Selection clears on filter/view changes and never applies to hidden rows: Tasks 3, 6, 8.
- No Phase 5 saved-view management: Scope and out-of-scope sections.
- Dictionaries EN/ES: Task 7.
- OPS design system v2: Non-negotiables plus Tasks 4, 5, 6.
- Browser gates for team, photos, bulk, partial failure, undo, frozen/virtualized regressions: Task 8.
- Bible update: Task 7.

## Risks PM Should Review Before Execution

- Supabase MCP auth is currently unstable in this session. Live preflight must be rerun before migration apply.
- Creating a public `project-photos` bucket preserves existing URL-rendering behavior but exposes uploaded objects to anyone with the unguessable URL. A private bucket would require a broader gallery URL-signing refactor.
- Supabase Storage usage can affect storage and egress costs. Confirm current Supabase plan/quota before enabling large file uploads broadly.
- Bulk RPC uses per-operation subtransactions for partial success. This is deliberate, but high-volume batches should stay confirmation-gated above 25 rows.
- Existing workspace photo components still contain hardcoded styling/copy. Phase 4 table code must stay tokenized and must not copy those older styling patterns.
