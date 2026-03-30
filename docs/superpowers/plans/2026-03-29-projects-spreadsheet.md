# Projects Spreadsheet View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a spreadsheet (table) view mode to the `/projects` route with inline editing, 20 columns, row selection, bulk actions, and column visibility.

**Architecture:** View toggle in `page.tsx` conditionally renders either the existing canvas or a new `<ProjectSpreadsheet>`. All data fetching/filtering/permissions stay in `page.tsx` and pass as props. Spreadsheet manages its own sort and selection state.

**Tech Stack:** Next.js 14 App Router, TypeScript, Zustand (canvas store only — spreadsheet uses local state), TanStack Query, Tailwind CSS, Lucide React, Framer Motion (toolbar animation only).

**Spec:** `docs/superpowers/specs/2026-03-29-projects-spreadsheet-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/app/(dashboard)/projects/page.tsx` | Modify | Add viewMode state, estimate data, conditional render |
| `src/app/(dashboard)/projects/_components/project-floating-toolbar.tsx` | Modify | Add view toggle, hide Fit All / Sort in spreadsheet mode |
| `src/app/(dashboard)/projects/_components/project-spreadsheet.tsx` | Create | Main spreadsheet — table container, sort state, selection, keyboard nav |
| `src/app/(dashboard)/projects/_components/spreadsheet/spreadsheet-columns.ts` | Create | Column definitions array |
| `src/app/(dashboard)/projects/_components/spreadsheet/spreadsheet-header.tsx` | Create | Sticky header row, sort indicators, column visibility toggle |
| `src/app/(dashboard)/projects/_components/spreadsheet/spreadsheet-row.tsx` | Create | Row rendering, selection highlight, status border, action menu |
| `src/app/(dashboard)/projects/_components/spreadsheet/spreadsheet-cell-text.tsx` | Create | Inline-editable text cell (title, address) |
| `src/app/(dashboard)/projects/_components/spreadsheet/spreadsheet-cell-status.tsx` | Create | Inline-editable status dropdown cell |
| `src/app/(dashboard)/projects/_components/spreadsheet/spreadsheet-cell-date.tsx` | Create | Inline-editable date cell |
| `src/app/(dashboard)/projects/_components/spreadsheet/spreadsheet-cell-number.tsx` | Create | Inline-editable number cell (duration) |
| `src/app/(dashboard)/projects/_components/spreadsheet/spreadsheet-cell-textarea.tsx` | Create | Inline-editable textarea cell (notes, description) |
| `src/app/(dashboard)/projects/_components/spreadsheet/spreadsheet-bulk-bar.tsx` | Create | Bulk action bar (change status, archive, delete) |
| `src/lib/hooks/use-update-project.ts` | Create | Generic PATCH mutation hook for project fields |
| `src/i18n/dictionaries/en/projects-canvas.json` | Modify | Add spreadsheet strings |
| `src/i18n/dictionaries/es/projects-canvas.json` | Modify | Add Spanish translations |

---

### Task 1: Add `useUpdateProject` mutation hook

**Files:**
- Create: `src/lib/hooks/use-update-project.ts`
- Modify: `src/lib/hooks/index.ts` (add export)

This hook is needed by all inline-editable cells. Build it first so cells can use it.

- [ ] **Step 1: Create the hook**

```typescript
// src/lib/hooks/use-update-project.ts
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/query-client";
import { ProjectService } from "@/lib/api/services/project-service";
import { type Project } from "@/lib/types/models";
import { toast } from "@/components/ui/toast";

type ProjectFieldUpdate = {
  id: string;
} & Partial<Pick<Project, "title" | "address" | "notes" | "projectDescription" | "startDate" | "endDate" | "duration">>;

export function useUpdateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...fields }: ProjectFieldUpdate) =>
      ProjectService.updateProject(id, fields),

    onMutate: async ({ id, ...fields }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({
        queryKey: queryKeys.projects.lists(),
      });

      // Snapshot current list caches
      const previousQueries = queryClient.getQueriesData({
        queryKey: queryKeys.projects.lists(),
      });

      // Optimistically update all list caches
      queryClient.setQueriesData(
        { queryKey: queryKeys.projects.lists() },
        (old: { projects: Project[]; remaining: number; count: number } | undefined) => {
          if (!old) return old;
          return {
            ...old,
            projects: old.projects.map((p) =>
              p.id === id ? { ...p, ...fields } : p
            ),
          };
        }
      );

      return { previousQueries };
    },

    onError: (_err, _vars, context) => {
      // Revert on error
      if (context?.previousQueries) {
        for (const [queryKey, data] of context.previousQueries) {
          queryClient.setQueryData(queryKey, data);
        }
      }
      toast.error("Failed to update project");
    },

    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.all,
      });
    },
  });
}
```

- [ ] **Step 2: Export from hooks index**

In `src/lib/hooks/index.ts`, add:

```typescript
export { useUpdateProject } from "./use-update-project";
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/hooks/use-update-project.ts src/lib/hooks/index.ts
git commit -m "feat(projects): add useUpdateProject mutation hook for inline field editing"
```

---

### Task 2: Column definitions

**Files:**
- Create: `src/app/(dashboard)/projects/_components/spreadsheet/spreadsheet-columns.ts`

Defines the 20-column config array. No UI — pure data.

- [ ] **Step 1: Create the columns file**

```typescript
// src/app/(dashboard)/projects/_components/spreadsheet/spreadsheet-columns.ts

export type SpreadsheetSortDirection = "asc" | "desc" | null;

export interface SpreadsheetColumnDef {
  id: string;
  header: string;           // i18n key suffix (e.g., "status" → t("spreadsheet.columns.status"))
  width: string;             // CSS width
  sortable: boolean;
  editable: false | "text" | "status" | "date" | "number" | "textarea";
  defaultVisible: boolean;
  permission?: string;       // Required permission to show column
  mono?: boolean;            // Use font-mono
}

export const SPREADSHEET_COLUMNS: SpreadsheetColumnDef[] = [
  { id: "actions",       header: "",              width: "40px",    sortable: false, editable: false,      defaultVisible: true },
  { id: "status",        header: "status",        width: "120px",   sortable: true,  editable: "status",   defaultVisible: true },
  { id: "title",         header: "title",         width: "200px",   sortable: true,  editable: "text",     defaultVisible: true },
  { id: "client",        header: "client",        width: "150px",   sortable: true,  editable: false,      defaultVisible: true },
  { id: "address",       header: "address",       width: "180px",   sortable: true,  editable: "text",     defaultVisible: true },
  { id: "startDate",     header: "startDate",     width: "100px",   sortable: true,  editable: "date",     defaultVisible: true },
  { id: "endDate",       header: "endDate",       width: "100px",   sortable: true,  editable: "date",     defaultVisible: true },
  { id: "progress",      header: "progress",      width: "120px",   sortable: true,  editable: false,      defaultVisible: true },
  { id: "estimateTotal", header: "estimateTotal", width: "100px",   sortable: true,  editable: false,      defaultVisible: true,  permission: "accounting.view", mono: true },
  { id: "invoiceTotal",  header: "invoiceTotal",  width: "100px",   sortable: true,  editable: false,      defaultVisible: false, permission: "accounting.view", mono: true },
  { id: "duration",      header: "duration",      width: "80px",    sortable: true,  editable: "number",   defaultVisible: false, mono: true },
  { id: "team",          header: "team",          width: "140px",   sortable: false, editable: false,      defaultVisible: false },
  { id: "clientEmail",   header: "clientEmail",   width: "160px",   sortable: false, editable: false,      defaultVisible: false },
  { id: "clientPhone",   header: "clientPhone",   width: "120px",   sortable: false, editable: false,      defaultVisible: false, mono: true },
  { id: "photos",        header: "photos",        width: "70px",    sortable: true,  editable: false,      defaultVisible: false, mono: true },
  { id: "notes",         header: "notes",         width: "200px",   sortable: false, editable: "textarea", defaultVisible: false },
  { id: "description",   header: "description",   width: "200px",   sortable: false, editable: "textarea", defaultVisible: false },
  { id: "pipeline",      header: "pipeline",      width: "80px",    sortable: false, editable: false,      defaultVisible: false },
  { id: "daysInStatus",  header: "daysInStatus",  width: "90px",    sortable: true,  editable: false,      defaultVisible: false, mono: true },
  { id: "created",       header: "created",       width: "100px",   sortable: true,  editable: false,      defaultVisible: false, mono: true },
];

/** Default column visibility map */
export function getDefaultColumnVisibility(): Record<string, boolean> {
  const vis: Record<string, boolean> = {};
  for (const col of SPREADSHEET_COLUMNS) {
    vis[col.id] = col.defaultVisible;
  }
  return vis;
}

/** Load persisted visibility or fall back to defaults */
export function loadColumnVisibility(): Record<string, boolean> {
  if (typeof window === "undefined") return getDefaultColumnVisibility();
  try {
    const stored = localStorage.getItem("ops_projects_spreadsheet_columns");
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return getDefaultColumnVisibility();
}

/** Persist visibility to localStorage */
export function saveColumnVisibility(vis: Record<string, boolean>): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("ops_projects_spreadsheet_columns", JSON.stringify(vis));
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/projects/_components/spreadsheet/spreadsheet-columns.ts
git commit -m "feat(projects): add spreadsheet column definitions (20 columns)"
```

