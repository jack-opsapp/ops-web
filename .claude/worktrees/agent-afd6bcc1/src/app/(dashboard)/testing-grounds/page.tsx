"use client";

import { useState, useCallback } from "react";
import { useAuthStore } from "@/lib/store/auth-store";
import { SetupStarfield } from "@/components/setup/SetupStarfield";
import { SetupLaunchAnimation } from "@/components/setup/SetupLaunchAnimation";
import { STARFIELD_QUESTIONS } from "@/stores/setup-store";

// ─── Testing Grounds Page ──────────────────────────────────────────────────

type TestMode = "starfield" | "launch" | "idle";

export default function TestingGroundsPage() {
  const { currentUser } = useAuthStore();
  const hasAccess = currentUser?.specialPermissions?.includes("testing-grounds");

  const [mode, setMode] = useState<TestMode>("idle");
  const [answers, setAnswers] = useState<Record<string, string | number>>({});

  const answeredCount = Object.keys(answers).length;

  const handleAnswer = useCallback(
    (questionId: string, answer: string | number) => {
      setAnswers((prev) => ({ ...prev, [questionId]: answer }));
    },
    []
  );

  const handleLaunchComplete = useCallback(() => {
    setMode("idle");
  }, []);

  const resetAnswers = useCallback(() => {
    setAnswers({});
  }, []);

  // ─── Access gate ───────────────────────────────────────────────────────

  if (!hasAccess) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-80px)]">
        <div className="text-center">
          <h1 className="font-mohave text-display text-text-primary mb-2">
            Access Denied
          </h1>
          <p className="font-kosugi text-body-sm text-text-tertiary">
            You need the &quot;testing-grounds&quot; permission to access this page.
          </p>
        </div>
      </div>
    );
  }

  // ─── Idle state ────────────────────────────────────────────────────────

  if (mode === "idle") {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-80px)] gap-6">
        <h1 className="font-mohave text-display text-text-primary">
          Testing Grounds
        </h1>
        <p className="font-kosugi text-body-sm text-text-tertiary max-w-md text-center">
          Isolated canvas for testing setup starfield and launch animations.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => setMode("starfield")}
            className="px-4 py-2 rounded-lg bg-ops-accent text-white font-mohave text-body hover:bg-ops-accent/90 transition-colors"
          >
            Starfield
          </button>
          <button
            onClick={() => {
              if (answeredCount < 4) {
                setMode("starfield");
              } else {
                setMode("launch");
              }
            }}
            className="px-4 py-2 rounded-lg bg-background-card border border-border text-text-secondary font-mohave text-body hover:border-border-medium transition-colors"
          >
            Launch Animation {answeredCount < 4 ? `(need ${4 - answeredCount} more)` : ""}
          </button>
          <button
            onClick={resetAnswers}
            className="px-4 py-2 rounded-lg bg-background-card border border-border text-text-tertiary font-mohave text-body hover:border-border-medium transition-colors"
          >
            Reset
          </button>
        </div>
        <p className="font-mono text-[10px] text-text-disabled">
          {answeredCount}/{STARFIELD_QUESTIONS.length} questions answered
        </p>
      </div>
    );
  }

  // ─── Starfield mode ────────────────────────────────────────────────────

  if (mode === "starfield") {
    return (
      <div className="fixed inset-0 z-50 bg-background">
        <SetupStarfield
          questions={STARFIELD_QUESTIONS}
          starfieldAnswers={answers}
          onAnswer={handleAnswer}
          minRequired={4}
        />
        {/* Controls overlay */}
        <div className="absolute top-4 right-4 z-10 flex gap-2">
          <span className="font-mono text-[10px] text-text-disabled self-center mr-2">
            {answeredCount}/{STARFIELD_QUESTIONS.length} answered
          </span>
          {answeredCount >= 4 && (
            <button
              onClick={() => setMode("launch")}
              className="px-3 py-1.5 rounded-lg bg-ops-accent text-white font-mohave text-body-sm hover:bg-ops-accent/90 transition-colors"
            >
              Launch
            </button>
          )}
          <button
            onClick={() => setMode("idle")}
            className="px-3 py-1.5 rounded-lg bg-background-card border border-border text-text-secondary font-mohave text-body-sm hover:border-border-medium transition-colors"
          >
            Exit
          </button>
        </div>
      </div>
    );
  }

  // ─── Launch mode ───────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 bg-background">
      <SetupLaunchAnimation
        questions={STARFIELD_QUESTIONS}
        starfieldAnswers={answers}
        onComplete={handleLaunchComplete}
      />
      <div className="absolute top-4 right-4 z-10">
        <button
          onClick={() => setMode("idle")}
          className="px-3 py-1.5 rounded-lg bg-background-card border border-border text-text-secondary font-mohave text-body-sm hover:border-border-medium transition-colors"
        >
          Exit
        </button>
      </div>
    </div>
  );
}
