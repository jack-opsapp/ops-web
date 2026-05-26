# Projects Table Redesign Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the read-only Projects table v2 experience behind `projects_table_v2`: saved view tabs, Supabase read-model loading, TanStack Table + Virtual rendering, frozen-left horizontal scroll, responsive density/zoom, and loading/empty/error states.

**Architecture:** Phase 2 is read-only UI over the Phase 1 database foundation. The new table reads `project_views` and `project_table_rows`, derives column/filter/sort behavior in typed client utilities, and renders through focused table-v2 components without touching the existing canvas or mutation paths. The old spreadsheet remains the fallback when the feature flag is off.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Supabase/PostgREST, TanStack Query, TanStack Table v8, TanStack Virtual v3, Zustand feature flags, OPS-Web dictionaries, OPS design system v2.

---

## PM Check-In Protocol

Execution agents work one milestone at a time. At the end of each milestone, stop and report to the PM with:

- Files changed.
- Exact commands run.
- Command output summary with pass/fail counts.
- Any schema or migration output.
- Any blocker or deviation from this plan.

Do not begin the next milestone until the PM approves the check-in. The PM will review diffs, verify the acceptance criteria, and either approve the next milestone or send corrections.

## Phase 2 Boundaries

This phase must not add inline editing, optimistic mutation, undo, conflict overlays, image upload, team assignment popovers, column management, custom saved-view creation, drag reorder, or keyboard cell editing. Those belong to later phases. Phase 2 may add read-only selection checkboxes because they prove the row identity and filter-prune model, but no bulk archive/delete/status actions should execute from the v2 table.

Hard rules:

- Read projects from `public.project_table_rows`, not from the old `projects` + clients + tasks composition.
- Read saved views from `public.project_views`.
- Treat `project_table_rows.status` as lowercase DB text and convert at the rendering boundary only.
- Use `PROJECT_STATUS_COLORS` from `src/lib/types/models.ts`.
- All user-facing copy comes from flat `projects.json` keys via `useDictionary("projects")`.
- No card-mode mobile fallback. iPad portrait uses the same frozen-left + horizontal-scroll table.
- Accent `#6F94B0` is only for focus rings and the active primary affordance. Status pills use the canonical status color map.
- No direct write to `projects.team_member_ids`, `projects.status`, or `project_views` except the one feature-flag seed migration in Task 1.

## Source Documents

- Spec: `/Users/jacksonsweet/Projects/OPS/OPS-Web/docs/superpowers/specs/2026-05-12-projects-table-redesign-design.md`
- Phase 1 plan: `/Users/jacksonsweet/Projects/OPS/OPS-Web/docs/superpowers/plans/2026-05-12-projects-table-redesign-phase-1-foundation.md`
- Migration foundation: `/Users/jacksonsweet/Projects/OPS/OPS-Web/supabase/migrations/20260512234121_projects_table_v2_phase1_foundation.sql`
- Generated schema: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/types/database.types.ts`
- OPS-Web standards: `/Users/jacksonsweet/Projects/OPS/OPS-Web/AGENTS.md`
- Design system: `/Users/jacksonsweet/Projects/OPS/ops-design-system/project/uploads/system.md`
- Bible: `/Users/jacksonsweet/Projects/OPS/ops-software-bible/10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md`

## File Map

- Create migration: `/Users/jacksonsweet/Projects/OPS/OPS-Web/supabase/migrations/<generated>_seed_projects_table_v2_feature_flag.sql`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/feature-flags/feature-flag-definitions.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-projects-table-v2-flag.ts`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/api/query-client.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/types/project-table.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/utils/project-table-formatters.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/utils/project-filter-to-sql.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/api/services/project-views-service.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/api/services/project-table-service.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-project-views-list.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-project-view.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-projects-table-data.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-table-selection.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-table-zoom.ts`
- Create directory: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-table-shell.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-toolbar.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-view-tabs.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-table.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-table-header.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-table-row.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-empty-state.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/cells/cell-text.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/cells/cell-number.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/cells/cell-currency.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/cells/cell-date.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/cells/cell-status.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/cells/cell-progress.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/cells/cell-relation.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/page.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/i18n/dictionaries/en/projects.json`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/i18n/dictionaries/es/projects.json`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/projects-table/project-table-formatters.test.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/projects-table/project-filter-to-sql.test.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/hooks/use-table-selection.test.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/integration/projects-table-v2-read-only.test.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/ops-software-bible/10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md`

---

### Task 1: Flag Seed And Fail-Closed Client Gate

**Files:**
- Create migration: `/Users/jacksonsweet/Projects/OPS/OPS-Web/supabase/migrations/<generated>_seed_projects_table_v2_feature_flag.sql`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/feature-flags/feature-flag-definitions.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-projects-table-v2-flag.ts`

- [ ] **Step 1: Confirm current workspace state**

Run:

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web
git status --short
```

Expected: existing Phase 1 dirty files may be present. Do not revert unrelated work.

- [ ] **Step 2: Create a feature-flag seed migration**

Run:

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web
npx supabase migration new seed_projects_table_v2_feature_flag
```

Expected: Supabase creates a timestamped migration file. Do not hand-invent the timestamp.

- [ ] **Step 3: Add the component-only flag seed**

Put this SQL in the generated migration:

```sql
begin;

insert into public.feature_flags (
  slug,
  label,
  description,
  enabled,
  routes,
  permissions
)
values (
  'projects_table_v2',
  'Projects Table V2',
  'Read-only virtualized Projects spreadsheet redesign.',
  false,
  array[]::text[],
  array[]::text[]
)
on conflict (slug) do update
set
  label = excluded.label,
  description = excluded.description,
  routes = excluded.routes,
  permissions = excluded.permissions,
  updated_at = now();

commit;
```

Important: `routes` stays empty. Do not gate `/projects`, because the old canvas and old spreadsheet must remain available while the v2 table is off.

- [ ] **Step 4: Add static fallback awareness without route gating**

In `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/feature-flags/feature-flag-definitions.ts`, add an empty permission entry:

```ts
export const FEATURE_FLAG_PERMISSIONS: Record<string, string[]> = {
  pipeline: ["pipeline.view", "pipeline.manage", "pipeline.configure_stages"],
  accounting: [
    "accounting.view",
    "accounting.manage_connections",
    "estimates.view",
    "estimates.create",
    "estimates.edit",
    "estimates.delete",
    "estimates.send",
    "estimates.convert",
    "invoices.view",
    "invoices.create",
    "invoices.edit",
    "invoices.delete",
    "invoices.send",
    "invoices.record_payment",
    "invoices.void",
    "expenses.view",
    "expenses.create",
    "expenses.edit",
    "expenses.delete",
    "expenses.approve",
    "expenses.configure",
    "documents.manage_templates",
  ],
  products: ["products.view", "products.manage"],
  inventory: ["inventory.view", "inventory.manage", "inventory.import"],
  portal: ["portal.view", "portal.manage_branding"],
  phase_c: ["email.configure_ai"],
  deck_builder: ["deck_builder.view", "deck_builder.create", "deck_builder.edit"],
  projects_table_v2: [],
};
```

Do not add `projects_table_v2` to `FEATURE_FLAG_ROUTES`.

- [ ] **Step 5: Add a fail-closed hook for this component flag**

Create `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-projects-table-v2-flag.ts`:

```ts
import { useFeatureFlagsStore } from "@/lib/store/feature-flags-store";

export const PROJECTS_TABLE_V2_FLAG = "projects_table_v2";

