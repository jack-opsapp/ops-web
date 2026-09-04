# Agent Queue Rebuild Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `/agent/queue` usable: it fills the viewport correctly, is gated by one granular permission (`agent.review`) on both client and server, shows a real error state instead of a fake empty state, and presents proposals as a single scannable list with one switch (needs you / history) and one derived type filter.

**Architecture:** The page is a client component that reads the queue through TanStack Query hooks (`src/lib/hooks/use-approval-queue.ts`) which call `/api/agent/queue*` route handlers; route handlers authenticate with Firebase, gate with a permission check, and call `ApprovalQueueService` (service-role Supabase). Layout mode is declared in `src/lib/navigation/route-registry.ts` and consumed by `dashboard-layout.tsx`. Permission keys live in the client catalog (`src/lib/types/permissions.ts`), are seeded per preset role in `public.role_permissions`, registered in `private.lead_permission_editor_registry`, and checked server-side with the `public.has_permission` RPC.

**Tech Stack:** Next.js 15 app router, React 19, TanStack Query, Zustand stores, Tailwind tokens (`tailwind.config.ts`), shared UI primitives in `src/components/ui`, Vitest + Testing Library (jsdom), Supabase (Postgres) via MCP for prod migrations.

**Design System:** `.interface-design/system.md` (ops-web) + `/Users/jacksonsweet/Projects/OPS/ops-design-system/project/DESIGN.md`. Every value must be a token class or CSS variable already defined in `tailwind.config.ts` / `src/styles/globals.css`. Zero new hex literals.

**Required Skills:** `ops-design`, `custom-skills:interface-design`, `ops-copywriter:ops-copywriter` (copy is already decided below; do not rewrite it), `custom-skills:audit-design-system` (run before declaring any UI task done), `superpowers:test-driven-development`.

**Worktree:** `/Users/jacksonsweet/Projects/OPS/ops-web/.worktrees/agent-queue-redesign` on branch `feat/agent-queue-redesign` (cut from `origin/main` at `7bafb2f9`). `node_modules` is a symlink; run tests with `npx vitest run <file>` and types with `npx tsc --noEmit -p tsconfig.json` (slow but fine). Never touch the primary checkout.

**Commit rules:** conventional commits, one logical change each, no AI attribution lines, stage by file name (`git add <paths>`), never `git add -A`.

---

## Decisions already made (do not re-open)

1. **Layout**: register `fullHeight: "padded"` for `agent-queue`. Page root becomes `flex min-h-0 flex-1 flex-col` inside one glass panel; the list is the only scroll owner. Remove the page's own H1 and subtitle (the TopBar already renders `AGENT QUEUE // QUEUE`). Delete the four-tile stats ribbon (`queue-stats.tsx`).
2. **Permission**: new key `agent.review` (scope `all` only), module `agent` ("Agent") under the `admin` category. Granted to preset Admin, Owner, Office. Operator/Crew/Unassigned: not granted. Client gates (registry, hooks) and server gates (all `/api/agent/queue*` handlers) use it. `requireAdminOrOwner` stays for the other agent routes (out of scope) but is no longer used by the queue routes.
3. **Views**: `NEEDS YOU` = status `pending`, sorted priority then newest (existing service sort). `HISTORY` = every other status, sorted by `reviewed_at desc nulls last, updated_at desc`. Priority is no longer a filter; it renders as a tag on the card (tan = high, rose = urgent, nothing for normal/low).
4. **Type filter**: chips derived from the rows currently loaded (never a hardcoded list). Shown only when 2+ distinct types exist. Label = type label + count. `ALL` first.
5. **States**: loading = 3 skeleton rows; error = `// ERROR — QUEUE UNAVAILABLE` + server message + `RETRY`; empty pending = `RegisterEmpty` (`0`, `// AWAITING REVIEW`, hint `[all clear]`); empty history = `RegisterEmpty` (`0`, `// REVIEWED`).
6. **Batch bar**: lives at the bottom of the panel (not `position: fixed`), appears when selection > 0: `[N SELECTED]`, `APPROVE N` (primary, the single accent element on the page), `REJECT N` (destructive), `CLEAR` (ghost). Select-all checkbox sits at the right end of the workbar when bulk-eligible rows exist.
7. **Card shell**: remove the colored left border (banned anti-pattern), remove every `min-h-[56px]` / 44px touch-target sizing (web has no touch targets), status and priority become `<Tag>`s, per-card Approve = `Button variant="default" size="sm"`, Reject = `Button variant="ghost" size="sm"`. Per-type detail bodies inside the card are untouched.
8. **Copy (final, en)**: segment `Needs you` / `History`; chip `All`; empty `Awaiting review` + `[all clear]` / `Reviewed`; error `Queue unavailable`, button `Retry`; batch `{{count}} selected`, `Approve {{count}}`, `Reject {{count}}`, `Clear`; toast error `Action failed. Try again.`

---

### Task 1: Register the route as full-height and point it at `agent.review`

**Skills:** none beyond the plan.

