"use client";

import { useState, useCallback } from "react";
import { useAuthStore } from "@/lib/store/auth-store";
import { SetupStarfield } from "@/components/setup/SetupStarfield";
import { SetupLaunchAnimation } from "@/components/setup/SetupLaunchAnimation";
import type { StarfieldQuestion } from "@/stores/setup-store";

// ─── Placeholder questions for testing ─────────────────────────────────────

const TEST_QUESTIONS: StarfieldQuestion[] = [
  {
    id: "q1",
    label: "Work Style",
    question: "How does your crew typically work?",
    responseType: "situational",
    options: [
      { id: "a", label: "Solo jobs" },
      { id: "b", label: "Small teams" },
      { id: "c", label: "Large crews" },
    ],
    position: { x: -200, y: 150, z: 50 },
  },
  {
    id: "q2",
    label: "Scheduling",
    question: "How do you handle scheduling?",
    responseType: "situational",
    options: [
      { id: "a", label: "Paper calendar" },
      { id: "b", label: "Digital tools" },
      { id: "c", label: "Wing it" },
    ],
    position: { x: 180, y: -120, z: -30 },
  },
  {
    id: "q3",
    label: "Invoicing",
    question: "How do you invoice clients?",
    responseType: "situational",
    options: [
      { id: "a", label: "QuickBooks" },
      { id: "b", label: "Manual invoices" },
      { id: "c", label: "No system yet" },
    ],
    position: { x: -150, y: -180, z: 80 },
  },
  {
    id: "q4",
    label: "Growth",
    question: "What's your top growth goal?",
    responseType: "situational",
    options: [
      { id: "a", label: "More clients" },
      { id: "b", label: "Bigger jobs" },
      { id: "c", label: "Better margins" },
    ],
    position: { x: 220, y: 100, z: -60 },
  },
  {
    id: "q5",
    label: "Communication",
    question: "How does your crew communicate?",
    responseType: "situational",
    options: [
      { id: "a", label: "Text messages" },
      { id: "b", label: "Phone calls" },
      { id: "c", label: "In person" },
    ],
    position: { x: -50, y: 200, z: -40 },
  },
  {
    id: "q6",
    label: "Tracking",
    question: "What do you track most?",
    responseType: "situational",
    options: [
      { id: "a", label: "Hours worked" },
      { id: "b", label: "Job costs" },
      { id: "c", label: "Materials" },
      { id: "d", label: "Nothing yet" },
    ],
    position: { x: 100, y: -200, z: 70 },
  },
  {
    id: "q7",
    label: "Pain Point",
    question: "Biggest day-to-day headache?",
    responseType: "situational",
    options: [
      { id: "a", label: "Paperwork" },
      { id: "b", label: "Chasing payments" },
      { id: "c", label: "Crew coordination" },
    ],
    position: { x: -180, y: -50, z: -80 },
  },
  {
    id: "q8",
    label: "Estimates",
    question: "How do you create estimates?",
    responseType: "situational",
    options: [
      { id: "a", label: "Spreadsheet" },
      { id: "b", label: "Handwritten" },
      { id: "c", label: "Software" },
      { id: "d", label: "Don't estimate" },
    ],
    position: { x: 160, y: 160, z: 40 },
  },
];

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
          {answeredCount}/8 questions answered
        </p>
      </div>
    );
  }

  // ─── Starfield mode ────────────────────────────────────────────────────

  if (mode === "starfield") {
    return (
      <div className="fixed inset-0 z-50 bg-background">
        <SetupStarfield
          questions={TEST_QUESTIONS}
          starfieldAnswers={answers}
          onAnswer={handleAnswer}
          minRequired={4}
        />
        {/* Controls overlay */}
        <div className="absolute top-4 right-4 z-10 flex gap-2">
          <span className="font-mono text-[10px] text-text-disabled self-center mr-2">
            {answeredCount}/8 answered
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
        questions={TEST_QUESTIONS}
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