export function useProjectsTableV2Flag(): boolean {
  const initialized = useFeatureFlagsStore((s) => s.initialized);
  const flag = useFeatureFlagsStore((s) => s.flags.get(PROJECTS_TABLE_V2_FLAG));

  if (!initialized) return false;
  return Boolean(flag?.enabled || flag?.hasOverride);
}
```

This intentionally differs from `canAccessFeature()`: unknown global route slugs remain accessible by existing convention, but this v2 component flag is fail-closed when the DB row is missing.

- [ ] **Step 6: Verify Task 1**

Run:

```bash
npm run type-check
git diff --check -- src/lib/feature-flags/feature-flag-definitions.ts src/lib/hooks/projects-table/use-projects-table-v2-flag.ts supabase/migrations
```

Expected: both commands exit 0.

**Milestone 1 Check-In:** report the migration filename, feature flag definition diff, type-check output, and whether the migration was applied or only written. Do not start Task 2.

---

### Task 2: Typed Project Table Contracts And Pure Utilities

**Files:**
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/api/query-client.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/types/project-table.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/utils/project-table-formatters.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/utils/project-filter-to-sql.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/projects-table/project-table-formatters.test.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/projects-table/project-filter-to-sql.test.ts`

- [ ] **Step 1: Add query keys for Phase 2**

In `queryKeys`, under the existing `projects` group, add:

```ts
    tableRows: (params: Record<string, unknown>) =>
      [...queryKeys.projects.all, "tableRows", params] as const,
    tableViews: (companyId: string, userId: string) =>
      [...queryKeys.projects.all, "tableViews", companyId, userId] as const,
```

Keep the existing `projects.lists()` keys untouched so Phase 2 does not disturb old canvas data.

- [ ] **Step 2: Add the table domain types**

Create `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/types/project-table.ts`:

```ts
import type { ColumnDef } from "@tanstack/react-table";
import type { Database, Json } from "@/lib/types/database.types";
import { ProjectStatus } from "@/lib/types/models";

export type ProjectTableDbRow = Database["public"]["Views"]["project_table_rows"]["Row"];
export type ProjectViewDbRow = Database["public"]["Tables"]["project_views"]["Row"];

export type ProjectTableColumnId =
  | "select"
  | "name"
  | "status"
  | "client"
  | "client_email"
  | "client_phone"
  | "address"
  | "team"
  | "start_date"
  | "end_date"
  | "duration"
  | "progress"
  | "next_task"
  | "task_count"
  | "days_in_status"
  | "estimate_total"
  | "invoice_total"
  | "paid_total"
  | "value"
  | "project_cost"
  | "margin"
  | "photos"
  | "updated_at";

export type ProjectTableCellKind =
  | "select"
  | "text"
  | "status"
  | "relation"
  | "number"
  | "currency"
  | "date"
  | "progress";

export interface ProjectTableColumnConfig {
  id: ProjectTableColumnId;
  labelKey: string;
  dbField?: keyof ProjectTableDbRow;
  kind: ProjectTableCellKind;
  frozen?: boolean;
  sortable?: boolean;
  minWidth: number;
  width: number;
  maxWidth: number;
  align?: "left" | "right";
  requiresPermission?: "projects.view_financials";
}

export interface ProjectTableRow {
  id: string;
  companyId: string;
  title: string;
  status: ProjectStatus;
  rawStatus: string;
  clientId: string | null;
  clientName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  address: string | null;
  teamMemberIds: string[];
  startDate: string | null;
  endDate: string | null;
  duration: number | null;
  progress: number | null;
  nextTask: string | null;
  taskCount: number;
  taskCompletedCount: number;
  daysInStatus: number | null;
  estimateTotal: number | null;
  invoiceTotal: number | null;
  paidTotal: number | null;
  value: number | null;
  projectCost: number | null;
  margin: number | null;
  photoCount: number;
  updatedAt: string | null;
}

export type ProjectTableDensity = "compact" | "comfortable" | "spacious";

export interface ProjectTableViewDefinition {
  id: string;
  name: string;
  icon: string | null;
  permissionKey: string | null;
  columns: ProjectTableColumnId[];
  filters: Json;
  sort: ProjectTableSort[];
  density: ProjectTableDensity;
  zoomLevel: number;
  isDefault: boolean;
  sortPosition: number;
  updatedAt: string;
}

export interface ProjectTableSort {
  field: ProjectTableColumnId | keyof ProjectTableDbRow;
  direction: "asc" | "desc";
}

export interface ProjectTableDataParams {
  companyId: string;
  userId: string;
  view: ProjectTableViewDefinition;
  search: string;
  sorting: ProjectTableSort[];
  pageSize: number;
}

export type ProjectTableColumnDef = ColumnDef<ProjectTableRow>;
```

- [ ] **Step 3: Add status conversion and formatters**

Create `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/utils/project-table-formatters.ts`:

```ts
import { ProjectStatus } from "@/lib/types/models";
import type {
  ProjectTableDbRow,
  ProjectTableRow,
  ProjectViewDbRow,
  ProjectTableColumnId,
  ProjectTableViewDefinition,
  ProjectTableDensity,
} from "@/lib/types/project-table";

const EMPTY = "—";

export function parseProjectTableStatus(raw: string | null): ProjectStatus {
  switch ((raw ?? "").toLowerCase()) {
    case "rfq":
      return ProjectStatus.RFQ;
    case "estimated":
      return ProjectStatus.Estimated;
    case "accepted":
      return ProjectStatus.Accepted;
    case "in_progress":
      return ProjectStatus.InProgress;
    case "completed":
      return ProjectStatus.Completed;
    case "closed":
      return ProjectStatus.Closed;
    case "archived":
      return ProjectStatus.Archived;
    default:
      return ProjectStatus.RFQ;
  }
}

export function formatProjectStatusLabel(status: ProjectStatus): string {
  return status === ProjectStatus.InProgress ? "In Progress" : status;
}

export function formatCurrency(value: number | null): string {
  if (value == null) return EMPTY;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPercent(value: number | null): string {
  if (value == null) return EMPTY;
  return `${Math.round(value)}%`;
}

export function formatNumber(value: number | null): string {
  if (value == null) return EMPTY;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

export function formatDate(value: string | null): string {
  if (!value) return EMPTY;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

export function mapProjectTableRow(row: ProjectTableDbRow): ProjectTableRow | null {
  if (!row.id || !row.company_id) return null;
  const rawStatus = row.status ?? "rfq";
  return {
    id: row.id,
    companyId: row.company_id,
    title: row.title ?? EMPTY,
    status: parseProjectTableStatus(rawStatus),
    rawStatus,
    clientId: row.client_id,
    clientName: row.client_name,
    clientEmail: row.client_email,
    clientPhone: row.client_phone,
    address: row.address,
    teamMemberIds: row.team_member_ids ?? [],
    startDate: row.start_date,
    endDate: row.end_date,
    duration: row.duration,
    progress: row.progress,
    nextTask: row.next_task,
    taskCount: row.task_count ?? 0,
    taskCompletedCount: row.task_completed_count ?? 0,
    daysInStatus: row.days_in_status,
    estimateTotal: row.estimate_total,
    invoiceTotal: row.invoice_total,
    paidTotal: row.paid_total,
    value: row.value,
    projectCost: row.project_cost,
    margin: row.margin,
    photoCount: row.photo_count ?? 0,
    updatedAt: row.updated_at,
  };
}

function isColumnId(value: unknown): value is ProjectTableColumnId {
  return typeof value === "string";
}

function normalizeDensity(value: string): ProjectTableDensity {
  return value === "compact" || value === "spacious" ? value : "comfortable";
}

export function mapProjectView(row: ProjectViewDbRow): ProjectTableViewDefinition {
  const columns = Array.isArray(row.columns)
    ? row.columns
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object" && "id" in item) {
            return (item as { id?: unknown }).id;
          }
          return null;
        })
        .filter(isColumnId)
    : [];

  const sort = Array.isArray(row.sort)
    ? row.sort.filter((item): item is { field: ProjectTableColumnId; direction: "asc" | "desc" } => {
        if (!item || typeof item !== "object") return false;
        const candidate = item as { field?: unknown; direction?: unknown };
        return isColumnId(candidate.field) && (candidate.direction === "asc" || candidate.direction === "desc");
      })
    : [];

  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    permissionKey: row.permission_key,
    columns,
    filters: row.filters,
    sort,
    density: normalizeDensity(row.density),
    zoomLevel: Number(row.zoom_level) || 1,
    isDefault: row.is_default,
    sortPosition: row.sort_position,
    updatedAt: row.updated_at,
  };
}
```