**Files:**
- Modify: `src/lib/navigation/route-registry.ts` (entries `agent-queue` ~line 247 and `agent` ~line 310)
- Test: `src/lib/navigation/__tests__/route-registry-agent-queue.test.ts` (create; directory may not exist)

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  getFullHeightMode,
  getPermissionForPath,
  getEntryForPath,
} from "../route-registry";

describe("route registry — agent queue", () => {
  it("renders the queue in the padded full-height frame", () => {
    expect(getFullHeightMode("/agent/queue")).toBe("padded");
  });

  it("gates the queue and its umbrella on agent.review", () => {
    expect(getPermissionForPath("/agent/queue")).toBe("agent.review");
    expect(getPermissionForPath("/agent")).toBe("agent.review");
  });

  it("keeps the auto-send acceptance on inbox.send", () => {
    expect(getEntryForPath("/agent/auto-send")?.permission).toBe("inbox.send");
  });
});
```

**Step 2: Run it** — `npx vitest run src/lib/navigation/__tests__/route-registry-agent-queue.test.ts` → FAIL (fullHeight null, permission pipeline.view).

**Step 3: Edit the registry.** In the `agent-queue` entry replace `permission: "pipeline.view",` with `permission: "agent.review",` and add `fullHeight: "padded",` after `badge`. In the `agent` umbrella entry replace `permission: "pipeline.view",` with `permission: "agent.review",`. Update the comment above the umbrella to say the queue is gated by `agent.review` (the granular review permission), not pipeline access.

**Step 4: Run the test** → PASS.

**Step 5: Commit** — `git add src/lib/navigation/route-registry.ts src/lib/navigation/__tests__/route-registry-agent-queue.test.ts && git commit -m "fix(agent-queue): full-height frame + agent.review route gate"`

---

### Task 2: Add `agent.review` to the client permission catalog + role editor labels

**Files:**
- Modify: `src/lib/types/permissions.ts` (add `agentModule` after `inboxModule` ~line 496; add it to the `admin` category modules list ~line 329)
- Modify: `src/i18n/dictionaries/en/settings.json` and `src/i18n/dictionaries/es/settings.json` (next to the `roles.permissionModule.inbox` / `roles.permissionAction.inbox.configure_phase_c` lines)
- Test: `src/lib/types/__tests__/permissions-agent-review.test.ts` (create)

**Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, PERMISSION_CATEGORIES } from "../permissions";

describe("permission catalog — agent.review", () => {
  it("registers agent.review with the all scope only", () => {
    expect(ALL_PERMISSIONS).toContain("agent.review");
    const admin = PERMISSION_CATEGORIES.find((c) => c.id === "admin");
    const mod = admin?.modules.find((m) => m.id === "agent");
    expect(mod?.editorMode).toBe("action");
    expect(mod?.actions).toEqual([
      { id: "agent.review", label: "Review agent proposals", scopes: ["all"] },
    ]);
  });
});
```

(If `PERMISSION_CATEGORIES` is not exported, export it — it is the array that `ALL_PERMISSIONS` is derived from.)

**Step 2: Run** → FAIL.

**Step 3: Implement**

```ts
const agentModule: PermissionModule = {
  id: "agent",
  label: "Agent",
  editorMode: "action",
  actions: [
    {
      id: "agent.review",
      label: "Review agent proposals",
      scopes: ["all"],
    },
  ],
};
```

Add `agentModule` to the `admin` category's `modules` array after `inboxModule`. Dictionary keys (keep JSON key ordering next to the inbox ones):

- en: `"roles.permissionModule.agent": "Agent"`, `"roles.permissionAction.agent.review": "Review agent proposals"`
- es: `"roles.permissionModule.agent": "Agente"`, `"roles.permissionAction.agent.review": "Revisar propuestas del agente"`

Check `src/components/settings/permission-grid.tsx` line ~154: module labels resolve through `roles.permissionModule.<id>` with the catalog label as fallback, and action labels through `roles.permissionAction.<id>` (grep to confirm the exact key shape before editing; match it).

**Step 4: Run test → PASS.** Also run `npx vitest run src/lib/types` to make sure no existing catalog snapshot test breaks; if one enumerates every permission, add `agent.review` to it.

**Step 5: Commit** — `feat(permissions): add agent.review to the catalog and role editor`

---

### Task 3: Server-side permission gate for the queue routes

**Files:**
- Modify: `src/lib/supabase/check-permission.ts` (add `checkPermissionByUserId`)
- Modify: `src/app/api/agent/_lib/auth.ts` (add `requirePermission`)
- Modify: `src/app/api/agent/queue/route.ts`, `src/app/api/agent/queue/[actionId]/route.ts`, `src/app/api/agent/queue/bulk/route.ts` (swap the gate)
- Test: `src/app/api/agent/_lib/__tests__/auth-require-permission.test.ts` (create)

**Step 1: Failing test**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ rpc }),
}));
vi.mock("@/lib/firebase/admin-verify", () => ({ verifyAdminAuth: vi.fn() }));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({ findUserByAuth: vi.fn() }));
vi.mock("@/lib/api/services/company-managers", () => ({
  getCompanyManagerUserIds: vi.fn(async () => []),
}));

