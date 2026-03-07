"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mail,
  ArrowRight,
  ArrowLeft,
  Check,
  ExternalLink,
  Loader2,
  Filter,
  Search,
  Tag,
  X,
  Inbox,
  Eye,
  EyeOff,
  Plus,
  ChevronDown,
  Zap,
  BarChart3,
  Users,
  Shield,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/lib/store/auth-store";
import { useGmailConnections, useGmailImport, useUpdateGmailConnection } from "@/lib/hooks";
import { EmailFilterBuilder } from "@/components/settings/email-filter-builder";
import type {
  GmailSyncFilters,
  EmailFilterRule,
  EmailFilterField,
  EmailFilterOperator,
} from "@/lib/types/pipeline";
import { DEFAULT_SYNC_FILTERS } from "@/lib/types/pipeline";
import { toast } from "sonner";

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

// ─── Types ───────────────────────────────────────────────────────────────────

interface ScannedEmail {
  id: string;
  from: string;
  fromEmail: string;
  domain: string;
  subject: string;
  labels: string[];
  date: string;
  wouldImport: boolean;
  reason?: string;
}

interface DomainGroup {
  domain: string;
  count: number;
  sample: ScannedEmail[];
  suggested: "import" | "filter";
  reason: string;
}

interface WizardStep {
  id: string;
  label: string;
  icon: typeof Mail;
}

const STEPS: WizardStep[] = [
  { id: "connect", label: "Connect", icon: Mail },
  { id: "how-it-works", label: "How It Works", icon: Zap },
  { id: "scan", label: "Scan", icon: Search },
  { id: "filters", label: "Filters", icon: Filter },
  { id: "import", label: "Import", icon: ArrowRight },
];

// ─── Props ───────────────────────────────────────────────────────────────────

