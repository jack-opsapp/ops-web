"use client";

import { useEffect, useRef } from "react";
import {
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

import { usePipelineModeStore } from "@/app/(dashboard)/pipeline/_components/pipeline-mode-store";
import { toast } from "@/components/ui/toast";
import { useDictionary } from "@/i18n/client";
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

function redactQueryRoots(
  queryClient: QueryClient,
  queryRoots: readonly QueryKey[]
): void {
  for (const queryKey of queryRoots) {
    const matchingQueries = queryClient.getQueryCache().findAll({ queryKey });

    // Removing a cached query does not update a mounted QueryObserver: it can
    // continue rendering its last result until another render or timer. Reset
    // every observer-backed query first so sensitive data disappears now,
    // then destroy the inactive copies so no old scope remains recoverable.
    for (const query of matchingQueries) query.reset();
    queryClient.removeQueries({ queryKey, type: "inactive" });
  }
}

async function refreshQueryRoots(
  queryClient: QueryClient,
  queryRoots: readonly QueryKey[]
): Promise<void> {
  await Promise.all(
    queryRoots.map((queryKey) => queryClient.invalidateQueries({ queryKey }))
  );
}

function clearLeadSensitiveNamespaces(queryClient: QueryClient): void {
  redactQueryRoots(queryClient, LEAD_SENSITIVE_QUERY_ROOTS);
  void refreshQueryRoots(queryClient, LEAD_SENSITIVE_QUERY_ROOTS);
}

const ACCESS_SENSITIVE_QUERY_ROOTS = [
  queryKeys.opportunities.all,
  ...LEAD_SENSITIVE_QUERY_ROOTS,
] as const;

function redactAccessSensitiveQueries(queryClient: QueryClient): void {
  redactQueryRoots(queryClient, ACCESS_SENSITIVE_QUERY_ROOTS);
}

async function refreshAccessSensitiveQueries(
  queryClient: QueryClient
): Promise<void> {
  await refreshQueryRoots(queryClient, ACCESS_SENSITIVE_QUERY_ROOTS);
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
 * failure before it fails closed anyway. If no replay succeeds and the channel
 * never reaches SUBSCRIBED within this window, the destructive wipe runs.
 */
const AUTHORITY_VERIFICATION_DEADLINE_MS = 3 * 60_000;

// One module-level deadline. Every failure source (assignment replay, permission
// replay, channel error) arms the SAME timer, so a storm of failures cannot
// stack multiple wipes; the first success cancels it.
let authorityVerificationTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Arm the fail-closed deadline. Idempotent: arming while one is already pending
 * is a no-op — the clock started at the first failure and must not be extended
 * by later ones. `runFallback` performs the destructive wipe when it fires.
 */
export function armAuthorityVerificationDeadline(runFallback: () => void): void {
  if (authorityVerificationTimer) return;
  authorityVerificationTimer = setTimeout(() => {
    authorityVerificationTimer = null;
    runFallback();
  }, AUTHORITY_VERIFICATION_DEADLINE_MS);
}

/** Cancel a pending fail-closed deadline (a replay succeeded, or SUBSCRIBED). */
export function cancelAuthorityVerificationDeadline(): void {
  if (!authorityVerificationTimer) return;
  clearTimeout(authorityVerificationTimer);
  authorityVerificationTimer = null;
}

function defaultReplaySleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs a realtime replay read, retrying a transient read failure on the fixed
 * {@link REPLAY_RETRY_DELAYS_MS} backoff before treating it as real. A success
 * at any attempt calls `onSuccess` (which cancels the fail-closed deadline);
 * exhausting the retries calls `onFinalFailure` (which invalidates under RLS
 * and arms the deadline). Disposal short-circuits WITHOUT failing closed — a
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

  // The channel effect must not re-subscribe when the dictionary loads or the
  // locale flips, so the notifier lives behind a ref the effect closes over.
  const notifyLeadRevokedRef = useRef<LeadRevokedNotifier>(() => {});
  notifyLeadRevokedRef.current = ({ title }) => {
    toast.info(t("toast.leadReassignedAway", "Lead reassigned"), {
      description: t("toast.leadReassignedAwayDesc", "{title} is no longer yours.").replace(
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
    let assignmentReplayInFlight: Promise<boolean> | null = null;
    let assignmentReplayRequested = false;

    // Fail-closed backstop: the graceful window elapsed without the revocation
    // channel proving itself current. Apply the original destructive wipe +
    // revoke-first authority refresh.
    const runDeadlineFallback = () => {
      clearAccessSensitiveCaches(queryClient);
      void usePermissionStore
        .getState()
        .fetchPermissions(currentUserId, { mode: "revoke-first" })
        .then(() => refreshAccessSensitiveQueries(queryClient));
    };

    // Transient realtime failure: never wipe on screen. Invalidate under RLS
    // (server stays authoritative; last-good data holds during the background
    // refetch), optionally re-derive authority WITHOUT dropping grants (hold
    // mode), and arm the fail-closed deadline as the backstop.
    const handleTransientAuthorityFailure = (refreshPermissions: boolean) => {
      if (disposed) return;
      void refreshAccessSensitiveQueries(queryClient);
      if (refreshPermissions) {
        void usePermissionStore
          .getState()
          .fetchPermissions(currentUserId, { mode: "hold" })
          .then(() => refreshAccessSensitiveQueries(queryClient));
      }
      armAuthorityVerificationDeadline(runDeadlineFallback);
    };

    // Raw assignment-delivery backlog read → true when the read succeeded and
    // was reconciled, false on a transient read failure (the orchestrator
    // decides retry / fail-closed). Coalesces concurrent callers and re-runs
    // once if a trigger (e.g. SUBSCRIBED) requested a replay mid-flight,
    // preserving the subscribe-then-snapshot handoff-race guarantee.
    const runAssignmentReplayRead = (): Promise<boolean> => {
      if (disposed) return Promise.resolve(true);
      if (assignmentReplayInFlight) {
        assignmentReplayRequested = true;
        return assignmentReplayInFlight;
      }

      const run = (async (): Promise<boolean> => {
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
      })();

      assignmentReplayInFlight = run;
      void run.finally(() => {
        assignmentReplayInFlight = null;
        if (assignmentReplayRequested && !disposed) {
          assignmentReplayRequested = false;
          void verifyAssignmentAuthority();
        }
      });
      return run;
    };

    const verifyAssignmentAuthority = (): Promise<boolean> =>
      replayWithRetryAndDeadline({
        runReplay: runAssignmentReplayRead,
        onSuccess: cancelAuthorityVerificationDeadline,
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

    const verifyPermissionAuthority = (): Promise<boolean> =>
      replayWithRetryAndDeadline({
        runReplay: runPermissionReplayRead,
        onSuccess: cancelAuthorityVerificationDeadline,
        onFinalFailure: () => handleTransientAuthorityFailure(true),
        isDisposed: () => disposed,
      });

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
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          // The channel is proven current — cancel any pending fail-closed
          // deadline, then re-verify both backlogs (which re-arm it if they in
          // turn fail).
          cancelAuthorityVerificationDeadline();
          void verifyAssignmentAuthority();
          void verifyPermissionAuthority();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          // The revocation channel dropped. Do NOT wipe on screen — RLS is
          // still the server-side authority. Invalidate + hold-refresh
          // authority and arm the fail-closed deadline; a later SUBSCRIBED
          // cancels it, and if none arrives the deadline wipes.
          handleTransientAuthorityFailure(true);
        }
      });

    // Subscribe-first plus verify-now/verify-on-SUBSCRIBED closes both sides of
    // the handoff race. If SUBSCRIBED arrives while the first replay is still
    // running, assignmentReplayRequested forces a second read after that
    // snapshot.
    void verifyAssignmentAuthority();
    void verifyPermissionAuthority();

    return () => {
      disposed = true;
      // Drop the fail-closed deadline: this effect is tearing down (sign-out or
      // user-switch). A remount re-verifies immediately, and a stale timer must
      // not fire the destructive wipe against a torn-down / switched session's
      // captured queryClient + user id.
      cancelAuthorityVerificationDeadline();
      void supabase.removeChannel(channel);
    };
  }, [companyId, currentUserId, queryClient]);
}
