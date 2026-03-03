"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

// ─── Types ───────────────────────────────────────────────────────────────────

export type SetupPhase = "identity" | "company" | "starfield" | "launching" | "complete";
export type ResponseType = "situational" | "likert" | "forced_choice";

export interface StarfieldOption {
  id: string;
  label: string;
}

export interface StarfieldQuestion {
  id: string;
  label: string;
  question: string;
  responseType: ResponseType;
  options: StarfieldOption[];
  likertMin?: string;
  likertMax?: string;
  position: { x: number; y: number; z: number };
  conditionalOn?: { questionId: string; excludeAnswer: string };
}

export interface SetupSteps {
  identity: boolean;
  company: boolean;
  starfield: boolean;
}

// ─── Questions ───────────────────────────────────────────────────────────────

export const STARFIELD_QUESTIONS: StarfieldQuestion[] = [
  {
    id: "projects",
    label: "Projects",
    question: "How many jobs are you running right now?",
    responseType: "situational",
    options: [
      { id: "1-3", label: "1-3" },
      { id: "4-10", label: "4-10" },
      { id: "10-20", label: "10-20" },
      { id: "20+", label: "20+" },
    ],
    position: { x: -280, y: -180, z: 100 },
  },
  {
    id: "estimates",
    label: "Estimates",
    question: "How do you quote jobs?",
    responseType: "situational",
    options: [
      { id: "software", label: "Software" },
      { id: "spreadsheets", label: "Spreadsheets" },
      { id: "text-email", label: "Text / Email" },
      { id: "pen-paper", label: "Pen & Paper" },
    ],
    position: { x: 260, y: -200, z: 60 },
  },
  {
    id: "close_rate",
    label: "Close Rate",
    question: "How often do your quotes become jobs?",
    responseType: "likert",
    options: [],
    likertMin: "Rarely",
    likertMax: "Almost always",
    position: { x: -160, y: 40, z: 180 },
  },
  {
    id: "invoicing",
    label: "Invoicing",
    question: "Are you on top of invoicing?",
    responseType: "likert",
    options: [],
    likertMin: "Falling behind",
    likertMax: "Locked in",
    position: { x: 180, y: 80, z: 140 },
  },
  {
    id: "scheduling",
    label: "Scheduling",
    question: "How do you schedule work?",
    responseType: "situational",
    options: [
      { id: "calendar-app", label: "Calendar app" },
      { id: "whiteboard", label: "Whiteboard" },
      { id: "in-my-head", label: "In my head" },
      { id: "chaos", label: "Chaos" },
    ],
    position: { x: -300, y: 160, z: 80 },
  },
  {
    id: "schedule_detail",
    label: "Schedule Detail",
    question: "How do you book jobs?",
    responseType: "forced_choice",
    options: [
      { id: "by-the-hour", label: "By the hour" },
      { id: "by-the-day", label: "By the day" },
    ],
    position: { x: 0, y: -260, z: 120 },
  },
  {
    id: "crew",
    label: "Crew",
    question: "Who's on the team?",
    responseType: "situational",
    options: [
      { id: "just-me", label: "Just me" },
      { id: "small-crew", label: "Small crew" },
      { id: "multiple-crews", label: "Multiple crews" },
      { id: "office-and-field", label: "Office and field" },
    ],
    position: { x: 220, y: -60, z: 200 },
  },
  {
    id: "crew_morale",
    label: "Crew Morale",
    question: "How's your crew doing?",
    responseType: "likert",
    options: [],
    likertMin: "Frustrated and scattered",
    likertMax: "Dialed in",
    position: { x: 300, y: 100, z: 60 },
    conditionalOn: { questionId: "crew", excludeAnswer: "just-me" },
  },
  {
    id: "inquiries",
    label: "Inquiries",
    question: "How do leads come in?",
    responseType: "likert",
    options: [],
    likertMin: "All phone/text",
    likertMax: "All email",
    position: { x: -200, y: -100, z: 220 },
  },
  {
    id: "time",
    label: "Time",
    question: "Is time tracking part of your operation?",
    responseType: "forced_choice",
    options: [
      { id: "bill-on-time", label: "Yes, we bill on time" },
      { id: "price-by-job", label: "No, we price by the job" },
    ],
    position: { x: 100, y: 220, z: 100 },
  },
  {
    id: "inventory",
    label: "Inventory",
    question: "Do you need to track materials?",
    responseType: "forced_choice",
    options: [
      { id: "yes", label: "Yes" },
      { id: "no", label: "No" },
    ],
    position: { x: -100, y: 260, z: 40 },
  },
  {
    id: "numbers",
    label: "Numbers",
    question: "How well do you know your numbers?",
    responseType: "likert",
    options: [],
    likertMin: "Flying blind",
    likertMax: "Down to the penny",
    position: { x: 240, y: 200, z: 160 },
  },
  {
    id: "growth",
    label: "Growth",
    question: "What would move the needle most?",
    responseType: "situational",
    options: [
      { id: "winning-more-work", label: "Winning more work" },
      { id: "getting-paid-faster", label: "Getting paid faster" },
      { id: "better-organization", label: "Better organization" },
      { id: "more-time-back", label: "More time back" },
    ],
    position: { x: -260, y: 240, z: 120 },
  },
];

// ─── Store ───────────────────────────────────────────────────────────────────

interface SetupState {
  // State
  phase: SetupPhase;
  firstName: string;
  lastName: string;
  phone: string;
  companyName: string;
  industries: string[];
  companySize: string;
  companyAge: string;
  starfieldAnswers: Record<string, string | number>;
  steps: SetupSteps;

  // Actions
  setPhase: (phase: SetupPhase) => void;
  setIdentity: (data: Partial<Pick<SetupState, "firstName" | "lastName" | "phone">>) => void;
  setCompanyInfo: (
    data: Partial<Pick<SetupState, "companyName" | "industries" | "companySize" | "companyAge">>
  ) => void;
  setStarfieldAnswer: (questionId: string, answer: string | number) => void;
  completeStep: (step: keyof SetupSteps) => void;
  completeSetup: () => void;
  reset: () => void;
}

const initialState = {
  phase: "identity" as SetupPhase,
  firstName: "",
  lastName: "",
  phone: "",
  companyName: "",
  industries: [] as string[],
  companySize: "",
  companyAge: "",
  starfieldAnswers: {} as Record<string, string | number>,
  steps: { identity: false, company: false, starfield: false } as SetupSteps,
};

export const useSetupStore = create<SetupState>()(
  persist(
    (set) => ({
      ...initialState,

      setPhase: (phase) => set({ phase }),

      setIdentity: (data) => set(data),

      setCompanyInfo: (data) => set(data),

      setStarfieldAnswer: (questionId, answer) =>
        set((state) => ({
          starfieldAnswers: { ...state.starfieldAnswers, [questionId]: answer },
        })),

      completeStep: (step) =>
        set((state) => ({
          steps: { ...state.steps, [step]: true },
        })),

      completeSetup: () => set({ phase: "complete" }),

      reset: () => set({ ...initialState }),
    }),
    {
      name: "ops-setup-state",
    }
  )
);
