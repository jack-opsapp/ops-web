import { existsSync, readFileSync } from "node:fs";
import {
  dirname,
  extname,
  join,
  normalize,
  relative,
  resolve,
} from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const LOCAL_IMPORT =
  /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function resolveLocalImport(from: string, specifier: string): string | null {
  if (!specifier.startsWith("@/") && !specifier.startsWith(".")) return null;
  const base = specifier.startsWith("@/")
    ? resolve(process.cwd(), "src", specifier.slice(2))
    : resolve(dirname(from), specifier);
  const candidates = extname(base)
    ? [base]
    : [
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.js`,
        `${base}.jsx`,
        join(base, "index.ts"),
        join(base, "index.tsx"),
      ];
  return candidates.find(existsSync) ?? null;
}

function clientPathToServerOnly(entry: string): string[] | null {
  const root = resolve(process.cwd(), entry);
  const visited = new Set<string>();

  function visit(file: string, path: string[]): string[] | null {
    const normalized = normalize(file);
    if (visited.has(normalized)) return null;
    visited.add(normalized);
    const contents = readFileSync(normalized, "utf8");
    const nextPath = [...path, relative(process.cwd(), normalized)];
    if (/import\s+["']server-only["']/.test(contents)) return nextPath;

    for (const match of contents.matchAll(LOCAL_IMPORT)) {
      const dependency = resolveLocalImport(normalized, match[1] ?? match[2]);
      if (!dependency) continue;
      const violation = visit(dependency, nextPath);
      if (violation) return violation;
    }
    return null;
  }

  return visit(root, []);
}

function expectClientGraphSafe(entry: string): void {
  const violation = clientPathToServerOnly(entry);
  expect(
    violation,
    violation
      ? `Client import graph reached server-only:\n${violation.join(" -> ")}`
      : undefined
  ).toBeNull();
}

describe("client mutation automation boundary", () => {
  it("keeps project lifecycle automation out of the browser service graph", () => {
    const projectService = source("src/lib/api/services/project-service.ts");
    const statusRoute = source("src/app/api/projects/[id]/status/route.ts");

    expect(projectService).not.toContain("project-lifecycle-service");
    expect(projectService).not.toContain("async updateProjectStatus");
    expect(projectService).toContain("data.status !== undefined");
    expect(statusRoute).toContain("ProjectStatusLifecycleOutboxService");
    expect(statusRoute).toContain("authenticateRequest");
  });

  it("keeps scheduling automation out of the browser task service graph", () => {
    const taskService = source("src/lib/api/services/task-service.ts");
    const taskRoute = source("src/app/api/tasks/[id]/route.ts");
    const createRoute = source("src/app/api/tasks/route.ts");
    const taskHooks = source("src/lib/hooks/use-tasks.ts");
    const recurrenceHook = source("src/lib/hooks/use-recurrence-edit.ts");

    expect(taskService).not.toContain("client-scheduling-comms-service");
    expect(taskService).not.toContain("async updateTask(");
    expect(taskHooks).not.toContain("TaskService.createTaskWithEvent");
    expect(taskHooks).not.toContain("TaskService.createTask(");
    expect(taskHooks).not.toContain("TaskService.updateTask(");
    expect(taskHooks).not.toContain("TaskService.updateTaskStatus(");
    expect(recurrenceHook).not.toContain("TaskService.updateTask(");
    expect(taskRoute).toContain("TaskMutationAutomationOutboxService");
    expect(taskRoute).toContain("authenticateRequest");
    expect(taskRoute).toContain('"update_task_with_event"');
    expect(taskRoute).not.toContain("authorize_task_action_as_system");
    expect(taskRoute).not.toContain("authorize_task_status_change_as_system");
    expect(taskRoute).not.toContain('select("team_member_ids")');
    expect(createRoute).toContain("TaskMutationAutomationOutboxService");
    expect(createRoute).toContain("authenticateRequest");
    expect(createRoute).toContain('"create_task_with_event"');
  });

  it("routes approved task creation through the reviewer-attributed durable RPC", () => {
    const approvalQueue = source(
      "src/lib/api/services/approval-queue-service.ts"
    );
    const approvedTaskMutation = source(
      "src/lib/api/services/task-approval-mutation-service.ts"
    );
    const createTaskExecutor = approvalQueue.slice(
      approvalQueue.indexOf("async function executeCreateTask"),
      approvalQueue.indexOf("// ─── Reassign Task Executor")
    );

    expect(createTaskExecutor).toContain(
      "TaskApprovalMutationService.createTask"
    );
    expect(createTaskExecutor).toContain("actorUserId: reviewerUserId");
    expect(createTaskExecutor).toContain("taskId: action.id");
    expect(createTaskExecutor).not.toContain("handleRescheduleCascade");
    expect(createTaskExecutor).not.toContain("onTaskCreatedMaybeFullAuto");
    expect(approvedTaskMutation).toContain("create_task_with_event_as_system");
  });

  it("recursively keeps client entry points away from server-only modules", () => {
    for (const entry of [
      "src/components/settings/email-category-autonomy.tsx",
      "src/lib/hooks/use-projects.ts",
      "src/lib/hooks/use-project-mutations.ts",
      "src/lib/hooks/use-tasks.ts",
      "src/lib/hooks/use-recurrence-edit.ts",
    ]) {
      expectClientGraphSafe(entry);
    }
  });
});