- [ ] **Step 4: Add filter-plan utility**

Create `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/utils/project-filter-to-sql.ts`:

```ts
import type { Json } from "@/lib/types/database.types";

export type ProjectTableFilterInstruction =
  | { type: "in"; field: "status" | "client_id"; values: string[] }
  | { type: "not_in"; field: "status" | "client_id"; values: string[] }
  | { type: "contains"; field: "team_member_ids"; values: string[] }
  | { type: "ilike_any"; fields: ("title" | "client_name" | "address")[]; value: string };

type FilterObject = {
  type?: unknown;
  key?: unknown;
  field?: unknown;
  op?: unknown;
  value?: unknown;
  and?: unknown;
};

function asObject(value: Json): FilterObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as FilterObject) : null;
}

function stringValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function fromNode(node: Json, currentUserId: string): ProjectTableFilterInstruction[] {
  const obj = asObject(node);
  if (!obj) return [];

  const instructions: ProjectTableFilterInstruction[] = [];

  if (obj.type === "dynamic" && obj.key === "current_user_assigned") {
    instructions.push({ type: "contains", field: "team_member_ids", values: [currentUserId] });
  }

  if ((obj.field === "status" || obj.field === "client_id") && (obj.op === "in" || obj.op === "not_in")) {
    const values = stringValues(obj.value);
    if (values.length > 0) {
      instructions.push({ type: obj.op, field: obj.field, values });
    }
  }

  if (Array.isArray(obj.and)) {
    for (const child of obj.and) {
      instructions.push(...fromNode(child as Json, currentUserId));
    }
  }

  return instructions;
}

export function buildProjectTableFilterInstructions(
  filter: Json,
  currentUserId: string,
  search: string,
): ProjectTableFilterInstruction[] {
  const instructions = fromNode(filter, currentUserId);
  const trimmed = search.trim();
  if (trimmed.length > 0) {
    instructions.push({
      type: "ilike_any",
      fields: ["title", "client_name", "address"],
      value: trimmed,
    });
  }
  return instructions;
}
```

- [ ] **Step 5: Add formatter tests first, then make them pass**

Create `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/projects-table/project-table-formatters.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ProjectStatus } from "@/lib/types/models";
import {
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  mapProjectTableRow,
  parseProjectTableStatus,
} from "@/lib/utils/project-table-formatters";

describe("project-table-formatters", () => {
  it("maps lowercase DB statuses to the TS enum boundary", () => {
    expect(parseProjectTableStatus("in_progress")).toBe(ProjectStatus.InProgress);
    expect(parseProjectTableStatus("completed")).toBe(ProjectStatus.Completed);
    expect(parseProjectTableStatus(null)).toBe(ProjectStatus.RFQ);
  });

  it("formats nulls as an operator dash", () => {
    expect(formatCurrency(null)).toBe("—");
    expect(formatPercent(null)).toBe("—");
    expect(formatNumber(null)).toBe("—");
    expect(formatDate(null)).toBe("—");
  });

  it("drops malformed rows without an id or company", () => {
    expect(mapProjectTableRow({ id: null, company_id: "co-1" } as never)).toBeNull();
    expect(mapProjectTableRow({ id: "p-1", company_id: null } as never)).toBeNull();
  });

  it("maps a project_table_rows record into a render row", () => {
    const row = mapProjectTableRow({
      id: "p-1",
      company_id: "co-1",
      title: "Deck rebuild",
      status: "accepted",
      team_member_ids: ["u-1"],
      task_count: 3,
      task_completed_count: 1,
      photo_count: 2,
    } as never);

    expect(row).toMatchObject({
      id: "p-1",
      title: "Deck rebuild",
      status: ProjectStatus.Accepted,
      rawStatus: "accepted",
      teamMemberIds: ["u-1"],
      taskCount: 3,
      taskCompletedCount: 1,
      photoCount: 2,
    });
  });
});
```

Run:

```bash
npm test -- --run tests/unit/projects-table/project-table-formatters.test.ts
```

Expected: PASS.

- [ ] **Step 6: Add filter tests first, then make them pass**

Create `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/projects-table/project-filter-to-sql.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildProjectTableFilterInstructions } from "@/lib/utils/project-filter-to-sql";

describe("project-filter-to-sql", () => {
  it("converts the My Active Work dynamic filter", () => {
    const instructions = buildProjectTableFilterInstructions(
      {
        type: "dynamic",
        key: "current_user_assigned",
        and: [{ field: "status", op: "not_in", value: ["closed", "archived"] }],
      },
      "user-1",
      "",
    );

    expect(instructions).toEqual([
      { type: "contains", field: "team_member_ids", values: ["user-1"] },
      { type: "not_in", field: "status", values: ["closed", "archived"] },
    ]);
  });

  it("converts financial overview status inclusion", () => {
    expect(
      buildProjectTableFilterInstructions(
        { field: "status", op: "in", value: ["accepted", "in_progress", "completed"] },
        "user-1",
        "",
      ),
    ).toEqual([
      { type: "in", field: "status", values: ["accepted", "in_progress", "completed"] },
    ]);
  });

  it("adds search as a title/client/address instruction", () => {
    expect(buildProjectTableFilterInstructions({}, "user-1", " deck ")).toEqual([
      { type: "ilike_any", fields: ["title", "client_name", "address"], value: "deck" },
    ]);
  });
});
```

Run:

```bash
npm test -- --run tests/unit/projects-table/project-filter-to-sql.test.ts
```

Expected: PASS.

- [ ] **Step 7: Verify Task 2**

Run:

```bash
npm run type-check
npm test -- --run tests/unit/projects-table/project-table-formatters.test.ts tests/unit/projects-table/project-filter-to-sql.test.ts
git diff --check -- src/lib/api/query-client.ts src/lib/types/project-table.ts src/lib/utils/project-table-formatters.ts src/lib/utils/project-filter-to-sql.ts tests/unit/projects-table
```

Expected: all commands exit 0.

**Milestone 2 Check-In:** report utility test output, type-check output, and any type compromises. Do not start Task 3.

---

### Task 3: Services And Query Hooks

**Files:**
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/api/services/project-views-service.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/api/services/project-table-service.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-project-views-list.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-project-view.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-projects-table-data.ts`

- [ ] **Step 1: Add the saved views service**

Create `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/api/services/project-views-service.ts`:

```ts
import { requireSupabase } from "@/lib/supabase/helpers";
import type { ProjectTableViewDefinition } from "@/lib/types/project-table";
import { mapProjectView } from "@/lib/utils/project-table-formatters";

