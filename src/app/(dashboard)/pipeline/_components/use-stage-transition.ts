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
 * Won uses the canonical granular convert gate (with bounded legacy fallback);
 * other stage mutations retain `pipeline.manage`. The same-stage no-op,
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
import {
  useClients,
  useConversionPreflight,
  useConvertOpportunityToProject,
  useLinkOpportunityToExistingProject,
  useMoveOpportunityStage,
  useUpdateOpportunity,
} from "@/lib/hooks";
import type { ConversionPreflight } from "@/lib/api/services/project-conversion-service";
import type { AddressSelection } from "@/components/ops/projects/workspace/inputs/address-autocomplete";
import {
  type Opportunity,
  OpportunityStage,
  getStageDisplayName,
  formatCurrency,
} from "@/lib/types/pipeline";
import type { StageTransitionConfirmData } from "./stage-transition-dialog";

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
   * convert access; other moves require `pipeline.manage`. A same-stage request
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