---

### Task 3: Editable cell components

**Files:**
- Create: `src/app/(dashboard)/projects/_components/spreadsheet/spreadsheet-cell-text.tsx`
- Create: `src/app/(dashboard)/projects/_components/spreadsheet/spreadsheet-cell-status.tsx`
- Create: `src/app/(dashboard)/projects/_components/spreadsheet/spreadsheet-cell-date.tsx`
- Create: `src/app/(dashboard)/projects/_components/spreadsheet/spreadsheet-cell-number.tsx`
- Create: `src/app/(dashboard)/projects/_components/spreadsheet/spreadsheet-cell-textarea.tsx`

All five editable cell types. Each follows the same pattern: display mode → click → edit mode → commit/cancel.

- [ ] **Step 1: Create text cell**

```tsx
// src/app/(dashboard)/projects/_components/spreadsheet/spreadsheet-cell-text.tsx
"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface SpreadsheetCellTextProps {
  value: string;
  canEdit: boolean;
  onCommit: (value: string) => void;
}

export function SpreadsheetCellText({ value, canEdit, onCommit }: SpreadsheetCellTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  // Sync external value changes
  useEffect(() => { setDraft(value); }, [value]);

  const commit = useCallback(() => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== value) {
      onCommit(trimmed);
    }
  }, [draft, value, onCommit]);

  const cancel = useCallback(() => {
    setEditing(false);
    setDraft(value);
  }, [value]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") cancel();
          if (e.key === "Tab") { e.preventDefault(); commit(); }
        }}
        className="w-full px-1 py-0.5 bg-[rgba(255,255,255,0.06)] border border-[rgba(89,119,148,0.3)] rounded-sm font-mohave text-body-sm text-text-primary focus:outline-none"
      />
    );
  }

  return (
    <span
      className={`truncate block ${canEdit ? "cursor-text" : ""}`}
      onClick={canEdit ? (e) => { e.stopPropagation(); setEditing(true); } : undefined}
    >
      {value || "—"}
    </span>
  );
}
```

- [ ] **Step 2: Create status cell**

```tsx
// src/app/(dashboard)/projects/_components/spreadsheet/spreadsheet-cell-status.tsx
"use client";

import { useState, useRef, useEffect } from "react";
import { ProjectStatus, PROJECT_STATUS_COLORS } from "@/lib/types/models";
import { getProjectStatusDisplayName } from "../project-stage-stack";

interface SpreadsheetCellStatusProps {
  status: ProjectStatus;
  canEdit: boolean;
  onCommit: (status: ProjectStatus) => void;
}

const ALL_STATUSES = [
  ProjectStatus.RFQ,
  ProjectStatus.Estimated,
  ProjectStatus.Accepted,
  ProjectStatus.InProgress,
  ProjectStatus.Completed,
  ProjectStatus.Closed,
];

export function SpreadsheetCellStatus({ status, canEdit, onCommit }: SpreadsheetCellStatusProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const color = PROJECT_STATUS_COLORS[status];

  return (
    <div className="relative" ref={menuRef}>
      <span
        className={`flex items-center gap-1.5 ${canEdit ? "cursor-pointer" : ""}`}
        onClick={canEdit ? (e) => { e.stopPropagation(); setOpen(!open); } : undefined}
      >
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: color }}
        />
        <span className="truncate">{getProjectStatusDisplayName(status)}</span>
      </span>

      {open && (
        <div
          className="absolute top-full left-0 mt-1 z-[1000] min-w-[140px] p-1 rounded-[4px]"
          style={{
            background: "rgba(10,10,10,0.95)",
            backdropFilter: "blur(20px) saturate(1.2)",
            border: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          {ALL_STATUSES.map((s) => (
            <button
              key={s}
              onClick={(e) => {
                e.stopPropagation();
                if (s !== status) onCommit(s);
                setOpen(false);
              }}
              className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-[2px] transition-colors ${
                s === status
                  ? "text-ops-accent bg-ops-accent-muted/20"
                  : "text-text-secondary hover:bg-[rgba(255,255,255,0.06)]"
              }`}
            >
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: PROJECT_STATUS_COLORS[s] }}
              />
              <span className="font-mohave text-body-sm">{getProjectStatusDisplayName(s)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create date cell**

```tsx
// src/app/(dashboard)/projects/_components/spreadsheet/spreadsheet-cell-date.tsx
"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface SpreadsheetCellDateProps {
  value: Date | null;
  canEdit: boolean;
  onCommit: (value: Date | null) => void;
}

function formatDisplayDate(date: Date | null): string {
  if (!date) return "—";
  const now = new Date();
  const d = new Date(date);
  const month = d.toLocaleString("en-US", { month: "short" });
  const day = d.getDate();
  if (d.getFullYear() !== now.getFullYear()) {
    return `${month} ${day} '${String(d.getFullYear()).slice(2)}`;
  }
  return `${month} ${day}`;
}

function toInputValue(date: Date | null): string {
  if (!date) return "";
  const d = new Date(date);
  return d.toISOString().split("T")[0];
}

export function SpreadsheetCellDate({ value, canEdit, onCommit }: SpreadsheetCellDateProps) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = useCallback((inputValue: string) => {
    setEditing(false);
    const newDate = inputValue ? new Date(inputValue + "T00:00:00") : null;
    const oldStr = toInputValue(value);
    if (inputValue !== oldStr) {
      onCommit(newDate);
    }
  }, [value, onCommit]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="date"
        defaultValue={toInputValue(value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setEditing(false); }
          if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
        }}
        className="w-full px-1 py-0.5 bg-[rgba(255,255,255,0.06)] border border-[rgba(89,119,148,0.3)] rounded-sm font-mono text-data-sm text-text-primary focus:outline-none [color-scheme:dark]"
      />
    );
  }

  return (
    <span
      className={`font-mono text-data-sm ${canEdit ? "cursor-text" : ""}`}
      onClick={canEdit ? (e) => { e.stopPropagation(); setEditing(true); } : undefined}
    >
      {formatDisplayDate(value)}
    </span>
  );
}
```

- [ ] **Step 4: Create number cell**

```tsx
// src/app/(dashboard)/projects/_components/spreadsheet/spreadsheet-cell-number.tsx
"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface SpreadsheetCellNumberProps {
  value: number | null;
  suffix?: string;        // e.g. "d" for days
  canEdit: boolean;
  onCommit: (value: number | null) => void;
}