export const ProjectViewsService = {
  async fetchViews(companyId: string): Promise<ProjectTableViewDefinition[]> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("project_views")
      .select("*")
      .eq("company_id", companyId)
      .eq("is_archived", false)
      .order("sort_position", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch project views: ${error.message}`);
    }

    return (data ?? []).map(mapProjectView);
  },
};
```

RLS handles company isolation and `permission_key` visibility. Do not duplicate role filtering in the client.

- [ ] **Step 2: Add the project table service**

Create `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/api/services/project-table-service.ts`:

```ts
import { requireSupabase } from "@/lib/supabase/helpers";
import type {
  ProjectTableDataParams,
  ProjectTableRow,
  ProjectTableSort,
} from "@/lib/types/project-table";
import { buildProjectTableFilterInstructions } from "@/lib/utils/project-filter-to-sql";
import { mapProjectTableRow } from "@/lib/utils/project-table-formatters";

const SORT_FIELD_MAP: Record<string, string> = {
  name: "title",
  status: "status",
  client: "client_name",
  client_email: "client_email",
  client_phone: "client_phone",
  address: "address",
  start_date: "start_date",
  end_date: "end_date",
  duration: "duration",
  progress: "progress",
  next_task: "next_task",
  task_count: "task_count",
  days_in_status: "days_in_status",
  estimate_total: "estimate_total",
  invoice_total: "invoice_total",
  paid_total: "paid_total",
  value: "value",
  project_cost: "project_cost",
  margin: "margin",
  photos: "photo_count",
  updated_at: "updated_at",
};

function normalizeSort(sort: ProjectTableSort[]): { field: string; ascending: boolean } {
  const first = sort[0];
  if (!first) return { field: "updated_at", ascending: false };
  return {
    field: SORT_FIELD_MAP[String(first.field)] ?? "updated_at",
    ascending: first.direction === "asc",
  };
}

export const ProjectTableService = {
  async fetchRows(
    params: ProjectTableDataParams & { pageParam?: number },
  ): Promise<{ rows: ProjectTableRow[]; count: number; nextPage: number | null }> {
    const supabase = requireSupabase();
    const page = params.pageParam ?? 0;
    const from = page * params.pageSize;
    const to = from + params.pageSize - 1;
    const sort = normalizeSort(params.sorting.length > 0 ? params.sorting : params.view.sort);

    let query = supabase
      .from("project_table_rows")
      .select("*", { count: "exact" })
      .eq("company_id", params.companyId);

    const instructions = buildProjectTableFilterInstructions(
      params.view.filters,
      params.userId,
      params.search,
    );

    for (const instruction of instructions) {
      if (instruction.type === "contains") {
        query = query.contains(instruction.field, instruction.values);
      } else if (instruction.type === "in") {
        query = query.in(instruction.field, instruction.values);
      } else if (instruction.type === "not_in") {
        query = query.not(instruction.field, "in", `(${instruction.values.join(",")})`);
      } else if (instruction.type === "ilike_any") {
        const escaped = instruction.value.replaceAll("%", "\\%").replaceAll("_", "\\_");
        query = query.or(
          instruction.fields
            .map((field) => `${field}.ilike.%${escaped}%`)
            .join(","),
        );
      }
    }

    const { data, error, count } = await query
      .order(sort.field, { ascending: sort.ascending, nullsFirst: false })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to fetch project table rows: ${error.message}`);
    }

    const rows = (data ?? []).map(mapProjectTableRow).filter((row): row is ProjectTableRow => row !== null);
    const total = count ?? rows.length;
    const nextPage = to + 1 < total ? page + 1 : null;

    return { rows, count: total, nextPage };
  },
};
```

Do not add mutation methods in this service during Phase 2.

- [ ] **Step 3: Add saved views query hook**

Create `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-project-views-list.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { ProjectViewsService } from "@/lib/api/services/project-views-service";
import { queryKeys } from "@/lib/api/query-client";
import { useAuthStore } from "@/lib/store/auth-store";

export function useProjectViewsList() {
  const companyId = useAuthStore((s) => s.company?.id ?? "");
  const userId = useAuthStore((s) => s.currentUser?.id ?? "");

  return useQuery({
    queryKey: queryKeys.projects.tableViews(companyId, userId),
    queryFn: () => ProjectViewsService.fetchViews(companyId),
    enabled: Boolean(companyId && userId),
    staleTime: 30_000,
  });
}
```

- [ ] **Step 4: Add active view hook**

Create `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-project-view.ts`:

```ts
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProjectTableViewDefinition } from "@/lib/types/project-table";

const STORAGE_KEY = "ops_projects_table_v2_view_id";

function pickInitialView(
  views: ProjectTableViewDefinition[],
  storedId: string | null,
): ProjectTableViewDefinition | null {
  if (views.length === 0) return null;
  const stored = storedId ? views.find((view) => view.id === storedId) : null;
  if (stored) return stored;
  return views.find((view) => view.name === "My Active Work") ?? views[0];
}

export function useProjectView(views: ProjectTableViewDefinition[] | undefined) {
  const [activeViewId, setActiveViewIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(STORAGE_KEY);
  });

  const activeView = useMemo(() => {
    return pickInitialView(views ?? [], activeViewId);
  }, [views, activeViewId]);

  useEffect(() => {
    if (!activeView || activeView.id === activeViewId) return;
    setActiveViewIdState(activeView.id);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, activeView.id);
    }
  }, [activeView, activeViewId]);

  const setActiveViewId = useCallback((viewId: string) => {
    setActiveViewIdState(viewId);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, viewId);
    }
  }, []);

  return { activeView, activeViewId: activeView?.id ?? null, setActiveViewId };
}
```

- [ ] **Step 5: Add infinite table data hook**

Create `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-projects-table-data.ts`:

```ts
import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ProjectTableService } from "@/lib/api/services/project-table-service";
import { queryKeys } from "@/lib/api/query-client";
import { useAuthStore } from "@/lib/store/auth-store";
import type { ProjectTableSort, ProjectTableViewDefinition } from "@/lib/types/project-table";

const PAGE_SIZE = 200;

