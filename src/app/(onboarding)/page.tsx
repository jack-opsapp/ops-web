"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  RefreshCw,
  AlertTriangle,
  Wrench,
  Home,
  DollarSign,
  Gauge,
  Users,
  GitBranch,
  UserCheck,
  FileSpreadsheet,
  PenTool,
  CalendarDays,
  Receipt,
  Target,
  Wallet,
  UsersRound,
  ArrowRight,
  ArrowLeft,
  Check,
  LayoutDashboard,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  useSetupStore,
  type WorkType,
  type TrackingPriority,
  type TeamSize,
  type CurrentTool,
  type NeededFeature,
} from "@/stores/setup-store";
import { Button } from "@/components/ui/button";

const TOTAL_STEPS = 5;

interface OptionCardProps {
  icon: React.ReactNode;
  label: string;
  description?: string;
  selected: boolean;
  onClick: () => void;
}

function OptionCard({ icon, label, description, selected, onClick }: OptionCardProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 p-2 rounded-lg border transition-all duration-200",
        "hover:border-ops-accent hover:shadow-glow-accent",
        "active:scale-[0.98]",
        selected
          ? "bg-ops-accent-muted border-ops-accent shadow-glow-accent"
          : "bg-background-card border-border"
      )}
    >
      <div
        className={cn(
          "w-[48px] h-[48px] rounded-lg flex items-center justify-center transition-colors",
          selected ? "bg-ops-accent/20 text-ops-accent" : "bg-background-elevated text-text-tertiary"
        )}
      >
        {icon}
      </div>
      <span
        className={cn(
          "font-mohave text-body text-center",
          selected ? "text-text-primary" : "text-text-secondary"
        )}
      >
        {label}
      </span>
      {description && (
        <span className="font-kosugi text-[11px] text-text-tertiary text-center">
          {description}
        </span>
      )}
      {selected && (
        <div className="w-[20px] h-[20px] rounded-full bg-ops-accent flex items-center justify-center">
          <Check className="w-[12px] h-[12px] text-white" />
        </div>
      )}
    </button>
  );
}

// Step 1: Work Type
function StepWorkType() {
  const { workType, setWorkType } = useSetupStore();

  const options: { value: WorkType; label: string; description: string; icon: React.ReactNode }[] = [
    { value: "recurring", label: "Recurring", description: "Regular scheduled visits", icon: <RefreshCw className="w-[24px] h-[24px]" /> },
    { value: "emergency", label: "Emergency", description: "On-call / urgent work", icon: <AlertTriangle className="w-[24px] h-[24px]" /> },
    { value: "project-based", label: "Project-Based", description: "Multi-phase projects", icon: <Wrench className="w-[24px] h-[24px]" /> },
    { value: "single-visit", label: "Single Visit", description: "One-time service calls", icon: <Home className="w-[24px] h-[24px]" /> },
  ];

  return (
    <div className="space-y-3">
      <div className="text-center">
        <h2 className="font-mohave text-display text-text-primary">
          What type of work do you do?
        </h2>
        <p className="font-kosugi text-caption text-text-tertiary mt-1">
          This helps us optimize your dashboard layout
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {options.map((opt) => (
          <OptionCard
            key={opt.value}
            icon={opt.icon}
            label={opt.label}
            description={opt.description}
            selected={workType === opt.value}
            onClick={() => setWorkType(opt.value)}
          />
        ))}
      </div>
    </div>
  );
}

// Step 2: Tracking Priorities (multi-select)
function StepTrackingPriorities() {
  const { trackingPriorities, toggleTrackingPriority } = useSetupStore();

  const options: { value: TrackingPriority; label: string; description: string; icon: React.ReactNode }[] = [
    { value: "revenue", label: "Revenue", description: "Income & cash flow", icon: <DollarSign className="w-[24px] h-[24px]" /> },
    { value: "efficiency", label: "Efficiency", description: "Time & scheduling", icon: <Gauge className="w-[24px] h-[24px]" /> },
    { value: "customers", label: "Customers", description: "Client relationships", icon: <Users className="w-[24px] h-[24px]" /> },
    { value: "pipeline", label: "Pipeline", description: "Leads & quotes", icon: <GitBranch className="w-[24px] h-[24px]" /> },
  ];

  return (
    <div className="space-y-3">
      <div className="text-center">
        <h2 className="font-mohave text-display text-text-primary">
          What&apos;s most important to track?
        </h2>
        <p className="font-kosugi text-caption text-text-tertiary mt-1">
          Select all that apply - we&apos;ll prioritize these on your dashboard
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {options.map((opt) => (
          <OptionCard
            key={opt.value}
            icon={opt.icon}
            label={opt.label}
            description={opt.description}
            selected={trackingPriorities.includes(opt.value)}
            onClick={() => toggleTrackingPriority(opt.value)}
          />
        ))}
      </div>
    </div>
  );
}

