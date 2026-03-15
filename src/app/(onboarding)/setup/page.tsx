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
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { getAuth } from "firebase/auth";
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
import { signOut } from "@/lib/firebase/auth";
import { LogOut } from "lucide-react";
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
    weatherDependent,
    setIdentity,
    setCompanyInfo,
    starfieldAnswers,
    setStarfieldAnswer,
    steps,
    completeStep,
    completeSetup,
    reset: resetSetupStore,
  } = useSetupStore();

  const applyWidgetInstances = usePreferencesStore((s) => s.applyWidgetInstances);

  // Pre-populate from auth store if available
  const authUser = useAuthStore((s) => s.currentUser);
  const authCompany = useAuthStore((s) => s.company);
  const setUser = useAuthStore((s) => s.setUser);
  const hasPrePopulated = useRef(false);

  // Avatar URL: prefer Supabase user, fallback to Firebase auth
  const avatarUrl = authUser?.profileImageURL
    || getAuth()?.currentUser?.photoURL
    || null;

  // ─── Guard: already completed → redirect to dashboard ─────────────────
  useEffect(() => {
    if (authUser?.onboardingCompleted?.web) {
      resetSetupStore();
      router.replace("/dashboard");
    }
  }, [authUser, resetSetupStore, router]);

  // ─── Guard: employees should never see employer setup ──────────────────
  useEffect(() => {
    if (authUser && authUser.companyId && !authUser.isCompanyAdmin) {
      router.replace("/employee-setup");
    }
  }, [authUser, router]);

  // ─── Guard: stale persisted phase → reset to identity ─────────────────
  // If the page loads with phase "complete" or "launching" (from localStorage
  // after a previous interrupted flow), reset to the beginning.
  useEffect(() => {
    if (phase === "complete" || phase === "launching") {
      resetSetupStore();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

    // Pre-fill starfield answers from server (for returning users)
    if (
      authUser?.setupProgress?.starfield_answers &&
      Object.keys(starfieldAnswers).length === 0
    ) {
      for (const [qId, answer] of Object.entries(authUser.setupProgress.starfield_answers)) {
        setStarfieldAnswer(qId, answer);
      }
    }

    // If user already completed identity + company steps, skip to starfield
    if (
      authUser?.setupProgress?.steps?.identity &&
      authUser?.setupProgress?.steps?.company &&
      phase === "identity"
    ) {
      completeStep("identity");
      completeStep("company");
      setPhase("starfield");
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
  const [starfieldFocused, setStarfieldFocused] = useState(false);

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
            data: { companyName, industries, companySize, companyAge, weatherDependent },
          }),
        });
      }
    } catch {
      // Non-blocking
    }
    setPhase("starfield");
  }, [completeStep, setPhase, companyName, industries, companySize, companyAge, weatherDependent]);

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
        // Save current step progress (only for valid steps)
        if (phase === "identity" || phase === "company" || phase === "starfield") {
          await fetch("/api/setup/progress", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ step: phase, token }),
          });
        }
        // Mark onboarding complete so the dashboard gate doesn't redirect back
        await fetch("/api/setup/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
      }
    } catch {
      // Non-blocking
    }

    // Update auth store so useSetupGate sees onboarding as complete
    if (authUser) {
      setUser({
        ...authUser,
        onboardingCompleted: { ...authUser.onboardingCompleted, web: true },
      });
    }

    resetSetupStore();
    router.push("/dashboard");
  }, [resetSetupStore, router, phase, answeredCount, authUser, setUser]);

  const handleStarfieldAnswer = useCallback(
    (questionId: string, answer: string | number) => {
      setStarfieldAnswer(questionId, answer);
    },
    [setStarfieldAnswer]
  );

  const handleLogout = useCallback(async () => {
    try {
      await signOut();
      resetSetupStore();
      useAuthStore.getState().logout();
      router.push("/login");
    } catch (err) {
      console.error("Logout failed:", err);
    }
  }, [router, resetSetupStore]);

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

    // 4. Update auth store so useSetupGate sees onboarding as complete
    const currentUser = useAuthStore.getState().currentUser;
    if (currentUser) {
      useAuthStore.getState().setUser({
        ...currentUser,
        onboardingCompleted: { ...currentUser.onboardingCompleted, web: true },
      });
    }

    // 5. Analytics
    const stepsCompleted = (Object.entries(steps) as [string, boolean][])
      .filter(([, done]) => done)
      .map(([name]) => name);
    if (!stepsCompleted.includes("starfield")) stepsCompleted.push("starfield");
    const method = stepsCompleted.length >= 3 ? "full" : "partial";
    const totalDuration = Date.now() - setupStartRef.current;
    trackSetupCompleted(method, stepsCompleted, totalDuration);

    // 6. Clean up persisted setup store and navigate
    resetSetupStore();
    router.push("/dashboard");
  }, [
    completeStep,
    starfieldAnswers,
    companySize,
    applyWidgetInstances,
    resetSetupStore,
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
          onFocusChange={setStarfieldFocused}
        />
        {/* Top controls — always visible */}
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
            onClick={handleLogout}
            aria-label="Log out"
            className="flex items-center gap-1 px-2 min-h-[56px] font-mohave text-body-sm uppercase text-text-disabled hover:text-text-tertiary transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Log out
          </button>
          <button
            onClick={handleSkip}
            aria-label="Skip questionnaire and go to dashboard"
            className="px-2 min-h-[56px] font-mohave text-body-sm uppercase text-text-disabled hover:text-text-tertiary transition-colors"
          >
            Skip
          </button>
          {/* Inline launch — when enough answers (not all), or when editing after all answered */}
          {((answeredCount >= MIN_STARFIELD_ANSWERS && !allAnswered) ||
            (allAnswered && starfieldFocused)) && (
            <button
              onClick={handleLaunchFromStarfield}
              aria-label="Launch your personalized dashboard"
              className="px-3 min-h-[56px] rounded-sm bg-ops-accent border border-ops-accent text-text-primary font-mohave text-body-sm uppercase tracking-[0.08em] hover:bg-ops-accent-hover transition-colors"
            >
              Launch
            </button>
          )}
        </div>

        {/* Centered launch card — all answered, no question focused */}
        <AnimatePresence>
          {allAnswered && !starfieldFocused && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
            >
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className="pointer-events-auto flex flex-col items-center gap-4 px-10 py-8 rounded-sm"
                style={{
                  background: "rgba(10, 10, 10, 0.80)",
                  backdropFilter: "blur(24px) saturate(1.2)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                }}
              >
                <span className="font-kosugi text-[11px] text-text-tertiary uppercase tracking-[0.2em]">
                  All questions answered
                </span>
                <button
                  onClick={handleLaunchFromStarfield}
                  aria-label="Launch your personalized dashboard"
                  className="group relative px-10 py-4 rounded-sm font-mohave text-[22px] uppercase tracking-[0.15em] text-text-primary transition-all duration-300 overflow-hidden"
                  style={{
                    background: "rgba(89, 119, 148, 0.12)",
                    border: "1px solid rgba(89, 119, 148, 0.4)",
                    boxShadow: "0 0 40px rgba(89, 119, 148, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.05)",
                  }}
                >
                  <span className="relative z-10">LAUNCH</span>
                  <div
                    className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                    style={{
                      background: "linear-gradient(135deg, rgba(89, 119, 148, 0.15), rgba(89, 119, 148, 0.05))",
                    }}
                  />
                </button>
                <p className="font-kosugi text-[10px] text-text-disabled uppercase tracking-[0.1em]">
                  Your dashboard is ready
                </p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
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
          <div className="mb-1">
            <span className="font-mohave text-caption-sm text-text-tertiary uppercase tracking-[0.08em]">
              STEP {stepNum} OF 2
            </span>
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
              avatarUrl={avatarUrl}
              onUpdate={(data) => setIdentity(data)}
            />
          )}
          {phase === "company" && (
            <IdentityStep2
              companyName={companyName}
              industries={industries}
              companySize={companySize}
              companyAge={companyAge}
              weatherDependent={weatherDependent}
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

      {/* Log out + Skip — below card */}
      <div className="flex items-center justify-center gap-4 mt-3">
        <button
          onClick={handleLogout}
          aria-label="Log out"
          className="flex items-center gap-1 font-mohave text-caption-sm text-text-disabled uppercase tracking-[0.08em] hover:text-text-tertiary transition-colors min-h-[44px]"
        >
          <LogOut className="w-3 h-3" />
          Log out
        </button>
        <span className="text-[rgba(255,255,255,0.08)]">|</span>
        <button
          onClick={handleSkip}
          aria-label="Skip setup and go to dashboard"
          className="font-mohave text-caption-sm text-text-disabled uppercase tracking-[0.08em] hover:text-text-tertiary transition-colors min-h-[44px]"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
