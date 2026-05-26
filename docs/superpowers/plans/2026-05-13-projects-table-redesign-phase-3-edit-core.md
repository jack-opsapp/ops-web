# Projects Table Redesign Phase 3 Edit Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the read-only Projects Table V2 into a safe inline-editing surface for core project fields: name, address, start date, end date, and status.

**Architecture:** Phase 3 keeps the table data source as `public.project_table_rows` and adds a small edit layer on top of TanStack Query's cached infinite-query pages. Simple project fields use direct PostgREST `projects` updates with `updated_at` optimistic concurrency; status changes use the existing `change_project_status` RPC so `project_notes.event_kind = 'status_change'` remains canonical. A small auth migration is required first because OPS-Web's Firebase bridge uses the `anon` database role for browser requests.

**Tech Stack:** Next.js 15, React 19, Supabase/Postgres, TanStack Query, TanStack Table/Virtual, Zustand stores, Framer Motion only where existing table motion already permits it, OPS dictionaries, Vitest, React Testing Library, Playwright/browser verification.

---

## PM Check-In Protocol

Execution agents work one milestone at a time. At the end of each milestone, stop and report to the PM with:

- Files changed.
- Exact commands run.
- Command output summary with pass/fail counts.
- Migration name and whether it was only written or also applied.
- Browser observations if a browser gate ran.
- Any blocker or deviation from this plan.

Do not begin the next milestone until the PM approves the check-in.

## Source Documents

