"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, CheckCircle, Loader2, FileText } from "lucide-react";
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
import { ConfirmImportStep } from "./wizard-steps/confirm-import-step";
import { ImportProgress } from "./wizard-steps/import-progress";
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
  { num: 4, label: "IMPORT" },
  { num: 5, label: "ACTIVATE" },
];

type JobType = "analysis" | "import";

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
  const [confirmed, setConfirmed] = useState(false);
  const [importStarting, setImportStarting] = useState(false);
  const [syncInterval, setSyncInterval] = useState(60);
  const [existingJobId, setExistingJobId] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);

  // ─── State restoration ──────────────────────────────────────────────────────
  const [stateCheckComplete, setStateCheckComplete] = useState(!initialConnectionId);
  const wizardStateCheckedRef = useRef(false);

  // ─── Running job tracking ───────────────────────────────────────────────────
  // Tracks either analysis or import jobs — both use gmail_scan_jobs and same poll pattern
  const [runningJobId, setRunningJobId] = useState<string | null>(null);
  const [runningJobType, setRunningJobType] = useState<JobType | null>(null);

  // ─── Import job tracking ───────────────────────────────────────────────────
  // When the user clicks "Import" in step 4, this is set to the background job ID.
  // Step 4 then renders ImportProgress instead of ReviewImportStep.
  const [importJobId, setImportJobId] = useState<string | null>(null);
  const [importLeadCount, setImportLeadCount] = useState(0);

  // ─── Background progress (for minimized card) ──────────────────────────────
  const [bgProgress, setBgProgress] = useState({ percent: 0, message: "Working..." });
  const [bgDiscoveredNames, setBgDiscoveredNames] = useState<string[]>([]);
  const [bgVisibleName, setBgVisibleName] = useState<string | null>(null);
  const bgNameIndexRef = useRef(0);
  const bgPollRef = useRef<NodeJS.Timeout | null>(null);

  // ─── Notification system ───────────────────────────────────────────────────
  const { showPrompt, removePrompt } = useActionPromptStore();
  const showPromptRef = useRef(showPrompt);
  showPromptRef.current = showPrompt;
  const removePromptRef = useRef(removePrompt);
  removePromptRef.current = removePrompt;

  // ─── Cycle discovered names on minimized card ──────────────────────────────
  useEffect(() => {
    if (!minimized || bgDiscoveredNames.length === 0) return;
    const cycle = () => {
      const idx = bgNameIndexRef.current % bgDiscoveredNames.length;
      setBgVisibleName(bgDiscoveredNames[idx]);
      bgNameIndexRef.current++;
    };
    cycle();
    const interval = setInterval(cycle, 2500);
    return () => clearInterval(interval);
  }, [minimized, bgDiscoveredNames]);

  // ─── Query invalidation ────────────────────────────────────────────────────
  const queryClient = useQueryClient();
  const { company } = useAuthStore();

  const invalidateConnections = useCallback(() => {
    if (company?.id) {
      queryClient.invalidateQueries({ queryKey: queryKeys.gmailConnections.all });
    }
  }, [company?.id, queryClient]);

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
  useEffect(() => {
    if (!open || !initialConnectionId || wizardStateCheckedRef.current) return;
    wizardStateCheckedRef.current = true;

    // If we already know the running job, skip the async check
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

        // ── Check for import job first (higher wizard step) ──────────────
        if (filters.lastImportJobId) {
          const jobRes = await fetch(`/api/integrations/email/analyze-status?jobId=${filters.lastImportJobId}`);
          if (jobRes.ok) {
            const jobData = await jobRes.json();

            if (jobData.status === "import_complete" && jobData.result) {
              // Import done — advance to step 5
              setImportResult(jobData.result);
              // We also need analysis result for the activate step's sync profile
              if (filters.lastScanJobId) {
                const scanRes = await fetch(`/api/integrations/email/analyze-status?jobId=${filters.lastScanJobId}`);
                if (scanRes.ok) {
                  const scanData = await scanRes.json();
                  if (scanData.result) {
                    setAnalysisResult(scanData.result);
                    setConfirmedSources(scanData.result.detectedSources);
                    if (scanData.result.estimatePattern) setEstimatePattern(scanData.result.estimatePattern);
                  }
                }
              }
              setDirection(1);
              setStep(5);
              return;
            } else if (jobData.status === "importing") {
              // Import still running — reconnect
              setImportJobId(filters.lastImportJobId);
              setImportLeadCount(jobData.progress?.totalLeads || 0);
              setRunningJobId(filters.lastImportJobId);
              setRunningJobType("import");
              if (jobData.progress) {
                setBgProgress({ percent: jobData.progress.percent || 0, message: jobData.progress.message || "Importing..." });
              }
              // Load analysis result for later steps
              if (filters.lastScanJobId) {
                const scanRes = await fetch(`/api/integrations/email/analyze-status?jobId=${filters.lastScanJobId}`);
                if (scanRes.ok) {
                  const scanData = await scanRes.json();
                  if (scanData.result) {
                    setAnalysisResult(scanData.result);
                    setConfirmedSources(scanData.result.detectedSources);
                    setConfirmedLeads(scanData.result.leads);
                    if (scanData.result.estimatePattern) setEstimatePattern(scanData.result.estimatePattern);
                  }
                }
              }
              setDirection(1);
              setStep(4);
              return;
            }
            // import_error: fall through to check scan job
          }
        }

        // ── Check for scan/analysis job ──────────────────────────────────
        if (filters.lastScanJobId) {
          const jobRes = await fetch(`/api/integrations/email/analyze-status?jobId=${filters.lastScanJobId}`);
          if (!jobRes.ok) return;
          const jobData = await jobRes.json();

          if (jobData.status === "complete" && jobData.result) {
            setAnalysisResult(jobData.result);
            setConfirmedSources(jobData.result.detectedSources);
            setConfirmedLeads(jobData.result.leads);
            if (jobData.result.estimatePattern) setEstimatePattern(jobData.result.estimatePattern);
            setRunningJobId(null);
            setDirection(1);
            setStep(3);
          } else if (jobData.status === "error") {
            setRunningJobId(null);
            setDirection(1);
            setStep(2);
          } else if (
            ["pending", "analyzing_sent", "detecting_platforms", "classifying_ai", "analyzing_threads", "building_leads"].includes(jobData.status)
          ) {
            setExistingJobId(filters.lastScanJobId);
            setRunningJobId(filters.lastScanJobId);
            setRunningJobType("analysis");
            if (jobData.progress) {
              setBgProgress({ percent: jobData.progress.percent || 0, message: jobData.progress.message || "Analyzing..." });
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

  // Reset state check when the wizard closes
  useEffect(() => {
    if (!open) {
      wizardStateCheckedRef.current = false;
      autoAdvancedRef.current = false;
      if (initialConnectionId) setStateCheckComplete(false);
    }
  }, [open, initialConnectionId]);

  // ─── Background polling (minimized state) ─────────────────────────────────
  // Polls the running job (analysis OR import) for progress + completion.
  useEffect(() => {
    if (!minimized || !runningJobId) return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/integrations/email/analyze-status?jobId=${runningJobId}`);
        if (!res.ok) { bgPollRef.current = setTimeout(poll, 5000); return; }
        const data = await res.json();

        if (data.progress) {
          setBgProgress({ percent: data.progress.percent || 0, message: data.progress.message || "Working..." });
          if (data.progress.discoveredLeadNames?.length) {
            setBgDiscoveredNames(data.progress.discoveredLeadNames);
          }
        }

        // ── Analysis completed while minimized ─────────────────────────
        if (data.status === "complete" && data.result && runningJobType === "analysis") {
          setAnalysisResult(data.result);
          setConfirmedSources(data.result.detectedSources);
          setConfirmedLeads(data.result.leads);
          if (data.result.estimatePattern) setEstimatePattern(data.result.estimatePattern);
          setRunningJobId(null);
          setRunningJobType(null);
          setExistingJobId(null);
          setBgProgress({ percent: 100, message: "Analysis complete!" });
          invalidateConnections();

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
          return;
        }

        // ── Import completed while minimized ───────────────────────────
        if (data.status === "import_complete" && data.result && runningJobType === "import") {
          setImportResult(data.result);
          setImportJobId(null);
          setRunningJobId(null);
          setRunningJobType(null);
          setBgProgress({ percent: 100, message: "Import complete!" });
          invalidateConnections();

          showPromptRef.current({
            id: "email-import-complete",
            icon: FileText,
            title: "Pipeline import complete",
            description: `Created ${data.result.clientsCreated} clients and ${data.result.leadsCreated} leads`,
            ctaLabel: "Activate Sync",
            ctaAction: () => {
              removePromptRef.current("email-import-complete");
              setMinimized(false);
              setDirection(1);
              setStep(5);
              onOpenChange(true);
            },
            persistent: false,
            dismissable: true,
            variant: "accent",
          });
          return;
        }

        // ── Error states ───────────────────────────────────────────────
        if (data.status === "error" || data.status === "import_error") {
          setBgProgress({ percent: 0, message: data.error || "Failed" });
          setRunningJobId(null);
          setRunningJobType(null);
          return;
        }

        bgPollRef.current = setTimeout(poll, 3000);
      } catch {
        bgPollRef.current = setTimeout(poll, 5000);
      }
    };

    poll();
    return () => { if (bgPollRef.current) clearTimeout(bgPollRef.current); };
  }, [minimized, runningJobId, runningJobType]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Navigation ───────────────────────────────────────────────────────────

  const goTo = useCallback((target: 1 | 2 | 3 | 4 | 5) => {
    setDirection(target > step ? 1 : -1);
    setStep(target);
  }, [step]);

  // ─── Analysis handlers ────────────────────────────────────────────────────

  const handleJobStarted = useCallback((jobId: string) => {
    setRunningJobId(jobId);
    setRunningJobType("analysis");
    invalidateConnections();
  }, [invalidateConnections]);

  const handleProgressUpdate = useCallback((percent: number, message: string) => {
    setBgProgress({ percent, message });
  }, []);

  const handleAnalysisComplete = useCallback(
    (result: AnalysisResult["result"]) => {
      setAnalysisResult(result);
      if (result) {
        setConfirmedSources(result.detectedSources);
        setConfirmedLeads(result.leads);
        if (result.estimatePattern) setEstimatePattern(result.estimatePattern);
      }
      setExistingJobId(null);
      setRunningJobId(null);
      setRunningJobType(null);
      invalidateConnections();
      goTo(3);
    },
    [goTo, invalidateConnections]
  );

  // ─── Import handlers ─────────────────────────────────────────────────────

  const handleImport = useCallback(async () => {
    if (!connectionId || !analysisResult || importStarting) return;

    setImportStarting(true);
    const enabledLeads = confirmedLeads.filter((l) => l.enabled);
    setImportLeadCount(enabledLeads.length);

    try {
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
          correspondenceCount: lead.correspondenceCount,
          outboundCount: lead.outboundCount,
          lastMessageDate: lead.lastMessageDate || null,
          existingClientId: lead.matchResult.existingClientId,
          action: lead.matchResult.action as "create_new" | "link" | "create_subclient",
          mergeWithLeadId: lead.duplicateGroupId,
          subContacts: lead.subContacts || [],
        })),
        syncProfile: {
          estimateSubjectPatterns: estimatePattern ? [estimatePattern] : [],
          companyDomains: analysisResult.companyDomains,
          teamForwarders: analysisResult.teamForwarders,
          knownPlatformSenders: confirmedSources
            .filter((s) => s.type === "platform" && s.enabled)
            .map((s) => s.pattern),
          formSubjectPatterns: confirmedSources
            .filter((s) => s.type === "estimate_pattern" && s.enabled)
            .map((s) => s.pattern),
          userEmailAddresses: analysisResult?.teamForwarders || [],
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

      const { jobId } = await res.json();
      setImportJobId(jobId);
      setRunningJobId(jobId);
      setRunningJobType("import");
      setBgProgress({ percent: 0, message: `Starting import of ${enabledLeads.length} leads...` });
      invalidateConnections();
    } catch (err) {
      console.error("Import failed:", err);
      setImportStarting(false);
      const { toast } = await import("sonner");
      toast.error(err instanceof Error ? err.message : "Import failed. Please try again.");
    }
  }, [connectionId, companyId, confirmedLeads, confirmedSources, analysisResult, estimatePattern, importStarting, invalidateConnections]);

  const handleImportComplete = useCallback((result: ImportResult) => {
    setImportResult(result);
    setImportJobId(null);
    setRunningJobId(null);
    setRunningJobType(null);
    invalidateConnections();
    goTo(5);
  }, [goTo, invalidateConnections]);

  // ─── Activate & complete ─────────────────────────────────────────────────

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
          formSubjectPatterns: confirmedSources
            .filter((s) => s.type === "estimate_pattern" && s.enabled)
            .map((s) => s.pattern),
          userEmailAddresses: analysisResult?.teamForwarders || [],
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
    invalidateConnections();
    onComplete?.();
  }, [onOpenChange, onComplete, invalidateConnections]);

  // ─── Minimized card state ─────────────────────────────────────────────────
  const bgComplete = runningJobId === null && bgProgress.percent >= 100;
  const isImportPhase = runningJobType === "import" || importJobId;
  const minimizedLabel = isImportPhase ? "Importing leads..." : "Analyzing your inbox...";
  const minimizedCompleteLabel = isImportPhase
    ? `Import complete — ${importResult?.leadsCreated ?? 0} leads created`
    : `Analysis complete — ${analysisResult?.leads?.length ?? 0} leads found`;

  return (
    <>
    {/* Minimized bar — shows at bottom of screen when wizard is minimized */}
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
          setMinimized(false);
          onOpenChange(true);
        }}
      >
        {bgComplete ? (
          <>
            <CheckCircle size={16} className="text-[#9DB582] shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="font-mohave text-[13px] text-[#9DB582]">
                {minimizedCompleteLabel}
              </span>
            </div>
            <span className="font-mohave text-[12px] text-ops-accent shrink-0">
              Review
            </span>
          </>
        ) : (
          <>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Loader2 size={14} className="text-ops-accent animate-spin shrink-0" />
                <span className="font-mohave text-[13px] text-white">
                  {minimizedLabel}
                </span>
                <span className="font-mohave text-[11px] text-[#666] ml-auto shrink-0">
                  {Math.round(bgProgress.percent)}%
                </span>
              </div>
              {bgVisibleName && runningJobType === "analysis" && (
                <AnimatePresence mode="wait">
                  <motion.p
                    key={bgVisibleName}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 0.5 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3, ease: EASE }}
                    className="font-mohave text-[11px] text-[#597794] mb-1 truncate"
                  >
                    Found: {bgVisibleName}
                  </motion.p>
                </AnimatePresence>
              )}
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

    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen && runningJobId) {
        // Job is running — minimize instead of closing
        setMinimized(true);
        onOpenChange(false);
        return;
      }
      if (!isOpen) {
        // Always invalidate connections on close so the integrations tab reflects current state
        invalidateConnections();
      }
      onOpenChange(isOpen);
    }}>
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
            onClick={() => {
              if (runningJobId) {
                // Job is running — minimize instead of closing
                setMinimized(true);
                onOpenChange(false);
              } else {
                onOpenChange(false);
              }
            }}
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
                  background: s.num <= step ? "#597794" : "rgba(255,255,255,0.08)",
                  transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
                }}
              />
              <span
                className="font-kosugi text-[8px] tracking-[0.12em] uppercase transition-colors duration-300"
                style={{ color: s.num <= step ? "#597794" : "#666" }}
              >
                {s.label}
              </span>
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="px-6 pb-2 pt-4 min-h-[400px] max-h-[calc(85vh-140px)] overflow-y-auto">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={`${step}-${importJobId ? "importing" : confirmed ? "confirm" : "review"}`}
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
            >
              {step === 1 && (
                <ConnectStep
                  companyId={companyId}
                />
              )}
              {step === 2 && connectionId && (
                !stateCheckComplete ? (
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
                  onNext={() => {
                    // Filter leads based on enabled sources before entering step 4.
                    // Map DetectedSource.type → AnalyzedLead.source naming:
                    //   estimate_pattern → pattern, platform → platform,
                    //   forwarder → forwarder, ai_detected → ai
                    const sourceTypeToLeadSource: Record<string, string> = {
                      estimate_pattern: "pattern",
                      platform: "platform",
                      forwarder: "forwarder",
                      ai_detected: "ai",
                    };
                    const enabledLeadSources = new Set(
                      confirmedSources
                        .filter((s) => s.enabled)
                        .map((s) => sourceTypeToLeadSource[s.type] || s.type)
                    );
                    // Disable leads whose source was toggled off (preserve them for re-enable on back)
                    const filtered = (analysisResult.leads || []).map((lead) => ({
                      ...lead,
                      enabled: enabledLeadSources.has(lead.source) ? lead.enabled : false,
                    }));
                    setConfirmedLeads(filtered);
                    goTo(4);
                  }}
                />
              )}
              {step === 4 && (
                importJobId ? (
                  // Import is running as a background job — show progress
                  <ImportProgress
                    jobId={importJobId}
                    totalLeads={importLeadCount}
                    onComplete={handleImportComplete}
                    onMinimize={() => { setMinimized(true); onOpenChange(false); }}
                    onProgressUpdate={handleProgressUpdate}
                  />
                ) : confirmed ? (
                  // Confirm mode — duplicate detection + summary before import
                  <ConfirmImportStep
                    leads={confirmedLeads}
                    companyId={companyId}
                    onBack={() => setConfirmed(false)}
                    onImport={handleImport}
                    importing={importStarting}
                  />
                ) : (
                  // Review mode — user toggles leads, edits names
                  <ReviewImportStep
                    leads={confirmedLeads}
                    onLeadsChanged={setConfirmedLeads}
                    onConfirm={() => setConfirmed(true)}
                  />
                )
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
                    formSubjectPatterns: confirmedSources
            .filter((s) => s.type === "estimate_pattern" && s.enabled)
            .map((s) => s.pattern),
                    userEmailAddresses: analysisResult?.teamForwarders || [],
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

        {/* Back button footer — hide during background jobs, confirm step (has its own back), and on steps 2/3 */}
        {step > 3 && !importJobId && !runningJobId && !confirmed && step !== 4 && (
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
