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
 *   - Won / Lost are terminal: they open the {@link StageTransitionDialog} to
 *     collect the close reason / actual value, and only persist on confirm
 *     (stage move + `updateOpportunity` with the captured fields), with an undo
 *     entry. Winning additionally fires the P6 auto-convert
 *     (`useConvertOpportunityToProject`) so the won deal mints its linked
 *     project — for BOTH the board and the table through this one path; Lost
 *     shows a marked-lost toast.
 *
 * This mirrors the logic that previously lived inline in `pipeline/page.tsx`
 * (`handleMoveStage`, `handleTransitionConfirm`, `handleTransitionCancel`, plus
 * the `transitionType` / `transitionOpportunity` / `pendingStageMove` state),
 * including the P6 auto-convert-on-Won. The permission gate (`pipeline.manage`),
 * the same-stage no-op, the Won→dialog / Lost→dialog routing, and the undo
 * `inverseFn` are preserved exactly so the board and table never drift.
 */

import { useCallback, useMemo, useState } from "react";
import { useDictionary } from "@/i18n/client";
import { toast } from "@/components/ui/toast";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { useUndoStore } from "@/stores/undo-store";
import {
  useClients,
  useConvertOpportunityToProject,
  useMoveOpportunityStage,
  useUpdateOpportunity,
} from "@/lib/hooks";
import {
  type Opportunity,
  OpportunityStage,
  getStageDisplayName,
  formatCurrency,
} from "@/lib/types/pipeline";

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
   * Request a stage change for `id` to `newStage`. Permission-gated on
   * `pipeline.manage`; a no-op when the stage is unchanged. Won / Lost open the
   * terminal-transition dialog; every other stage moves directly (toast + undo).
   */
  requestStageChange: (id: string, newStage: OpportunityStage) => void;
  /** The terminal-transition dialog kind, or `null` when closed. */
  dialogType: "won" | "lost" | null;
  /** The opportunity the dialog is collecting details for, or `null`. */
  dialogOpportunity: Opportunity | null;
  /** Confirm the pending terminal transition with the dialog's captured fields. */
  confirmTransition: (data: {
    actualValue?: number;
    lostReason?: string;
    lostNotes?: string;
  }) => void;
  /** Dismiss the dialog without persisting the pending transition. */
  cancelTransition: () => void;
}

export function useStageTransition({
  opportunities,
}: UseStageTransitionArgs): UseStageTransitionResult {
  const { t } = useDictionary("pipeline");
  const { currentUser } = useAuthStore();
  const can = usePermissionStore((s) => s.can);
  const pushUndo = useUndoStore((s) => s.pushUndo);

  const moveStage = useMoveOpportunityStage();
  const updateOpportunity = useUpdateOpportunity();
  const convertToProject = useConvertOpportunityToProject();

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

  /** Handle stage move from drag-and-drop, advance button, menu, or table cell */
  const requestStageChange = useCallback(
    (id: string, newStage: OpportunityStage) => {
      if (!can("pipeline.manage")) return;
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
    [opportunities, moveStage, currentUser, can, t, clientNameMap, pushUndo]
  );

  /** Confirm Won/Lost transition */
  const confirmTransition = useCallback(
    (data: {
      actualValue?: number;
      lostReason?: string;
      lostNotes?: string;
    }) => {
      if (!can("pipeline.manage")) return;
      if (!pendingStageMove || !transitionOpportunity) return;

      const { id, stage } = pendingStageMove;

      const previousStage = transitionOpportunity.stage;
      const clientName =
        clientNameMap.get(transitionOpportunity.clientId ?? "") ??
        transitionOpportunity.contactName ??
        transitionOpportunity.title ??
        "";
      const toStage = getStageDisplayName(stage);

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

            if (stage === OpportunityStage.Won) {
              // P6: winning a deal AUTOMATICALLY converts it into a linked
              // project. The conversion is idempotent server-side (re-winning
              // never mints a second project), runs through the guarded route,
              // and leaves the opportunity at stage='won' (the preserved sales
              // record). On success the toast reflects the new project; on
              // failure the deal is still won (the stage move already committed)
              // and only the project creation is surfaced as failed.
              convertToProject.mutate(
                {
                  id,
                  actualValue: data.actualValue,
                  expectedStage: OpportunityStage.Won,
                },
                {
                  onSuccess: () => {
                    toast.success(t("toast.dealWonProjectCreated"), {
                      description: transitionOpportunity.title,
                    });
                  },
                  onError: () => {
                    toast.error(t("toast.failedConvertProject"), {
                      description: transitionOpportunity.title,
                    });
                  },
                }
              );
            } else {
              toast.success(t("toast.dealMarkedLost"), {
                description: transitionOpportunity.title,
              });
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

      setTransitionType(null);
      setTransitionOpportunity(null);
      setPendingStageMove(null);
    },
    [
      pendingStageMove,
      transitionOpportunity,
      moveStage,
      updateOpportunity,
      convertToProject,
      currentUser,
      can,
      t,
      clientNameMap,
      pushUndo,
    ]
  );

  /** Cancel Won/Lost transition */
  const cancelTransition = useCallback(() => {
    setTransitionType(null);
    setTransitionOpportunity(null);
    setPendingStageMove(null);
  }, []);

  return {
    requestStageChange,
    dialogType: transitionType,
    dialogOpportunity: transitionOpportunity,
    confirmTransition,
    cancelTransition,
  };
}