import { requirePermission } from "../auth";

const auth = {
  id: "user-1",
  companyId: "co-1",
  role: "operator",
  isManager: false,
  firstName: null,
  lastName: null,
};

describe("requirePermission", () => {
  beforeEach(() => rpc.mockReset());

  it("passes when has_permission returns true", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await requirePermission(auth, "agent.review")).toBeNull();
    expect(rpc).toHaveBeenCalledWith("has_permission", {
      p_user_id: "user-1",
      p_permission: "agent.review",
    });
  });

  it("returns 403 when the permission is missing", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const res = await requirePermission(auth, "agent.review");
    expect(res?.status).toBe(403);
  });

  it("fails closed on RPC error", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42883", message: "x" } });
    const res = await requirePermission(auth, "agent.review");
    expect(res?.status).toBe(403);
  });
});
```

**Step 2: Run → FAIL** (`requirePermission` not exported).

**Step 3: Implement.**

In `check-permission.ts`, factor the RPC call out of `checkPermission` into an exported `checkPermissionByUserId(userId: string, permission: string, requiredScope?: PermissionScope): Promise<boolean>` that does exactly what the existing body does after `findUserByAuth` (same `logRpcFailure` on error, `return data === true`). `checkPermission` then becomes `findUserByAuth` + `checkPermissionByUserId`.

In `_lib/auth.ts`:

```ts
import { checkPermissionByUserId } from "@/lib/supabase/check-permission";

/**
 * Granular RBAC gate for agent routes. Resolves through public.has_permission
 * (account holders / admin_ids bypass inside the RPC; everyone else needs a
 * role or override that grants the key). Fail-closed.
 */
export async function requirePermission(
  auth: AuthenticatedUser,
  permission: string
): Promise<NextResponse | null> {
  const allowed = await checkPermissionByUserId(auth.id, permission);
  if (allowed) return null;
  return NextResponse.json(
    { error: `Permission required: ${permission}` },
    { status: 403 }
  );
}
```

In the three queue route files replace every `const roleGate = requireAdminOrOwner(auth); if (roleGate) return roleGate;` (and the `roleErr` variants) with `const gate = await requirePermission(auth, "agent.review"); if (gate) return gate;`. Remove the now-unused `requireAdminOrOwner` import from those three files only. Update the comments ("only admin/owner…") to say the queue is gated by `agent.review`. Leave `FINANCIAL_ACTION_TYPES` alone.

**Step 4: Run the test → PASS.** Then `npx tsc --noEmit` must be clean for these files (run the full type-check once; it takes a few minutes).

**Step 5: Commit** — `fix(agent-queue): gate queue routes on agent.review instead of manager status`

---

### Task 4: Database — seed `agent.review` for preset roles and register it for the editor

**Files:**
- Create: `supabase/migrations/<ledger_version>_agent_review_permission.sql` — the filename's 14-digit stamp MUST be the ledger version read back after applying (see the bible's `migrations/README.md`). Author it first under a placeholder name, apply via MCP `apply_migration` with name `agent_review_permission`, then read `select version from supabase_migrations.schema_migrations order by version desc limit 1` and rename the file to match.
- Mirror: `/Users/jacksonsweet/Projects/OPS/ops-software-bible/migrations/<same name>.sql` (byte-identical + trailing newline)

**Step 1: Verify constraints first (never guess).** Run via MCP `execute_sql` on project `ijeekuhbatykdomumfjx`:

```sql
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.role_permissions'::regclass;
```

If there is a unique constraint on `(role_id, permission)` use `on conflict (role_id, permission) do nothing`; if there is none, use a `where not exists` guard instead. Write the SQL to match what you find.

**Step 2: Migration SQL** (shape; adapt the conflict clause to Step 1):

```sql
-- agent.review — granular gate for the Agent Queue (/agent/queue and
-- /api/agent/queue*). Replaces the account-holder/admin_ids manager check.
-- Granted to preset Admin, Owner, Office. Operator/Crew/Unassigned are not
-- granted; company admins still bypass inside public.has_permission.

insert into public.role_permissions (role_id, permission, scope)
select r.id, 'agent.review', 'all'
  from public.roles r
 where r.company_id is null
   and r.id in (
     '00000000-0000-0000-0000-000000000001', -- Admin
     '00000000-0000-0000-0000-000000000002', -- Owner
     '00000000-0000-0000-0000-000000000003'  -- Office
   )
   and not exists (
     select 1 from public.role_permissions rp
      where rp.role_id = r.id and rp.permission = 'agent.review'
   );

insert into private.lead_permission_editor_registry (permission, scopes)
values ('agent.review', array['all'])
on conflict (permission) do nothing;
```

**Step 3: Apply to prod** with MCP `apply_migration` (project `ijeekuhbatykdomumfjx`). Prod is low-tenant; direct migrations are sanctioned.

**Step 4: Verify by object**, not by ledger:

```sql
select r.name, rp.scope from public.role_permissions rp join public.roles r on r.id = rp.role_id
 where rp.permission = 'agent.review' order by r.name;
