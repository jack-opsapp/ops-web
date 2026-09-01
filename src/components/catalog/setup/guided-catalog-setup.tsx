"use client";

import {
  Dispatch,
  FormEvent,
  KeyboardEvent,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Check,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  Loader2,
  Paperclip,
  Send,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import type {
  CatalogAction,
  CatalogBlueprint,
  GuidedConversationMessage,
  GuidedQuestion,
} from "@/lib/catalog-setup/phase-c/types";
import {
  isGuidedAssistantQuestion,
  normalizeGuidedConversation,
  visibleGuidedConversation,
} from "@/lib/catalog-setup/phase-c/conversation-history";
import {
  GuidedCatalogSourceDocumentError,
  readGuidedCatalogSourceFile,
} from "@/lib/catalog-setup/phase-c/source-document";
import {
  cardEnterVariants,
  cardEnterVariantsReduced,
  PHASE_C_ANALYSIS_SWEEP_DURATION,
  PHASE_C_RIPPLE_DURATION,
  PHASE_C_TYPEWRITER_INTERVAL_MS,
  REDUCED_DURATION,
} from "@/lib/catalog-setup/motion";
import { EASE_SMOOTH } from "@/lib/utils/motion";

type GuidedStatus =
  | "interviewing"
  | "review"
  | "approved"
  | "committing"
  | "attention"
  | "complete";

interface GuidedSession {
  id: string;
  status: GuidedStatus;
  version: number;
  inputRevision: number;
  processedInputRevision: number;
  facts: Array<Record<string, unknown>>;
  conversation: GuidedConversationMessage[];
  unresolvedQuestions: GuidedQuestion[];
  proposedPlan: CatalogBlueprint | null;
  proposedPlanHash: string | null;
  readback: Record<string, unknown> | null;
}

interface GuidedCommitResponse {
  ok: boolean;
  status: "complete" | "attention";
  readback: Record<string, unknown>;
  blockers: Array<Record<string, unknown>>;
}

interface GuidedCatalogSetupProps {
  onUseAnotherMethod: () => void;
  onExit: () => void;
  onAddInventoryList: (sessionId: string, defaultLocation?: string) => void;
  className?: string;
}

const FLOATING_FOOTER_CHIP_CLASS =
  "h-control-32 rounded-chip border border-glass-border bg-glass px-1 font-mono text-micro text-text-3 backdrop-blur-[var(--glass-blur)] backdrop-saturate-[var(--glass-saturate)] transition-colors ease-smooth hover:bg-surface-hover hover:text-text";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function array<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function confirmedDecisionCount(facts: Array<Record<string, unknown>>): number {
  return facts.filter((fact) => {
    const source = record(fact.source);
    return (
      fact.status === "confirmed" &&
      (source.kind === "operator" || source.kind === "upload")
    );
  }).length;
}

function hasQueuedInput(session: GuidedSession): boolean {
  return session.conversation.some(
    (message) =>
      message.role === "operator" &&
      message.state === "queued" &&
      !!message.inputId
  );
}

function normalizeSession(value: unknown): GuidedSession {
  const row = record(value);
  const unresolvedQuestions = array<GuidedQuestion>(
    row.unresolvedQuestions ?? row.unresolved_questions
  );
  const version = Number(row.version ?? 0);
  return {
    id: String(row.id ?? ""),
    status: String(row.status ?? "interviewing") as GuidedStatus,
    version,
    inputRevision: Number(row.inputRevision ?? row.input_revision ?? 0),
    processedInputRevision: Number(
      row.processedInputRevision ?? row.processed_input_revision ?? 0
    ),
    facts: array<Record<string, unknown>>(row.facts),
    conversation: normalizeGuidedConversation(
      row.conversation,
      unresolvedQuestions,
      version
    ),
    unresolvedQuestions,
    proposedPlan:
      (row.proposedPlan ?? row.proposed_plan) == null
        ? null
        : ((row.proposedPlan ?? row.proposed_plan) as CatalogBlueprint),
    proposedPlanHash:
      typeof (row.proposedPlanHash ?? row.proposed_plan_hash) === "string"
        ? String(row.proposedPlanHash ?? row.proposed_plan_hash)
        : null,
    readback: row.readback == null ? null : record(row.readback),
  };
}

async function token(expiredMessage: string): Promise<string> {
  const { getIdToken } = await import("@/lib/firebase/auth");
  const idToken = await getIdToken();
  if (!idToken) throw new Error(expiredMessage);
  return idToken;
}

async function jsonResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as
    (T & { error?: string }) | { error?: string } | null;
  if (!response.ok || !body) {
    throw new Error(body?.error ?? "Guided setup could not continue");
  }
  return body as T;
}

function ReviewStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-l border-glass-border pl-3">
      <div className="font-mono text-data-lg tabular-nums text-text">
        {value}
      </div>
      <div className="font-mono text-micro uppercase tracking-wide text-text-3">
        {label}
      </div>
    </div>
  );
}

function planActions(
  plan: CatalogBlueprint | null,
  type: CatalogAction["actionType"]
): CatalogAction[] {
  return plan?.actions.filter((action) => action.actionType === type) ?? [];
}

