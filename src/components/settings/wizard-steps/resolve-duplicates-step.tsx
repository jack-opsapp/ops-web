"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2,
  AlertTriangle,
  Merge,
  UserPlus,
  Copy,
  Trash2,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import type { AnalyzedLead } from "@/lib/types/email-import";

const EASE = [0.22, 1, 0.36, 1] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeadMatch {
  existingClientId: string | null;
  existingClientName: string | null;
  existingClientEmail: string | null;
  hasOpenOpp: boolean;
  openOppStage: string | null;
  matchSource: "email" | "subclient" | "pre-matched" | null;
}

interface VerifyResult {
  matches: Record<string, LeadMatch>;
  summary: {
    newClients: number;
    existingLinks: number;
    newLeads: number;
    existingOpps: number;
    subContacts: number;
    total: number;
  };
}

interface Resolution {
  action: "merge" | "create_subclient" | "create_new" | "discard" | "discard_existing";
  mergeMode?: "fill_blanks" | "overwrite";
}

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead",
  qualifying: "Qualifying",
  quoting: "Quoting",
  quoted: "Quoted",
  follow_up: "Follow Up",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function ActionButton({
  label,
  icon: Icon,
  onClick,
  variant = "default",
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  variant?: "default" | "muted" | "danger";
}) {
  const styles = {
    default:
      "bg-[rgba(89,119,148,0.12)] border-[rgba(89,119,148,0.25)] text-[#597794] hover:bg-[rgba(89,119,148,0.2)]",
    muted:
      "bg-transparent border-[rgba(255,255,255,0.08)] text-[#666] hover:text-[#999] hover:border-[rgba(255,255,255,0.15)]",
    danger:
      "bg-[rgba(147,50,26,0.08)] border-[rgba(147,50,26,0.2)] text-[#93321A] hover:bg-[rgba(147,50,26,0.15)]",
  };
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 font-kosugi text-[10px] tracking-[0.1em] uppercase px-3 py-1.5 border transition-colors",
        styles[variant]
      )}
      style={{ borderRadius: 2 }}
    >
      <Icon className="w-[12px] h-[12px]" />
      {label}
    </button>
  );
}

function BatchButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="font-mohave text-[11px] text-[#666] hover:text-[#999] underline underline-offset-2 decoration-[rgba(255,255,255,0.1)] hover:decoration-[rgba(255,255,255,0.3)] transition-colors"
    >
      {label}
    </button>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface ResolveDuplicatesStepProps {
  leads: AnalyzedLead[];
  companyId: string;
  onBack: () => void;
  onImport: (resolvedLeads?: AnalyzedLead[]) => Promise<void>;
  onLeadsChanged: (leads: AnalyzedLead[]) => void;
  importing: boolean;
}