select * from private.lead_permission_editor_registry where permission = 'agent.review';
select public.has_permission('283d49df-90a1-4abb-b94c-3e9f17f02c0d'::uuid, 'agent.review', 'all') as owner_ok,
       public.has_permission('1746a0c1-be43-45d6-ab4d-584e82594b1b'::uuid, 'agent.review', 'all') as operator_ok;
```

Expected: three rows (Admin/Owner/Office @ all); registry row present; `owner_ok = true`, `operator_ok = false`.

**Step 5: Name + mirror.** Read the ledger version, rename the file in `supabase/migrations/`, copy it byte-identically to the bible `migrations/` directory. Commit in ops-web: `feat(db): seed agent.review for preset roles`. Commit in the bible (its own repo): `docs(migrations): mirror agent_review_permission`.

---

### Task 5: Queue hooks + types + service — `agent.review` gate and history view

**Files:**
- Modify: `src/lib/types/approval-queue.ts` (`QueueFilters`)
- Modify: `src/lib/api/services/approval-queue-service.ts` (`getQueue`, ~line 1681)
- Modify: `src/app/api/agent/queue/route.ts` (GET parsing)
- Modify: `src/lib/hooks/use-approval-queue.ts` (three `can("pipeline.view")` → `can("agent.review")`; forward `statuses`)
- Create: `src/lib/agent-queue/status-filter.ts` + `src/lib/agent-queue/__tests__/status-filter.test.ts`

**Step 1: Failing test for the parser**

```ts
import { describe, expect, it } from "vitest";
import { parseStatusesParam, HISTORY_STATUSES } from "../status-filter";

