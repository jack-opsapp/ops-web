"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ConnectStep } from "./wizard-steps/connect-step";
import { AnalyzeStep } from "./wizard-steps/analyze-step";
import { ConfirmSourcesStep } from "./wizard-steps/confirm-sources-step";
import { ReviewImportStep } from "./wizard-steps/review-import-step";
import { ActivateStep } from "./wizard-steps/activate-step";
import type { AnalysisResult, AnalyzedLead, ImportPayload, ImportResult } from "@/lib/types/email-import";
import type { DetectedSource } from "@/lib/api/services/pattern-detection-service";

const EASE = [0.22, 1, 0.36, 1] as const;

const stepVariants = {
  enter: (dir: number) => ({
    x: dir > 0 ? 80 : -80,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
    transition: { duration: 0.4, ease: EASE },
  },
  exit: (dir: number) => ({
    x: dir > 0 ? -80 : 80,
    opacity: 0,
    transition: { duration: 0.25, ease: EASE },
  }),
};

const STEPS = [
  { num: 1, label: "CONNECT" },
  { num: 2, label: "ANALYZE" },
  { num: 3, label: "SOURCES" },
  { num: 4, label: "REVIEW" },
  { num: 5, label: "ACTIVATE" },
];

interface ImportPipelineWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId?: string;
  companyId: string;
  onComplete?: () => void;
}