export function SpreadsheetCellNumber({ value, suffix = "", canEdit, onCommit }: SpreadsheetCellNumberProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ""));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => { setDraft(String(value ?? "")); }, [value]);

  const commit = useCallback(() => {
    setEditing(false);
    const parsed = draft.trim() === "" ? null : parseInt(draft, 10);
    if (parsed !== value && (!isNaN(parsed as number) || parsed === null)) {
      onCommit(parsed);
    }
  }, [draft, value, onCommit]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        min="0"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { setEditing(false); setDraft(String(value ?? "")); }
        }}
        className="w-full px-1 py-0.5 bg-[rgba(255,255,255,0.06)] border border-[rgba(89,119,148,0.3)] rounded-sm font-mono text-data-sm text-text-primary focus:outline-none"
      />
    );
  }

  return (
    <span
      className={`font-mono text-data-sm ${canEdit ? "cursor-text" : ""}`}
      onClick={canEdit ? (e) => { e.stopPropagation(); setEditing(true); } : undefined}
    >
      {value != null ? `${value}${suffix}` : "—"}
    </span>
  );
}
```

- [ ] **Step 5: Create textarea cell**

```tsx
// src/app/(dashboard)/projects/_components/spreadsheet/spreadsheet-cell-textarea.tsx
"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface SpreadsheetCellTextareaProps {
  value: string | null;
  canEdit: boolean;
  onCommit: (value: string | null) => void;
}

export function SpreadsheetCellTextarea({ value, canEdit, onCommit }: SpreadsheetCellTextareaProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  useEffect(() => { setDraft(value ?? ""); }, [value]);

  const commit = useCallback(() => {
    setEditing(false);
    const trimmed = draft.trim();
    const newVal = trimmed || null;
    if (newVal !== (value ?? null)) {
      onCommit(newVal);
    }
  }, [draft, value, onCommit]);

  if (editing) {
    return (
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setEditing(false); setDraft(value ?? ""); }
        }}
        rows={3}
        className="w-full px-1 py-0.5 bg-[rgba(255,255,255,0.06)] border border-[rgba(89,119,148,0.3)] rounded-sm font-mohave text-body-sm text-text-primary focus:outline-none resize-none"
      />
    );
  }

  return (
    <span
      className={`truncate block ${canEdit ? "cursor-text" : ""}`}
      onClick={canEdit ? (e) => { e.stopPropagation(); setEditing(true); } : undefined}
    >
      {value || "—"}
    </span>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add src/app/\(dashboard\)/projects/_components/spreadsheet/spreadsheet-cell-text.tsx \
  src/app/\(dashboard\)/projects/_components/spreadsheet/spreadsheet-cell-status.tsx \
  src/app/\(dashboard\)/projects/_components/spreadsheet/spreadsheet-cell-date.tsx \
  src/app/\(dashboard\)/projects/_components/spreadsheet/spreadsheet-cell-number.tsx \
  src/app/\(dashboard\)/projects/_components/spreadsheet/spreadsheet-cell-textarea.tsx
git commit -m "feat(projects): add 5 inline-editable cell components for spreadsheet"
```

---

### Task 4: Spreadsheet header row

**Files:**
- Create: `src/app/(dashboard)/projects/_components/spreadsheet/spreadsheet-header.tsx`

Sticky header with sortable columns and column visibility toggle.

- [ ] **Step 1: Create header component**

```tsx
// src/app/(dashboard)/projects/_components/spreadsheet/spreadsheet-header.tsx
"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Columns3 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SPREADSHEET_COLUMNS,
  type SpreadsheetSortDirection,
} from "./spreadsheet-columns";

interface SpreadsheetHeaderProps {
  columnVisibility: Record<string, boolean>;
  onColumnVisibilityChange: (vis: Record<string, boolean>) => void;
  sortColumn: string | null;
  sortDirection: SpreadsheetSortDirection;
  onSort: (columnId: string) => void;
  canViewAccounting: boolean;
}