describe("parseStatusesParam", () => {
  it("returns undefined for a missing param", () => {
    expect(parseStatusesParam(null)).toBeUndefined();
  });
  it("splits and validates a comma list", () => {
    expect(parseStatusesParam("approved,rejected")).toEqual(["approved", "rejected"]);
  });
  it("rejects unknown statuses", () => {
    expect(() => parseStatusesParam("pending,bogus")).toThrow(/bogus/);
  });
  it("history is every status except pending", () => {
    expect(HISTORY_STATUSES).not.toContain("pending");
    expect(HISTORY_STATUSES).toHaveLength(6);
  });
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement**

`src/lib/agent-queue/status-filter.ts`:

```ts
import type { AgentActionStatus } from "@/lib/types/approval-queue";

export const ALL_STATUSES: readonly AgentActionStatus[] = [
  "pending", "approved", "rejected", "executed", "failed", "expired", "cancelled",
];

/** Every terminal or in-flight status — what the HISTORY view shows. */
export const HISTORY_STATUSES: readonly AgentActionStatus[] = ALL_STATUSES.filter(
  (s) => s !== "pending"
);

/** Parse `?statuses=a,b` into a validated list. Throws on an unknown status. */
export function parseStatusesParam(raw: string | null): AgentActionStatus[] | undefined {
  if (!raw) return undefined;
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  for (const p of parts) {
    if (!ALL_STATUSES.includes(p as AgentActionStatus)) {
      throw new Error(`Unknown status: ${p}`);
    }
  }
  return parts as AgentActionStatus[];
}
```

`QueueFilters` in `approval-queue.ts`: add `statuses?: AgentActionStatus[];` with a doc comment ("multi-status list; takes precedence over `status`").

`getQueue` in the service: after the `filters.status` block add

```ts
if (filters.statuses && filters.statuses.length > 0) {
  query = query.in("status", filters.statuses);
}
```

and make the ordering conditional: when `filters.statuses` is set and does not include `"pending"`, order by `reviewed_at` desc (`nullsFirst: false`) then `updated_at` desc, and **skip** the in-app priority sort (history is chronological). Otherwise keep the existing behaviour. Keep `.limit(200)`.

Route GET: read `statuses` with `parseStatusesParam` inside a try; on throw return 400 `{ error: message }`. Pass `statuses` into `getQueue`.

Hooks: `useApprovalQueue` adds `statuses` to the query params (`params.set("statuses", filters.statuses.join(","))`), and the query key already includes the filters object. Swap all three `can("pipeline.view")` to `can("agent.review")` and fix the comment on `useApprovalQueuePendingCount`. Also expose the error: the hooks already return the full `useQuery` result, so nothing else changes.

**Step 4: Run** the new test → PASS; `npx vitest run src/lib/api/services/__tests__/collections-draft-approval.test.ts src/lib/api/services/__tests__/schedule-purpose-approval-edit.test.ts` still green.

**Step 5: Commit** — `feat(agent-queue): history view statuses filter + agent.review hook gate`

---

### Task 6: Dictionary — new keys, retired keys (en + es)

**Files:**
- Modify: `src/i18n/dictionaries/en/agent-queue.json`, `src/i18n/dictionaries/es/agent-queue.json`

Add (en → es):

```
"segment.needsYou": "Needs you"            → "Pendientes de ti"
"segment.history": "History"               → "Historial"
"filter.allTypes": "All"                   → "Todos"
"empty.pendingNoun": "Awaiting review"     → "Pendiente de revisión"
"empty.pendingHint": "[all clear]"         → "[todo en orden]"
"empty.historyNoun": "Reviewed"            → "Revisados"
"error.title": "Queue unavailable"         → "Cola no disponible"
"error.retry": "Retry"                     → "Reintentar"
"batch.selectedCount": "{{count}} selected" → "{{count}} seleccionados"
"batch.approveCount": "Approve {{count}}"  → "Aprobar {{count}}"
"batch.rejectCount": "Reject {{count}}"    → "Rechazar {{count}}"
"batch.clear": "Clear"                     → "Quitar"
"toast.error": "Action failed. Try again." → "La acción falló. Inténtalo de nuevo."
```

Remove `subtitle`, `stats.pending`, `stats.approvedToday`, `stats.rejectedToday`, `stats.avgResponse`, `batch.selected`, `empty.title`, `empty.description`, `action.selectAll`, `action.deselectAll` **only after** `grep -rn` across `src/` shows no other consumer (the schedule-overview and comms wizard use their own dictionaries; confirm). Keep everything else.

Commit — `feat(agent-queue): dictionary for the rebuilt queue surface`

---

### Task 7: Rebuild the page

**Skills:** `ops-design`, `custom-skills:interface-design`. Tokens: panel `glass-surface rounded-panel`, hairlines `border-border` / `border-line`, text `text-text` / `text-text-2` / `text-text-3` / `text-text-mute`, mono labels `font-mono text-micro uppercase tracking-[0.16em]`, skeleton `bg-fill-neutral-dim` (if the class does not exist use `bg-[var(--fill-neutral-dim)]`), easing `ease-smooth`, surfaces `bg-surface-hover` / `bg-surface-active` (confirm these exist in `tailwind.config.ts`; the FilterChips component already uses them), spacing on the 4/8 grid.

**Files:**
- Rewrite: `src/app/(dashboard)/agent/queue/page.tsx`
- Delete: `src/components/agent/queue-stats.tsx` (grep first: only the page imports it)
- Test: `src/app/(dashboard)/agent/queue/__tests__/agent-queue-page.test.tsx` (create)

**Step 1: Failing page test** (mock everything the page pulls in):

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAction } from "@/lib/types/approval-queue";

const useApprovalQueue = vi.fn();
const mutate = vi.fn();
vi.mock("@/lib/hooks", () => ({
  useApprovalQueue: (f: unknown) => useApprovalQueue(f),
  useApproveAction: () => ({ mutate, isPending: false }),
  useRejectAction: () => ({ mutate, isPending: false }),
  useBulkApprove: () => ({ mutate, isPending: false }),
  useBulkReject: () => ({ mutate, isPending: false }),
}));
vi.mock("@/lib/hooks/use-users", () => ({ useTeamMembers: () => ({ data: { users: [] } }) }));
vi.mock("@/lib/hooks/use-page-title", () => ({ usePageTitle: () => {} }));
vi.mock("@/lib/store/auth-store", () => ({ useAuthStore: () => ({ currentUser: null }) }));
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (k: string) => k }),
  useLocale: () => ({ locale: "en" }),
}));
vi.mock("@/components/ui/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/agent/action-card", () => ({
  ActionCard: ({ action }: { action: AgentAction }) => <div data-testid="card">{action.actionType}</div>,
}));
vi.mock("@/components/agent/reject-dialog", () => ({ RejectDialog: () => null }));
vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>("framer-motion");
  return { ...actual, useReducedMotion: () => true, AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</> };
});

import AgentQueuePage from "../page";

function action(id: string, actionType: string, status = "pending"): AgentAction {
  return {
    id, actionType, status, priority: "normal", confidence: 0.8,
    companyId: "co", userId: "u", actionData: {}, contextSummary: "s",
    contextSource: null, sourceId: null, reviewedBy: null, reviewNotes: null,
    executionResult: null, errorMessage: null,
    createdAt: new Date(), updatedAt: new Date(), reviewedAt: null, executedAt: null, expiresAt: null,
  } as unknown as AgentAction;
}