export function ResolveDuplicatesStep({
  leads,
  companyId,
  onBack,
  onImport,
  onLeadsChanged,
  importing,
}: ResolveDuplicatesStepProps) {
  // ─── Verification state ─────────────────────────────────────────────────
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ─── Resolution state ───────────────────────────────────────────────────
  const [currentIndex, setCurrentIndex] = useState(0);
  const [resolutions, setResolutions] = useState<Map<string, Resolution>>(new Map());
  const [mergeMode, setMergeMode] = useState<"fill_blanks" | "overwrite">("fill_blanks");
  const [showDiscardExistingConfirm, setShowDiscardExistingConfirm] = useState(false);
  const [allResolved, setAllResolved] = useState(false);

  const enabledLeads = useMemo(() => leads.filter((l) => l.enabled), [leads]);

  // ─── Verify leads on mount ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function verify() {
      try {
        const res = await fetch("/api/integrations/email/verify-leads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId,
            leads: enabledLeads.map((l) => ({
              id: l.id,
              clientEmail: l.client.email,
              clientName: l.client.name,
              existingClientId: l.matchResult.existingClientId,
            })),
          }),
        });
        if (!res.ok) throw new Error("Verification failed");
        const data = await res.json();
        if (cancelled) return;
        setVerifyResult(data);

        // If no matches, skip resolution entirely
        const hasMatches = Object.values(
          data.matches as Record<string, LeadMatch>
        ).some((m) => m.existingClientId);
        if (!hasMatches) setAllResolved(true);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Verification failed");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    verify();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  // ─── Derived data ───────────────────────────────────────────────────────
  const matchedLeads = useMemo(
    () =>
      enabledLeads.filter(
        (l) => verifyResult?.matches[l.id]?.existingClientId
      ),
    [enabledLeads, verifyResult]
  );

  const currentLead = matchedLeads[currentIndex];
  const currentMatch = currentLead
    ? verifyResult?.matches[currentLead.id]
    : null;

  // ─── Resolution actions ─────────────────────────────────────────────────
  const resolve = useCallback(
    (leadId: string, resolution: Resolution) => {
      setResolutions((prev) => new Map(prev).set(leadId, resolution));
      // Reset merge mode to safe default for next card
      setMergeMode("fill_blanks");
      if (currentIndex < matchedLeads.length - 1) {
        setCurrentIndex((i) => i + 1);
      } else {
        setAllResolved(true);
      }
    },
    [currentIndex, matchedLeads.length]
  );

  const resolveAllRemaining = useCallback(
    (resolution: Resolution) => {
      setResolutions((prev) => {
        const next = new Map(prev);
        matchedLeads.forEach((lead, i) => {
          if (i >= currentIndex) {
            next.set(lead.id, resolution);
          }
        });
        return next;
      });
      setAllResolved(true);
    },
    [matchedLeads, currentIndex]
  );

  // ─── Summary counts ────────────────────────────────────────────────────
  const resolutionCounts = useMemo(() => {
    const counts = { merge: 0, create_subclient: 0, create_new: 0, discard: 0, discard_existing: 0 };
    resolutions.forEach((r) => { counts[r.action]++; });
    return counts;
  }, [resolutions]);

  const discardCount = resolutionCounts.discard;
  const totalToImport = enabledLeads.length - discardCount;

  // ─── Import handler ─────────────────────────────────────────────────────
  const handleImport = useCallback(async () => {
    // Apply resolutions to leads and pass directly to onImport
    const updatedLeads = leads.map((lead) => {
      const resolution = resolutions.get(lead.id);
      if (!resolution) return lead;
      return {
        ...lead,
        matchResult: {
          ...lead.matchResult,
          action: resolution.action,
        },
        mergeMode: resolution.mergeMode,
      };
    });
    // Update parent state for UI consistency
    onLeadsChanged(updatedLeads);
    // Pass resolved leads directly — avoids closure/state race condition
    await onImport(updatedLeads);
  }, [leads, resolutions, onLeadsChanged, onImport]);

  // ─── Loading state ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Loader2 className="w-5 h-5 text-[#597794] animate-spin" />
        <p className="font-mohave text-[13px] text-[#999]">
          Checking for existing clients...
        </p>
      </div>
    );
  }

  // ─── Error state ────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <AlertTriangle className="w-5 h-5 text-[#C4A868]" />
        <p className="font-mohave text-[13px] text-[#999]">{error}</p>
        <Button variant="ghost" onClick={onBack}>
          Go Back
        </Button>
      </div>
    );
  }

  // ─── All resolved / no matches → import summary ────────────────────────
  if (allResolved) {
    return (
      <div className="flex flex-col" style={{ maxHeight: "calc(85vh - 180px)" }}>
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
          <div className="space-y-4 pb-20">
            <p className="font-mohave text-[15px] text-[#999]">
              {totalToImport} lead{totalToImport !== 1 ? "s" : ""} ready to import
            </p>

            {/* Resolution summary */}
            {matchedLeads.length > 0 && (
              <div className="space-y-1.5">
                <p className="font-kosugi text-[8px] tracking-[0.15em] uppercase text-[#666]">
                  Duplicate resolution summary
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {resolutionCounts.merge > 0 && (
                    <SummaryCard
                      count={resolutionCounts.merge}
                      label="Merging into existing"
                      color="#597794"
                    />
                  )}
                  {resolutionCounts.create_subclient > 0 && (
                    <SummaryCard
                      count={resolutionCounts.create_subclient}
                      label="Adding as sub-contacts"
                      color="#597794"
                    />
                  )}
                  {resolutionCounts.create_new > 0 && (
                    <SummaryCard
                      count={resolutionCounts.create_new}
                      label="Keeping both (new client)"
                      color="#999"
                    />
                  )}
                  {resolutionCounts.discard > 0 && (
                    <SummaryCard
                      count={resolutionCounts.discard}
                      label="Discarding new leads"
                      color="#93321A"
                    />
                  )}
                  {resolutionCounts.discard_existing > 0 && (
                    <SummaryCard
                      count={resolutionCounts.discard_existing}
                      label="Replacing existing clients"
                      color="#C4A868"
                    />
                  )}
                </div>
              </div>
            )}

            {/* Non-matched leads summary */}
            {enabledLeads.length - matchedLeads.length > 0 && (
              <p className="font-mohave text-[12px] text-[#666]">
                + {enabledLeads.length - matchedLeads.length} new lead
                {enabledLeads.length - matchedLeads.length !== 1 ? "s" : ""} with no existing match
              </p>
            )}
          </div>

          {/* Sticky import bar */}
          <div
            className="sticky bottom-0 -mx-6 px-6 py-3 flex items-center justify-between border-t border-white/8"
            style={{
              background: "rgba(13, 13, 13, 0.92)",
              backdropFilter: "blur(20px) saturate(1.2)",
              WebkitBackdropFilter: "blur(20px) saturate(1.2)",
              zIndex: 10,
            }}
          >
            <Button variant="ghost" onClick={onBack} disabled={importing}>
              Back
            </Button>
            <Button
              onClick={handleImport}
              loading={importing}
              disabled={totalToImport === 0}
              className="font-kosugi text-[11px] tracking-[0.1em] uppercase bg-[#597794] hover:bg-[#6A88A5] text-white px-6 py-2"
              style={{ borderRadius: 3 }}
            >
              Import {totalToImport} Lead{totalToImport !== 1 ? "s" : ""}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Card-by-card resolution ────────────────────────────────────────────
  return (
    <div className="flex flex-col" style={{ maxHeight: "calc(85vh - 180px)" }}>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
        <div className="pb-20">
          {/* Header */}
          <div className="flex items-center justify-between mb-1">
            <p className="font-kosugi text-[9px] tracking-[0.15em] uppercase text-[#999]">
              Resolve Duplicates
            </p>
            <p className="font-mohave text-[12px] text-[#666]">
              Match {currentIndex + 1} of {matchedLeads.length}
            </p>
          </div>

          {/* Progress dots */}
          <div className="flex gap-1 mb-5">
            {matchedLeads.map((_, i) => (
              <div
                key={i}
                className="h-[3px] flex-1 transition-all duration-300"
                style={{
                  borderRadius: 1,
                  background:
                    i <= currentIndex
                      ? "#597794"
                      : "rgba(255,255,255,0.1)",
                  opacity: i === currentIndex ? 1 : i < currentIndex ? 0.5 : 0.3,
                }}
              />
            ))}
          </div>

          {/* Side-by-side comparison */}
          <AnimatePresence mode="wait">
            {currentLead && currentMatch && (
              <motion.div
                key={currentLead.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2, ease: EASE }}
              >
                <div className="grid grid-cols-2 gap-3 mb-4">
                  {/* Importing card */}
                  <div
                    className="p-3 border border-[rgba(89,119,148,0.3)] bg-[rgba(89,119,148,0.04)]"
                    style={{ borderRadius: 2 }}
                  >
                    <p className="font-kosugi text-[8px] tracking-[0.15em] uppercase text-[#597794] mb-2">
                      Importing
                    </p>
                    <p className="font-mohave text-[15px] text-text-primary">
                      {currentLead.client.name}
                    </p>
                    <p className="font-mohave text-[12px] text-[#999]">
                      {currentLead.client.email}
                    </p>
                    {currentLead.client.phone && (
                      <p className="font-mohave text-[12px] text-[#999]">
                        {currentLead.client.phone}
                      </p>
                    )}
                    <p className="font-mohave text-[11px] text-[#666] mt-1">
                      {currentLead.correspondenceCount} email
                      {currentLead.correspondenceCount !== 1 ? "s" : ""} &middot;{" "}
                      {STAGE_LABELS[currentLead.stage] || currentLead.stage}
                    </p>
                  </div>

                  {/* Existing card */}
                  <div
                    className="p-3 border border-[rgba(255,255,255,0.12)] bg-[#111]"
                    style={{ borderRadius: 2 }}
                  >
                    <p className="font-kosugi text-[8px] tracking-[0.15em] uppercase text-[#999] mb-2">
                      In Database
                    </p>
                    <p className="font-mohave text-[15px] text-text-primary">
                      {currentMatch.existingClientName || "\u2014"}
                    </p>
                    <p className="font-mohave text-[12px] text-[#999]">
                      {currentMatch.existingClientEmail || currentLead.client.email}
                    </p>
                    {currentMatch.matchSource && (
                      <p className="font-mohave text-[10px] text-[#666] mt-1">
                        Matched by {currentMatch.matchSource === "email" ? "email" : currentMatch.matchSource === "subclient" ? "sub-contact" : "prior analysis"}
                      </p>
                    )}
                    {currentMatch.hasOpenOpp && (
                      <p className="font-mohave text-[11px] text-[#C4A868] mt-1">
                        Has open opportunity
                        {currentMatch.openOppStage
                          ? ` (${STAGE_LABELS[currentMatch.openOppStage] || currentMatch.openOppStage})`
                          : ""}
                      </p>
                    )}
                  </div>
                </div>

                {/* Merge mode toggle */}
                <div className="flex items-center gap-3 mb-4">
                  <span className="font-kosugi text-[8px] tracking-[0.15em] uppercase text-[#666]">
                    Merge mode
                  </span>
                  <button
                    onClick={() => setMergeMode("fill_blanks")}
                    className="font-mohave text-[12px] px-2 py-[3px] transition-colors"
                    style={{
                      borderRadius: 2,
                      background:
                        mergeMode === "fill_blanks"
                          ? "rgba(89,119,148,0.15)"
                          : "transparent",
                      color: mergeMode === "fill_blanks" ? "#597794" : "#666",
                      border: `1px solid ${
                        mergeMode === "fill_blanks"
                          ? "rgba(89,119,148,0.3)"
                          : "rgba(255,255,255,0.08)"
                      }`,
                    }}
                  >
                    Fill blanks only
                  </button>
                  <button
                    onClick={() => setMergeMode("overwrite")}
                    className="font-mohave text-[12px] px-2 py-[3px] transition-colors"
                    style={{
                      borderRadius: 2,
                      background:
                        mergeMode === "overwrite"
                          ? "rgba(89,119,148,0.15)"
                          : "transparent",
                      color: mergeMode === "overwrite" ? "#597794" : "#666",
                      border: `1px solid ${
                        mergeMode === "overwrite"
                          ? "rgba(89,119,148,0.3)"
                          : "rgba(255,255,255,0.08)"
                      }`,
                    }}
                  >
                    Overwrite existing
                  </button>
                </div>

                {/* Action buttons */}
                <div className="flex flex-wrap gap-2 mb-4">
                  <ActionButton
                    label="Merge"
                    icon={Merge}
                    onClick={() =>
                      resolve(currentLead.id, {
                        action: "merge",
                        mergeMode,
                      })
                    }
                  />
                  <ActionButton
                    label="Sub-contact"
                    icon={UserPlus}
                    onClick={() =>
                      resolve(currentLead.id, { action: "create_subclient" })
                    }
                  />
                  <ActionButton
                    label="Keep Both"
                    icon={Copy}
                    onClick={() =>
                      resolve(currentLead.id, { action: "create_new" })
                    }
                  />
                  <ActionButton
                    label="Discard New"
                    icon={Trash2}
                    onClick={() =>
                      resolve(currentLead.id, { action: "discard" })
                    }
                    variant="muted"
                  />
                  <ActionButton
                    label="Discard Existing"
                    icon={Trash2}
                    onClick={() => setShowDiscardExistingConfirm(true)}
                    variant="danger"
                  />
                </div>

                {/* Batch actions */}
                <div className="border-t border-white/5 pt-3">
                  <p className="font-kosugi text-[8px] tracking-[0.15em] uppercase text-[#666] mb-2">
                    Apply to all {matchedLeads.length - currentIndex} remaining
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <BatchButton
                      label="Merge All"
                      onClick={() =>
                        resolveAllRemaining({ action: "merge", mergeMode })
                      }
                    />
                    <BatchButton
                      label="Sub-contact All"
                      onClick={() =>
                        resolveAllRemaining({ action: "create_subclient" })
                      }
                    />
                    <BatchButton
                      label="Discard All New"
                      onClick={() =>
                        resolveAllRemaining({ action: "discard" })
                      }
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Sticky bottom with Back button */}
        <div
          className="sticky bottom-0 -mx-6 px-6 py-3 flex items-center justify-between border-t border-white/8"
          style={{
            background: "rgba(13, 13, 13, 0.92)",
            backdropFilter: "blur(20px) saturate(1.2)",
            WebkitBackdropFilter: "blur(20px) saturate(1.2)",
            zIndex: 10,
          }}
        >
          <Button variant="ghost" onClick={onBack}>
            Back
          </Button>
          <p className="font-mohave text-[12px] text-[#666]">
            {resolutions.size} of {matchedLeads.length} resolved
          </p>
        </div>
      </div>

      {/* Discard Existing confirmation dialog */}
      {showDiscardExistingConfirm && currentMatch && currentLead && (
        <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/60">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.15, ease: EASE }}
            className="bg-[#0D0D0D] border border-[rgba(255,255,255,0.12)] p-4 max-w-sm"
            style={{ borderRadius: 3 }}
          >
            <p className="font-mohave text-[15px] text-text-primary mb-1">
              Soft-delete existing client?
            </p>
            <p className="font-mohave text-[12px] text-[#999] mb-4">
              &ldquo;{currentMatch.existingClientName}&rdquo; will be
              soft-deleted (recoverable). The imported lead will create a new
              client record.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setShowDiscardExistingConfirm(false)}
              >
                Cancel
              </Button>
              <Button
                className="bg-[#93321A] hover:bg-[#A83D20] text-white"
                onClick={() => {
                  resolve(currentLead.id, { action: "discard_existing" });
                  setShowDiscardExistingConfirm(false);
                }}
              >
                Delete Existing
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

// ─── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({
  count,
  label,
  color,
}: {
  count: number;
  label: string;
  color: string;
}) {
  return (
    <div
      className="p-2 border"
      style={{
        borderRadius: 2,
        borderColor: `${color}30`,
        background: `${color}08`,
      }}
    >
      <p className="font-mohave text-[20px]" style={{ color }}>
        {count}
      </p>
      <p className="font-mohave text-[11px] text-[#999]">{label}</p>
    </div>
  );
}