function QuestionInput({
  question,
  busy,
  locked,
  editingValue,
  choices,
  setChoices,
  onCancelEdit,
  onAnswer,
}: {
  question: GuidedQuestion;
  busy: boolean;
  locked: boolean;
  editingValue: string | null;
  choices: string[];
  setChoices: Dispatch<SetStateAction<string[]>>;
  onCancelEdit: () => void;
  onAnswer: (answer: unknown) => Promise<boolean>;
}) {
  const { t } = useDictionary("catalog-setup");
  const [value, setValue] = useState("");
  const hasQuickAnswers =
    question.answerKind === "boolean" || (question.options?.length ?? 0) > 0;

  useEffect(() => {
    setValue(editingValue ?? "");
    setChoices([]);
  }, [editingValue, question.id, setChoices]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const clean = value.trim();
    const answer =
      choices.length > 0
        ? choices
        : question.answerKind === "number"
          ? Number(clean)
          : clean;
    if (
      choices.length === 0 &&
      (!clean || (question.answerKind === "number" && !Number.isFinite(answer)))
    ) {
      return;
    }
    if (await onAnswer(answer)) {
      setValue("");
      setChoices([]);
    }
  };

  return (
    <>
      {editingValue ? (
        <div className="flex items-center justify-between gap-1 px-0.5 pb-0.5 font-mono text-micro text-text-3">
          <span>{t("guided.editing", "EDITING QUEUED MESSAGE")}</span>
          <button
            type="button"
            onClick={onCancelEdit}
            className="rounded-chip px-1 py-0.5 transition-colors ease-smooth hover:bg-surface-hover hover:text-text"
          >
            {t("guided.cancelEdit", "[ cancel ]")}
          </button>
        </div>
      ) : null}
      <form
        onSubmit={submit}
        className="flex min-w-0 items-end gap-0.5 px-0.5 pb-0.5"
      >
        <div className="min-w-0 flex-1">
          <Textarea
            autoFocus
            value={value}
            disabled={locked}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            rows={1}
            className="max-h-control-32 !min-h-control-32 resize-none overflow-y-auto border-0 bg-transparent px-1 py-0.5 text-body-sm focus:border-0"
            placeholder={t(
              busy
                ? "guided.followUpPlaceholder"
                : hasQuickAnswers
                  ? "guided.choicePlaceholder"
                  : "guided.answerPlaceholder",
              busy
                ? "Add a quick follow-up or correction"
                : hasQuickAnswers
                  ? "Pick an option above, or type something else"
                  : "Type your answer"
            )}
          />
        </div>
        <button
          type="submit"
          disabled={locked || (!value.trim() && choices.length === 0)}
          aria-label={t("guided.send", "SEND")}
          className="inline-flex h-control-32 shrink-0 items-center gap-0.5 rounded border border-glass-border px-1 font-cakemono text-cake-badge uppercase text-text-2 transition-colors ease-smooth hover:border-ops-accent hover:text-ops-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:pointer-events-none disabled:text-text-mute"
        >
          <Send aria-hidden className="h-icon-16 w-icon-16" strokeWidth={1.5} />
          {t("guided.send", "SEND")}
        </button>
      </form>
    </>
  );
}

function QuickAnswerChoices({
  question,
  choices,
  expanded,
  locked,
  setChoices,
  onExpandedChange,
  onAnswer,
}: {
  question: GuidedQuestion;
  choices: string[];
  expanded: boolean;
  locked: boolean;
  setChoices: Dispatch<SetStateAction<string[]>>;
  onExpandedChange: (expanded: boolean) => void;
  onAnswer: (answer: unknown) => Promise<boolean>;
}) {
  const { t } = useDictionary("catalog-setup");
  const reduceMotion = useReducedMotion();
  const options =
    question.answerKind === "boolean"
      ? [
          { label: t("guided.yes", "YES"), answer: true },
          { label: t("guided.no", "NO"), answer: false },
        ]
      : (question.options?.map((option) => ({
          label: option,
          answer: option,
        })) ?? []);

  if (options.length === 0) return null;

  const panelId = `guided-quick-answers-${question.id.replace(
    /[^a-zA-Z0-9_-]/g,
    "-"
  )}`;
  const disclosureLabel = t(
    expanded ? "guided.hideOptions" : "guided.showOptions",
    expanded ? "HIDE OPTIONS" : "SHOW OPTIONS"
  );

  return (
    <div className="mt-1">
      <button
        type="button"
        aria-controls={panelId}
        aria-expanded={expanded}
        aria-label={disclosureLabel}
        onClick={() => onExpandedChange(!expanded)}
        className="inline-flex h-control-32 items-center gap-0.5 rounded-chip px-1 font-cakemono text-cake-badge uppercase text-text-3 transition-colors ease-smooth hover:bg-surface-hover hover:text-text"
      >
        {disclosureLabel}
        <span className="font-mono text-micro tabular-nums text-text-3">
          · {options.length}
        </span>
        {expanded ? (
          <ChevronUp
            aria-hidden
            className="h-icon-16 w-icon-16"
            strokeWidth={1.5}
          />
        ) : (
          <ChevronDown
            aria-hidden
            className="h-icon-16 w-icon-16"
            strokeWidth={1.5}
          />
        )}
      </button>

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            id={panelId}
            role="group"
            aria-label={t("guided.quickAnswers", "Quick answers")}
            className="mt-0.5 grid gap-0.5"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
            transition={{
              duration: reduceMotion ? REDUCED_DURATION : 0.2,
              ease: EASE_SMOOTH,
            }}
          >
            {options.map(({ label, answer }) => {
              const selected =
                question.answerKind === "multi_choice" &&
                choices.includes(String(answer));
              return (
                <button
                  key={String(answer)}
                  type="button"
                  disabled={locked}
                  aria-pressed={
                    question.answerKind === "multi_choice"
                      ? selected
                      : undefined
                  }
                  onClick={() => {
                    if (question.answerKind !== "multi_choice") {
                      void onAnswer(answer);
                      return;
                    }
                    setChoices((current) =>
                      selected
                        ? current.filter((entry) => entry !== String(answer))
                        : [...current, String(answer)]
                    );
                  }}
                  className={cn(
                    "flex min-h-control-32 w-full items-start gap-1 rounded-chip border px-1.5 py-1 text-left font-mohave text-body-sm normal-case transition-colors ease-smooth disabled:pointer-events-none disabled:opacity-40",
                    selected
                      ? "border-glass-border-medium bg-surface-active text-text"
                      : "border-glass-border bg-surface-input text-text-2 hover:bg-surface-hover hover:text-text"
                  )}
                >
                  {question.answerKind === "multi_choice" ? (
                    <span
                      aria-hidden
                      className="mt-0.5 block h-icon-16 w-icon-16 shrink-0"
                    >
                      {selected ? (
                        <Check
                          className="h-icon-16 w-icon-16"
                          strokeWidth={1.5}
                        />
                      ) : null}
                    </span>
                  ) : null}
                  <span>{label}</span>
                </button>
              );
            })}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function SourceDocumentInput({
  locked,
  onAnswer,
}: {
  locked: boolean;
  onAnswer: (answer: unknown) => void;
}) {
  const { t } = useDictionary("catalog-setup");
  const inputRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const errorMessage = useCallback(
    (error: GuidedCatalogSourceDocumentError) => {
      const messages: Record<GuidedCatalogSourceDocumentError["code"], string> =
        {
          unsupported_type: t(
            "guided.sourceInvalid",
            "Use a CSV or Excel price sheet."
          ),
          too_large: t(
            "guided.sourceTooLarge",
            "Keep the price sheet under 5 MB."
          ),
          empty: t("guided.sourceEmpty", "The price sheet has no rows."),
          invalid_headers: t(
            "guided.sourceHeaders",
            "Every price-sheet column needs a unique heading."
          ),
          too_many_rows: t(
            "guided.sourceRows",
            "Split the price sheet into files with 250 rows or fewer."
          ),
          too_many_columns: t(
            "guided.sourceColumns",
            "Keep the price sheet to 50 columns or fewer."
          ),
          cell_too_large: t(
            "guided.sourceCell",
            "One cell is too long. Shorten long notes and try again."
          ),
          answer_too_large: t(
            "guided.sourcePayload",
            "Split the price sheet into smaller files and try again."
          ),
          read_failed: t(
            "guided.sourceReadError",
            "The price sheet could not be read."
          ),
        };
      return messages[error.code];
    },
    [t]
  );

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file || locked || reading) return;
      setReading(true);
      setUploadError(null);
      try {
        onAnswer(await readGuidedCatalogSourceFile(file));
      } catch (error) {
        setUploadError(
          error instanceof GuidedCatalogSourceDocumentError
            ? errorMessage(error)
            : t("guided.sourceReadError", "The price sheet could not be read.")
        );
      } finally {
        setReading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [errorMessage, locked, onAnswer, reading, t]
  );

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-0.5 border-t border-glass-border pt-0.5">
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        aria-label={t("guided.sourceLabel", "Upload price sheet")}
        className="sr-only"
        disabled={locked || reading}
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />
      <button
        type="button"
        disabled={locked || reading}
        onClick={() => inputRef.current?.click()}
        className="inline-flex h-control-32 items-center gap-0.5 rounded px-1 font-cakemono text-cake-badge uppercase text-text-3 transition-colors ease-smooth hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:pointer-events-none disabled:opacity-40"
      >
        {reading ? (
          <Loader2 aria-hidden className="h-icon-16 w-icon-16 animate-spin" />
        ) : (
          <Paperclip
            aria-hidden
            className="h-icon-16 w-icon-16 shrink-0"
            strokeWidth={1.5}
          />
        )}
        {reading
          ? t("guided.sourceReading", "READING PRICE SHEET")
          : t("guided.sourceUpload", "UPLOAD PRICE SHEET")}
      </button>
      <span className="hidden font-mono text-micro text-text-mute sm:inline">
        {t("guided.sourceHint", "[ optional · CSV or Excel · up to 5 MB ]")}
      </span>
      {uploadError ? (
        <p className="text-danger w-full font-mono text-micro" role="alert">
          {uploadError}
        </p>
      ) : null}
    </div>
  );
}