describe("AgentQueuePage", () => {
  beforeEach(() => { useApprovalQueue.mockReset(); mutate.mockReset(); });

  it("renders the error state with retry when the query fails", () => {
    const refetch = vi.fn();
    useApprovalQueue.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error("Permission required: agent.review"), refetch });
    render(<AgentQueuePage />);
    expect(screen.getByText("error.title")).toBeInTheDocument();
    expect(screen.getByText(/Permission required/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "error.retry" }));
    expect(refetch).toHaveBeenCalled();
    expect(screen.queryByText("empty.pendingNoun")).toBeNull();
  });

  it("renders the pending empty state", () => {
    useApprovalQueue.mockReturnValue({ data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() });
    render(<AgentQueuePage />);
    expect(screen.getByText("empty.pendingNoun")).toBeInTheDocument();
  });

  it("derives type chips from loaded rows and filters locally", () => {
    useApprovalQueue.mockReturnValue({
      data: [action("1", "reassign_task"), action("2", "reassign_task"), action("3", "close_project")],
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    });
    render(<AgentQueuePage />);
    expect(screen.getAllByTestId("card")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: /type.close_project/ }));
    expect(screen.getAllByTestId("card")).toHaveLength(1);
  });

  it("hides type chips when only one type is present", () => {
    useApprovalQueue.mockReturnValue({ data: [action("1", "reassign_task")], isLoading: false, isError: false, error: null, refetch: vi.fn() });
    render(<AgentQueuePage />);
    expect(screen.queryByRole("button", { name: /filter.allTypes/ })).toBeNull();
  });

  it("switches to history statuses", () => {
    useApprovalQueue.mockReturnValue({ data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() });
    render(<AgentQueuePage />);
    fireEvent.click(screen.getByText("segment.history"));
    const last = useApprovalQueue.mock.calls.at(-1)?.[0] as { statuses?: string[] };
    expect(last.statuses).toEqual(["approved", "rejected", "executed", "failed", "expired", "cancelled"]);
    expect(screen.getByText("empty.historyNoun")).toBeInTheDocument();
  });
});
```

Adjust the `AgentAction` stub to whatever fields the type actually requires (read `src/lib/types/approval-queue.ts`, `AgentAction` interface) — do not weaken the type with `any`.

**Step 2: Run → FAIL.**

**Step 3: Implement the page.** Structure (write real code; this is the shape, not pseudocode):

```tsx
"use client";

import { useCallback, useMemo, useState } from "react";
import { AnimatePresence, useReducedMotion } from "framer-motion";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { SegmentControl } from "@/components/ui/segment-control";
import { FilterChips, type FilterChipOption } from "@/components/ui/filter-chip";
import { RegisterEmpty } from "@/components/ui/register-table";
import { useDictionary } from "@/i18n/client";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import { interpolate } from "@/lib/i18n/interpolate";   // confirm export name via grep; else inline a tiny helper
import { cn } from "@/lib/utils/cn";
import { HISTORY_STATUSES } from "@/lib/agent-queue/status-filter";
import { useApprovalQueue, useApproveAction, useRejectAction, useBulkApprove, useBulkReject } from "@/lib/hooks";
import { useTeamMembers } from "@/lib/hooks/use-users";
import { getUserFullName } from "@/lib/types/models";
import { ActionCard, type TeamMemberOption } from "@/components/agent/action-card";
import { RejectDialog } from "@/components/agent/reject-dialog";
import type { AgentAction, AgentActionType } from "@/lib/types/approval-queue";

type View = "needsYou" | "history";
const BULK_EXCLUDED: ReadonlySet<string> = new Set(["file_day_closeout", "approve_collections_draft"]);
```

Page body:

- `view` state (`"needsYou"` default), `typeFilter` state (`"all" | AgentActionType`), `selectedIds`, `rejectTarget`, `bulkRejectOpen`.
- Query: `useApprovalQueue(view === "needsYou" ? { status: "pending" } : { statuses: [...HISTORY_STATUSES] })` → destructure `data, isLoading, isError, error, refetch`.
- `typeOptions` = `ALL` + distinct `actionType`s of `data` with counts, label `${t(`type.${type}`)} ${count}` (count formatted as plain integer, mono via the chip font). If `typeFilter` is not `"all"` and no longer present in `data`, reset to `"all"` in a `useEffect`.
- `visible` = filtered rows. `bulkEligible` = visible pending rows whose type is not in `BULK_EXCLUDED`.
- Handlers: same semantics as today (approve / reject / bulk), toasts use the new keys.
- Root markup:

```tsx
<div className="flex min-h-0 flex-1 flex-col">
  <section className="glass-surface flex min-h-0 flex-1 flex-col overflow-hidden rounded-panel">
    {/* workbar — 28px tier */}
    <header className="flex h-[44px] shrink-0 items-center justify-between gap-3 border-b border-border px-3">
      <SegmentControl
        options={[
          { value: "needsYou", label: t("segment.needsYou"), count: view === "needsYou" && !isLoading && !isError ? (data?.length ?? 0) : undefined },
          { value: "history", label: t("segment.history") },
        ]}
        value={view}
        onChange={(v) => { setView(v); setSelectedIds(new Set()); setTypeFilter("all"); }}
      />
      <div className="flex min-w-0 items-center gap-3">
        {typeOptions.length > 2 && (
          <FilterChips options={typeOptions} value={typeFilter} onChange={setTypeFilter} />
        )}
        {bulkEligible.length > 0 && (
          <button type="button" onClick={toggleAll} aria-pressed={allSelected}
            className="flex h-[28px] items-center gap-1 rounded px-1 font-mono text-micro uppercase tracking-[0.12em] text-text-3 transition-colors duration-150 ease-smooth hover:text-text-2">
            {/* 16px box, border-border / bg-text-2 when all selected, same visual as the card checkbox */}
          </button>
        )}
      </div>
    </header>

    {/* list — the only scroll owner */}
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
      {isLoading && <Skeleton rows={3} />}
      {isError && <ErrorState message={error?.message} onRetry={() => refetch()} t={t} />}
      {!isLoading && !isError && visible.length === 0 && (
        view === "needsYou"
          ? <RegisterEmpty noun={t("empty.pendingNoun")} hint={t("empty.pendingHint")} />
          : <RegisterEmpty noun={t("empty.historyNoun")} />
      )}
      {!isLoading && !isError && visible.length > 0 && (
        <AnimatePresence mode={shouldReduceMotion ? "sync" : "popLayout"}>
          <div className="space-y-2">{visible.map(a => <ActionCard key={a.id} … />)}</div>
        </AnimatePresence>
      )}
    </div>

    {/* batch bar — inside the panel, only while something is selected */}
    {selectedIds.size > 0 && (
      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-3 py-2">
        <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-2">
          [{interpolate(t("batch.selectedCount"), { count: selectedIds.size })}]
        </span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>{t("batch.clear")}</Button>
          <Button variant="destructive" size="sm" onClick={() => setBulkRejectOpen(true)} disabled={bulkRejectMutation.isPending}>{interpolate(t("batch.rejectCount"), { count: selectedIds.size })}</Button>
          <Button variant="primary" size="sm" onClick={handleBulkApprove} loading={bulkApproveMutation.isPending}>{interpolate(t("batch.approveCount"), { count: selectedIds.size })}</Button>
        </div>
      </footer>
    )}
  </section>
  <RejectDialog … /> <RejectDialog … />
