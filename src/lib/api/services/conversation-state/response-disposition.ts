import type {
  AcceptSignal,
  CleanMessage,
  ResponseDisposition,
  ResponseMode,
} from "./types";

export interface ResponseDispositionInput {
  messages: CleanMessage[];
  accept: AcceptSignal;
}

export interface ResponseDispositionDecision {
  disposition: ResponseDisposition;
  mode: ResponseMode;
  reason: string;
}

const QUESTION_OR_REQUEST_RE =
  /\?|^(?:who|what|when|where|why|how|can|could|would|will|do|does|did|is|are|should)\b|\b(?:please|let me know|can you|could you|would you|need you to|send|share|provide|confirm|call me|quote|estimate)\b/i;

const SCHEDULE_RE =
  /\b(?:available|availability|schedule|book(?:ing)?|what time|which day|when can|come by|come out|fit (?:me|us) in|appointment)\b|\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week|january|february|march|april|may|june|july|august|september|october|november|december)\b/i;

const COMPLETION_UPDATE_RE =
  /\b(?:return|form|paperwork|document|deposit|payment|transfer)\b.{0,50}\b(?:submitted|sent|completed|done|paid)\b|\b(?:submitted|sent|completed|done|paid)\b.{0,50}\b(?:return|form|paperwork|document|deposit|payment|transfer)\b/i;

const CLOSED_LOOP_RE =
  /^(?:ok(?:ay)?(?: thanks?)?|thanks?(?: you)?(?: so much| again)?|thank you(?: so much| again)?|i appreciate it|appreciate it|got it(?: thanks?)?|perfect(?: thanks?)?|you(?:'|’)re welcome|sounds good(?: thanks?)?|all sounds great(?: have a good day)?|have a good(?: day| one| weekend)|you too)$/i;

function latestCustomerMessage(messages: CleanMessage[]): CleanMessage | null {
  return (
    [...messages]
      .filter((message) => message.isRealCustomerInbound)
      .sort((left, right) => left.sentAt.localeCompare(right.sentAt))
      .pop() ?? null
  );
}

function normalizedSentence(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.!?,;:—–-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function decideResponseDisposition(
  input: ResponseDispositionInput
): ResponseDispositionDecision {
  const latest = latestCustomerMessage(input.messages);
  if (!latest) {
    return {
      disposition: "no_reply_required",
      mode: "no_reply",
      reason: "No real customer inbound is awaiting a response.",
    };
  }

  const body = latest.cleanBody.trim();
  const asksForAction = QUESTION_OR_REQUEST_RE.test(body);

  if (SCHEDULE_RE.test(body) && asksForAction) {
    return {
      disposition: "operator_input_required",
      mode: "schedule",
      reason:
        "The customer asked about scheduling or availability, which requires verified calendar context.",
    };
  }

  if (input.accept.detected && input.accept.confidence === "high") {
    return {
      disposition: "reply_required",
      mode: "close_loop",
      reason: "A confirmed customer acceptance requires the next step.",
    };
  }

  if (asksForAction) {
    return {
      disposition: "reply_required",
      mode: "answer",
      reason: "The latest customer message asks a question or requests action.",
    };
  }

  const normalized = normalizedSentence(body);
  if (CLOSED_LOOP_RE.test(normalized) || COMPLETION_UPDATE_RE.test(body)) {
    return {
      disposition: "no_reply_required",
      mode: "no_reply",
      reason:
        "The latest customer message is an acknowledgement, sign-off, or completion update with no request.",
    };
  }

  const hasNewAttachment = latest.attachments.some(
    (attachment) => attachment.requiresInspection
  );
  return {
    disposition: "reply_required",
    mode: "acknowledge_and_advance",
    reason: hasNewAttachment
      ? "The customer supplied new material that needs acknowledgement and a next step."
      : "The customer supplied actionable new information.",
  };
}
