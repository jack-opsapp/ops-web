/**
 * OPS Web — Shared pipeline stage-transition hook.
 *
 * The single, correctness-critical path for changing an opportunity's stage.
 * Both the focused board (`pipeline/page.tsx`) and the table surface
 * (`table/pipeline-table-shell.tsx`) consume it so the behavior can never
 * drift between the two views.
 *
 * A stage change is NEVER a silent write — it always carries side effects:
 *   - Active-stage moves go straight through `moveStage.mutate` with a success
 *     toast and an undo entry that restores the prior stage.
 *   - Lost is terminal: it opens the {@link StageTransitionDialog} to collect
 *     the close reason, and only persists on confirm (stage move +
 *     `updateOpportunity` with the captured fields), with an undo entry.
 *   - Won is terminal AND converting: the dialog is preflight-driven (dedup +
 *     auto-name). On confirm the win+convert is ONE atomic action — the unified
 *     `convert_opportunity_to_project` RPC wins the deal AND mints/links its
 *     project in a single transaction, so we call ONLY `convert` (no separate
 *     `moveStage(won)`), which removes the historical double-`stage_transitions`
 *     risk by construction. The snapshot guard is the PRE-win stage captured at
 *     dialog-open. The card flips to won optimistically (the convert hook has no
 *     onMutate); a failed convert rolls back by invalidating opportunities. If
 *     the operator picks a dedup candidate we `linkExisting` instead of create;
 *     if the deal is already linked, "Open project" just deep-links to it.
 *
 *   - Discarded is terminal AND the only stage change that carries a learning
 *     signal, so it never falls through to a plain move. It routes through
 *     {@link beginDiscardCapture}: the card flips optimistically, then either
 *     the one-tap capture toast records WHY (Phase C on) or the RPC records an
 *     authoritative `legacy_unspecified` audit row (Phase C off). Both write
 *     through the atomic `apply_lead_disposition_feedback` contract, which owns
 *     the reason → lifecycle mapping; undo routes through its guarded inverse.
 *     Every path degrades to today's plain `moveStage`, so a discard can never
 *     fail to happen because the feedback contract was unavailable.
 *
 * Won uses the canonical granular convert gate (with bounded legacy fallback);
 * other stage mutations use the canonical granular edit gate. The same-stage no-op,
 * Won→dialog / Lost→dialog routing, and undo `inverseFn` are shared so the
 * board and table never drift.
 */

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useDictionary } from "@/i18n/client";
import { toast } from "@/components/ui/toast";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  selectCanConvertOpportunity,
  selectCanEditOpportunity,
  usePermissionStore,
} from "@/lib/store/permissions-store";
import { useUndoStore } from "@/stores/undo-store";
import { queryKeys } from "@/lib/api/query-client";
import { useFeatureFlagsStore } from "@/lib/store/feature-flags-store";
import {
  useApplyLeadDispositionFeedback,
  useClients,
  useConversionPreflight,
  useConvertOpportunityToProject,
  useLinkOpportunityToExistingProject,
  useMoveOpportunityStage,
  useUndoLeadDispositionFeedback,
  useUpdateOpportunity,
} from "@/lib/hooks";
import type { ConversionPreflight } from "@/lib/api/services/project-conversion-service";
import {
  LeadDispositionFeedbackError,
  type LeadDiscardReasonCode,
  type LeadDispositionFeedbackErrorCode,
  type LeadDispositionOutcome,
} from "@/lib/api/services/lead-disposition-feedback-service";
import {
  confirmDiscardFeedbackToast,
  discardReasonLabel,
  dismissDiscardFeedbackToast,
  showDiscardFeedbackToast,
  type DiscardFeedbackToastHandle,
} from "./discard-feedback-toast";
import type { AddressSelection } from "@/components/ops/projects/workspace/inputs/address-autocomplete";
import {
  type Opportunity,
  OpportunityStage,
  getStageDisplayName,
  formatCurrency,
} from "@/lib/types/pipeline";
import type { StageTransitionConfirmData } from "./stage-transition-dialog";

/** Narrow an unknown throw to the feedback service's stable error code. */
function feedbackErrorCode(error: unknown): LeadDispositionFeedbackErrorCode {
  return error instanceof LeadDispositionFeedbackError ? error.code : "unknown";
}

export interface UseStageTransitionArgs {
  /**
   * The opportunities a stage change may target. `requestStageChange` and
   * `confirmTransition` source the opportunity from this list by id, so callers
   * must pass the live, in-scope set (e.g. the page's `activeOpportunities`).
   */
  opportunities: Opportunity[];
}

