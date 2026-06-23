"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, CheckCircle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ConnectStep } from "./wizard-steps/connect-step";
import { AnalyzeStep } from "./wizard-steps/analyze-step";
import { ConfirmSourcesStep } from "./wizard-steps/confirm-sources-step";
import { FilterFlaggedStep } from "./wizard-steps/filter-flagged-step";
import { ConsolidateContactsStep } from "./wizard-steps/consolidate-contacts-step";
import { TriageStep } from "./wizard-steps/triage-step";
import { ConfirmPipelineStep } from "./wizard-steps/confirm-pipeline-step";
import { ImportProgress } from "./wizard-steps/import-progress";
import { ActivateStep } from "./wizard-steps/activate-step";
import { StepperRail } from "./wizard-steps/stepper-rail";
import { buildConsolidationGroups } from "./wizard-steps/consolidation-utils";
import { useCreateNotification } from "@/lib/hooks/use-notifications";
import { useDashboardCustomizeStore } from "@/stores/dashboard-customize-store";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/query-client";
import { useAuthStore } from "@/lib/store/auth-store";
import { authedFetch } from "@/lib/utils/authed-fetch";
import type { AnalysisResult, AnalyzedLead, ImportPayload, ImportResult, ConsolidationGroup, TriageDecision } from "@/lib/types/email-import";
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

const STEPPER_STEPS = [
  { key: "connect", label: "CONNECT" },
  { key: "scan", label: "SCAN" },
  { key: "sources", label: "SOURCES" },
  {
    key: "review",
    label: "REVIEW",
    subSteps: [
      { key: "filter", label: "filter" },
      { key: "consolidate", label: "consolidate" },
      { key: "triage", label: "triage" },
      { key: "confirm", label: "confirm" },
    ],
  },
  { key: "activate", label: "ACTIVATE" },
];

