"use client";

/**
 * Setup Page — 3-phase onboarding flow
 *
 * Phase 1: Identity forms (about you + your company)
 * Phase 2: Interactive starfield galaxy (customization questions)
 * Phase 3: Launch animation → navigate to dashboard
 */

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, ChevronLeft, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trackBeginTrial, trackCompleteOnboarding } from "@/lib/analytics/analytics";
import { useSetupStore } from "@/stores/setup-store";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { getDefaultWidgetInstancesFromSetup } from "@/lib/utils/widget-defaults";
import { IdentityStep1, IdentityStep2 } from "@/components/setup/SetupIdentityStep";
import { SetupStarfield } from "@/components/setup/SetupStarfield";
import { SetupLaunchAnimation } from "@/components/setup/SetupLaunchAnimation";
import type { StarfieldQuestion } from "@/components/setup/SetupStarfield";

// ─── Starfield Questions (placeholder, content TBD) ─────────────────────────

const STARFIELD_QUESTIONS: StarfieldQuestion[] = [
  {
    id: "q1",
    label: "Work Style",
    question: "How does your crew typically work?",
    options: [
      { id: "solo", label: "Solo jobs" },
      { id: "small-teams", label: "Small teams" },
      { id: "large-crews", label: "Large crews" },
    ],
    type: "single",
    answer: null,
    position: { x: -200, y: 150, z: 50 },
  },
  {
    id: "q2",
    label: "Scheduling",
    question: "How do you handle scheduling?",
    options: [
      { id: "paper", label: "Paper calendar" },
      { id: "digital", label: "Digital tools" },
      { id: "none", label: "Wing it" },
    ],
    type: "single",
    answer: null,
    position: { x: 180, y: -120, z: -30 },
  },
  {
    id: "q3",
    label: "Invoicing",
    question: "How do you invoice clients?",
    options: [
      { id: "quickbooks", label: "QuickBooks" },
      { id: "manual", label: "Manual invoices" },
      { id: "none", label: "No system yet" },
    ],
    type: "single",
    answer: null,
    position: { x: -150, y: -180, z: 80 },
  },
  {
    id: "q4",
    label: "Growth",
    question: "What's your top growth goal?",
    options: [
      { id: "clients", label: "More clients" },
      { id: "bigger-jobs", label: "Bigger jobs" },
      { id: "margins", label: "Better margins" },
    ],
    type: "single",
    answer: null,
    position: { x: 220, y: 100, z: -60 },
  },
  {
    id: "q5",
    label: "Communication",
    question: "How does your crew communicate?",
    options: [
      { id: "text", label: "Text messages" },
      { id: "calls", label: "Phone calls" },
      { id: "in-person", label: "In person" },
    ],
    type: "single",
    answer: null,
    position: { x: -50, y: 200, z: -40 },
  },
  {
    id: "q6",
    label: "Tracking",
    question: "What do you track most?",
    options: [
      { id: "hours", label: "Hours worked" },
      { id: "costs", label: "Job costs" },
      { id: "materials", label: "Materials" },
      { id: "nothing", label: "Nothing yet" },
    ],
    type: "single",
    answer: null,
    position: { x: 100, y: -200, z: 70 },
  },
  {
    id: "q7",
    label: "Pain Point",
    question: "Biggest day-to-day headache?",
    options: [
      { id: "paperwork", label: "Paperwork" },
      { id: "payments", label: "Chasing payments" },
      { id: "coordination", label: "Crew coordination" },
    ],
    type: "single",
    answer: null,
    position: { x: -180, y: -50, z: -80 },
  },
  {
    id: "q8",
    label: "Estimates",
    question: "How do you create estimates?",
    options: [
      { id: "spreadsheet", label: "Spreadsheet" },
      { id: "handwritten", label: "Handwritten" },
      { id: "software", label: "Software" },
      { id: "none", label: "Don't estimate" },
    ],
    type: "single",
    answer: null,
    position: { x: 160, y: 160, z: 40 },
  },
];

const MIN_STARFIELD_ANSWERS = 4;

// ─── Page ───────────────────────────────────────────────────────────────────

