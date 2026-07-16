"use client";

import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import { usePipelineModeStore } from "@/app/(dashboard)/pipeline/_components/pipeline-mode-store";
import { queryKeys } from "@/lib/api/query-client";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import type { Opportunity } from "@/lib/types/pipeline";
import { useWindowStore } from "@/stores/window-store";

export interface LeadAssignmentDelivery {
  opportunityId: string;
  accessAfter: boolean;
}

export interface AssignmentDeliveryRow {
  id?: unknown;
  company_id?: unknown;
  opportunity_id?: unknown;
  recipient_user_id?: unknown;
  access_after?: unknown;
  assignment_version?: unknown;
}

interface AssignmentEventRow {
  company_id?: unknown;
  opportunity_id?: unknown;
}

export interface PermissionChangeDeliveryRow {
  id?: unknown;
  company_id?: unknown;
  recipient_user_id?: unknown;
}

// These namespaces can retain lead-owned children without the opportunity ID
// appearing in the query key (for example activity comments, site-visit detail,
// client detail, and approval rows). A revocation therefore clears the whole
// namespace and lets active observers repopulate through canonical RLS.
const LEAD_SENSITIVE_QUERY_ROOTS = [
  queryKeys.inbox.all,
  queryKeys.metrics.all,
  queryKeys.clients.all,
  queryKeys.estimates.all,
  queryKeys.siteVisits.all,
  queryKeys.activityComments.all,
  queryKeys.aiDrafting.all,
  queryKeys.approvalQueue.all,
  queryKeys.duplicateReviews.all,
  queryKeys.dataReview.all,
  queryKeys.intel.all,
] as const;

function clearLeadSensitiveNamespaces(queryClient: QueryClient): void {
  for (const queryKey of LEAD_SENSITIVE_QUERY_ROOTS) {
    void queryClient.cancelQueries({ queryKey });
    queryClient.removeQueries({ queryKey });
  }
}

const ACCESS_SENSITIVE_QUERY_ROOTS = [
  queryKeys.opportunities.all,
  ...LEAD_SENSITIVE_QUERY_ROOTS,
] as const;

function redactAccessSensitiveQueries(queryClient: QueryClient): void {
  for (const queryKey of ACCESS_SENSITIVE_QUERY_ROOTS) {
    const matchingQueries = queryClient.getQueryCache().findAll({ queryKey });

    // Removing a cached query does not update a mounted QueryObserver: it can
    // continue rendering its last result until another render or timer. Reset
    // every observer-backed query first so sensitive data disappears now,
    // then destroy the inactive copies so no old scope remains recoverable.
    for (const query of matchingQueries) query.reset();
    queryClient.removeQueries({ queryKey, type: "inactive" });
  }
}

async function refreshAccessSensitiveQueries(
  queryClient: QueryClient
): Promise<void> {
  await Promise.all(
    ACCESS_SENSITIVE_QUERY_ROOTS.map((queryKey) =>
      queryClient.invalidateQueries({ queryKey })
    )
  );
}

function invalidateLeadDependents(
  queryClient: QueryClient,
  opportunityId: string
): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.opportunities.all });
  void queryClient.invalidateQueries({ queryKey: queryKeys.metrics.all });
  void queryClient.invalidateQueries({ queryKey: queryKeys.inbox.all });
  void queryClient.invalidateQueries({
    queryKey: queryKeys.opportunities.assignmentCandidates(opportunityId),
  });
}

function closeLeadBackedSurfaces(opportunityId: string): void {
  const pipelineMode = usePipelineModeStore.getState();
  if (pipelineMode.detailPanelOpportunityId === opportunityId) {
    pipelineMode.closeDetailPanel();
  }

  const windowStore = useWindowStore.getState();
  const matchingWindowIds = windowStore.windows
    .filter((windowState) => {
      const metadataOpportunityId = windowState.metadata?.opportunityId;
      return metadataOpportunityId === opportunityId;
    })
    .map(({ id }) => id);

  for (const windowId of matchingWindowIds) {
    useWindowStore.getState().closeWindow(windowId);
  }
}

function purgeRevokedLead(
  queryClient: QueryClient,
  opportunityId: string
): void {
  // Abort any in-flight access-sensitive reads before changing cache contents;
  // otherwise a response started before the assignment event could repopulate
  // the revoked row after this synchronous purge.
  void queryClient.cancelQueries({ queryKey: queryKeys.opportunities.all });
  clearLeadSensitiveNamespaces(queryClient);

  queryClient.setQueriesData<Opportunity[]>(
    { queryKey: queryKeys.opportunities.lists() },
    (current) => current?.filter(({ id }) => id !== opportunityId)
  );

  queryClient.removeQueries({
    predicate: (query) => {
      const key = query.queryKey;
      return (
        key[0] === queryKeys.opportunities.all[0] &&
        key[1] !== "list" &&
        key.includes(opportunityId)
      );
    },
  });

  // Inbox thread shapes vary by view and can embed the lead at multiple
  // levels. Removing the namespace is the only safe synchronous redaction;
  // the next render refetches under canonical RLS.
  closeLeadBackedSurfaces(opportunityId);

  // Reconcile list membership under RLS after the immediate local redaction.
  void queryClient.invalidateQueries({
    queryKey: queryKeys.opportunities.lists(),
  });
}

