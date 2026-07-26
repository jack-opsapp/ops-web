"use client";

import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Check,
  FileSpreadsheet,
  Loader2,
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
import { Input } from "@/components/ui/input";
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
  guidedOperatorMessageForAnswer,
  normalizeGuidedConversation,
} from "@/lib/catalog-setup/phase-c/conversation-history";
import {
  GuidedCatalogSourceDocumentError,
  readGuidedCatalogSourceFile,
} from "@/lib/catalog-setup/phase-c/source-document";
import {
  cardEnterVariants,
  cardEnterVariantsReduced,
} from "@/lib/catalog-setup/motion";

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
  onAddInventoryList: (
    sessionId: string,
    defaultLocation?: string,
  ) => void;
  className?: string;
}

interface PendingGuidedTurn {
  answer: unknown;
  message: GuidedConversationMessage;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function array<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function confirmedDecisionCount(
  facts: Array<Record<string, unknown>>,
): number {
  return facts.filter((fact) => {
    const source = record(fact.source);
    return (
      fact.status === "confirmed" &&
      (source.kind === "operator" || source.kind === "upload")
    );
  }).length;
}

function normalizeSession(value: unknown): GuidedSession {
  const row = record(value);
  const unresolvedQuestions = array<GuidedQuestion>(
    row.unresolvedQuestions ?? row.unresolved_questions,
  );
  const version = Number(row.version ?? 0);
  return {
    id: String(row.id ?? ""),
    status: String(row.status ?? "interviewing") as GuidedStatus,
    version,
    facts: array<Record<string, unknown>>(row.facts),
    conversation: normalizeGuidedConversation(
      row.conversation,
      unresolvedQuestions,
      version,
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
    readback:
      (row.readback == null
        ? null
        : record(row.readback)),
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
    | (T & { error?: string })
    | { error?: string }
    | null;
  if (!response.ok || !body) {
    throw new Error(body?.error ?? "Guided setup could not continue");
  }
  return body as T;
}

function ReviewStat({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
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
  type: CatalogAction["actionType"],
): CatalogAction[] {
  return plan?.actions.filter((action) => action.actionType === type) ?? [];
}

function QuestionInput({
  question,
  busy,
  locked,
  onAnswer,
}: {
  question: GuidedQuestion;
  busy: boolean;
  locked: boolean;
  onAnswer: (answer: unknown) => void;
}) {
  const { t } = useDictionary("catalog-setup");
  const [value, setValue] = useState("");
  const [choices, setChoices] = useState<string[]>([]);

  useEffect(() => {
    setValue("");
    setChoices([]);
  }, [question.id]);

  if (busy) {
    return (
      <button
        type="button"
        disabled
        className="pointer-events-none inline-flex min-h-11 items-center gap-2 rounded border border-glass-border px-3 font-cakemono text-cake-button uppercase text-text-mute"
      >
        <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
        {t("guided.working", "WORKING…")}
      </button>
    );
  }

  if (question.answerKind === "boolean") {
    return (
      <div className="flex gap-2">
        {[
          [t("guided.yes", "YES"), true],
          [t("guided.no", "NO"), false],
        ].map(([label, answer]) => (
          <button
            key={String(answer)}
            type="button"
            disabled={locked}
            onClick={() => onAnswer(answer)}
            className="rounded border border-glass-border px-3 py-2 font-cakemono text-cake-button uppercase text-text transition-colors hover:border-ops-accent hover:text-ops-accent disabled:pointer-events-none disabled:opacity-40"
          >
            {String(label)}
          </button>
        ))}
      </div>
    );
  }

  if (
    question.answerKind === "single_choice" &&
    question.options?.length
  ) {
    return (
      <div className="grid gap-2">
        {question.options.map((option) => (
          <button
            key={option}
            type="button"
            disabled={locked}
            onClick={() => onAnswer(option)}
            className="flex min-h-11 items-center justify-between rounded border border-glass-border px-3 py-2 text-left font-mohave text-body text-text transition-colors hover:border-ops-accent hover:text-ops-accent disabled:pointer-events-none disabled:opacity-40"
          >
            {option}
            <ArrowRight aria-hidden className="h-4 w-4" />
          </button>
        ))}
      </div>
    );
  }

  if (
    question.answerKind === "multi_choice" &&
    question.options?.length
  ) {
    const submit = () => {
      if (choices.length > 0) onAnswer(choices);
    };
    return (
      <div>
        <div className="grid gap-2">
          {question.options.map((option) => {
            const selected = choices.includes(option);
            return (
              <button
                key={option}
                type="button"
                disabled={locked}
                aria-pressed={selected}
                onClick={() =>
                  setChoices((current) =>
                    selected
                      ? current.filter((entry) => entry !== option)
                      : [...current, option],
                  )
                }
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded border px-3 py-2 text-left font-mohave text-body transition-colors disabled:pointer-events-none disabled:opacity-40",
                  selected
                    ? "border-ops-accent text-ops-accent"
                    : "border-glass-border text-text hover:border-ops-accent",
                )}
              >
                <span
                  className={cn(
                    "grid h-4 w-4 place-items-center rounded-sm border",
                    selected
                      ? "border-ops-accent bg-ops-accent text-black"
                      : "border-glass-border",
                  )}
                >
                  {selected ? <Check aria-hidden className="h-3 w-3" /> : null}
                </span>
                {option}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          disabled={locked || choices.length === 0}
          onClick={submit}
          className="mt-4 rounded border border-ops-accent px-3 py-2 font-cakemono text-cake-button uppercase text-ops-accent transition-colors hover:bg-ops-accent hover:text-black disabled:pointer-events-none disabled:border-glass-border disabled:text-text-mute"
        >
          {t("guided.continue", "CONTINUE")}
        </button>
      </div>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const clean = value.trim();
    if (!clean) return;
    setValue("");
    onAnswer(
      question.answerKind === "number" ? Number(clean) : clean,
    );
  };
  return (
    <form
      onSubmit={submit}
      className={cn(question.answerKind === "text" && "relative")}
    >
      {question.answerKind === "text" ? (
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
          rows={2}
          className="min-h-16 max-h-32 resize-none overflow-y-auto py-1 pl-1.5 pr-32"
          placeholder={t(
            "guided.answerPlaceholder",
            "Type your answer",
          )}
        />
      ) : (
        <Input
          autoFocus
          type={question.answerKind === "number" ? "number" : "text"}
          value={value}
          disabled={locked}
          onChange={(event) => setValue(event.target.value)}
          className="min-h-11 px-1 font-mono text-data-sm"
          placeholder={t(
            "guided.answerPlaceholder",
            "Type your answer",
          )}
        />
      )}
      <button
        type="submit"
        disabled={locked || !value.trim()}
        className={cn(
          "min-h-9 rounded border border-ops-accent px-3 font-cakemono text-cake-button uppercase text-ops-accent transition-colors hover:bg-ops-accent hover:text-black disabled:pointer-events-none disabled:border-glass-border disabled:text-text-mute",
          question.answerKind === "text"
            ? "absolute bottom-1 right-1"
            : "mt-3",
        )}
      >
        {t("guided.continue", "CONTINUE")}
      </button>
    </form>
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
      const messages: Record<
        GuidedCatalogSourceDocumentError["code"],
        string
      > = {
        unsupported_type: t(
          "guided.sourceInvalid",
          "Use a CSV or Excel price sheet.",
        ),
        too_large: t(
          "guided.sourceTooLarge",
          "Keep the price sheet under 5 MB.",
        ),
        empty: t(
          "guided.sourceEmpty",
          "The price sheet has no rows.",
        ),
        invalid_headers: t(
          "guided.sourceHeaders",
          "Every price-sheet column needs a unique heading.",
        ),
        too_many_rows: t(
          "guided.sourceRows",
          "Split the price sheet into files with 250 rows or fewer.",
        ),
        too_many_columns: t(
          "guided.sourceColumns",
          "Keep the price sheet to 50 columns or fewer.",
        ),
        cell_too_large: t(
          "guided.sourceCell",
          "One cell is too long. Shorten long notes and try again.",
        ),
        answer_too_large: t(
          "guided.sourcePayload",
          "Split the price sheet into smaller files and try again.",
        ),
        read_failed: t(
          "guided.sourceReadError",
          "The price sheet could not be read.",
        ),
      };
      return messages[error.code];
    },
    [t],
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
            : t(
                "guided.sourceReadError",
                "The price sheet could not be read.",
              ),
        );
      } finally {
        setReading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [errorMessage, locked, onAnswer, reading, t],
  );

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
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
        className="inline-flex min-h-9 items-center gap-2 rounded border border-glass-border px-3 font-cakemono text-cake-button uppercase text-text-2 transition-colors hover:border-line-hi hover:text-text disabled:pointer-events-none disabled:opacity-40"
      >
        {reading ? (
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
        ) : (
          <FileSpreadsheet aria-hidden className="h-4 w-4" />
        )}
        {reading
          ? t("guided.sourceReading", "READING PRICE SHEET")
          : t("guided.sourceUpload", "UPLOAD PRICE SHEET")}
      </button>
      <span className="font-mono text-micro text-text-mute">
        {t("guided.sourceHint", "[ optional · CSV or Excel · up to 5 MB ]")}
      </span>
      {uploadError ? (
        <p className="w-full font-mono text-micro text-danger" role="alert">
          {uploadError}
        </p>
      ) : null}
    </div>
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
  const [error, setError] = useState<string | null>(null);
  const [pendingTurn, setPendingTurn] =
    useState<PendingGuidedTurn | null>(null);
  const [commitResult, setCommitResult] =
    useState<GuidedCommitResponse | null>(null);
  const startRef = useRef(false);
  const initialTurnRef = useRef(false);
  const turnInFlightRef = useRef(false);
  const transcriptRef = useRef<HTMLOListElement>(null);
  const reduceMotion = useReducedMotion();

  const runTurn = useCallback(
    async (
      answer: unknown,
      current: GuidedSession,
      retryPending = false,
    ) => {
      if (turnInFlightRef.current) return;
      turnInFlightRef.current = true;
      if (!retryPending) {
        const message = guidedOperatorMessageForAnswer(
          answer,
          current.unresolvedQuestions[0] ?? null,
          current.version + 1,
        );
        setPendingTurn(
          message
            ? {
                answer,
                message,
              }
            : null,
        );
      }
      setBusy(true);
      setError(null);
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
                  "Your session has expired. Sign in again.",
                ),
              ),
              answer,
              expectedVersion: current.version,
            }),
          },
        );
        const result = await jsonResponse<{ session: unknown }>(response);
        setSession(normalizeSession(result.session));
        setPendingTurn(null);
      } catch (turnError) {
        setError(
          turnError instanceof Error
            ? turnError.message
            : t("guided.error", "Setup could not continue"),
        );
      } finally {
        turnInFlightRef.current = false;
        setBusy(false);
      }
    },
    [t],
  );

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript || transcript.scrollHeight <= transcript.clientHeight) {
      return;
    }
    transcript.scrollTo({
      top: transcript.scrollHeight,
      behavior: "auto",
    });
  }, [
    busy,
    error,
    pendingTurn,
    reduceMotion,
    session?.conversation.length,
  ]);

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
                "Your session has expired. Sign in again.",
              ),
            ),
          }),
        });
        const result = await jsonResponse<{
          session: unknown | null;
          agentAvailable: boolean;
        }>(response);
        setAgentAvailable(result.agentAvailable);
        setSession(
          result.agentAvailable && result.session
            ? normalizeSession(result.session)
            : null,
        );
        setBusy(false);
      } catch (startError) {
        setError(
          startError instanceof Error
            ? startError.message
            : t("guided.error", "Setup could not start"),
        );
        setBusy(false);
      }
    })();
  }, [t]);

  useEffect(() => {
    if (
      !session ||
      !agentAvailable ||
      busy ||
      initialTurnRef.current ||
      session.status !== "interviewing" ||
      session.unresolvedQuestions.length > 0
    ) {
      return;
    }
    initialTurnRef.current = true;
    void runTurn(
      {
        intent: "start_guided_catalog_setup",
        instruction: "Begin with the single highest-value unanswered question.",
      },
      session,
    );
  }, [agentAvailable, busy, runTurn, session]);

  const products = useMemo(
    () => planActions(session?.proposedPlan ?? null, "upsert_product"),
    [session?.proposedPlan],
  );
  const familyCount = useMemo(
    () =>
      planActions(
        session?.proposedPlan ?? null,
        "upsert_catalog_family",
      ).length,
    [session?.proposedPlan],
  );
  const materialRuleCount = useMemo(
    () =>
      planActions(
        session?.proposedPlan ?? null,
        "upsert_material_quantity_rule",
      ).length,
    [session?.proposedPlan],
  );
  const taskCount = useMemo(
    () =>
      (session?.proposedPlan?.actions ?? []).filter((action) =>
        ["reuse_task_type", "create_task_type"].includes(
          action.actionType,
        ),
      ).length,
    [session?.proposedPlan],
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
                "Your session has expired. Sign in again.",
              ),
            ),
            approvalHash: session.proposedPlanHash,
          }),
        },
      );
      const result = (await response.json().catch(() => null)) as
        | (GuidedCommitResponse & { error?: string })
        | null;
      const recoverableAttention =
        response.status === 422 && result?.status === "attention";
      if ((!response.ok && !recoverableAttention) || !result) {
        throw new Error(
          result?.error ??
            t("guided.commitError", "Catalog could not be built"),
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
          : current,
      );
    } catch (commitError) {
      setError(
        commitError instanceof Error
          ? commitError.message
          : t("guided.commitError", "Catalog could not be built"),
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
        t(
          "guided.sessionExpired",
          "Your session has expired. Sign in again.",
        ),
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
        },
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
      setPendingTurn(null);
      initialTurnRef.current = false;
      setSession(
        result.agentAvailable && result.session
          ? normalizeSession(result.session)
          : null,
      );
    } catch (restartError) {
      setError(
        restartError instanceof Error
          ? restartError.message
          : t("guided.restartError", "Setup could not restart"),
      );
    } finally {
      setBusy(false);
    }
  }, [busy, session, t]);

  if (busy && !session) {
    return (
      <div
        data-testid="guided-catalog-loading"
        className={cn(
          "grid min-h-96 place-items-center bg-background",
          className,
        )}
      >
        <div className="flex items-center gap-2 font-mono text-micro uppercase tracking-wide text-text-3">
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          {t("guided.loading", "READING YOUR CATALOG")}
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
          className,
        )}
      >
        <span className="font-mono text-micro uppercase tracking-wide text-text-3">
          {"// "}
          {t("guided.kicker", "GUIDED CATALOG SETUP")}
        </span>
        <h1 className="mt-3 font-cakemono text-cake-title font-light uppercase text-text">
          {t("guided.unavailableTitle", "GUIDED SETUP IS OFFLINE")}
        </h1>
        <p className="mt-3 max-w-prose font-mohave text-body text-text-2">
          {error ??
            t(
              "guided.unavailableBody",
              "Use another setup method. Nothing has been changed.",
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
        fact.value.trim(),
    )?.value as string | undefined;
    return (
      <section
        data-testid="guided-catalog-complete"
        className={cn(
          "mx-auto flex min-h-96 max-w-3xl flex-col justify-center px-5",
          className,
        )}
      >
        <span className="font-mono text-micro uppercase tracking-wide text-success">
          {"// "}
          {t("guided.completeKicker", "CATALOG VERIFIED")}
        </span>
        <h1 className="mt-3 font-cakemono text-cake-title font-light uppercase text-text">
          {t("guided.completeTitle", "YOUR CATALOG IS READY")}
        </h1>
        <p className="mt-3 max-w-prose font-mohave text-body text-text-2">
          {t(
            "guided.inventoryQuestion",
            "Do you have a current inventory list you want me to add?",
          )}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() =>
              onAddInventoryList(session.id, defaultLocation)
            }
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
          className,
        )}
      >
        <span className="font-mono text-micro uppercase tracking-wide text-warning">
          {"// "}
          {t("guided.attentionKicker", "ONE CHECK REMAINS")}
        </span>
        <h1 className="mt-3 font-cakemono text-cake-title font-light uppercase text-text">
          {t("guided.attentionTitle", "MOST OF YOUR CATALOG IS READY")}
        </h1>
        <p className="mt-3 max-w-prose font-mohave text-body text-text-2">
          {t(
            "guided.attentionBody",
            "A live record is still connected to an old catalog item, so setup left it untouched. Your saved work is safe.",
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
        className={cn(
          "mx-auto w-full max-w-5xl px-4 py-5 md:px-6",
          className,
        )}
      >
        <header className="border-b border-glass-border pb-4">
          <span className="font-mono text-micro uppercase tracking-wide text-text-3">
            {"// "}
            {t("guided.reviewKicker", "READY FOR REVIEW")}
          </span>
          <h1 className="mt-2 font-cakemono text-cake-title font-light uppercase text-text">
            {t("guided.reviewTitle", "HERE'S WHAT WILL BE BUILT")}
          </h1>
          <p className="mt-2 max-w-prose font-mohave text-body text-text-2">
            {t(
              "guided.reviewBody",
              "I checked this against your live catalog. Existing records are reused; only the approved changes go live.",
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
            <article
              key={product.actionKey}
              className="glass-surface p-4"
            >
              <div className="font-cakemono text-cake-button uppercase text-text">
                {String(product.payload.name ?? "—")}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 font-mono text-micro text-text-3">
                <span>
                  {t("guided.price", "PRICE")}{" "}
                  <strong className="font-normal text-text">
                    ${Number(product.payload.basePrice ?? 0).toFixed(2)}/
                    {String(
                      product.payload.pricingUnit ??
                        t("guided.unit", "unit"),
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
          <p className="mt-4 font-mono text-micro text-danger">{error}</p>
        ) : null}

        <footer className="mt-6 flex flex-wrap items-center gap-4 border-t border-glass-border pt-4">
          <button
            type="button"
            disabled={busy || !session.proposedPlanHash}
            onClick={() => void commit()}
            className="inline-flex min-h-11 items-center gap-2 rounded border border-ops-accent px-4 font-cakemono text-cake-button uppercase text-ops-accent transition-colors hover:bg-ops-accent hover:text-black disabled:border-glass-border disabled:text-text-mute"
          >
            {busy ? (
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
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
  const conversation =
    pendingTurn &&
    !session.conversation.some(
      (message) => message.id === pendingTurn.message.id,
    )
      ? [...session.conversation, pendingTurn.message]
      : session.conversation;
  const turnLocked = busy || pendingTurn !== null;
  return (
    <section
      data-testid="guided-catalog-interview"
      className={cn(
        "mx-auto flex h-full min-h-0 w-full max-w-4xl flex-col overflow-hidden px-4 py-3 md:px-6",
        className,
      )}
    >
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-glass-border pb-3">
        <div>
          <span className="font-mono text-micro uppercase tracking-wide text-text-3">
            {"// "}
            {t("guided.kicker", "GUIDED CATALOG SETUP")}
          </span>
          <h1 className="mt-1 font-cakemono text-cake-section font-light uppercase text-text">
            {t("guided.conversationTitle", "BUILD YOUR CATALOG")}
          </h1>
        </div>
        <div className="font-mono text-micro text-text-mute">
          {t("guided.factCount", "Confirmed decisions · {count}").replace(
            "{count}",
            String(confirmedDecisionCount(session.facts)),
          )}
        </div>
      </header>

      <ol
        ref={transcriptRef}
        role="log"
        aria-live="polite"
        aria-label={t(
          "guided.transcriptLabel",
          "Catalog setup conversation",
        )}
        className="scrollbar-hide min-h-0 flex-1 space-y-5 overflow-y-auto py-3"
      >
        <AnimatePresence initial={false}>
          {conversation.map((message) => {
            const assistant = message.role === "assistant";
            const currentHelp =
              assistant &&
              question?.help &&
              message.id ===
                `assistant:${session.version}:${question.id}`
                ? question.help
                : null;
            return (
              <motion.li
                key={message.id}
                variants={
                  reduceMotion
                    ? cardEnterVariantsReduced
                    : cardEnterVariants
                }
                initial="hidden"
                animate="visible"
                exit="exit"
                className={cn(
                  "w-fit max-w-2xl font-mohave text-body",
                  assistant
                    ? "mr-auto border-l border-agent-border bg-agent-bg px-4 py-3 text-text"
                    : "ml-auto rounded border border-glass-border bg-surface-input px-4 py-3 text-text",
                )}
                data-message-role={message.role}
              >
                <div
                  className={cn(
                    "mb-1 font-mono text-micro uppercase tracking-wide",
                    assistant ? "text-agent-text2" : "text-text-mute",
                  )}
                >
                  {assistant
                    ? t("guided.agentLabel", "PHASE C")
                    : t("guided.operatorLabel", "YOU")}
                </div>
                {message.kind === "source_document" ? (
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet
                      aria-hidden
                      className="h-4 w-4 shrink-0 text-text-3"
                    />
                    <span>
                      {t(
                        "guided.sourceMessage",
                        "Uploaded {filename}",
                      ).replace("{filename}", message.content)}
                    </span>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap">{message.content}</p>
                )}
                {currentHelp ? (
                  <p className="mt-2 text-body-sm text-text-2">
                    {currentHelp}
                  </p>
                ) : null}
              </motion.li>
            );
          })}
        </AnimatePresence>

        {busy ? (
          <li
            role="status"
            aria-label={t(
              "guided.workingStatus",
              "Phase C is working",
            )}
            className="mr-auto flex w-fit items-center gap-2 border-l border-agent-border bg-agent-bg px-4 py-3 font-mohave text-body-sm text-text-2"
          >
            <Loader2
              aria-hidden
              className="h-4 w-4 animate-spin text-agent-text2"
            />
            {t(
              "guided.workingBody",
              "Phase C is checking your answer…",
            )}
          </li>
        ) : null}

        {error ? (
          <li
            role="alert"
            className="ml-auto max-w-2xl rounded border border-rose-line bg-rose-soft px-4 py-3"
          >
            <p className="font-mohave text-body-sm text-rose">{error}</p>
            {pendingTurn ? (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void runTurn(pendingTurn.answer, session, true)
                }
                className="mt-2 font-mono text-micro text-text-2 transition-colors hover:text-text disabled:pointer-events-none disabled:opacity-40"
              >
                {t("guided.retry", "[ try again ]")}
              </button>
            ) : null}
          </li>
        ) : null}
      </ol>

      <div className="border-t border-glass-border pt-2">
        <div className="glass-surface p-2">
          {question ? (
            <>
              <QuestionInput
                key={question.id}
                question={question}
                busy={busy}
                locked={turnLocked}
                onAnswer={(answer) => void runTurn(answer, session)}
              />
              <SourceDocumentInput
                locked={turnLocked}
                onAnswer={(answer) => void runTurn(answer, session)}
              />
            </>
          ) : (
            <div className="flex items-center gap-2 font-mohave text-body-sm text-text-2">
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
              {t("guided.preparing", "Preparing the next question")}
            </div>
          )}
        </div>
      </div>

      <footer className="mt-2 flex flex-wrap gap-2">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              type="button"
              disabled={busy}
              className="font-mono text-micro text-text-3 transition-colors hover:text-text disabled:pointer-events-none disabled:opacity-40"
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
                  "This clears this setup conversation and starts again. Your live catalog stays untouched.",
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

export default GuidedCatalogSetup;