export function useProjectsTableData(args: {
  view: ProjectTableViewDefinition | null;
  search: string;
  sorting: ProjectTableSort[];
}) {
  const companyId = useAuthStore((s) => s.company?.id ?? "");
  const userId = useAuthStore((s) => s.currentUser?.id ?? "");

  const queryParams = useMemo(
    () => ({
      companyId,
      userId,
      viewId: args.view?.id ?? "",
      viewUpdatedAt: args.view?.updatedAt ?? "",
      search: args.search,
      sorting: args.sorting,
    }),
    [companyId, userId, args.view?.id, args.view?.updatedAt, args.search, args.sorting],
  );

  const query = useInfiniteQuery({
    queryKey: queryKeys.projects.tableRows(queryParams),
    queryFn: ({ pageParam }) => {
      if (!args.view) {
        return Promise.resolve({ rows: [], count: 0, nextPage: null });
      }
      return ProjectTableService.fetchRows({
        companyId,
        userId,
        view: args.view,
        search: args.search,
        sorting: args.sorting,
        pageSize: PAGE_SIZE,
        pageParam,
      });
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextPage,
    enabled: Boolean(companyId && userId && args.view),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  return {
    ...query,
    rows: query.data?.pages.flatMap((page) => page.rows) ?? [],
    totalCount: query.data?.pages[0]?.count ?? 0,
  };
}
```

- [ ] **Step 6: Verify Task 3**

Run:

```bash
npm run type-check
git diff --check -- src/lib/api/services/project-views-service.ts src/lib/api/services/project-table-service.ts src/lib/hooks/projects-table
```

Expected: both commands exit 0.

**Milestone 3 Check-In:** report type-check output and service/hook file list. Do not start Task 4.

---

### Task 4: Selection, Zoom, Columns, And Read-Only Cells

**Files:**
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-table-selection.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-table-zoom.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/cells/*.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/hooks/use-table-selection.test.ts`

- [ ] **Step 1: Add selection hook with filter prune**

Create `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-table-selection.ts`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export function useTableSelection(visibleRowIds: string[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastSelectedRef = useRef<string | null>(null);

  const visibleSet = useMemo(() => new Set(visibleRowIds), [visibleRowIds]);

  useEffect(() => {
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => visibleSet.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [visibleSet]);

  const clearSelection = useCallback(() => {
    lastSelectedRef.current = null;
    setSelectedIds(new Set());
  }, []);

  const toggleRow = useCallback(
    (rowId: string, mode: "single" | "toggle" | "range") => {
      setSelectedIds((current) => {
        const next = new Set(current);
        if (mode === "range" && lastSelectedRef.current) {
          const start = visibleRowIds.indexOf(lastSelectedRef.current);
          const end = visibleRowIds.indexOf(rowId);
          if (start !== -1 && end !== -1) {
            const [from, to] = start < end ? [start, end] : [end, start];
            for (let i = from; i <= to; i += 1) next.add(visibleRowIds[i]);
          }
        } else if (mode === "toggle") {
          if (next.has(rowId)) next.delete(rowId);
          else next.add(rowId);
          lastSelectedRef.current = rowId;
        } else {
          next.clear();
          next.add(rowId);
          lastSelectedRef.current = rowId;
        }
        return next;
      });
    },
    [visibleRowIds],
  );

  return { selectedIds, selectedCount: selectedIds.size, toggleRow, clearSelection };
}
```

- [ ] **Step 2: Test selection pruning and range behavior**

Create `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/hooks/use-table-selection.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTableSelection } from "@/lib/hooks/projects-table/use-table-selection";

describe("useTableSelection", () => {
  it("selects a single row", () => {
    const { result } = renderHook(() => useTableSelection(["a", "b", "c"]));
    act(() => result.current.toggleRow("b", "single"));
    expect([...result.current.selectedIds]).toEqual(["b"]);
  });

  it("toggles a row without clearing other rows", () => {
    const { result } = renderHook(() => useTableSelection(["a", "b", "c"]));
    act(() => result.current.toggleRow("a", "single"));
    act(() => result.current.toggleRow("c", "toggle"));
    expect([...result.current.selectedIds].sort()).toEqual(["a", "c"]);
  });

  it("selects a range from the last anchor", () => {
    const { result } = renderHook(() => useTableSelection(["a", "b", "c", "d"]));
    act(() => result.current.toggleRow("a", "single"));
    act(() => result.current.toggleRow("c", "range"));
    expect([...result.current.selectedIds].sort()).toEqual(["a", "b", "c"]);
  });

  it("prunes selection when visible row ids change", () => {
    const { result, rerender } = renderHook(({ ids }) => useTableSelection(ids), {
      initialProps: { ids: ["a", "b", "c"] },
    });
    act(() => result.current.toggleRow("b", "single"));
    rerender({ ids: ["a", "c"] });
    expect([...result.current.selectedIds]).toEqual([]);
  });
});
```

Run:

```bash
npm test -- --run tests/unit/hooks/use-table-selection.test.ts
```

Expected: PASS.

- [ ] **Step 3: Add zoom hook**

Create `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-table-zoom.ts`:

```ts
import { useCallback, useMemo, useRef, useState } from "react";
import type { ProjectTableDensity } from "@/lib/types/project-table";

const MIN_ZOOM = 0.75;
const MAX_ZOOM = 1.5;

export function clampTableZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(2))));
}

export function densityFromZoom(zoom: number): ProjectTableDensity {
  if (zoom <= 0.9) return "compact";
  if (zoom >= 1.18) return "spacious";
  return "comfortable";
}

export function useTableZoom(initialZoom = 1) {
  const [zoom, setZoom] = useState(() => clampTableZoom(initialZoom));
  const pinchDistanceRef = useRef<number | null>(null);

  const density = densityFromZoom(zoom);

  const metrics = useMemo(() => {
    return {
      zoom,
      density,
      rowHeight: Math.round(38 * zoom),
      headerHeight: Math.round(42 * zoom),
      fontSize: Math.max(12, Math.round(14 * zoom)),
      microFontSize: Math.max(11, Math.round(11 * zoom)),
      columnScale: zoom,
    };
  }, [density, zoom]);

  const adjustZoom = useCallback((delta: number) => {
    setZoom((current) => clampTableZoom(current + delta));
  }, []);

  const handleWheel = useCallback(
    (event: React.WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      adjustZoom(event.deltaY > 0 ? -0.04 : 0.04);
    },
    [adjustZoom],
  );

  const beginPinch = useCallback((distance: number) => {
    pinchDistanceRef.current = distance;
  }, []);

  const updatePinch = useCallback((distance: number) => {
    const previous = pinchDistanceRef.current;
    if (!previous) {
      pinchDistanceRef.current = distance;
      return;
    }
    const delta = (distance - previous) / 500;
    pinchDistanceRef.current = distance;
    adjustZoom(delta);
  }, [adjustZoom]);

  const endPinch = useCallback(() => {
    pinchDistanceRef.current = null;
  }, []);

  return { zoom, setZoom, metrics, handleWheel, beginPinch, updatePinch, endPinch };
}
```

- [ ] **Step 4: Add read-only cell components**

Create the cell files using the following contracts:

`cell-text.tsx`:

```tsx
import { cn } from "@/lib/utils/cn";

export function CellText({ value, title, className }: { value: string | null; title?: string; className?: string }) {
  const display = value?.trim() || "—";
  return (
    <span title={title ?? display} className={cn("block min-w-0 truncate font-mohave text-text", className)}>
      {display}
    </span>
  );
}
```

`cell-number.tsx`:

```tsx
import { formatNumber } from "@/lib/utils/project-table-formatters";

export function CellNumber({ value }: { value: number | null }) {
  return <span className="font-mono tabular-nums text-text-2">{formatNumber(value)}</span>;
}
```

`cell-currency.tsx`:

```tsx
import { formatCurrency } from "@/lib/utils/project-table-formatters";

export function CellCurrency({ value }: { value: number | null }) {
  return <span className="font-mono tabular-nums text-text-2">{formatCurrency(value)}</span>;
}
```

`cell-date.tsx`:

```tsx
import { formatDate } from "@/lib/utils/project-table-formatters";

export function CellDate({ value }: { value: string | null }) {
  return <span className="font-mono tabular-nums text-text-2">{formatDate(value)}</span>;
}
```

`cell-status.tsx`:

```tsx
import { PROJECT_STATUS_COLORS, type ProjectStatus } from "@/lib/types/models";
import { formatProjectStatusLabel } from "@/lib/utils/project-table-formatters";

export function CellStatus({ status }: { status: ProjectStatus }) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1 rounded-chip border px-1.5 py-0.5 font-mono text-micro uppercase tracking-wider text-text-2"
      style={{ borderColor: PROJECT_STATUS_COLORS[status] }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: PROJECT_STATUS_COLORS[status] }} />
      <span className="truncate">{formatProjectStatusLabel(status)}</span>
    </span>
  );
}
```

`cell-progress.tsx`:

```tsx
export function CellProgress({ value }: { value: number | null }) {
  const pct = Math.max(0, Math.min(100, Math.round(value ?? 0)));
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-bar bg-fill-neutral-dim">
        <div className="h-full rounded-bar bg-fill-neutral" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right font-mono text-micro tabular-nums text-text-3">{value == null ? "—" : `${pct}%`}</span>
    </div>
  );
}
```

`cell-relation.tsx`:

```tsx
import { CellText } from "./cell-text";

export function CellRelation({ value }: { value: string | null }) {
  return <CellText value={value} className="text-text-2" />;
}
```

- [ ] **Step 5: Verify Task 4**

Run:

```bash
npm run type-check
npm test -- --run tests/unit/hooks/use-table-selection.test.ts
git diff --check -- src/lib/hooks/projects-table/use-table-selection.ts src/lib/hooks/projects-table/use-table-zoom.ts 'src/app/(dashboard)/projects/_components/table-v2/cells' tests/unit/hooks/use-table-selection.test.ts
```

Expected: all commands exit 0.

**Milestone 4 Check-In:** report test output, type-check output, and cell file list. Do not start Task 5.

---

### Task 5: Virtual Table Components

**Files:**
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-view-tabs.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-toolbar.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-empty-state.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-table-header.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-table-row.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-table.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-table-shell.tsx`

