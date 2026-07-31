import { GuidedConversationSchema } from "./schemas";
import type {
  GuidedConversationMessage,
  GuidedQuestion,
} from "./types";

const MAX_CONVERSATION_MESSAGES = 200;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function assistantMessage(
  question: GuidedQuestion,
  version: number,
): GuidedConversationMessage {
  return {
    id: `assistant:${version}:${question.id}`,
    role: "assistant",
    kind: "text",
    content: question.prompt,
    version,
  };
}

export function guidedOperatorMessageForAnswer(
  answer: unknown,
  currentQuestion: GuidedQuestion | null,
  nextVersion: number,
): GuidedConversationMessage | null {
  const answerRecord = record(answer);
  if (
    !currentQuestion &&
    typeof answerRecord.intent === "string"
  ) {
    return null;
  }

  const questionId = currentQuestion?.id ?? "turn";
  if (answerRecord.kind === "catalog_source_document") {
    const filename =
      typeof answerRecord.filename === "string" &&
      answerRecord.filename.trim()
        ? answerRecord.filename.trim()
        : "Price sheet";
    return {
      id: `operator:${nextVersion}:${questionId}`,
      role: "operator",
      kind: "source_document",
      content: filename,
      filename,
      version: nextVersion,
    };
  }

  let content: string;
  if (typeof answer === "boolean") {
    content = answer ? "Yes" : "No";
  } else if (Array.isArray(answer)) {
    content = answer.map(String).join(", ");
  } else if (typeof answer === "string" || typeof answer === "number") {
    content = String(answer).trim();
  } else {
    content = "Answer provided";
  }

  return {
    id: `operator:${nextVersion}:${questionId}`,
    role: "operator",
    kind: "text",
    content: content || "Answer provided",
    version: nextVersion,
  };
}

export function normalizeGuidedConversation(
  value: unknown,
  unresolvedQuestions: GuidedQuestion[],
  version: number,
): GuidedConversationMessage[] {
  const parsed = GuidedConversationSchema.safeParse(value);
  const conversation = parsed.success ? [...parsed.data] : [];
  const currentQuestion = unresolvedQuestions[0];
  const currentMessage = currentQuestion
    ? assistantMessage(currentQuestion, version)
    : null;
  if (
    currentMessage &&
    !conversation.some(
      (message) => message.id === currentMessage.id,
    )
  ) {
    conversation.push(currentMessage);
  }
  return conversation.slice(-MAX_CONVERSATION_MESSAGES);
}

export function visibleGuidedConversation(
  value: unknown,
): GuidedConversationMessage[] {
  const parsed = GuidedConversationSchema.safeParse(value);
  if (!parsed.success) return [];
  return parsed.data.filter(
    (message) =>
      message.state !== "superseded" &&
      message.state !== "removed",
  );
}

export function acceptGuidedConversationInputs({
  conversation,
  acceptedInputIds,
  nextQuestion,
  nextVersion,
}: {
  conversation: unknown;
  acceptedInputIds: string[];
  nextQuestion: GuidedQuestion | null;
  nextVersion: number;
}): GuidedConversationMessage[] {
  const parsed = GuidedConversationSchema.safeParse(conversation);
  const accepted = new Set(acceptedInputIds);
  const next = (parsed.success ? parsed.data : []).map((message) =>
    message.inputId && accepted.has(message.inputId)
      ? { ...message, state: "accepted" as const }
      : message,
  );
  if (
    nextQuestion &&
    !next.some(
      (message) =>
        message.id ===
        `assistant:${nextVersion}:${nextQuestion.id}`,
    )
  ) {
    next.push(assistantMessage(nextQuestion, nextVersion));
  }
  return next.slice(-MAX_CONVERSATION_MESSAGES);
}

export function advanceGuidedConversation({
  conversation,
  currentQuestion,
  answer,
  nextQuestion,
  nextVersion,
}: {
  conversation: unknown;
  currentQuestion: GuidedQuestion | null;
  answer: unknown;
  nextQuestion: GuidedQuestion | null;
  nextVersion: number;
}): GuidedConversationMessage[] {
  const normalized = normalizeGuidedConversation(
    conversation,
    currentQuestion ? [currentQuestion] : [],
    Math.max(0, nextVersion - 1),
  );
  const operatorMessage = guidedOperatorMessageForAnswer(
    answer,
    currentQuestion,
    nextVersion,
  );
  if (
    operatorMessage &&
    !normalized.some((message) => message.id === operatorMessage.id)
  ) {
    normalized.push(operatorMessage);
  }
  if (
    nextQuestion &&
    !normalized.some(
      (message) =>
        message.id ===
        `assistant:${nextVersion}:${nextQuestion.id}`,
    )
  ) {
    normalized.push(assistantMessage(nextQuestion, nextVersion));
  }
  return normalized.slice(-MAX_CONVERSATION_MESSAGES);
}
