"use client";

/**
 * Setup Page — 3-phase onboarding flow
 *
 * Phase 1: Identity forms (about you + your company)
 * Phase 2: Interactive starfield galaxy (customization questions)
 * Phase 3: Launch animation → navigate to dashboard
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronRight, ChevronLeft } from "lucide-react";
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
import { useAuthStore } from "@/lib/store/auth-store";
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
    industries,
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

  // Pre-populate from auth store if available
  const authUser = useAuthStore((s) => s.currentUser);
  const authCompany = useAuthStore((s) => s.company);
  const hasPrePopulated = useRef(false);

  useEffect(() => {
    // Wait until auth data is available before pre-populating
    if (!authUser && !authCompany) return;
    if (hasPrePopulated.current) return;
    hasPrePopulated.current = true;

    // Pre-fill identity fields from auth user (only if empty)
    if (authUser) {
      const identityUpdates: Record<string, string> = {};
      if (!firstName && authUser.firstName) identityUpdates.firstName = authUser.firstName;
      if (!lastName && authUser.lastName) identityUpdates.lastName = authUser.lastName;
      if (!phone && authUser.phone) identityUpdates.phone = authUser.phone;
      if (Object.keys(identityUpdates).length > 0) setIdentity(identityUpdates);
    }

    // Pre-fill company fields from auth company (only if empty)
    if (authCompany) {
      const companyUpdates: Record<string, unknown> = {};
      if (!companyName && authCompany.name) companyUpdates.companyName = authCompany.name;
      if (industries.length === 0 && authCompany.industries?.length > 0) companyUpdates.industries = authCompany.industries;
      if (!companySize && authCompany.companySize) companyUpdates.companySize = authCompany.companySize;
      if (!companyAge && authCompany.companyAge) companyUpdates.companyAge = authCompany.companyAge;
      if (Object.keys(companyUpdates).length > 0) setCompanyInfo(companyUpdates as Parameters<typeof setCompanyInfo>[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser, authCompany]);

  const answeredCount = Object.keys(starfieldAnswers).length;

  // Compute visible questions (accounting for conditional visibility)
  const visibleQuestions = useMemo(() => {
    return STARFIELD_QUESTIONS.filter((q) => {
      if (!q.conditionalOn) return true;
      const depAnswer = starfieldAnswers[q.conditionalOn.questionId];
      return depAnswer != null && depAnswer !== q.conditionalOn.excludeAnswer;
    });
  }, [starfieldAnswers]);

  const allAnswered = visibleQuestions.length > 0 &&
    visibleQuestions.every((q) => starfieldAnswers[q.id] != null);

  const [workspaceReady, setWorkspaceReady] = useState(false);
  const workspacePromiseRef = useRef<Promise<void> | null>(null);

  // ─── Focus management ──────────────────────────────────────────────────

  const headingRef = useRef<HTMLHeadingElement>(null);
  const [phaseAnnouncement, setPhaseAnnouncement] = useState("");

  // Move focus to heading and announce phase changes
  useEffect(() => {
    if (phase === "identity") {
      setPhaseAnnouncement("Step 1 of 2: About You");
    } else if (phase === "company") {
      setPhaseAnnouncement("Step 2 of 2: Your Company");
    } else if (phase === "starfield") {
      setPhaseAnnouncement("Customization questionnaire");
    }

    // Focus the heading after a short delay to let the DOM update
    const timer = setTimeout(() => {
      headingRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, [phase]);

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
            data: { companyName, industries, companySize, companyAge },
          }),
        });
      }
    } catch {
      // Non-blocking
    }
    setPhase("starfield");
  }, [completeStep, setPhase, companyName, industries, companySize, companyAge]);

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

  const handleLaunchFromStarfield = useCallback(async () => {
    if (answeredCount >= MIN_STARFIELD_ANSWERS) {
      const starfieldDuration = Date.now() - starfieldStartRef.current;
      trackStarfieldLaunched(
        answeredCount,
        Object.keys(starfieldAnswers),
        starfieldDuration
      );
      setPhase("launching");

      // Fire workspace setup in parallel with animation (safety-net, idempotent)
      workspacePromiseRef.current = (async () => {
        try {
          const token = await getAuthToken();
          if (token) {
            const res = await fetch("/api/setup/initialize-workspace", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token }),
            });
            if (res.ok) setWorkspaceReady(true);
          }
        } catch {
          // Non-blocking — primary call happens server-side in /api/setup/progress
        }
      })();
    }
  }, [answeredCount, starfieldAnswers, setPhase]);

  const handleLaunchComplete = useCallback(async () => {
    // 0. Wait for workspace setup (max 3s so we don't block forever)
    if (workspacePromiseRef.current) {
      await Promise.race([
        workspacePromiseRef.current,
        new Promise((r) => setTimeout(r, 3000)),
      ]);
    }

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
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.0, ease: "easeOut" }}
        className="fixed inset-0 bg-background"
      >
        {/* Phase announcement for screen readers */}
        <div className="sr-only" aria-live="polite" role="status">
          {phaseAnnouncement}
        </div>
        <SetupStarfield
          questions={STARFIELD_QUESTIONS}
          starfieldAnswers={starfieldAnswers}
          onAnswer={handleStarfieldAnswer}
          minRequired={MIN_STARFIELD_ANSWERS}
        />
        {/* Top controls */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1">
          <button
            onClick={handleBack}
            aria-label="Back to company information"
            className="flex items-center gap-0.5 px-2 min-h-[56px] min-w-[56px] rounded-sm bg-[rgba(10,10,10,0.70)] backdrop-blur-[20px] backdrop-saturate-[1.2] border border-[rgba(255,255,255,0.08)] text-text-secondary font-mohave text-body-sm uppercase hover:border-[rgba(255,255,255,0.18)] transition-colors"
          >
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            Back
          </button>
          <button
            onClick={handleSkip}
            aria-label="Skip questionnaire and go to dashboard"
            className="px-2 min-h-[56px] font-mohave text-body-sm uppercase text-text-disabled hover:text-text-tertiary transition-colors"
          >
            Skip
          </button>
          {answeredCount >= MIN_STARFIELD_ANSWERS && !allAnswered && (
            <button
              onClick={handleLaunchFromStarfield}
              aria-label="Launch your personalized dashboard"
              className="px-3 min-h-[56px] rounded-sm bg-ops-accent border border-ops-accent text-text-primary font-mohave text-body-sm uppercase tracking-[0.08em] hover:bg-ops-accent-hover transition-colors"
            >
              Launch
            </button>
          )}
        </div>

        {/* Centered launch button — appears when all questions answered */}
        {allAnswered && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-start gap-1"
          >
            <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-[0.15em]">
              [all set]
            </span>
            <button
              onClick={handleLaunchFromStarfield}
              aria-label="Launch your personalized dashboard"
              className="px-6 min-h-[56px] rounded-sm bg-ops-accent border border-ops-accent text-text-primary font-mohave text-body-lg uppercase tracking-[0.08em] hover:bg-ops-accent-hover transition-all duration-200"
            >
              LAUNCH
            </button>
          </motion.div>
        )}
      </motion.div>
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
          workspaceReady={workspaceReady}
        />
      </div>
    );
  }

  // ─── Identity phases ──────────────────────────────────────────────────

  const stepNum = phase === "identity" ? 1 : 2;

  return (
    <div className="w-full max-w-[480px] mx-auto">
      {/* Phase announcement for screen readers */}
      <div className="sr-only" aria-live="polite" role="status">
        {phaseAnnouncement}
      </div>

      {/* Logo */}
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="font-mohave text-display-lg text-text-primary tracking-[0.25em] uppercase mb-4 focus:outline-none"
      >
        OPS
      </h1>

      {/* Glass surface card */}
      <div className="bg-[rgba(10,10,10,0.70)] backdrop-blur-[20px] backdrop-saturate-[1.2] border border-[rgba(255,255,255,0.08)] rounded-sm p-3">
        {/* Progress bar + step label */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="font-mohave text-caption-sm text-text-tertiary uppercase tracking-[0.08em]">
              STEP {stepNum} OF 2
            </span>
            <button
              onClick={handleSkip}
              aria-label="Skip setup and go to dashboard"
              className="font-mohave text-caption-sm text-text-disabled uppercase tracking-[0.08em] hover:text-text-tertiary transition-colors min-h-[56px] flex items-center"
            >
              Skip
            </button>
          </div>
          <div
            className="flex items-center gap-1"
            role="progressbar"
            aria-valuenow={stepNum}
            aria-valuemin={1}
            aria-valuemax={2}
            aria-label={`Setup progress: step ${stepNum} of 2`}
          >
            <div
              className="flex-1 h-[2px] bg-text-primary transition-all duration-200"
              aria-hidden="true"
            />
            <div
              className={`flex-1 h-[2px] transition-all duration-200 ${
                phase === "company"
                  ? "bg-text-primary"
                  : "bg-[rgba(255,255,255,0.08)]"
              }`}
              aria-hidden="true"
            />
          </div>
        </div>

        {/* Separator */}
        <div className="border-t border-[rgba(255,255,255,0.08)] mb-3" />

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
              industries={industries}
              companySize={companySize}
              companyAge={companyAge}
              onUpdate={(data) => setCompanyInfo(data)}
            />
          )}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-3 pt-2 border-t border-[rgba(255,255,255,0.08)]">
          <button
            onClick={handleBack}
            disabled={phase === "identity"}
            aria-label={phase === "company" ? "Back to personal information" : "Back"}
            className="flex items-center gap-0.5 font-mohave text-body-sm uppercase text-text-secondary hover:text-text-primary disabled:opacity-0 disabled:pointer-events-none transition-all duration-150 min-h-[56px]"
          >
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            Back
          </button>

          <button
            onClick={handleNext}
            aria-label={phase === "identity" ? "Continue to company information" : "Continue to questionnaire"}
            className="flex items-center gap-0.5 font-mohave text-button uppercase bg-ops-accent text-text-primary px-3 min-h-[56px] rounded-sm border border-ops-accent hover:bg-ops-accent-hover transition-all duration-150"
          >
            Next
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
