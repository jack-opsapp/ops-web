"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  SkipForward,
  Loader2,
  CheckCircle,
  Brain,
  ChevronRight,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { getIdToken } from "@/lib/firebase/auth";
import {
  useInterviewStore,
  selectCurrentQuestion,
  selectProgress,
  selectCategoryProgress,
  selectCurrentCategory,
  INTERVIEW_QUESTIONS,
  CATEGORY_ORDER,
  type QuestionCategory,
  type ChatMessage,
  type ExtractedFactDisplay,
} from "@/stores/ai-interview-store";

// ─── Animation constants ───────────────────────────────────────────────────────

const EASE_SMOOTH = [0.22, 1, 0.36, 1] as const;

const messageVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.2, ease: EASE_SMOOTH } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

const factVariants = {
  initial: { opacity: 0, scale: 0.95, x: -4 },
  animate: {
    opacity: 1,
    scale: 1,
    x: 0,
    transition: { duration: 0.2, ease: EASE_SMOOTH },
  },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

const messageVariantsReduced = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.01 } },
  exit: { opacity: 0, transition: { duration: 0.01 } },
};

// ─── Category i18n keys ─────────────────────────────────────────────────────────

const CATEGORY_I18N: Record<QuestionCategory, string> = {
  business: "interview.category.business",
  pricing: "interview.category.pricing",
  communication: "interview.category.communication",
  rules: "interview.category.rules",
  team: "interview.category.team",
};

// ─── Progress Bar ───────────────────────────────────────────────────────────────

