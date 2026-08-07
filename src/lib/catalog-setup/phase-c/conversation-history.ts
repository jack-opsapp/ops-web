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

function assistantQuestionIdentity(
  message: GuidedConversationMessage,
): string | null {
  if (message.role !== "assistant") return null;
  const match = /^assistant:\d+:(.+)$/.exec(message.id);
  return match ? `${match[1]}\u0000${message.content}` : null;
}

export function isGuidedAssistantQuestion(
  message: GuidedConversationMessage,
  question: GuidedQuestion,
): boolean {
  return (
    assistantQuestionIdentity(message) ===
    assistantQuestionIdentity(assistantMessage(question, 0))
  );
}

function deduplicateAssistantQuestions(
  conversation: GuidedConversationMessage[],
): GuidedConversationMessage[] {
  const seen = new Set<string>();
  return conversation.filter((message) => {
    const identity = assistantQuestionIdentity(message);
    if (!identity) return true;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function containsAssistantQuestion(
  conversation: GuidedConversationMessage[],
  question: GuidedQuestion,
): boolean {
  return conversation.some((message) =>
    isGuidedAssistantQuestion(message, question),
  );
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
  const conversation = deduplicateAssistantQuestions(
    parsed.success ? [...parsed.data] : [],
  );
  const currentQuestion = unresolvedQuestions[0];
  const currentMessage = currentQuestion
    ? assistantMessage(currentQuestion, version)
    : null;
  if (
    currentMessage &&
    !containsAssistantQuestion(conversation, currentQuestion)
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
  return deduplicateAssistantQuestions(
    parsed.data.filter(
      (message) =>
        message.state !== "superseded" &&
        message.state !== "removed",
    ),
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
  const next = deduplicateAssistantQuestions(
    parsed.success ? parsed.data : [],
  ).map((message) =>
    message.inputId && accepted.has(message.inputId)
      ? { ...message, state: "accepted" as const }
      : message,
  );
  if (
    nextQuestion &&
    !containsAssistantQuestion(next, nextQuestion)
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
    !containsAssistantQuestion(normalized, nextQuestion)
  ) {
    normalized.push(assistantMessage(nextQuestion, nextVersion));
  }
  return normalized.slice(-MAX_CONVERSATION_MESSAGES);
}
