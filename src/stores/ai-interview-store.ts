"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

// ─── Question Definitions ──────────────────────────────────────────────────────

export type QuestionCategory =
  | "business"
  | "pricing"
  | "communication"
  | "rules"
  | "team";

export interface InterviewQuestion {
  id: string;
  category: QuestionCategory;
  i18nKey: string; // maps to t(`interview.${i18nKey}`)
  isEmailSample?: boolean; // Q8 — example emails for writing profile
}

export const INTERVIEW_QUESTIONS: InterviewQuestion[] = [
  // Business Basics
  { id: "q1", category: "business", i18nKey: "q1" },
  { id: "q2", category: "business", i18nKey: "q2" },
  { id: "q3", category: "business", i18nKey: "q3" },
  // Pricing
  { id: "q4", category: "pricing", i18nKey: "q4" },
  { id: "q5", category: "pricing", i18nKey: "q5" },
  { id: "q6", category: "pricing", i18nKey: "q6" },
  // Communication Style
  { id: "q7", category: "communication", i18nKey: "q7" },
  { id: "q8", category: "communication", i18nKey: "q8", isEmailSample: true },
  { id: "q9", category: "communication", i18nKey: "q9" },
  // Business Rules
  { id: "q10", category: "rules", i18nKey: "q10" },
  { id: "q11", category: "rules", i18nKey: "q11" },
  { id: "q12", category: "rules", i18nKey: "q12" },
  // Team
  { id: "q13", category: "team", i18nKey: "q13" },
  { id: "q14", category: "team", i18nKey: "q14" },
];

export const CATEGORY_ORDER: QuestionCategory[] = [
  "business",
  "pricing",
  "communication",
  "rules",
  "team",
];

// ─── Message types for chat UI ─────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: "agent" | "user";
  content: string;
  questionId?: string;
  timestamp: number;
}

export interface ExtractedFactDisplay {
  id: string;
  category: string;
  content: string;
  timestamp: number;
}

// ─── Interview State ───────────────────────────────────────────────────────────

export type InterviewPhase =
  | "not_started"
  | "intro"
  | "interviewing"
  | "summary"
  | "completed";

interface InterviewState {
  // Phase
  phase: InterviewPhase;

  // Question tracking
  currentQuestionIndex: number;
  answeredQuestions: Set<string>;
  skippedQuestions: Set<string>;
  responses: Map<string, string>; // questionId -> user response

  // Chat messages
  messages: ChatMessage[];

  // Extracted facts (for display)
  extractedFacts: ExtractedFactDisplay[];
  totalFactsCount: number;
  totalEntitiesCount: number;
  profileSeeded: boolean;

  // Processing state
  isProcessing: boolean;

  // Actions
  startInterview: () => void;
  addAgentMessage: (content: string, questionId?: string) => void;
  addUserMessage: (content: string) => void;
  recordResponse: (questionId: string, response: string) => void;
  skipQuestion: (questionId: string) => void;
  advanceToNextQuestion: () => number; // returns new index, -1 if done
  addExtractedFact: (fact: ExtractedFactDisplay) => void;
  incrementStats: (facts: number, entities: number, profileSeeded: boolean) => void;
  setProcessing: (processing: boolean) => void;
  setPhase: (phase: InterviewPhase) => void;
  resetInterview: () => void;
}

// ─── Serialization helpers for Set/Map persistence ─────────────────────────────

function serializeState(state: InterviewState) {
  return {
    phase: state.phase,
    currentQuestionIndex: state.currentQuestionIndex,
    answeredQuestions: [...state.answeredQuestions],
    skippedQuestions: [...state.skippedQuestions],
    responses: [...state.responses.entries()],
    messages: state.messages,
    extractedFacts: state.extractedFacts,
    totalFactsCount: state.totalFactsCount,
    totalEntitiesCount: state.totalEntitiesCount,
    profileSeeded: state.profileSeeded,
    isProcessing: false, // Never persist processing state
  };
}

function deserializeState(raw: ReturnType<typeof serializeState>): Partial<InterviewState> {
  return {
    phase: raw.phase,
    currentQuestionIndex: raw.currentQuestionIndex,
    answeredQuestions: new Set(raw.answeredQuestions),
    skippedQuestions: new Set(raw.skippedQuestions),
    responses: new Map(raw.responses),
    messages: raw.messages,
    extractedFacts: raw.extractedFacts,
    totalFactsCount: raw.totalFactsCount,
    totalEntitiesCount: raw.totalEntitiesCount,
    profileSeeded: raw.profileSeeded,
    isProcessing: false,
  };
}

const INITIAL_STATE = {
  phase: "not_started" as InterviewPhase,
  currentQuestionIndex: 0,
  answeredQuestions: new Set<string>(),
  skippedQuestions: new Set<string>(),
  responses: new Map<string, string>(),
  messages: [] as ChatMessage[],
  extractedFacts: [] as ExtractedFactDisplay[],
  totalFactsCount: 0,
  totalEntitiesCount: 0,
  profileSeeded: false,
  isProcessing: false,
};

// ─── Store ─────────────────────────────────────────────────────────────────────

