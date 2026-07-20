"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import { usePipelineModeStore } from "@/app/(dashboard)/pipeline/_components/pipeline-mode-store";
import { toast } from "@/components/ui/toast";
import { useDictionary } from "@/i18n/client";
import {
  queryKeys,
  quarantineCurrentActorQueryCache,
  refreshAllQueries,
} from "@/lib/api/query-client";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import type { Opportunity } from "@/lib/types/pipeline";
import { useWindowStore } from "@/stores/window-store";
import { useCommunicationDraftStore } from "@/stores/communication-draft-store";

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

async function refreshAccessSensitiveQueries(
  queryClient: QueryClient
): Promise<void> {
  // The synchronous boundary redacts every server-derived namespace because a
  // permission delivery can affect more than leads. Once current authority is
  // proven, repopulate every mounted observer through canonical server RLS so
  // unrelated projects, estimates, and calendar work do not remain blank.
  await refreshAllQueries(queryClient);
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
  const quarantine = quarantineCurrentActorQueryCache(queryClient);

  // Inbox thread shapes vary by view and can embed the lead at multiple
  // levels. Removing the namespace is the only safe synchronous redaction;
  // the next render refetches under canonical RLS.
  closeLeadBackedSurfaces(opportunityId);
  useCommunicationDraftStore.getState().removeForOpportunity(opportunityId);

  // Reconcile list membership under RLS after the immediate local redaction.
  void quarantine.settled.then(() =>
    refreshAccessSensitiveQueries(quarantine.queryClient)
  );
}

/**
 * Notification hook for a revocation that removed a lead the user could SEE.
 * `title` is the lead's display name captured from cache before the purge, or
 * null when the visible row carried no usable name.
 */
export type LeadRevokedNotifier = (notice: { title: string | null }) => void;

/**
 * Snapshot the revoked lead's on-screen identity BEFORE the purge destroys it.
 * `visible` = the row exists in some opportunities list cache right now (the
 * operator can currently see it). Mirrors the detail-window display-name
 * derivation: client name → contact name → title.
 */
function captureVisibleLeadTitle(
  queryClient: QueryClient,
  opportunityId: string
): { visible: boolean; title: string | null } {
  const lists = queryClient.getQueriesData<Opportunity[]>({
    queryKey: queryKeys.opportunities.lists(),
  });
  for (const [, rows] of lists) {
    const row = rows?.find(({ id }) => id === opportunityId);
    if (row) {
      return {
        visible: true,
        title: row.client?.name ?? row.contactName ?? row.title ?? null,
      };
    }
  }
  return { visible: false, title: null };
}

/**
 * Applies the durable assignment-delivery contract to local UI state.
 * Revocation is synchronous and destructive; retained/new access refetches all
 * dependent surfaces without ever fabricating an optimistic assignment.
 *
 * `onLeadRevoked` fires AFTER the purge, and only when the revocation removed
 * a lead that was visible in cache — a boot-time backlog replay over an empty
 * cache stays silent (nothing vanished before the operator's eyes), while a
 * live transfer or a same-session reconnect catch-up announces itself.
 */
export function reconcileLeadAssignmentDelivery(
  queryClient: QueryClient,
  delivery: LeadAssignmentDelivery,
  onLeadRevoked?: LeadRevokedNotifier
): void {
  if (delivery.accessAfter) {
    invalidateLeadDependents(queryClient, delivery.opportunityId);
    return;
  }

  const { visible, title } = captureVisibleLeadTitle(
    queryClient,
    delivery.opportunityId
  );
  purgeRevokedLead(queryClient, delivery.opportunityId);
  if (visible) onLeadRevoked?.({ title });
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
  seenVersionByOpportunity: Map<string, number>,
  onLeadRevoked?: LeadRevokedNotifier
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
    reconcileLeadAssignmentDelivery(
      queryClient,
      {
        opportunityId: row.opportunity_id,
        accessAfter: row.access_after,
      },
      onLeadRevoked
    );
  }
}

