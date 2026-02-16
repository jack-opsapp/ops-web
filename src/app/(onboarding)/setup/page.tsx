"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Repeat,
  Zap,
  Hammer,
  Wrench,
  DollarSign,
  BarChart3,
  Users,
  GitBranch,
  User,
  Users2,
  Building2,
  Factory,
  Calculator,
  Columns3,
  FileSpreadsheet,
  PenTool,
  CalendarDays,
  Receipt,
  TrendingUp,
  Wallet,
  UserCog,
  ChevronRight,
  ChevronLeft,
  Check,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import {
  useSetupStore,
  type WorkType,
  type TrackingPriority,
  type TeamSize,
  type CurrentTool,
  type NeededFeature,
} from "@/stores/setup-store";

const TOTAL_STEPS = 5;

// ─── Step Data ──────────────────────────────────────────────────────────────

const WORK_TYPES: { id: WorkType; label: string; description: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "recurring", label: "Recurring Services", description: "Cleaning, lawn care, pool maintenance", icon: Repeat },
  { id: "emergency", label: "Emergency Services", description: "Plumbing, electrical, locksmith", icon: Zap },
  { id: "project-based", label: "Project-Based", description: "Landscaping, construction, remodeling", icon: Hammer },
  { id: "single-visit", label: "Single-Visit", description: "Appliance repair, installation, inspection", icon: Wrench },
];

const TRACKING_PRIORITIES: { id: TrackingPriority; label: string; description: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "revenue", label: "Revenue & Profitability", description: "Job costing, P&L, margins", icon: DollarSign },
  { id: "efficiency", label: "Crew Efficiency", description: "Utilization %, hours per job", icon: BarChart3 },
  { id: "customers", label: "Customer Relationships", description: "Repeat rate, satisfaction", icon: Users },
  { id: "pipeline", label: "Job Pipeline", description: "Leads, quotes, conversion rate", icon: GitBranch },
];

const TEAM_SIZES: { id: TeamSize; label: string; description: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "solo", label: "Just Me", description: "Solo operator", icon: User },
  { id: "2-5", label: "2-5 People", description: "Small crew", icon: Users2 },
  { id: "6-10", label: "6-10 People", description: "Medium crew", icon: Building2 },
  { id: "11+", label: "11+ People", description: "Large operation", icon: Factory },
];

const CURRENT_TOOLS: { id: CurrentTool; label: string; description: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "quickbooks", label: "QuickBooks", description: "We'll help you migrate", icon: Calculator },
  { id: "jobber", label: "Jobber", description: "Import your projects", icon: Columns3 },
  { id: "spreadsheets", label: "Spreadsheets", description: "Automate your workflow", icon: FileSpreadsheet },
  { id: "pen-paper", label: "Pen & Paper", description: "We'll keep it simple", icon: PenTool },
];

const NEEDED_FEATURES: { id: NeededFeature; label: string; description: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "scheduling", label: "Scheduling & Dispatch", description: "Calendar, crew assignments", icon: CalendarDays },
  { id: "invoicing", label: "Invoicing & Payments", description: "Billing, Stripe integration", icon: Receipt },
  { id: "leads", label: "Lead Tracking", description: "Pipeline, CRM", icon: TrendingUp },
  { id: "expenses", label: "Expense Tracking", description: "Accounting, job costing", icon: Wallet },
  { id: "crew", label: "Crew Management", description: "Team features, utilization", icon: UserCog },
];

// ─── Option Card ──────────────────────────────────────────────────────────────