export interface UseStageTransitionResult {
  /**
   * Request a stage change for `id` to `newStage`. Won requires canonical
   * convert access; other moves require granular edit access. A same-stage request
   * is a no-op. Won / Lost open the terminal dialog; other stages move directly.
   */
  requestStageChange: (id: string, newStage: OpportunityStage) => void;
  /**
   * Open the Won dialog for an ALREADY-won, unconverted opportunity (e.g. won
   * via estimate approval, never converted). Bypasses `requestStageChange`'s
   * same-stage no-op so the convert can run; the unified RPC's step-12 guard
   * means re-winning writes no second stage_transition.
   */
  requestConvertAlreadyWon: (id: string) => void;
  /** The terminal-transition dialog kind, or `null` when closed. */
  dialogType: "won" | "lost" | null;
  /** The opportunity the dialog is collecting details for, or `null`. */
  dialogOpportunity: Opportunity | null;
  /** Dedup + auto-name preflight for the open Won dialog (undefined otherwise). */
  preflight: ConversionPreflight | undefined;
  /** True while the Won dialog's preflight query is in flight. */
  preflightLoading: boolean;
  /** Confirm the pending terminal transition with the dialog's captured fields. */
  confirmTransition: (data: StageTransitionConfirmData) => void;
  /**
   * Persist a corrected site address (picked in the Won dialog) onto the
   * opportunity so the unified convert RPC — which reads `opp.address` — names
   * the project from the address the operator just confirmed.
   */
  onAddressChange: (selection: AddressSelection) => void;
  /** Dismiss the dialog without persisting the pending transition. */
  cancelTransition: () => void;
}