</div>
```

`ErrorState` (local component in the page file):

```tsx
<div className="flex flex-col items-start gap-2 px-4 py-10">
  <span className="font-mono text-micro uppercase tracking-[0.16em] text-rose">
    <span aria-hidden className="text-text-mute">{"// "}</span>{t("error.title")}
  </span>
  {message && <span className="font-mono text-micro text-text-3">{message}</span>}
  <Button variant="secondary" size="sm" onClick={onRetry}>{t("error.retry")}</Button>
</div>
```

`Skeleton`: three `h-[72px] rounded-lg bg-fill-neutral-dim animate-pulse motion-reduce:animate-none` rows (use the tailwind alias for `--fill-neutral-dim`; grep `fill-neutral` in `tailwind.config.ts` to get the exact class name).

Interpolation: grep `src/lib/i18n` for the exported `interpolate` helper (there is a test at `src/lib/i18n/__tests__/interpolate.test.ts`). Use it; do not duplicate the card's private copy.

Counts inside chip labels and the segment count are numbers → the chip/segment fonts are already mono; nothing extra.

**Step 4: Run the page test → PASS.** Then `npx tsc --noEmit`. Then delete `queue-stats.tsx` and re-run tsc.

**Step 5: Run `custom-skills:audit-design-system` on `page.tsx`** — zero hardcoded color/radius/spacing/font values allowed. Fix anything it flags.

**Step 6: Commit** — `feat(agent-queue): rebuild the queue surface — one panel, needs-you/history, derived type filter, real error state`

---

### Task 8: Card shell to tokens

**Skills:** `ops-design`, `custom-skills:audit-design-system`.

**Files:**
- Modify: `src/components/agent/action-card.tsx` — ONLY these regions: `PRIORITY_BORDER` / `PRIORITY_TEXT` constants (~line 90–105), the `motion.div` className (~line 987), the header row (`flex items-start gap-3 p-4` block through the status badge, ~line 1000–1200), and the `sourceUrl` anchor. Do not touch any per-type detail block.
- Test: `src/components/agent/__tests__/action-card-shell.test.tsx` (create)

**Step 1: Failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AgentAction } from "@/lib/types/approval-queue";

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (k: string) => k }),
  useLocale: () => ({ locale: "en" }),
}));
vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>("framer-motion");
  return { ...actual, useReducedMotion: () => true };
});

import { ActionCard } from "../action-card";

function make(over: Partial<AgentAction>): AgentAction { /* same stub builder as the page test, reassign_task with minimal actionData */ }

describe("ActionCard shell", () => {
  it("renders urgent priority as a rose tag and no colored left border", () => {
    const { container } = render(<ActionCard action={make({ priority: "urgent" })} selected={false} onSelect={() => {}} onApprove={() => {}} onReject={() => {}} t={(k) => k} />);
    expect(screen.getByText("priority.urgent")).toBeInTheDocument();
    expect(container.firstElementChild?.className).not.toMatch(/border-l-\[/);
  });

  it("renders a dim tag for expired history rows and no approve button", () => {
    render(<ActionCard action={make({ status: "expired" })} … />);
    expect(screen.getByText("filter.expired")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "action.approve" })).toBeNull();
  });

  it("does not render normal priority as a tag", () => {
    render(<ActionCard action={make({ priority: "normal" })} … />);
    expect(screen.queryByText("priority.normal")).toBeNull();
  });
});
```