function OptionCard({
  icon: Icon,
  label,
  description,
  selected,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex items-center gap-1.5 p-2 rounded-lg border transition-all duration-200",
        "text-left w-full",
        selected
          ? "bg-ops-accent/10 border-ops-accent shadow-[0_0_12px_rgba(65,115,148,0.15)]"
          : "bg-background-card border-border hover:border-border-medium hover:bg-background-elevated"
      )}
    >
      <div
        className={cn(
          "w-[40px] h-[40px] rounded-lg flex items-center justify-center shrink-0 transition-colors",
          selected ? "bg-ops-accent/20" : "bg-background-elevated"
        )}
      >
        <Icon
          className={cn(
            "w-[20px] h-[20px] transition-colors",
            selected ? "text-ops-accent" : "text-text-tertiary"
          )}
        />
      </div>
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "font-mohave text-body font-medium transition-colors",
            selected ? "text-text-primary" : "text-text-secondary"
          )}
        >
          {label}
        </p>
        <p className="font-kosugi text-[11px] text-text-tertiary">{description}</p>
      </div>
      {selected && (
        <div className="w-[20px] h-[20px] rounded-full bg-ops-accent flex items-center justify-center shrink-0">
          <Check className="w-[12px] h-[12px] text-white" />
        </div>
      )}
    </button>
  );
}

// ─── Step Components ──────────────────────────────────────────────────────────

function StepWorkType() {
  const { workType, setWorkType } = useSetupStore();

  return (
    <div className="space-y-2">
      <div className="text-center mb-3">
        <h2 className="font-mohave text-display text-text-primary">
          What type of work do you do?
        </h2>
        <p className="font-kosugi text-caption text-text-tertiary mt-0.5">
          This helps us customize your command center for your business
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
        {WORK_TYPES.map((type) => (
          <OptionCard
            key={type.id}
            icon={type.icon}
            label={type.label}
            description={type.description}
            selected={workType === type.id}
            onClick={() => setWorkType(type.id)}
          />
        ))}
      </div>
    </div>
  );
}

function StepTrackingPriorities() {
  const { trackingPriorities, toggleTrackingPriority } = useSetupStore();

  return (
    <div className="space-y-2">
      <div className="text-center mb-3">
        <h2 className="font-mohave text-display text-text-primary">
          What&apos;s most important to track?
        </h2>
        <p className="font-kosugi text-caption text-text-tertiary mt-0.5">
          Select all that apply - we&apos;ll prioritize these on your dashboard
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
        {TRACKING_PRIORITIES.map((priority) => (
          <OptionCard
            key={priority.id}
            icon={priority.icon}
            label={priority.label}
            description={priority.description}
            selected={trackingPriorities.includes(priority.id)}
            onClick={() => toggleTrackingPriority(priority.id)}
          />
        ))}
      </div>
    </div>
  );
}

function StepTeamSize() {
  const { teamSize, setTeamSize } = useSetupStore();

  return (
    <div className="space-y-2">
      <div className="text-center mb-3">
        <h2 className="font-mohave text-display text-text-primary">
          How many people on your team?
        </h2>
        <p className="font-kosugi text-caption text-text-tertiary mt-0.5">
          This determines which features and pricing we recommend
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
        {TEAM_SIZES.map((size) => (
          <OptionCard
            key={size.id}
            icon={size.icon}
            label={size.label}
            description={size.description}
            selected={teamSize === size.id}
            onClick={() => setTeamSize(size.id)}
          />
        ))}
      </div>
    </div>
  );
}

function StepCurrentTools() {
  const { currentTools, toggleCurrentTool } = useSetupStore();

  return (
    <div className="space-y-2">
      <div className="text-center mb-3">
        <h2 className="font-mohave text-display text-text-primary">
          What tools do you currently use?
        </h2>
        <p className="font-kosugi text-caption text-text-tertiary mt-0.5">
          Select all that apply - we&apos;ll help you transition
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
        {CURRENT_TOOLS.map((tool) => (
          <OptionCard
            key={tool.id}
            icon={tool.icon}
            label={tool.label}
            description={tool.description}
            selected={currentTools.includes(tool.id)}
            onClick={() => toggleCurrentTool(tool.id)}
          />
        ))}
      </div>
    </div>
  );
}

