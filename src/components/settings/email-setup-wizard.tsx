"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mail,
  ArrowRight,
  ArrowLeft,
  Check,
  CheckCircle,
  ExternalLink,
  Loader2,
  Filter,
  Search,
  X,
  Inbox,
  Plus,
  ChevronDown,
  Zap,
  BarChart3,
  Users,
  Shield,
  Pencil,
} from "lucide-react";
import { FilterFunnelCanvas } from "@/components/settings/filter-funnel-canvas";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/lib/store/auth-store";
import { useGmailConnections, useGmailImport, useUpdateGmailConnection } from "@/lib/hooks";
import type { ApprovedContact } from "@/lib/hooks/use-gmail-import";
import { EmailFilterBuilder } from "@/components/settings/email-filter-builder";
import type {
  GmailSyncFilters,
  EmailFilterRule,
} from "@/lib/types/pipeline";
import { DEFAULT_SYNC_FILTERS } from "@/lib/types/pipeline";
import { toast } from "sonner";
import { useActionPromptStore } from "@/stores/action-prompt-store";

// ─── Animation ───────────────────────────────────────────────────────────────

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

const staggerContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};

const staggerItem = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE } },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Maps scan job stage to a progress percentage for the UI */
function stageToPercent(stage: string, current: number, total: number): number {
  switch (stage) {
    case "pending":
      return 3;
    case "listing":
      return 10;
    case "fetching": {
      // 15–60% range, interpolated by current/total
      if (total <= 0) return 15;
      const ratio = Math.min(current / total, 1);
      return Math.round(15 + ratio * 45);
    }
    case "pre_filtering":
      return 65;
    case "classifying":
      return 75;
    case "complete":
      return 100;
    case "error":
      return 0;
    default:
      return 0;
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface ScannedEmail {
  id: string;
  from: string;
  fromEmail: string;
  domain: string;
  subject: string;
  snippet?: string;
  labels: string[];
  date: string;
  wouldImport: boolean;
  reason?: string;
}

interface WizardStep {
  id: string;
  label: string;
  icon: typeof Mail;
}

interface ContactPreview {
  fromEmail: string;
  name: string;
  domain: string;
  emailCount: number;
  firstInquiryDate: Date;
  latestDate: Date;
  /** Most recent emails for the expanded preview (newest first) */
  recentEmails: Array<{ subject: string; snippet: string; date: string }>;
  createLead: boolean;
  excluded: boolean;
}

const STEPS: WizardStep[] = [
  { id: "connect", label: "Connect", icon: Mail },
  { id: "how-it-works", label: "How It Works", icon: Zap },
  { id: "scan", label: "Scan", icon: Search },
  { id: "filters", label: "Filters", icon: Filter },
  { id: "import", label: "Import", icon: ArrowRight },
  { id: "review", label: "Review", icon: Users },
];

// ─── Props ───────────────────────────────────────────────────────────────────

interface EmailSetupWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Start at a specific step (e.g., "filters" from the filter section) */
  initialStep?: string;
  /** Called when scan state changes — parent can show in-progress indicator */
  onScanStateChange?: (state: { scanning: boolean; progress?: { stage: string; message: string } }) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function EmailSetupWizard({
  open,
  onOpenChange,
  initialStep,
  onScanStateChange,
}: EmailSetupWizardProps) {
  const { company, currentUser } = useAuthStore();
  const companyId = company?.id ?? "";
  const { data: connections = [], isLoading: connectionsLoading } = useGmailConnections();
  const gmailImport = useGmailImport();
  const updateConnection = useUpdateGmailConnection();
  const showPrompt = useActionPromptStore((s) => s.showPrompt);
  const removePrompt = useActionPromptStore((s) => s.removePrompt);

  const hasConnection = connections.length > 0;
  const firstConnection = connections[0];

  // Wizard state
  const initialIdx = initialStep
    ? Math.max(0, STEPS.findIndex((s) => s.id === initialStep))
    : 0;
  const [stepIndex, setStepIndex] = useState(initialIdx);
  const [direction, setDirection] = useState(1);

  // Scan state
  const [scanning, setScanning] = useState(false);
  const [scannedEmails, setScannedEmails] = useState<ScannedEmail[]>([]);
  const [scanComplete, setScanComplete] = useState(false);
  const [scanJobId, setScanJobId] = useState<string | null>(null);
  const [scanSummary, setScanSummary] = useState<string | null>(null);
  const [preFilteredCount, setPreFilteredCount] = useState(0);
  const [scanProgress, setScanProgress] = useState<{
    stage: string;
    current: number;
    total: number;
    message: string;
  }>({ stage: "pending", current: 0, total: 0, message: "Starting scan..." });

  // Store AI-suggested filters separately so categories can be toggled on/off and restored
  const [aiSuggestedFilters, setAiSuggestedFilters] = useState<{
    excludeDomains: string[];
    excludeAddresses: string[];
    excludeSubjectKeywords: string[];
  } | null>(null);

  // Filter state
  const [filters, setFilters] = useState<GmailSyncFilters>(
    firstConnection?.syncFilters ?? DEFAULT_SYNC_FILTERS,
  );

  // Review state — contacts the user has excluded from creation
  const [excludedContacts, setExcludedContacts] = useState<Set<string>>(new Set());
  const [editedNames, setEditedNames] = useState<Map<string, string>>(new Map());
  const [leadOverrides, setLeadOverrides] = useState<Map<string, boolean>>(new Map());
  const [expandedContact, setExpandedContact] = useState<string | null>(null);

  // Import state
  const [importDays, setImportDays] = useState(30);
  const [customDate, setCustomDate] = useState("");
  const [importStarted, setImportStarted] = useState(false);

  // Constants for scan — declared early so reset-on-open effect can reference them
  const SCAN_PROMPT_ID = "email-scan-progress";
  const SCAN_STEP_INDEX = STEPS.findIndex((s) => s.id === "scan");

  // Update filters when connection loads (use stringified comparison to avoid object ref loops)
  const syncFiltersJson = JSON.stringify(firstConnection?.syncFilters ?? null);
  useEffect(() => {
    if (firstConnection?.syncFilters) {
      setFilters((prev) => {
        const next = JSON.stringify(firstConnection.syncFilters);
        return JSON.stringify(prev) === next ? prev : firstConnection.syncFilters;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncFiltersJson]);

  // Track open state for async callbacks (scan completion)
  const openRef = useRef(open);

  // Polling ref — declared early so reset-on-open effect can check it
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Save wizard progress on close ────────────────────────────────────
  // Persists the current step + scan data so the user can resume later.
  const saveProgressOnClose = useRef(false);

  function persistWizardProgress() {
    if (!firstConnection || !scanComplete) return;
    const currentStepId = STEPS[stepIndex]?.id ?? "scan";
    const importedIds = computeImportedIds(scannedEmails, filters);
    updateConnection.mutate({
      id: firstConnection.id,
      data: {
        id: firstConnection.id,
        syncFilters: {
          ...filters,
          wizardStep: currentStepId,
          lastScanJobId: scanJobId ?? undefined,
          lastScanSummary: scanSummary ?? undefined,
          lastScanTotal: scannedEmails.length,
          lastScanImportCount: importedIds.size,
        },
      },
    });
  }

  // ── Restore scan data from a previous scan job ─────────────────────
  const [restoringFromJob, setRestoringFromJob] = useState(false);

  async function restoreScanFromJob(jobId: string) {
    setRestoringFromJob(true);
    try {
      const resp = await fetch(`/api/integrations/gmail/scan-status?jobId=${encodeURIComponent(jobId)}`);
      if (!resp.ok) return;
      const data = await resp.json();
      if (data.status !== "complete" || !data.emails) return;

      const emails: ScannedEmail[] = data.emails;
      setScannedEmails(emails);
      setScanComplete(true);
      setPreFilteredCount(data.preFiltered ?? 0);
      setScanSummary(data.recommendedFilters?.summary ?? null);
      setScanJobId(jobId);

      // Restore AI-suggested filters
      if (data.recommendedFilters) {
        setAiSuggestedFilters({
          excludeDomains: data.recommendedFilters.excludeDomains ?? [],
          excludeAddresses: data.recommendedFilters.excludeAddresses ?? [],
          excludeSubjectKeywords: data.recommendedFilters.excludeSubjectKeywords ?? [],
        });
      }
    } catch {
      // Failed to restore — user will need to re-scan
    } finally {
      setRestoringFromJob(false);
    }
  }

  // Reset when opened — use ref to fire only on open *transition*
  const prevOpenRef = useRef(open);
  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    openRef.current = open;

    // Save progress when closing (if scan was completed but wizard not done)
    if (!open && wasOpen && scanComplete && !importStarted) {
      persistWizardProgress();
    }

    // Only reset when transitioning from closed → open
    if (open && !wasOpen) {
      // If a scan is running or just completed, go straight to scan step
      if (scanning || scanComplete) {
        setStepIndex(SCAN_STEP_INDEX);
        setDirection(1);
        // Clear any in-progress action prompt since wizard is open
        removePrompt(SCAN_PROMPT_ID);
        // Resume polling if scan is running but polling stopped (e.g. unmount/remount)
        if (scanning && scanJobId && !pollIntervalRef.current) {
          startPolling(scanJobId);
        }
        return;
      }

      // Check if there's a previous scan to restore from
      const savedStep = firstConnection?.syncFilters?.wizardStep;
      const savedJobId = firstConnection?.syncFilters?.lastScanJobId;

      if (savedJobId && !scanComplete && !initialStep) {
        // Restore scan data from previous session
        restoreScanFromJob(savedJobId);
        const resumeStep = initialStep ?? savedStep ?? "filters";
        const idx = Math.max(0, STEPS.findIndex((s) => s.id === resumeStep));
        setStepIndex(idx);
        setDirection(1);
        setImportStarted(false);
        return;
      }

      const idx = initialStep
        ? Math.max(0, STEPS.findIndex((s) => s.id === initialStep))
        : 0;
      const targetIdx = idx === 0 && hasConnection && !initialStep ? 1 : idx;
      setStepIndex(targetIdx);
      setDirection(1);
      setImportStarted(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const currentStep = STEPS[stepIndex];

  function goNext() {
    if (stepIndex < STEPS.length - 1) {
      setDirection(1);
      setStepIndex(stepIndex + 1);
    }
  }

  function goBack() {
    if (stepIndex > 0) {
      setDirection(-1);
      setStepIndex(stepIndex - 1);
    }
  }

  function goToStep(idx: number) {
    setDirection(idx > stepIndex ? 1 : -1);
    setStepIndex(idx);
  }

  // ── Scan emails (async job with polling) ──────────────────────────────────

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  // Notify parent of scan state changes
  useEffect(() => {
    onScanStateChange?.({
      scanning,
      progress: scanning ? { stage: scanProgress.stage, message: scanProgress.message } : undefined,
    });
  }, [scanning, scanProgress.stage, scanProgress.message]); // eslint-disable-line react-hooks/exhaustive-deps

  interface ScanResultData {
    emails?: ScannedEmail[];
    recommendedFilters?: {
      excludeDomains?: string[];
      excludeAddresses?: string[];
      excludeSubjectKeywords?: string[];
      usePresetBlocklist?: boolean;
      labelIds?: string[];
      summary?: string;
    };
    preFiltered?: number;
    aiAnalyzed?: number;
    aiError?: string | null;
  }

  function processScanResults(data: ScanResultData) {
    const emails: ScannedEmail[] = data.emails ?? [];
    setScannedEmails(emails);
    setPreFilteredCount(data.preFiltered ?? 0);

    // Auto-apply AI-recommended filters
    const ai = data.recommendedFilters;

    // Save AI suggestions separately for category toggle restore
    const aiDomains = ai?.excludeDomains ?? [];
    const aiAddresses = ai?.excludeAddresses ?? [];
    const aiKeywords = ai?.excludeSubjectKeywords ?? [];
    setAiSuggestedFilters({
      excludeDomains: aiDomains,
      excludeAddresses: aiAddresses,
      excludeSubjectKeywords: aiKeywords,
    });

    // Build the complete staged filter state in a single setFilters call
    setFilters((prev) => {
      const domainSet = new Set(prev.excludeDomains);
      const addressSet = new Set(prev.excludeAddresses);
      const keywordSet = new Set(prev.excludeSubjectKeywords);

      for (const d of aiDomains) domainSet.add(d);
      for (const a of aiAddresses) addressSet.add(a);
      for (const k of aiKeywords) keywordSet.add(k);

      return {
        ...prev,
        excludeDomains: Array.from(domainSet),
        excludeAddresses: Array.from(addressSet),
        excludeSubjectKeywords: Array.from(keywordSet),
        usePresetBlocklist: ai?.usePresetBlocklist ?? prev.usePresetBlocklist,
        labelIds: ai?.labelIds ?? prev.labelIds,
      };
    });

    // Compute post-filter count synchronously for the toast
    const allBlockedDomains = new Set([
      ...filters.excludeDomains,
      ...aiDomains,
    ]);
    const stagedFilterCount = emails.filter((e) =>
      allBlockedDomains.has(e.domain) || !e.wouldImport,
    ).length;

    setScanSummary(ai?.summary ?? null);
    setScanComplete(true);
    setScanning(false);

    return { emails, ai, stagedFilterCount };
  }

  function startPolling(jobId: string) {
    // Clear any existing poll
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

    // Track last-seen updatedAt to detect stale jobs
    let lastUpdatedAt: string | null = null;
    let staleSince: number | null = null;
    const STALE_TIMEOUT_MS = 90_000; // 90 seconds without progress = stale

    pollIntervalRef.current = setInterval(async () => {
      try {
        const resp = await fetch(
          `/api/integrations/gmail/scan-status?jobId=${encodeURIComponent(jobId)}`,
        );
        if (!resp.ok) return;

        const data = await resp.json();
        setScanProgress(data.progress ?? { stage: data.status, current: 0, total: 0, message: "" });

        // ── Stale job detection ──────────────────────────────────────────
        // If the job's updatedAt hasn't changed for STALE_TIMEOUT_MS while
        // still in a processing state, the background function likely crashed.
        if (data.status !== "complete" && data.status !== "error") {
          if (data.updatedAt === lastUpdatedAt) {
            if (!staleSince) staleSince = Date.now();
            if (Date.now() - staleSince > STALE_TIMEOUT_MS) {
              if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
              setScanning(false);
              setScanJobId(null);
              removePrompt(SCAN_PROMPT_ID);
              toast.error("Email scan timed out", {
                description: "The scan stopped responding. Please try again.",
              });
              return;
            }
          } else {
            // Progress is being made — reset stale tracker
            lastUpdatedAt = data.updatedAt;
            staleSince = null;
          }
        }

        if (data.status === "complete") {
          // Stop polling
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;

          const result: ScanResultData = data.result ?? {};

          if (!result.emails || result.emails.length === 0) {
            setScanning(false);
            setScanJobId(null);
            toast.info("No emails found in the last 30 days.");
            return;
          }

          const { emails, ai, stagedFilterCount } = processScanResults(result);
          const postFilterImportCount = emails.length - stagedFilterCount;
          const summary = ai?.summary ?? `${postFilterImportCount} to import, ${stagedFilterCount} filtered out.`;

          // Show AI error as warning if scan completed but AI failed
          if (result.aiError) {
            toast.warning("Email scan complete with issues", {
              description: `AI analysis failed: ${result.aiError}. Filters were not applied.`,
            });
          } else {
            toast.success("Email scan complete", { description: summary });
          }

          // If wizard is closed, show action prompt
          if (!openRef.current) {
            removePrompt(SCAN_PROMPT_ID);
            showPrompt({
              id: SCAN_PROMPT_ID,
              icon: CheckCircle,
              title: "Email scan complete",
              description: summary,
              ctaLabel: "Review Filters",
              ctaAction: () => {
                removePrompt(SCAN_PROMPT_ID);
                onOpenChange(true);
                setDirection(1);
                setStepIndex(SCAN_STEP_INDEX);
              },
              persistent: true,
              dismissable: true,
              permanentDismiss: false,
              variant: "accent",
            });
          }
        } else if (data.status === "error") {
          // Stop polling
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
          setScanning(false);
          setScanJobId(null);
          removePrompt(SCAN_PROMPT_ID);
          toast.error("Email scan failed", {
            description: data.error ?? "Something went wrong.",
          });
        }
      } catch {
        // Network error — keep polling, it may recover
      }
    }, 2000);
  }

  async function scanEmails() {
    if (!firstConnection || scanning) return;

    setScanning(true);
    setScanComplete(false);
    setScannedEmails([]);
    setScanSummary(null);
    setPreFilteredCount(0);
    setAiSuggestedFilters(null);
    setScanProgress({ stage: "pending", current: 0, total: 0, message: "Starting scan..." });

    try {
      const resp = await fetch("/api/integrations/gmail/scan-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId: firstConnection.id, days: 30 }),
      });

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => "");
        throw new Error(errBody || `Failed to start scan (${resp.status})`);
      }

      const { jobId } = await resp.json();
      setScanJobId(jobId);
      startPolling(jobId);
    } catch (err) {
      setScanning(false);
      console.error("[email-scan]", err);
      toast.error("Email scan failed", {
        description: err instanceof Error ? err.message : "Something went wrong.",
      });
    }
  }

  // ── Apply filters & import ───────────────────────────────────────────────

  async function applyFiltersAndImport() {
    if (!firstConnection || importStarted) return;

    // Immediately prevent double-clicks
    setImportStarted(true);

    // Save filters + mark wizard as completed (strip empty rules)
    const cleanedRules = (filters.rules ?? []).filter((r) => r.value.trim() !== "");
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { rules: _drop, ...filtersWithoutRules } = filters;
    const finalFilters: GmailSyncFilters = {
      ...filtersWithoutRules,
      ...(cleanedRules.length > 0 ? { rules: cleanedRules } : {}),
      wizardCompleted: true,
    };
    try {
      await updateConnection.mutateAsync({
        id: firstConnection.id,
        data: { id: firstConnection.id, syncFilters: finalFilters },
      });
    } catch {
      // Non-fatal — filters may not persist but import can proceed
      toast.warning("Filters may not have saved — import will proceed with defaults.");
    }

    // Compute approved contacts for client/lead creation
    // Filter scanned emails by the selected import time range
    const importCutoff = customDate
      ? new Date(customDate)
      : (() => { const d = new Date(); d.setDate(d.getDate() - importDays); return d; })();
    const importedIds = computeImportedIds(scannedEmails, filters);
    const importedEmails = scannedEmails.filter((e) => {
      if (!importedIds.has(e.id)) return false;
      const emailDate = new Date(e.date);
      return !isNaN(emailDate.getTime()) && emailDate >= importCutoff;
    });
    const contactMap = new Map<string, { name: string; emails: ScannedEmail[] }>();
    for (const email of importedEmails) {
      if (!email.fromEmail || excludedContacts.has(email.fromEmail)) continue;
      const existing = contactMap.get(email.fromEmail);
      if (existing) {
        existing.emails.push(email);
      } else {
        // Use edited name if user changed it, otherwise extract from header
        let name = editedNames.get(email.fromEmail) ?? "";
        if (!name) {
          const fromHeader = email.from ?? "";
          name = fromHeader.replace(/<.*>/, "").trim().replace(/^"(.*)"$/, "$1");
          if (!name || name === email.fromEmail) {
            const prefix = email.fromEmail.split("@")[0] ?? email.fromEmail;
            name = prefix.replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
          }
        }
        contactMap.set(email.fromEmail, { name, emails: [email] });
      }
    }

    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    const approvedContacts: ApprovedContact[] = Array.from(
      contactMap.entries()
    ).map(([fromEmail, { name, emails: contactEmails }]) => {
      // Use lead override if user toggled, otherwise auto-determine
      const override = leadOverrides.get(fromEmail);
      let createLead: boolean;
      if (override !== undefined) {
        createLead = override;
      } else {
        const dates = contactEmails
          .map((e) => new Date(e.date))
          .filter((d) => !isNaN(d.getTime()));
        const earliest =
          dates.length > 0
            ? new Date(Math.min(...dates.map((d) => d.getTime())))
            : new Date();
        createLead = earliest >= twoWeeksAgo;
      }
      return { fromEmail, name, createLead };
    });

    // Start import
    const importAfter = customDate || (() => {
      const d = new Date();
      d.setDate(d.getDate() - importDays);
      return d.toISOString().split("T")[0];
    })();

    gmailImport.startImport.mutate(
      { companyId, connectionId: firstConnection.id, importAfter, approvedContacts },
      {
        onSuccess: () => {
          toast.success("Import started");
          onOpenChange(false);
        },
        onError: (err) => {
          toast.error("Failed to start import", { description: err.message });
          setImportStarted(false);
        },
      },
    );
  }

  // ── Skip wizard ────────────────────────────────────────────────────────

  async function skipWizard() {
    if (!firstConnection) {
      onOpenChange(false);
      return;
    }

    // Mark wizard as completed with current (default) filters
    try {
      await updateConnection.mutateAsync({
        id: firstConnection.id,
        data: {
          id: firstConnection.id,
          syncFilters: { ...filters, wizardCompleted: true },
        },
      });
    } catch {
      // Non-fatal
    }

    toast.info("Wizard skipped — you can configure filters anytime from Settings");
    onOpenChange(false);
  }

  // ── Can proceed? ─────────────────────────────────────────────────────────

  function canProceed(): boolean {
    switch (currentStep.id) {
      case "connect":
        return hasConnection;
      case "how-it-works":
        return true;
      case "scan":
        return scanComplete;
      case "filters":
        return true;
      case "import":
        return true;
      case "review":
        return !importStarted;
      default:
        return true;
    }
  }

  // ── Handle close — show progress prompt if scan is running ──────────────

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && scanning) {
      // User is closing wizard during active scan — show progress prompt
      removePrompt(SCAN_PROMPT_ID);
      showPrompt({
        id: SCAN_PROMPT_ID,
        icon: Search,
        title: "Scan in progress",
        description: "AI is still analyzing your emails. We\u2019ll notify you when it\u2019s done.",
        ctaLabel: "Open Wizard",
        ctaAction: () => {
          removePrompt(SCAN_PROMPT_ID);
          onOpenChange(true);
        },
        persistent: true,
        dismissable: true,
        permanentDismiss: false,
        variant: "accent",
      });
    }
    onOpenChange(nextOpen);
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={`${(currentStep.id === "filters" && scannedEmails.length > 0) || currentStep.id === "review" ? "max-w-[900px]" : "max-w-[720px]"} max-h-[90vh] p-0 overflow-hidden transition-[max-width] duration-300`}
        hideClose
      >
        {/* ── Header with step indicator ─────────────────────────────── */}
        <div className="px-3 pt-3 pb-0">
          <div className="flex items-center justify-between mb-2">
            <div>
              <DialogTitle className="font-mohave text-heading text-text-primary text-left">
                Email Setup
              </DialogTitle>
              <DialogDescription className="font-mohave text-body-sm text-text-secondary text-left">
                Connect, configure, and import your email pipeline
              </DialogDescription>
            </div>
            <button
              onClick={() => onOpenChange(false)}
              aria-label="Close"
              className="p-[6px] rounded-sm text-text-tertiary hover:text-text-primary transition-colors"
            >
              <X className="w-[18px] h-[18px]" />
            </button>
          </div>

          {/* Step progress bar */}
          <div className="flex items-center gap-0 mb-2">
            {STEPS.map((step, i) => {
              const isActive = i === stepIndex;
              const isComplete = i < stepIndex;
              const StepIcon = step.icon;

              return (
                <button
                  key={step.id}
                  onClick={() => {
                    // Only allow going back, or forward if step is accessible
                    if (i <= stepIndex || (i === stepIndex + 1 && canProceed())) {
                      goToStep(i);
                    }
                  }}
                  className="flex-1 group relative"
                  disabled={i > stepIndex + 1}
                >
                  {/* Progress line */}
                  <div className="h-[2px] w-full mb-[8px]">
                    <div
                      className={`h-full transition-all duration-500 ease-out ${
                        isComplete
                          ? "bg-ops-accent"
                          : isActive
                            ? "bg-ops-accent/50"
                            : "bg-border-subtle"
                      }`}
                    />
                  </div>

                  {/* Step label */}
                  <div className="flex items-center gap-[4px] px-[4px]">
                    <div
                      className={`w-[20px] h-[20px] rounded-sm flex items-center justify-center transition-all duration-300 ${
                        isComplete
                          ? "bg-ops-accent/20 text-ops-accent"
                          : isActive
                            ? "bg-ops-accent/10 text-ops-accent"
                            : "bg-transparent text-text-disabled"
                      }`}
                    >
                      {isComplete ? (
                        <Check className="w-[12px] h-[12px]" />
                      ) : (
                        <StepIcon className="w-[12px] h-[12px]" />
                      )}
                    </div>
                    <span
                      className={`font-kosugi text-[10px] uppercase tracking-wider hidden sm:block transition-colors ${
                        isActive
                          ? "text-text-primary"
                          : isComplete
                            ? "text-ops-accent"
                            : "text-text-disabled"
                      }`}
                    >
                      {step.label}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Step content ────────────────────────────────────────────── */}
        <div className="relative overflow-hidden min-h-[480px] overflow-y-auto">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={currentStep.id}
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="px-3 pb-3"
            >
              {currentStep.id === "connect" && (
                <StepConnect
                  hasConnection={hasConnection}
                  connections={connections}
                  connectionsLoading={connectionsLoading}
                  companyId={companyId}
                  currentUserId={currentUser?.id}
                />
              )}

              {currentStep.id === "how-it-works" && <StepHowItWorks />}

              {currentStep.id === "scan" && (
                <StepScan
                  scanning={scanning}
                  scanComplete={scanComplete}
                  scannedEmails={scannedEmails}
                  onScan={scanEmails}
                  hasConnection={hasConnection}
                  connectionEmail={firstConnection?.email}
                  filters={filters}
                  scanProgress={scanProgress}
                  scanSummary={scanSummary}
                />
              )}

              {currentStep.id === "filters" && firstConnection && (
                <StepFilters
                  filters={filters}
                  connectionId={firstConnection.id}
                  onUpdate={setFilters}
                  scannedEmails={scannedEmails}
                  preFilteredCount={preFilteredCount}
                  aiSuggestedFilters={aiSuggestedFilters}
                />
              )}

              {currentStep.id === "import" && (
                <StepImport
                  importDays={importDays}
                  setImportDays={setImportDays}
                  customDate={customDate}
                  setCustomDate={setCustomDate}
                  importStarted={importStarted}
                  filters={filters}
                  scannedEmails={scannedEmails}
                />
              )}

              {currentStep.id === "review" && (
                <StepReview
                  scannedEmails={scannedEmails}
                  filters={filters}
                  excludedContacts={excludedContacts}
                  editedNames={editedNames}
                  leadOverrides={leadOverrides}
                  expandedContact={expandedContact}
                  importDays={importDays}
                  customDate={customDate}
                  onToggleContact={(email) => {
                    setExcludedContacts((prev) => {
                      const next = new Set(prev);
                      if (next.has(email)) {
                        next.delete(email);
                      } else {
                        next.add(email);
                      }
                      return next;
                    });
                  }}
                  onEditName={(email, name) => {
                    setEditedNames((prev) => {
                      const next = new Map(prev);
                      next.set(email, name);
                      return next;
                    });
                  }}
                  onToggleLead={(email, createLead) => {
                    setLeadOverrides((prev) => {
                      const next = new Map(prev);
                      next.set(email, createLead);
                      return next;
                    });
                  }}
                  onExpandContact={setExpandedContact}
                  onApproveAll={applyFiltersAndImport}
                  importStarted={importStarted}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* ── Footer navigation ───────────────────────────────────────── */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-border">
          <div className="flex items-center gap-[6px]">
            <Button
              variant="ghost"
              size="sm"
              onClick={goBack}
              disabled={stepIndex === 0}
              className="gap-[4px] font-kosugi text-[11px]"
            >
              <ArrowLeft className="w-[14px] h-[14px]" />
              Back
            </Button>
            <button
              onClick={skipWizard}
              className="font-kosugi text-[10px] text-text-disabled hover:text-text-secondary transition-colors px-[6px] py-[4px]"
            >
              Skip
            </button>
          </div>

          <span className="font-kosugi text-[10px] text-text-disabled">
            {stepIndex + 1} / {STEPS.length}
          </span>

          <div className="flex items-center gap-[6px]">
            {/* Scan button — shows on scan step before scan starts */}
            {currentStep.id === "scan" && !scanComplete && !scanning && (
              <Button
                size="sm"
                onClick={scanEmails}
                disabled={!hasConnection}
                className="gap-[4px] font-kosugi text-[11px]"
              >
                <Search className="w-[14px] h-[14px]" />
                Scan My Emails
              </Button>
            )}

            {stepIndex < STEPS.length - 1 ? (
              <Button
                size="sm"
                onClick={goNext}
                disabled={!canProceed()}
                className="gap-[4px] font-kosugi text-[11px]"
              >
                Next
                <ArrowRight className="w-[14px] h-[14px]" />
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={applyFiltersAndImport}
                disabled={importStarted}
                className="gap-[4px] font-kosugi text-[11px]"
              >
                {importStarted ? (
                  <>
                    <Loader2 className="w-[14px] h-[14px] animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Zap className="w-[14px] h-[14px]" />
                    Start Import
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Step 1: Connect ─────────────────────────────────────────────────────────

function StepConnect({
  hasConnection,
  connections,
  connectionsLoading,
  companyId,
  currentUserId,
}: {
  hasConnection: boolean;
  connections: Array<{ id: string; email: string; type: string }>;
  connectionsLoading: boolean;
  companyId: string;
  currentUserId?: string;
}) {
  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className="space-y-2"
    >
      <motion.div variants={staggerItem}>
        <p className="font-mohave text-body text-text-primary text-left">
          Connect your Gmail account to automatically capture leads and client
          communications in your pipeline.
        </p>
      </motion.div>

      {connectionsLoading ? (
        <motion.div variants={staggerItem} className="flex items-center gap-[8px] py-3">
          <Loader2 className="w-[18px] h-[18px] text-text-disabled animate-spin" />
          <span className="font-mohave text-body-sm text-text-disabled">
            Checking connections...
          </span>
        </motion.div>
      ) : hasConnection ? (
        <motion.div variants={staggerItem}>
          {connections.map((conn) => (
            <div
              key={conn.id}
              className="flex items-center gap-[8px] px-2 py-1.5 bg-[rgba(107,143,113,0.08)] border border-[rgba(107,143,113,0.2)] rounded"
            >
              <div className="w-[32px] h-[32px] rounded bg-[rgba(107,143,113,0.15)] flex items-center justify-center">
                <Check className="w-[16px] h-[16px] text-[#6B8F71]" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-mono text-data-sm text-[#6B8F71] block truncate">
                  {conn.email}
                </span>
                <span className="font-kosugi text-[10px] text-text-disabled uppercase">
                  {conn.type} account connected
                </span>
              </div>
            </div>
          ))}
        </motion.div>
      ) : (
        <motion.div variants={staggerItem} className="space-y-1.5">
          <button
            onClick={() => {
              const params = new URLSearchParams({
                companyId,
                type: "company",
              });
              window.location.href = `/api/integrations/gmail?${params}`;
            }}
            className="w-full flex items-center gap-2 px-2 py-2 border border-border rounded hover:border-ops-accent/40 transition-colors group text-left"
          >
            <div className="w-[40px] h-[40px] rounded bg-ops-accent/10 flex items-center justify-center shrink-0 group-hover:bg-ops-accent/15 transition-colors">
              <Mail className="w-[20px] h-[20px] text-ops-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="font-mohave text-body text-text-primary block">
                Connect Company Gmail
              </span>
              <span className="font-kosugi text-[10px] text-text-disabled">
                Shared inbox for your whole team
              </span>
            </div>
            <ExternalLink className="w-[16px] h-[16px] text-text-disabled group-hover:text-ops-accent transition-colors shrink-0" />
          </button>

          <button
            onClick={() => {
              const params = new URLSearchParams({
                companyId,
                type: "individual",
                ...(currentUserId ? { userId: currentUserId } : {}),
              });
              window.location.href = `/api/integrations/gmail?${params}`;
            }}
            className="w-full flex items-center gap-2 px-2 py-2 border border-border-subtle rounded hover:border-border transition-colors group text-left"
          >
            <div className="w-[40px] h-[40px] rounded bg-background-card flex items-center justify-center shrink-0">
              <Mail className="w-[20px] h-[20px] text-text-disabled group-hover:text-text-secondary transition-colors" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="font-mohave text-body text-text-secondary block">
                Connect Personal Gmail
              </span>
              <span className="font-kosugi text-[10px] text-text-disabled">
                Your individual email only
              </span>
            </div>
            <ExternalLink className="w-[16px] h-[16px] text-text-disabled shrink-0" />
          </button>
        </motion.div>
      )}

      <motion.div variants={staggerItem}>
        <div className="flex items-start gap-[8px] px-1.5 py-1 rounded bg-background-card border border-border-subtle">
          <Shield className="w-[14px] h-[14px] text-text-disabled mt-[2px] shrink-0" />
          <p className="font-kosugi text-[10px] text-text-disabled leading-relaxed text-left">
            OPS uses read-only access. We never send, delete, or modify your
            emails. You can revoke access at any time.
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Step 2: How It Works ────────────────────────────────────────────────────

function StepHowItWorks() {
  const features = [
    {
      icon: Inbox,
      title: "Emails become leads",
      desc: "New emails from unknown senders appear as leads in your pipeline. Known clients get matched automatically.",
    },
    {
      icon: Filter,
      title: "Smart filtering",
      desc: "Newsletters, notifications, and spam are filtered out. Only real conversations reach your pipeline.",
    },
    {
      icon: Users,
      title: "Client matching",
      desc: "OPS matches emails to existing clients by address, domain, and phone number. Multi-tier matching catches 90%+ automatically.",
    },
    {
      icon: BarChart3,
      title: "Pipeline intelligence",
      desc: "Email threads attach to deals. See full conversation history on every opportunity. Track response times and follow-ups.",
    },
  ];

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className="space-y-2"
    >
      <motion.div variants={staggerItem}>
        <p className="font-mohave text-body text-text-primary text-left">
          Your inbox becomes your pipeline. Here&apos;s how it works.
        </p>
      </motion.div>

      <div className="grid grid-cols-2 gap-1">
        {features.map((f) => (
          <motion.div
            key={f.title}
            variants={staggerItem}
            className="p-1.5 rounded border border-border-subtle hover:border-border transition-colors"
          >
            <div className="flex items-center gap-[6px] mb-[6px]">
              <div className="w-[24px] h-[24px] rounded-sm bg-ops-accent/10 flex items-center justify-center">
                <f.icon className="w-[13px] h-[13px] text-ops-accent" />
              </div>
              <span className="font-mohave text-body-sm text-text-primary font-medium text-left">
                {f.title}
              </span>
            </div>
            <p className="font-kosugi text-[10px] text-text-disabled leading-relaxed text-left">
              {f.desc}
            </p>
          </motion.div>
        ))}
      </div>

      {/* Visual flow */}
      <motion.div
        variants={staggerItem}
        className="flex items-center justify-between px-2 py-1.5 bg-background-card rounded border border-border-subtle"
      >
        {[
          { label: "Email arrives", color: "text-text-secondary" },
          { label: "Filtered", color: "text-ops-accent" },
          { label: "Matched", color: "text-[#9DB582]" },
          { label: "Pipeline", color: "text-[#C4A868]" },
        ].map((step, i) => (
          <div key={step.label} className="flex items-center gap-[6px]">
            {i > 0 && (
              <ArrowRight className="w-[12px] h-[12px] text-text-disabled" />
            )}
            <span className={`font-kosugi text-[10px] uppercase tracking-wider ${step.color}`}>
              {step.label}
            </span>
          </div>
        ))}
      </motion.div>
    </motion.div>
  );
}

// ─── Step 3: Scan ────────────────────────────────────────────────────────────

function StepScan({
  scanning,
  scanComplete,
  scannedEmails,
  onScan,
  hasConnection,
  connectionEmail,
  filters,
  scanProgress,
  scanSummary,
}: {
  scanning: boolean;
  scanComplete: boolean;
  scannedEmails: ScannedEmail[];
  onScan: () => void;
  hasConnection: boolean;
  connectionEmail?: string;
  filters: GmailSyncFilters;
  scanProgress: { stage: string; current: number; total: number; message: string };
  scanSummary: string | null;
}) {
  const importedIds = useMemo(() => computeImportedIds(scannedEmails, filters), [scannedEmails, filters]);
  const importCount = importedIds.size;
  const filterCount = scannedEmails.length - importCount;

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className="space-y-2"
    >
      <motion.div variants={staggerItem}>
        <p className="font-mohave text-body text-text-primary text-left">
          {scanComplete
            ? "Here's what we found in your last 30 days."
            : "We'll scan your last 30 days of email to suggest the best filters."}
        </p>
      </motion.div>

      {!scanComplete && !scanning && (
        <motion.div variants={staggerItem} className="flex flex-col items-start gap-1.5">
          {connectionEmail && (
            <div className="flex items-center gap-[6px] px-1.5 py-[6px] rounded bg-background-card border border-border-subtle w-full">
              <Mail className="w-[14px] h-[14px] text-ops-accent shrink-0" />
              <span className="font-mono text-data-sm text-text-secondary truncate">
                {connectionEmail}
              </span>
            </div>
          )}
          <p className="font-kosugi text-[10px] text-text-disabled text-left">
            AI analyzes sender info, subjects, and snippets to classify emails. No email content is stored.
          </p>
        </motion.div>
      )}

      {scanning && (
        <motion.div
          variants={staggerItem}
          className="flex flex-col items-center gap-2 py-4"
        >
          <div className="relative w-[48px] h-[48px]">
            <Loader2 className="w-[48px] h-[48px] text-ops-accent/30 animate-spin" />
            <Search className="absolute inset-0 m-auto w-[20px] h-[20px] text-ops-accent" />
          </div>

          <span className="font-mohave text-body-sm text-text-primary">
            {scanProgress.message || "Scanning emails..."}
          </span>

          {connectionEmail && (
            <span className="font-mono text-[11px] text-ops-accent">
              {connectionEmail}
            </span>
          )}

          {/* Progress bar */}
          <div className="w-full max-w-[320px] space-y-1">
            <div className="w-full h-[6px] bg-border-subtle rounded-full overflow-hidden">
              <div
                className="h-full bg-ops-accent rounded-full transition-all duration-700 ease-out"
                style={{ width: `${stageToPercent(scanProgress.stage, scanProgress.current, scanProgress.total)}%` }}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-wider">
                {scanProgress.stage === "pending" && "Initializing"}
                {scanProgress.stage === "listing" && "Scanning inbox"}
                {scanProgress.stage === "fetching" && "Reading emails"}
                {scanProgress.stage === "pre_filtering" && "Pre-filtering"}
                {scanProgress.stage === "classifying" && "AI analyzing"}
              </span>
              <span className="font-mono text-[10px] text-text-disabled">
                {stageToPercent(scanProgress.stage, scanProgress.current, scanProgress.total)}%
              </span>
            </div>
          </div>

          {/* Stage checklist */}
          <div className="flex items-center gap-3 mt-1">
            {[
              { key: "listing", label: "Scan" },
              { key: "fetching", label: "Read" },
              { key: "pre_filtering", label: "Filter" },
              { key: "classifying", label: "AI" },
            ].map((s) => {
              const stageOrder = ["pending", "listing", "fetching", "pre_filtering", "classifying", "complete"];
              const currentIdx = stageOrder.indexOf(scanProgress.stage);
              const thisIdx = stageOrder.indexOf(s.key);
              const isDone = currentIdx > thisIdx;
              const isActive = currentIdx === thisIdx;

              return (
                <div key={s.key} className="flex items-center gap-[3px]">
                  <div
                    className={`w-[14px] h-[14px] rounded-full flex items-center justify-center ${
                      isDone
                        ? "bg-ops-accent/20"
                        : isActive
                          ? "bg-ops-accent/10"
                          : "bg-border-subtle"
                    }`}
                  >
                    {isDone ? (
                      <Check className="w-[8px] h-[8px] text-ops-accent" />
                    ) : isActive ? (
                      <Loader2 className="w-[8px] h-[8px] text-ops-accent animate-spin" />
                    ) : (
                      <div className="w-[4px] h-[4px] rounded-full bg-text-disabled/30" />
                    )}
                  </div>
                  <span
                    className={`font-kosugi text-[9px] ${
                      isDone
                        ? "text-ops-accent"
                        : isActive
                          ? "text-text-secondary"
                          : "text-text-disabled/40"
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>

          <span className="font-kosugi text-[10px] text-text-disabled/60 mt-1">
            You can close this window &mdash; we&apos;ll let you know when it&apos;s done.
          </span>
        </motion.div>
      )}

      {scanComplete && (
        <>
          {/* Connection email badge */}
          {connectionEmail && (
            <motion.div variants={staggerItem} className="flex items-center gap-[6px]">
              <Mail className="w-[12px] h-[12px] text-ops-accent" />
              <span className="font-mono text-[10px] text-ops-accent">{connectionEmail}</span>
            </motion.div>
          )}

          {/* Stats row */}
          <motion.div variants={staggerItem} className="grid grid-cols-3 gap-1">
            <div className="px-1.5 py-1 rounded border border-border-subtle text-left">
              <span className="font-mono text-data-lg text-text-primary block">
                {scannedEmails.length}
              </span>
              <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-wider">
                Emails scanned
              </span>
            </div>
            <div className="px-1.5 py-1 rounded border border-[rgba(107,143,113,0.2)] text-left">
              <span className="font-mono text-data-lg text-[#9DB582] block">
                {importCount}
              </span>
              <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-wider">
                To import
              </span>
            </div>
            <div className="px-1.5 py-1 rounded border border-border-subtle text-left">
              <span className="font-mono text-data-lg text-text-secondary block">
                {filterCount}
              </span>
              <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-wider">
                Filtered out
              </span>
            </div>
          </motion.div>

          {/* AI summary */}
          {scanSummary && (
            <motion.div variants={staggerItem}>
              <p className="font-mohave text-body-sm text-text-secondary text-left leading-relaxed">
                {scanSummary}
              </p>
            </motion.div>
          )}
        </>
      )}
    </motion.div>
  );
}

// ─── Step 4: Filters ─────────────────────────────────────────────────────────

/**
 * Compute the set of email IDs that would be imported, using the exact same
 * cumulative pipeline logic as the funnel canvas. Returns a Set of IDs.
 */
function computeImportedIds(
  emails: ScannedEmail[],
  filters: GmailSyncFilters,
): Set<string> {
  // 1. Preset blocklist — identify server-tagged preset-blocked emails
  const presetBlockedIds = new Set<string>();
  if (filters.usePresetBlocklist) {
    for (const e of emails) {
      if (e.reason === "Blocked domain (preset)") {
        presetBlockedIds.add(e.id);
      }
    }
  }

  // 2. Domain exclusion — subdomain-aware (only non-preset emails)
  const blockedDomains = filters.excludeDomains.map((d) => d.toLowerCase());
  const matchesDomain = (emailDomain: string): boolean => {
    const d = emailDomain.toLowerCase();
    return blockedDomains.some((blocked) => d === blocked || d.endsWith("." + blocked));
  };
  const caughtByDomain = new Set<string>();
  for (const e of emails) {
    if (presetBlockedIds.has(e.id)) continue;
    if (matchesDomain(e.domain)) {
      caughtByDomain.add(e.id);
    }
  }

  // 3. Address exclusion (skip preset + domain-caught)
  const addressSet = new Set((filters.excludeAddresses ?? []).map((a) => a.toLowerCase()));
  const caughtByAddress = new Set<string>();
  for (const e of emails) {
    if (presetBlockedIds.has(e.id) || caughtByDomain.has(e.id)) continue;
    if (addressSet.has(e.fromEmail.toLowerCase())) {
      caughtByAddress.add(e.id);
    }
  }

  // 4. Keyword exclusion (skip preset + domain + address)
  const keywords = (filters.excludeSubjectKeywords ?? []).map((k) => k.toLowerCase());
  const caughtByKeyword = new Set<string>();
  for (const e of emails) {
    if (presetBlockedIds.has(e.id) || caughtByDomain.has(e.id) || caughtByAddress.has(e.id)) continue;
    const subjectLower = e.subject.toLowerCase();
    if (keywords.some((kw) => subjectLower.includes(kw))) {
      caughtByKeyword.add(e.id);
    }
  }

  // 5. Build the imported set — everything NOT caught
  const allCaught = new Set([
    ...presetBlockedIds,
    ...caughtByDomain,
    ...caughtByAddress,
    ...caughtByKeyword,
  ]);

  const imported = new Set<string>();
  for (const e of emails) {
    if (!allCaught.has(e.id)) {
      imported.add(e.id);
    }
  }

  // Debug: log if nothing passes — this helps diagnose the issue
  if (emails.length > 0 && imported.size === 0) {
    console.warn(
      "[email-wizard] 0 imports detected. Debug info:",
      `\n  Total emails: ${emails.length}`,
      `\n  Preset blocked: ${presetBlockedIds.size}`,
      `\n  Domain caught: ${caughtByDomain.size} (${filters.excludeDomains.length} domains)`,
      `\n  Address caught: ${caughtByAddress.size} (${(filters.excludeAddresses ?? []).length} addresses)`,
      `\n  Keyword caught: ${caughtByKeyword.size} (${keywords.length} keywords: ${JSON.stringify(keywords.slice(0, 5))})`,
      `\n  Custom rules: ${(filters.rules ?? []).length}`,
      `\n  usePresetBlocklist: ${filters.usePresetBlocklist}`,
      `\n  Sample email reasons: ${JSON.stringify(emails.slice(0, 5).map(e => ({ domain: e.domain, reason: e.reason })))}`,
    );
  }

  return imported;
}

/** Check if a specific email would be imported (per-email version of computeImportedIds) */
function wouldImportWithFilters(
  email: ScannedEmail,
  filters: GmailSyncFilters,
  importedIds?: Set<string>,
): boolean {
  // If we have a pre-computed set, use it for consistency
  if (importedIds) return importedIds.has(email.id);

  // Fallback: inline check with subdomain matching
  if (filters.usePresetBlocklist && email.reason === "Blocked domain (preset)") return false;
  const emailDomain = email.domain.toLowerCase();
  if (filters.excludeDomains.some((d) => {
    const blocked = d.toLowerCase();
    return emailDomain === blocked || emailDomain.endsWith("." + blocked);
  })) return false;
  if (filters.excludeAddresses?.some((addr) => email.fromEmail.toLowerCase() === addr.toLowerCase())) return false;
  if (filters.excludeSubjectKeywords?.some((kw) => email.subject.toLowerCase().includes(kw.toLowerCase()))) return false;
  return true;
}

function StepFilters({
  filters,
  connectionId,
  onUpdate,
  scannedEmails,
  preFilteredCount,
  aiSuggestedFilters,
}: {
  filters: GmailSyncFilters;
  connectionId: string;
  onUpdate: (f: GmailSyncFilters) => void;
  scannedEmails: ScannedEmail[];
  preFilteredCount: number;
  aiSuggestedFilters: {
    excludeDomains: string[];
    excludeAddresses: string[];
    excludeSubjectKeywords: string[];
  } | null;
}) {
  const [drilledCategory, setDrilledCategory] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(
    (filters.rules?.length ?? 0) > 0,
  );

  // Compute imported emails with current filters
  const importedIds = useMemo(() => computeImportedIds(scannedEmails, filters), [scannedEmails, filters]);
  const importedEmails = useMemo(() => scannedEmails.filter((e) => importedIds.has(e.id)), [scannedEmails, importedIds]);
  const importCount = importedEmails.length;

  function handleToggleCategory(category: string, enabled: boolean) {
    switch (category) {
      case "preset":
        onUpdate({ ...filters, usePresetBlocklist: enabled });
        break;
      case "domains":
        if (!enabled) {
          // Disable: remove all AI-suggested domains
          const aiDomains = new Set(aiSuggestedFilters?.excludeDomains ?? []);
          onUpdate({
            ...filters,
            excludeDomains: filters.excludeDomains.filter((d) => !aiDomains.has(d)),
          });
        } else {
          // Enable: restore AI-suggested domains
          const domainSet = new Set(filters.excludeDomains);
          for (const d of aiSuggestedFilters?.excludeDomains ?? []) domainSet.add(d);
          onUpdate({ ...filters, excludeDomains: Array.from(domainSet) });
        }
        break;
      case "addresses":
        if (!enabled) {
          const aiAddresses = new Set(aiSuggestedFilters?.excludeAddresses ?? []);
          onUpdate({
            ...filters,
            excludeAddresses: filters.excludeAddresses.filter((a) => !aiAddresses.has(a)),
          });
        } else {
          const addrSet = new Set(filters.excludeAddresses);
          for (const a of aiSuggestedFilters?.excludeAddresses ?? []) addrSet.add(a);
          onUpdate({ ...filters, excludeAddresses: Array.from(addrSet) });
        }
        break;
      case "keywords":
        if (!enabled) {
          const aiKeywords = new Set(aiSuggestedFilters?.excludeSubjectKeywords ?? []);
          onUpdate({
            ...filters,
            excludeSubjectKeywords: filters.excludeSubjectKeywords.filter((k) => !aiKeywords.has(k)),
          });
        } else {
          const kwSet = new Set(filters.excludeSubjectKeywords);
          for (const k of aiSuggestedFilters?.excludeSubjectKeywords ?? []) kwSet.add(k);
          onUpdate({ ...filters, excludeSubjectKeywords: Array.from(kwSet) });
        }
        break;
    }
  }

  function handleToggleSubItem(category: string, value: string, enabled: boolean) {
    switch (category) {
      case "domains":
        onUpdate({
          ...filters,
          excludeDomains: enabled
            ? [...filters.excludeDomains, value]
            : filters.excludeDomains.filter((d) => d !== value),
        });
        break;
      case "addresses":
        onUpdate({
          ...filters,
          excludeAddresses: enabled
            ? [...filters.excludeAddresses, value]
            : filters.excludeAddresses.filter((a) => a !== value),
        });
        break;
      case "keywords":
        onUpdate({
          ...filters,
          excludeSubjectKeywords: enabled
            ? [...filters.excludeSubjectKeywords, value]
            : filters.excludeSubjectKeywords.filter((k) => k !== value),
        });
        break;
    }
  }

  // Group imported emails by domain for the collapsible list
  const importedByDomain = useMemo(() => {
    const map = new Map<string, ScannedEmail[]>();
    for (const email of importedEmails) {
      const existing = map.get(email.domain) ?? [];
      existing.push(email);
      map.set(email.domain, existing);
    }
    return Array.from(map.entries())
      .map(([domain, emails]) => ({ domain, emails, count: emails.length }))
      .sort((a, b) => b.count - a.count);
  }, [importedEmails]);

  const [emailsExpanded, setEmailsExpanded] = useState(false);
  const [expandedImportDomain, setExpandedImportDomain] = useState<string | null>(null);

  function applyRecommended() {
    if (!aiSuggestedFilters) return;
    onUpdate({
      ...filters,
      excludeDomains: [...aiSuggestedFilters.excludeDomains],
      excludeAddresses: [...aiSuggestedFilters.excludeAddresses],
      excludeSubjectKeywords: [...aiSuggestedFilters.excludeSubjectKeywords],
      usePresetBlocklist: true,
    });
    toast.success("Recommended filters applied");
  }

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className="space-y-2"
    >
      <motion.div variants={staggerItem}>
        <p className="font-mohave text-body text-text-primary text-left">
          Configure which emails make it into your pipeline.
        </p>
      </motion.div>

      {/* Main layout: filters left, galaxy + email list right */}
      <div className="flex gap-3">
        {/* Left: Filter controls */}
        <div className="w-[280px] shrink-0 space-y-2 overflow-y-auto max-h-[520px] pr-1">
          {/* Apply recommended button */}
          {aiSuggestedFilters && (
            <motion.div variants={staggerItem}>
              <Button
                variant="secondary"
                size="sm"
                onClick={applyRecommended}
                className="gap-[4px] font-kosugi text-[11px] w-full"
              >
                <Zap className="w-[12px] h-[12px]" />
                Apply recommended settings
              </Button>
            </motion.div>
          )}

          {/* Preset blocklist toggle */}
          <motion.div variants={staggerItem}>
            <button
              role="switch"
              aria-checked={filters.usePresetBlocklist}
              onClick={() =>
                onUpdate({
                  ...filters,
                  usePresetBlocklist: !filters.usePresetBlocklist,
                })
              }
              className="flex items-center gap-[8px] w-full px-1.5 py-1 rounded border border-border-subtle hover:border-border transition-colors text-left"
            >
              <div
                className={`w-[36px] h-[20px] rounded-full relative transition-colors ${
                  filters.usePresetBlocklist
                    ? "bg-ops-accent"
                    : "bg-text-disabled/30"
                }`}
              >
                <div
                  className={`w-[16px] h-[16px] rounded-full bg-white absolute top-[2px] transition-transform ${
                    filters.usePresetBlocklist ? "translate-x-[18px]" : "translate-x-[2px]"
                  }`}
                />
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-mohave text-body-sm text-text-primary block">
                  Block newsletters & notifications
                </span>
                <span className="font-kosugi text-[10px] text-text-disabled">
                  60+ pre-configured domains
                </span>
              </div>
            </button>
          </motion.div>

          {/* Blocked domains chips */}
          {filters.excludeDomains.length > 0 && (
            <motion.div variants={staggerItem}>
              <label className="font-kosugi text-[10px] text-text-disabled block mb-[4px] text-left">
                Blocked domains ({filters.excludeDomains.length})
              </label>
              <div className="flex flex-wrap gap-[4px]">
                {filters.excludeDomains.slice(0, 12).map((d) => (
                  <span
                    key={d}
                    className="inline-flex items-center gap-[3px] px-[6px] py-[2px] rounded-sm bg-background-card border border-border-subtle font-mono text-[10px] text-text-disabled"
                  >
                    {d}
                    <button
                      onClick={() =>
                        onUpdate({
                          ...filters,
                          excludeDomains: filters.excludeDomains.filter(
                            (x) => x !== d,
                          ),
                        })
                      }
                      className="hover:text-ops-error transition-colors"
                    >
                      <X className="w-[10px] h-[10px]" />
                    </button>
                  </span>
                ))}
                {filters.excludeDomains.length > 12 && (
                  <span className="font-kosugi text-[10px] text-text-disabled px-[6px] py-[2px]">
                    +{filters.excludeDomains.length - 12} more
                  </span>
                )}
              </div>
            </motion.div>
          )}

          {/* Blocked addresses chips */}
          {(filters.excludeAddresses?.length ?? 0) > 0 && (
            <motion.div variants={staggerItem}>
              <label className="font-kosugi text-[10px] text-text-disabled block mb-[4px] text-left">
                Blocked addresses ({filters.excludeAddresses.length})
              </label>
              <div className="flex flex-wrap gap-[4px]">
                {filters.excludeAddresses.slice(0, 8).map((a) => (
                  <span
                    key={a}
                    className="inline-flex items-center gap-[3px] px-[6px] py-[2px] rounded-sm bg-background-card border border-border-subtle font-mono text-[10px] text-text-disabled"
                  >
                    {a}
                    <button
                      onClick={() =>
                        onUpdate({
                          ...filters,
                          excludeAddresses: filters.excludeAddresses.filter(
                            (x) => x !== a,
                          ),
                        })
                      }
                      className="hover:text-ops-error transition-colors"
                    >
                      <X className="w-[10px] h-[10px]" />
                    </button>
                  </span>
                ))}
                {filters.excludeAddresses.length > 8 && (
                  <span className="font-kosugi text-[10px] text-text-disabled px-[6px] py-[2px]">
                    +{filters.excludeAddresses.length - 8} more
                  </span>
                )}
              </div>
            </motion.div>
          )}

          {/* Subject keywords chips */}
          {(filters.excludeSubjectKeywords?.length ?? 0) > 0 && (
            <motion.div variants={staggerItem}>
              <label className="font-kosugi text-[10px] text-text-disabled block mb-[4px] text-left">
                Subject keywords ({filters.excludeSubjectKeywords.length})
              </label>
              <div className="flex flex-wrap gap-[4px]">
                {filters.excludeSubjectKeywords.slice(0, 8).map((k) => (
                  <span
                    key={k}
                    className="inline-flex items-center gap-[3px] px-[6px] py-[2px] rounded-sm bg-background-card border border-border-subtle font-mono text-[10px] text-text-disabled"
                  >
                    {k}
                    <button
                      onClick={() =>
                        onUpdate({
                          ...filters,
                          excludeSubjectKeywords: filters.excludeSubjectKeywords.filter(
                            (x) => x !== k,
                          ),
                        })
                      }
                      className="hover:text-ops-error transition-colors"
                    >
                      <X className="w-[10px] h-[10px]" />
                    </button>
                  </span>
                ))}
                {filters.excludeSubjectKeywords.length > 8 && (
                  <span className="font-kosugi text-[10px] text-text-disabled px-[6px] py-[2px]">
                    +{filters.excludeSubjectKeywords.length - 8} more
                  </span>
                )}
              </div>
            </motion.div>
          )}

          {/* Custom filter rules builder */}
          <motion.div variants={staggerItem}>
            {!showBuilder ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowBuilder(true)}
                className="gap-[4px] font-kosugi text-[11px] text-text-disabled hover:text-ops-accent"
              >
                <Plus className="w-[12px] h-[12px]" />
                Add custom filter rules
              </Button>
            ) : (
              <div className="space-y-[6px]">
                <label className="font-kosugi text-[10px] text-text-disabled block text-left">
                  Custom exclusion rules
                </label>
                <EmailFilterBuilder
                  filters={filters}
                  connectionId={connectionId}
                  onUpdate={onUpdate}
                />
              </div>
            )}
          </motion.div>
        </div>

        {/* Right: Galaxy + Email list */}
        <div className="flex-1 min-w-0 space-y-2">
          {/* Funnel visualization */}
          {scannedEmails.length > 0 && (
            <FilterFunnelCanvas
              filters={filters}
              scannedEmails={scannedEmails}
              preFilteredCount={preFilteredCount}
              onToggleCategory={handleToggleCategory}
              onDrillDown={setDrilledCategory}
              drilledCategory={drilledCategory}
              onZoomOut={() => setDrilledCategory(null)}
              onToggleSubItem={handleToggleSubItem}
              className="w-full rounded border border-border-subtle"
            />
          )}

          {/* Collapsible email import list */}
          <div className="rounded border border-border-subtle bg-background-card overflow-hidden">
            <button
              onClick={() => setEmailsExpanded(!emailsExpanded)}
              className="w-full flex items-center justify-between px-2 py-1.5 hover:bg-background-elevated transition-colors text-left"
            >
              <div className="flex items-center gap-[6px]">
                <div className="w-[6px] h-[6px] rounded-full bg-[#9DB582]" />
                <span className="font-mono text-data-sm text-[#9DB582]">
                  {importCount}
                </span>
                <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider">
                  emails to import
                </span>
              </div>
              <ChevronDown
                className={`w-[12px] h-[12px] text-text-disabled transition-transform duration-200 ${
                  emailsExpanded ? "" : "-rotate-90"
                }`}
              />
            </button>

            {emailsExpanded && (
              <div className="border-t border-border-subtle overflow-y-auto max-h-[260px]">
                {importedByDomain.length === 0 ? (
                  <div className="flex items-center justify-center py-4">
                    <span className="font-mohave text-body-sm text-text-disabled">
                      No emails pass current filters
                    </span>
                  </div>
                ) : (
                  importedByDomain.map(({ domain, emails, count }) => (
                    <div key={domain}>
                      <button
                        onClick={() =>
                          setExpandedImportDomain(
                            expandedImportDomain === domain ? null : domain,
                          )
                        }
                        className="w-full flex items-center gap-[8px] px-2 py-[5px] hover:bg-background-elevated transition-colors text-left border-b border-border-subtle/50"
                      >
                        <ChevronDown
                          className={`w-[10px] h-[10px] text-text-disabled shrink-0 transition-transform duration-200 ${
                            expandedImportDomain === domain ? "" : "-rotate-90"
                          }`}
                        />
                        <span className="font-mono text-[10px] text-text-primary flex-1 truncate">
                          {domain}
                        </span>
                        <span className="font-mono text-[10px] text-[#9DB582] shrink-0">
                          {count}
                        </span>
                      </button>

                      {expandedImportDomain === domain && (
                        <div className="pl-[28px] pr-2 py-[2px] space-y-[1px]">
                          {emails.slice(0, 15).map((email) => (
                            <div
                              key={email.id}
                              className="flex items-center gap-[6px] py-[2px]"
                            >
                              <div className="flex-1 min-w-0 text-left">
                                <span className="font-mohave text-[10px] text-text-secondary block truncate">
                                  {email.subject || "(no subject)"}
                                </span>
                              </div>
                              <span className="font-kosugi text-[8px] text-text-disabled shrink-0">
                                {new Date(email.date).toLocaleDateString(
                                  undefined,
                                  { month: "short", day: "numeric" },
                                )}
                              </span>
                            </div>
                          ))}
                          {emails.length > 15 && (
                            <span className="font-kosugi text-[9px] text-text-disabled block py-[2px]">
                              +{emails.length - 15} more
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Step 6: Review Contacts ─────────────────────────────────────────────────

function StepReview({
  scannedEmails,
  filters,
  excludedContacts,
  editedNames,
  leadOverrides,
  expandedContact,
  importDays,
  customDate,
  onToggleContact,
  onEditName,
  onToggleLead,
  onExpandContact,
  onApproveAll,
  importStarted,
}: {
  scannedEmails: ScannedEmail[];
  filters: GmailSyncFilters;
  excludedContacts: Set<string>;
  editedNames: Map<string, string>;
  leadOverrides: Map<string, boolean>;
  expandedContact: string | null;
  importDays: number;
  customDate: string;
  onToggleContact: (email: string) => void;
  onEditName: (email: string, name: string) => void;
  onToggleLead: (email: string, createLead: boolean) => void;
  onExpandContact: (email: string | null) => void;
  onApproveAll: () => void;
  importStarted: boolean;
}) {
  const [editingName, setEditingName] = useState<string | null>(null);

  // Compute the import date cutoff from the user's chosen time range
  const importCutoff = useMemo(() => {
    if (customDate) return new Date(customDate);
    const d = new Date();
    d.setDate(d.getDate() - importDays);
    return d;
  }, [importDays, customDate]);

  const contacts = useMemo(() => {
    const importedIds = computeImportedIds(scannedEmails, filters);
    const imported = scannedEmails.filter((e) => {
      if (!importedIds.has(e.id)) return false;
      // Filter by import time range
      const emailDate = new Date(e.date);
      return !isNaN(emailDate.getTime()) && emailDate >= importCutoff;
    });

    // Group by fromEmail
    const map = new Map<string, ScannedEmail[]>();
    for (const email of imported) {
      if (!email.fromEmail) continue;
      const existing = map.get(email.fromEmail) ?? [];
      existing.push(email);
      map.set(email.fromEmail, existing);
    }

    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    const previews: ContactPreview[] = [];
    for (const [fromEmail, emails] of map) {
      // Use edited name if set, otherwise extract from header
      let name = editedNames.get(fromEmail) ?? "";
      if (!name) {
        const fromHeader = emails[0]?.from ?? "";
        name = fromHeader.replace(/<.*>/, "").trim().replace(/^"(.*)"$/, "$1");
        if (!name || name === fromEmail) {
          const prefix = fromEmail.split("@")[0] ?? fromEmail;
          name = prefix.replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        }
      }

      const dates = emails
        .map((e) => new Date(e.date))
        .filter((d) => !isNaN(d.getTime()));
      const earliest =
        dates.length > 0
          ? new Date(Math.min(...dates.map((d) => d.getTime())))
          : new Date();
      const latest =
        dates.length > 0
          ? new Date(Math.max(...dates.map((d) => d.getTime())))
          : new Date();

      // Use lead override if user toggled, otherwise auto-determine
      const override = leadOverrides.get(fromEmail);
      const createLead = override !== undefined ? override : earliest >= twoWeeksAgo;

      // Most recent 2 emails for expanded preview (sort newest first)
      const sorted = [...emails].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      const recentEmails = sorted.slice(0, 2).map((e) => ({
        subject: e.subject || "(no subject)",
        snippet: e.snippet ?? "",
        date: e.date,
      }));

      previews.push({
        fromEmail,
        name,
        domain: emails[0]?.domain ?? "",
        emailCount: emails.length,
        firstInquiryDate: earliest,
        latestDate: latest,
        recentEmails,
        createLead,
        excluded: excludedContacts.has(fromEmail),
      });
    }

    // Sort: leads first, then by latest date (most recent first)
    return previews.sort((a, b) => {
      if (a.createLead !== b.createLead) return a.createLead ? -1 : 1;
      return b.latestDate.getTime() - a.latestDate.getTime();
    });
  }, [scannedEmails, filters, excludedContacts, editedNames, leadOverrides, importCutoff]);

  const activeContacts = contacts.filter((c) => !c.excluded);
  const leadCount = activeContacts.filter((c) => c.createLead).length;
  const clientOnlyCount = activeContacts.filter((c) => !c.createLead).length;

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className="space-y-2"
    >
      <motion.div variants={staggerItem}>
        <p className="font-mohave text-body text-text-primary text-left">
          Review the clients and leads that will be created from your emails.
        </p>
      </motion.div>

      {/* Stats row */}
      <motion.div variants={staggerItem} className="grid grid-cols-3 gap-1">
        <div className="px-1.5 py-1 rounded border border-border-subtle text-left">
          <span className="font-mono text-data-lg text-text-primary block">
            {activeContacts.length}
          </span>
          <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-wider">
            New clients
          </span>
        </div>
        <div className="px-1.5 py-1 rounded border border-[rgba(196,168,104,0.3)] text-left">
          <span className="font-mono text-data-lg text-[#C4A868] block">
            {leadCount}
          </span>
          <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-wider">
            Active leads
          </span>
        </div>
        <div className="px-1.5 py-1 rounded border border-border-subtle text-left">
          <span className="font-mono text-data-lg text-text-secondary block">
            {clientOnlyCount}
          </span>
          <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-wider">
            Client only
          </span>
        </div>
      </motion.div>

      {/* Lead logic explanation */}
      <motion.div variants={staggerItem}>
        <div className="flex items-start gap-[6px] px-1.5 py-1 rounded bg-[rgba(196,168,104,0.08)] border border-[rgba(196,168,104,0.15)]">
          <Zap className="w-[12px] h-[12px] text-[#C4A868] mt-[2px] shrink-0" />
          <p className="font-kosugi text-[10px] text-text-secondary leading-relaxed text-left">
            Leads are auto-created for inquiries within the last 2 weeks.
            Click a contact to expand details. Click the lead badge to toggle.
          </p>
        </div>
      </motion.div>

      {/* Scrollable contact list */}
      <motion.div variants={staggerItem} className="relative">
        <div className="rounded border border-border-subtle overflow-hidden">
          <div className="max-h-[320px] overflow-y-auto scrollbar-hide">
            {contacts.length === 0 ? (
              <div className="flex items-center justify-center py-6">
                <span className="font-mohave text-body-sm text-text-disabled">
                  No contacts found in imported emails
                </span>
              </div>
            ) : (
              contacts.map((contact) => {
                const isExpanded = expandedContact === contact.fromEmail;
                return (
                  <div
                    key={contact.fromEmail}
                    className={`border-b border-border-subtle/50 transition-all ${
                      contact.excluded ? "opacity-40" : ""
                    }`}
                  >
                    {/* Main row */}
                    <div
                      className={`flex items-center gap-[8px] px-2 py-[8px] transition-colors ${
                        contact.excluded ? "" : "hover:bg-background-elevated cursor-pointer"
                      }`}
                      onClick={() => {
                        if (!contact.excluded) {
                          onExpandContact(isExpanded ? null : contact.fromEmail);
                        }
                      }}
                    >
                      {/* Checkbox */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleContact(contact.fromEmail);
                        }}
                        className={`w-[18px] h-[18px] rounded-sm border-2 flex items-center justify-center shrink-0 transition-all ${
                          contact.excluded
                            ? "border-text-disabled/30 bg-transparent"
                            : "border-ops-accent bg-ops-accent/10"
                        }`}
                      >
                        {!contact.excluded && (
                          <Check className="w-[10px] h-[10px] text-ops-accent" />
                        )}
                      </button>

                      {/* Contact info */}
                      <div className="flex-1 min-w-0 text-left">
                        <div className="flex items-center gap-[6px]">
                          {editingName === contact.fromEmail ? (
                            <input
                              autoFocus
                              className="font-mohave text-body-sm text-text-primary bg-transparent border-b border-ops-accent outline-none px-0 py-0 w-[180px]"
                              defaultValue={contact.name}
                              onClick={(e) => e.stopPropagation()}
                              onBlur={(e) => {
                                const val = e.target.value.trim();
                                if (val && val !== contact.name) {
                                  onEditName(contact.fromEmail, val);
                                }
                                setEditingName(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  (e.target as HTMLInputElement).blur();
                                } else if (e.key === "Escape") {
                                  setEditingName(null);
                                }
                              }}
                            />
                          ) : (
                            <>
                              <span className="font-mohave text-body-sm text-text-primary truncate">
                                {contact.name}
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingName(contact.fromEmail);
                                }}
                                className="opacity-0 group-hover:opacity-100 hover:!opacity-100 text-text-disabled hover:text-ops-accent transition-all p-[2px]"
                                style={{ opacity: isExpanded ? 1 : undefined }}
                              >
                                <Pencil className="w-[10px] h-[10px]" />
                              </button>
                            </>
                          )}

                          {/* Lead badge — clickable toggle */}
                          {!contact.excluded && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleLead(contact.fromEmail, !contact.createLead);
                              }}
                              className={`inline-flex items-center px-[5px] py-[1px] rounded-sm border transition-all ${
                                contact.createLead
                                  ? "bg-[rgba(196,168,104,0.15)] border-[rgba(196,168,104,0.25)] hover:bg-[rgba(196,168,104,0.25)]"
                                  : "bg-transparent border-border-subtle hover:border-text-disabled"
                              }`}
                              title={contact.createLead ? "Click to remove lead" : "Click to create lead"}
                            >
                              <span className={`font-kosugi text-[8px] uppercase tracking-wider ${
                                contact.createLead ? "text-[#C4A868]" : "text-text-disabled"
                              }`}>
                                {contact.createLead ? "Lead" : "Client"}
                              </span>
                            </button>
                          )}
                        </div>
                        <span className="font-mono text-[10px] text-text-disabled block truncate">
                          {contact.fromEmail}
                        </span>
                      </div>

                      {/* Email count + date + chevron */}
                      <div className="flex items-center gap-[6px] shrink-0">
                        <div className="text-right">
                          <span className="font-mono text-[10px] text-text-secondary block">
                            {contact.emailCount} email{contact.emailCount !== 1 ? "s" : ""}
                          </span>
                          <span className="font-kosugi text-[8px] text-text-disabled block">
                            {contact.firstInquiryDate.toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                        </div>
                        <ChevronDown
                          className={`w-[12px] h-[12px] text-text-disabled transition-transform duration-200 ${
                            isExpanded ? "" : "-rotate-90"
                          }`}
                        />
                      </div>
                    </div>

                    {/* Expanded email preview */}
                    {isExpanded && !contact.excluded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: EASE }}
                        className="overflow-hidden"
                      >
                        <div className="px-2 pb-2 pt-0 ml-[26px] space-y-[4px]">
                          {contact.recentEmails.length > 0 ? (
                            contact.recentEmails.map((email, i) => (
                              <div
                                key={i}
                                className="px-1.5 py-1 rounded bg-background-card border border-border-subtle text-left"
                              >
                                <div className="flex items-center justify-between gap-[8px] mb-[2px]">
                                  <span className="font-mohave text-[11px] text-text-primary truncate flex-1">
                                    {email.subject}
                                  </span>
                                  <span className="font-kosugi text-[8px] text-text-disabled shrink-0">
                                    {new Date(email.date).toLocaleDateString(undefined, {
                                      month: "short",
                                      day: "numeric",
                                    })}
                                  </span>
                                </div>
                                {email.snippet && (
                                  <p className="font-kosugi text-[9px] text-text-disabled leading-relaxed line-clamp-2">
                                    {email.snippet}
                                  </p>
                                )}
                              </div>
                            ))
                          ) : (
                            <span className="font-kosugi text-[9px] text-text-disabled">
                              No email previews available
                            </span>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </motion.div>

      {/* Sticky approve button */}
      <motion.div variants={staggerItem} className="sticky bottom-0 pt-1">
        <Button
          onClick={onApproveAll}
          disabled={activeContacts.length === 0 || importStarted}
          className="w-full gap-[6px] font-kosugi text-[12px]"
        >
          {importStarted ? (
            <>
              <Loader2 className="w-[14px] h-[14px] animate-spin" />
              Importing...
            </>
          ) : (
            <>
              <CheckCircle className="w-[14px] h-[14px]" />
              Approve {activeContacts.length} Client{activeContacts.length !== 1 ? "s" : ""}
              {leadCount > 0 && ` & ${leadCount} Lead${leadCount !== 1 ? "s" : ""}`}
            </>
          )}
        </Button>
      </motion.div>
    </motion.div>
  );
}

// ─── Step 6: Import ──────────────────────────────────────────────────────────

function StepImport({
  importDays,
  setImportDays,
  customDate,
  setCustomDate,
  importStarted,
  filters,
  scannedEmails: _scannedEmails,
}: {
  importDays: number;
  setImportDays: (d: number) => void;
  customDate: string;
  setCustomDate: (d: string) => void;
  importStarted: boolean;
  filters: GmailSyncFilters;
  scannedEmails: ScannedEmail[];
}) {
  const [useCustom, setUseCustom] = useState(false);

  const presets = [
    { label: "7 days", days: 7 },
    { label: "30 days", days: 30 },
    { label: "90 days", days: 90 },
    { label: "6 months", days: 180 },
  ];

  const ruleCount = (filters.rules?.length ?? 0) + filters.excludeDomains.length;

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className="space-y-2"
    >
      <motion.div variants={staggerItem}>
        <p className="font-mohave text-body text-text-primary text-left">
          Choose how far back to import, then we&apos;ll start processing.
        </p>
      </motion.div>

      {/* Time range */}
      <motion.div variants={staggerItem} className="space-y-1">
        <label className="font-kosugi text-[10px] text-text-disabled block text-left uppercase tracking-wider">
          Import range
        </label>
        <div className="flex flex-wrap gap-[6px]">
          {presets.map((p) => (
            <button
              key={p.days}
              onClick={() => {
                setImportDays(p.days);
                setUseCustom(false);
                setCustomDate("");
              }}
              disabled={importStarted}
              className={`px-1.5 py-[6px] rounded border font-kosugi text-[11px] transition-all ${
                !useCustom && importDays === p.days
                  ? "border-ops-accent bg-ops-accent/10 text-ops-accent"
                  : "border-border-subtle text-text-secondary hover:border-border"
              }`}
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={() => setUseCustom(true)}
            disabled={importStarted}
            className={`px-1.5 py-[6px] rounded border font-kosugi text-[11px] transition-all ${
              useCustom
                ? "border-ops-accent bg-ops-accent/10 text-ops-accent"
                : "border-border-subtle text-text-secondary hover:border-border"
            }`}
          >
            Custom
          </button>
        </div>

        {useCustom && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="pt-[4px]"
          >
            <input
              type="date"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              max={new Date().toISOString().split("T")[0]}
              disabled={importStarted}
              className="bg-background-input border border-border rounded px-1.5 py-[6px] font-mohave text-body-sm text-text-primary"
            />
          </motion.div>
        )}
      </motion.div>

      {/* Summary */}
      <motion.div
        variants={staggerItem}
        className="px-2 py-1.5 rounded border border-border-subtle bg-background-card space-y-[6px] text-left"
      >
        <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider block">
          Import summary
        </span>
        <div className="space-y-[4px]">
          <div className="flex items-center justify-between">
            <span className="font-mohave text-body-sm text-text-secondary">
              Time range
            </span>
            <span className="font-mono text-data-sm text-text-primary">
              {useCustom && customDate
                ? `Since ${customDate}`
                : `Last ${importDays} days`}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-mohave text-body-sm text-text-secondary">
              Active filters
            </span>
            <span className="font-mono text-data-sm text-text-primary">
              {ruleCount} rule{ruleCount !== 1 ? "s" : ""}
              {filters.usePresetBlocklist ? " + preset blocklist" : ""}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-mohave text-body-sm text-text-secondary">
              Auto-sync after import
            </span>
            <span className="font-mono text-data-sm text-[#9DB582]">
              Enabled
            </span>
          </div>
        </div>
      </motion.div>

      {importStarted && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-[8px] px-1.5 py-1 rounded bg-ops-accent/10 border border-ops-accent/20"
        >
          <Loader2 className="w-[16px] h-[16px] text-ops-accent animate-spin" />
          <span className="font-mohave text-body-sm text-ops-accent text-left">
            Import in progress. You can close this wizard — it runs in the
            background.
          </span>
        </motion.div>
      )}
    </motion.div>
  );
}