interface EmailSetupWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Start at a specific step (e.g., "filters" from the filter section) */
  initialStep?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function EmailSetupWizard({
  open,
  onOpenChange,
  initialStep,
}: EmailSetupWizardProps) {
  const { company, currentUser } = useAuthStore();
  const companyId = company?.id ?? "";
  const { data: connections = [], isLoading: connectionsLoading } = useGmailConnections();
  const gmailImport = useGmailImport();
  const updateConnection = useUpdateGmailConnection();

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
  const [domainGroups, setDomainGroups] = useState<DomainGroup[]>([]);
  const [scanComplete, setScanComplete] = useState(false);

  // Filter state
  const [filters, setFilters] = useState<GmailSyncFilters>(
    firstConnection?.syncFilters ?? DEFAULT_SYNC_FILTERS,
  );

  // Import state
  const [importDays, setImportDays] = useState(30);
  const [customDate, setCustomDate] = useState("");
  const [importStarted, setImportStarted] = useState(false);

  // Update filters when connection loads
  useEffect(() => {
    if (firstConnection?.syncFilters) {
      setFilters(firstConnection.syncFilters);
    }
  }, [firstConnection?.syncFilters]);

  // Reset when opened
  useEffect(() => {
    if (open) {
      const idx = initialStep
        ? Math.max(0, STEPS.findIndex((s) => s.id === initialStep))
        : 0;
      setStepIndex(idx);
      setDirection(1);
      setImportStarted(false);
    }
  }, [open, initialStep]);

  // Skip connect step if already connected
  useEffect(() => {
    if (open && stepIndex === 0 && hasConnection && !initialStep) {
      setStepIndex(1);
    }
  }, [open, hasConnection, stepIndex, initialStep]);

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

  // ── Scan emails ──────────────────────────────────────────────────────────

  async function scanEmails() {
    if (!firstConnection) return;
    setScanning(true);
    setScanComplete(false);
    setScannedEmails([]);
    setDomainGroups([]);

    try {
      const resp = await fetch(
        `/api/integrations/gmail/scan-preview?connectionId=${encodeURIComponent(firstConnection.id)}&days=30`,
      );

      if (!resp.ok) throw new Error("Failed to scan emails");

      const data = await resp.json();
      const emails: ScannedEmail[] = data.emails ?? [];
      setScannedEmails(emails);

      // Group by domain
      const domainMap = new Map<string, ScannedEmail[]>();
      for (const email of emails) {
        const existing = domainMap.get(email.domain) ?? [];
        existing.push(email);
        domainMap.set(email.domain, existing);
      }

      const groups: DomainGroup[] = Array.from(domainMap.entries())
        .map(([domain, emails]) => ({
          domain,
          count: emails.length,
          sample: emails.slice(0, 3),
          suggested: emails[0]?.wouldImport ? "import" as const : "filter" as const,
          reason: emails[0]?.reason ?? "",
        }))
        .sort((a, b) => b.count - a.count);

      setDomainGroups(groups);
      setScanComplete(true);
    } catch (err) {
      toast.error("Failed to scan emails", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setScanning(false);
    }
  }

  // ── Apply filters & import ───────────────────────────────────────────────

  async function applyFiltersAndImport() {
    if (!firstConnection) return;

    // Save filters to the connection
    try {
      await updateConnection.mutateAsync({
        id: firstConnection.id,
        data: { id: firstConnection.id, syncFilters: filters },
      });
    } catch {
      // Non-fatal — filters may not persist but import can proceed
    }

    // Start import
    const importAfter = customDate || (() => {
      const d = new Date();
      d.setDate(d.getDate() - importDays);
      return d.toISOString().split("T")[0];
    })();

    setImportStarted(true);
    gmailImport.startImport.mutate(
      { companyId, connectionId: firstConnection.id, importAfter },
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

  // ── Can proceed? ─────────────────────────────────────────────────────────

  function canProceed(): boolean {
    switch (currentStep.id) {
      case "connect":
        return hasConnection;
      case "how-it-works":
        return true;
      case "scan":
        return scanComplete || scannedEmails.length > 0;
      case "filters":
        return true;
      case "import":
        return !importStarted;
      default:
        return true;
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[720px] max-h-[90vh] p-0 overflow-hidden"
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
        <div className="relative overflow-hidden min-h-[380px]">
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
                  domainGroups={domainGroups}
                  onScan={scanEmails}
                  hasConnection={hasConnection}
                />
              )}

              {currentStep.id === "filters" && firstConnection && (
                <StepFilters
                  filters={filters}
                  connectionId={firstConnection.id}
                  onUpdate={setFilters}
                  domainGroups={domainGroups}
                  scannedEmails={scannedEmails}
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
            </motion.div>
          </AnimatePresence>
        </div>

        {/* ── Footer navigation ───────────────────────────────────────── */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-border">
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

          <span className="font-kosugi text-[10px] text-text-disabled">
            {stepIndex + 1} / {STEPS.length}
          </span>

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
  domainGroups,
  onScan,
  hasConnection,
}: {
  scanning: boolean;
  scanComplete: boolean;
  scannedEmails: ScannedEmail[];
  domainGroups: DomainGroup[];
  onScan: () => void;
  hasConnection: boolean;
}) {
  const importCount = scannedEmails.filter((e) => e.wouldImport).length;
  const filterCount = scannedEmails.length - importCount;
  const uniqueDomains = domainGroups.length;

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
          <Button
            size="sm"
            onClick={onScan}
            disabled={!hasConnection}
            className="gap-[6px] font-kosugi text-[11px]"
          >
            <Search className="w-[14px] h-[14px]" />
            Scan My Emails
          </Button>
          <p className="font-kosugi text-[10px] text-text-disabled text-left">
            This reads subject lines and sender info only. No email content is stored.
          </p>
        </motion.div>
      )}

      {scanning && (
        <motion.div
          variants={staggerItem}
          className="flex flex-col items-center gap-1.5 py-4"
        >
          <div className="relative w-[48px] h-[48px]">
            <Loader2 className="w-[48px] h-[48px] text-ops-accent/30 animate-spin" />
            <Search className="absolute inset-0 m-auto w-[20px] h-[20px] text-ops-accent" />
          </div>
          <span className="font-mohave text-body-sm text-text-secondary">
            Scanning emails...
          </span>
          <span className="font-kosugi text-[10px] text-text-disabled">
            Analyzing senders, subjects, and patterns
          </span>
        </motion.div>
      )}

      {scanComplete && (
        <>
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

          {/* Domain breakdown — scrollable */}
          <motion.div
            variants={staggerItem}
            className="max-h-[200px] overflow-y-auto space-y-[4px] pr-[4px]"
          >
            {domainGroups.slice(0, 15).map((group) => (
              <div
                key={group.domain}
                className="flex items-center gap-[8px] px-1.5 py-[6px] rounded border border-border-subtle hover:border-border transition-colors"
              >
                <div
                  className={`w-[8px] h-[8px] rounded-full shrink-0 ${
                    group.suggested === "import"
                      ? "bg-[#9DB582]"
                      : "bg-text-disabled"
                  }`}
                />
                <div className="flex-1 min-w-0 text-left">
                  <span className="font-mono text-data-sm text-text-primary block truncate">
                    {group.domain}
                  </span>
                  <span className="font-kosugi text-[9px] text-text-disabled">
                    {group.count} emails &middot; {group.reason}
                  </span>
                </div>
                <span
                  className={`font-kosugi text-[9px] uppercase tracking-wider shrink-0 ${
                    group.suggested === "import"
                      ? "text-[#9DB582]"
                      : "text-text-disabled"
                  }`}
                >
                  {group.suggested === "import" ? "Import" : "Filter"}
                </span>
              </div>
            ))}
          </motion.div>
        </>
      )}
    </motion.div>
  );
}

// ─── Step 4: Filters ─────────────────────────────────────────────────────────

function StepFilters({
  filters,
  connectionId,
  onUpdate,
  domainGroups,
  scannedEmails,
}: {
  filters: GmailSyncFilters;
  connectionId: string;
  onUpdate: (f: GmailSyncFilters) => void;
  domainGroups: DomainGroup[];
  scannedEmails: ScannedEmail[];
}) {
  const [showBuilder, setShowBuilder] = useState(
    (filters.rules?.length ?? 0) > 0,
  );

  // Auto-suggest: add blocked domains from scan
  function applySuggestions() {
    const domainsToBlock = domainGroups
      .filter((g) => g.suggested === "filter")
      .map((g) => g.domain);

    const existingDomains = new Set(filters.excludeDomains);
    const newDomains = domainsToBlock.filter((d) => !existingDomains.has(d));

    if (newDomains.length > 0) {
      onUpdate({
        ...filters,
        excludeDomains: [...filters.excludeDomains, ...newDomains],
      });
      toast.success(`Added ${newDomains.length} domains to block list`);
    } else {
      toast.info("All suggested domains are already blocked");
    }
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

      {/* Quick actions from scan */}
      {domainGroups.length > 0 && (
        <motion.div variants={staggerItem}>
          <Button
            variant="secondary"
            size="sm"
            onClick={applySuggestions}
            className="gap-[4px] font-kosugi text-[11px]"
          >
            <Zap className="w-[12px] h-[12px]" />
            Apply scan suggestions
          </Button>
        </motion.div>
      )}

      {/* Preset blocklist */}
      <motion.div variants={staggerItem}>
        <button
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
              60+ pre-configured domains (Mailchimp, LinkedIn, etc.)
            </span>
          </div>
        </button>
      </motion.div>

      {/* Filter rules builder */}
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
              Only import emails matching these rules
            </label>
            <EmailFilterBuilder
              filters={filters}
              connectionId={connectionId}
              onUpdate={onUpdate}
            />
          </div>
        )}
      </motion.div>

      {/* Blocked domains list (from excludeDomains) */}
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
    </motion.div>
  );
}

// ─── Step 5: Import ──────────────────────────────────────────────────────────

function StepImport({
  importDays,
  setImportDays,
  customDate,
  setCustomDate,
  importStarted,
  filters,
  scannedEmails,
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