// Step 3: Team Size
function StepTeamSize() {
  const { teamSize, setTeamSize } = useSetupStore();

  const options: { value: TeamSize; label: string; description: string; icon: React.ReactNode }[] = [
    { value: "solo", label: "Solo", description: "Just me", icon: <UserCheck className="w-[24px] h-[24px]" /> },
    { value: "2-5", label: "2-5", description: "Small team", icon: <Users className="w-[24px] h-[24px]" /> },
    { value: "6-10", label: "6-10", description: "Growing team", icon: <UsersRound className="w-[24px] h-[24px]" /> },
    { value: "11+", label: "11+", description: "Large operation", icon: <LayoutDashboard className="w-[24px] h-[24px]" /> },
  ];

  return (
    <div className="space-y-3">
      <div className="text-center">
        <h2 className="font-mohave text-display text-text-primary">
          How many people on your team?
        </h2>
        <p className="font-kosugi text-caption text-text-tertiary mt-1">
          Determines crew management features
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {options.map((opt) => (
          <OptionCard
            key={opt.value}
            icon={opt.icon}
            label={opt.label}
            description={opt.description}
            selected={teamSize === opt.value}
            onClick={() => setTeamSize(opt.value)}
          />
        ))}
      </div>
    </div>
  );
}

// Step 4: Current Tools (multi-select)
function StepCurrentTools() {
  const { currentTools, toggleCurrentTool } = useSetupStore();

  const options: { value: CurrentTool; label: string; icon: React.ReactNode }[] = [
    { value: "quickbooks", label: "QuickBooks", icon: <DollarSign className="w-[24px] h-[24px]" /> },
    { value: "jobber", label: "Jobber", icon: <Wrench className="w-[24px] h-[24px]" /> },
    { value: "spreadsheets", label: "Spreadsheets", icon: <FileSpreadsheet className="w-[24px] h-[24px]" /> },
    { value: "pen-paper", label: "Pen & Paper", icon: <PenTool className="w-[24px] h-[24px]" /> },
  ];

  return (
    <div className="space-y-3">
      <div className="text-center">
        <h2 className="font-mohave text-display text-text-primary">
          What tools do you currently use?
        </h2>
        <p className="font-kosugi text-caption text-text-tertiary mt-1">
          Select all that apply - helps us with data migration
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {options.map((opt) => (
          <OptionCard
            key={opt.value}
            icon={opt.icon}
            label={opt.label}
            selected={currentTools.includes(opt.value)}
            onClick={() => toggleCurrentTool(opt.value)}
          />
        ))}
      </div>
    </div>
  );
}

// Step 5: Needed Features (multi-select)
function StepNeededFeatures() {
  const { neededFeatures, toggleNeededFeature } = useSetupStore();

  const options: { value: NeededFeature; label: string; description: string; icon: React.ReactNode }[] = [
    { value: "scheduling", label: "Scheduling", description: "Calendar & dispatch", icon: <CalendarDays className="w-[24px] h-[24px]" /> },
    { value: "invoicing", label: "Invoicing", description: "Bills & payments", icon: <Receipt className="w-[24px] h-[24px]" /> },
    { value: "leads", label: "Leads", description: "CRM & pipeline", icon: <Target className="w-[24px] h-[24px]" /> },
    { value: "expenses", label: "Expenses", description: "Cost tracking", icon: <Wallet className="w-[24px] h-[24px]" /> },
    { value: "crew", label: "Crew Management", description: "Team & roles", icon: <UsersRound className="w-[24px] h-[24px]" /> },
  ];

  return (
    <div className="space-y-3">
      <div className="text-center">
        <h2 className="font-mohave text-display text-text-primary">
          What features do you need right now?
        </h2>
        <p className="font-kosugi text-caption text-text-tertiary mt-1">
          Select your priorities - you can always enable more later
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {options.map((opt) => (
          <OptionCard
            key={opt.value}
            icon={opt.icon}
            label={opt.label}
            description={opt.description}
            selected={neededFeatures.includes(opt.value)}
            onClick={() => toggleNeededFeature(opt.value)}
          />
        ))}
      </div>
    </div>
  );
}

