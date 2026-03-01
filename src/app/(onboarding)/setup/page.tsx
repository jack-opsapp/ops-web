"use client";

/**
 * Setup Page — 3-phase onboarding flow
 *
 * Phase 1: Identity forms (about you + your company)
 * Phase 2: Interactive starfield galaxy (customization questions)
 * Phase 3: Launch animation → navigate to dashboard
 */

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, ChevronLeft, Sparkles } from "lucide-react";
import { getAuth } from "firebase/auth";
import { Button } from "@/components/ui/button";
import {
  trackSetupStarted,
  trackSetupStepViewed,
  trackSetupStepCompleted,
  trackSetupStepSkipped,
  trackSetupCompleted,
  trackStarfieldEntered,
  trackStarfieldLaunched,
  trackStarfieldExited,
} from "@/lib/analytics/analytics";
import { useSetupStore, STARFIELD_QUESTIONS } from "@/stores/setup-store";
import { usePreferencesStore } from "@/stores/preferences-store";
import { getDefaultWidgetInstancesFromSetup } from "@/lib/utils/widget-defaults";
import { IdentityStep1, IdentityStep2 } from "@/components/setup/SetupIdentityStep";
import { SetupStarfield } from "@/components/setup/SetupStarfield";
import { SetupLaunchAnimation } from "@/components/setup/SetupLaunchAnimation";
const MIN_STARFIELD_ANSWERS = 4;

// ─── Auth helper ──────────────────────────────────────────────────────────────