/**
 * Applies the durable assignment-delivery contract to local UI state.
 * Revocation is synchronous and destructive; retained/new access refetches all
 * dependent surfaces without ever fabricating an optimistic assignment.
 */
export function reconcileLeadAssignmentDelivery(
  queryClient: QueryClient,
  delivery: LeadAssignmentDelivery
): void {
  if (delivery.accessAfter) {
    invalidateLeadDependents(queryClient, delivery.opportunityId);
    return;
  }

  purgeRevokedLead(queryClient, delivery.opportunityId);
}

function isAssignmentDeliveryRow(
  row: AssignmentDeliveryRow,
  companyId: string,
  recipientUserId: string
): row is AssignmentDeliveryRow & {
  id: string;
  opportunity_id: string;
  access_after: boolean;
  assignment_version: number;
} {
  return (
    typeof row.id === "string" &&
    row.company_id === companyId &&
    row.recipient_user_id === recipientUserId &&
    typeof row.opportunity_id === "string" &&
    typeof row.access_after === "boolean" &&
    Number.isSafeInteger(row.assignment_version) &&
    (row.assignment_version as number) > 0
  );
}

/**
 * Replays addressed deliveries idempotently. Only the highest assignment
 * version per lead is applied, so a reconnect cannot briefly resurrect stale
 * access while walking an old transfer history.
 */
export function reconcileLeadAssignmentBacklog(
  queryClient: QueryClient,
  rows: readonly AssignmentDeliveryRow[],
  companyId: string,
  recipientUserId: string,
  seenVersionByOpportunity: Map<string, number>
): void {
  const latestByOpportunity = new Map<
    string,
    AssignmentDeliveryRow & {
      id: string;
      opportunity_id: string;
      access_after: boolean;
      assignment_version: number;
    }
  >();

  for (const row of rows) {
    if (!isAssignmentDeliveryRow(row, companyId, recipientUserId)) continue;
    const current = latestByOpportunity.get(row.opportunity_id);
    if (
      !current ||
      row.assignment_version > current.assignment_version ||
      (row.assignment_version === current.assignment_version &&
        row.id.localeCompare(current.id) > 0)
    ) {
      latestByOpportunity.set(row.opportunity_id, row);
    }
  }

  for (const row of [...latestByOpportunity.values()].sort(
    (left, right) =>
      left.assignment_version - right.assignment_version ||
      left.id.localeCompare(right.id)
  )) {
    const seenVersion = seenVersionByOpportunity.get(row.opportunity_id) ?? 0;
    if (row.assignment_version <= seenVersion) continue;
    seenVersionByOpportunity.set(row.opportunity_id, row.assignment_version);
    reconcileLeadAssignmentDelivery(queryClient, {
      opportunityId: row.opportunity_id,
      accessAfter: row.access_after,
    });
  }
}

export function clearAccessSensitiveCaches(queryClient: QueryClient): void {
  redactAccessSensitiveQueries(queryClient);

  const pipelineMode = usePipelineModeStore.getState();
  pipelineMode.closeDetailPanel();

  const leadWindowIds = useWindowStore
    .getState()
    .windows.filter(
      (windowState) =>
        windowState.type === "pipeline-detail" ||
        typeof windowState.metadata?.opportunityId === "string"
    )
    .map(({ id }) => id);
  for (const windowId of leadWindowIds) {
    useWindowStore.getState().closeWindow(windowId);
  }
}

function isPermissionChangeDeliveryRow(
  row: PermissionChangeDeliveryRow,
  recipientUserId: string
): row is PermissionChangeDeliveryRow & {
  id: string;
  company_id: string;
  recipient_user_id: string;
} {
  return (
    typeof row.id === "string" &&
    typeof row.company_id === "string" &&
    row.recipient_user_id === recipientUserId
  );
}

/**
 * Permission delivery reconciliation is intentionally destructive before the
 * asynchronous permission refresh begins. Server RLS remains authoritative,
 * while the client cannot render a body or lead retained under the old scope.
 */
export async function reconcilePermissionChangeDelivery(
  queryClient: QueryClient,
  row: PermissionChangeDeliveryRow,
  recipientUserId: string
): Promise<boolean> {
  if (!isPermissionChangeDeliveryRow(row, recipientUserId)) return false;

  clearAccessSensitiveCaches(queryClient);
  await usePermissionStore.getState().fetchPermissions(recipientUserId);
  await refreshAccessSensitiveQueries(queryClient);
  return true;
}

/**
 * Global assignment fan-out. Recipient deliveries cover both sides of a
 * transfer (including the old assignee after RLS hides the lead); assignment
 * events refresh every other company-wide viewer that retains access.
 */
