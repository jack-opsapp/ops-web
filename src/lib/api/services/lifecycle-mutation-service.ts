import type { ProjectStatus, ProjectTask } from "@/lib/types/models";
import { authedFetch } from "@/lib/utils/authed-fetch";
import type { CreateTaskWithEventData } from "./task-service";

async function authenticatedJson<T>(
  input: string,
  init: RequestInit
): Promise<T> {
  const response = await authedFetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  const body = (await response.json().catch(() => ({}))) as {
    error?: unknown;
  } & T;
  if (!response.ok) {
    throw new Error(
      typeof body.error === "string"
        ? body.error
        : `Request failed: ${response.status}`
    );
  }
  return body;
}

/**
 * Browser mutation boundary for writes whose follow-up automation is
 * server-only. The API routes derive the OPS actor and company from the
 * verified token, execute the user's RLS-scoped write, then run lifecycle
 * hooks without exposing provider credentials or server-only modules to the
 * browser bundle.
 */
export const LifecycleMutationService = {
  async updateProjectStatus(
    projectId: string,
    status: ProjectStatus
  ): Promise<void> {
    await authenticatedJson<{ ok: true }>(
      `/api/projects/${encodeURIComponent(projectId)}/status`,
      {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }
    );
  },

  createTaskWithEvent(
    data: CreateTaskWithEventData
  ): Promise<{ taskId: string; created: boolean }> {
    const { companyId: _untrustedCompanyId, ...task } = data.task;
    const taskId = task.id ?? crypto.randomUUID();
    return authenticatedJson<{ taskId: string; created: boolean }>(
      "/api/tasks",
      {
        method: "POST",
        body: JSON.stringify({ ...data, task: { ...task, id: taskId } }),
      }
    );
  },

  async updateTask(taskId: string, data: Partial<ProjectTask>): Promise<void> {
    await authenticatedJson<{ ok: true }>(
      `/api/tasks/${encodeURIComponent(taskId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ data }),
      }
    );
  },
};