function PhaseCActivity({ label }: { label: string }) {
  const reduceMotion = useReducedMotion();
  return (
    <div className="flex items-center gap-1">
      <span className="flex h-icon-16 items-center gap-0.5" aria-hidden>
        {Array.from({ length: 5 }, (_, index) => (
          <motion.span
            key={index}
            data-testid="phase-c-loader-bar"
            className="h-1.5 w-0.5 origin-center rounded-bar bg-agent-text2"
            animate={
              reduceMotion
                ? { opacity: 0.65, scaleY: 0.7 }
                : {
                    opacity: [0.35, 1, 0.35],
                    scaleY: [0.45, 1, 0.45],
                  }
            }
            transition={
              reduceMotion
                ? {
                    duration: REDUCED_DURATION,
                    ease: EASE_SMOOTH,
                  }
                : {
                    duration: PHASE_C_RIPPLE_DURATION,
                    delay: (index * PHASE_C_RIPPLE_DURATION) / 5,
                    ease: EASE_SMOOTH,
                    repeat: Infinity,
                    repeatDelay: 0,
                  }
            }
          />
        ))}
      </span>
      <span>{label}</span>
    </div>
  );
}

function PhaseCProcessingSweep() {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    return (
      <span
        aria-hidden
        data-testid="phase-c-processing-sweep"
        className="pointer-events-none absolute inset-0 overflow-hidden rounded bg-agent-bg"
      >
        <span className="absolute inset-y-0 left-0 flex w-1 items-center justify-around bg-agent-bg-hi">
          {Array.from({ length: 3 }, (_, index) => (
            <span key={index} className="h-full w-px bg-agent-border-hi" />
          ))}
        </span>
      </span>
    );
  }

  return (
    <span
      aria-hidden
      data-testid="phase-c-processing-sweep"
      className="pointer-events-none absolute inset-0 overflow-hidden rounded"
    >
      <motion.span
        className="absolute inset-y-0 left-0 flex w-1/3 items-stretch justify-end gap-0.5 border-x border-agent-border bg-agent-bg-hi pr-1 will-change-transform"
        animate={{
          x: ["-110%", "310%"],
          opacity: [0, 1, 1, 0],
        }}
        transition={{
          duration: PHASE_C_ANALYSIS_SWEEP_DURATION,
          ease: EASE_SMOOTH,
          repeat: Infinity,
          repeatDelay: PHASE_C_RIPPLE_DURATION / 4,
          times: [0, 0.18, 0.82, 1],
        }}
      >
        {Array.from({ length: 3 }, (_, index) => (
          <span key={index} className="h-full w-px bg-agent-border-hi" />
        ))}
      </motion.span>
    </span>
  );
}