export function ImportPipelineWizard({
  open,
  onOpenChange,
  connectionId: initialConnectionId,
  companyId,
  onComplete,
}: ImportPipelineWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(
    initialConnectionId ? 2 : 1
  );
  const [direction, setDirection] = useState<1 | -1>(1);
  const [connectionId, setConnectionId] = useState<string | null>(
    initialConnectionId || null
  );
  const [provider, setProvider] = useState<"gmail" | "microsoft365" | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult["result"] | null>(null);
  const [confirmedSources, setConfirmedSources] = useState<DetectedSource[]>([]);
  const [confirmedLeads, setConfirmedLeads] = useState<AnalyzedLead[]>([]);
  const [estimatePattern, setEstimatePattern] = useState<string>("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [syncInterval, setSyncInterval] = useState(60);
  const [existingJobId, setExistingJobId] = useState<string | null>(null);
  const wizardStateCheckedRef = useRef(false);

  // Auto-advance to Step 2 when connectionId prop arrives after OAuth redirect
  // Use a ref to avoid re-running on every step/connectionId change
  const autoAdvancedRef = useRef(false);
  useEffect(() => {
    if (autoAdvancedRef.current) return;
    if (initialConnectionId && !connectionId) {
      autoAdvancedRef.current = true;
      setConnectionId(initialConnectionId);
      if (step === 1) {
        setDirection(1);
        setStep(2);
      }
    }
  }, [initialConnectionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Restore wizard state on open ──────────────────────────────────────────
  // When the wizard opens with a connectionId, check the connection's sync_filters
  // to determine if we should reconnect to a running/completed analysis
  useEffect(() => {
    if (!open || !initialConnectionId || wizardStateCheckedRef.current) return;
    wizardStateCheckedRef.current = true;

    const checkWizardState = async () => {
      try {
        const res = await fetch(`/api/integrations/email/connection?id=${initialConnectionId}`);
        if (!res.ok) return;
        const conn = await res.json();
        const filters = conn.syncFilters || {};

        // Wizard already completed — nothing to restore
        if (filters.wizardCompleted) return;

        // There's a scan job we can check on
        if (filters.lastScanJobId) {
          const jobRes = await fetch(`/api/integrations/email/analyze-status?jobId=${filters.lastScanJobId}`);
          if (!jobRes.ok) return;
          const jobData = await jobRes.json();

          if (jobData.status === "complete" && jobData.result) {
            // Analysis done — skip straight to Step 3 with results
            setAnalysisResult(jobData.result);
            setConfirmedSources(jobData.result.detectedSources);
            setConfirmedLeads(jobData.result.leads);
            if (jobData.result.estimatePattern) {
              setEstimatePattern(jobData.result.estimatePattern);
            }
            setDirection(1);
            setStep(3);
          } else if (jobData.status === "error") {
            // Error — go to Step 2, which will restart (duplicate prevention returns new job)
            setDirection(1);
            setStep(2);
          } else if (
            ["pending", "analyzing_sent", "detecting_platforms", "classifying_ai", "analyzing_threads"].includes(jobData.status)
          ) {
            // Still running — reconnect to it via existingJobId
            setExistingJobId(filters.lastScanJobId);
            setDirection(1);
            setStep(2);
          }
        }
      } catch (err) {
        console.error("[wizard] Failed to check wizard state:", err);
      }
    };

    checkWizardState();
  }, [open, initialConnectionId]);

  // Reset the wizard state check flag when the wizard closes so it re-checks on next open
  useEffect(() => {
    if (!open) {
      wizardStateCheckedRef.current = false;
      autoAdvancedRef.current = false;
      // Don't clear existingJobId here — it gets cleared naturally when a new job starts
    }
  }, [open]);

  const goTo = useCallback((target: 1 | 2 | 3 | 4 | 5) => {
    setDirection(target > step ? 1 : -1);
    setStep(target);
  }, [step]);

  const handleConnected = useCallback(
    (newConnectionId: string, newProvider: "gmail" | "microsoft365") => {
      setConnectionId(newConnectionId);
      setProvider(newProvider);
      goTo(2);
    },
    [goTo]
  );

  const handleAnalysisComplete = useCallback(
    (result: AnalysisResult["result"]) => {
      setAnalysisResult(result);
      if (result) {
        setConfirmedSources(result.detectedSources);
        setConfirmedLeads(result.leads);
        if (result.estimatePattern) {
          setEstimatePattern(result.estimatePattern);
        }
      }
      // Clear existing job ID since analysis is done
      setExistingJobId(null);
      goTo(3);
    },
    [goTo]
  );

  const handleImport = useCallback(async () => {
    if (!connectionId || !analysisResult) return;

    setImporting(true);
    try {
      const enabledLeads = confirmedLeads.filter((l) => l.enabled);

      const payload: ImportPayload = {
        connectionId,
        companyId,
        leads: enabledLeads.map((lead) => ({
          id: lead.id,
          threadId: lead.threadId,
          clientName: lead.client.name,
          clientEmail: lead.client.email,
          clientPhone: lead.client.phone,
          description: lead.client.description,
          stage: lead.stage,
          estimatedValue: lead.estimatedValue,
          existingClientId: lead.matchResult.existingClientId,
          action: lead.matchResult.action as "create_new" | "link" | "create_subclient",
          mergeWithLeadId: lead.duplicateGroupId,
        })),
        syncProfile: {
          estimateSubjectPatterns: estimatePattern ? [estimatePattern] : [],
          companyDomains: analysisResult.companyDomains,
          teamForwarders: analysisResult.teamForwarders,
          knownPlatformSenders: confirmedSources
            .filter((s) => s.type === "platform" && s.enabled)
            .map((s) => s.pattern),
          formSubjectPatterns: [],
          userEmailAddresses: [],
          aiClassificationThreshold: 0.7,
        },
      };

      const res = await fetch("/api/integrations/email/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: "Import failed" }));
        throw new Error(errorData.error || `Import failed (${res.status})`);
      }

      const result: ImportResult = await res.json();
      setImportResult(result);
      goTo(5);
    } catch (err) {
      console.error("Import failed:", err);
      // Surface the error to the user via the toast library
      const { toast } = await import("sonner");
      toast.error(err instanceof Error ? err.message : "Import failed. Please try again.");
    } finally {
      setImporting(false);
    }
  }, [connectionId, companyId, confirmedLeads, confirmedSources, analysisResult, estimatePattern, goTo]);

  const handleActivate = useCallback(
    async (interval: number) => {
      if (!connectionId || !analysisResult) return;

      setSyncInterval(interval);
      const activationPayload = {
        connectionId,
        companyId,
        syncIntervalMinutes: interval,
        syncProfile: {
          estimateSubjectPatterns: estimatePattern ? [estimatePattern] : [],
          companyDomains: analysisResult.companyDomains,
          teamForwarders: analysisResult.teamForwarders,
          knownPlatformSenders: confirmedSources
            .filter((s) => s.type === "platform" && s.enabled)
            .map((s) => s.pattern),
          formSubjectPatterns: [],
          userEmailAddresses: [],
          aiClassificationThreshold: 0.7,
        },
      };

      const res = await fetch("/api/integrations/email/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(activationPayload),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: "Activation failed" }));
        throw new Error(errorData.error || `Activation failed (${res.status})`);
      }
    },
    [connectionId, companyId, analysisResult, confirmedSources, estimatePattern]
  );

  const handleComplete = useCallback(() => {
    onOpenChange(false);
    onComplete?.();
  }, [onOpenChange, onComplete]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[680px] p-0 border border-white/10 bg-[#0D0D0D] overflow-hidden"
        style={{ borderRadius: 4 }}
        hideClose
      >
        <DialogTitle className="sr-only">Import Your Pipeline</DialogTitle>
        <DialogDescription className="sr-only">
          Connect your email, analyze patterns, and import your pipeline
        </DialogDescription>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-white/10">
          <div>
            <h2 className="font-mohave text-lg font-semibold text-white">
              Import Your Pipeline
            </h2>
            <p className="font-kosugi text-[10px] tracking-[0.15em] uppercase text-[#999]">
              Step {step} of 5
            </p>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="p-1.5 text-[#999] hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="flex gap-1.5 px-6 pt-3">
          {STEPS.map((s) => (
            <div key={s.num} className="flex-1 flex flex-col gap-1">
              <div
                className="h-[2px] transition-all duration-500"
                style={{
                  background:
                    s.num <= step
                      ? "#597794"
                      : "rgba(255,255,255,0.08)",
                  transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
                }}
              />
              <span
                className="font-kosugi text-[8px] tracking-[0.12em] uppercase transition-colors duration-300"
                style={{
                  color: s.num <= step ? "#597794" : "#666",
                }}
              >
                {s.label}
              </span>
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="px-6 pb-2 pt-4 min-h-[400px] overflow-y-auto">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
            >
              {step === 1 && (
                <ConnectStep
                  companyId={companyId}
                  onConnected={handleConnected}
                />
              )}
              {step === 2 && connectionId && (
                <AnalyzeStep
                  connectionId={connectionId}
                  companyId={companyId}
                  existingJobId={existingJobId || undefined}
                  onComplete={handleAnalysisComplete}
                />
              )}
              {step === 3 && analysisResult && (
                <ConfirmSourcesStep
                  analysisResult={analysisResult}
                  confirmedSources={confirmedSources}
                  onSourcesChanged={setConfirmedSources}
                  estimatePattern={estimatePattern}
                  onEstimatePatternChanged={setEstimatePattern}
                  onNext={() => goTo(4)}
                />
              )}
              {step === 4 && (
                <ReviewImportStep
                  leads={confirmedLeads}
                  onLeadsChanged={setConfirmedLeads}
                  onImport={handleImport}
                  importing={importing}
                />
              )}
              {step === 5 && importResult && (
                <ActivateStep
                  connectionId={connectionId!}
                  companyId={companyId}
                  syncProfile={{
                    estimateSubjectPatterns: estimatePattern ? [estimatePattern] : [],
                    companyDomains: analysisResult?.companyDomains || [],
                    teamForwarders: analysisResult?.teamForwarders || [],
                    knownPlatformSenders: confirmedSources
                      .filter((s) => s.type === "platform" && s.enabled)
                      .map((s) => s.pattern),
                    formSubjectPatterns: [],
                    userEmailAddresses: [],
                    aiClassificationThreshold: 0.7,
                  }}
                  importResult={importResult}
                  onActivate={handleActivate}
                  onComplete={handleComplete}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Back button footer */}
        {step > 1 && (
          <div className="flex items-center justify-between px-6 pb-4">
            <button
              onClick={() => goTo((step - 1) as 1 | 2 | 3 | 4 | 5)}
              className="font-mohave text-[13px] text-[#666] hover:text-white transition-colors"
            >
              &larr; Back
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
