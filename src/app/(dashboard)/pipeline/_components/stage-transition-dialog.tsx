"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  AddressAutocomplete,
  type AddressSelection,
} from "@/components/ops/projects/workspace/inputs/address-autocomplete";
import { deriveProjectNamePreview } from "@/lib/utils/derive-project-name";
import { LOSS_REASONS, formatCurrency } from "@/lib/types/pipeline";
import type { Opportunity } from "@/lib/types/pipeline";
import type { ConversionPreflight } from "@/lib/api/services/project-conversion-service";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { ChevronRight, Loader2, Trophy, XCircle } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The Won confirm payload — a superset that also carries the dedup choices. */
export interface StageTransitionConfirmData {
  actualValue?: number;
  lostReason?: string;
  lostNotes?: string;
  /** Operator-typed name from the `rename` escape hatch (title_is_auto=false). */
  titleOverride?: string | null;
  /** A dedup candidate the operator chose → link instead of create. */
  linkToProjectId?: string;
  /** Existing linked project to open after Mark Won; already-won opens directly. */
  openProjectId?: string;
}

interface StageTransitionDialogProps {
  type: "won" | "lost" | null;
  opportunity: Opportunity | null;
  /** Read-only dedup + auto-name preview, fetched when the Won dialog opens. */
  preflight?: ConversionPreflight;
  /** True while the preflight query is in flight. */
  preflightLoading?: boolean;
  onConfirm: (data: StageTransitionConfirmData) => void;
  onCancel: () => void;
  /**
   * Fires when the operator picks a new geocoded site address in the Won
   * dialog. The parent persists it to the opportunity so the unified convert
   * RPC (which reads opp.address) names the project from the corrected address.
   */
  onAddressChange?: (selection: AddressSelection) => void;
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

const LABEL_CLASS =
  "font-mono text-micro text-text-2 uppercase tracking-[0.16em]";

const INPUT_CLASS = cn(
  "w-full bg-surface-input text-text font-mono text-body",
  "px-1.5 py-1.5 rounded border border-border",
  "placeholder:text-text-3",
  "focus:border-[rgba(255,255,255,0.20)] focus:outline-none"
);

/** Section title in the tactical `// LABEL` treatment. */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-micro uppercase tracking-[0.16em] text-text-2">
      <span className="text-text-mute">{"// "}</span>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Won Dialog Content
// ---------------------------------------------------------------------------
function WonContent({
  opportunity,
  preflight,
  preflightLoading,
  onConfirm,
  onCancel,
  onAddressChange,
}: {
  opportunity: Opportunity;
  preflight?: ConversionPreflight;
  preflightLoading?: boolean;
  onConfirm: (data: StageTransitionConfirmData) => void;
  onCancel: () => void;
  onAddressChange?: (selection: AddressSelection) => void;
}) {
  const { t } = useDictionary("pipeline");
  const reduce = useReducedMotion();

  const [actualValue, setActualValue] = useState(
    opportunity.estimatedValue?.toString() ?? ""
  );
  const [address, setAddress] = useState(opportunity.address ?? "");
  const [renameOpen, setRenameOpen] = useState(false);
  const [titleOverride, setTitleOverride] = useState("");
  // null = "create new" (the default); a project id = link that candidate.
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(
    null
  );
  const [othersOpen, setOthersOpen] = useState(false);

  const inaccessibleLinkedRecovery =
    preflight?.alreadyConverted === true &&
    preflight.projectAccessible === false;
  const existingLinked = inaccessibleLinkedRecovery
    ? null
    : (preflight?.existingLinkedProject ?? null);
  const candidates = inaccessibleLinkedRecovery
    ? []
    : (preflight?.duplicateCandidates ?? []);
  const others = inaccessibleLinkedRecovery
    ? []
    : (preflight?.otherClientProjects ?? []);
  const hasCandidates = candidates.length > 0;

  const namePreview = deriveProjectNamePreview({
    address,
    suggestedName: preflight?.suggestedName,
    newProjectName: t("transition.newProjectName", "New project"),
  });

  // Confirm a state change is the celebration — opacity/transform ≤200ms, the
  // single EASE_SMOOTH curve, opacity-only under reduced motion.
  const reveal = reduce
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0.15, ease: EASE_SMOOTH },
      }
    : {
        initial: { opacity: 0, y: -4 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -4 },
        transition: { duration: 0.2, ease: EASE_SMOOTH },
      };

  const parsedValue = () => {
    const v = actualValue ? parseFloat(actualValue) : undefined;
    return v !== undefined && !Number.isNaN(v) ? v : undefined;
  };

  const handleAddress = (sel: AddressSelection) => {
    setAddress(sel.address);
    onAddressChange?.(sel);
  };

  const signalLabel = (signal: string): string =>
    (
      ({
        same_client: t("transition.signalSameClient", "same client"),
        same_address: t("transition.signalSameAddress", "same address"),
      }) as Record<string, string>
    )[signal] ?? signal.replace(/_/g, " ");

  const ctaKind: "open" | "link" | "create" | "win" = inaccessibleLinkedRecovery
    ? "win"
    : existingLinked
      ? "open"
      : selectedCandidateId
        ? "link"
        : hasCandidates
          ? "create"
          : "win";

  const ctaLabel =
    (ctaKind === "open"
      ? opportunity.stage === "won"
        ? t("transition.openProject", "Open project")
        : t("transition.markWonAndOpen", "Mark won & open")
      : {
          link: t("transition.linkAndWin", "Link & win"),
          create: t("transition.createNewAction", "Create new"),
          win: t("transition.markWon", "Mark won"),
        }[ctaKind]) + " →";

  const handleConfirm = () => {
    if (preflightLoading) return;
    if (inaccessibleLinkedRecovery) {
      onConfirm({ actualValue: parsedValue() });
      return;
    }
    if (existingLinked) {
      onConfirm({ openProjectId: existingLinked.id });
      return;
    }
    const value = parsedValue();
    if (selectedCandidateId) {
      onConfirm({ actualValue: value, linkToProjectId: selectedCandidateId });
      return;
    }
    const override =
      renameOpen && titleOverride.trim() ? titleOverride.trim() : undefined;
    onConfirm({ actualValue: value, titleOverride: override });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Trophy className="h-[18px] w-[18px] text-status-success" />
          {t("transition.wonTitle", "Deal won")}
        </DialogTitle>
        <DialogDescription>{opportunity.title}</DialogDescription>
      </DialogHeader>

      {existingLinked ? (
        // ── existing_linked: already converted — open it, don't duplicate ──
        <motion.div
          {...reveal}
          data-testid="won-existing-linked"
          className="my-2 rounded-panel border border-border bg-surface-input px-3 py-2.5"
        >
          <SectionTitle>
            {t("transition.duplicateExistsTitle", "Already linked")}
          </SectionTitle>
          <p className="mt-1 font-mohave text-body-sm text-text-2">
            {t(
              "transition.duplicateExistsBody",
              "This deal already has a project. Open it instead of making a duplicate."
            )}
          </p>
          <p className="mt-1.5 font-mono text-micro text-text">
            {existingLinked.title}
          </p>
        </motion.div>
      ) : (
        <div className="space-y-3 py-2">
          {/* FINAL VALUE */}
          <div className="space-y-0.5">
            <label htmlFor="won-value" className={LABEL_CLASS}>
              {t("transition.finalValue", "Final value")}
            </label>
            <div className="relative">
              <span className="absolute left-1.5 top-1/2 -translate-y-1/2 font-mono text-micro text-text-3">
                $
              </span>
              <input
                id="won-value"
                data-testid="won-value-input"
                type="number"
                aria-label={t("transition.finalValue", "Final value")}
                value={actualValue}
                onChange={(e) => setActualValue(e.target.value)}
                placeholder={
                  opportunity.estimatedValue
                    ? formatCurrency(opportunity.estimatedValue)
                    : "0.00"
                }
                className={cn(INPUT_CLASS, "pl-4")}
              />
            </div>
          </div>

          {/* NAME (auto) + rename escape hatch */}
          {!inaccessibleLinkedRecovery && (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 font-mono text-micro">
                  <span className="text-text-mute">{"// "}</span>
                  <span className="uppercase tracking-[0.16em] text-text-3">
                    {t("transition.nameAuto", "Name")}
                  </span>
                  <span className="text-text-mute"> · </span>
                  {!renameOpen && (
                    <span data-testid="won-name-preview" className="text-text">
                      {namePreview}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  data-testid="won-rename-toggle"
                  onClick={() => setRenameOpen((o) => !o)}
                  className="shrink-0 font-mono text-micro lowercase text-text-3 transition-colors hover:text-text-2"
                >
                  {t("transition.rename", "rename")}
                </button>
              </div>
              <AnimatePresence initial={false}>
                {renameOpen && (
                  <motion.div key="rename" {...reveal}>
                    <input
                      data-testid="won-rename-input"
                      type="text"
                      aria-label={t("transition.nameAuto", "Name")}
                      value={titleOverride}
                      onChange={(e) => setTitleOverride(e.target.value)}
                      placeholder={namePreview}
                      className={cn(INPUT_CLASS, "font-mohave")}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* SITE ADDRESS — editable; drives the name preview live */}
          {!inaccessibleLinkedRecovery && (
            <div className="space-y-0.5">
              <label className={LABEL_CLASS}>
                {t("transition.siteAddress", "Site address")}
              </label>
              <AddressAutocomplete
                value={address}
                onChange={handleAddress}
                portalListbox
                proximity={
                  opportunity.latitude != null && opportunity.longitude != null
                    ? {
                        latitude: opportunity.latitude,
                        longitude: opportunity.longitude,
                      }
                    : undefined
                }
              />
            </div>
          )}

          {/* ── dedup: loading / duplicate candidates ── */}
          {!inaccessibleLinkedRecovery &&
            (preflightLoading ? (
              <motion.div
                {...reveal}
                data-testid="won-preflight-loading"
                className="flex items-center gap-1.5 font-mono text-micro text-text-3"
              >
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                {`[ ${t("transition.checkingDuplicates", "Checking for duplicates")} ]`}
              </motion.div>
            ) : hasCandidates ? (
              <motion.div {...reveal} className="space-y-1.5">
                <SectionTitle>
                  {t("transition.candidatesTitle", "Possible duplicates")}
                </SectionTitle>
                <p className="font-mohave text-body-sm text-text-3">
                  {t(
                    "transition.candidatesBody",
                    "This job may already exist. Link it instead of creating a duplicate."
                  )}
                </p>
                <div
                  role="radiogroup"
                  aria-label={t(
                    "transition.candidatesTitle",
                    "Possible duplicates"
                  )}
                  className="space-y-1"
                >
                  {candidates.map((c) => {
                    const selected = selectedCandidateId === c.projectId;
                    return (
                      <button
                        type="button"
                        key={c.projectId}
                        data-testid={`won-candidate-${c.projectId}`}
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setSelectedCandidateId(c.projectId)}
                        className={cn(
                          "w-full rounded border px-2.5 py-2 text-left transition-colors",
                          selected
                            ? "border-line-hi bg-surface-active"
                            : "border-border bg-surface-input hover:bg-surface-hover"
                        )}
                      >
                        <div className="font-mohave text-body-sm text-text">
                          {c.title}
                        </div>
                        {c.address && (
                          <div className="font-mono text-micro text-text-3">
                            {c.address}
                          </div>
                        )}
                        <div className="mt-0.5 font-mono text-micro text-text-mute">
                          {`[ ${c.signals.map(signalLabel).join(" · ")} ]`}
                        </div>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    data-testid="won-create-new-option"
                    role="radio"
                    aria-checked={selectedCandidateId === null}
                    onClick={() => setSelectedCandidateId(null)}
                    className={cn(
                      "w-full rounded border px-2.5 py-2 text-left font-mohave text-body-sm transition-colors",
                      selectedCandidateId === null
                        ? "border-line-hi bg-surface-active text-text"
                        : "border-border bg-surface-input text-text-2 hover:bg-surface-hover"
                    )}
                  >
                    {t("transition.createNewOption", "Create a new project")}
                  </button>
                </div>
              </motion.div>
            ) : null)}

          {/* ── other_client_projects (informational, collapsed) ── */}
          {!preflightLoading && others.length > 0 && (
            <div className="space-y-1">
              <button
                type="button"
                data-testid="won-other-projects-toggle"
                onClick={() => setOthersOpen((o) => !o)}
                className="flex items-center gap-1 font-mono text-micro uppercase tracking-[0.16em] text-text-3 transition-colors hover:text-text-2"
              >
                <ChevronRight
                  className={cn(
                    "h-3 w-3 transition-transform",
                    othersOpen && "rotate-90"
                  )}
                  aria-hidden="true"
                />
                <span className="tabular-nums text-text-2">
                  {others.length}
                </span>
                {t(
                  "transition.clientHasOthers",
                  "other projects for this client"
                )}
              </button>
              <AnimatePresence initial={false}>
                {othersOpen && (
                  <motion.ul
                    key="others"
                    {...reveal}
                    data-testid="won-other-projects-list"
                    className="space-y-1 pl-4"
                  >
                    {others.map((p) => (
                      <li key={p.projectId} className="font-mono text-micro">
                        <span className="text-text">{p.title}</span>
                        {p.address && (
                          <span className="text-text-3"> · {p.address}</span>
                        )}
                      </li>
                    ))}
                  </motion.ul>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* auto-convert note — only on the create path (not when linking) */}
          {!inaccessibleLinkedRecovery && !selectedCandidateId && (
            <p className="font-mono text-micro leading-snug text-text-mute">
              {`[ ${t("transition.autoConvertNote", "Created and linked automatically when you mark this won.")} ]`}
            </p>
          )}
        </div>
      )}

      <DialogFooter>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          data-testid="won-cancel"
        >
          {t("transition.cancel", "Cancel")}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleConfirm}
          disabled={!!preflightLoading}
          data-testid="won-confirm-cta"
        >
          {ctaLabel}
        </Button>
      </DialogFooter>
    </>
  );
}

// ---------------------------------------------------------------------------
// Lost Dialog Content (unchanged behavior)
// ---------------------------------------------------------------------------
function LostContent({
  opportunity,
  onConfirm,
  onCancel,
}: {
  opportunity: Opportunity;
  onConfirm: (data: { lostReason?: string; lostNotes?: string }) => void;
  onCancel: () => void;
}) {
  const { t } = useDictionary("pipeline");
  const [lostReason, setLostReason] = useState("");
  const [lostNotes, setLostNotes] = useState("");

  const handleConfirm = () => {
    onConfirm({
      lostReason: lostReason || undefined,
      lostNotes: lostNotes.trim() || undefined,
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <XCircle className="h-[18px] w-[18px] text-ops-error" />
          {t("transition.lostTitle")}
        </DialogTitle>
        <DialogDescription>
          {t("transition.lostDescription")} {opportunity.title}{" "}
          {t("transition.lostDescriptionSuffix")}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2 py-2">
        {/* Loss reason */}
        <div className="space-y-0.5">
          <label className={LABEL_CLASS}>{t("transition.reason")}</label>
          <select
            data-testid="lost-reason-select"
            value={lostReason}
            onChange={(e) => setLostReason(e.target.value)}
            className={cn(
              "w-full bg-surface-input font-mohave text-body text-text",
              "rounded border border-border px-1.5 py-1.5",
              "focus:border-[rgba(255,255,255,0.20)] focus:outline-none",
              "cursor-pointer",
              !lostReason && "text-text-3"
            )}
          >
            <option value="">{t("transition.selectReason")}</option>
            {LOSS_REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {reason}
              </option>
            ))}
          </select>
        </div>

        {/* Notes */}
        <div className="space-y-0.5">
          <label className={LABEL_CLASS}>{t("transition.notes")}</label>
          <textarea
            value={lostNotes}
            onChange={(e) => setLostNotes(e.target.value)}
            placeholder={t("transition.notesPlaceholder")}
            rows={3}
            className={cn(
              "w-full bg-surface-input font-mohave text-body-sm text-text",
              "resize-none rounded border border-border px-1.5 py-1.5",
              "placeholder:text-text-3",
              "focus:border-[rgba(255,255,255,0.20)] focus:outline-none"
            )}
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t("transition.cancel")}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={!lostReason}
          onClick={handleConfirm}
          data-testid="lost-confirm-cta"
        >
          {t("transition.markLost")}
        </Button>
      </DialogFooter>
    </>
  );
}

// ---------------------------------------------------------------------------
// Stage Transition Dialog
// ---------------------------------------------------------------------------
export function StageTransitionDialog({
  type,
  opportunity,
  preflight,
  preflightLoading,
  onConfirm,
  onCancel,
  onAddressChange,
}: StageTransitionDialogProps) {
  if (!opportunity) return null;

  return (
    <Dialog open={type !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        {type === "won" && (
          <WonContent
            opportunity={opportunity}
            preflight={preflight}
            preflightLoading={preflightLoading}
            onConfirm={onConfirm}
            onCancel={onCancel}
            onAddressChange={onAddressChange}
          />
        )}
        {type === "lost" && (
          <LostContent
            opportunity={opportunity}
            onConfirm={onConfirm}
            onCancel={onCancel}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
