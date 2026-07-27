import {
  GuidedInputLedgerSchema,
} from "./schemas";
import type {
  GuidedConversationMessage,
  GuidedInputLedgerEntry,
  GuidedQuestion,
} from "./types";
import { guidedOperatorMessageForAnswer } from "./conversation-history";

const MAX_INPUT_LEDGER_ENTRIES = 200;

export class GuidedInputRevisionError extends Error {
  constructor(message = "Only the newest queued message can be changed") {
    super(message);
    this.name = "GuidedInputRevisionError";
  }
}

export function normalizeGuidedInputLedger(
  value: unknown,
): GuidedInputLedgerEntry[] {
  const parsed = GuidedInputLedgerSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

function displayMessage(
  answer: unknown,
  currentQuestion: GuidedQuestion | null,
  revision: number,
  inputId: string,
): GuidedConversationMessage {
  const question =
    currentQuestion ??
    ({
      id: "follow-up",
      prompt: "Follow-up",
      answerKind: "text",
      factKeys: ["operator.follow_up"],
    } satisfies GuidedQuestion);
  const message = guidedOperatorMessageForAnswer(
    answer,
    question,
    revision,
  );
  if (!message) {
    throw new GuidedInputRevisionError("The message could not be displayed");
  }
  return {
    ...message,
    id: `operator-input:${inputId}`,
    inputId,
    state: "queued",
  };
}

export function appendGuidedInput({
  ledger,
  answer,
  currentQuestion,
  nextInputRevision,
  inputId,
  now,
}: {
  ledger: unknown;
  answer: unknown;
  currentQuestion: GuidedQuestion | null;
  nextInputRevision: number;
  inputId: string;
  now: string;
}) {
  const normalized = normalizeGuidedInputLedger(ledger);
  const message = displayMessage(
    answer,
    currentQuestion,
    nextInputRevision,
    inputId,
  );
  const entry: GuidedInputLedgerEntry = {
    id: inputId,
    revision: nextInputRevision,
    ...(currentQuestion ? { questionId: currentQuestion.id } : {}),
    answer,
    displayKind: message.kind,
    displayContent: message.content,
    ...(message.filename ? { filename: message.filename } : {}),
    state: "queued",
    createdAt: now,
    updatedAt: now,
  };
  return {
    entry,
    message,
    ledger: [...normalized, entry].slice(-MAX_INPUT_LEDGER_ENTRIES),
  };
}

export function reviseLatestGuidedInput({
  ledger,
  operation,
  expectedInputId,
  answer,
  nextInputRevision,
  replacementInputId,
  now,
}: {
  ledger: unknown;
  operation: "edit" | "remove";
  expectedInputId: string;
  answer?: unknown;
  nextInputRevision: number;
  replacementInputId?: string;
  now: string;
}) {
  const normalized = normalizeGuidedInputLedger(ledger);
  const latestQueued = [...normalized]
    .reverse()
    .find((entry) => entry.state === "queued");
  if (!latestQueued || latestQueued.id !== expectedInputId) {
    throw new GuidedInputRevisionError();
  }

  const changed = normalized.map((entry) =>
    entry.id === latestQueued.id
      ? {
          ...entry,
          state:
            operation === "edit"
              ? ("superseded" as const)
              : ("removed" as const),
          updatedAt: now,
        }
      : entry,
  );

  if (operation === "remove") {
    return {
      ledger: changed,
      replacement: null,
      replacementMessage: null,
    };
  }
  if (!replacementInputId || answer == null) {
    throw new GuidedInputRevisionError(
      "An edited message requires replacement content",
    );
  }
  if (latestQueued.displayKind !== "text") {
    throw new GuidedInputRevisionError(
      "Uploaded files cannot be edited. Remove the upload and send another.",
    );
  }

  const replacementMessage = displayMessage(
    answer,
    latestQueued.questionId
      ? {
          id: latestQueued.questionId,
          prompt: "Follow-up",
          answerKind: "text",
          factKeys: ["operator.follow_up"],
        }
      : null,
    nextInputRevision,
    replacementInputId,
  );
  const replacement: GuidedInputLedgerEntry = {
    id: replacementInputId,
    revision: nextInputRevision,
    ...(latestQueued.questionId
      ? { questionId: latestQueued.questionId }
      : {}),
    answer,
    displayKind: replacementMessage.kind,
    displayContent: replacementMessage.content,
    state: "queued",
    supersedesId: latestQueued.id,
    createdAt: now,
    updatedAt: now,
  };
  replacementMessage.supersedesId = latestQueued.id;

  return {
    ledger: [...changed, replacement].slice(-MAX_INPUT_LEDGER_ENTRIES),
    replacement,
    replacementMessage,
  };
}