const STEP_KEY_MAP: Record<number, string> = {
  1: "connect", 2: "scan", 3: "sources", 4: "review", 5: "activate",
};
const SUB_STEP_KEY_MAP: Record<number, string> = {
  1: "filter", 2: "consolidate", 3: "triage", 4: "confirm",
};

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
  const [importStarting, setImportStarting] = useState(false);

  // ─── Review sub-step state ────────────────────────────────────────────────
  const [reviewSubStep, setReviewSubStep] = useState<1 | 2 | 3 | 4>(1);
  const [consolidationGroups, setConsolidationGroups] = useState<ConsolidationGroup[]>([]);
  const [triageDecisions, setTriageDecisions] = useState<Map<string, TriageDecision>>(new Map());
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  // ─── Review state persistence ───────────────────────────────────────────
  // lastSaveFingerprintRef tracks the last successfully saved reviewState body
  // so auto-save can skip redundant writes. This is what prevents the class of
  // bug where a stale default-populated UI silently overwrites the user's
  // prior corrections during a close/reopen race.
  const lastSaveFingerprintRef = useRef<string | null>(null);
  // Only flipped true after restoration has finished AND produced populated
  // leads. Auto-save is gated on this so we can never write an empty or
  // unrestored state over the user's saved overrides.
  const canAutoSaveRef = useRef(false);

  const saveReviewState = useCallback(async () => {
    if (!connectionId || step !== 4) return;

    // Defense 1 — restoration must have completed AND leads must be present
    // before auto-save is allowed to write. This closes the window where a
    // stale-default UI state (from a skipped restoration) silently clobbered
    // the user's corrections via the 30s auto-save tick.
    if (!canAutoSaveRef.current) return;
    if (confirmedLeads.length === 0) return;

    const reviewState = {
      subStep: reviewSubStep,
      filteredOutIds: confirmedLeads.filter((l) => !l.enabled && l.needsReview).map((l) => l.id),
      consolidationDecisions: consolidationGroups
        .filter((g) => g.decision)
        .map((g) => ({ groupId: g.id, decision: g.decision, companyName: g.companyName })),
      triageDecisions: Array.from(triageDecisions.entries())
        .map(([leadId, decision]) => ({ leadId, decision })),
      stageOverrides: confirmedLeads
        .filter((l) => l.enabled)
        .map((l) => ({ leadId: l.id, stage: l.stage })),
      nameOverrides: confirmedLeads
        .filter((l) => l.enabled)
        .map((l) => ({ leadId: l.id, name: l.client.name })),
    };

    // Defense 2 — content-based deduplication. If nothing has meaningfully
    // changed since the last save, skip the PATCH entirely. savedAt is
    // excluded from the fingerprint because it changes on every call.
    const fingerprint = JSON.stringify(reviewState);
    if (fingerprint === lastSaveFingerprintRef.current) return;

    try {
      await fetch("/api/integrations/email/connection", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId,
          syncFilters: { reviewState: { ...reviewState, savedAt: new Date().toISOString() } },
        }),
      });
      lastSaveFingerprintRef.current = fingerprint;
    } catch (err) {
      console.error("[wizard] Failed to save review state:", err);
    }
  }, [connectionId, step, reviewSubStep, confirmedLeads, consolidationGroups, triageDecisions]);

  // ─── Import job tracking ───────────────────────────────────────────────────
  // When the user clicks "Import" in step 4, this is set to the background job ID.
  // Step 4 then renders ImportProgress instead of the review sub-steps.
  const [importJobId, setImportJobId] = useState<string | null>(null);
  const [importLeadCount, setImportLeadCount] = useState(0);

  // ─── Auto-save review state every 30s during step 4 ────────────────────
  const autoSaveRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (step !== 4 || importJobId) {
      if (autoSaveRef.current) clearInterval(autoSaveRef.current);
      return;
    }
    autoSaveRef.current = setInterval(() => {
      saveReviewState();
    }, 30_000);
    return () => { if (autoSaveRef.current) clearInterval(autoSaveRef.current); };
  }, [step, importJobId, saveReviewState]);

  // Stepper rail computed state
  const completedSteps = useMemo(() => {
    const set = new Set<string>();
    if (step > 1) set.add("connect");
    if (step > 2) set.add("scan");
    if (step > 3) set.add("sources");
    if (step > 4) set.add("review");
    return set;
  }, [step]);

  const completedSubSteps = useMemo(() => {
    const set = new Set<string>();
    if (step === 4) {
      if (reviewSubStep > 1) set.add("filter");
      if (reviewSubStep > 2) set.add("consolidate");
      if (reviewSubStep > 3) set.add("triage");
    }
    return set;
  }, [step, reviewSubStep]);
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

  // ─── Background progress (for minimized card) ──────────────────────────────
  const [bgProgress, setBgProgress] = useState({ percent: 0, message: "Working..." });
  const [bgDiscoveredNames, setBgDiscoveredNames] = useState<string[]>([]);
  const [bgVisibleName, setBgVisibleName] = useState<string | null>(null);
  const bgNameIndexRef = useRef(0);
  const bgPollRef = useRef<NodeJS.Timeout | null>(null);

  // ─── Notification system ───────────────────────────────────────────────────
  const notify = useCreateNotification();
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

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

  // Sync wizard open state to global store (hides FAB, suppresses shortcuts)
  const setWizardOpen = useDashboardCustomizeStore((s) => s.setWizardOpen);
  useEffect(() => {
    setWizardOpen(open);
    return () => setWizardOpen(false);
  }, [open, setWizardOpen]);

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

        // ── Early guard: connection is already active ────────────────────
        // Without this, a user reopening the wizard for an already-active
        // connection would fall through to step 2's AnalyzeStep, which auto-
        // starts a brand new scan. That wastes OpenAI + Gmail budget and
        // produces phantom job rows. Gate on status='active' so the wizard
        // always lands on step 5 (the activation confirmation) for set-up
        // connections, regardless of what the job IDs look like.
        if (filters.wizardCompleted && conn.status === "active") {
          let loadedImportResult: ImportResult | null = null;

          // Load existing scan/import data so step 5 renders real numbers
          // instead of zeroes. Silent on error — we still navigate to step 5.
          try {
            if (filters.lastImportJobId) {
              const jobRes = await authedFetch(`/api/integrations/email/analyze-status?jobId=${filters.lastImportJobId}`);
              if (jobRes.ok) {
                const jobData = await jobRes.json();
                if (jobData.result) {
                  setImportResult(jobData.result);
                  loadedImportResult = jobData.result;
                }
              }
            }
            if (filters.lastScanJobId) {
              const scanRes = await authedFetch(`/api/integrations/email/analyze-status?jobId=${filters.lastScanJobId}`);
              if (scanRes.ok) {
                const scanData = await scanRes.json();
                if (scanData.result) {
                  setAnalysisResult(scanData.result);
                  setConfirmedSources(scanData.result.detectedSources);
                  setConfirmedLeads(scanData.result.leads || []);
                  if (scanData.result.estimatePattern) setEstimatePattern(scanData.result.estimatePattern);
                }
              }
            }
          } catch (err) {
            console.error("[wizard] Failed to load existing scan/import data for active connection:", err);
          }

          // Fallback: synthesize an empty ImportResult so step 5 never hangs
          // on the "Loading import results..." state when job data is missing.
          if (!loadedImportResult) {
            setImportResult({
              clientsCreated: 0,
              leadsCreated: 0,
              activitiesLogged: 0,
              labelsApplied: 0,
              imagesExtracted: 0,
              errors: [],
            });
          }

          setDirection(1);
          setStep(5);
          return;
        }

        // Wizard marked complete but connection isn't active (edge case —
        // probably a deactivated or errored connection). Nothing to restore.
        if (filters.wizardCompleted) return;

        // ── Check for import job first (higher wizard step) ──────────────
        if (filters.lastImportJobId) {
          const jobRes = await authedFetch(`/api/integrations/email/analyze-status?jobId=${filters.lastImportJobId}`);
          if (jobRes.ok) {
            const jobData = await jobRes.json();

            if (jobData.status === "import_complete" && jobData.result) {
              // Import done — advance to step 5
              import("sonner").then(({ toast }) =>
                toast.success("Import completed while you were away", {
                  description: `${jobData.result.clientsCreated} clients, ${jobData.result.leadsCreated} leads created`,
                })
              );
              setImportResult(jobData.result);
              // We also need analysis result for the activate step's sync profile
              if (filters.lastScanJobId) {
                const scanRes = await authedFetch(`/api/integrations/email/analyze-status?jobId=${filters.lastScanJobId}`);
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
                const scanRes = await authedFetch(`/api/integrations/email/analyze-status?jobId=${filters.lastScanJobId}`);
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
          const jobRes = await authedFetch(`/api/integrations/email/analyze-status?jobId=${filters.lastScanJobId}`);
          if (!jobRes.ok) return;
          const jobData = await jobRes.json();

          if (jobData.status === "complete" && jobData.result) {
            notifyRef.current({
              type: "pipeline_complete",
              title: "Analysis completed while you were away",
              body: `Found ${jobData.result.leads?.length ?? 0} leads from ${jobData.result.totalScanned ?? 0} emails`,
              actionUrl: "/settings?tab=integrations",
              actionLabel: "Review Leads",
            });
            setAnalysisResult(jobData.result);
            setConfirmedSources(jobData.result.detectedSources);
            setConfirmedLeads(jobData.result.leads);
            if (jobData.result.estimatePattern) setEstimatePattern(jobData.result.estimatePattern);
            setRunningJobId(null);

            // ── Restore review state if available and fresh (<24h) ──────
            const reviewState = filters.reviewState;
            if (reviewState?.savedAt) {
              const hoursSince = (Date.now() - new Date(reviewState.savedAt).getTime()) / (1000 * 60 * 60);
              if (hoursSince < 24) {
                // Restore filter decisions
                const filteredSet = new Set(reviewState.filteredOutIds || []);
                const restoredLeads = (jobData.result.leads || []).map((l: AnalyzedLead) => ({
                  ...l,
                  enabled: filteredSet.has(l.id) ? false : l.enabled,
                }));

                // Restore name overrides
                if (reviewState.nameOverrides?.length) {
                  const nameMap = new Map(reviewState.nameOverrides.map((n: { leadId: string; name: string }) => [n.leadId, n.name]));
                  for (const lead of restoredLeads) {
                    const nameOverride = nameMap.get(lead.id);
                    if (nameOverride) lead.client = { ...lead.client, name: nameOverride };
                  }
                }

                // Restore stage overrides
                if (reviewState.stageOverrides?.length) {
                  const stageMap = new Map(reviewState.stageOverrides.map((s: { leadId: string; stage: string }) => [s.leadId, s.stage]));
                  for (const lead of restoredLeads) {
                    const stageOverride = stageMap.get(lead.id);
                    if (stageOverride) lead.stage = stageOverride;
                  }
                }

                setConfirmedLeads(restoredLeads);

                // Restore triage decisions
                if (reviewState.triageDecisions?.length) {
                  const map = new Map<string, TriageDecision>();
                  for (const { leadId, decision } of reviewState.triageDecisions) {
                    map.set(leadId, decision);
                  }
                  setTriageDecisions(map);
                }

                // Restore consolidation groups + decisions
                const enabledLeads = restoredLeads.filter((l: AnalyzedLead) => l.enabled);
                const groups = buildConsolidationGroups(enabledLeads);
                if (reviewState.consolidationDecisions?.length) {
                  const decisionMap = new Map(
                    reviewState.consolidationDecisions.map((d: { groupId: string; decision: string; companyName?: string }) => [d.groupId, d])
                  );
                  for (const group of groups) {
                    const saved = decisionMap.get(group.id) as { groupId: string; decision: string; companyName?: string } | undefined;
                    if (saved) {
                      group.decision = saved.decision as 'confirm' | 'merge';
                      if (saved.companyName) group.companyName = saved.companyName;
                    }
                  }
                  // Re-disable secondary leads for merge decisions
                  for (const group of groups) {
                    if (group.decision === "merge" && group.leads.length > 1) {
                      const secondaryIds = new Set(group.leads.slice(1).map((gl) => gl.leadId));
                      for (const lead of restoredLeads) {
                        if (secondaryIds.has(lead.id)) lead.enabled = false;
                      }
                    }
                  }
                  setConfirmedLeads([...restoredLeads]);
                }
                setConsolidationGroups(groups);

                // Seed the auto-save fingerprint with what we just restored,
                // so the first auto-save tick after restoration doesn't write
                // a byte-identical payload back to the DB.
                lastSaveFingerprintRef.current = JSON.stringify({
                  subStep: reviewState.subStep || 1,
                  filteredOutIds: Array.from(filteredSet),
                  consolidationDecisions: groups
                    .filter((g) => g.decision)
                    .map((g) => ({ groupId: g.id, decision: g.decision, companyName: g.companyName })),
                  triageDecisions: (reviewState.triageDecisions || [])
                    .map((t: { leadId: string; decision: TriageDecision }) => ({ leadId: t.leadId, decision: t.decision })),
                  stageOverrides: restoredLeads
                    .filter((l: AnalyzedLead) => l.enabled)
                    .map((l: AnalyzedLead) => ({ leadId: l.id, stage: l.stage })),
                  nameOverrides: restoredLeads
                    .filter((l: AnalyzedLead) => l.enabled)
                    .map((l: AnalyzedLead) => ({ leadId: l.id, name: l.client.name })),
                });

                setReviewSubStep(reviewState.subStep || 1);
                setDirection(1);
                setStep(4);
                return;
              }
            }

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
      canAutoSaveRef.current = false;
      lastSaveFingerprintRef.current = null;
      if (initialConnectionId) setStateCheckComplete(false);
    }
  }, [open, initialConnectionId]);

  // Defense 3 — auto-save is only allowed once the wizard is on Step 4 with
  // populated lead data AND the state-restoration check has completed. Until
  // then, any auto-save tick is a write against unreal state and risks
  // clobbering the user's saved corrections in the DB.
  useEffect(() => {
    canAutoSaveRef.current =
      step === 4 && stateCheckComplete && confirmedLeads.length > 0;
  }, [step, stateCheckComplete, confirmedLeads.length]);

  // ─── Background polling (minimized state) ─────────────────────────────────
  // Polls the running job (analysis OR import) for progress + completion.
  useEffect(() => {
    if (!minimized || !runningJobId) return;

    const poll = async () => {
      try {
        // authedFetch auto-refreshes the Firebase ID token on 401 so the
        // minimized-state polling doesn't silently drop when the token ages
        // out mid-analysis/import.
        const res = await authedFetch(`/api/integrations/email/analyze-status?jobId=${runningJobId}`);
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
          setBgProgress({ percent: 100, message: "Analysis complete" });
          invalidateConnections();

          notifyRef.current({
            type: "pipeline_complete",
            title: "Pipeline analysis complete",
            body: `Found ${data.result.leads?.length ?? 0} leads from ${data.result.totalScanned ?? 0} emails`,
            actionUrl: "/settings?tab=integrations",
            actionLabel: "Review Leads",
          });
          // Auto-reopen wizard to review step
          setMinimized(false);
          setDirection(1);
          setStep(3);
          onOpenChange(true);
          return;
        }

        // ── Import completed while minimized ───────────────────────────
        if (data.status === "import_complete" && data.result && runningJobType === "import") {
          setImportResult(data.result);
          setImportJobId(null);
          setRunningJobId(null);
          setRunningJobType(null);
          setBgProgress({ percent: 100, message: "Import complete" });
          invalidateConnections();

          notifyRef.current({
            type: "pipeline_complete",
            title: "Pipeline import complete",
            body: `Created ${data.result.clientsCreated} clients and ${data.result.leadsCreated} leads`,
            actionUrl: "/settings?tab=integrations",
            actionLabel: "Activate Sync",
          });
          // Auto-reopen wizard to activation step
          setMinimized(false);
          setDirection(1);
          setStep(5);
          onOpenChange(true);
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

    // Build lookup from consolidation groups for titles and merged company names
    const titleMap = new Map<string, string>();
    const companyNameMap = new Map<string, string>();
    for (const group of consolidationGroups) {
      if (group.leads.length > 1) {
        for (const gl of group.leads) {
          if (gl.title) titleMap.set(gl.leadId, gl.title);
          companyNameMap.set(gl.leadId, group.companyName);
        }
      }
    }

    // Reconcile triage decisions: include all leads (discarded are imported with stage=discarded for analytics)
    const importLeads = confirmedLeads.filter((lead) => {
      if (!lead.enabled) return false;
      // Include all triaged leads — discarded get stage="discarded"
      if (lead.needsReview && !triageDecisions.has(lead.id)) return false;
      return true;
    });

    setImportLeadCount(importLeads.length);

    try {
      const payload: ImportPayload = {
        connectionId,
        companyId,
        leads: importLeads.map((lead) => {
          const decision = triageDecisions.get(lead.id);
          // Resolve effective stage: triage decision overrides AI assessment
          const stage = decision === "won" ? "won"
            : decision === "lost" ? "lost"
            : decision === "discard" ? "discarded"
            : lead.stage;

          return {
            id: lead.id,
            threadId: lead.threadId,
            clientName: companyNameMap.get(lead.id) || lead.client.name,
            clientEmail: lead.client.email,
            clientPhone: lead.client.phone,
            clientAddress: lead.client.address || null,
            description: lead.client.description,
            stage,
            estimatedValue: lead.estimatedValue,
            correspondenceCount: lead.correspondenceCount,
            outboundCount: lead.outboundCount,
            lastMessageDate: lead.lastMessageDate || null,
            existingClientId: lead.matchResult.existingClientId,
            action: lead.matchResult.action as ImportPayload["leads"][number]["action"],
            mergeMode: lead.mergeMode,
            mergeWithLeadId: lead.duplicateGroupId,
            subContacts: lead.subContacts || [],
            title: titleMap.get(lead.id) || null,
            actualCloseDate: (stage === "won" || stage === "lost" || stage === "discarded") ? (lead.lastMessageDate || null) : null,
          };
        }),
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
      setImportStarting(false);
      setBgProgress({ percent: 0, message: `Starting import of ${importLeads.length} leads...` });
      invalidateConnections();
    } catch (err) {
      console.error("Import failed:", err);
      setImportStarting(false);
      const { toast } = await import("sonner");
      toast.error(err instanceof Error ? err.message : "Import failed. Please try again.");
    }
  }, [connectionId, companyId, confirmedLeads, confirmedSources, analysisResult, estimatePattern, importStarting, invalidateConnections, triageDecisions, consolidationGroups]);

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
    async (
      interval: number
    ): Promise<{ warnings?: Array<{ step: string; message: string }> }> => {
      if (!connectionId || !analysisResult) return {};

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

      // Parse the response so partial-success warnings (e.g. webhook setup
      // failure) can surface in ActivateStep instead of being swallowed.
      const data = (await res.json().catch(() => ({}))) as {
        warnings?: Array<{ step: string; message: string }>;
      };
      return { warnings: data.warnings };
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
        className="glass-dense fixed bottom-4 right-4 z-[100] flex items-center gap-3 px-4 py-3 border border-border cursor-pointer rounded-chip"
        style={{
          minWidth: 280,
        }}
        onClick={() => {
          setMinimized(false);
          onOpenChange(true);
        }}
      >
        {bgComplete ? (
          <>
            <CheckCircle size={16} className="text-olive shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="font-mohave text-[13px] text-olive">
                {minimizedCompleteLabel}
              </span>
            </div>
            <span className="font-mohave text-[12px] text-text shrink-0">
              Review
            </span>
          </>
        ) : (
          <>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Loader2 size={14} className="text-text-2 animate-spin shrink-0" />
                <span className="font-mohave text-[13px] text-text">
                  {minimizedLabel}
                </span>
                <span className="font-mohave text-[11px] text-text-3 ml-auto shrink-0">
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
                    className="font-mohave text-[11px] text-text-3 mb-1 truncate"
                  >
                    Found: {bgVisibleName}
                  </motion.p>
                </AnimatePresence>
              )}
              <div className="h-[2px] w-full bg-white/5 overflow-hidden" style={{ borderRadius: 1 }}>
                <motion.div
                  className="h-full bg-text-2"
                  animate={{ width: `${Math.round(bgProgress.percent)}%` }}
                  transition={{ duration: 0.8, ease: EASE }}
                />
              </div>
            </div>
            <span className="font-mohave text-[12px] text-text-2 hover:text-text transition-colors shrink-0 ml-2">
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
      if (!isOpen && step === 4 && !importJobId) {
        // Mid-review — show confirmation instead of closing immediately
        setShowCloseConfirm(true);
        return;
      }
      if (!isOpen) {
        // Save review decisions before closing so they can be restored
        if (step === 4) saveReviewState();
        // Always invalidate connections on close so the integrations tab reflects current state
        invalidateConnections();
      }
      onOpenChange(isOpen);
    }}>
      <DialogContent
        className="w-[90vw] max-w-[920px] p-0 border border-border bg-black overflow-hidden rounded-chip"
        hideClose
        onKeyDown={(e) => {
          // Trap ALL keyboard events inside the wizard so they don't
          // propagate to settings tabs, keyboard shortcuts, or other listeners
          e.stopPropagation();
        }}
      >
        <DialogTitle className="sr-only">Import Your Pipeline</DialogTitle>
        <DialogDescription className="sr-only">
          Connect your email, analyze patterns, and import your pipeline
        </DialogDescription>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border">
          <div>
            <h2 className="font-mohave text-lg font-semibold text-text">
              Import Your Pipeline
            </h2>
            <p className="font-mono text-micro tracking-[0.15em] uppercase text-text-3">
              {STEP_KEY_MAP[step].toUpperCase()}{step === 4 ? ` · ${SUB_STEP_KEY_MAP[reviewSubStep]}` : ""}
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
            className="p-1.5 text-text-3 hover:text-text transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Main layout: stepper rail + content — fixed height to prevent layout shifts */}
        <div className="flex overflow-hidden" style={{ height: "calc(85vh - 100px)" }}>
          {/* Stepper rail */}
          <div className="pl-5 pt-4 pb-4 flex-shrink-0">
            <StepperRail
              steps={STEPPER_STEPS}
              currentStep={STEP_KEY_MAP[step]}
              currentSubStep={step === 4 ? SUB_STEP_KEY_MAP[reviewSubStep] : undefined}
              completedSteps={completedSteps}
              completedSubSteps={completedSubSteps}
              showSubSteps={step === 4}
            />
          </div>

          {/* Step content — flex column so carousel sub-steps can fill height */}
          <div className="px-6 pb-2 pt-4 flex-1 min-w-0 flex flex-col overflow-hidden">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={`${step}-${importJobId ? "importing" : `sub${reviewSubStep}`}`}
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="flex-1 min-h-0 flex flex-col"
            >
              {step === 1 && (
                <ConnectStep
                  companyId={companyId}
                />
              )}
              {step === 2 && !connectionId && (
                <div className="flex flex-col items-center justify-center py-16 gap-4">
                  <p className="font-mohave text-[14px] text-text-3">
                    No connection found. Please go back and connect your email.
                  </p>
                  <button
                    onClick={() => goTo(1)}
                    className="font-mono text-micro tracking-[0.1em] uppercase text-text-2 hover:text-text transition-colors"
                  >
                    ← Back to Connect
                  </button>
                </div>
              )}
              {step === 2 && connectionId && (
                !stateCheckComplete ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-4">
                    <Loader2 size={24} className="text-text-2 animate-spin" />
                    <p className="font-mohave text-[14px] text-text-3">
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
                    const allKnownSources = new Set(
                      confirmedSources.map((s) => sourceTypeToLeadSource[s.type] || s.type)
                    );
                    const enabledLeadSources = new Set(
                      confirmedSources
                        .filter((s) => s.enabled)
                        .map((s) => sourceTypeToLeadSource[s.type] || s.type)
                    );
                    // Disable leads whose source was explicitly toggled off.
                    // Leads with unmapped sources (not shown in Step 3) keep their current state.
                    const filtered = (analysisResult.leads || []).map((lead) => ({
                      ...lead,
                      enabled: allKnownSources.has(lead.source)
                        ? (enabledLeadSources.has(lead.source) ? lead.enabled : false)
                        : lead.enabled,
                    }));
                    setConfirmedLeads(filtered);
                    // Determine starting sub-step: skip filter if no flagged leads
                    const hasFlagged = filtered.some((l) => l.needsReview && l.enabled);
                    if (!hasFlagged) {
                      const groups = buildConsolidationGroups(filtered.filter((l) => l.enabled));
                      setConsolidationGroups(groups);
                      setReviewSubStep(groups.length > 0 ? 2 : 3);
                    } else {
                      setReviewSubStep(1);
                    }
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
                ) : reviewSubStep === 1 ? (
                  <FilterFlaggedStep
                    leads={confirmedLeads}
                    onLeadsChanged={setConfirmedLeads}
                    onBack={() => goTo(3)}
                    onComplete={() => {
                      const groups = buildConsolidationGroups(
                        confirmedLeads.filter((l) => l.enabled)
                      );
                      setConsolidationGroups(groups);
                      setReviewSubStep(groups.length > 0 ? 2 : 3);
                    }}
                  />
                ) : reviewSubStep === 2 ? (
                  <ConsolidateContactsStep
                    leads={confirmedLeads}
                    onLeadsChanged={setConfirmedLeads}
                    consolidationGroups={consolidationGroups}
                    onGroupsChanged={setConsolidationGroups}
                    onBack={() => {
                      // Re-enable any leads that were disabled by merge decisions
                      const mergedLeadIds = new Set<string>();
                      for (const g of consolidationGroups) {
                        if (g.decision === "merge" && g.leads.length > 1) {
                          g.leads.slice(1).forEach((gl) => mergedLeadIds.add(gl.leadId));
                        }
                      }
                      if (mergedLeadIds.size > 0) {
                        setConfirmedLeads((prev) =>
                          prev.map((l) => mergedLeadIds.has(l.id) ? { ...l, enabled: true } : l)
                        );
                      }
                      // Reset consolidation decisions
                      setConsolidationGroups((prev) =>
                        prev.map((g) => ({ ...g, decision: null }))
                      );
                      // Go back to filter if flagged+enabled leads exist, otherwise to sources
                      const hasFlagged = confirmedLeads.some((l) => l.needsReview && l.enabled);
                      if (hasFlagged) {
                        setReviewSubStep(1);
                      } else {
                        goTo(3);
                      }
                    }}
                    onComplete={() => setReviewSubStep(3)}
                  />
                ) : reviewSubStep === 3 ? (
                  <TriageStep
                    leads={confirmedLeads}
                    onLeadsChanged={setConfirmedLeads}
                    triageDecisions={triageDecisions}
                    onTriageDecision={(id, decision) => {
                      setTriageDecisions((prev) => new Map(prev).set(id, decision));
                    }}
                    consolidationGroups={consolidationGroups}
                    onBack={() => {
                      // Clear triage decisions — user is revisiting
                      setTriageDecisions(new Map());
                      // Go back to consolidate if groups exist, otherwise to filter/sources
                      if (consolidationGroups.length > 0) {
                        setReviewSubStep(2);
                      } else {
                        const hasFlagged = confirmedLeads.some((l) => l.needsReview && l.enabled);
                        if (hasFlagged) {
                          setReviewSubStep(1);
                        } else {
                          goTo(3);
                        }
                      }
                    }}
                    onComplete={() => setReviewSubStep(4)}
                  />
                ) : (
                  <ConfirmPipelineStep
                    leads={confirmedLeads}
                    triageDecisions={triageDecisions}
                    consolidationGroups={consolidationGroups}
                    onStageChange={(id, stage) => {
                      setConfirmedLeads((prev) =>
                        prev.map((l) => (l.id === id ? { ...l, stage, enabled: stage !== "discarded" } : l))
                      );
                      // Update triage decision to match so getEffectiveStage doesn't override
                      const triageMap: Record<string, TriageDecision> = {
                        won: "won",
                        lost: "lost",
                        discarded: "discard",
                      };
                      const newDecision = triageMap[stage] ?? "active";
                      setTriageDecisions((prev) => new Map(prev).set(id, newDecision));
                    }}
                    onNameChange={(id, name) => {
                      setConfirmedLeads((prev) =>
                        prev.map((l) => (l.id === id ? { ...l, client: { ...l.client, name } } : l))
                      );
                    }}
                    onBack={() => setReviewSubStep(3)}
                    onImport={handleImport}
                  />
                )
              )}
              {step === 5 && !importResult && (
                <div className="flex flex-col items-center justify-center py-16 gap-4">
                  <Loader2 size={24} className="text-text-2 animate-spin" />
                  <p className="font-mohave text-[14px] text-text-3">
                    Loading import results...
                  </p>
                </div>
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

        {/* Close confirmation overlay — shown when user tries to close mid-review */}
        {showCloseConfirm && (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center"
            style={{
              background: "rgba(0, 0, 0, 0.7)",
              backdropFilter: "blur(4px)",
            }}
          >
            <div className="glass-dense p-6 border border-border max-w-[320px] rounded-chip">
              <p className="font-mohave text-[15px] text-text mb-2">
                Close wizard?
              </p>
              <p className="font-mohave text-[12px] text-text-3 mb-5">
                Your progress will be saved and can be resumed later.
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setShowCloseConfirm(false)}
                  className="flex-1"
                >
                  CONTINUE
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    setShowCloseConfirm(false);
                    saveReviewState();
                    invalidateConnections();
                    onOpenChange(false);
                  }}
                  className="flex-1"
                >
                  CLOSE & SAVE
                </Button>
              </div>
            </div>
          </div>
        )}
        </div>{/* end flex layout (stepper rail + content) */}

        {/* Back button footer — hide during background jobs and on step 4 (sub-steps have their own nav) */}
        {step > 3 && !importJobId && !runningJobId && step !== 4 && (
          <div className="flex items-center justify-between px-6 pb-4">
            <button
              onClick={() => goTo((step - 1) as 1 | 2 | 3 | 4 | 5)}
              className="font-mohave text-[13px] text-text-3 hover:text-text transition-colors"
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