const getAuthToken = async (): Promise<string | null> => {
  const auth = getAuth();
  const user = auth.currentUser;
  return user ? await user.getIdToken() : null;
};

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
    steps,
    completeStep,
    completeSetup,
  } = useSetupStore();

  const applyWidgetInstances = usePreferencesStore((s) => s.applyWidgetInstances);

  const answeredCount = Object.keys(starfieldAnswers).length;

  // ─── Analytics timing refs ─────────────────────────────────────────────

  const setupStartRef = useRef(Date.now());
  const stepStartRef = useRef(Date.now());
  const starfieldStartRef = useRef(0);

  // Fire setup_started once on mount
  useEffect(() => {
    setupStartRef.current = Date.now();
    trackSetupStarted("direct");
  }, []);

  // Fire step_viewed when phase changes (identity / company / starfield)
  useEffect(() => {
    if (phase === "identity" || phase === "company" || phase === "starfield") {
      stepStartRef.current = Date.now();
      trackSetupStepViewed(phase);
      if (phase === "starfield") {
        starfieldStartRef.current = Date.now();
        trackStarfieldEntered();
      }
    }
  }, [phase]);

  // ─── Navigation ────────────────────────────────────────────────────────

  const handleIdentityNext = useCallback(async () => {
    const duration_ms = Date.now() - stepStartRef.current;
    trackSetupStepCompleted("identity", duration_ms);
    completeStep("identity");
    try {
      const token = await getAuthToken();
      if (token) {
        await fetch("/api/setup/progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            step: "identity",
            data: { firstName, lastName, phone },
          }),
        });
      }
    } catch {
      // Non-blocking — continue even if save fails
    }
    setPhase("company");
  }, [completeStep, setPhase, firstName, lastName, phone]);

  const handleCompanyNext = useCallback(async () => {
    const duration_ms = Date.now() - stepStartRef.current;
    trackSetupStepCompleted("company", duration_ms);
    completeStep("company");
    try {
      const token = await getAuthToken();
      if (token) {
        await fetch("/api/setup/progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            step: "company",
            data: { companyName, industry, companySize, companyAge },
          }),
        });
      }
    } catch {
      // Non-blocking
    }
    setPhase("starfield");
  }, [completeStep, setPhase, companyName, industry, companySize, companyAge]);

  const handleNext = useCallback(() => {
    if (phase === "identity") {
      handleIdentityNext();
    } else if (phase === "company") {
      handleCompanyNext();
    }
  }, [phase, handleIdentityNext, handleCompanyNext]);

  const handleBack = useCallback(() => {
    if (phase === "company") {
      setPhase("identity");
    } else if (phase === "starfield") {
      trackStarfieldExited(answeredCount, "back");
      setPhase("company");
    }
  }, [phase, setPhase, answeredCount]);

  const handleSkip = useCallback(async () => {
    if (phase === "starfield") {
      trackStarfieldExited(answeredCount, "skip");
    }
    trackSetupStepSkipped(phase, "button");
    const totalDuration = Date.now() - setupStartRef.current;
    trackSetupCompleted("skipped", [], totalDuration);
    try {
      const token = await getAuthToken();
      if (token) {
        await fetch("/api/setup/progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ step: phase, token }),
        });
      }
    } catch {
      // Non-blocking
    }
    completeSetup();
    router.push("/dashboard");
  }, [completeSetup, router, phase, answeredCount]);

  const handleStarfieldAnswer = useCallback(
    (questionId: string, answer: string | number) => {
      setStarfieldAnswer(questionId, answer);
    },
    [setStarfieldAnswer]
  );

  const handleLaunchFromStarfield = useCallback(() => {
    if (answeredCount >= MIN_STARFIELD_ANSWERS) {
      const starfieldDuration = Date.now() - starfieldStartRef.current;
      trackStarfieldLaunched(
        answeredCount,
        Object.keys(starfieldAnswers),
        starfieldDuration
      );
      setPhase("launching");
    }
  }, [answeredCount, starfieldAnswers, setPhase]);

  const handleLaunchComplete = useCallback(async () => {
    // 1. Save starfield answers
    completeStep("starfield");

    // 2. Personalize dashboard
    const instances = getDefaultWidgetInstancesFromSetup(starfieldAnswers, companySize);
    applyWidgetInstances(instances);

    // 3. Save to server
    try {
      const token = await getAuthToken();
      if (token) {
        // Save starfield progress
        await fetch("/api/setup/progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            step: "starfield",
            data: { starfieldAnswers },
          }),
        });
        // Mark onboarding complete
        await fetch("/api/setup/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
      }
    } catch {
      // Non-blocking
    }

    completeSetup();
    const stepsCompleted = (Object.entries(steps) as [string, boolean][])
      .filter(([, done]) => done)
      .map(([name]) => name);
    // starfield was just completed above via completeStep
    if (!stepsCompleted.includes("starfield")) stepsCompleted.push("starfield");
    const method = stepsCompleted.length >= 3 ? "full" : "partial";
    const totalDuration = Date.now() - setupStartRef.current;
    trackSetupCompleted(method, stepsCompleted, totalDuration);
    router.push("/dashboard");
  }, [
    completeStep,
    starfieldAnswers,
    companySize,
    applyWidgetInstances,
    completeSetup,
    steps,
    router,
  ]);

  // ─── Starfield phase ──────────────────────────────────────────────────

  if (phase === "starfield") {
    return (
      <div className="fixed inset-0 bg-background">
        <SetupStarfield
          questions={STARFIELD_QUESTIONS}
          starfieldAnswers={starfieldAnswers}
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
            Skip for now
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
          questions={STARFIELD_QUESTIONS}
          starfieldAnswers={starfieldAnswers}
          onComplete={handleLaunchComplete}
        />
      </div>
    );
  }

  // ─── Identity phases ──────────────────────────────────────────────────

  const stepLabel = phase === "identity" ? "1 OF 2" : "2 OF 2";

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
            phase === "company"
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
          Skip for now
        </button>
      </div>

      {/* Step content */}
      <div className="animate-fade-in" key={phase}>
        {phase === "identity" && (
          <IdentityStep1
            firstName={firstName}
            lastName={lastName}
            phone={phone}
            onUpdate={(data) => setIdentity(data)}
          />
        )}
        {phase === "company" && (
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
          disabled={phase === "identity"}
          className="gap-[4px]"
        >
          <ChevronLeft className="w-[16px] h-[16px]" />
          Back
        </Button>

        <Button onClick={handleNext} className="gap-[4px]">
          Next
          <ChevronRight className="w-[16px] h-[16px]" />
        </Button>
      </div>
    </div>
  );
}
