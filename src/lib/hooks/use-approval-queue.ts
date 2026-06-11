/**
 * OPS Web — Approval Queue Hooks
 *
 * TanStack Query hooks for the agent approval queue.
 * All data fetching goes through API routes (not server-side service).
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { useAuthStore } from "../store/auth-store";
import { usePermissionStore } from "../store/permissions-store";
import type {
  AgentAction,
  QueueFilters,
  QueueStats,
} from "@/lib/types/approval-queue";

// ─── Auth Fetch Helper ────────────────────────────────────────────────────────

async function authFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const { getIdToken } = await import("@/lib/firebase/auth");
  const idToken = await getIdToken();
  if (!idToken) throw new Error("Not authenticated");

  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export function useApprovalQueue(filters: QueueFilters = {}) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  const canView = usePermissionStore((s) => s.can("pipeline.view"));

  return useQuery<AgentAction[]>({
    queryKey: queryKeys.approvalQueue.list(
      companyId,
      filters as Record<string, unknown>
    ),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.status) params.set("status", filters.status);
      if (filters.actionType) params.set("actionType", filters.actionType);
      if (filters.priority) params.set("priority", filters.priority);

      const data = await authFetch<{ actions: AgentAction[] }>(
        `/api/agent/queue?${params}`
      );

      return data.actions.map((a) => ({
        ...a,
        createdAt: new Date(a.createdAt),
        updatedAt: new Date(a.updatedAt),
        reviewedAt: a.reviewedAt ? new Date(a.reviewedAt) : null,
        executedAt: a.executedAt ? new Date(a.executedAt) : null,
        expiresAt: a.expiresAt ? new Date(a.expiresAt) : null,
      }));
    },
    enabled: !!companyId && canView,
  });
}

export function useApprovalQueueStats() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  const canView = usePermissionStore((s) => s.can("pipeline.view"));

  return useQuery<QueueStats>({
    queryKey: queryKeys.approvalQueue.stats(companyId),
    queryFn: () => authFetch<QueueStats>("/api/agent/queue?statsOnly=true"),
    enabled: !!companyId && canView,
  });
}

export function useApprovalQueuePendingCount(
  options: { enabled?: boolean } = {},
) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  // Agent queue is a pipeline-level feature — gate by pipeline.view so
  // crew/operator users don't hit /api/agent/queue and earn 403s in the console.
  const canView = usePermissionStore((s) => s.can("pipeline.view"));
  // Callers can gate further (the sidebar only polls when the company has
  // the phase_c flag — non-Phase-C companies never see the badge, so they
  // should not poll a 60s count for it either).
  const callerEnabled = options.enabled ?? true;

  return useQuery<number>({
    queryKey: queryKeys.approvalQueue.pendingCount(companyId),
    queryFn: async () => {
      const data = await authFetch<{ count: number }>(
        "/api/agent/queue?countOnly=true"
      );
      return data.count;
    },
    enabled: !!companyId && canView && callerEnabled,
    refetchInterval: 60_000,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useApproveAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      actionId,
      editedActionData,
    }: {
      actionId: string;
      editedActionData?: Record<string, unknown>;
    }) =>
      authFetch<AgentAction>(`/api/agent/queue/${actionId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "approve", editedActionData }),
      }),

    onMutate: async ({ actionId }) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.approvalQueue.all,
      });

      queryClient.setQueriesData<AgentAction[]>(
        { queryKey: queryKeys.approvalQueue.lists() },
        (old) =>
          old?.map((a) =>
            a.id === actionId ? { ...a, status: "executed" as const } : a
          )
      );
    },

    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.approvalQueue.all,
      });
    },
  });
}

export function useRejectAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      actionId,
      notes,
    }: {
      actionId: string;
      notes?: string;
    }) =>
      authFetch<AgentAction>(`/api/agent/queue/${actionId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "reject", notes }),
      }),

    onMutate: async ({ actionId }) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.approvalQueue.all,
      });

      queryClient.setQueriesData<AgentAction[]>(
        { queryKey: queryKeys.approvalQueue.lists() },
        (old) =>
          old?.map((a) =>
            a.id === actionId ? { ...a, status: "rejected" as const } : a
          )
      );
    },

    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.approvalQueue.all,
      });
    },
  });
}

export function useBulkApprove() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (actionIds: string[]) =>
      authFetch<{ approved: number; failed: number; errors: string[] }>(
        "/api/agent/queue/bulk",
        {
          method: "POST",
          body: JSON.stringify({ actionIds, action: "approve" }),
        }
      ),

    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.approvalQueue.all,
      });
    },
  });
}

export function useBulkReject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      actionIds,
      notes,
    }: {
      actionIds: string[];
      notes?: string;
    }) =>
      authFetch<{ rejected: number; failed: number; errors: string[] }>(
        "/api/agent/queue/bulk",
        {
          method: "POST",
          body: JSON.stringify({ actionIds, action: "reject", notes }),
        }
      ),

    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.approvalQueue.all,
      });
    },
  });
}

export function useCancelAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (actionId: string) =>
      authFetch<{ ok: boolean }>(`/api/agent/queue/${actionId}`, {
        method: "DELETE",
      }),

    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.approvalQueue.all,
      });
    },
  });
}