export const useInterviewStore = create<InterviewState>()(
  persist(
    (set, get) => ({
      ...INITIAL_STATE,

      startInterview: () => {
        set({ phase: "interviewing" });
      },

      addAgentMessage: (content: string, questionId?: string) => {
        const msg: ChatMessage = {
          id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: "agent",
          content,
          questionId,
          timestamp: Date.now(),
        };
        set((s) => ({ messages: [...s.messages, msg] }));
      },

      addUserMessage: (content: string) => {
        const msg: ChatMessage = {
          id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: "user",
          content,
          timestamp: Date.now(),
        };
        set((s) => ({ messages: [...s.messages, msg] }));
      },

      recordResponse: (questionId: string, response: string) => {
        set((s) => {
          const newAnswered = new Set(s.answeredQuestions);
          newAnswered.add(questionId);
          const newResponses = new Map(s.responses);
          newResponses.set(questionId, response);
          return { answeredQuestions: newAnswered, responses: newResponses };
        });
      },

      skipQuestion: (questionId: string) => {
        set((s) => {
          const newSkipped = new Set(s.skippedQuestions);
          newSkipped.add(questionId);
          return { skippedQuestions: newSkipped };
        });
      },

      advanceToNextQuestion: () => {
        const state = get();
        let nextIndex = state.currentQuestionIndex + 1;

        // Skip already answered or skipped questions
        while (nextIndex < INTERVIEW_QUESTIONS.length) {
          const q = INTERVIEW_QUESTIONS[nextIndex];
          if (!state.answeredQuestions.has(q.id) && !state.skippedQuestions.has(q.id)) {
            break;
          }
          nextIndex++;
        }

        if (nextIndex >= INTERVIEW_QUESTIONS.length) {
          set({ currentQuestionIndex: nextIndex, phase: "summary" });
          return -1;
        }

        set({ currentQuestionIndex: nextIndex });
        return nextIndex;
      },

      addExtractedFact: (fact: ExtractedFactDisplay) => {
        set((s) => ({
          extractedFacts: [...s.extractedFacts, fact],
        }));
      },

      incrementStats: (facts: number, entities: number, profileSeeded: boolean) => {
        set((s) => ({
          totalFactsCount: s.totalFactsCount + facts,
          totalEntitiesCount: s.totalEntitiesCount + entities,
          profileSeeded: s.profileSeeded || profileSeeded,
        }));
      },

      setProcessing: (processing: boolean) => {
        set({ isProcessing: processing });
      },

      setPhase: (phase: InterviewPhase) => {
        set({ phase });
      },

      resetInterview: () => {
        set({ ...INITIAL_STATE });
      },
    }),
    {
      name: "ops-ai-interview",
      storage: {
        getItem: (name: string) => {
          if (typeof window === "undefined") return null;
          const raw = localStorage.getItem(name);
          if (!raw) return null;
          try {
            const parsed = JSON.parse(raw);
            if (parsed.state) {
              parsed.state = {
                ...parsed.state,
                ...deserializeState(parsed.state),
              };
            }
            return parsed;
          } catch {
            return null;
          }
        },
        setItem: (name: string, value: unknown) => {
          if (typeof window === "undefined") return;
          const v = value as { state: InterviewState; version?: number };
          const serialized = {
            ...v,
            state: serializeState(v.state),
          };
          localStorage.setItem(name, JSON.stringify(serialized));
        },
        removeItem: (name: string) => {
          if (typeof window === "undefined") return;
          localStorage.removeItem(name);
        },
      },
      partialize: (state) =>
        ({
          phase: state.phase,
          currentQuestionIndex: state.currentQuestionIndex,
          answeredQuestions: state.answeredQuestions,
          skippedQuestions: state.skippedQuestions,
          responses: state.responses,
          messages: state.messages,
          extractedFacts: state.extractedFacts,
          totalFactsCount: state.totalFactsCount,
          totalEntitiesCount: state.totalEntitiesCount,
          profileSeeded: state.profileSeeded,
        }) as InterviewState,
    }
  )
);

// ─── Selectors ─────────────────────────────────────────────────────────────────

export const selectCurrentQuestion = (s: InterviewState) =>
  INTERVIEW_QUESTIONS[s.currentQuestionIndex] ?? null;

export const selectProgress = (s: InterviewState) => {
  const total = INTERVIEW_QUESTIONS.length;
  const completed = s.answeredQuestions.size + s.skippedQuestions.size;
  return { completed, total, percent: Math.round((completed / total) * 100) };
};

export const selectCategoryProgress = (s: InterviewState) => {
  const progress: Record<QuestionCategory, { completed: number; total: number }> = {
    business: { completed: 0, total: 0 },
    pricing: { completed: 0, total: 0 },
    communication: { completed: 0, total: 0 },
    rules: { completed: 0, total: 0 },
    team: { completed: 0, total: 0 },
  };

  for (const q of INTERVIEW_QUESTIONS) {
    progress[q.category].total++;
    if (s.answeredQuestions.has(q.id) || s.skippedQuestions.has(q.id)) {
      progress[q.category].completed++;
    }
  }

  return progress;
};

export const selectCurrentCategory = (s: InterviewState): QuestionCategory | null => {
  const question = INTERVIEW_QUESTIONS[s.currentQuestionIndex];
  return question?.category ?? null;
};

export const selectIsInterviewComplete = (s: InterviewState) =>
  s.phase === "summary" || s.phase === "completed";
