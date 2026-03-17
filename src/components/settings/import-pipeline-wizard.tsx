"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, CheckCircle, Loader2 } from "lucide-react";
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
import { useActionPromptStore } from "@/stores/action-prompt-store";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/query-client";
import { useAuthStore } from "@/lib/store/auth-store";
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
  const [minimized, setMinimized] = useState(false);

  // ─── State restoration ──────────────────────────────────────────────────────
  // Track whether the async state check has completed. This prevents AnalyzeStep
  // from mounting (and re-starting analysis) before we know if there's a running job.
  const [stateCheckComplete, setStateCheckComplete] = useState(!initialConnectionId);
  const wizardStateCheckedRef = useRef(false);

  // ─── Running job tracking ───────────────────────────────────────────────────
  // The parent tracks the jobId so minimize→reopen doesn't need an async lookup.
  // AnalyzeStep reports it via onJobStarted, background polling uses it directly.
  const [runningJobId, setRunningJobId] = useState<string | null>(null);

  // ─── Background progress (for minimized card) ──────────────────────────────
  const [bgProgress, setBgProgress] = useState({ percent: 0, message: "Analyzing..." });
  const bgPollRef = useRef<NodeJS.Timeout | null>(null);

  // ─── Notification system ───────────────────────────────────────────────────
  const { showPrompt, removePrompt } = useActionPromptStore();
  const showPromptRef = useRef(showPrompt);
  showPromptRef.current = showPrompt;
  const removePromptRef = useRef(removePrompt);
  removePromptRef.current = removePrompt;

  // ─── Query invalidation ────────────────────────────────────────────────────
  const queryClient = useQueryClient();
  const { company } = useAuthStore();

  // When the wizard opens, un-minimize
  useEffect(() => {
    if (open) setMinimized(false);
  }, [open]);

  // Auto-advance to Step 2 when connectionId prop arrives after OAuth redirect
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
  // to determine if we should reconnect to a running/completed analysis.
  // Setting stateCheckComplete=false blocks AnalyzeStep rendering until this finishes.
  useEffect(() => {
    if (!open || !initialConnectionId || wizardStateCheckedRef.current) return;
    wizardStateCheckedRef.current = true;

    // If we already know the running job (from a previous AnalyzeStep session),
    // skip the async check entirely — we can render immediately.
    if (runningJobId) {
      setExistingJobId(runningJobId);
      setStateCheckComplete(true);
      return;
    }

    setStateCheckComplete(false);

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
            setRunningJobId(null);
            setDirection(1);
            setStep(3);
          } else if (jobData.status === "error") {
            // Error — go to Step 2, which will restart
            setRunningJobId(null);
            setDirection(1);
            setStep(2);
          } else if (
            ["pending", "analyzing_sent", "detecting_platforms", "classifying_ai", "analyzing_threads"].includes(jobData.status)
          ) {
            // Still running — reconnect
            setExistingJobId(filters.lastScanJobId);
            setRunningJobId(filters.lastScanJobId);
            if (jobData.progress) {
              setBgProgress({
                percent: jobData.progress.percent || 0,
                message: jobData.progress.message || "Analyzing...",
              });
            }
            setDirection(1);
            setStep(2);
          }
        }
      } catch (err) {
        console.error("[wizard] Failed to check wizard state:", err);
      } finally {
        setStateCheckComplete(true);
      }
    };

    checkWizardState();
  }, [open, initialConnectionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset state check when the wizard closes so it re-checks on next open
  useEffect(() => {
    if (!open) {
      wizardStateCheckedRef.current = false;
      autoAdvancedRef.current = false;
      // Reset stateCheckComplete only if there's a connection to check
      if (initialConnectionId) {
        setStateCheckComplete(false);
      }
    }
  }, [open, initialConnectionId]);

  // ─── Background polling (minimized state) ─────────────────────────────────
  // When minimized, poll the running job for progress + completion.
  // On completion: fire action prompt, set results, advance to step 3.
  useEffect(() => {
    if (!minimized || !runningJobId) return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/integrations/email/analyze-status?jobId=${runningJobId}`);
        if (!res.ok) {
          bgPollRef.current = setTimeout(poll, 5000);
          return;
        }
        const data = await res.json();

        if (data.progress) {
          setBgProgress({
            percent: data.progress.percent || 0,
            message: data.progress.message || "Analyzing...",
          });
        }

        if (data.status === "complete" && data.result) {
          // Analysis finished while minimized — store results
          setAnalysisResult(data.result);
          setConfirmedSources(data.result.detectedSources);
          setConfirmedLeads(data.result.leads);
          if (data.result.estimatePattern) {
            setEstimatePattern(data.result.estimatePattern);
          }
          setRunningJobId(null);
          setExistingJobId(null);
          setBgProgress({ percent: 100, message: "Analysis complete!" });

          // Invalidate connections query so integrations tab updates
          if (company?.id) {
            queryClient.invalidateQueries({
              queryKey: queryKeys.gmailConnections.all,
            });
          }

          // Fire action prompt to notify the user
          showPromptRef.current({
            id: "email-analysis-complete",
            icon: CheckCircle,
            title: "Pipeline analysis complete",
            description: `Found ${data.result.leads?.length ?? 0} leads from ${data.result.totalScanned ?? 0} emails`,
            ctaLabel: "Review Leads",
            ctaAction: () => {
              removePromptRef.current("email-analysis-complete");
              setMinimized(false);
              setDirection(1);
              setStep(3);
              onOpenChange(true);
            },
            persistent: false,
            dismissable: true,
            variant: "accent",
          });

          return; // Stop polling
        }

        if (data.status === "error") {
          setBgProgress({ percent: 0, message: data.error || "Analysis failed" });
          setRunningJobId(null);
          return; // Stop polling
        }

        bgPollRef.current = setTimeout(poll, 3000);
      } catch {
        bgPollRef.current = setTimeout(poll, 5000);
      }
    };

    poll();
    return () => {
      if (bgPollRef.current) clearTimeout(bgPollRef.current);
    };
  }, [minimized, runningJobId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Called by AnalyzeStep when it starts/reconnects to a job
  const handleJobStarted = useCallback((jobId: string) => {
    setRunningJobId(jobId);
    // Invalidate connections so integrations tab sees the active job
    if (company?.id) {
      queryClient.invalidateQueries({
        queryKey: queryKeys.gmailConnections.all,
      });
    }
  }, [company?.id, queryClient]);

  // Called by AnalyzeStep to report progress to the parent (for minimized card)
  const handleProgressUpdate = useCallback((percent: number, message: string) => {
    setBgProgress({ percent, message });
  }, []);

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
      // Clear job IDs since analysis is done
      setExistingJobId(null);
      setRunningJobId(null);
      // Invalidate connections query so integrations tab updates
      if (company?.id) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.gmailConnections.all,
        });
      }
      goTo(3);
    },
    [goTo, company?.id, queryClient]
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

  // Determine if we completed while minimized (show "Review Leads" instead of spinner)
  const bgComplete = bgProgress.percent >= 100 && analysisResult;

  return (
    <>
    {/* Minimized bar — shows at bottom of screen when wizard is minimized during analysis */}
    {minimized && !open && (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        transition={{ duration: 0.3, ease: EASE }}
        className="fixed bottom-4 right-4 z-[100] flex items-center gap-3 px-4 py-3 border border-white/10 cursor-pointer"
        style={{
          background: 'rgba(13, 13, 13, 0.9)',
          backdropFilter: 'blur(20px) saturate(1.2)',
          WebkitBackdropFilter: 'blur(20px) saturate(1.2)',
          borderRadius: 4,
          minWidth: 280,
        }}
        onClick={() => {
          if (bgComplete) {
            // Analysis done — open wizard at step 3
            setMinimized(false);
            setDirection(1);
            setStep(3);
            onOpenChange(true);
          } else {
            setMinimized(false);
            onOpenChange(true);
          }
        }}
      >
        {bgComplete ? (
          <>
            <CheckCircle size={16} className="text-[#9DB582] shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="font-mohave text-[13px] text-[#9DB582]">
                Analysis complete — {analysisResult.leads?.length ?? 0} leads found
              </span>
            </div>
            <span className="font-mohave text-[12px] text-ops-accent shrink-0">
              Review
            </span>
          </>
        ) : (
          <>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <Loader2 size={14} className="text-ops-accent animate-spin shrink-0" />
                <span className="font-mohave text-[13px] text-white">
                  Analyzing your inbox...
                </span>
                <span className="font-mohave text-[11px] text-[#666] ml-auto shrink-0">
                  {Math.round(bgProgress.percent)}%
                </span>
              </div>
              <div className="h-[2px] w-full bg-white/5 overflow-hidden" style={{ borderRadius: 1 }}>
                <motion.div
                  className="h-full bg-[#597794]"
                  animate={{ width: `${Math.round(bgProgress.percent)}%` }}
                  transition={{ duration: 0.8, ease: EASE }}
                />
              </div>
            </div>
            <span className="font-mohave text-[12px] text-ops-accent hover:text-white transition-colors shrink-0 ml-2">
              Expand
            </span>
          </>
        )}
      </motion.div>
    )}

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
                !stateCheckComplete ? (
                  // Loading state while checking for existing job — prevents restart flicker
                  <div className="flex flex-col items-center justify-center py-16 gap-4">
                    <Loader2 size={24} className="text-ops-accent animate-spin" />
                    <p className="font-mohave text-[14px] text-[#999]">
                      Reconnecting to analysis...
                    </p>
                  </div>
                ) : (
                  <AnalyzeStep
                    connectionId={connectionId}
                    companyId={companyId}
                    existingJobId={runningJobId || existingJobId || undefined}
                    onComplete={handleAnalysisComplete}
                    onMinimize={() => { setMinimized(true); onOpenChange(false); }}
                    onJobStarted={handleJobStarted}
                    onProgressUpdate={handleProgressUpdate}
                  />
                )
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
                  companyDomains={analysisResult?.companyDomains || []}
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
    </>
  );
}