export function clearAccessSensitiveCaches(
  queryClient: QueryClient
): ReturnType<typeof quarantineCurrentActorQueryCache> {
  const quarantine = quarantineCurrentActorQueryCache(queryClient);

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
  return quarantine;
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

  const quarantine = clearAccessSensitiveCaches(queryClient);
  await usePermissionStore.getState().fetchPermissions(recipientUserId);
  await quarantine.settled;
  await refreshAccessSensitiveQueries(quarantine.queryClient);
  return true;
}

// ─── Transient-failure grace: retry + fail-closed deadline ──────────────────

/**
 * Backoff schedule for a failed realtime replay read. A revocation channel that
 * momentarily cannot be read (an offline blip, a cold edge) must NOT instantly
 * wipe access-sensitive UI — RLS is still the server-side authority. We retry on
 * this fixed schedule before treating the failure as real.
 */
const REPLAY_RETRY_DELAYS_MS = [1_000, 3_000, 9_000] as const;

/**
 * How long the client may run on last-good access after a transient realtime
 * failure before it fails closed anyway. If both durable backlogs are not
 * verified in the same channel generation within this window, the destructive
 * wipe runs; transport SUBSCRIBED alone is never sufficient.
 */
const AUTHORITY_VERIFICATION_DEADLINE_MS = 3 * 60_000;

type AuthorityStream = "assignment" | "permission";

/**
 * Tracks the two durable authority streams for one mounted realtime channel.
 * A generation begins synchronously before either backlog read. The earliest
 * unresolved generation owns a monotonic deadline: reconnect churn cannot
 * keep extending unverified access. Late reads from an older generation are
 * ignored, and only BOTH successful current-generation snapshots cancel it.
 */
function createAuthorityVerificationWatchdog(runFallback: () => void): {
  beginGeneration: () => number;
  markVerified: (stream: AuthorityStream, generation: number) => void;
  dispose: () => void;
} {
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let assignmentVerified = false;
  let permissionVerified = false;

  const cancel = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };

  return {
    beginGeneration() {
      if (disposed) return generation;
      generation += 1;
      assignmentVerified = false;
      permissionVerified = false;
      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          if (!disposed) runFallback();
        }, AUTHORITY_VERIFICATION_DEADLINE_MS);
      }
      return generation;
    },
    markVerified(stream, verifiedGeneration) {
      if (disposed || verifiedGeneration !== generation) return;
      if (stream === "assignment") assignmentVerified = true;
      else permissionVerified = true;
      if (assignmentVerified && permissionVerified) cancel();
    },
    dispose() {
      disposed = true;
      generation += 1;
      cancel();
    },
  };
}

function defaultReplaySleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs a realtime replay read, retrying a transient read failure on the fixed
 * {@link REPLAY_RETRY_DELAYS_MS} backoff before treating it as real. A success
 * at any attempt calls `onSuccess`; the generation watchdog decides whether
 * both streams are now proven. Exhausting the retries calls `onFinalFailure`
 * (which invalidates under RLS while the already-running deadline remains the
 * fail-closed backstop). Disposal short-circuits WITHOUT failing closed — a
 * remount re-verifies immediately.
 *
 * Extracted + dependency-injected so the retry/deadline contract is unit
 * testable without a live Supabase channel.
 */