- [ ] **Step 1: Add column configuration**

Add this export to `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/types/project-table.ts`:

```ts
export const PROJECT_TABLE_COLUMNS: ProjectTableColumnConfig[] = [
  { id: "select", labelKey: "table.column.select", kind: "select", frozen: true, minWidth: 42, width: 42, maxWidth: 42 },
  { id: "name", labelKey: "table.column.name", dbField: "title", kind: "text", frozen: true, sortable: true, minWidth: 200, width: 280, maxWidth: 480 },
  { id: "status", labelKey: "table.column.status", dbField: "status", kind: "status", frozen: true, sortable: true, minWidth: 96, width: 112, maxWidth: 128 },
  { id: "client", labelKey: "table.column.client", dbField: "client_name", kind: "relation", sortable: true, minWidth: 140, width: 180, maxWidth: 320 },
  { id: "client_email", labelKey: "table.column.clientEmail", dbField: "client_email", kind: "text", sortable: true, minWidth: 160, width: 220, maxWidth: 320 },
  { id: "client_phone", labelKey: "table.column.clientPhone", dbField: "client_phone", kind: "text", sortable: true, minWidth: 130, width: 150, maxWidth: 200 },
  { id: "address", labelKey: "table.column.address", dbField: "address", kind: "text", sortable: true, minWidth: 180, width: 260, maxWidth: 420 },
  { id: "team", labelKey: "table.column.team", dbField: "team_member_ids", kind: "text", minWidth: 120, width: 160, maxWidth: 240 },
  { id: "start_date", labelKey: "table.column.startDate", dbField: "start_date", kind: "date", sortable: true, minWidth: 110, width: 130, maxWidth: 160 },
  { id: "end_date", labelKey: "table.column.endDate", dbField: "end_date", kind: "date", sortable: true, minWidth: 110, width: 130, maxWidth: 160 },
  { id: "duration", labelKey: "table.column.duration", dbField: "duration", kind: "number", sortable: true, minWidth: 90, width: 110, maxWidth: 140, align: "right" },
  { id: "progress", labelKey: "table.column.progress", dbField: "progress", kind: "progress", sortable: true, minWidth: 100, width: 140, maxWidth: 200 },
  { id: "next_task", labelKey: "table.column.nextTask", dbField: "next_task", kind: "text", sortable: true, minWidth: 160, width: 220, maxWidth: 320 },
  { id: "task_count", labelKey: "table.column.tasks", dbField: "task_count", kind: "number", sortable: true, minWidth: 80, width: 90, maxWidth: 120, align: "right" },
  { id: "days_in_status", labelKey: "table.column.days", dbField: "days_in_status", kind: "number", sortable: true, minWidth: 100, width: 130, maxWidth: 160, align: "right" },
  { id: "estimate_total", labelKey: "table.column.estimate", dbField: "estimate_total", kind: "currency", sortable: true, minWidth: 110, width: 130, maxWidth: 180, align: "right", requiresPermission: "projects.view_financials" },
  { id: "invoice_total", labelKey: "table.column.invoiced", dbField: "invoice_total", kind: "currency", sortable: true, minWidth: 110, width: 130, maxWidth: 180, align: "right", requiresPermission: "projects.view_financials" },
  { id: "paid_total", labelKey: "table.column.paid", dbField: "paid_total", kind: "currency", sortable: true, minWidth: 110, width: 130, maxWidth: 180, align: "right", requiresPermission: "projects.view_financials" },
  { id: "value", labelKey: "table.column.value", dbField: "value", kind: "currency", sortable: true, minWidth: 110, width: 130, maxWidth: 180, align: "right", requiresPermission: "projects.view_financials" },
  { id: "project_cost", labelKey: "table.column.cost", dbField: "project_cost", kind: "currency", sortable: true, minWidth: 110, width: 130, maxWidth: 180, align: "right", requiresPermission: "projects.view_financials" },
  { id: "margin", labelKey: "table.column.margin", dbField: "margin", kind: "number", sortable: true, minWidth: 90, width: 110, maxWidth: 140, align: "right", requiresPermission: "projects.view_financials" },
  { id: "photos", labelKey: "table.column.photos", dbField: "photo_count", kind: "number", sortable: true, minWidth: 80, width: 100, maxWidth: 140, align: "right" },
  { id: "updated_at", labelKey: "table.column.updated", dbField: "updated_at", kind: "date", sortable: true, minWidth: 120, width: 150, maxWidth: 190 },
];
```

- [ ] **Step 2: Add view tabs**

Create `projects-view-tabs.tsx`:

```tsx
"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { ProjectTableViewDefinition } from "@/lib/types/project-table";

export function ProjectsViewTabs({
  views,
  activeViewId,
  onViewChange,
}: {
  views: ProjectTableViewDefinition[];
  activeViewId: string | null;
  onViewChange: (viewId: string) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto border-b border-border px-3 py-2">
      {views.map((view) => {
        const active = view.id === activeViewId;
        return (
          <button
            key={view.id}
            type="button"
            onClick={() => onViewChange(view.id)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-chip border px-2 py-1 font-mono text-micro uppercase tracking-wider transition-colors",
              active
                ? "border-ops-accent text-text"
                : "border-border-subtle text-text-3 hover:border-border hover:text-text-2",
            )}
          >
            {active && <Check className="h-3 w-3" />}
            {view.name}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Add toolbar**

Create `projects-toolbar.tsx`:

```tsx
"use client";

import { Search, Rows3, ZoomIn } from "lucide-react";
import { useDictionary } from "@/i18n/client";