function StepNeededFeatures() {
  const { neededFeatures, toggleNeededFeature } = useSetupStore();

  return (
    <div className="space-y-2">
      <div className="text-center mb-3">
        <h2 className="font-mohave text-display text-text-primary">
          What features do you need right now?
        </h2>
        <p className="font-kosugi text-caption text-text-tertiary mt-0.5">
          Select what matters most - you can always enable more later
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
        {NEEDED_FEATURES.map((feature) => (
          <OptionCard
            key={feature.id}
            icon={feature.icon}
            label={feature.label}
            description={feature.description}
            selected={neededFeatures.includes(feature.id)}
            onClick={() => toggleNeededFeature(feature.id)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function SetupPage() {
  const router = useRouter();
  const {
    currentStep,
    setCurrentStep,
    workType,
    trackingPriorities,
    teamSize,
    completeSetup,
  } = useSetupStore();

  const canProceed = useCallback(() => {
    switch (currentStep) {
      case 1:
        return workType !== null;
      case 2:
        return trackingPriorities.length > 0;
      case 3:
        return teamSize !== null;
      case 4:
        return true; // optional
      case 5:
        return true; // optional
      default:
        return false;
    }
  }, [currentStep, workType, trackingPriorities, teamSize]);

  const handleNext = useCallback(() => {
    if (currentStep < TOTAL_STEPS) {
      setCurrentStep(currentStep + 1);
    } else {
      completeSetup();
      router.push("/dashboard");
    }
  }, [currentStep, setCurrentStep, completeSetup, router]);

  const handleBack = useCallback(() => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  }, [currentStep, setCurrentStep]);

  const handleSkip = useCallback(() => {
    completeSetup();
    router.push("/dashboard");
  }, [completeSetup, router]);

  return (
    <div className="w-full max-w-[600px] mx-auto">
      {/* Logo */}
      <div className="text-center mb-3">
        <div className="flex items-center justify-center gap-[6px] mb-1">
          <div className="w-[8px] h-[8px] rounded-full bg-ops-accent shadow-[0_0_8px_rgba(65,115,148,0.5)]" />
          <span className="font-mohave text-heading text-text-primary tracking-[0.2em]">
            OPS
          </span>
          <div className="w-[8px] h-[8px] rounded-full bg-ops-accent shadow-[0_0_8px_rgba(65,115,148,0.5)]" />
        </div>
        <p className="font-mono text-[10px] text-text-disabled tracking-widest uppercase">
          Command Center Setup
        </p>
      </div>

      {/* Progress bar */}
      <div className="flex items-center gap-[4px] mb-3">
        {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "flex-1 h-[3px] rounded-full transition-all duration-300",
              i < currentStep
                ? "bg-ops-accent shadow-[0_0_4px_rgba(65,115,148,0.4)]"
                : "bg-background-elevated"
            )}
          />
        ))}
      </div>

      {/* Step indicator */}
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-[10px] text-text-disabled">
          STEP {currentStep} OF {TOTAL_STEPS}
        </span>
        <button
          onClick={handleSkip}
          className="font-mohave text-body-sm text-text-tertiary hover:text-text-secondary transition-colors"
        >
          Skip Setup
        </button>
      </div>

      {/* Step content */}
      <div className="animate-fade-in" key={currentStep}>
        {currentStep === 1 && <StepWorkType />}
        {currentStep === 2 && <StepTrackingPriorities />}
        {currentStep === 3 && <StepTeamSize />}
        {currentStep === 4 && <StepCurrentTools />}
        {currentStep === 5 && <StepNeededFeatures />}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between mt-3 pt-2 border-t border-border">
        <Button
          variant="ghost"
          onClick={handleBack}
          disabled={currentStep === 1}
          className="gap-[4px]"
        >
          <ChevronLeft className="w-[16px] h-[16px]" />
          Back
        </Button>

        <Button
          onClick={handleNext}
          disabled={!canProceed()}
          className="gap-[4px]"
        >
          {currentStep === TOTAL_STEPS ? (
            <>
              <Sparkles className="w-[16px] h-[16px]" />
              Launch Command Center
            </>
          ) : (
            <>
              Continue
              <ChevronRight className="w-[16px] h-[16px]" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
