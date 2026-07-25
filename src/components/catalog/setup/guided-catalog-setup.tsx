"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import type {
  CatalogAction,
  CatalogBlueprint,
  GuidedQuestion,
} from "@/lib/catalog-setup/phase-c/types";

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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function array<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeSession(value: unknown): GuidedSession {
  const row = record(value);
  return {
    id: String(row.id ?? ""),
    status: String(row.status ?? "interviewing") as GuidedStatus,
    version: Number(row.version ?? 0),
    facts: array<Record<string, unknown>>(row.facts),
    unresolvedQuestions: array<GuidedQuestion>(
      row.unresolvedQuestions ?? row.unresolved_questions,
    ),
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
  onAnswer,
}: {
  question: GuidedQuestion;
  busy: boolean;
  onAnswer: (answer: unknown) => void;
}) {
  const { t } = useDictionary("catalog-setup");
  const [value, setValue] = useState("");
  const [choices, setChoices] = useState<string[]>([]);

  useEffect(() => {
    setValue("");
    setChoices([]);
  }, [question.id]);

  if (question.answerKind === "boolean") {
    return (
      <div className="mt-5 flex gap-2">
        {[
          [t("guided.yes", "YES"), true],
          [t("guided.no", "NO"), false],
        ].map(([label, answer]) => (
          <button
            key={String(answer)}
            type="button"
            disabled={busy}
            onClick={() => onAnswer(answer)}
            className="rounded border border-glass-border px-3 py-2 font-cakemono text-cake-button uppercase text-text transition-colors hover:border-ops-accent hover:text-ops-accent disabled:opacity-40"
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
      <div className="mt-5 grid gap-2">
        {question.options.map((option) => (
          <button
            key={option}
            type="button"
            disabled={busy}
            onClick={() => onAnswer(option)}
            className="flex min-h-11 items-center justify-between rounded border border-glass-border px-3 py-2 text-left font-mohave text-body text-text transition-colors hover:border-ops-accent hover:text-ops-accent disabled:opacity-40"
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
      <div className="mt-5">
        <div className="grid gap-2">
          {question.options.map((option) => {
            const selected = choices.includes(option);
            return (
              <button
                key={option}
                type="button"
                disabled={busy}
                aria-pressed={selected}
                onClick={() =>
                  setChoices((current) =>
                    selected
                      ? current.filter((entry) => entry !== option)
                      : [...current, option],
                  )
                }
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded border px-3 py-2 text-left font-mohave text-body transition-colors disabled:opacity-40",
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
          disabled={busy || choices.length === 0}
          onClick={submit}
          className="mt-4 rounded border border-ops-accent px-3 py-2 font-cakemono text-cake-button uppercase text-ops-accent transition-colors hover:bg-ops-accent hover:text-black disabled:border-glass-border disabled:text-text-mute"
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
    onAnswer(
      question.answerKind === "number" ? Number(clean) : clean,
    );
  };
  return (
    <form onSubmit={submit} className="mt-5">
      {question.answerKind === "text" ? (
        <textarea
          autoFocus
          value={value}
          disabled={busy}
          onChange={(event) => setValue(event.target.value)}
          rows={4}
          className="w-full resize-none rounded border border-glass-border bg-glass-fill px-3 py-3 font-mohave text-body text-text outline-none transition-colors placeholder:text-text-mute focus:border-ops-accent disabled:opacity-40"
          placeholder={t(
            "guided.answerPlaceholder",
            "Type your answer",
          )}
        />
      ) : (
        <input
          autoFocus
          type={question.answerKind === "number" ? "number" : "text"}
          value={value}
          disabled={busy}
          onChange={(event) => setValue(event.target.value)}
          className="h-11 w-full rounded border border-glass-border bg-glass-fill px-3 font-mono text-data-sm text-text outline-none transition-colors placeholder:text-text-mute focus:border-ops-accent disabled:opacity-40"
          placeholder={t(
            "guided.answerPlaceholder",
            "Type your answer",
          )}
        />
      )}
      <button
        type="submit"
        disabled={busy || !value.trim()}
        className="mt-3 rounded border border-ops-accent px-3 py-2 font-cakemono text-cake-button uppercase text-ops-accent transition-colors hover:bg-ops-accent hover:text-black disabled:border-glass-border disabled:text-text-mute"
      >
        {t("guided.continue", "CONTINUE")}
      </button>
    </form>
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
  const [commitResult, setCommitResult] =
    useState<GuidedCommitResponse | null>(null);
  const startRef = useRef(false);
  const initialTurnRef = useRef(false);

  const runTurn = useCallback(
    async (answer: unknown, current: GuidedSession) => {
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
      } catch (turnError) {
        setError(
          turnError instanceof Error
            ? turnError.message
            : t("guided.error", "Setup could not continue"),
        );
      } finally {
        setBusy(false);
      }
    },
    [t],
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
  return (
    <section
      data-testid="guided-catalog-interview"
      className={cn(
        "mx-auto flex min-h-96 w-full max-w-3xl flex-col justify-center px-5 py-8",
        className,
      )}
    >
      <span className="font-mono text-micro uppercase tracking-wide text-text-3">
        {"// "}
        {t("guided.kicker", "GUIDED CATALOG SETUP")}
      </span>
      <div className="mt-3 font-mono text-micro text-text-mute">
        {t("guided.factCount", "{count} details confirmed").replace(
          "{count}",
          String(session.facts.length),
        )}
      </div>
      <div className="mt-5 glass-surface p-5">
        <h1 className="font-cakemono text-cake-section font-light uppercase leading-tight text-text">
          {question?.prompt ??
            t(
              "guided.preparing",
              "Preparing the next question",
            )}
        </h1>
        {question?.help ? (
          <p className="mt-3 font-mohave text-body text-text-2">
            {question.help}
          </p>
        ) : null}
        {question ? (
          <QuestionInput
            key={question.id}
            question={question}
            busy={busy}
            onAnswer={(answer) => void runTurn(answer, session)}
          />
        ) : (
          <div className="mt-5 flex items-center gap-2 font-mono text-micro uppercase text-text-3">
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            {t("guided.thinking", "CHECKING WHAT'S ALREADY ON FILE")}
          </div>
        )}
      </div>
      {error ? (
        <div className="mt-4">
          <p className="font-mono text-micro text-danger">{error}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void runTurn(
                { intent: "retry_last_turn" },
                session,
              )
            }
            className="mt-2 font-mono text-micro text-text-3 transition-colors hover:text-text"
          >
            {t("guided.retry", "[ try again ]")}
          </button>
        </div>
      ) : null}
      <div className="mt-6 flex gap-4">
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
      </div>
    </section>
  );
}

export default GuidedCatalogSetup;