export async function replayWithRetryAndDeadline(deps: {
  runReplay: () => Promise<boolean>;
  onSuccess: () => void;
  onFinalFailure: () => void;
  isDisposed: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  retryDelaysMs?: readonly number[];
}): Promise<boolean> {
  const sleep = deps.sleep ?? defaultReplaySleep;
  const delays = deps.retryDelaysMs ?? REPLAY_RETRY_DELAYS_MS;

  if (await deps.runReplay()) {
    deps.onSuccess();
    return true;
  }
  for (const delay of delays) {
    if (deps.isDisposed()) return false;
    await sleep(delay);
    if (deps.isDisposed()) return false;
    if (await deps.runReplay()) {
      deps.onSuccess();
      return true;
    }
  }
  if (deps.isDisposed()) return false;
  deps.onFinalFailure();
  return false;
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
  const { t } = useDictionary("pipeline");
  const [channelEpoch, setChannelEpoch] = useState(0);

  // The channel effect must not re-subscribe when the dictionary loads or the
  // locale flips, so the notifier lives behind a ref the effect closes over.
  const notifyLeadRevokedRef = useRef<LeadRevokedNotifier>(() => {});
  notifyLeadRevokedRef.current = ({ title }) => {
    toast.info(t("toast.leadReassignedAway", "Lead reassigned"), {
      description: t(
        "toast.leadReassignedAwayDesc",
        "{title} is no longer yours."
      ).replace(
        "{title}",
        title ?? t("toast.leadReassignedAwayFallback", "A lead")
      ),
    });
  };

  useEffect(() => {
    if (!companyId || !currentUserId) return;
    const notifyLeadRevoked: LeadRevokedNotifier = (notice) =>
      notifyLeadRevokedRef.current(notice);

    const supabase = getSupabaseClient();
    if (!supabase) return;
    const seenVersionByOpportunity = new Map<string, number>();
    const seenPermissionDeliveryIds = new Set<string>();
    let disposed = false;
    let terminalRestartRequested = false;

    // Fail-closed backstop: the graceful window elapsed without the revocation
    // channel proving itself current. Apply the original destructive wipe +
    // revoke-first authority refresh.
    const runDeadlineFallback = () => {
      const quarantine = clearAccessSensitiveCaches(queryClient);
      void usePermissionStore
        .getState()
        .fetchPermissions(currentUserId, { mode: "revoke-first" })
        .then(async () => {
          await quarantine.settled;
          await refreshAccessSensitiveQueries(quarantine.queryClient);
        });
    };
    const authorityWatchdog =
      createAuthorityVerificationWatchdog(runDeadlineFallback);

    // Transient realtime failure: never wipe on screen. Invalidate under RLS
    // (server stays authoritative; last-good data holds during the background
    // refetch), optionally re-derive authority WITHOUT dropping grants (hold
    // mode). The generation watchdog was armed synchronously before any replay
    // or refresh awaited the network.
    const handleTransientAuthorityFailure = (refreshPermissions: boolean) => {
      if (disposed) return;
      void refreshAccessSensitiveQueries(queryClient);
      if (refreshPermissions) {
        void usePermissionStore
          .getState()
          .fetchPermissions(currentUserId, { mode: "hold" })
          .then(() => refreshAccessSensitiveQueries(queryClient));
      }
    };

    // Raw assignment-delivery backlog read → true when the read succeeded and
    // was reconciled, false on a transient read failure (the orchestrator
    // decides retry / fail-closed). Each channel generation owns its own read:
    // an older in-flight snapshot can never prove a later reconnect current.
    const runAssignmentReplayRead = async (): Promise<boolean> => {
      if (disposed) return true;
      const { data, error } = await supabase
        .from("opportunity_assignment_deliveries")
        .select(
          "id, company_id, opportunity_id, recipient_user_id, access_after, assignment_version"
        )
        .eq("company_id", companyId)
        .eq("recipient_user_id", currentUserId)
        .order("assignment_version", { ascending: true })
        .order("id", { ascending: true });

      if (disposed) return true;
      if (error || !Array.isArray(data)) return false;

      reconcileLeadAssignmentBacklog(
        queryClient,
        data as AssignmentDeliveryRow[],
        companyId,
        currentUserId,
        seenVersionByOpportunity,
        notifyLeadRevoked
      );
      return true;
    };

    const verifyAssignmentAuthority = (generation: number): Promise<boolean> =>
      replayWithRetryAndDeadline({
        runReplay: runAssignmentReplayRead,
        onSuccess: () =>
          authorityWatchdog.markVerified("assignment", generation),
        onFinalFailure: () => handleTransientAuthorityFailure(false),
        isDisposed: () => disposed,
      });

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

    // Raw permission-delivery backlog read → true when the read succeeded (and
    // any latest delivery was applied), false on a transient read failure.
    const runPermissionReplayRead = async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from("user_permission_change_deliveries")
        .select("id, company_id, recipient_user_id, changed_at")
        .eq("recipient_user_id", currentUserId)
        .order("changed_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1);

      if (disposed) return true;
      if (error || !Array.isArray(data)) return false;

      const latest = data[0] as PermissionChangeDeliveryRow | undefined;
      if (latest) await applyPermissionDelivery(latest);
      return true;
    };

    const verifyPermissionAuthority = (generation: number): Promise<boolean> =>
      replayWithRetryAndDeadline({
        runReplay: runPermissionReplayRead,
        onSuccess: () =>
          authorityWatchdog.markVerified("permission", generation),
        onFinalFailure: () => handleTransientAuthorityFailure(true),
        isDisposed: () => disposed,
      });

    const verifyCurrentAuthority = (options?: {
      transientFailure?: boolean;
    }): number => {
      const generation = authorityWatchdog.beginGeneration();
      if (options?.transientFailure) {
        handleTransientAuthorityFailure(true);
      }
      void verifyAssignmentAuthority(generation);
      void verifyPermissionAuthority(generation);
      return generation;
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
            seenVersionByOpportunity,
            notifyLeadRevoked
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
      );

    // Arm before subscribe or either awaited snapshot. Some Supabase clients
    // invoke the status callback synchronously; a resulting newer generation
    // safely supersedes this one without extending the first deadline.
    const initialGeneration = authorityWatchdog.beginGeneration();
    channel.subscribe((status) => {
      if (disposed) return;
      if (status === "SUBSCRIBED") {
        // Transport readiness alone is not authority proof. Both durable
        // backlogs must verify in this new channel generation.
        verifyCurrentAuthority();
      } else if (status === "CLOSED") {
        if (terminalRestartRequested) return;
        terminalRestartRequested = true;
        // CLOSED is terminal in realtime-js: the channel is removed from the
        // socket and cannot deliver a future revocation. Fail closed now, then
        // replace the channel. A successful point-in-time backlog snapshot is
        // not a substitute for an ongoing revocation stream.
        const quarantine = clearAccessSensitiveCaches(queryClient);
        void usePermissionStore
          .getState()
          .fetchPermissions(currentUserId, { mode: "revoke-first" })
          .then(async () => {
            await quarantine.settled;
            await refreshAccessSensitiveQueries(quarantine.queryClient);
          });
        setChannelEpoch((epoch) => epoch + 1);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        // Every terminal/transient transport status follows the same path:
        // keep last-good UI briefly, invalidate under RLS, retry both durable
        // streams, and fail closed at the monotonic deadline if they do not
        // recover.
        verifyCurrentAuthority({ transientFailure: true });
      }
    });

    // Subscribe-first plus verify-now/verify-on-SUBSCRIBED closes both sides of
    // the handoff race. If SUBSCRIBED arrives while the first replay is still
    // running, the SUBSCRIBED callback starts an independent newer-generation
    // snapshot; the older result cannot satisfy it.
    void verifyAssignmentAuthority(initialGeneration);
    void verifyPermissionAuthority(initialGeneration);

    return () => {
      disposed = true;
      // Drop the fail-closed deadline: this effect is tearing down (sign-out or
      // user-switch). A remount re-verifies immediately, and a stale timer must
      // not fire the destructive wipe against a torn-down / switched session's
      // captured queryClient + user id.
      authorityWatchdog.dispose();
      void supabase.removeChannel(channel);
    };
  }, [channelEpoch, companyId, currentUserId, queryClient]);
}