export function useLeadAssignmentRealtime(): void {
  const companyId = useAuthStore((state) => state.company?.id ?? null);
  const currentUserId = useAuthStore((state) => state.currentUser?.id ?? null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!companyId || !currentUserId) return;

    const supabase = getSupabaseClient();
    if (!supabase) return;
    const seenVersionByOpportunity = new Map<string, number>();
    const seenPermissionDeliveryIds = new Set<string>();
    let disposed = false;
    let replayInFlight: Promise<void> | null = null;
    let replayRequested = false;

    const replayBacklog = (): Promise<void> => {
      if (disposed) return Promise.resolve();
      if (replayInFlight) {
        replayRequested = true;
        return replayInFlight;
      }

      replayInFlight = (async () => {
        const { data, error } = await supabase
          .from("opportunity_assignment_deliveries")
          .select(
            "id, company_id, opportunity_id, recipient_user_id, access_after, assignment_version"
          )
          .eq("company_id", companyId)
          .eq("recipient_user_id", currentUserId)
          .order("assignment_version", { ascending: true })
          .order("id", { ascending: true });

        if (disposed) return;
        if (error || !Array.isArray(data)) {
          clearAccessSensitiveCaches(queryClient);
          return;
        }

        reconcileLeadAssignmentBacklog(
          queryClient,
          data as AssignmentDeliveryRow[],
          companyId,
          currentUserId,
          seenVersionByOpportunity
        );
      })().finally(() => {
        replayInFlight = null;
        if (replayRequested && !disposed) {
          replayRequested = false;
          void replayBacklog();
        }
      });
      return replayInFlight;
    };

    const applyPermissionDelivery = async (
      row: PermissionChangeDeliveryRow
    ): Promise<void> => {
      const deliveryId = typeof row.id === "string" ? row.id : null;
      if (deliveryId && seenPermissionDeliveryIds.has(deliveryId)) return;
      if (deliveryId) seenPermissionDeliveryIds.add(deliveryId);

      const handled = await reconcilePermissionChangeDelivery(
        queryClient,
        row,
        currentUserId
      );
      if (!handled && deliveryId) {
        seenPermissionDeliveryIds.delete(deliveryId);
      }
    };

    const replayPermissionBacklog = async (): Promise<void> => {
      const { data, error } = await supabase
        .from("user_permission_change_deliveries")
        .select("id, company_id, recipient_user_id, changed_at")
        .eq("recipient_user_id", currentUserId)
        .order("changed_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1);

      if (disposed) return;
      if (error || !Array.isArray(data)) {
        clearAccessSensitiveCaches(queryClient);
        await usePermissionStore.getState().fetchPermissions(currentUserId);
        await refreshAccessSensitiveQueries(queryClient);
        return;
      }
      const latest = data[0] as PermissionChangeDeliveryRow | undefined;
      if (latest) await applyPermissionDelivery(latest);
    };

    const channel = supabase
      .channel(`lead-assignment-${companyId}-${currentUserId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "opportunity_assignment_deliveries",
          filter: `recipient_user_id=eq.${currentUserId}`,
        },
        (payload) => {
          const row = payload.new as AssignmentDeliveryRow;
          reconcileLeadAssignmentBacklog(
            queryClient,
            [row],
            companyId,
            currentUserId,
            seenVersionByOpportunity
          );
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "opportunity_assignment_events",
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          const row = payload.new as AssignmentEventRow;
          if (
            row.company_id !== companyId ||
            typeof row.opportunity_id !== "string"
          ) {
            return;
          }

          // Receiving the event means RLS still permits this actor to see the
          // lead. Old assigned-only recipients cannot see the event and are
          // handled by their addressed delivery row instead.
          reconcileLeadAssignmentDelivery(queryClient, {
            opportunityId: row.opportunity_id,
            accessAfter: true,
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "user_permission_change_deliveries",
          filter: `recipient_user_id=eq.${currentUserId}`,
        },
        (payload) => {
          void applyPermissionDelivery(
            payload.new as PermissionChangeDeliveryRow
          );
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void replayBacklog();
          void replayPermissionBacklog();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          // Never leave access-sensitive data on screen when the revocation
          // channel cannot prove it is current. Fresh reads repopulate via RLS.
          clearAccessSensitiveCaches(queryClient);
          void usePermissionStore
            .getState()
            .fetchPermissions(currentUserId)
            .then(() => refreshAccessSensitiveQueries(queryClient));
        }
      });

    // Subscribe-first plus replay-now/replay-on-SUBSCRIBED closes both sides of
    // the handoff race. If SUBSCRIBED arrives while the first replay is still
    // running, replayRequested forces a second read after that snapshot.
    void replayBacklog();
    void replayPermissionBacklog();

    return () => {
      disposed = true;
      void supabase.removeChannel(channel);
    };
  }, [companyId, currentUserId, queryClient]);
}