- Spec: `/Users/jacksonsweet/Projects/OPS/OPS-Web/docs/superpowers/specs/2026-05-12-projects-table-redesign-design.md`
- Phase 1 plan: `/Users/jacksonsweet/Projects/OPS/OPS-Web/docs/superpowers/plans/2026-05-12-projects-table-redesign-phase-1-foundation.md`
- Phase 2 plan: `/Users/jacksonsweet/Projects/OPS/OPS-Web/docs/superpowers/plans/2026-05-12-projects-table-redesign-phase-2-read-only-virtual-table.md`
- OPS-Web standards: `/Users/jacksonsweet/Projects/OPS/OPS-Web/AGENTS.md`
- Root standards: `/Users/jacksonsweet/Projects/OPS/AGENTS.md`
- Canonical design spec: `/Users/jacksonsweet/Projects/OPS/ops-design-system/project/uploads/system.md`
- Bible section: `/Users/jacksonsweet/Projects/OPS/ops-software-bible/10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md`
- Generated schema: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/types/database.types.ts`

## Scope

In scope:

- Inline editing for `name`, `address`, `start_date`, `end_date`, and `status`.
- Optimistic save flow using `updated_at` as the conflict token.
- Retry once after 2 seconds for transient network/5xx failures only.
- Persistent undo toast and `Cmd/Ctrl+Z`.
- Conflict overlay for SQLSTATE `P0001`.
- Basic keyboard cell navigation: arrows, tab/shift-tab, enter, escape, `Cmd/Ctrl+Z`, `Cmd/Ctrl+F`.
- Row detail chevron so row clicks can become cell-edit clicks without losing the detail-panel path.
- Auth/grant migration needed for Firebase-bridge browser writes.

Out of scope for Phase 3:

- Team assignment popover/RPC UI.
- Photo upload/drop cells.
- Custom saved-view creation/editing.
- Column reorder/visibility management.
- Bulk archive/actions.
- Drag reorder.
- Materializing `project_table_rows`.

## Non-Negotiables

- Do not write `projects.team_member_ids` from the table.
- Do not call `ProjectService.update()` from the table; it still allows stale `teamMemberIds` payloads.
- Do not update `projects.status` directly; status changes must call `change_project_status`.
- Do not invent client-side role checks. Server permissions are enforced by RLS/RPC helpers.
- Every user-facing string goes through `useDictionary()` and `src/i18n/dictionaries/*/projects.json`.
- Accent `#6F94B0` stays limited to focus rings, primary action, checked checkbox, and the existing allowed table affordances.
- Keep row virtualization intact. Do not render hidden rows outside the virtualizer.

## File Map

- Create via Supabase CLI: `/Users/jacksonsweet/Projects/OPS/OPS-Web/supabase/migrations/<generated>_projects_table_v2_phase3_edit_core_auth.sql`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/sql/projects-table-phase1-contract.sql`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/types/project-table.ts`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/utils/project-table-formatters.ts`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/api/services/project-table-service.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-cell-edit.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-table-keyboard-nav.ts`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-table-shell.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-table.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-table-row.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-undo-toast.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-conflict-overlay.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/cells/editable-cell-text.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/cells/editable-cell-date.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/cells/editable-cell-status.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/i18n/dictionaries/en/projects.json`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/i18n/dictionaries/es/projects.json`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/projects-table/project-table-editing.test.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/projects-table/project-table-service-mutations.test.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/hooks/use-cell-edit.test.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/hooks/use-table-keyboard-nav.test.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/integration/projects-table-v2-read-only.test.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/integration/projects-table-v2-edit-core.test.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/ops-software-bible/10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md`

---

### Task 1: Auth Migration For Browser Writes

**Files:**
- Create via CLI: `/Users/jacksonsweet/Projects/OPS/OPS-Web/supabase/migrations/<generated>_projects_table_v2_phase3_edit_core_auth.sql`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/sql/projects-table-phase1-contract.sql`

- [ ] **Step 1: Confirm current policy/grant state**

Run these read-only checks through Supabase MCP against `ops-app / ijeekuhbatykdomumfjx`:

```sql
select
  pol.polname,
  pol.polpermissive,
  pol.polcmd,
  pol.polroles::text as roles
from pg_policy pol
join pg_class cls on cls.oid = pol.polrelid
join pg_namespace ns on ns.oid = cls.relnamespace
where ns.nspname = 'public'
  and cls.relname = 'projects'
  and pol.polname = 'role_scope_update';

select
  has_function_privilege('anon', 'public.change_project_status(uuid, text, timestamp with time zone)', 'EXECUTE') as anon_can_change_status,
  has_function_privilege('anon', 'public.assign_project_team_member(uuid, uuid, uuid[], timestamp with time zone)', 'EXECUTE') as anon_can_assign_team,
  has_function_privilege('anon', 'public.remove_project_team_member(uuid, uuid, uuid[], timestamp with time zone)', 'EXECUTE') as anon_can_remove_team,
  has_function_privilege('anon', 'private.current_user_can_edit_project(uuid)', 'EXECUTE') as anon_can_call_edit_helper;
```

Expected before this task:

```text
role_scope_update is restrictive but currently scoped to authenticated from Phase 1.
anon_can_change_status = false from the Firebase read-grant patch.
anon_can_assign_team = false.
anon_can_remove_team = false.
anon_can_call_edit_helper may be false.
```

- [ ] **Step 2: Create the migration file**

Run:

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web
npx supabase migration new projects_table_v2_phase3_edit_core_auth
```

Expected: Supabase creates one timestamped SQL file. Do not hand-invent the timestamp.

- [ ] **Step 3: Add the auth migration SQL**

Write this SQL into the generated migration file:

```sql
begin;

-- OPS-Web browser requests use the Firebase bridge, which arrives at PostgREST
-- as the anon role with signed Firebase claims. The restrictive edit policy must
-- apply to public, not only authenticated, or browser writes bypass/lose the
-- scoped project permission helper depending on role.
drop policy if exists role_scope_update on public.projects;

create policy role_scope_update
on public.projects
as restrictive
for update
to public
using (private.current_user_can_edit_project(id))
with check (private.current_user_can_edit_project(id));

grant execute on function private.current_user_can_edit_project(uuid) to anon, authenticated;

-- Status editing is part of Phase 3. Team mutation UI is not.
grant execute on function public.change_project_status(uuid, text, timestamptz) to anon, authenticated;
revoke execute on function public.assign_project_team_member(uuid, uuid, uuid[], timestamptz) from anon;
revoke execute on function public.remove_project_team_member(uuid, uuid, uuid[], timestamptz) from anon;

commit;
```

- [ ] **Step 4: Add contract checks**

Append these checks to `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/sql/projects-table-phase1-contract.sql` under the existing Phase 1 contract section:

```sql
-- Phase 3 edit-core auth contract.
select
  'projects_role_scope_update_public_restrictive' as check_name,
  exists (
    select 1
    from pg_policy pol
    join pg_class cls on cls.oid = pol.polrelid
    join pg_namespace ns on ns.oid = cls.relnamespace
    where ns.nspname = 'public'
      and cls.relname = 'projects'
      and pol.polname = 'role_scope_update'
      and pol.polcmd = 'w'
      and pol.polpermissive = false
      and pol.polroles = array['0'::oid]
  ) as passed;

select
  'projects_table_v2_anon_status_rpc_only' as check_name,
  has_function_privilege('anon', 'public.change_project_status(uuid, text, timestamp with time zone)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.assign_project_team_member(uuid, uuid, uuid[], timestamp with time zone)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.remove_project_team_member(uuid, uuid, uuid[], timestamp with time zone)', 'EXECUTE')
  as passed;

select
  'projects_table_v2_anon_edit_helper_execute' as check_name,
  has_function_privilege('anon', 'private.current_user_can_edit_project(uuid)', 'EXECUTE') as passed;
```

- [ ] **Step 5: Static-check the migration**

Run:

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web
git diff --check -- supabase/migrations tests/sql/projects-table-phase1-contract.sql
rg -n "grant execute on function public.assign_project_team_member.*to anon|grant execute on function public.remove_project_team_member.*to anon" supabase/migrations
```

Expected:

```text
git diff --check exits 0.
rg exits 1 with no matches.
```

- [ ] **Step 6: PM checkpoint before live apply**

Stop and report the migration filename and static-check output. Do not apply the migration to `ops-app` until the PM explicitly approves live application.

**Milestone 1 Check-In:** report schema checks, migration filename, contract additions, and whether the migration is written-only or applied.

---

### Task 2: Edit Contracts And Mutation Service

**Files:**
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/types/project-table.ts`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/utils/project-table-formatters.ts`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/api/services/project-table-service.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/projects-table/project-table-editing.test.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/projects-table/project-table-service-mutations.test.ts`

- [ ] **Step 1: Write formatter/contract tests**

Create `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/projects-table/project-table-editing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ProjectStatus } from "@/lib/types/models";
import {
  PROJECT_TABLE_EDITABLE_COLUMN_IDS,
  getProjectTableEditValue,
  isProjectTableEditableColumn,
  type ProjectTableRow,
} from "@/lib/types/project-table";
import { serializeProjectTableStatus } from "@/lib/utils/project-table-formatters";

const baseRow: ProjectTableRow = {
  id: "p-1",
  companyId: "co-1",
  title: "Deck rebuild",
  status: ProjectStatus.Accepted,
  rawStatus: "accepted",
  clientId: null,
  clientName: null,
  clientEmail: null,
  clientPhone: null,
  address: "12 Site Rd",
  teamMemberIds: [],
  startDate: "2026-05-20",
  endDate: null,
  duration: null,
  progress: null,
  nextTask: null,
  taskCount: 0,
  taskCompletedCount: 0,
  daysInStatus: null,
  estimateTotal: null,
  invoiceTotal: null,
  paidTotal: null,
  value: null,
  projectCost: null,
  margin: null,
  photoCount: 0,
  updatedAt: "2026-05-13T00:00:00Z",
};

describe("project table editing contracts", () => {
  it("keeps Phase 3 editable columns tightly scoped", () => {
    expect(PROJECT_TABLE_EDITABLE_COLUMN_IDS).toEqual([
      "name",
      "status",
      "address",
      "start_date",
      "end_date",
    ]);
    expect(isProjectTableEditableColumn("team")).toBe(false);
    expect(isProjectTableEditableColumn("invoice_total")).toBe(false);
    expect(isProjectTableEditableColumn("name")).toBe(true);
  });

  it("reads edit values from render rows", () => {
    expect(getProjectTableEditValue(baseRow, "name")).toBe("Deck rebuild");
    expect(getProjectTableEditValue(baseRow, "address")).toBe("12 Site Rd");
    expect(getProjectTableEditValue(baseRow, "start_date")).toBe("2026-05-20");
    expect(getProjectTableEditValue(baseRow, "end_date")).toBe(null);
    expect(getProjectTableEditValue(baseRow, "status")).toBe(ProjectStatus.Accepted);
  });

  it("serializes TS project statuses to lowercase DB values", () => {
    expect(serializeProjectTableStatus(ProjectStatus.InProgress)).toBe("in_progress");
    expect(serializeProjectTableStatus(ProjectStatus.Completed)).toBe("completed");
  });
});
```

- [ ] **Step 2: Run the failing contract test**

Run:

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web
npm test -- --run tests/unit/projects-table/project-table-editing.test.ts
```

Expected: fails because the edit contract exports do not exist yet.

- [ ] **Step 3: Add edit types and helpers**

Modify `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/types/project-table.ts`:

```ts
export type ProjectTableEditableColumnId =
  | "name"
  | "status"
  | "address"
  | "start_date"
  | "end_date";

export const PROJECT_TABLE_EDITABLE_COLUMN_IDS = [
  "name",
  "status",
  "address",
  "start_date",
  "end_date",
] as const satisfies readonly ProjectTableEditableColumnId[];

export type ProjectTableEditValue = string | null | ProjectStatus;

export type ProjectTableDirectEditColumnId = Exclude<ProjectTableEditableColumnId, "status">;

export const PROJECT_TABLE_DIRECT_EDIT_FIELD_MAP = {
  name: "title",
  address: "address",
  start_date: "start_date",
  end_date: "end_date",
} as const satisfies Record<ProjectTableDirectEditColumnId, keyof Database["public"]["Tables"]["projects"]["Update"]>;

export function isProjectTableEditableColumn(
  columnId: ProjectTableColumnId,
): columnId is ProjectTableEditableColumnId {
  return (PROJECT_TABLE_EDITABLE_COLUMN_IDS as readonly string[]).includes(columnId);
}

export function getProjectTableEditValue(
  row: ProjectTableRow,
  columnId: ProjectTableEditableColumnId,
): ProjectTableEditValue {
  switch (columnId) {
    case "name":
      return row.title;
    case "status":
      return row.status;
    case "address":
      return row.address;
    case "start_date":
      return row.startDate;
    case "end_date":
      return row.endDate;
  }
}
```

Update `ProjectTableColumnConfig` to include:

```ts
editable?: boolean;
```

Set `editable: true` only on `name`, `status`, `address`, `start_date`, and `end_date` in `PROJECT_TABLE_COLUMNS`.

- [ ] **Step 4: Add status serializer**

Modify `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/utils/project-table-formatters.ts`:

```ts
export function serializeProjectTableStatus(status: ProjectStatus): string {
  switch (status) {
    case ProjectStatus.RFQ:
      return "rfq";
    case ProjectStatus.Estimated:
      return "estimated";
    case ProjectStatus.Accepted:
      return "accepted";
    case ProjectStatus.InProgress:
      return "in_progress";
    case ProjectStatus.Completed:
      return "completed";
    case ProjectStatus.Closed:
      return "closed";
    case ProjectStatus.Archived:
      return "archived";
  }
}
```

- [ ] **Step 5: Write service mutation tests**

Create `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/projects-table/project-table-service-mutations.test.ts` with tests for:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectStatus } from "@/lib/types/models";
import { ProjectTableService } from "@/lib/api/services/project-table-service";
import { requireSupabase } from "@/lib/supabase/helpers";

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: vi.fn(),
}));

function directUpdateSupabaseMock(result: { data: { updated_at: string } | null; error: null | { code?: string; message: string } }) {
  const select = vi.fn(() => ({ maybeSingle: vi.fn(async () => result) }));
  const eqUpdatedAt = vi.fn(() => ({ select }));
  const eqId = vi.fn(() => ({ eq: eqUpdatedAt }));
  const update = vi.fn(() => ({ eq: eqId }));
  const from = vi.fn(() => ({ update }));
  return { from, update, eqId, eqUpdatedAt, select };
}

function rpcSupabaseMock(result: { data: unknown; error: null | { code?: string; message: string } }) {
  return { rpc: vi.fn(async () => result) };
}

describe("ProjectTableService mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates direct project fields with an updated_at match", async () => {
    const mock = directUpdateSupabaseMock({
      data: { updated_at: "2026-05-13T01:00:00Z" },
      error: null,
    });
    vi.mocked(requireSupabase).mockReturnValue(mock as never);

    await expect(ProjectTableService.updateProjectField({
      projectId: "p-1",
      columnId: "name",
      value: "New name",
      expectedUpdatedAt: "2026-05-13T00:00:00Z",
    })).resolves.toEqual({ updatedAt: "2026-05-13T01:00:00Z" });

    expect(mock.from).toHaveBeenCalledWith("projects");
    expect(mock.update).toHaveBeenCalledWith({ title: "New name" });
    expect(mock.eqId).toHaveBeenCalledWith("id", "p-1");
    expect(mock.eqUpdatedAt).toHaveBeenCalledWith("updated_at", "2026-05-13T00:00:00Z");
  });

  it("turns zero-row direct updates into conflict errors", async () => {
    const mock = directUpdateSupabaseMock({ data: null, error: null });
    vi.mocked(requireSupabase).mockReturnValue(mock as never);

    await expect(ProjectTableService.updateProjectField({
      projectId: "p-1",
      columnId: "address",
      value: "New address",
      expectedUpdatedAt: "2026-05-13T00:00:00Z",
    })).rejects.toMatchObject({ code: "P0001" });
  });

  it("changes status through the canonical RPC", async () => {
    const mock = rpcSupabaseMock({
      data: { updated_at: "2026-05-13T01:00:00Z", to_status: "in_progress" },
      error: null,
    });
    vi.mocked(requireSupabase).mockReturnValue(mock as never);

    await expect(ProjectTableService.changeProjectStatus({
      projectId: "p-1",
      status: ProjectStatus.InProgress,
      expectedUpdatedAt: "2026-05-13T00:00:00Z",
    })).resolves.toEqual({ updatedAt: "2026-05-13T01:00:00Z" });

    expect(mock.rpc).toHaveBeenCalledWith("change_project_status", {
      p_project_id: "p-1",
      p_new_status: "in_progress",
      p_expected_updated_at: "2026-05-13T00:00:00Z",
    });
  });
});
```

- [ ] **Step 6: Run the failing service test**

Run:

```bash
npm test -- --run tests/unit/projects-table/project-table-service-mutations.test.ts
```

Expected: fails because mutation service methods/classes do not exist yet.

- [ ] **Step 7: Implement mutation service methods**

Modify `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/api/services/project-table-service.ts`:

```ts
import { ProjectStatus } from "@/lib/types/models";
import {
  PROJECT_TABLE_DIRECT_EDIT_FIELD_MAP,
  type ProjectTableDirectEditColumnId,
  type ProjectTableEditValue,
  type ProjectTableEditableColumnId,
} from "@/lib/types/project-table";
import { serializeProjectTableStatus } from "@/lib/utils/project-table-formatters";

export class ProjectTableMutationError extends Error {
  constructor(
    message: string,
    public readonly code: "P0001" | "42501" | "22023" | "NETWORK" | "UNKNOWN",
  ) {
    super(message);
    this.name = "ProjectTableMutationError";
  }
}

function normalizeMutationError(error: { code?: string; message?: string } | null): ProjectTableMutationError {
  if (!error) return new ProjectTableMutationError("Project conflict", "P0001");
  if (error.code === "P0001" || error.code === "42501" || error.code === "22023") {
    return new ProjectTableMutationError(error.message ?? "Project edit failed", error.code);
  }
  return new ProjectTableMutationError(error.message ?? "Project edit failed", "UNKNOWN");
}

function normalizeDirectValue(
  columnId: ProjectTableDirectEditColumnId,
  value: ProjectTableEditValue,
): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value).trim();
  if (columnId === "name" && text.length === 0) {
    throw new ProjectTableMutationError("Project name is required", "22023");
  }
  return text.length === 0 ? null : text;
}
```

Add methods inside `ProjectTableService`:

```ts
async updateProjectField(params: {
  projectId: string;
  columnId: ProjectTableDirectEditColumnId;
  value: ProjectTableEditValue;
  expectedUpdatedAt: string;
}): Promise<{ updatedAt: string }> {
  const supabase = requireSupabase();
  const dbField = PROJECT_TABLE_DIRECT_EDIT_FIELD_MAP[params.columnId];
  const payload = { [dbField]: normalizeDirectValue(params.columnId, params.value) };

  const { data, error } = await supabase
    .from("projects")
    .update(payload)
    .eq("id", params.projectId)
    .eq("updated_at", params.expectedUpdatedAt)
    .select("updated_at")
    .maybeSingle();

  if (error) throw normalizeMutationError(error);
  if (!data?.updated_at) throw new ProjectTableMutationError("Project conflict", "P0001");
  return { updatedAt: data.updated_at };
},

async changeProjectStatus(params: {
  projectId: string;
  status: ProjectStatus;
  expectedUpdatedAt: string;
}): Promise<{ updatedAt: string }> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc("change_project_status", {
    p_project_id: params.projectId,
    p_new_status: serializeProjectTableStatus(params.status),
    p_expected_updated_at: params.expectedUpdatedAt,
  });

  if (error) throw normalizeMutationError(error);
  const updatedAt = typeof data === "object" && data && "updated_at" in data
    ? String((data as { updated_at: unknown }).updated_at)
    : "";
  if (!updatedAt) throw new ProjectTableMutationError("Project status response missing updated_at", "UNKNOWN");
  return { updatedAt };
},
```

- [ ] **Step 8: Verify Task 2**

Run:

```bash
npm test -- --run tests/unit/projects-table/project-table-editing.test.ts tests/unit/projects-table/project-table-service-mutations.test.ts
npm run type-check
git diff --check -- src/lib/types/project-table.ts src/lib/utils/project-table-formatters.ts src/lib/api/services/project-table-service.ts tests/unit/projects-table
```

Expected: tests pass, type-check passes, diff check passes.

**Milestone 2 Check-In:** report service API, tests, and any type adjustments.

---

### Task 3: Optimistic Edit Hook And Undo Stack

**Files:**
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-cell-edit.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/hooks/use-cell-edit.test.tsx`

- [ ] **Step 1: Write hook tests**

Create `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/hooks/use-cell-edit.test.tsx` covering:

```ts
it("optimistically updates all project table row pages for a direct field edit", async () => {});
it("records a max 50-entry undo stack and drops the oldest entry on overflow", async () => {});
it("maps P0001 into a conflict object without swallowing the user's attempted value", async () => {});
it("undoes the newest saved edit through the same mutation path", async () => {});
```

Use a real `QueryClientProvider` in the test. Seed `queryKeys.projects.tableRows({ companyId: "co-1", viewId: "view-1" })` with an infinite-query shaped value:

```ts
{
  pages: [{ rows: [row], count: 1, nextPage: null }],
  pageParams: [0],
}
```

Mock `ProjectTableService.updateProjectField` and `ProjectTableService.changeProjectStatus` with `vi.spyOn`.

- [ ] **Step 2: Run the failing hook test**

Run:

```bash
npm test -- --run tests/unit/hooks/use-cell-edit.test.tsx
```

Expected: fails because `useCellEdit` does not exist.

- [ ] **Step 3: Implement the hook**

Create `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-cell-edit.ts` with these public types:

```ts
export type ProjectTableSaveState = "idle" | "saving" | "saved" | "error" | "conflict";

export interface ProjectTableCellKey {
  rowId: string;
  columnId: ProjectTableEditableColumnId;
}

export interface ProjectTableUndoEntry {
  id: string;
  rowId: string;
  columnId: ProjectTableEditableColumnId;
  projectTitle: string;
  before: ProjectTableEditValue;
  after: ProjectTableEditValue;
  expectedUpdatedAt: string;
  savedUpdatedAt: string;
}

export interface ProjectTableConflict {
  rowId: string;
  columnId: ProjectTableEditableColumnId;
  projectTitle: string;
  attemptedValue: ProjectTableEditValue;
  previousValue: ProjectTableEditValue;
}
```

The hook signature must be:

```ts
export function useCellEdit(args: {
  rows: ProjectTableRow[];
  tableQueryKeyPrefix?: readonly unknown[];
  refetchRows: () => Promise<unknown>;
}) {
  // returns commitEdit, undoLatest, saveStates, undoStack, latestUndo,
  // clearLatestUndo, conflict, resolveConflictUseMine, resolveConflictUseCurrent,
  // cancelConflict, isSaving
}
```

Implementation rules:

- Use `useQueryClient()`.
- Update every cached query whose key starts with `["projects", "tableRows"]`.
- Mutate only the row fields that correspond to Phase 3 editable columns.
- Use the row's current `updatedAt` as `expectedUpdatedAt`; if it is missing, refetch and fail with a read-only/error state.
- For direct fields, call `ProjectTableService.updateProjectField`.
- For status, call `ProjectTableService.changeProjectStatus`.
- Retry once after 2 seconds only for thrown errors with `code === "NETWORK"` or `code === "UNKNOWN"`. Do not retry `P0001`, `42501`, or `22023`.
- Push undo entries only after the server save succeeds.
- Cap undo entries at 50 by evicting the oldest entry.
- `undoLatest()` calls the same mutation path with the latest row `updatedAt`; status undo creates a second canonical `status_change` note through the RPC.
- On `P0001`, call `refetchRows()`, set `conflict`, and keep `attemptedValue` available for "Use mine".
- "Use current" clears conflict after refetch. "Use mine" retries using the latest row token after refetch.

Use this cache helper shape inside the hook:

```ts
function updateRowsInCache(
  queryClient: QueryClient,
  updater: (row: ProjectTableRow) => ProjectTableRow,
) {
  queryClient.setQueriesData(
    { queryKey: queryKeys.projects.all, exact: false },
    (oldData: unknown) => {
      if (!oldData || typeof oldData !== "object" || !("pages" in oldData)) return oldData;
      const data = oldData as { pages: Array<{ rows?: ProjectTableRow[] }> };
      return {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          rows: Array.isArray(page.rows) ? page.rows.map(updater) : page.rows,
        })),
      };
    },
  );
}
```

Guard it so only `tableRows` queries are changed:

```ts
predicate: (query) =>
  Array.isArray(query.queryKey) &&
  query.queryKey[0] === "projects" &&
  query.queryKey[1] === "tableRows"
```

- [ ] **Step 4: Verify Task 3**

Run:

```bash
npm test -- --run tests/unit/hooks/use-cell-edit.test.tsx
npm run type-check
git diff --check -- src/lib/hooks/projects-table/use-cell-edit.ts tests/unit/hooks/use-cell-edit.test.tsx
```

Expected: hook tests pass, type-check passes, diff check passes.

**Milestone 3 Check-In:** report hook behavior, undo policy, and conflict behavior.

---

### Task 4: Editable Cells And Row Interaction

**Files:**
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/cells/editable-cell-text.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/cells/editable-cell-date.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/cells/editable-cell-status.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-table-shell.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-table.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-table-row.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/integration/projects-table-v2-read-only.test.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/integration/projects-table-v2-edit-core.test.tsx`

- [ ] **Step 1: Write integration tests for edit entry**

Create `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/integration/projects-table-v2-edit-core.test.tsx` with tests for:

```ts
it("clicking a name cell opens inline edit instead of the project window", async () => {});
it("the hover detail chevron opens the project window in viewing mode", async () => {});
it("saving a text edit calls commitEdit and shows the saved value", async () => {});
it("escape cancels a text edit and restores the original value", async () => {});
it("status popover uses the canonical status labels and calls commitEdit", async () => {});
```

Mock `useCellEdit()` in this integration test so UI behavior is isolated from cache internals:

```ts
vi.mock("@/lib/hooks/projects-table/use-cell-edit", () => ({
  useCellEdit: () => ({
    commitEdit: commitEditMock,
    undoLatest: vi.fn(),
    saveStates: new Map(),
    latestUndo: null,
    clearLatestUndo: vi.fn(),
    conflict: null,
    resolveConflictUseMine: vi.fn(),
    resolveConflictUseCurrent: vi.fn(),
    cancelConflict: vi.fn(),
    isSaving: false,
  }),
}));
```

- [ ] **Step 2: Run the failing integration test**

Run:

```bash
npm test -- --run tests/integration/projects-table-v2-edit-core.test.tsx
```

Expected: fails because editable cells and hook wiring do not exist.

- [ ] **Step 3: Build editable text/date cells**

Create `editable-cell-text.tsx` and `editable-cell-date.tsx`.

Behavior:

- Initial click enters edit mode.
- Enter commits.
- Blur commits only if the value changed.
- Escape cancels.
- Empty `name` is rejected before commit and leaves focus in the input.
- Empty `address`, `start_date`, and `end_date` commit as `null`.
- Long values truncate in display mode with `min-w-0 overflow-hidden text-ellipsis whitespace-nowrap`.
- Saving state adds a subtle `opacity-70`; saved flash uses `bg-surface-active`, not accent.

The text component props:

```ts
export function EditableCellText({
  value,
  columnId,
  required = false,
  saveState,
  onCommit,
}: {
  value: string | null;
  columnId: ProjectTableEditableColumnId;
  required?: boolean;
  saveState: ProjectTableSaveState;
  onCommit: (value: string | null) => Promise<void> | void;
}) {}
```

The date component props:

```ts
export function EditableCellDate({
  value,
  columnId,
  saveState,
  onCommit,
}: {
  value: string | null;
  columnId: "start_date" | "end_date";
  saveState: ProjectTableSaveState;
  onCommit: (value: string | null) => Promise<void> | void;
}) {}
```

- [ ] **Step 4: Build editable status cell**

Create `editable-cell-status.tsx`.

Behavior:

- Display uses the existing `CellStatus` visual treatment and imports colors from `PROJECT_STATUS_COLORS`.
- Click/Enter opens a compact popover.
- Options are `ProjectStatus.RFQ`, `Estimated`, `Accepted`, `InProgress`, `Completed`, `Closed`, `Archived`.
- Option labels use dictionary keys already present in `projects.json`: `status.rfq`, `status.estimated`, `status.accepted`, `status.inProgress`, `status.completed`, `status.closed`, `status.archived`.
- Choosing the current status closes without saving.
- Choosing a new status calls `onCommit(status)`.
- Escape closes.

Props:

```ts
export function EditableCellStatus({
  status,
  saveState,
  onCommit,
}: {
  status: ProjectStatus;
  saveState: ProjectTableSaveState;
  onCommit: (status: ProjectStatus) => Promise<void> | void;
}) {}
```

- [ ] **Step 5: Update row interaction**

Modify `projects-table-row.tsx`:

- Change the row wrapper from `role="button"` to `role="row"`.
- Remove row-level `onClick={handleOpen}`.
- Keep selection checkbox behavior.
- Add a small left-edge detail chevron button that appears on hover/focus and calls `onOpenProject(row.id)`.
- Each non-select cell gets `role="gridcell"`.
- Editable cells call `onCommitCell(row, columnId, value)`.
- Non-editable cells keep the existing read-only renderer.

New props:

```ts
activeCell: { rowId: string; columnId: ProjectTableColumnId } | null;
editingCell: { rowId: string; columnId: ProjectTableEditableColumnId } | null;
saveStates: Map<string, ProjectTableSaveState>;
onActivateCell: (rowId: string, columnId: ProjectTableColumnId) => void;
onBeginEdit: (rowId: string, columnId: ProjectTableEditableColumnId) => void;
onCancelEdit: () => void;
onCommitCell: (
  row: ProjectTableRow,
  columnId: ProjectTableEditableColumnId,
  value: ProjectTableEditValue,
) => Promise<void>;
```

Cell save-state keys must be built as `${row.id}:${column.id}`.

- [ ] **Step 6: Wire mouse editing without keyboard navigation**

Modify `projects-table-shell.tsx`:

- Instantiate `const cellEdit = useCellEdit({ rows: tableQuery.rows, refetchRows: tableQuery.refetch })`.
- Pass `cellEdit.commitEdit` and `cellEdit.saveStates` to `ProjectsTable`.
- Do not render undo toast or conflict overlay yet; those are Task 6.

Modify `projects-table.tsx`:

- Keep local `activeCell` and `editingCell` state for mouse/click editing only.
- Pass `activeCell`, `editingCell`, `saveStates`, `onActivateCell`, `onBeginEdit`, `onCancelEdit`, and `onCommitCell` to each `ProjectsTableRow`.
- `onCommitCell` calls the shell-provided commit function, then clears `editingCell`.
- Do not add keyboard navigation yet; Task 5 owns `use-table-keyboard-nav`.

- [ ] **Step 7: Verify Task 4**

Run:

```bash
npm test -- --run tests/integration/projects-table-v2-read-only.test.tsx tests/integration/projects-table-v2-edit-core.test.tsx
npm run type-check
git diff --check -- 'src/app/(dashboard)/projects/_components/table-v2' tests/integration/projects-table-v2-read-only.test.tsx tests/integration/projects-table-v2-edit-core.test.tsx
```

Expected: tests pass, type-check passes, diff check passes.

**Milestone 4 Check-In:** report row interaction changes, mouse-edit wiring, and edit-cell coverage.

---

### Task 5: Keyboard Navigation And Shell Wiring

**Files:**
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-table-keyboard-nav.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/hooks/use-table-keyboard-nav.test.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-table.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-table-shell.tsx`
- Modify as needed for key handlers: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-table-row.tsx`
- Modify as needed for search focus ref: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-toolbar.tsx`

- [ ] **Step 1: Write keyboard-nav tests**

Create `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/hooks/use-table-keyboard-nav.test.tsx` covering:

```ts
it("moves the active cell with arrow keys inside visible bounds", () => {});
it("moves forward and backward with tab and shift-tab", () => {});
it("begins edit on enter only when the active column is editable", () => {});
it("cancels edit on escape", () => {});
it("calls undo on meta/control z", () => {});
it("focuses search on meta/control f", () => {});
```

- [ ] **Step 2: Run the failing keyboard test**

Run:

```bash
npm test -- --run tests/unit/hooks/use-table-keyboard-nav.test.tsx
```

Expected: fails because `useTableKeyboardNav` does not exist.

- [ ] **Step 3: Implement keyboard hook**

Create `use-table-keyboard-nav.ts`:

```ts
export interface ProjectTableActiveCell {
  rowId: string;
  columnId: ProjectTableColumnId;
}

export interface ProjectTableEditingCell {
  rowId: string;
  columnId: ProjectTableEditableColumnId;
}

export function useTableKeyboardNav(args: {
  rows: ProjectTableRow[];
  columns: ProjectTableColumnConfig[];
  onUndo: () => void;
  onFocusSearch: () => void;
}) {
  // activeCell, editingCell, setActiveCell, beginEdit, cancelEdit, handleCellKeyDown
}
```

Rules:

- Ignore the `select` column for edit entry but allow checkbox focus separately.
- Arrow keys move within the currently loaded rows and visible columns.
- Tab/shift-tab move horizontally, wrapping to the next/previous row.
- Enter begins edit if `isProjectTableEditableColumn(columnId)` is true.
- Escape cancels edit.
- `metaKey || ctrlKey` plus `z` calls `onUndo`.
- `metaKey || ctrlKey` plus `f` calls `onFocusSearch` and prevents the browser find box.
- Do not scroll the virtualizer manually in Phase 3; only navigate loaded/visible row indexes.

- [ ] **Step 4: Preserve mouse-edit wiring and add keyboard focus wiring**

Modify `projects-table-shell.tsx`:

- Create `searchInputRef` and pass it to `ProjectsToolbar` if the toolbar does not already expose one. If needed, update `ProjectsToolbar` to accept `searchInputRef?: RefObject<HTMLInputElement>`.
- Keep the `useCellEdit` mouse-edit wiring from Task 4.
- Pass the keyboard undo handler to the table.
- Do not render undo toast or conflict overlay yet; those are Task 6.

- [ ] **Step 5: Wire table to keyboard hook**

Modify `projects-table.tsx`:

- Build `visibleColumns` once and pass them to `useTableKeyboardNav`.
- Pass `activeCell`, `editingCell`, `beginEdit`, `cancelEdit`, `handleCellKeyDown`, and `setActiveCell` to each row.
- The scroll handler still closes transient row action state and fetches next page near bottom.

- [ ] **Step 6: Verify Task 5**

Run:

```bash
npm test -- --run tests/unit/hooks/use-table-keyboard-nav.test.tsx tests/unit/hooks/use-cell-edit.test.tsx tests/integration/projects-table-v2-edit-core.test.tsx
npm run type-check
git diff --check -- src/lib/hooks/projects-table 'src/app/(dashboard)/projects/_components/table-v2'
```

Expected: tests pass, type-check passes, diff check passes.

**Milestone 5 Check-In:** report keyboard behavior and shell wiring.

---

### Task 6: Undo Toast, Conflict Overlay, Copy, And Docs

**Files:**
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-undo-toast.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-conflict-overlay.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-table-shell.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/i18n/dictionaries/en/projects.json`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/i18n/dictionaries/es/projects.json`
- Modify: `/Users/jacksonsweet/Projects/OPS/ops-software-bible/10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md`

- [ ] **Step 1: Add dictionary keys**

Add these keys to English:

```json
"table.undo.body": "{column} updated on {project}.",
"table.undo.dismiss": "Dismiss",
"table.conflict.genericTitle": "// PROJECT CHANGED",
"table.conflict.body": "Current value changed before save.",
"table.conflict.close": "Close"
```

Add these keys to Spanish:

```json
"table.undo.body": "{column} actualizado en {project}.",
"table.undo.dismiss": "Cerrar",
"table.conflict.genericTitle": "// PROYECTO ACTUALIZADO",
"table.conflict.body": "El valor actual cambió antes de guardar.",
"table.conflict.close": "Cerrar"
```

- [ ] **Step 2: Create undo toast**

Create `projects-undo-toast.tsx`.

Behavior:

- Renders nothing when `entry` is null.
- Bottom-left fixed toast inside the table shell.
- Uses `glass-dense`/existing glass tokens and `var(--text-2)` for the left bar. Do not use accent.
- Shows `table.undo.toastTitle`, `table.undo.body`, `table.undo.action`, and `table.undo.dismiss`.
- Auto-dismisses after 10 seconds unless the user hovers or focuses it.
- Undo button calls `onUndo`.

Props:

```ts
export function ProjectsUndoToast({
  entry,
  onUndo,
  onDismiss,
}: {
  entry: ProjectTableUndoEntry | null;
  onUndo: () => void;
  onDismiss: () => void;
}) {}
```

- [ ] **Step 3: Create conflict overlay**

Create `projects-conflict-overlay.tsx`.

Behavior:

- Renders nothing when `conflict` is null.
- Uses existing modal/surface tokens: modal radius 12, panel glass, no decorative gradients.
- Title uses `table.conflict.genericTitle`.
- Body uses `table.conflict.body`.
- Shows two compact value blocks labelled `table.conflict.yourLabel` and `table.conflict.theirLabel`.
- Actions:
  - `table.conflict.useMine` calls `onUseMine`.
  - `table.conflict.useTheirs` calls `onUseCurrent`.
  - `table.conflict.cancel` calls `onCancel`.
- Values format status labels via dictionary, dates via existing `formatDate`, null as `—`.

Props:

```ts
export function ProjectsConflictOverlay({
  conflict,
  currentValue,
  onUseMine,
  onUseCurrent,
  onCancel,
}: {
  conflict: ProjectTableConflict | null;
  currentValue: ProjectTableEditValue;
  onUseMine: () => void;
  onUseCurrent: () => void;
  onCancel: () => void;
}) {}
```

- [ ] **Step 4: Wire UI into shell**

Modify `projects-table-shell.tsx`:

```tsx
<ProjectsUndoToast
  entry={cellEdit.latestUndo}
  onUndo={cellEdit.undoLatest}
  onDismiss={cellEdit.clearLatestUndo}
/>
<ProjectsConflictOverlay
  conflict={cellEdit.conflict}
  currentValue={cellEdit.conflict ? getProjectTableEditValue(
    tableQuery.rows.find((row) => row.id === cellEdit.conflict?.rowId) ?? cellEdit.conflictFallbackRow,
    cellEdit.conflict.columnId,
  ) : null}
  onUseMine={cellEdit.resolveConflictUseMine}
  onUseCurrent={cellEdit.resolveConflictUseCurrent}
  onCancel={cellEdit.cancelConflict}
/>
```

If the exact `conflictFallbackRow` helper is not present from Task 3, compute `currentValue` with a local helper that returns `null` when the row is no longer visible. Do not crash when filters hide the conflicted row after refetch.

- [ ] **Step 5: Update the bible**

Append a short Phase 3 note to `/Users/jacksonsweet/Projects/OPS/ops-software-bible/10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md` near the existing Projects Table V2 section:

```md
### Projects Table V2 Phase 3 Edit Core (added 2026-05-13)

Projects Table V2 now supports inline edits for core project fields: title, address, start date, end date, and status. Direct project-field edits use PostgREST updates against `public.projects` with an `updated_at` equality check; zero-row updates are treated as edit conflicts. Status changes use `public.change_project_status(...)`, which preserves the canonical `project_notes.event_kind = 'status_change'` activity trail.

Undo is client-side and capped at 50 entries. Undo performs a real reverse write through the same direct-update/RPC path and therefore respects current permissions and conflict tokens. The browser Firebase bridge uses the `anon` database role, so the restrictive `projects.role_scope_update` policy applies to `public`, and `anon` can execute only the status RPC from the Phase 1 RPC family.
```

- [ ] **Step 6: Verify Task 6**

Run:

```bash
jq empty src/i18n/dictionaries/en/projects.json
jq empty src/i18n/dictionaries/es/projects.json
npm run type-check
npm test -- --run tests/integration/projects-table-v2-edit-core.test.tsx tests/unit/hooks/use-cell-edit.test.tsx
git diff --check -- 'src/app/(dashboard)/projects/_components/table-v2' src/i18n/dictionaries/en/projects.json src/i18n/dictionaries/es/projects.json
git -C /Users/jacksonsweet/Projects/OPS/ops-software-bible diff --check -- 10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md
```

Expected: all commands pass.

**Milestone 6 Check-In:** report UI components, dictionary keys, and bible diff.

---

### Task 7: Full Verification And Browser Gate

**Files:**
- No new files expected unless tests reveal a small fix.

- [ ] **Step 1: Run focused automated verification**

Run:

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web
npm run type-check
npm test -- --run \
  tests/unit/projects-table/project-table-formatters.test.ts \
  tests/unit/projects-table/project-filter-to-sql.test.ts \
  tests/unit/projects-table/project-table-editing.test.ts \
  tests/unit/projects-table/project-table-service-mutations.test.ts \
  tests/unit/hooks/use-table-selection.test.ts \
  tests/unit/hooks/use-cell-edit.test.tsx \
  tests/unit/hooks/use-table-keyboard-nav.test.tsx \
  tests/integration/projects-table-v2-read-only.test.tsx \
  tests/integration/projects-table-v2-edit-core.test.tsx
jq empty src/i18n/dictionaries/en/projects.json
jq empty src/i18n/dictionaries/es/projects.json
git diff --check -- src tests supabase/migrations src/i18n/dictionaries/en/projects.json src/i18n/dictionaries/es/projects.json
git -C /Users/jacksonsweet/Projects/OPS/ops-software-bible diff --check -- 10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md
```

Expected: type-check passes; all listed tests pass; JSON validation passes; diff checks pass.

- [ ] **Step 2: Run live SQL contract checks after PM-approved migration apply**

If Task 1 migration has been applied to `ops-app`, run these through Supabase MCP:

```sql
select
  exists (
    select 1
    from pg_policy pol
    join pg_class cls on cls.oid = pol.polrelid
    join pg_namespace ns on ns.oid = cls.relnamespace
    where ns.nspname = 'public'
      and cls.relname = 'projects'
      and pol.polname = 'role_scope_update'
      and pol.polcmd = 'w'
      and pol.polpermissive = false
      and pol.polroles = array['0'::oid]
  ) as role_scope_update_public_restrictive,
  has_function_privilege('anon', 'public.change_project_status(uuid, text, timestamp with time zone)', 'EXECUTE') as anon_can_change_status,
  not has_function_privilege('anon', 'public.assign_project_team_member(uuid, uuid, uuid[], timestamp with time zone)', 'EXECUTE') as anon_cannot_assign_team,
  not has_function_privilege('anon', 'public.remove_project_team_member(uuid, uuid, uuid[], timestamp with time zone)', 'EXECUTE') as anon_cannot_remove_team;
```

Expected: every boolean is `true`.

- [ ] **Step 3: Start the dev server**

Run:

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web
DEV_BYPASS_AUTH=true NEXT_PUBLIC_DEV_BYPASS_AUTH=true ./node_modules/.bin/next dev --port 3002
```

Expected: server reaches `Ready`. If port `3002` is occupied, use `3003` and report the deviation.

- [ ] **Step 4: Browser gate with a user who can edit projects**

Use Browser/Playwright against `http://localhost:3002/projects`.

Verify:

- Projects Table V2 loads because `projects_table_v2.enabled = true`.
- Click a project name cell. It enters edit mode and does not open the project window.
- Change the name to a temporary suffix like `- EDIT CHECK`.
- Save with Enter. The value appears immediately and remains after refetch.
- Click Undo or press `Cmd/Ctrl+Z`. The original name returns and remains after refetch.
- Open the status cell. Change status to another active status. Confirm the status pill changes and a reload preserves it.
- Undo the status change. Confirm it reverts.
- Open the detail chevron. Confirm `openProjectWindow({ mode: "viewing" })` path still works.
- Long project names still truncate cleanly at compact density.
- Horizontal scroll still keeps `select`, `name`, and `status` frozen.

At the end of the browser gate, restore any live project values changed during the test through the UI undo path. If undo fails, use the PM-approved recovery path and report it immediately.

- [ ] **Step 5: Conflict gate**

Use two browser contexts or one browser context plus a Supabase MCP update:

1. Context A opens a name cell and keeps the edit draft open.
2. Context B or MCP changes the same project's `title` and updates `updated_at`.
3. Context A saves the stale draft.
4. UI shows the conflict overlay.
5. `Use current` keeps the server value.
6. Repeat and choose `Use mine`; UI retries with the latest `updated_at` and saves the user's value.

Expected: no silent overwrite; `P0001` produces visible conflict UI.

- [ ] **Step 6: Stop the dev server**

Stop the server and confirm the port is clear:

```bash
lsof -nP -iTCP:3002 -sTCP:LISTEN
```

Expected: no listener after shutdown.

**Milestone 7 Check-In:** report automated verification, SQL contract booleans, browser observations, screenshots if captured, and any live data restored.

---

## Acceptance Criteria

- Inline edit works for name, address, start date, end date, and status.
- Status changes call `change_project_status`; direct status updates do not exist in the table path.
- Direct fields use `projects.update(...).eq("id", id).eq("updated_at", token)` and treat zero updated rows as `P0001`.
- Undo stack holds at most 50 entries and evicts the oldest entry on overflow.
- `Cmd/Ctrl+Z` triggers undo when the table is focused.
- Conflict overlay appears on `P0001` and supports "Use mine", "Use current", and cancel.
- Row click no longer opens detail by accident; detail opens through the left-edge chevron.
- Row virtualization and frozen-left horizontal scroll remain intact.
- `projects.role_scope_update` is restrictive for `public`.
- `anon` can execute `change_project_status` but cannot execute team assignment RPCs.
- Dictionary JSON passes in English and Spanish.
- Bible is updated.
- Browser gate passes on the real app with `projects_table_v2.enabled = true`.

## Known Risks

- `project_table_rows` is still a normal view with correlated derivations. Phase 3 does not increase initial row count, but edits will refetch rows after conflicts and undo. If browser testing shows repeated full refetches, reduce refetches to conflict-only and rely on optimistic cache updates for successful saves.
- Status undo writes a second `status_change` note. That is preferable to silently mutating history because the activity timeline remains canonical and honest.
- The Firebase bridge depends on signed claims being available to private helper functions. The Task 1 SQL contract verifies grants, but the browser gate is the real proof.
- Existing legacy services still have stale team-member write paths. Do not call them from this table.

## Self-Review

- Spec coverage: Phase 3 covers inline editing, optimistic updates, undo, conflict detection via version tokens, keyboard navigation, status RPC canonicality, and row click/edit interaction. Team/photo/custom-view/bulk work belongs to later named phases and is not required for edit core.
- Placeholder scan: no placeholder markers or vague error instructions remain. Error codes, retry policy, and SQL grants are explicit.
- Type consistency: `ProjectTableEditableColumnId`, `ProjectTableEditValue`, `ProjectTableUndoEntry`, and `ProjectTableConflict` are defined before downstream tasks reference them.