export function SpreadsheetHeader({
  columnVisibility,
  onColumnVisibilityChange,
  sortColumn,
  sortDirection,
  onSort,
  canViewAccounting,
}: SpreadsheetHeaderProps) {
  const { t } = useDictionary("projects-canvas");

  const visibleColumns = SPREADSHEET_COLUMNS.filter((col) => {
    if (col.permission && !canViewAccounting) return false;
    return columnVisibility[col.id] !== false;
  });

  // Columns eligible for the visibility toggle (exclude actions)
  const toggleableColumns = SPREADSHEET_COLUMNS.filter((col) => {
    if (col.id === "actions") return false;
    if (col.permission && !canViewAccounting) return false;
    return true;
  });

  return (
    <thead>
      <tr className="border-b border-border-medium bg-background-panel sticky top-0 z-10">
        {visibleColumns.map((col) => {
          if (col.id === "actions") {
            return (
              <th key={col.id} className="w-[40px] px-1 py-1.5">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" aria-label="Toggle columns">
                      <Columns3 className="h-[13px] w-[13px] text-text-tertiary" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {toggleableColumns.map((tc) => (
                      <DropdownMenuCheckboxItem
                        key={tc.id}
                        checked={columnVisibility[tc.id] !== false}
                        onCheckedChange={(checked) => {
                          onColumnVisibilityChange({
                            ...columnVisibility,
                            [tc.id]: !!checked,
                          });
                        }}
                      >
                        {t(`spreadsheet.columns.${tc.header}`)}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </th>
            );
          }

          const isSorted = sortColumn === col.id;

          return (
            <th
              key={col.id}
              className={cn(
                "px-1.5 py-1.5 text-left whitespace-nowrap",
                "font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest",
                col.sortable && "cursor-pointer select-none hover:text-text-secondary transition-colors"
              )}
              style={{ width: col.width, minWidth: col.id === "title" ? col.width : undefined }}
              onClick={col.sortable ? () => onSort(col.id) : undefined}
            >
              <span className="inline-flex items-center gap-0.5">
                {t(`spreadsheet.columns.${col.header}`)}
                {col.sortable && (
                  <span className="text-text-disabled">
                    {isSorted && sortDirection === "asc" ? (
                      <ArrowUp className="h-[13px] w-[13px] text-ops-accent" />
                    ) : isSorted && sortDirection === "desc" ? (
                      <ArrowDown className="h-[13px] w-[13px] text-ops-accent" />
                    ) : (
                      <ArrowUpDown className="h-[13px] w-[13px]" />
                    )}
                  </span>
                )}
              </span>
            </th>
          );
        })}
      </tr>
    </thead>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/projects/_components/spreadsheet/spreadsheet-header.tsx
git commit -m "feat(projects): add spreadsheet header with sort indicators and column toggle"
```

---

### Task 5: Spreadsheet row

**Files:**
- Create: `src/app/(dashboard)/projects/_components/spreadsheet/spreadsheet-row.tsx`

Renders a single project row with all cell types, selection state, action menu, and status border.

- [ ] **Step 1: Create row component**

```tsx
// src/app/(dashboard)/projects/_components/spreadsheet/spreadsheet-row.tsx
"use client";

import { memo, useCallback } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  type Project,
  ProjectStatus,
  PROJECT_STATUS_COLORS,
} from "@/lib/types/models";
import { getProjectStatusDisplayName } from "../project-stage-stack";
import {
  SPREADSHEET_COLUMNS,
} from "./spreadsheet-columns";
import { SpreadsheetCellText } from "./spreadsheet-cell-text";
import { SpreadsheetCellStatus } from "./spreadsheet-cell-status";
import { SpreadsheetCellDate } from "./spreadsheet-cell-date";
import { SpreadsheetCellNumber } from "./spreadsheet-cell-number";
import { SpreadsheetCellTextarea } from "./spreadsheet-cell-textarea";

interface SpreadsheetRowProps {
  project: Project;
  isSelected: boolean;
  isArchived: boolean;
  canEdit: boolean;
  canViewAccounting: boolean;
  columnVisibility: Record<string, boolean>;
  // Lookup data
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  estimateTotal: number;
  invoiceTotal: number;
  completedTasks: number;
  totalTasks: number;
  teamMembers: { id: string; name: string; avatarUrl?: string }[];
  photoCount: number;
  daysInStatus: number;
  // Callbacks
  onSelect: (projectId: string, e: React.MouseEvent) => void;
  onUpdateField: (projectId: string, field: string, value: unknown) => void;
  onUpdateStatus: (projectId: string, status: ProjectStatus) => void;
  onOpenActionMenu: (projectId: string, e: React.MouseEvent) => void;
}

export const SpreadsheetRow = memo(function SpreadsheetRow({
  project,
  isSelected,
  isArchived,
  canEdit,
  canViewAccounting,
  columnVisibility,
  clientName,
  clientEmail,
  clientPhone,
  estimateTotal,
  invoiceTotal,
  completedTasks,
  totalTasks,
  teamMembers,
  photoCount,
  daysInStatus,
  onSelect,
  onUpdateField,
  onUpdateStatus,
  onOpenActionMenu,
}: SpreadsheetRowProps) {
  const statusColor = PROJECT_STATUS_COLORS[project.status];
  const editable = canEdit && !isArchived;

  const visibleColumns = SPREADSHEET_COLUMNS.filter((col) => {
    if (col.permission && !canViewAccounting) return false;
    return columnVisibility[col.id] !== false;
  });

  const handleRowClick = useCallback((e: React.MouseEvent) => {
    // Don't select if clicking inside an editable cell or button
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, button, [data-no-select]")) return;
    onSelect(project.id, e);
  }, [project.id, onSelect]);

  const formatCurrency = (val: number): string => {
    if (!val) return "—";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val);
  };

  const formatStreetAddress = (address: string | null): string => {
    if (!address) return "—";
    return address.split(",")[0].trim() || "—";
  };

  const renderCell = (colId: string) => {
    switch (colId) {
      case "actions":
        return (
          <button
            data-no-select
            onClick={(e) => { e.stopPropagation(); onOpenActionMenu(project.id, e); }}
            className="flex items-center justify-center w-6 h-6 rounded-sm text-text-tertiary hover:text-text-primary hover:bg-[rgba(255,255,255,0.06)] transition-colors"
          >
            <MoreHorizontal className="w-[14px] h-[14px]" />
          </button>
        );

      case "status":
        return (
          <SpreadsheetCellStatus
            status={project.status}
            canEdit={editable}
            onCommit={(status) => onUpdateStatus(project.id, status)}
          />
        );

      case "title":
        return (
          <SpreadsheetCellText
            value={project.title}
            canEdit={editable}
            onCommit={(val) => onUpdateField(project.id, "title", val)}
          />
        );

      case "client":
        return <span className="truncate">{clientName || "—"}</span>;

      case "address":
        return (
          <SpreadsheetCellText
            value={formatStreetAddress(project.address)}
            canEdit={editable}
            onCommit={(val) => onUpdateField(project.id, "address", val)}
          />
        );

      case "startDate":
        return (
          <SpreadsheetCellDate
            value={project.startDate}
            canEdit={editable}
            onCommit={(val) => onUpdateField(project.id, "startDate", val)}
          />
        );

      case "endDate":
        return (
          <SpreadsheetCellDate
            value={project.endDate}
            canEdit={editable}
            onCommit={(val) => onUpdateField(project.id, "endDate", val)}
          />
        );

      case "progress": {
        if (totalTasks === 0) return <span className="font-mono text-data-sm text-text-tertiary">—</span>;
        const pct = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;
        return (
          <div className="flex items-center gap-1.5">
            <div className="flex-1 h-[2px] bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, backgroundColor: statusColor }}
              />
            </div>
            <span className="font-mono text-data-sm text-text-secondary whitespace-nowrap">
              {completedTasks}/{totalTasks}
            </span>
          </div>
        );
      }

      case "estimateTotal":
        return <span className="font-mono text-data-sm">{formatCurrency(estimateTotal)}</span>;

      case "invoiceTotal":
        return <span className="font-mono text-data-sm">{formatCurrency(invoiceTotal)}</span>;

      case "duration":
        return (
          <SpreadsheetCellNumber
            value={project.duration}
            suffix="d"
            canEdit={editable}
            onCommit={(val) => onUpdateField(project.id, "duration", val)}
          />
        );

      case "team": {
        if (teamMembers.length === 0) return <span className="text-text-tertiary">—</span>;
        const visible = teamMembers.slice(0, 3);
        const overflow = teamMembers.length - 3;
        return (
          <div className="flex items-center -space-x-1.5">
            {visible.map((m) => (
              <div
                key={m.id}
                className="w-6 h-6 rounded-full bg-background-elevated border border-border-subtle flex items-center justify-center overflow-hidden"
                title={m.name}
              >
                {m.avatarUrl ? (
                  <img src={m.avatarUrl} alt={m.name} className="w-full h-full object-cover" />
                ) : (
                  <span className="font-kosugi text-[9px] text-text-tertiary uppercase">
                    {m.name.charAt(0)}
                  </span>
                )}
              </div>
            ))}
            {overflow > 0 && (
              <span className="ml-1 font-mono text-data-sm text-text-tertiary">+{overflow}</span>
            )}
          </div>
        );
      }

      case "clientEmail":
        return <span className="truncate text-text-secondary">{clientEmail || "—"}</span>;

      case "clientPhone":
        return <span className="font-mono text-data-sm text-text-secondary">{clientPhone || "—"}</span>;

      case "photos":
        return <span className="font-mono text-data-sm">{photoCount || "—"}</span>;

      case "notes":
        return (
          <SpreadsheetCellTextarea
            value={project.notes}
            canEdit={editable}
            onCommit={(val) => onUpdateField(project.id, "notes", val)}
          />
        );

      case "description":
        return (
          <SpreadsheetCellTextarea
            value={project.projectDescription}
            canEdit={editable}
            onCommit={(val) => onUpdateField(project.id, "projectDescription", val)}
          />
        );

      case "pipeline":
        return project.opportunityId ? (
          <span className="inline-flex px-1.5 py-0.5 rounded-sm bg-[rgba(255,255,255,0.06)] border border-border-subtle font-kosugi text-[9px] text-text-tertiary uppercase tracking-wider">
            Linked
          </span>
        ) : (
          <span className="text-text-tertiary">—</span>
        );

      case "daysInStatus":
        return (
          <span className={cn(
            "font-mono text-data-sm",
            daysInStatus > 60 && "text-[#93321A]",
            daysInStatus > 30 && daysInStatus <= 60 && "text-[#C4A868]",
          )}>
            {daysInStatus}d
          </span>
        );

      case "created": {
        if (!project.createdAt) return <span className="font-mono text-data-sm text-text-tertiary">—</span>;
        const d = new Date(project.createdAt);
        const now = new Date();
        const month = d.toLocaleString("en-US", { month: "short" });
        const day = d.getDate();
        const display = d.getFullYear() !== now.getFullYear()
          ? `${month} ${day} '${String(d.getFullYear()).slice(2)}`
          : `${month} ${day}`;
        return <span className="font-mono text-data-sm">{display}</span>;
      }

      default:
        return null;
    }
  };

  return (
    <tr
      className={cn(
        "border-b border-border-subtle transition-colors duration-100",
        "hover:bg-background-elevated/50",
        isSelected && "bg-ops-accent-muted",
        isArchived && "opacity-50",
      )}
      style={{ borderLeft: `3px solid ${statusColor}` }}
      onClick={handleRowClick}
      onContextMenu={(e) => {
        e.preventDefault();
        onOpenActionMenu(project.id, e);
      }}
    >
      {visibleColumns.map((col) => (
        <td
          key={col.id}
          className={cn(
            "px-1.5 py-1.5",
            col.id === "actions" && "w-[40px] px-1",
            col.mono && "font-mono text-data-sm",
            !col.mono && col.id !== "actions" && "font-mohave text-body-sm text-text-primary",
          )}
        >
          {renderCell(col.id)}
        </td>
      ))}
    </tr>
  );
});
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/projects/_components/spreadsheet/spreadsheet-row.tsx
git commit -m "feat(projects): add spreadsheet row with all 20 cell renderers"
```

---

### Task 6: Bulk action bar

**Files:**
- Create: `src/app/(dashboard)/projects/_components/spreadsheet/spreadsheet-bulk-bar.tsx`

- [ ] **Step 1: Create bulk bar component**

```tsx
// src/app/(dashboard)/projects/_components/spreadsheet/spreadsheet-bulk-bar.tsx
"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { ProjectStatus, PROJECT_STATUS_COLORS } from "@/lib/types/models";
import { getProjectStatusDisplayName } from "../project-stage-stack";

interface SpreadsheetBulkBarProps {
  selectedCount: number;
  canManage: boolean;
  canDelete: boolean;
  onChangeStatus: (status: ProjectStatus) => void;
  onArchive: () => void;
  onDelete: () => void;
  onClear: () => void;
}

const BULK_STATUSES = [
  ProjectStatus.RFQ,
  ProjectStatus.Estimated,
  ProjectStatus.Accepted,
  ProjectStatus.InProgress,
  ProjectStatus.Completed,
  ProjectStatus.Closed,
];

export function SpreadsheetBulkBar({
  selectedCount,
  canManage,
  canDelete,
  onChangeStatus,
  onArchive,
  onDelete,
  onClear,
}: SpreadsheetBulkBarProps) {
  const { t } = useDictionary("projects-canvas");
  const [showStatusMenu, setShowStatusMenu] = useState(false);

  if (selectedCount === 0) return null;

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-[4px] border border-border-subtle"
      style={{
        background: "rgba(10, 10, 10, 0.70)",
        backdropFilter: "blur(20px) saturate(1.2)",
      }}
    >
      <span className="font-mono text-data-sm text-ops-accent">
        {t("spreadsheet.bulk.selected").replace("{count}", String(selectedCount))}
      </span>

      {canManage && (
        <>
          {/* Change Status */}
          <div className="relative">
            <button
              onClick={() => setShowStatusMenu(!showStatusMenu)}
              className="px-2 py-1 rounded-sm font-kosugi text-micro-sm uppercase tracking-wider text-text-secondary hover:text-text-primary hover:bg-[rgba(255,255,255,0.06)] transition-colors"
            >
              {t("spreadsheet.bulk.changeStatus")}
            </button>
            {showStatusMenu && (
              <div
                className="absolute top-full left-0 mt-1 z-[1000] min-w-[140px] p-1 rounded-[4px]"
                style={{
                  background: "rgba(10,10,10,0.95)",
                  backdropFilter: "blur(20px) saturate(1.2)",
                  border: "1px solid rgba(255,255,255,0.10)",
                }}
              >
                {BULK_STATUSES.map((s) => (
                  <button
                    key={s}
                    onClick={() => { onChangeStatus(s); setShowStatusMenu(false); }}
                    className="flex items-center gap-2 w-full px-2 py-1.5 rounded-[2px] text-text-secondary hover:bg-[rgba(255,255,255,0.06)] transition-colors"
                  >
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PROJECT_STATUS_COLORS[s] }} />
                    <span className="font-mohave text-body-sm">{getProjectStatusDisplayName(s)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Archive */}
          <button
            onClick={onArchive}
            className="px-2 py-1 rounded-sm font-kosugi text-micro-sm uppercase tracking-wider text-text-secondary hover:text-text-primary hover:bg-[rgba(255,255,255,0.06)] transition-colors"
          >
            {t("spreadsheet.bulk.archive")}
          </button>
        </>
      )}

      {canDelete && (
        <button
          onClick={onDelete}
          className="px-2 py-1 rounded-sm font-kosugi text-micro-sm uppercase tracking-wider text-[#93321A] hover:text-[#b5423a] hover:bg-[rgba(147,50,26,0.1)] transition-colors"
        >
          {t("spreadsheet.bulk.delete")}
        </button>
      )}

      {/* Clear selection */}
      <button
        onClick={onClear}
        className="ml-auto flex items-center gap-1 px-2 py-1 rounded-sm text-text-tertiary hover:text-text-primary transition-colors"
      >
        <X className="w-3 h-3" />
        <span className="font-kosugi text-micro-sm uppercase tracking-wider">{t("spreadsheet.bulk.clear")}</span>
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/projects/_components/spreadsheet/spreadsheet-bulk-bar.tsx
git commit -m "feat(projects): add spreadsheet bulk action bar"
```

---

### Task 7: Main `ProjectSpreadsheet` component

**Files:**
- Create: `src/app/(dashboard)/projects/_components/project-spreadsheet.tsx`

Orchestrates header, rows, bulk bar, sorting, selection, keyboard nav, action menu, and empty states.

- [ ] **Step 1: Create the main component**

```tsx
// src/app/(dashboard)/projects/_components/project-spreadsheet.tsx
"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import {
  type Project,
  ProjectStatus,
  PROJECT_STATUS_COLORS,
  PROJECT_STATUS_SORT_ORDER,
} from "@/lib/types/models";
import { useUpdateProject } from "@/lib/hooks/use-update-project";
import { useUpdateProjectStatus, useDeleteProject } from "@/lib/hooks/use-projects";
import { useProjectDetailPopoverStore } from "./project-detail-popover-store";
import { toast } from "@/components/ui/toast";
import {
  type SpreadsheetSortDirection,
  loadColumnVisibility,
  saveColumnVisibility,
} from "./spreadsheet/spreadsheet-columns";
import { SpreadsheetHeader } from "./spreadsheet/spreadsheet-header";
import { SpreadsheetRow } from "./spreadsheet/spreadsheet-row";
import { SpreadsheetBulkBar } from "./spreadsheet/spreadsheet-bulk-bar";

interface ProjectSpreadsheetProps {
  projects: Project[];
  archivedProjects: Project[];
  showArchived: boolean;
  clientNameMap: Map<string, string>;
  clientEmailMap: Map<string, string>;
  clientPhoneMap: Map<string, string>;
  teamMemberMap: Map<string, { id: string; name: string; avatarUrl?: string }>;
  projectValueMap: Map<string, number>;         // invoice totals
  estimateTotalMap: Map<string, number>;         // estimate totals
  projectTaskCountMap: { total: Map<string, number>; completed: Map<string, number> };
  canManage: boolean;
  canViewAccounting: boolean;
  canCreateTasks: boolean;
  canRecordPayment: boolean;
  canDelete: boolean;
}

export function ProjectSpreadsheet({
  projects,
  archivedProjects,
  showArchived,
  clientNameMap,
  clientEmailMap,
  clientPhoneMap,
  teamMemberMap,
  projectValueMap,
  estimateTotalMap,
  projectTaskCountMap,
  canManage,
  canViewAccounting,
  canCreateTasks,
  canRecordPayment,
  canDelete,
}: ProjectSpreadsheetProps) {
  const { t } = useDictionary("projects-canvas");
  const updateProjectMutation = useUpdateProject();
  const updateStatusMutation = useUpdateProjectStatus();
  const deleteProjectMutation = useDeleteProject();
  const openPopover = useProjectDetailPopoverStore((s) => s.openPopover);

  // ── Sort state ──
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SpreadsheetSortDirection>(null);

  // ── Selection state ──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastSelectedRef = useRef<string | null>(null);

  // ── Column visibility ──
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(loadColumnVisibility);

  const handleColumnVisibilityChange = useCallback((vis: Record<string, boolean>) => {
    setColumnVisibility(vis);
    saveColumnVisibility(vis);
  }, []);

  // ── Action menu state ──
  const [actionMenu, setActionMenu] = useState<{ projectId: string; x: number; y: number } | null>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);

  // Close action menu on outside click
  useEffect(() => {
    if (!actionMenu) return;
    function handleClick(e: MouseEvent) {
      if (actionMenuRef.current && !actionMenuRef.current.contains(e.target as Node)) {
        setActionMenu(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [actionMenu]);

  // ── Sort handler ──
  const handleSort = useCallback((columnId: string) => {
    if (sortColumn !== columnId) {
      setSortColumn(columnId);
      setSortDirection("asc");
    } else if (sortDirection === "asc") {
      setSortDirection("desc");
    } else {
      setSortColumn(null);
      setSortDirection(null);
    }
  }, [sortColumn, sortDirection]);

  // ── Sorted projects ──
  const displayProjects = useMemo(() => {
    const combined = showArchived ? [...projects, ...archivedProjects] : projects;

    if (!sortColumn || !sortDirection) return combined;

    const dir = sortDirection === "asc" ? 1 : -1;

    return [...combined].sort((a, b) => {
      switch (sortColumn) {
        case "title":
          return dir * (a.title ?? "").localeCompare(b.title ?? "");
        case "client": {
          const ca = clientNameMap.get(a.clientId ?? "") ?? "";
          const cb = clientNameMap.get(b.clientId ?? "") ?? "";
          return dir * ca.localeCompare(cb);
        }
        case "address":
          return dir * (a.address ?? "").localeCompare(b.address ?? "");
        case "startDate": {
          const da = a.startDate ? new Date(a.startDate).getTime() : (dir > 0 ? Infinity : -Infinity);
          const db = b.startDate ? new Date(b.startDate).getTime() : (dir > 0 ? Infinity : -Infinity);
          return dir * (da - db);
        }
        case "endDate": {
          const da = a.endDate ? new Date(a.endDate).getTime() : (dir > 0 ? Infinity : -Infinity);
          const db = b.endDate ? new Date(b.endDate).getTime() : (dir > 0 ? Infinity : -Infinity);
          return dir * (da - db);
        }
        case "status":
          return dir * ((PROJECT_STATUS_SORT_ORDER[a.status] ?? 0) - (PROJECT_STATUS_SORT_ORDER[b.status] ?? 0));
        case "progress": {
          const pa = (projectTaskCountMap.total.get(a.id) ?? 0) > 0
            ? (projectTaskCountMap.completed.get(a.id) ?? 0) / (projectTaskCountMap.total.get(a.id) ?? 1)
            : 0;
          const pb = (projectTaskCountMap.total.get(b.id) ?? 0) > 0
            ? (projectTaskCountMap.completed.get(b.id) ?? 0) / (projectTaskCountMap.total.get(b.id) ?? 1)
            : 0;
          return dir * (pa - pb);
        }
        case "estimateTotal":
          return dir * ((estimateTotalMap.get(a.id) ?? 0) - (estimateTotalMap.get(b.id) ?? 0));
        case "invoiceTotal":
          return dir * ((projectValueMap.get(a.id) ?? 0) - (projectValueMap.get(b.id) ?? 0));
        case "duration":
          return dir * ((a.duration ?? 0) - (b.duration ?? 0));
        case "photos":
          return dir * ((a.projectImages?.length ?? 0) - (b.projectImages?.length ?? 0));
        case "daysInStatus": {
          const daysA = a.createdAt ? Math.floor((Date.now() - new Date(a.createdAt).getTime()) / 86400000) : 0;
          const daysB = b.createdAt ? Math.floor((Date.now() - new Date(b.createdAt).getTime()) / 86400000) : 0;
          return dir * (daysA - daysB);
        }
        case "created": {
          const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return dir * (ca - cb);
        }
        default:
          return 0;
      }
    });
  }, [projects, archivedProjects, showArchived, sortColumn, sortDirection, clientNameMap, projectValueMap, estimateTotalMap, projectTaskCountMap]);

  // ── Selection handlers ──
  const handleSelect = useCallback((projectId: string, e: React.MouseEvent) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);

      if (e.shiftKey && lastSelectedRef.current) {
        // Range select
        const allIds = displayProjects.map((p) => p.id);
        const startIdx = allIds.indexOf(lastSelectedRef.current);
        const endIdx = allIds.indexOf(projectId);
        if (startIdx !== -1 && endIdx !== -1) {
          const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
          for (let i = from; i <= to; i++) {
            next.add(allIds[i]);
          }
        }
      } else if (e.metaKey || e.ctrlKey) {
        // Toggle individual
        if (next.has(projectId)) next.delete(projectId);
        else next.add(projectId);
      } else {
        // Single select
        if (next.size === 1 && next.has(projectId)) {
          next.clear();
        } else {
          next.clear();
          next.add(projectId);
        }
      }

      lastSelectedRef.current = projectId;
      return next;
    });
  }, [displayProjects]);

  // ── Field update ──
  const handleUpdateField = useCallback((projectId: string, field: string, value: unknown) => {
    updateProjectMutation.mutate({ id: projectId, [field]: value });
  }, [updateProjectMutation]);

  // ── Status update ──
  const handleUpdateStatus = useCallback((projectId: string, status: ProjectStatus) => {
    updateStatusMutation.mutate({ id: projectId, status }, {
      onSuccess: () => toast.success(t("status.updated")),
      onError: () => toast.error(t("status.failed")),
    });
  }, [updateStatusMutation, t]);

  // ── Bulk actions ──
  const handleBulkChangeStatus = useCallback((status: ProjectStatus) => {
    for (const id of selectedIds) {
      updateStatusMutation.mutate({ id, status });
    }
    setSelectedIds(new Set());
  }, [selectedIds, updateStatusMutation]);

  const handleBulkArchive = useCallback(() => {
    for (const id of selectedIds) {
      updateStatusMutation.mutate({ id, status: ProjectStatus.Archived });
    }
    setSelectedIds(new Set());
  }, [selectedIds, updateStatusMutation]);

  const handleBulkDelete = useCallback(() => {
    for (const id of selectedIds) {
      deleteProjectMutation.mutate(id);
    }
    setSelectedIds(new Set());
  }, [selectedIds, deleteProjectMutation]);

  // ── Action menu handlers ──
  const handleOpenActionMenu = useCallback((projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setActionMenu({ projectId, x: e.clientX, y: e.clientY });
  }, []);

  const handleOpenDetail = useCallback((projectId: string) => {
    const project = displayProjects.find((p) => p.id === projectId);
    if (!project) return;
    const label = project.title || project.address?.split(",")[0] || "Untitled Project";
    const color = PROJECT_STATUS_COLORS[project.status];
    openPopover(projectId, { x: window.innerWidth * 0.6, y: 200 }, label, color);
    setActionMenu(null);
  }, [displayProjects, openPopover]);

  // ── Keyboard ──
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSelectedIds(new Set());
        setActionMenu(null);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // ── Total counts for footer ──
  const totalCount = projects.length + archivedProjects.length;

  // ── Empty state ──
  if (displayProjects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16">
        <span className="font-mohave text-body-sm text-text-tertiary">
          {totalCount > 0 ? t("spreadsheet.empty.filtered") : t("spreadsheet.empty.none")}
        </span>
        {totalCount === 0 && (
          <span className="font-mohave text-body-sm text-text-disabled">
            {t("spreadsheet.empty.noneDesc")}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 h-full">
      {/* Bulk action bar */}
      <SpreadsheetBulkBar
        selectedCount={selectedIds.size}
        canManage={canManage}
        canDelete={canDelete}
        onChangeStatus={handleBulkChangeStatus}
        onArchive={handleBulkArchive}
        onDelete={handleBulkDelete}
        onClear={() => setSelectedIds(new Set())}
      />

      {/* Table */}
      <div className="flex-1 overflow-auto rounded border border-border">
        <table className="w-full border-collapse">
          <SpreadsheetHeader
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={handleColumnVisibilityChange}
            sortColumn={sortColumn}
            sortDirection={sortDirection}
            onSort={handleSort}
            canViewAccounting={canViewAccounting}
          />
          <tbody>
            {displayProjects.map((project) => {
              const members = (project.teamMemberIds ?? [])
                .map((id) => teamMemberMap.get(id))
                .filter(Boolean) as { id: string; name: string; avatarUrl?: string }[];

              const daysInStatus = project.createdAt
                ? Math.floor((Date.now() - new Date(project.createdAt).getTime()) / 86400000)
                : 0;

              return (
                <SpreadsheetRow
                  key={project.id}
                  project={project}
                  isSelected={selectedIds.has(project.id)}
                  isArchived={project.status === ProjectStatus.Archived}
                  canEdit={canManage}
                  canViewAccounting={canViewAccounting}
                  columnVisibility={columnVisibility}
                  clientName={clientNameMap.get(project.clientId ?? "") ?? ""}
                  clientEmail={clientEmailMap.get(project.clientId ?? "") ?? ""}
                  clientPhone={clientPhoneMap.get(project.clientId ?? "") ?? ""}
                  estimateTotal={estimateTotalMap.get(project.id) ?? 0}
                  invoiceTotal={projectValueMap.get(project.id) ?? 0}
                  completedTasks={projectTaskCountMap.completed.get(project.id) ?? 0}
                  totalTasks={projectTaskCountMap.total.get(project.id) ?? 0}
                  teamMembers={members}
                  photoCount={project.projectImages?.length ?? 0}
                  daysInStatus={daysInStatus}
                  onSelect={handleSelect}
                  onUpdateField={handleUpdateField}
                  onUpdateStatus={handleUpdateStatus}
                  onOpenActionMenu={handleOpenActionMenu}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="px-2 py-1">
        <span className="font-kosugi text-micro-sm text-text-disabled uppercase tracking-wider">
          {t("spreadsheet.footer.showing")
            .replace("{count}", String(displayProjects.length))
            .replace("{total}", String(totalCount))}
          {displayProjects.length < totalCount && ` ${t("spreadsheet.footer.filtered")}`}
        </span>
      </div>

      {/* Action menu */}
      {actionMenu && (
        <div
          ref={actionMenuRef}
          className="fixed z-[1000] min-w-[180px] p-1 rounded-[4px]"
          style={{
            left: actionMenu.x,
            top: actionMenu.y,
            background: "rgba(10,10,10,0.95)",
            backdropFilter: "blur(20px) saturate(1.2)",
            border: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          <ActionMenuItem label={t("actions.openDetail")} onClick={() => handleOpenDetail(actionMenu.projectId)} />
          <ActionMenuItem label="View Full Page" onClick={() => { window.location.href = `/projects/${actionMenu.projectId}`; setActionMenu(null); }} />
          {canManage && (
            <>
              <div className="h-px bg-border-subtle my-0.5" />
              <ActionMenuItem label={t("actions.archive")} onClick={() => { handleUpdateStatus(actionMenu.projectId, ProjectStatus.Archived); setActionMenu(null); }} />
            </>
          )}
          {canDelete && (
            <ActionMenuItem
              label={t("actions.delete")}
              danger
              onClick={() => { deleteProjectMutation.mutate(actionMenu.projectId); setActionMenu(null); }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ActionMenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center w-full px-2 py-1.5 rounded-[2px] transition-colors font-mohave text-body-sm",
        danger
          ? "text-[#93321A] hover:bg-[rgba(147,50,26,0.1)]"
          : "text-text-secondary hover:bg-[rgba(255,255,255,0.06)]"
      )}
    >
      {label}
    </button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/projects/_components/project-spreadsheet.tsx
git commit -m "feat(projects): add main ProjectSpreadsheet component with sort, selection, bulk actions"
```

---

### Task 8: Modify toolbar — add view toggle and mode-aware visibility

**Files:**
- Modify: `src/app/(dashboard)/projects/_components/project-floating-toolbar.tsx`

- [ ] **Step 1: Update the toolbar props and add view toggle**

Add to `ProjectFloatingToolbarProps`:
```typescript
viewMode: "canvas" | "spreadsheet";
onViewModeChange: (mode: "canvas" | "spreadsheet") => void;
```

Add two new imports at the top:
```typescript
import { LayoutGrid, Table2 } from "lucide-react";
```

- [ ] **Step 2: Apply mode-aware visibility**

Inside the component body, conditionally render:
- **"Fit All" button:** Only when `viewMode === "canvas"`
- **Sort section:** Only when `viewMode === "canvas"`
- **"Archived" button:** Always visible, but behavior depends on mode. Add a new prop `onArchivedToggle: () => void` to the toolbar. In canvas mode, the existing `toggleArchiveTray` from the canvas store is passed. In spreadsheet mode, `page.tsx` passes `() => setShowArchived(!showArchived)`. The toolbar calls `onArchivedToggle` instead of `toggleArchiveTray` directly. The `isActive` state for the button comes from a new prop `isArchivedActive: boolean` (canvas: `isArchiveTrayOpen`, spreadsheet: `showArchived`).

- [ ] **Step 3: Add view toggle at the end of the toolbar**

After the "Archived" section, add a divider and two toggle buttons:

```tsx
<div className="w-[1px] h-[18px] bg-border-subtle" />

{/* View toggle */}
<ToolbarAction onClick={() => onViewModeChange("canvas")} isActive={viewMode === "canvas"}>
  <LayoutGrid className="w-[13px] h-[13px]" />
</ToolbarAction>
<ToolbarAction onClick={() => onViewModeChange("spreadsheet")} isActive={viewMode === "spreadsheet"}>
  <Table2 className="w-[13px] h-[13px]" />
</ToolbarAction>
```

- [ ] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/projects/_components/project-floating-toolbar.tsx
git commit -m "feat(projects): add view toggle and mode-aware toolbar controls"
```

---

### Task 9: Modify `page.tsx` — wire everything together

**Files:**
- Modify: `src/app/(dashboard)/projects/page.tsx`

This is the integration task. Add viewMode state, estimate data, client contact maps, and conditional rendering.

- [ ] **Step 1: Add imports**

Add at the top of `page.tsx`:
```typescript
import { useEstimates } from "@/lib/hooks/use-estimates";
import { ProjectSpreadsheet } from "./_components/project-spreadsheet";
```

- [ ] **Step 2: Add viewMode state**

After the existing `useState` declarations (around line 213), add:
```typescript
const [viewMode, setViewMode] = useState<"canvas" | "spreadsheet">(() => {
  if (typeof window === "undefined") return "canvas";
  return (localStorage.getItem("ops_projects_view_mode") as "canvas" | "spreadsheet") ?? "canvas";
});

// Persist viewMode
useEffect(() => {
  localStorage.setItem("ops_projects_view_mode", viewMode);
}, [viewMode]);
```

- [ ] **Step 3: Add estimate data fetching**

After the existing data hooks (around line 193), add:
```typescript
const { data: estimatesData } = useEstimates();
```

- [ ] **Step 4: Add estimate total map**

After the existing `projectValueMap` memo (around line 283), add:
```typescript
const estimateTotalMap = useMemo(() => {
  const map = new Map<string, number>();
  if (estimatesData) {
    for (const estimate of estimatesData) {
      if (estimate.projectId) {
        map.set(estimate.projectId, (map.get(estimate.projectId) ?? 0) + (estimate.total ?? 0));
      }
    }
  }
  return map;
}, [estimatesData]);
```

- [ ] **Step 5: Add client email and phone maps**

After the `clientNameMap` memo, add:
```typescript
const clientEmailMap = useMemo(() => {
  const map = new Map<string, string>();
  const clients = clientsData?.clients ?? [];
  for (const client of clients) {
    map.set(client.id, client.email ?? "");
  }
  return map;
}, [clientsData]);

const clientPhoneMap = useMemo(() => {
  const map = new Map<string, string>();
  const clients = clientsData?.clients ?? [];
  for (const client of clients) {
    map.set(client.id, client.phoneNumber ?? "");
  }
  return map;
}, [clientsData]);
```

- [ ] **Step 6: Add showArchived state for spreadsheet mode**

```typescript
const [showArchived, setShowArchived] = useState(false);
```

- [ ] **Step 7: Update toolbar props**

In the `<ProjectFloatingToolbar>` JSX, add the new props:
```typescript
viewMode={viewMode}
onViewModeChange={setViewMode}
```

- [ ] **Step 8: Conditional render — wrap canvas in viewMode check**

Wrap the existing canvas `<div className="absolute inset-0">` block in:
```tsx
{viewMode === "canvas" && (
  <div className="absolute inset-0">
    {/* ... existing DndContext + canvas + context menu + archive tray ... */}
  </div>
)}
```

- [ ] **Step 9: Add spreadsheet render**

After the canvas block, add:
```tsx
{viewMode === "spreadsheet" && (
  <div className="absolute inset-0 top-[130px] px-3 pb-3 overflow-hidden">
    <ProjectSpreadsheet
      projects={filteredProjects.filter((p) => p.status !== ProjectStatus.Archived)}
      archivedProjects={archivedProjects}
      showArchived={showArchived}
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
    />
  </div>
)}
```

Note: The `top-[130px]` offset accounts for the metrics header + toolbar. Verify this visually and adjust if needed to align with the HUD bottom edge.

- [ ] **Step 10: Keep detail popover always rendered**

The `<ProjectDetailPopover>` and `<ProjectDragConfirmation>` should remain outside the conditional — both views can trigger the popover:
```tsx
{/* Detail popovers — shared across both views */}
<ProjectDetailPopover projects={projectMap} clientNames={clientNameMap} />
```

- [ ] **Step 11: Commit**

```bash
git add src/app/\(dashboard\)/projects/page.tsx
git commit -m "feat(projects): wire spreadsheet view into page with view toggle and shared data"
```

---

### Task 10: i18n dictionaries

**Files:**
- Modify: `src/i18n/dictionaries/en/projects-canvas.json`
- Modify: `src/i18n/dictionaries/es/projects-canvas.json`

- [ ] **Step 1: Add English strings**

Add the following keys to `src/i18n/dictionaries/en/projects-canvas.json`:

```json
"spreadsheet.columns.status": "Status",
"spreadsheet.columns.title": "Title",
"spreadsheet.columns.client": "Client",
"spreadsheet.columns.address": "Address",
"spreadsheet.columns.startDate": "Start",
"spreadsheet.columns.endDate": "End",
"spreadsheet.columns.progress": "Progress",
"spreadsheet.columns.estimateTotal": "Est. Total",
"spreadsheet.columns.invoiceTotal": "Inv. Total",
"spreadsheet.columns.duration": "Duration",
"spreadsheet.columns.team": "Team",
"spreadsheet.columns.clientEmail": "Client Email",
"spreadsheet.columns.clientPhone": "Client Phone",
"spreadsheet.columns.photos": "Photos",
"spreadsheet.columns.notes": "Notes",
"spreadsheet.columns.description": "Description",
"spreadsheet.columns.pipeline": "Pipeline",
"spreadsheet.columns.daysInStatus": "Days in Status",
"spreadsheet.columns.created": "Created",
"spreadsheet.empty.filtered": "No projects match your filters",
"spreadsheet.empty.none": "No projects yet",
"spreadsheet.empty.noneDesc": "Create your first project to get started",
"spreadsheet.empty.clearFilters": "Clear Filters",
"spreadsheet.footer.showing": "Showing {count} of {total} projects",
"spreadsheet.footer.filtered": "(filtered)",
"spreadsheet.bulk.selected": "{count} selected",
"spreadsheet.bulk.changeStatus": "Change Status",
"spreadsheet.bulk.archive": "Archive",
"spreadsheet.bulk.delete": "Delete",
"spreadsheet.bulk.clear": "Clear",
"spreadsheet.view.canvas": "Canvas",
"spreadsheet.view.spreadsheet": "Spreadsheet"
```

- [ ] **Step 2: Add Spanish translations**

Add equivalent Spanish keys to `src/i18n/dictionaries/es/projects-canvas.json`:

```json
"spreadsheet.columns.status": "Estado",
"spreadsheet.columns.title": "Título",
"spreadsheet.columns.client": "Cliente",
"spreadsheet.columns.address": "Dirección",
"spreadsheet.columns.startDate": "Inicio",
"spreadsheet.columns.endDate": "Fin",
"spreadsheet.columns.progress": "Progreso",
"spreadsheet.columns.estimateTotal": "Total Est.",
"spreadsheet.columns.invoiceTotal": "Total Fact.",
"spreadsheet.columns.duration": "Duración",
"spreadsheet.columns.team": "Equipo",
"spreadsheet.columns.clientEmail": "Email Cliente",
"spreadsheet.columns.clientPhone": "Tel. Cliente",
"spreadsheet.columns.photos": "Fotos",
"spreadsheet.columns.notes": "Notas",
"spreadsheet.columns.description": "Descripción",
"spreadsheet.columns.pipeline": "Pipeline",
"spreadsheet.columns.daysInStatus": "Días en Estado",
"spreadsheet.columns.created": "Creado",
"spreadsheet.empty.filtered": "Ningún proyecto coincide con sus filtros",
"spreadsheet.empty.none": "Sin proyectos aún",
"spreadsheet.empty.noneDesc": "Crea tu primer proyecto para comenzar",
"spreadsheet.empty.clearFilters": "Limpiar Filtros",
"spreadsheet.footer.showing": "Mostrando {count} de {total} proyectos",
"spreadsheet.footer.filtered": "(filtrado)",
"spreadsheet.bulk.selected": "{count} seleccionados",
"spreadsheet.bulk.changeStatus": "Cambiar Estado",
"spreadsheet.bulk.archive": "Archivar",
"spreadsheet.bulk.delete": "Eliminar",
"spreadsheet.bulk.clear": "Limpiar",
"spreadsheet.view.canvas": "Canvas",
"spreadsheet.view.spreadsheet": "Tabla"
```

- [ ] **Step 3: Commit**

```bash
git add src/i18n/dictionaries/en/projects-canvas.json src/i18n/dictionaries/es/projects-canvas.json
git commit -m "feat(projects): add spreadsheet i18n strings (en + es)"
```

---

### Task 11: Visual verification and polish

**Files:**
- Potentially modify any of the above files for adjustments

This is the manual verification pass. Run the app and check everything works.

- [ ] **Step 1: Start dev server**

```bash
cd OPS-Web && npm run dev
```

- [ ] **Step 2: Verify view toggle**

Navigate to `/projects`. Confirm:
- Canvas view loads by default (or last persisted choice)
- View toggle icons appear in the toolbar
- Clicking spreadsheet icon switches to table view
- Clicking canvas icon switches back
- "Fit All" and "Sort" hidden in spreadsheet mode

- [ ] **Step 3: Verify table rendering**

In spreadsheet mode, confirm:
- 8 default columns visible (Status, Title, Client, Address, Start, End, Progress, Est. Total)
- Status color border on left of each row
- Column visibility toggle works (Columns3 icon in header)
- Sorting works on all sortable columns (click header → asc → desc → clear)
- Footer shows correct counts

- [ ] **Step 4: Verify inline editing**

Click editable cells and confirm:
- Title: text input appears, Enter commits, Escape cancels
- Status: dropdown opens with color dots, selecting changes status
- Dates: date picker appears, selecting commits
- Duration: number input appears
- Notes/Description (toggle visible first): textarea expands

- [ ] **Step 5: Verify selection and bulk actions**

- Click row → row highlights with `bg-ops-accent-muted`
- Shift+click → range selection
- Cmd/Ctrl+click → additive toggle
- Bulk bar appears with count
- Bulk "Change Status" dropdown works
- Bulk "Archive" works
- "Clear" deselects all
- Escape clears selection

- [ ] **Step 6: Verify action menu**

- Click `...` button → context menu at click position
- "Open Details" → detail popover opens
- "Archive" → project moves to archived
- Right-click row → same menu

- [ ] **Step 7: Verify filters carry across views**

- Set a search query in canvas mode
- Switch to spreadsheet → same filter applied
- Set a client filter → same projects shown in both views

- [ ] **Step 8: Fix any layout or spacing issues**

Adjust the `top-[130px]` offset in `page.tsx` if the spreadsheet doesn't align correctly below the HUD. Adjust column widths if content overflows.

- [ ] **Step 9: Final commit**

```bash
git add -A
git commit -m "fix(projects): visual polish and layout adjustments for spreadsheet view"
```