**Step 2: Run → FAIL** (left border class present; priority text renders as `[priority.normal]`).

**Step 3: Implement**

- Delete `PRIORITY_BORDER` and `PRIORITY_TEXT`. Add:

```ts
const PRIORITY_TAG: Partial<Record<AgentAction["priority"], "tan" | "rose">> = {
  high: "tan",
  urgent: "rose",
};
const STATUS_TAG: Record<Exclude<AgentAction["status"], "pending">, "olive" | "rose" | "dim"> = {
  approved: "olive",
  executed: "olive",
  rejected: "rose",
  failed: "rose",
  expired: "dim",
  cancelled: "dim",
};
```

- `motion.div` className → `cn("rounded-lg border transition-colors duration-150 ease-smooth", selected ? "border-border-medium bg-surface-active" : "glass-surface border-glass-border")`. Drop the `saturate/backdrop-blur` literals (`glass-surface` already carries them).
- Header row: `p-3` instead of `p-4`. Checkbox button: `className="flex h-[28px] w-[28px] shrink-0 items-center justify-center"` with a `h-icon-16 w-icon-16 rounded-bar border` box (`border-border` unselected, `border-border-medium bg-text-2` selected; check icon `text-background`). No negative margins.
- Type label + priority: `<span className="truncate font-mohave text-body-sm uppercase text-text">{t(`type.${…}`)}</span>` then `{PRIORITY_TAG[action.priority] && <Tag variant={PRIORITY_TAG[action.priority]}>{t(`priority.${action.priority}`)}</Tag>}` (import `Tag` from `@/components/ui/tag`).
- Source link: drop `-my-4 min-h-[56px]`; keep the icon + label at `text-micro`.
- Expand toggle: `h-[28px] w-[28px]`, no negative margins.
- Approve/Reject: `<Button variant="default" size="sm" onClick={handleApproveWithEdits}>` / `<Button variant="ghost" size="sm" onClick={() => onReject(action.id)}>` (import `Button`). Labels unchanged (the day-closeout / collections / financial overrides stay).
- Status badge → `<Tag variant={STATUS_TAG[action.status]}>{t(`filter.${action.status}`)}</Tag>` (no brackets).

**Step 4: Run the new test + `npx vitest run src/components/agent` → PASS.** `npx tsc --noEmit` clean.

**Step 5: Audit** `custom-skills:audit-design-system` on the touched region — the rest of the 3,700-line file has pre-existing literals; report them but do not fix them in this task (out of scope; note the count in the commit body).

**Step 6: Commit** — `fix(agent-queue): card shell to tokens — tags for priority/status, no touch targets, no accent border`

---

### Task 9: Sidebar / registry consumers sanity + lint

- `grep -rn "pipeline.view" src/components/layouts/sidebar.tsx src/app/api/agent` — nothing agent-queue-related should remain.
- `grep -rn "requireAdminOrOwner" src/app/api/agent/queue` → 0 hits.
- `grep -rn "queue-stats\|QueueStatsRibbon" src` → 0 hits.
- `npx next lint --file "src/app/(dashboard)/agent/queue/page.tsx" --file src/components/agent/action-card.tsx --file src/lib/hooks/use-approval-queue.ts --file src/app/api/agent/_lib/auth.ts` → clean.
- `npx vitest run src/lib/navigation src/lib/types/__tests__/permissions-agent-review.test.ts src/lib/agent-queue src/app/api/agent src/app/\(dashboard\)/agent src/components/agent` → all green.

No commit unless something needed fixing.

---

### Task 10: Bible

**Files (bible repo `/Users/jacksonsweet/Projects/OPS/ops-software-bible`):**
- `07_SPECIALIZED_FEATURES.md`: add a `### Permissions` row for `agent.review` (Admin ✓ Owner ✓ Office ✓ Operator — Crew —) in the inbox permission table's neighbourhood AND a new short section `## Agent Queue (approval desk)` describing: purpose (every automation proposal lands in `agent_actions`; nothing executes without approval), producers (web services listed in `proposeAction(` callers + DB functions `close_project_when_fully_paid`, `close_project_from_payment_review`), the two views, the `agent.review` gate on both sides, the routes, and the layout registration.
- `04_API_AND_INTEGRATION.md`: under the agent routes, state the gate is `agent.review` via `has_permission`, and document `GET /api/agent/queue?statuses=a,b` (400 on unknown status).

Commit in the bible: `docs(agent-queue): approval desk section, agent.review gate, statuses filter`.

---

### Task 11: Verification (screenshots as proof)

Done by the orchestrating session, not the executing agent: run the worktree on port 3456 with dev bypass, sign in as the Canpro owner, capture `/agent/queue` at 1440×780 and 1440×900 (needs-you with 54 rows, a type chip active, a selection with the batch bar, history view, and the error state forced by temporarily revoking nothing — instead capture error by pointing the hook at a 500 via the browser's network override if available; otherwise rely on the unit test). Save shots to the session scratchpad only.