function PhaseCTypewriter({
  text,
  animate,
  onProgress,
  onComplete,
}: {
  text: string;
  animate: boolean;
  onProgress: () => void;
  onComplete: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [visible, setVisible] = useState(animate && !reduceMotion ? "" : text);

  useEffect(() => {
    if (!animate || reduceMotion) {
      setVisible(text);
      onComplete();
      return;
    }

    let frame: number | null = null;
    let startedAt: number | null = null;
    let lastLength = 0;
    setVisible("");

    const tick = (now: number) => {
      if (startedAt === null) startedAt = now;
      const nextLength = Math.min(
        text.length,
        Math.max(
          1,
          Math.floor((now - startedAt) / PHASE_C_TYPEWRITER_INTERVAL_MS) + 1
        )
      );
      if (nextLength !== lastLength) {
        lastLength = nextLength;
        setVisible(text.slice(0, nextLength));
        onProgress();
      }
      if (nextLength < text.length) {
        frame = requestAnimationFrame(tick);
      } else {
        onComplete();
      }
    };

    frame = requestAnimationFrame(tick);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [animate, onComplete, onProgress, reduceMotion, text]);

  if (!animate || reduceMotion) {
    return <span className="whitespace-pre-wrap">{text}</span>;
  }

  return (
    <>
      <span
        aria-hidden
        data-testid="phase-c-typewriter"
        className="whitespace-pre-wrap"
      >
        {visible}
      </span>
      <span className="sr-only">{text}</span>
    </>
  );
}

export function GuidedCatalogSetup({
  onUseAnotherMethod,
  onExit,
  onAddInventoryList,
  className,
}: GuidedCatalogSetupProps) {
  const { t } = useDictionary("catalog-setup");
  const [session, setSession] = useState<GuidedSession | null>(null);
  const [agentAvailable, setAgentAvailable] = useState(true);
  const [busy, setBusy] = useState(true);
  const [messageSaving, setMessageSaving] = useState(false);
  const [removingInputId, setRemovingInputId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingInput, setEditingInput] = useState<{
    id: string;
    value: string;
  } | null>(null);
  const [animatedMessageId, setAnimatedMessageId] = useState<string | null>(
    null
  );
  const [headerInset, setHeaderInset] = useState(0);
  const [composerInset, setComposerInset] = useState(0);
  const [choices, setChoices] = useState<string[]>([]);
  const [quickAnswersExpanded, setQuickAnswersExpanded] = useState(true);
  const [commitResult, setCommitResult] = useState<GuidedCommitResponse | null>(
    null
  );
  const startRef = useRef(false);
  const turnInFlightRef = useRef(false);
  const sessionRef = useRef<GuidedSession | null>(null);
  const transcriptRef = useRef<HTMLOListElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const activeQuestionId = session?.unresolvedQuestions[0]?.id ?? null;

  useEffect(() => {
    setChoices([]);
    setQuickAnswersExpanded(true);
  }, [activeQuestionId]);

  const applySession = useCallback((value: unknown) => {
    const next = normalizeSession(value);
    sessionRef.current = next;
    setSession(next);
    return next;
  }, []);

  const scrollTranscriptToBottom = useCallback(() => {
    const transcript = transcriptRef.current;
    if (!transcript || transcript.scrollHeight <= transcript.clientHeight) {
      return;
    }
    transcript.scrollTo({
      top: transcript.scrollHeight,
      behavior: "auto",
    });
  }, []);

  const runTurn = useCallback(
    async (current: GuidedSession) => {
      if (
        current.inputRevision <= current.processedInputRevision ||
        !hasQueuedInput(current)
      ) {
        setBusy(false);
        return;
      }
      if (turnInFlightRef.current) return;
      turnInFlightRef.current = true;
      setBusy(true);
      setError(null);
      let generationSucceeded = false;
      try {
        const response = await fetch(
          `/api/catalog/setup/sessions/${current.id}/turn`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              token: await token(
                t(
                  "guided.sessionExpired",
                  "Your session has expired. Sign in again."
                )
              ),
              expectedVersion: current.version,
              expectedInputRevision: current.inputRevision,
            }),
          }
        );
        const result = await jsonResponse<{
          session: unknown;
          superseded?: boolean;
        }>(response);
        const next = applySession(result.session);
        generationSucceeded = true;
        if (!result.superseded) {
          const newestAssistant = [...next.conversation]
            .reverse()
            .find(
              (message) =>
                message.role === "assistant" && message.version === next.version
            );
          setAnimatedMessageId(newestAssistant?.id ?? null);
        }
      } catch (turnError) {
        const latest = sessionRef.current;
        const requestWasSuperseded =
          !!latest &&
          (latest.id !== current.id ||
            latest.version !== current.version ||
            latest.inputRevision !== current.inputRevision);
        if (!requestWasSuperseded) {
          setError(
            turnError instanceof Error
              ? turnError.message
              : t("guided.error", "Setup could not continue")
          );
        }
      } finally {
        turnInFlightRef.current = false;
        const latest = sessionRef.current;
        const requestWasSuperseded =
          !!latest &&
          (latest.id !== current.id ||
            latest.version !== current.version ||
            latest.inputRevision !== current.inputRevision);
        if (
          latest &&
          latest.inputRevision > latest.processedInputRevision &&
          hasQueuedInput(latest) &&
          (generationSucceeded || requestWasSuperseded)
        ) {
          void runTurn(latest);
        } else {
          setBusy(false);
        }
      }
    },
    [applySession, t]
  );

  useEffect(() => {
    scrollTranscriptToBottom();
  }, [
    busy,
    composerInset,
    error,
    headerInset,
    reduceMotion,
    session?.conversation.length,
    scrollTranscriptToBottom,
  ]);

  useEffect(() => {
    if (quickAnswersExpanded) {
      scrollTranscriptToBottom();
    }
  }, [activeQuestionId, quickAnswersExpanded, scrollTranscriptToBottom]);

  useEffect(() => {
    const header = headerRef.current;
    const composer = composerRef.current;
    if (!header || !composer) return;
    const measure = () => {
      setHeaderInset(header.offsetHeight);
      setComposerInset(composer.offsetHeight);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    observer.observe(composer);
    return () => observer.disconnect();
  }, [session?.status]);

  const persistInput = useCallback(
    async (
      answer: unknown,
      operation: "append" | "edit" | "remove" = "append",
      expectedInputId?: string
    ) => {
      const current = sessionRef.current;
      if (!current || messageSaving) return false;
      if (operation === "remove") {
        setRemovingInputId(expectedInputId ?? null);
      }
      setMessageSaving(true);
      setError(null);
      try {
        const authToken = await token(
          t("guided.sessionExpired", "Your session has expired. Sign in again.")
        );
        const save = async (
          target: GuidedSession,
          allowConflictRefresh: boolean
        ): Promise<{
          session: unknown;
          input: Record<string, unknown> | null;
        }> => {
          const response = await fetch(
            `/api/catalog/setup/sessions/${target.id}/messages`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                token: authToken,
                operation,
                answer,
                expectedVersion: target.version,
                expectedInputId,
              }),
            }
          );
          if (response.status === 409 && allowConflictRefresh) {
            const refreshResponse = await fetch("/api/catalog/setup/sessions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token: authToken }),
            });
            const refreshed = await jsonResponse<{
              session: unknown | null;
              agentAvailable: boolean;
            }>(refreshResponse);
            if (!refreshed.session) {
              throw new Error(t("guided.error", "Setup could not continue"));
            }
            const freshSession = applySession(refreshed.session);
            return save(freshSession, false);
          }
          return jsonResponse<{
            session: unknown;
            input: Record<string, unknown> | null;
          }>(response);
        };
        const result = await save(current, true);
        const next = applySession(result.session);
        const queuedInputRemains = hasQueuedInput(next);
        setEditingInput(null);
        setBusy(queuedInputRemains);
        if (queuedInputRemains && !turnInFlightRef.current) {
          void runTurn(next);
        }
        return true;
      } catch (inputError) {
        setError(
          inputError instanceof Error
            ? inputError.message
            : t("guided.error", "Setup could not continue")
        );
        return false;
      } finally {
        if (operation === "remove") {
          setRemovingInputId(null);
        }
        setMessageSaving(false);
      }
    },
    [applySession, messageSaving, runTurn, t]
  );

  useEffect(() => {
    if (startRef.current) return;
    startRef.current = true;
    void (async () => {
      setBusy(true);
      try {
        const response = await fetch("/api/catalog/setup/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: await token(
              t(
                "guided.sessionExpired",
                "Your session has expired. Sign in again."
              )
            ),
          }),
        });
        const result = await jsonResponse<{
          session: unknown | null;
          agentAvailable: boolean;
        }>(response);
        setAgentAvailable(result.agentAvailable);
        if (result.agentAvailable && result.session) {
          applySession(result.session);
        } else {
          sessionRef.current = null;
          setSession(null);
        }
        setBusy(false);
      } catch (startError) {
        setError(
          startError instanceof Error
            ? startError.message
            : t("guided.error", "Setup could not start")
        );
        setBusy(false);
      }
    })();
  }, [applySession, t]);

  const products = useMemo(
    () => planActions(session?.proposedPlan ?? null, "upsert_product"),
    [session?.proposedPlan]
  );
  const familyCount = useMemo(
    () =>
      planActions(session?.proposedPlan ?? null, "upsert_catalog_family")
        .length,
    [session?.proposedPlan]
  );
  const materialRuleCount = useMemo(
    () =>
      planActions(
        session?.proposedPlan ?? null,
        "upsert_material_quantity_rule"
      ).length,
    [session?.proposedPlan]
  );
  const taskCount = useMemo(
    () =>
      (session?.proposedPlan?.actions ?? []).filter((action) =>
        ["reuse_task_type", "create_task_type"].includes(action.actionType)
      ).length,
    [session?.proposedPlan]
  );

  const commit = useCallback(async () => {
    if (!session?.proposedPlanHash || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/catalog/setup/sessions/${session.id}/commit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: await token(
              t(
                "guided.sessionExpired",
                "Your session has expired. Sign in again."
              )
            ),
            approvalHash: session.proposedPlanHash,
          }),
        }
      );
      const result = (await response.json().catch(() => null)) as
        (GuidedCommitResponse & { error?: string }) | null;
      const recoverableAttention =
        response.status === 422 && result?.status === "attention";
      if ((!response.ok && !recoverableAttention) || !result) {
        throw new Error(
          result?.error ?? t("guided.commitError", "Catalog could not be built")
        );
      }
      setCommitResult(result);
      setSession((current) =>
        current
          ? {
              ...current,
              status: result.status,
              readback: result.readback,
            }
          : current
      );
    } catch (commitError) {
      setError(
        commitError instanceof Error
          ? commitError.message
          : t("guided.commitError", "Catalog could not be built")
      );
    } finally {
      setBusy(false);
    }
  }, [busy, session, t]);

  const startOver = useCallback(async () => {
    if (!session || busy) return;
    setBusy(true);
    setError(null);
    try {
      const idToken = await token(
        t("guided.sessionExpired", "Your session has expired. Sign in again.")
      );
      const abandonResponse = await fetch(
        `/api/catalog/setup/sessions/${session.id}/abandon`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: idToken,
            expectedVersion: session.version,
          }),
        }
      );
      await jsonResponse<{ session: unknown }>(abandonResponse);

      const startResponse = await fetch("/api/catalog/setup/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: idToken }),
      });
      const result = await jsonResponse<{
        session: unknown | null;
        agentAvailable: boolean;
      }>(startResponse);
      setAgentAvailable(result.agentAvailable);
      setCommitResult(null);
      setEditingInput(null);
      setAnimatedMessageId(null);
      if (result.agentAvailable && result.session) {
        applySession(result.session);
      } else {
        sessionRef.current = null;
        setSession(null);
      }
    } catch (restartError) {
      setError(
        restartError instanceof Error
          ? restartError.message
          : t("guided.restartError", "Setup could not restart")
      );
    } finally {
      setBusy(false);
    }
  }, [applySession, busy, session, t]);

  if (busy && !session) {
    return (
      <div
        data-testid="guided-catalog-loading"
        className={cn(
          "grid min-h-96 place-items-center bg-background",
          className
        )}
      >
        <div className="font-mono text-micro uppercase tracking-wide text-text-3">
          <PhaseCActivity label={t("guided.loading", "READING YOUR CATALOG")} />
        </div>
      </div>
    );
  }

  if (!agentAvailable || (!session && error)) {
    return (
      <section
        data-testid="guided-catalog-unavailable"
        className={cn(
          "mx-auto flex min-h-96 max-w-2xl flex-col justify-center px-5",
          className
        )}
      >
        <span className="font-mono text-micro uppercase tracking-wide text-text-3">
          {"// "}
          {t("guided.kicker", "GUIDED CATALOG SETUP")}
        </span>
        <h1 className="text-cake-title mt-3 font-cakemono font-light uppercase text-text">
          {t("guided.unavailableTitle", "GUIDED SETUP IS OFFLINE")}
        </h1>
        <p className="mt-3 max-w-prose font-mohave text-body text-text-2">
          {error ??
            t(
              "guided.unavailableBody",
              "Use another setup method. Nothing has been changed."
            )}
        </p>
        <button
          type="button"
          onClick={onUseAnotherMethod}
          className="mt-6 w-fit rounded border border-ops-accent px-3 py-2 font-cakemono text-cake-button uppercase text-ops-accent transition-colors hover:bg-ops-accent hover:text-black"
        >
          {t("guided.otherMethod", "USE ANOTHER METHOD")}
        </button>
      </section>
    );
  }

  if (!session) return null;

  if (session.status === "complete" || commitResult?.status === "complete") {
    const defaultLocation = session.facts.find(
      (fact) =>
        typeof fact.key === "string" &&
        fact.key.toLocaleLowerCase("en-CA").includes("location") &&
        typeof fact.value === "string" &&
        fact.value.trim()
    )?.value as string | undefined;
    return (
      <section
        data-testid="guided-catalog-complete"
        className={cn(
          "mx-auto flex min-h-96 max-w-3xl flex-col justify-center px-5",
          className
        )}
      >
        <span className="text-success font-mono text-micro uppercase tracking-wide">
          {"// "}
          {t("guided.completeKicker", "CATALOG VERIFIED")}
        </span>
        <h1 className="text-cake-title mt-3 font-cakemono font-light uppercase text-text">
          {t("guided.completeTitle", "YOUR CATALOG IS READY")}
        </h1>
        <p className="mt-3 max-w-prose font-mohave text-body text-text-2">
          {t(
            "guided.inventoryQuestion",
            "Do you have a current inventory list you want me to add?"
          )}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => onAddInventoryList(session.id, defaultLocation)}
            className="rounded border border-ops-accent px-3 py-2 font-cakemono text-cake-button uppercase text-ops-accent transition-colors hover:bg-ops-accent hover:text-black"
          >
            {t("guided.addInventory", "ADD INVENTORY LIST")}
          </button>
          <button
            type="button"
            onClick={onExit}
            className="px-2 py-2 font-mono text-micro text-text-3 transition-colors hover:text-text"
          >
            {t("guided.notNow", "[ not now ]")}
          </button>
        </div>
      </section>
    );
  }

  if (session.status === "attention" || commitResult?.status === "attention") {
    return (
      <section
        data-testid="guided-catalog-attention"
        className={cn(
          "mx-auto flex min-h-96 max-w-3xl flex-col justify-center px-5",
          className
        )}
      >
        <span className="text-warning font-mono text-micro uppercase tracking-wide">
          {"// "}
          {t("guided.attentionKicker", "ONE CHECK REMAINS")}
        </span>
        <h1 className="text-cake-title mt-3 font-cakemono font-light uppercase text-text">
          {t("guided.attentionTitle", "MOST OF YOUR CATALOG IS READY")}
        </h1>
        <p className="mt-3 max-w-prose font-mohave text-body text-text-2">
          {t(
            "guided.attentionBody",
            "A live record is still connected to an old catalog item, so setup left it untouched. Your saved work is safe."
          )}
        </p>
        <button
          type="button"
          onClick={onExit}
          className="mt-6 w-fit rounded border border-glass-border px-3 py-2 font-cakemono text-cake-button uppercase text-text transition-colors hover:border-ops-accent hover:text-ops-accent"
        >
          {t("guided.openCatalog", "OPEN CATALOG")}
        </button>
      </section>
    );
  }

  if (session.status === "review" && session.proposedPlan) {
    return (
      <section
        data-testid="guided-catalog-review"
        className={cn("mx-auto w-full max-w-5xl px-4 py-5 md:px-6", className)}
      >
        <header className="border-b border-glass-border pb-4">
          <span className="font-mono text-micro uppercase tracking-wide text-text-3">
            {"// "}
            {t("guided.reviewKicker", "READY FOR REVIEW")}
          </span>
          <h1 className="text-cake-title mt-2 font-cakemono font-light uppercase text-text">
            {t("guided.reviewTitle", "HERE'S WHAT WILL BE BUILT")}
          </h1>
          <p className="mt-2 max-w-prose font-mohave text-body text-text-2">
            {t(
              "guided.reviewBody",
              "I checked this against your live catalog. Existing records are reused; only the approved changes go live."
            )}
          </p>
        </header>

        <div className="grid grid-cols-2 gap-4 border-b border-glass-border py-4 md:grid-cols-4">
          <ReviewStat
            value={products.length}
            label={t("guided.statProducts", "PRODUCTS")}
          />
          <ReviewStat
            value={familyCount}
            label={t("guided.statFamilies", "MATERIAL FAMILIES")}
          />
          <ReviewStat
            value={materialRuleCount}
            label={t("guided.statRules", "PURCHASING RULES")}
          />
          <ReviewStat
            value={taskCount}
            label={t("guided.statTasks", "TASK LINKS")}
          />
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {products.map((product) => (
            <article key={product.actionKey} className="glass-surface p-4">
              <div className="font-cakemono text-cake-button uppercase text-text">
                {String(product.payload.name ?? "—")}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 font-mono text-micro text-text-3">
                <span>
                  {t("guided.price", "PRICE")}{" "}
                  <strong className="font-normal text-text">
                    ${Number(product.payload.basePrice ?? 0).toFixed(2)}/
                    {String(
                      product.payload.pricingUnit ?? t("guided.unit", "unit")
                    )}
                  </strong>
                </span>
                <span>
                  {t("guided.minimum", "MIN")}{" "}
                  <strong className="font-normal text-text">
                    ${Number(product.payload.minimumCharge ?? 0).toFixed(2)}
                  </strong>
                </span>
                <span>
                  {product.payload.showInStorefront === false
                    ? t("guided.staffOnly", "STAFF ONLY")
                    : t("guided.customerFacing", "CUSTOMER FACING")}
                </span>
              </div>
            </article>
          ))}
        </div>

        {session.proposedPlan.issues.length > 0 ? (
          <div className="mt-4 rounded border border-glass-border px-3 py-3 font-mono text-micro text-text-3">
            {"// "}
            {session.proposedPlan.issues
              .map((issue) => issue.message)
              .join(" · ")}
          </div>
        ) : null}

        {error ? (
          <p className="text-danger mt-4 font-mono text-micro">{error}</p>
        ) : null}

        <footer className="mt-6 flex flex-wrap items-center gap-4 border-t border-glass-border pt-4">
          <button
            type="button"
            disabled={busy || !session.proposedPlanHash}
            onClick={() => void commit()}
            className="inline-flex min-h-11 items-center gap-2 rounded border border-ops-accent px-4 font-cakemono text-cake-button uppercase text-ops-accent transition-colors hover:bg-ops-accent hover:text-black disabled:border-glass-border disabled:text-text-mute"
          >
            {busy ? (
              <Loader2
                aria-hidden
                className="h-icon-16 w-icon-16 animate-spin"
              />
            ) : null}
            {busy
              ? t("guided.building", "BUILDING")
              : t("guided.build", "BUILD CATALOG")}
          </button>
          <button
            type="button"
            onClick={onUseAnotherMethod}
            className="font-mono text-micro text-text-3 transition-colors hover:text-text"
          >
            {t("guided.otherMethodGhost", "[ use another method ]")}
          </button>
          <button
            type="button"
            onClick={onExit}
            className="font-mono text-micro text-text-3 transition-colors hover:text-text"
          >
            {t("guided.exit", "[ back to catalog ]")}
          </button>
        </footer>
      </section>
    );
  }

  const question = session.unresolvedQuestions[0];
  const conversation = visibleGuidedConversation(session.conversation);
  const latestQueuedInput = [...conversation]
    .reverse()
    .find(
      (message) =>
        message.role === "operator" &&
        message.state === "queued" &&
        !!message.inputId
    );
  const processingInputId =
    busy && latestQueuedInput?.inputId !== removingInputId
      ? latestQueuedInput?.inputId
      : null;
  return (
    <section
      data-testid="guided-catalog-interview"
      className={cn(
        "relative h-full min-h-0 w-full overflow-hidden bg-background",
        className
      )}
    >
      <header
        ref={headerRef}
        className="absolute inset-x-0 top-0 z-20 border-b border-glass-border bg-background"
      >
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-end justify-between gap-1 px-4 py-1.5 md:px-6">
          <div>
            <span className="font-mono text-micro uppercase tracking-wide text-text-3">
              {"// "}
              {t("guided.kicker", "GUIDED CATALOG SETUP")}
            </span>
            <h1 className="mt-0.5 font-cakemono text-cake-section font-light uppercase text-text">
              {t("guided.conversationTitle", "BUILD YOUR CATALOG")}
            </h1>
          </div>
          <div className="font-mono text-micro text-text-mute">
            {t("guided.factCount", "Confirmed decisions · {count}").replace(
              "{count}",
              String(confirmedDecisionCount(session.facts))
            )}
          </div>
        </div>
      </header>

      <ol
        ref={transcriptRef}
        role="log"
        aria-live="polite"
        aria-label={t("guided.transcriptLabel", "Catalog setup conversation")}
        className="scrollbar-hide absolute inset-0 min-h-0 space-y-2 overflow-y-auto px-4 pb-2 md:px-6"
      >
        <li aria-hidden style={{ height: headerInset }} />
        <AnimatePresence initial={false}>
          {conversation.map((message) => {
            const assistant = message.role === "assistant";
            const processing =
              !assistant && message.inputId === processingInputId;
            const currentQuestion =
              assistant &&
              question &&
              isGuidedAssistantQuestion(message, question)
                ? question
                : null;
            const currentHelp = currentQuestion?.help
              ? currentQuestion.help
              : null;
            return (
              <motion.li
                key={message.id}
                variants={
                  reduceMotion ? cardEnterVariantsReduced : cardEnterVariants
                }
                initial="hidden"
                animate="visible"
                exit="exit"
                className={cn(
                  "mx-auto w-full max-w-4xl font-mohave text-body",
                  assistant ? "text-text" : "flex flex-col items-end text-text"
                )}
                data-message-role={message.role}
                aria-busy={processing || undefined}
              >
                <div
                  className={cn(
                    "relative w-fit max-w-3xl overflow-hidden",
                    assistant
                      ? "border-l border-agent-border bg-agent-bg px-2 py-1.5"
                      : "rounded border border-glass-border bg-surface-input px-2 py-1.5"
                  )}
                >
                  {processing ? <PhaseCProcessingSweep /> : null}
                  <div
                    className={cn(
                      "mb-0.5 font-mono text-micro uppercase tracking-wide",
                      assistant ? "text-agent-text2" : "text-text-mute"
                    )}
                  >
                    {assistant
                      ? t("guided.agentLabel", "PHASE C")
                      : t("guided.operatorLabel", "YOU")}
                  </div>
                  {message.kind === "source_document" ? (
                    <div className="flex items-center gap-1">
                      <FileSpreadsheet
                        aria-hidden
                        className="h-icon-16 w-icon-16 shrink-0 text-text-3"
                      />
                      <span>
                        {t(
                          "guided.sourceMessage",
                          "Uploaded {filename}"
                        ).replace("{filename}", message.content)}
                      </span>
                    </div>
                  ) : assistant ? (
                    <p>
                      <PhaseCTypewriter
                        text={message.content}
                        animate={message.id === animatedMessageId}
                        onProgress={scrollTranscriptToBottom}
                        onComplete={() =>
                          setAnimatedMessageId((current) =>
                            current === message.id ? null : current
                          )
                        }
                      />
                    </p>
                  ) : (
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  )}
                  {currentHelp ? (
                    <p className="mt-1 text-body-sm text-text-2">
                      {currentHelp}
                    </p>
                  ) : null}
                  {currentQuestion && !editingInput ? (
                    <QuickAnswerChoices
                      question={currentQuestion}
                      choices={choices}
                      expanded={quickAnswersExpanded}
                      locked={messageSaving}
                      setChoices={setChoices}
                      onExpandedChange={setQuickAnswersExpanded}
                      onAnswer={(answer) => persistInput(answer)}
                    />
                  ) : null}
                </div>
                {!assistant &&
                message.inputId &&
                message.inputId === latestQueuedInput?.inputId &&
                message.state === "queued" ? (
                  <div className="mt-0.5 flex items-center gap-0.5 font-mono text-micro text-text-mute">
                    {message.kind === "text" ? (
                      <button
                        type="button"
                        disabled={messageSaving}
                        onClick={() =>
                          setEditingInput({
                            id: message.inputId!,
                            value: message.content,
                          })
                        }
                        className="rounded-chip border border-glass-border px-1 py-0.5 transition-colors ease-smooth hover:bg-surface-hover hover:text-text disabled:pointer-events-none disabled:opacity-40"
                      >
                        {t("guided.editQueued", "[ edit ]")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={messageSaving}
                      onClick={() =>
                        void persistInput(undefined, "remove", message.inputId)
                      }
                      className="rounded-chip border border-glass-border px-1 py-0.5 transition-colors ease-smooth hover:bg-surface-hover hover:text-text disabled:pointer-events-none disabled:opacity-40"
                    >
                      {t("guided.removeQueued", "[ remove ]")}
                    </button>
                  </div>
                ) : null}
              </motion.li>
            );
          })}
        </AnimatePresence>

        {error ? (
          <li role="alert" className="mx-auto w-full max-w-4xl">
            <div className="ml-auto w-fit max-w-3xl rounded border border-rose-line bg-rose-soft px-2 py-1.5">
              <p className="font-mohave text-body-sm text-rose">{error}</p>
              {session.inputRevision > session.processedInputRevision ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void runTurn(session)}
                  className="mt-2 font-mono text-micro text-text-2 transition-colors hover:text-text disabled:pointer-events-none disabled:opacity-40"
                >
                  {t("guided.retry", "[ try again ]")}
                </button>
              ) : null}
            </div>
          </li>
        ) : null}
        <li aria-hidden style={{ height: composerInset }} />
      </ol>

      <div
        ref={composerRef}
        className="pointer-events-none absolute inset-x-0 bottom-0 z-20"
      >
        <div className="mx-auto w-full max-w-4xl px-4 pb-1 md:px-6">
          <div
            data-testid="guided-catalog-composer"
            className="pointer-events-auto rounded border border-line bg-glass-dense p-1 backdrop-blur-[var(--glass-blur)] backdrop-saturate-[var(--glass-saturate)] focus-within:border-line-hi"
          >
            {question ? (
              <>
                <QuestionInput
                  key={question.id}
                  question={question}
                  busy={busy}
                  locked={messageSaving}
                  editingValue={editingInput?.value ?? null}
                  choices={choices}
                  setChoices={setChoices}
                  onCancelEdit={() => setEditingInput(null)}
                  onAnswer={(answer) =>
                    persistInput(
                      answer,
                      editingInput ? "edit" : "append",
                      editingInput?.id
                    )
                  }
                />
                <SourceDocumentInput
                  locked={messageSaving}
                  onAnswer={(answer) => void persistInput(answer)}
                />
              </>
            ) : (
              <div className="font-mono text-micro uppercase tracking-wide text-text-3">
                <PhaseCActivity
                  label={t("guided.preparing", "PREPARING THE NEXT QUESTION")}
                />
              </div>
            )}
          </div>

          <footer
            data-testid="guided-catalog-footer-actions"
            className="pointer-events-auto mt-0.5 flex flex-wrap justify-start gap-0.5"
          >
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  type="button"
                  disabled={busy}
                  className={cn(
                    FLOATING_FOOTER_CHIP_CLASS,
                    "disabled:pointer-events-none disabled:opacity-40"
                  )}
                >
                  {t("guided.restartGhost", "[ start over ]")}
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t("guided.restartTitle", "START THIS SETUP AGAIN?")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t(
                      "guided.restartBody",
                      "This clears this setup conversation and starts again. Your live catalog stays untouched."
                    )}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>
                    {t("guided.restartCancel", "KEEP WORKING")}
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => void startOver()}
                    className="border-rose-line bg-rose-soft text-rose hover:border-rose"
                  >
                    {t("guided.restartConfirm", "START OVER")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <button
              type="button"
              onClick={onUseAnotherMethod}
              className={FLOATING_FOOTER_CHIP_CLASS}
            >
              {t("guided.otherMethodGhost", "[ use another method ]")}
            </button>
            <button
              type="button"
              onClick={onExit}
              className={FLOATING_FOOTER_CHIP_CLASS}
            >
              {t("guided.exit", "[ back to catalog ]")}
            </button>
          </footer>
        </div>
      </div>
    </section>
  );
}

export default GuidedCatalogSetup;
