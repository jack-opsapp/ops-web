import { randomUUID } from "crypto";
import { getAccessTokenClient } from "@/lib/supabase/accessToken-client";
import {
  appendGuidedInput,
  GuidedInputRevisionError,
  normalizeGuidedInputLedger,
  reviseLatestGuidedInput,
} from "./input-ledger";
import {
  normalizeGuidedConversation,
} from "./conversation-history";
import { GuidedQuestionSchema } from "./schemas";
import type {
  GuidedConversationMessage,
  GuidedQuestion,
} from "./types";
import { CATALOG_CAPABILITY_MANIFEST_REVISION } from "./catalog-capability-manifest";

interface QueryError {
  message?: string;
}

interface QueryResult {
  data: unknown;
  error: QueryError | null;
}

interface InputQuery extends PromiseLike<QueryResult> {
  select(columns?: string): InputQuery;
  eq(column: string, value: string | number): InputQuery;
  update(values: Record<string, unknown>): InputQuery;
  maybeSingle(): Promise<QueryResult>;
}

export interface GuidedInputQueryClient {
  from(table: string): InputQuery;
}

export class GuidedSetupInputConflictError extends Error {
  constructor(message = "Guided setup changed in another window") {
    super(message);
    this.name = "GuidedSetupInputConflictError";
  }
}

export class GuidedSetupInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuidedSetupInputError";
  }
}

type InputOperation = "append" | "edit" | "remove";

interface MutateGuidedSetupInputParams {
  token: string;
  companyId: string;
  operatorId: string;
  sessionId: string;
  operation: InputOperation;
  expectedVersion: number;
  expectedInputId?: string;
  answer?: unknown;
  client?: GuidedInputQueryClient;
  createInputId?: () => string;
  now?: () => string;
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, unknown> =>
          !!entry && typeof entry === "object" && !Array.isArray(entry),
      )
    : [];
}

function currentQuestion(
  row: Record<string, unknown>,
): GuidedQuestion | null {
  const parsed = GuidedQuestionSchema.array().safeParse(
    row.unresolved_questions ?? [],
  );
  return parsed.success ? parsed.data[0] ?? null : null;
}

function changeConversationState(
  conversation: GuidedConversationMessage[],
  inputId: string,
  state: "superseded" | "removed",
): GuidedConversationMessage[] {
  return conversation.map((message) =>
    message.inputId === inputId
      ? { ...message, state }
      : message,
  );
}

export async function mutateGuidedSetupInput({
  token,
  companyId,
  operatorId,
  sessionId,
  operation,
  expectedVersion,
  expectedInputId,
  answer,
  client: injectedClient,
  createInputId = randomUUID,
  now = () => new Date().toISOString(),
}: MutateGuidedSetupInputParams) {
  const client =
    injectedClient ??
    (getAccessTokenClient(token) as unknown as GuidedInputQueryClient);
  const loaded = await client
    .from("catalog_guided_setup_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("company_id", companyId)
    .eq("operator_id", operatorId)
    .maybeSingle();
  if (loaded.error) {
    throw new GuidedSetupInputError(
      `Failed to load guided setup: ${loaded.error.message ?? "unknown error"}`,
    );
  }
  if (!loaded.data || typeof loaded.data !== "object") {
    throw new GuidedSetupInputConflictError();
  }

  const current = loaded.data as Record<string, unknown>;
  const version = Number(current.version ?? 0);
  const inputRevision = Number(current.input_revision ?? 0);
  if (
    version !== expectedVersion ||
    !["interviewing", "review"].includes(String(current.status))
  ) {
    throw new GuidedSetupInputConflictError();
  }
  const manifestRevision =
    typeof current.capability_manifest_revision === "string"
      ? current.capability_manifest_revision
      : CATALOG_CAPABILITY_MANIFEST_REVISION;
  if (manifestRevision !== CATALOG_CAPABILITY_MANIFEST_REVISION) {
    throw new GuidedSetupInputConflictError(
      "OPS capabilities changed. Reload Guided Catalog Setup.",
    );
  }

  const question = currentQuestion(current);
  const nextVersion = version + 1;
  const nextInputRevision = inputRevision + 1;
  const timestamp = now();
  const conversation = normalizeGuidedConversation(
    current.conversation,
    question ? [question] : [],
    version,
  );
  let nextLedger = normalizeGuidedInputLedger(current.input_ledger);
  let nextConversation = conversation;
  let input: Record<string, unknown> | null = null;

  try {
    if (operation === "append") {
      if (answer == null) {
        throw new GuidedInputRevisionError(
          "A message requires content",
        );
      }
      const appended = appendGuidedInput({
        ledger: nextLedger,
        answer,
        currentQuestion: question,
        nextInputRevision,
        inputId: createInputId(),
        now: timestamp,
      });
      nextLedger = appended.ledger;
      nextConversation = [
        ...conversation,
        { ...appended.message, version: nextVersion },
      ].slice(-200);
      input = appended.entry as unknown as Record<string, unknown>;
    } else {
      if (!expectedInputId) {
        throw new GuidedInputRevisionError(
          "The queued message is missing",
        );
      }
      const revised = reviseLatestGuidedInput({
        ledger: nextLedger,
        operation,
        expectedInputId,
        answer,
        nextInputRevision,
        replacementInputId:
          operation === "edit" ? createInputId() : undefined,
        now: timestamp,
      });
      nextLedger = revised.ledger;
      nextConversation = changeConversationState(
        conversation,
        expectedInputId,
        operation === "edit" ? "superseded" : "removed",
      );
      if (revised.replacement && revised.replacementMessage) {
        nextConversation = [
          ...nextConversation,
          {
            ...revised.replacementMessage,
            version: nextVersion,
          },
        ].slice(-200);
        input =
          revised.replacement as unknown as Record<string, unknown>;
      }
    }
  } catch (error) {
    if (error instanceof GuidedInputRevisionError) {
      throw new GuidedSetupInputConflictError(error.message);
    }
    throw error;
  }

  const updated = await client
    .from("catalog_guided_setup_sessions")
    .update({
      status: "interviewing",
      version: nextVersion,
      input_revision: nextInputRevision,
      input_ledger: nextLedger,
      conversation: nextConversation,
      proposed_plan: null,
      proposed_plan_hash: null,
      validation_issues: [],
      approval_hash: null,
      approved_at: null,
      sources: [
        ...records(current.sources),
        {
          kind: "operator_input",
          action: operation,
          inputId: input?.id ?? expectedInputId ?? null,
          revision: nextInputRevision,
          version: nextVersion,
        },
      ],
      updated_at: timestamp,
    })
    .eq("id", sessionId)
    .eq("company_id", companyId)
    .eq("operator_id", operatorId)
    .eq("version", version)
    .eq("input_revision", inputRevision)
    .eq(
      "capability_manifest_revision",
      CATALOG_CAPABILITY_MANIFEST_REVISION,
    )
    .select("*")
    .maybeSingle();
  if (updated.error) {
    throw new GuidedSetupInputError(
      `Failed to save guided setup input: ${updated.error.message ?? "unknown error"}`,
    );
  }
  if (!updated.data || typeof updated.data !== "object") {
    throw new GuidedSetupInputConflictError();
  }
  return {
    session: updated.data,
    input,
  };
}