export default function SetupPage() {
  const router = useRouter();
  const {
    phase,
    setPhase,
    firstName,
    lastName,
    phone,
    companyName,
    industry,
    companySize,
    companyAge,
    setIdentity,
    setCompanyInfo,
    starfieldAnswers,
    setStarfieldAnswer,
    workType,
    trackingPriorities,
    teamSize,
    neededFeatures,
    completeSetup,
  } = useSetupStore();

  const applyWidgetInstances = usePreferencesStore((s) => s.applyWidgetInstances);
  const token = useAuthStore((s) => s.token);

  // Build questions with answers merged in
  const questions: StarfieldQuestion[] = useMemo(
    () =>
      STARFIELD_QUESTIONS.map((q) => ({
        ...q,
        answer: starfieldAnswers[q.id] ?? null,
      })),
    [starfieldAnswers]
  );

  const answeredCount = Object.keys(starfieldAnswers).length;

  // ─── Phase 1 validation ────────────────────────────────────────────────

  const canProceedIdentity1 = firstName.trim() !== "" && lastName.trim() !== "";
  const canProceedIdentity2 =
    companyName.trim() !== "" &&
    industry !== "" &&
    companySize !== "" &&
    companyAge !== "";

  // ─── Navigation ────────────────────────────────────────────────────────

  const handleNext = useCallback(() => {
    if (phase === "identity-1") {
      trackBeginTrial();
      setPhase("identity-2");
    } else if (phase === "identity-2") {
      setPhase("starfield");
    }
  }, [phase, setPhase]);

  const handleBack = useCallback(() => {
    if (phase === "identity-2") {
      setPhase("identity-1");
    } else if (phase === "starfield") {
      setPhase("identity-2");
    }
  }, [phase, setPhase]);

  const handleSkip = useCallback(() => {
    completeSetup();
    trackCompleteOnboarding(false);
    router.push("/dashboard");
  }, [completeSetup, router]);

  const handleStarfieldAnswer = useCallback(
    (questionId: string, answer: string | string[]) => {
      setStarfieldAnswer(questionId, answer);
    },
    [setStarfieldAnswer]
  );

  const handleLaunchFromStarfield = useCallback(() => {
    if (answeredCount >= MIN_STARFIELD_ANSWERS) {
      setPhase("launching");
    }
  }, [answeredCount, setPhase]);

  const handleLaunchComplete = useCallback(async () => {
    // Apply widget defaults
    const instances = getDefaultWidgetInstancesFromSetup({
      workType,
      trackingPriorities,
      teamSize,
      neededFeatures,
    });
    applyWidgetInstances(instances);

    // Save company data via API
    try {
      await fetch("/api/setup/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          firstName,
          lastName,
          phone,
          companyName,
          industry,
          companySize,
          companyAge,
        }),
      });
    } catch {
      // Non-blocking — setup completes even if API save fails
      console.error("[setup] Failed to save company data");
    }

    completeSetup();
    trackCompleteOnboarding(false);
    router.push("/dashboard");
  }, [
    workType,
    trackingPriorities,
    teamSize,
    neededFeatures,
    applyWidgetInstances,
    completeSetup,
    router,
    token,
    firstName,
    lastName,
    phone,
    companyName,
    industry,
    companySize,
    companyAge,
  ]);

  // ─── Starfield phase ──────────────────────────────────────────────────

  if (phase === "starfield") {
    return (
      <div className="fixed inset-0 bg-background">
        <SetupStarfield
          questions={questions}
          onAnswer={handleStarfieldAnswer}
          minRequired={MIN_STARFIELD_ANSWERS}
        />
        {/* Top controls */}
        <div className="absolute top-4 left-4 z-10">
          <button
            onClick={handleBack}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-background-card/80 border border-border text-text-secondary font-mohave text-body-sm hover:border-border-medium transition-colors backdrop-blur-sm"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Back
          </button>
        </div>
        <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
          <button
            onClick={handleSkip}
            className="px-3 py-1.5 font-mohave text-body-sm text-text-tertiary hover:text-text-secondary transition-colors"
          >
            Skip
          </button>
          {answeredCount >= MIN_STARFIELD_ANSWERS && (
            <button
              onClick={handleLaunchFromStarfield}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-ops-accent text-white font-mohave text-body-sm hover:bg-ops-accent/90 transition-colors shadow-[0_0_12px_rgba(65,115,148,0.3)]"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Launch
            </button>
          )}
        </div>
      </div>
    );
  }

  // ─── Launch phase ─────────────────────────────────────────────────────

  if (phase === "launching") {
    return (
      <div className="fixed inset-0 bg-background">
        <SetupLaunchAnimation
          questions={questions}
          onComplete={handleLaunchComplete}
        />
      </div>
    );
  }

  // ─── Identity phases ──────────────────────────────────────────────────

  const canProceed = phase === "identity-1" ? canProceedIdentity1 : canProceedIdentity2;
  const stepLabel = phase === "identity-1" ? "1 OF 2" : "2 OF 2";

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
        <div className="flex-1 h-[3px] rounded-full bg-ops-accent shadow-[0_0_4px_rgba(65,115,148,0.4)]" />
        <div
          className={`flex-1 h-[3px] rounded-full transition-all duration-300 ${
            phase === "identity-2"
              ? "bg-ops-accent shadow-[0_0_4px_rgba(65,115,148,0.4)]"
              : "bg-background-elevated"
          }`}
        />
      </div>

      {/* Step indicator */}
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-[10px] text-text-disabled">
          STEP {stepLabel}
        </span>
        <button
          onClick={handleSkip}
          className="font-mohave text-body-sm text-text-tertiary hover:text-text-secondary transition-colors"
        >
          Skip Setup
        </button>
      </div>

      {/* Step content */}
      <div className="animate-fade-in" key={phase}>
        {phase === "identity-1" && (
          <IdentityStep1
            firstName={firstName}
            lastName={lastName}
            phone={phone}
            onUpdate={(data) => setIdentity(data)}
          />
        )}
        {phase === "identity-2" && (
          <IdentityStep2
            companyName={companyName}
            industry={industry}
            companySize={companySize}
            companyAge={companyAge}
            onUpdate={(data) => setCompanyInfo(data)}
          />
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between mt-3 pt-2 border-t border-border">
        <Button
          variant="ghost"
          onClick={handleBack}
          disabled={phase === "identity-1"}
          className="gap-[4px]"
        >
          <ChevronLeft className="w-[16px] h-[16px]" />
          Back
        </Button>

        <Button onClick={handleNext} disabled={!canProceed} className="gap-[4px]">
          Continue
          <ChevronRight className="w-[16px] h-[16px]" />
        </Button>
      </div>
    </div>
  );
}