function ProgressBar() {
  const { t } = useDictionary("ai-setup");
  const categoryProgress = useInterviewStore(selectCategoryProgress);
  const currentCategory = useInterviewStore(selectCurrentCategory);
  const overall = useInterviewStore(selectProgress);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-kosugi text-[11px] uppercase tracking-[0.08em] text-text-3">
          {t("interview.progress")}
        </span>
        <span className="font-mohave text-body-sm text-text-2">
          {overall.completed}/{overall.total}
        </span>
      </div>

      {/* Segmented progress bar by category */}
      <div className="flex gap-[3px]">
        {CATEGORY_ORDER.map((cat) => {
          const cp = categoryProgress[cat];
          const isActive = cat === currentCategory;
          const isComplete = cp.completed === cp.total;

          return (
            <div key={cat} className="flex-1 space-y-[2px]">
              <div
                className={cn(
                  "h-[3px] rounded-full overflow-hidden",
                  "bg-[rgba(255,255,255,0.06)]"
                )}
              >
                <motion.div
                  className={cn(
                    "h-full rounded-full",
                    isComplete
                      ? "bg-[#9DB582]"
                      : isActive
                        ? "bg-ops-accent"
                        : "bg-[rgba(255,255,255,0.15)]"
                  )}
                  animate={{ width: `${cp.total > 0 ? (cp.completed / cp.total) * 100 : 0}%` }}
                  transition={{ duration: 0.4, ease: EASE_SMOOTH }}
                />
              </div>
              <span
                className={cn(
                  "font-kosugi text-micro uppercase tracking-[0.06em] block",
                  isActive ? "text-text-2" : "text-text-mute"
                )}
              >
                {t(CATEGORY_I18N[cat])}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Chat Message Bubble ────────────────────────────────────────────────────────

function MessageBubble({ message, reduced }: { message: ChatMessage; reduced: boolean }) {
  const isAgent = message.role === "agent";
  const variants = reduced ? messageVariantsReduced : messageVariants;

  return (
    <motion.div
      layout
      variants={variants}
      initial="initial"
      animate="animate"
      exit="exit"
      className={cn("flex", isAgent ? "justify-start" : "justify-end")}
    >
      <div
        className={cn(
          "max-w-[85%] px-3 py-2 rounded-md",
          isAgent
            ? "bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)]"
            : "bg-[rgba(111, 148, 176,0.12)] border border-[rgba(111, 148, 176,0.2)]"
        )}
      >
        {isAgent && (
          <div className="flex items-center gap-1 mb-[2px]">
            <Brain className="w-[12px] h-[12px] text-[#6F94B0]" />
            <span className="font-kosugi text-micro text-[#6F94B0] uppercase tracking-wider">
              OPS AI
            </span>
          </div>
        )}
        <p
          className={cn(
            "text-body-sm whitespace-pre-wrap",
            isAgent ? "font-mohave text-text" : "font-mohave text-text"
          )}
        >
          {message.content}
        </p>
      </div>
    </motion.div>
  );
}

// ─── Fact Flash ─────────────────────────────────────────────────────────────────

function FactFlash({ fact, reduced }: { fact: ExtractedFactDisplay; reduced: boolean }) {
  const { t } = useDictionary("ai-setup");
  const variants = reduced ? messageVariantsReduced : factVariants;

  return (
    <motion.div
      variants={variants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="flex items-start gap-1.5 px-2 py-1 rounded border border-[rgba(157,181,130,0.2)] bg-[rgba(157,181,130,0.06)]"
    >
      <CheckCircle className="w-[12px] h-[12px] text-[#9DB582] mt-[2px] shrink-0" />
      <div className="min-w-0 flex-1">
        <span className="font-kosugi text-micro text-[#9DB582] uppercase tracking-wider">
          {t("interview.factLearned")}
        </span>
        <p className="font-mohave text-[13px] text-text-2 leading-tight mt-[1px]">
          {fact.content}
        </p>
      </div>
    </motion.div>
  );
}

// ─── Processing Indicator ───────────────────────────────────────────────────────

function ThinkingIndicator({ reduced }: { reduced: boolean }) {
  const { t } = useDictionary("ai-setup");
  const variants = reduced ? messageVariantsReduced : messageVariants;

  return (
    <motion.div variants={variants} initial="initial" animate="animate" exit="exit">
      <div className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)] w-fit">
        <Loader2 className="w-[14px] h-[14px] text-[#6F94B0] animate-spin" />
        <span className="font-kosugi text-[12px] text-text-3">
          {t("interview.thinking")}
        </span>
      </div>
    </motion.div>
  );
}

// ─── Intro Screen ───────────────────────────────────────────────────────────────

function IntroScreen({ onStart }: { onStart: () => void }) {
  const { t } = useDictionary("ai-setup");

  return (
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <h2 className="font-mohave text-title font-semibold uppercase tracking-wide text-text">
          {t("intro.title")}
        </h2>
        <p className="font-mohave text-body-sm text-text-2 leading-relaxed max-w-[520px]">
          {t("intro.description")}
        </p>
      </div>

      <div className="space-y-1.5">
        <span className="font-kosugi text-[11px] text-text-3 uppercase tracking-[0.08em]">
          {t("intro.whatItDoes")}
        </span>
        {["bullet1", "bullet2", "bullet3", "bullet4"].map((key) => (
          <div key={key} className="flex items-start gap-1.5">
            <ChevronRight className="w-[14px] h-[14px] text-[#6F94B0] mt-[2px] shrink-0" />
            <span className="font-mohave text-body-sm text-text-2">
              {t(`intro.${key}`)}
            </span>
          </div>
        ))}
      </div>

      <div className="pt-2 flex items-center gap-3">
        <button
          onClick={onStart}
          className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-ops-accent hover:bg-[#4a6680] text-white font-mohave text-body-sm font-medium transition-colors"
        >
          <Brain className="w-[16px] h-[16px]" />
          {t("intro.startSetup")}
        </button>
        <span className="font-kosugi text-[11px] text-text-mute">
          {t("intro.estimatedTime")}
        </span>
      </div>
    </div>
  );
}

// ─── Summary Screen ─────────────────────────────────────────────────────────────

function SummaryScreen({ onConfirm, onEdit }: { onConfirm: () => void; onEdit: () => void }) {
  const { t } = useDictionary("ai-setup");
  const extractedFacts = useInterviewStore((s) => s.extractedFacts);
  const totalFacts = useInterviewStore((s) => s.totalFactsCount);
  const totalEntities = useInterviewStore((s) => s.totalEntitiesCount);
  const profileSeeded = useInterviewStore((s) => s.profileSeeded);

  // Group facts by category
  const factsByCategory = new Map<string, ExtractedFactDisplay[]>();
  for (const fact of extractedFacts) {
    if (!factsByCategory.has(fact.category)) {
      factsByCategory.set(fact.category, []);
    }
    factsByCategory.get(fact.category)!.push(fact);
  }

  return (
    <div className="space-y-4 py-3">
      <div className="space-y-1">
        <h2 className="font-mohave text-title font-semibold uppercase tracking-wide text-text">
          {t("interview.summary.title")}
        </h2>
        <p className="font-mohave text-body-sm text-text-2">
          {t("interview.summary.description")}
        </p>
      </div>

      {/* Stats */}
      <div className="flex gap-3">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)]">
          <span className="font-mohave text-[20px] font-semibold text-text">{totalFacts}</span>
          <span className="font-kosugi text-micro text-text-3 uppercase">{t("interview.summary.factsLearned")}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)]">
          <span className="font-mohave text-[20px] font-semibold text-text">{totalEntities}</span>
          <span className="font-kosugi text-micro text-text-3 uppercase">{t("interview.summary.entitiesCreated")}</span>
        </div>
        {profileSeeded && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded border border-[rgba(157,181,130,0.2)] bg-[rgba(157,181,130,0.06)]">
            <CheckCircle className="w-[14px] h-[14px] text-[#9DB582]" />
            <span className="font-kosugi text-micro text-[#9DB582] uppercase">{t("interview.summary.profileSeeded")}</span>
          </div>
        )}
      </div>

      {/* Facts grouped by category */}
      <div className="space-y-2">
        {[...factsByCategory.entries()].map(([category, facts]) => (
          <div key={category} className="space-y-[4px]">
            <span className="font-kosugi text-micro text-text-mute uppercase tracking-[0.08em]">
              {category.replace(/_/g, " ")}
            </span>
            {facts.map((fact) => (
              <div
                key={fact.id}
                className="flex items-start gap-1 px-1.5 py-[4px] rounded border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]"
              >
                <CheckCircle className="w-[11px] h-[11px] text-[#9DB582] mt-[3px] shrink-0" />
                <span className="font-mohave text-[13px] text-text-2 leading-tight">
                  {fact.content}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={onConfirm}
          className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-ops-accent hover:bg-[#4a6680] text-white font-mohave text-body-sm font-medium transition-colors"
        >
          <CheckCircle className="w-[16px] h-[16px]" />
          {t("interview.summary.looksGood")}
        </button>
        <button
          onClick={onEdit}
          className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.08)] text-text-2 font-mohave text-body-sm transition-colors"
        >
          <RotateCcw className="w-[14px] h-[14px]" />
          {t("interview.summary.edit")}
        </button>
      </div>
    </div>
  );
}

// ─── Main Interview Component ───────────────────────────────────────────────────

interface AiIntakeInterviewProps {
  onComplete: () => void;
}

export function AiIntakeInterview({ onComplete }: AiIntakeInterviewProps) {
  const { t } = useDictionary("ai-setup");
  const [inputValue, setInputValue] = useState("");
  const [recentFacts, setRecentFacts] = useState<ExtractedFactDisplay[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prefersReducedMotion =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

  const phase = useInterviewStore((s) => s.phase);
  const messages = useInterviewStore((s) => s.messages);
  const isProcessing = useInterviewStore((s) => s.isProcessing);
  const currentQuestion = useInterviewStore(selectCurrentQuestion);
  const startInterview = useInterviewStore((s) => s.startInterview);
  const addAgentMessage = useInterviewStore((s) => s.addAgentMessage);
  const addUserMessage = useInterviewStore((s) => s.addUserMessage);
  const recordResponse = useInterviewStore((s) => s.recordResponse);
  const skipQuestion = useInterviewStore((s) => s.skipQuestion);
  const advanceToNextQuestion = useInterviewStore((s) => s.advanceToNextQuestion);
  const addExtractedFact = useInterviewStore((s) => s.addExtractedFact);
  const incrementStats = useInterviewStore((s) => s.incrementStats);
  const setProcessing = useInterviewStore((s) => s.setProcessing);
  const setPhase = useInterviewStore((s) => s.setPhase);
  const resetInterview = useInterviewStore((s) => s.resetInterview);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, recentFacts, isProcessing]);

  // Post first question when interview starts
  const hasPostedFirstQuestion = useRef(false);
  useEffect(() => {
    if (phase === "interviewing" && messages.length === 0 && !hasPostedFirstQuestion.current) {
      hasPostedFirstQuestion.current = true;
      const firstQ = INTERVIEW_QUESTIONS[0];
      addAgentMessage(t(`interview.${firstQ.i18nKey}`), firstQ.id);
    }
  }, [phase, messages.length, addAgentMessage, t]);

  // Clear recent facts after delay
  useEffect(() => {
    if (recentFacts.length === 0) return;
    const timer = setTimeout(() => setRecentFacts([]), 3000);
    return () => clearTimeout(timer);
  }, [recentFacts]);

  const handleStartInterview = useCallback(() => {
    startInterview();
    setPhase("interviewing");
  }, [startInterview, setPhase]);

  const handleSubmit = useCallback(async () => {
    if (!inputValue.trim() || isProcessing || !currentQuestion) return;

    const response = inputValue.trim();
    const questionId = currentQuestion.id;
    const questionText = t(`interview.${currentQuestion.i18nKey}`);

    // Add user message and record response
    addUserMessage(response);
    recordResponse(questionId, response);
    setInputValue("");
    setProcessing(true);

    try {
      // Call extraction endpoint
      const idToken = await getIdToken();
      const res = await fetch("/api/integrations/ai-setup/extract-facts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ questionId, userResponse: response, questionText }),
      });

      if (res.ok) {
        const data = await res.json();
        const facts = data.facts ?? [];
        const entities = data.entities ?? [];

        // Show extracted facts as flashes
        const newFacts: ExtractedFactDisplay[] = facts.map(
          (f: { category: string; content: string }, i: number) => ({
            id: `${questionId}-fact-${i}-${Date.now()}`,
            category: f.category,
            content: f.content,
            timestamp: Date.now(),
          })
        );

        for (const fact of newFacts) {
          addExtractedFact(fact);
        }
        setRecentFacts(newFacts);
        incrementStats(facts.length, entities.length, data.profileSeeded ?? false);
      }
    } catch (err) {
      console.error("[interview] Extraction failed:", err);
    }

    setProcessing(false);

    // Advance to next question
    const nextIndex = advanceToNextQuestion();
    if (nextIndex >= 0) {
      const nextQ = INTERVIEW_QUESTIONS[nextIndex];
      // Small delay before next question for natural feel
      setTimeout(() => {
        addAgentMessage(t(`interview.${nextQ.i18nKey}`), nextQ.id);
      }, 400);
    }
  }, [
    inputValue,
    isProcessing,
    currentQuestion,
    t,
    addUserMessage,
    recordResponse,
    setProcessing,
    advanceToNextQuestion,
    addAgentMessage,
    addExtractedFact,
    incrementStats,
  ]);

  const handleSkip = useCallback(() => {
    if (!currentQuestion || isProcessing) return;

    skipQuestion(currentQuestion.id);
    const nextIndex = advanceToNextQuestion();
    if (nextIndex >= 0) {
      const nextQ = INTERVIEW_QUESTIONS[nextIndex];
      addAgentMessage(t(`interview.${nextQ.i18nKey}`), nextQ.id);
    }
  }, [currentQuestion, isProcessing, skipQuestion, advanceToNextQuestion, addAgentMessage, t]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const handleSummaryConfirm = useCallback(() => {
    setPhase("completed");
    onComplete();
  }, [setPhase, onComplete]);

  const handleSummaryEdit = useCallback(() => {
    resetInterview();
    hasPostedFirstQuestion.current = false;
  }, [resetInterview]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (phase === "not_started" || phase === "intro") {
    return <IntroScreen onStart={handleStartInterview} />;
  }

  if (phase === "summary") {
    return <SummaryScreen onConfirm={handleSummaryConfirm} onEdit={handleSummaryEdit} />;
  }

  if (phase === "completed") {
    return null; // Parent handles post-interview UI
  }

  return (
    <div className="flex flex-col h-full">
      {/* Progress */}
      <div className="shrink-0 pb-3 border-b border-[rgba(255,255,255,0.06)]">
        <ProgressBar />
      </div>

      {/* Chat Messages */}
      <div className="py-3 space-y-2">
        <AnimatePresence mode="popLayout">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} reduced={prefersReducedMotion} />
          ))}

          {/* Recent fact flashes */}
          {recentFacts.map((fact) => (
            <FactFlash key={fact.id} fact={fact} reduced={prefersReducedMotion} />
          ))}

          {/* Processing indicator */}
          {isProcessing && <ThinkingIndicator key="thinking" reduced={prefersReducedMotion} />}
        </AnimatePresence>
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="shrink-0 pt-2 border-t border-[rgba(255,255,255,0.06)]">
        <div className="flex gap-1.5">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("interview.inputPlaceholder")}
              disabled={isProcessing}
              rows={currentQuestion?.isEmailSample ? 6 : 2}
              className={cn(
                "w-full resize-none rounded-md px-3 py-2",
                "bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)]",
                "font-mohave text-body-sm text-text placeholder:text-text-mute",
                "focus:outline-none focus:border-[#6F94B0]",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                "transition-colors"
              )}
            />
          </div>
          <div className="flex flex-col gap-1">
            <button
              onClick={handleSubmit}
              disabled={!inputValue.trim() || isProcessing}
              className={cn(
                "flex items-center justify-center w-[40px] h-[40px] rounded-md",
                "bg-ops-accent hover:bg-[#4a6680] text-white",
                "disabled:opacity-30 disabled:cursor-not-allowed",
                "transition-colors"
              )}
              title={t("interview.send")}
            >
              {isProcessing ? (
                <Loader2 className="w-[16px] h-[16px] animate-spin" />
              ) : (
                <Send className="w-[16px] h-[16px]" />
              )}
            </button>
            <button
              onClick={handleSkip}
              disabled={isProcessing}
              className={cn(
                "flex items-center justify-center w-[40px] h-[28px] rounded-md",
                "border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)]",
                "hover:bg-[rgba(255,255,255,0.06)] text-text-mute",
                "disabled:opacity-30 disabled:cursor-not-allowed",
                "transition-colors"
              )}
              title={t("interview.skip")}
            >
              <SkipForward className="w-[14px] h-[14px]" />
            </button>
          </div>
        </div>
        {currentQuestion?.isEmailSample && (
          <p className="font-kosugi text-micro text-text-mute mt-[4px]">
            Paste emails separated by --- or one at a time. Shift+Enter for new lines.
          </p>
        )}
      </div>
    </div>
  );
}