export function ProjectsToolbar({
  search,
  onSearchChange,
  rowCount,
  totalCount,
  zoom,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  rowCount: number;
  totalCount: number;
  zoom: number;
}) {
  const { t } = useDictionary("projects");

  return (
    <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border px-3 py-2">
      <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-[5px] border border-border bg-surface-input px-2 py-1.5 focus-within:border-ops-accent">
        <Search className="h-4 w-4 shrink-0 text-text-3" />
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t("table.toolbar.searchPlaceholder")}
          className="min-w-0 flex-1 bg-transparent font-mohave text-body-sm text-text outline-none placeholder:text-text-3"
        />
      </label>
      <div className="flex shrink-0 items-center gap-3 font-mono text-micro uppercase tracking-wider text-text-3">
        <span className="inline-flex items-center gap-1">
          <Rows3 className="h-3.5 w-3.5" />
          {t("table.toolbar.rows")
            .replace("{count}", String(rowCount))
            .replace("{total}", String(totalCount))}
        </span>
        <span className="inline-flex items-center gap-1">
          <ZoomIn className="h-3.5 w-3.5" />
          {Math.round(zoom * 100)}%
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add empty/error state**

Create `projects-empty-state.tsx`:

```tsx
"use client";

import { AlertTriangle } from "lucide-react";
import { useDictionary } from "@/i18n/client";

export function ProjectsEmptyState({
  mode,
  onRetry,
}: {
  mode: "loading" | "empty" | "filtered" | "error";
  onRetry?: () => void;
}) {
  const { t } = useDictionary("projects");

  if (mode === "loading") {
    return <div className="p-6 font-mono text-micro uppercase tracking-wider text-text-3">{t("table.loading.refetching")}</div>;
  }

  if (mode === "error") {
    return (
      <div className="flex h-full flex-col items-start justify-center gap-3 p-6">
        <AlertTriangle className="h-5 w-5 text-text-3" />
        <div className="font-cakemono text-[18px] font-light uppercase text-text">{t("table.error.title")}</div>
        {onRetry && (
          <button type="button" onClick={onRetry} className="rounded-[5px] border border-ops-accent px-3 py-1.5 font-cakemono text-sm font-light uppercase text-ops-accent hover:bg-ops-accent hover:text-black">
            {t("table.error.retry")}
          </button>
        )}
      </div>
    );
  }

  const title = mode === "filtered" ? t("table.empty.filteredTitle") : t("table.empty.allTitle");
  const body = mode === "filtered" ? t("table.empty.filteredBody") : t("table.empty.allBody");

  return (
    <div className="flex h-full flex-col items-start justify-center gap-2 p-6">
      <div className="font-cakemono text-[18px] font-light uppercase text-text">{title}</div>
      <div className="font-mohave text-body-sm text-text-3">{body}</div>
    </div>
  );
}
```

- [ ] **Step 5: Build `ProjectsTable` with TanStack Table + Virtual**

Create the table/header/row components with these required behaviors:

- The scroll container is one element that owns both horizontal and vertical scroll.
- Header and body share the same column widths from `PROJECT_TABLE_COLUMNS`.
- The first three columns (`select`, `name`, `status`) are `position: sticky` on the left.
- Row height comes from `metrics.rowHeight`.
- `useVirtualizer` renders rows with `estimateSize: () => metrics.rowHeight`.
- Near-bottom scroll calls `fetchNextPage()` when `hasNextPage` is true.
- Any open action/menu state must close in the scroll handler; this prevents the original action-menu horizontal-scroll bug from returning.
- Cell click opens the detail window through `useWindowStore.openProjectWindow({ projectId, mode: "viewing" })`; no editing starts in Phase 2.

The cell renderer should follow this shape:

```tsx
function renderReadOnlyCell(row: ProjectTableRow, column: ProjectTableColumnConfig) {
  switch (column.id) {
    case "name":
      return <CellText value={row.title} />;
    case "status":
      return <CellStatus status={row.status} />;
    case "client":
      return <CellRelation value={row.clientName} />;
    case "client_email":
      return <CellText value={row.clientEmail} className="font-mono text-text-2" />;
    case "client_phone":
      return <CellText value={row.clientPhone} className="font-mono text-text-2" />;
    case "address":
      return <CellText value={row.address} className="text-text-2" />;
    case "start_date":
      return <CellDate value={row.startDate} />;
    case "end_date":
      return <CellDate value={row.endDate} />;
    case "duration":
      return <CellNumber value={row.duration} />;
    case "progress":
      return <CellProgress value={row.progress} />;
    case "next_task":
      return <CellText value={row.nextTask} className="text-text-2" />;
    case "task_count":
      return <CellNumber value={row.taskCount} />;
    case "days_in_status":
      return <CellNumber value={row.daysInStatus} />;
    case "estimate_total":
      return <CellCurrency value={row.estimateTotal} />;
    case "invoice_total":
      return <CellCurrency value={row.invoiceTotal} />;
    case "paid_total":
      return <CellCurrency value={row.paidTotal} />;
    case "value":
      return <CellCurrency value={row.value} />;
    case "project_cost":
      return <CellCurrency value={row.projectCost} />;
    case "margin":
      return <CellNumber value={row.margin} />;
    case "photos":
      return <CellNumber value={row.photoCount} />;
    case "updated_at":
      return <CellDate value={row.updatedAt} />;
    default:
      return <CellText value="—" />;
  }
}
```

Use `PROJECT_TABLE_COLUMNS.filter((column) => activeView.columns.includes(column.id) || column.id === "select")` for visible columns. If a saved view's `columns` JSON is empty, fall back to `name`, `status`, `client`, `end_date`, `next_task`, `progress`.

- [ ] **Step 6: Add shell composition**

Create `projects-table-shell.tsx` that composes:

```tsx
<div className="glass-surface flex h-full min-h-0 flex-col overflow-hidden rounded-panel border border-border">
  <ProjectsViewTabs ... />
  <ProjectsToolbar ... />
  <ProjectsTable ... />
</div>
```

The shell owns:

- `const [search, setSearch] = useState("")`
- `const [sorting, setSorting] = useState<ProjectTableSort[]>([])`
- `const viewsQuery = useProjectViewsList()`
- `const { activeView, activeViewId, setActiveViewId } = useProjectView(viewsQuery.data)`
- `const tableQuery = useProjectsTableData({ view: activeView, search, sorting })`
- `const zoom = useTableZoom(activeView?.zoomLevel ?? 1)`
- `const selection = useTableSelection(tableQuery.rows.map((row) => row.id))`

Loading, empty, filtered-empty, and error state must render through `ProjectsEmptyState`.

- [ ] **Step 7: Verify Task 5**

Run:

```bash
npm run type-check
git diff --check -- 'src/app/(dashboard)/projects/_components/table-v2' src/lib/types/project-table.ts
```

Expected: both commands exit 0.

**Milestone 5 Check-In:** report component file list, type-check output, and any UI deviation from the frozen-left strategy. Do not start Task 6.

---

### Task 6: Route Integration, Dictionaries, Integration Test, And Visual Gate

**Files:**
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/page.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/i18n/dictionaries/en/projects.json`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/i18n/dictionaries/es/projects.json`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/integration/projects-table-v2-read-only.test.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/ops-software-bible/10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md`

- [ ] **Step 1: Add dictionary keys**

Add these flat keys to English:

```json
"table.toolbar.searchPlaceholder": "Search projects...",
"table.toolbar.rows": "{count} / {total} rows",
"table.column.select": "Select",
"table.column.name": "Name",
"table.column.status": "Status",
"table.column.client": "Client",
"table.column.clientEmail": "Client email",
"table.column.clientPhone": "Client phone",
"table.column.address": "Address",
"table.column.team": "Team",
"table.column.startDate": "Start",
"table.column.endDate": "End",
"table.column.duration": "Days",
"table.column.progress": "Progress",
"table.column.nextTask": "Next",
"table.column.tasks": "Tasks",
"table.column.days": "Days in status",
"table.column.estimate": "Estimate",
"table.column.invoiced": "Invoiced",
"table.column.paid": "Paid",
"table.column.value": "Value",
"table.column.cost": "Cost",
"table.column.margin": "Margin",
"table.column.photos": "Photos",
"table.column.updated": "Updated"
```

Add these flat keys to Spanish:

```json
"table.toolbar.searchPlaceholder": "Buscar proyectos...",
"table.toolbar.rows": "{count} / {total} filas",
"table.column.select": "Seleccionar",
"table.column.name": "Nombre",
"table.column.status": "Estado",
"table.column.client": "Cliente",
"table.column.clientEmail": "Correo del cliente",
"table.column.clientPhone": "Teléfono del cliente",
"table.column.address": "Dirección",
"table.column.team": "Equipo",
"table.column.startDate": "Inicio",
"table.column.endDate": "Fin",
"table.column.duration": "Días",
"table.column.progress": "Progreso",
"table.column.nextTask": "Siguiente",
"table.column.tasks": "Tareas",
"table.column.days": "Días en estado",
"table.column.estimate": "Cotización",
"table.column.invoiced": "Facturado",
"table.column.paid": "Pagado",
"table.column.value": "Valor",
"table.column.cost": "Costo",
"table.column.margin": "Margen",
"table.column.photos": "Fotos",
"table.column.updated": "Actualizado"
```

Run:

```bash
jq empty src/i18n/dictionaries/en/projects.json
jq empty src/i18n/dictionaries/es/projects.json
```

Expected: both exit 0.

- [ ] **Step 2: Wire the v2 table into the Projects page**

In `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/page.tsx`:

1. Import the v2 flag hook and shell:

```ts
import { useProjectsTableV2Flag } from "@/lib/hooks/projects-table/use-projects-table-v2-flag";
import { ProjectsTableShell } from "./_components/table-v2/projects-table-shell";
```

2. Inside `ProjectsPage`, add:

```ts
const projectsTableV2Enabled = useProjectsTableV2Flag();
```

3. Change initial view preference behavior so flagged users land on the spreadsheet when no local preference exists:

```ts
const [viewMode, setViewMode] = useState<"canvas" | "spreadsheet">(() => {
  if (typeof window === "undefined") return "canvas";
  const stored = localStorage.getItem("ops_projects_view_mode") as "canvas" | "spreadsheet" | null;
  return stored ?? "canvas";
});

useEffect(() => {
  if (!projectsTableV2Enabled || typeof window === "undefined") return;
  if (localStorage.getItem("ops_projects_view_mode")) return;
  setViewMode("spreadsheet");
}, [projectsTableV2Enabled]);
```

4. In the spreadsheet render branch, choose v2 only when the flag is on:

```tsx
{viewMode === "spreadsheet" && projectsTableV2Enabled && (
  <div className="absolute inset-0 top-[156px] bottom-0 px-3 overflow-hidden flex flex-col">
    <ProjectsTableShell />
  </div>
)}

{viewMode === "spreadsheet" && !projectsTableV2Enabled && (
  <div className="absolute inset-0 top-[156px] bottom-0 px-3 overflow-hidden flex flex-col">
    <ProjectSpreadsheet
      projects={filteredProjects.filter((p) => p.status !== ProjectStatus.Archived && p.status !== ProjectStatus.Closed)}
      allFilteredProjects={filteredProjects}
      statusFilter={spreadsheetStatusFilter}
      clientNameMap={clientNameMap}
      clientEmailMap={clientEmailMap}
      clientPhoneMap={clientPhoneMap}
      teamMemberMap={teamMemberMap}
      projectValueMap={projectValueMap}
      estimateTotalMap={estimateTotalMap}
      projectTaskCountMap={projectTaskCountMap}
      canManage={canManage}
      canViewAccounting={canViewAccounting}
      canCreateTasks={canCreateTasks}
      canRecordPayment={canRecordPayment}
      canDelete={canDelete}
      selectedIds={spreadsheetSelectedIds}
      onSelectedIdsChange={setSpreadsheetSelectedIds}
      onAddTask={handleAddTask}
    />
  </div>
)}
```

Do not remove canvas behavior in Phase 2.

- [ ] **Step 3: Add integration test with mocked Phase 2 hooks**

Create `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/integration/projects-table-v2-read-only.test.tsx` that verifies:

- three saved views render
- clicking a saved view switches active view
- table rows render read-only cells
- changing search triggers filtered empty state
- no old mobile card list is present in the v2 table shell

Use `vi.mock()` for `useProjectViewsList`, `useProjectView`, `useProjectsTableData`, and `useProjectsTableV2Flag` rather than hitting Supabase.

The row fixture should include at least:

```ts
{
  id: "p-1",
  companyId: "co-1",
  title: "Deck rebuild",
  status: ProjectStatus.InProgress,
  rawStatus: "in_progress",
  clientName: "Riley Home",
  endDate: "2026-05-20",
  progress: 50,
  nextTask: "Frame inspection",
  taskCount: 4,
  taskCompletedCount: 2,
  value: null,
  projectCost: null,
  margin: null,
}
```

Expected assertions:

```ts
expect(screen.getByRole("button", { name: /My Active Work/i })).toBeInTheDocument();
expect(screen.getByText("Deck rebuild")).toBeInTheDocument();
expect(screen.getByText("In Progress")).toBeInTheDocument();
expect(screen.getByText("Frame inspection")).toBeInTheDocument();
expect(screen.queryByText("Add task")).not.toBeInTheDocument();
```

- [ ] **Step 4: Update the bible**

In `/Users/jacksonsweet/Projects/OPS/ops-software-bible/10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md`, append a short dated note under the Phase 1 Projects Table V2 section:

```markdown
### Projects Table V2 Phase 2 Read-Only UI (added 2026-05-12)

Phase 2 renders the new Projects spreadsheet behind the per-user `projects_table_v2` component flag. The UI reads `project_views` for seeded saved views and `project_table_rows` for the virtualized read model. It is read-only: status changes, team assignment, inline editing, undo, and conflict handling remain outside this phase. The default load excludes closed and archived projects through the seeded saved-view filters; operators can still switch views without touching the legacy canvas.
```

- [ ] **Step 5: Run full local verification**

Run:

```bash
npm run type-check
npm test -- --run tests/unit/projects-table/project-table-formatters.test.ts tests/unit/projects-table/project-filter-to-sql.test.ts tests/unit/hooks/use-table-selection.test.ts tests/integration/projects-table-v2-read-only.test.tsx
jq empty src/i18n/dictionaries/en/projects.json
jq empty src/i18n/dictionaries/es/projects.json
git diff --check -- src tests docs/superpowers/plans src/i18n/dictionaries/en/projects.json src/i18n/dictionaries/es/projects.json
rg -n "[ \t]+$" /Users/jacksonsweet/Projects/OPS/ops-software-bible/10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md
```

Expected: the first four commands exit 0; the final `rg` command exits 1 because it finds no trailing whitespace.

- [ ] **Step 6: Browser visual verification**

Start the dev server:

```bash
npm run dev -- --port 3002
```

Open `http://localhost:3002/projects` in the in-app browser. Verify with the feature flag enabled for the signed-in test user:

- `/projects` lands on the v2 table if no local `ops_projects_view_mode` preference exists.
- The table shows saved view tabs.
- My Active Work and All Active do not show closed or archived projects on immediate load.
- Financial Overview is hidden for users without `projects.view_financials`.
- Horizontal scroll works at desktop width and iPad portrait width.
- Left columns remain frozen while horizontal scrolling.
- Vertical scroll remains smooth with virtualization.
- Pinch or ctrl-wheel adjusts density by row height, font size, and min-widths; it does not use `transform: scale()`.
- Long project names truncate in the name cell without overlapping the status column.
- No in-app instructional copy explains how the table works.

Stop the dev server before final check-in.

**Milestone 6 Check-In:** report all verification commands, test counts, browser/device observations, and any visual issues. This is the Phase 2 ship-gate checkpoint.

---

## Self-Review Checklist

- Saved views: Task 3 reads `project_views`; Task 5 renders tabs.
- Row virtualization: Task 5 uses TanStack Virtual.
- Frozen-left + horizontal scroll: Task 5 requires a single scroll container and sticky first three columns.
- iPad portrait: Task 6 browser gate checks the same table, no card mode.
- Loading/empty/error states: Task 5 renders `ProjectsEmptyState`.
- Selection prune: Task 4 tests `useTableSelection`.
- Action menu scroll bug: Task 5 requires scroll handler to close transient menus.
- Design system: Task 5 uses glass, hairlines, tokens, no shadows, no decorative accent.
- i18n: Task 6 adds flat dictionary keys and tests JSON.
- No mutations: Phase 2 boundaries and services exclude mutation methods.
- Phase 1 foundation: services use `project_table_rows` and `project_views`.

## Execution Prompt For First Phase 2 Agent

Use this title if spawning a fresh task: `PROJECTS TABLE REDESIGN - P2-1`

Prompt:

```text
You are implementing Phase 2 of the OPS-Web Projects Table Redesign. Work only from:

/Users/jacksonsweet/Projects/OPS/OPS-Web/docs/superpowers/plans/2026-05-12-projects-table-redesign-phase-2-read-only-virtual-table.md

Start at Task 1 only. Use superpowers:executing-plans. Follow the PM Check-In Protocol exactly: finish Task 1, run its verification commands, then stop and report files changed, exact commands run, outputs, blockers/deviations. Do not start Task 2 until PM approves.

Hard constraints:
- Do not touch Phase 1 migration except to read it.
- Do not route-gate /projects.
- The projects_table_v2 flag is component-only and must fail closed in the v2 hook.
- Do not implement editing, mutations, undo, conflict handling, image upload, team assignment, or custom view creation in Phase 2.
- Leave unrelated dirty work untouched.
```