export function useStageTransition({
  opportunities,
}: UseStageTransitionArgs): UseStageTransitionResult {
  const { t } = useDictionary("pipeline");
  const router = useRouter();
  const queryClient = useQueryClient();
  const { currentUser } = useAuthStore();
  const canEdit = usePermissionStore(selectCanEditOpportunity);
  const canConvert = usePermissionStore(selectCanConvertOpportunity);
  const pushUndo = useUndoStore((s) => s.pushUndo);

  const moveStage = useMoveOpportunityStage();
  const applyFeedback = useApplyLeadDispositionFeedback();
  const undoFeedback = useUndoLeadDispositionFeedback();
  const updateOpportunity = useUpdateOpportunity();
  const convertToProject = useConvertOpportunityToProject();
  const linkToExisting = useLinkOpportunityToExistingProject();

  const { data: clientsData } = useClients();

  // clientId → display name (mirrors pipeline/page.tsx).
  const clientNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (clientsData?.clients) {
      for (const client of clientsData.clients) {
        map.set(client.id, client.name);
      }
    }
    return map;
  }, [clientsData]);

  const [transitionType, setTransitionType] = useState<"won" | "lost" | null>(
    null
  );
  const [transitionOpportunity, setTransitionOpportunity] =
    useState<Opportunity | null>(null);
  const [pendingStageMove, setPendingStageMove] = useState<{
    id: string;
    stage: OpportunityStage;
  } | null>(null);

  // Dedup + auto-name preflight — fetched only while the Won dialog is open, so
  // the operator can link an existing project instead of minting a duplicate.
  const preflightQuery = useConversionPreflight(
    transitionType === "won" ? transitionOpportunity?.id : undefined
  );

  const resetDialog = useCallback(() => {
    setTransitionType(null);
    setTransitionOpportunity(null);
    setPendingStageMove(null);
  }, []);

  /**
   * Discard, end to end. The operator's action is asserted immediately (the
   * card leaves the column before any write) and the reason is captured with
   * at most one extra tap — never a dialog, never a required field.
   *
   * Every server step runs through `mutateAsync` inside plain async closures
   * with an explicit invalidation, because mutation lifecycle callbacks are
   * gated on this component still being mounted and the operator can navigate
   * away while the capture toast is still on screen.
   */
  const beginDiscardCapture = useCallback(
    (opp: Opportunity) => {
      const id = opp.id;
      const previousStage = opp.stage;
      const clientName =
        clientNameMap.get(opp.clientId ?? "") ??
        opp.contactName ??
        opp.title ??
        "";
      const value = opp.estimatedValue
        ? formatCurrency(opp.estimatedValue)
        : "";
      const title = `${clientName}${value ? ` · ${value}` : ""}`;
      const toStage = getStageDisplayName(OpportunityStage.Discarded);
      const stageLine = `${getStageDisplayName(previousStage)} → ${toStage}`;
      const undoLabel = `${clientName} → ${toStage}`;

      const invalidateOpportunities = () => {
        queryClient.invalidateQueries({
          queryKey: queryKeys.opportunities.all,
        });
      };

      /** Today's plain discard — the legacy path AND the never-fail fallback. */
      const commitPlainDiscard = ({ announce }: { announce: boolean }) => {
        moveStage.mutate(
          { id, stage: OpportunityStage.Discarded, userId: currentUser?.id },
          {
            onSuccess: () => {
              // Silent when the capture toast already announced the discard —
              // a second success toast for the same action is noise.
              if (announce) {
                toast.success(title, { description: stageLine });
              }
              pushUndo({
                label: undoLabel,
                inverseFn: async () => {
                  await moveStage.mutateAsync({
                    id,
                    stage: previousStage,
                    userId: currentUser?.id,
                  });
                },
              });
            },
            onError: (error) => {
              toast.error(t("toast.failedMove"), {
                description:
                  error instanceof Error
                    ? error.message
                    : t("toast.errorOccurred"),
              });
            },
          }
        );
      };

      // Won/Lost sources sit outside the feedback contract (the RPC refuses
      // terminal stages), so they keep today's behavior byte for byte.
      if (
        previousStage === OpportunityStage.Won ||
        previousStage === OpportunityStage.Lost
      ) {
        commitPlainDiscard({ announce: true });
        return;
      }

      // Mirrors useMoveOpportunityStage.onMutate — the write is deferred, so
      // this flip is the only thing standing between the tap and the feedback.
      queryClient.cancelQueries({ queryKey: queryKeys.opportunities.lists() });
      queryClient.setQueriesData<Opportunity[]>(
        { queryKey: queryKeys.opportunities.lists() },
        (old) =>
          old
            ? old.map((o) =>
                o.id === id
                  ? {
                      ...o,
                      stage: OpportunityStage.Discarded,
                      stageEnteredAt: new Date(),
                    }
                  : o
              )
            : old
      );
      queryClient.setQueriesData<Opportunity>(
        { queryKey: queryKeys.opportunities.detail(id) },
        (old) =>
          old
            ? {
                ...old,
                stage: OpportunityStage.Discarded,
                stageEnteredAt: new Date(),
              }
            : old
      );

      /** Retract an applied feedback row (toast UNDO and the global stack). */
      const retractFeedback =
        (feedbackId: string, handle?: DiscardFeedbackToastHandle) =>
        async () => {
          try {
            await undoFeedback.mutateAsync({
              feedbackId,
              idempotencyKey: crypto.randomUUID(),
            });
            if (handle) dismissDiscardFeedbackToast(handle);
            invalidateOpportunities();
          } catch (error) {
            if (handle) dismissDiscardFeedbackToast(handle);
            invalidateOpportunities();
            if (feedbackErrorCode(error) === "undo_conflict") {
              toast.error(
                t("discardFeedback.error.undoBlockedTitle", "Undo blocked"),
                {
                  description: t(
                    "discardFeedback.error.undoBlockedBody",
                    "This lead changed after the discard"
                  ),
                }
              );
              return;
            }
            toast.error(t("toast.failedUpdate"), {
              description:
                error instanceof Error
                  ? error.message
                  : t("toast.errorOccurred"),
            });
          }
        };

      // Read at call time, never subscribed: an unknown slug fails OPEN in
      // `canAccessFeature`, so the `initialized` check is load-bearing.
      const flagsState = useFeatureFlagsStore.getState();
      const phaseCEnabled =
        flagsState.initialized && flagsState.canAccessFeature("phase_c");

      if (!phaseCEnabled) {
        // No capture UI, but still an authoritative audit row — and UX byte
        // identical to the discard that shipped before Phase C.
        void (async () => {
          try {
            const result = await applyFeedback.mutateAsync({
              opportunityId: id,
              reasonCode: "legacy_unspecified",
              idempotencyKey: crypto.randomUUID(),
            });
            invalidateOpportunities();
            toast.success(title, { description: stageLine });
            pushUndo({
              label: undoLabel,
              inverseFn: retractFeedback(result.feedbackId),
            });
          } catch (error) {
            const code = feedbackErrorCode(error);
            if (code === "terminal_or_merged" || code === "access_denied") {
              invalidateOpportunities();
              toast.error(t("toast.failedMove"), {
                description:
                  error instanceof Error
                    ? error.message
                    : t("toast.errorOccurred"),
              });
              return;
            }
            commitPlainDiscard({ announce: true });
          }
        })();
        return;
      }

      /** Backward-compatible copy for an older server receipt. New discard
       * reasons all return `discarded` and therefore use `stageLine`. */
      const outcomeStateLine = (outcome: LeadDispositionOutcome): string => {
        switch (outcome) {
          case "lost":
            return t(
              "discardFeedback.outcome.lost",
              "Marked lost — disqualified"
            );
          case "duplicate_review":
            return t(
              "discardFeedback.outcome.duplicate",
              "Duplicate review — stays on board"
            );
          case "review_deferred":
            return t(
              "discardFeedback.outcome.review",
              "Sent to review — stays on board"
            );
          default:
            return stageLine;
        }
      };

      // One key per capture, reused only if that same capture is retried, so a
      // double-fire replays the original write instead of duplicating it.
      const pendingKey = crypto.randomUUID();
      let resolved = false;

      const captureHandle: DiscardFeedbackToastHandle =
        showDiscardFeedbackToast({
          title,
          stateLine: stageLine,
          t,
          onReason: (code: LeadDiscardReasonCode) => {
            if (resolved) return;
            resolved = true;
            void (async () => {
              try {
                const result = await applyFeedback.mutateAsync({
                  opportunityId: id,
                  reasonCode: code,
                  idempotencyKey: pendingKey,
                });
                const retract = retractFeedback(
                  result.feedbackId,
                  captureHandle
                );
                confirmDiscardFeedbackToast(captureHandle, {
                  title,
                  stateLine: outcomeStateLine(result.outcome),
                  reasonLabel: discardReasonLabel(t, code),
                  t,
                  onUndo: () => {
                    void retract();
                  },
                });
                invalidateOpportunities();
                pushUndo({ label: undoLabel, inverseFn: retract });
              } catch (error) {
                dismissDiscardFeedbackToast(captureHandle);
                const code = feedbackErrorCode(error);
                if (code === "terminal_or_merged" || code === "access_denied") {
                  invalidateOpportunities();
                  toast.error(t("toast.failedMove"), {
                    description:
                      error instanceof Error
                        ? error.message
                        : t("toast.errorOccurred"),
                  });
                  return;
                }
                // The reason is lost, the discard is not.
                commitPlainDiscard({ announce: false });
                // A flag flipped mid-session is not the operator's problem.
                if (code === "phase_c_disabled") return;
                toast.error(
                  t("discardFeedback.error.notSavedTitle", "Reason not saved"),
                  {
                    description: t(
                      "discardFeedback.error.notSavedBody",
                      "Lead discarded — the reason did not record"
                    ),
                  }
                );
              }
            })();
          },
          onUndo: () => {
            // Nothing was written yet — undo is a pure cancel.
            if (resolved) return;
            resolved = true;
            dismissDiscardFeedbackToast(captureHandle);
            invalidateOpportunities();
          },
          onClosedWithoutReason: () => {
            // Skipping is allowed: commit the discard, keep no evidence.
            if (resolved) return;
            resolved = true;
            commitPlainDiscard({ announce: false });
          },
        });
    },
    [
      applyFeedback,
      clientNameMap,
      currentUser,
      moveStage,
      pushUndo,
      queryClient,
      t,
      undoFeedback,
    ]
  );

  /** Handle stage move from drag-and-drop, advance button, menu, or table cell */
  const requestStageChange = useCallback(
    (id: string, newStage: OpportunityStage) => {
      if (newStage === OpportunityStage.Won ? !canConvert : !canEdit) return;
      const opp = opportunities.find((o) => o.id === id);
      if (!opp) return;

      // No-op: same stage.
      if (opp.stage === newStage) return;

      // Won / Lost need confirmation dialogs
      if (newStage === OpportunityStage.Won) {
        setTransitionOpportunity(opp);
        setTransitionType("won");
        setPendingStageMove({ id, stage: newStage });
        return;
      }

      if (newStage === OpportunityStage.Lost) {
        setTransitionOpportunity(opp);
        setTransitionType("lost");
        setPendingStageMove({ id, stage: newStage });
        return;
      }

      // Discard owns its own flow — optimistic flip, then reason capture.
      if (newStage === OpportunityStage.Discarded) {
        beginDiscardCapture(opp);
        return;
      }

      // Normal stage move
      const previousStage = opp.stage;
      const clientName =
        clientNameMap.get(opp.clientId ?? "") ??
        opp.contactName ??
        opp.title ??
        "";
      moveStage.mutate(
        { id, stage: newStage, userId: currentUser?.id },
        {
          onSuccess: () => {
            const value = opp.estimatedValue
              ? formatCurrency(opp.estimatedValue)
              : "";
            const fromStage = getStageDisplayName(previousStage);
            const toStage = getStageDisplayName(newStage);
            toast.success(`${clientName}${value ? ` · ${value}` : ""}`, {
              description: `${fromStage} → ${toStage}`,
            });
            pushUndo({
              label: `${clientName} → ${toStage}`,
              inverseFn: async () => {
                await moveStage.mutateAsync({
                  id,
                  stage: previousStage,
                  userId: currentUser?.id,
                });
              },
            });
          },
          onError: (error) => {
            toast.error(t("toast.failedMove"), {
              description:
                error instanceof Error
                  ? error.message
                  : t("toast.errorOccurred"),
            });
          },
        }
      );
    },
    [
      opportunities,
      moveStage,
      currentUser,
      canEdit,
      canConvert,
      t,
      clientNameMap,
      pushUndo,
      beginDiscardCapture,
    ]
  );

  /** Confirm Won/Lost transition */
  const confirmTransition = useCallback(
    (data: StageTransitionConfirmData) => {
      if (!pendingStageMove || !transitionOpportunity) return;
      if (
        pendingStageMove.stage === OpportunityStage.Won ? !canConvert : !canEdit
      )
        return;

      const { id, stage } = pendingStageMove;
      // The stage captured at dialog-open — the snapshot guard for convert and
      // the target the undo entry restores to.
      const previousStage = transitionOpportunity.stage;
      const clientName =
        clientNameMap.get(transitionOpportunity.clientId ?? "") ??
        transitionOpportunity.contactName ??
        transitionOpportunity.title ??
        "";
      const toStage = getStageDisplayName(stage);
      const oppTitle = transitionOpportunity.title;

      // A genuinely terminal linked lead needs no write; opening is the whole
      // action. A linked lead in any non-won stage must continue through the
      // idempotent conversion below so the stage change is real before open.
      if (
        data.openProjectId &&
        transitionOpportunity.stage === OpportunityStage.Won &&
        preflightQuery.data?.projectAccessible === true &&
        preflightQuery.data.existingLinkedProject?.id === data.openProjectId
      ) {
        router.push(`/dashboard?openProject=${data.openProjectId}&mode=view`);
        resetDialog();
        return;
      }

      // ── Won: ONE atomic win+convert (or link-existing) ──
      if (stage === OpportunityStage.Won) {
        const assignmentVersion = preflightQuery.data?.assignmentVersion;
        if (
          !Number.isSafeInteger(assignmentVersion) ||
          (assignmentVersion as number) < 0
        ) {
          toast.error(t("toast.failedConvertProject"), {
            description: oppTitle,
          });
          return;
        }

        // The convert/link hooks have no onMutate, so flip the card to won
        // locally for instant feedback (mirrors useMoveOpportunityStage). The
        // hooks' onSettled reconciles against the server; a failed convert
        // additionally invalidates here to revert the flip.
        queryClient.cancelQueries({
          queryKey: queryKeys.opportunities.lists(),
        });
        queryClient.setQueriesData<Opportunity[]>(
          { queryKey: queryKeys.opportunities.lists() },
          (old) =>
            old
              ? old.map((o) =>
                  o.id === id
                    ? {
                        ...o,
                        stage: OpportunityStage.Won,
                        stageEnteredAt: new Date(),
                      }
                    : o
                )
              : old
        );

        const onConvertError = () => {
          queryClient.invalidateQueries({
            queryKey: queryKeys.opportunities.all,
          });
          toast.error(t("toast.failedConvertProject"), {
            description: oppTitle,
          });
        };

        if (data.linkToProjectId) {
          linkToExisting.mutate(
            {
              id,
              projectId: data.linkToProjectId,
              actualValue: data.actualValue,
              expectedStage: previousStage,
              expectedAssignmentVersion: assignmentVersion as number,
            },
            {
              onSuccess: () =>
                toast.success(
                  t(
                    "toast.dealWonProjectLinked",
                    "Deal won. Linked to existing project."
                  ),
                  { description: oppTitle }
                ),
              onError: onConvertError,
            }
          );
        } else {
          convertToProject.mutate(
            {
              id,
              actualValue: data.actualValue,
              expectedStage: previousStage,
              expectedAssignmentVersion: assignmentVersion as number,
              titleOverride: data.titleOverride,
            },
            {
              onSuccess: (conversion) => {
                const wasAlreadyLinked =
                  conversion.alreadyConverted === true ||
                  preflightQuery.data?.alreadyConverted === true;
                if (wasAlreadyLinked) {
                  if (conversion.projectAccessible && conversion.projectId) {
                    router.push(
                      `/dashboard?openProject=${conversion.projectId}&mode=view`
                    );
                  } else {
                    toast.success(t("toast.dealMarkedWon"), {
                      description: oppTitle,
                    });
                  }
                  return;
                }
                toast.success(t("toast.dealWonProjectCreated"), {
                  description: oppTitle,
                });
              },
              onError: onConvertError,
            }
          );
        }

        pushUndo({
          label: `${clientName} → ${toStage}`,
          inverseFn: async () => {
            await moveStage.mutateAsync({
              id,
              stage: previousStage,
              userId: currentUser?.id,
            });
          },
        });

        resetDialog();
        return;
      }

      // ── Lost: unchanged — move stage, record reason/notes, toast + undo ──
      moveStage.mutate(
        { id, stage, userId: currentUser?.id },
        {
          onSuccess: () => {
            const updateData: Record<string, unknown> = {};
            if (data.actualValue !== undefined) {
              updateData.actualValue = data.actualValue;
            }
            if (data.lostReason) {
              updateData.lostReason = data.lostReason;
            }
            if (data.lostNotes) {
              updateData.lostNotes = data.lostNotes;
            }

            if (Object.keys(updateData).length > 0) {
              updateOpportunity.mutate({ id, data: updateData });
            }

            toast.success(t("toast.dealMarkedLost"), {
              description: oppTitle,
            });

            pushUndo({
              label: `${clientName} → ${toStage}`,
              inverseFn: async () => {
                await moveStage.mutateAsync({
                  id,
                  stage: previousStage,
                  userId: currentUser?.id,
                });
              },
            });
          },
          onError: (error) => {
            toast.error(t("toast.failedUpdate"), {
              description:
                error instanceof Error
                  ? error.message
                  : t("toast.errorOccurred"),
            });
          },
        }
      );

      resetDialog();
    },
    [
      pendingStageMove,
      transitionOpportunity,
      moveStage,
      updateOpportunity,
      convertToProject,
      linkToExisting,
      queryClient,
      router,
      resetDialog,
      currentUser,
      canEdit,
      canConvert,
      t,
      clientNameMap,
      pushUndo,
      preflightQuery.data,
    ]
  );

  /**
   * Persist the operator's corrected site address onto the open opportunity.
   * The autocomplete only fires this on an explicit geocoded pick, so the
   * address always travels with lat/lon — keeping the map pin and the
   * street-line auto name both reliable.
   */
  const onAddressChange = useCallback(
    (selection: AddressSelection) => {
      if (!transitionOpportunity) return;
      updateOpportunity.mutate({
        id: transitionOpportunity.id,
        data: {
          address: selection.address,
          latitude: selection.latitude,
          longitude: selection.longitude,
        },
      });
    },
    [transitionOpportunity, updateOpportunity]
  );

  /**
   * Open the Won dialog directly for an already-won, unconverted opportunity.
   * `requestStageChange(id, 'won')` no-ops when the opp is already won, so this
   * dedicated entry bypasses that guard. confirmTransition then runs convert
   * with expectedStage='won' (the opp's current stage) — idempotent server-side.
   */
  const requestConvertAlreadyWon = useCallback(
    (id: string) => {
      if (!canConvert) return;
      const opp = opportunities.find((o) => o.id === id);
      if (!opp) return;
      setTransitionOpportunity(opp);
      setTransitionType("won");
      setPendingStageMove({ id, stage: OpportunityStage.Won });
    },
    [opportunities, canConvert]
  );

  /** Cancel Won/Lost transition */
  const cancelTransition = useCallback(() => {
    resetDialog();
  }, [resetDialog]);

  return {
    requestStageChange,
    requestConvertAlreadyWon,
    dialogType: transitionType,
    dialogOpportunity: transitionOpportunity,
    preflight: preflightQuery.data,
    preflightLoading: preflightQuery.isLoading,
    confirmTransition,
    onAddressChange,
    cancelTransition,
  };
}