// Preview step after survey
function StepPreview() {
  const { workType, trackingPriorities, neededFeatures } = useSetupStore();

  return (
    <div className="space-y-3">
      <div className="text-center">
        <h2 className="font-mohave text-display text-text-primary">
          Here&apos;s your command center
        </h2>
        <p className="font-kosugi text-caption text-text-tertiary mt-1">
          Personalized for your {workType?.replace("-", " ")} workflow
        </p>
      </div>

      {/* Preview mockup */}
      <div className="bg-background-card border border-border rounded-lg p-2 space-y-2">
        {/* Mini dashboard preview */}
        <div className="grid grid-cols-3 gap-1">
          {trackingPriorities.slice(0, 3).map((priority) => (
            <div
              key={priority}
              className="bg-background-panel border border-border-subtle rounded p-1.5 text-center"
            >
              <span className="font-mono text-data-lg text-ops-accent">--</span>
              <p className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-wider mt-[4px]">
                {priority}
              </p>
            </div>
          ))}
        </div>

        {/* Feature tiles */}
        <div className="flex flex-wrap gap-1">
          {neededFeatures.map((feature) => (
            <span
              key={feature}
              className="inline-flex items-center gap-[4px] px-1 py-[4px] rounded bg-ops-accent-muted text-ops-accent font-kosugi text-[11px] uppercase tracking-wider"
            >
              <Zap className="w-[12px] h-[12px]" />
              {feature}
            </span>
          ))}
        </div>

        {/* Animated scan line */}
        <div className="relative h-[2px] bg-background-elevated overflow-hidden rounded-full">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-ops-accent to-transparent animate-scan-line" />
        </div>
      </div>

      <p className="font-kosugi text-[11px] text-text-tertiary text-center">
        You can customize everything later in Settings
      </p>
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const {
    currentStep,
    setCurrentStep,
    workType,
    trackingPriorities,
    teamSize,
    neededFeatures,
    completeSetup,
  } = useSetupStore();
  const [showPreview, setShowPreview] = useState(false);

  const canProceed = useCallback(() => {
    switch (currentStep) {
      case 1:
        return workType !== null;
      case 2:
        return trackingPriorities.length > 0;
      case 3:
        return teamSize !== null;
      case 4:
        return true; // Current tools is optional
      case 5:
        return neededFeatures.length > 0;
      default:
        return false;
    }
  }, [currentStep, workType, trackingPriorities, teamSize, neededFeatures]);

  const handleNext = useCallback(() => {
    if (showPreview) {
      completeSetup();
      router.push("/projects");
      return;
    }
    if (currentStep < TOTAL_STEPS) {
      setCurrentStep(currentStep + 1);
    } else {
      setShowPreview(true);
    }
  }, [currentStep, showPreview, setCurrentStep, completeSetup, router]);

  const handleBack = useCallback(() => {
    if (showPreview) {
      setShowPreview(false);
      return;
    }
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  }, [currentStep, showPreview, setCurrentStep]);

  const handleSkip = useCallback(() => {
    completeSetup();
    router.push("/projects");
  }, [completeSetup, router]);

  const displayStep = showPreview ? TOTAL_STEPS + 1 : currentStep;

  return (
    <div className="w-full max-w-[520px] animate-fade-in">
      {/* Progress bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <span className="font-kosugi text-[11px] text-text-tertiary uppercase tracking-widest">
            {showPreview ? "Ready" : `Step ${currentStep} of ${TOTAL_STEPS}`}
          </span>
          <button
            onClick={handleSkip}
            className="font-mohave text-body-sm text-text-tertiary hover:text-text-secondary transition-colors"
          >
            Skip setup
          </button>
        </div>
        <div className="h-[3px] bg-background-card rounded-full overflow-hidden">
          <div
            className="h-full bg-ops-accent rounded-full transition-all duration-500 ease-out"
            style={{
              width: `${(displayStep / (TOTAL_STEPS + 1)) * 100}%`,
            }}
          />
        </div>
      </div>

      {/* Step content with transitions */}
      <div className="bg-background-panel border border-border rounded-lg p-3">
        <div key={displayStep} className="animate-slide-up">
          {showPreview ? (
            <StepPreview />
          ) : (
            <>
              {currentStep === 1 && <StepWorkType />}
              {currentStep === 2 && <StepTrackingPriorities />}
              {currentStep === 3 && <StepTeamSize />}
              {currentStep === 4 && <StepCurrentTools />}
              {currentStep === 5 && <StepNeededFeatures />}
            </>
          )}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between mt-3">
        <Button
          variant="ghost"
          onClick={handleBack}
          disabled={currentStep === 1 && !showPreview}
          className="gap-[6px]"
        >
          <ArrowLeft className="w-[16px] h-[16px]" />
          Back
        </Button>

        <Button
          onClick={handleNext}
          disabled={!showPreview && !canProceed()}
          className="gap-[6px]"
        >
          {showPreview ? (
            <>
              Launch Command Center
              <Zap className="w-[16px] h-[16px]" />
            </>
          ) : currentStep === TOTAL_STEPS ? (
            <>
              Preview
              <ArrowRight className="w-[16px] h-[16px]" />
            </>
          ) : (
            <>
              Next
              <ArrowRight className="w-[16px] h-[16px]" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
