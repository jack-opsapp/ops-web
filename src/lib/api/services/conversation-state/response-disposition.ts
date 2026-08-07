import type {
  AcceptSignal,
  CleanMessage,
  ResponseDisposition,
  ResponseMode,
} from "./types";
import { isMaterialDecisionReversal } from "./accept-detector";

export interface ResponseDispositionInput {
  messages: CleanMessage[];
  accept: AcceptSignal;
}

export interface ResponseDispositionDecision {
  disposition: ResponseDisposition;
  mode: ResponseMode;
  reason: string;
}

const QUESTION_RE =
  /\?|^(?:who|what|when|where|why|how|can|could|would|will|do|does|did|is|are|should)\b|\b(?:can|could|would|will) you\b|\bwould you mind\b/i;

const DIRECT_REQUEST_RE =
  /^(?:please\s+)?(?:send|share|provide|confirm|call|email|text|update|advise|tell|check|review|explain|clarify|include|remove|add|change|revise|forward|reply|respond)\b|^please\s+(?:quote|estimate)\b|^(?:please\s+)?let me know\b|^(?:i|we) need you to\b/i;

const SCHEDULE_CONTEXT_RE =
  /\b(?:available|availability|schedule|reschedule|book(?:ing)?|appointment|site visit|walkthrough|meeting|meet|what time|which day|when can|come by|come out|fit (?:me|us) in)\b/i;

const DECLARATIVE_SCHEDULE_CHANGE_RE =
  /\b(?:move|reschedule|shift|push|change)\b.{0,40}\b(?:to|for|until)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week|january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)\b|\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow)\b.{0,25}\b(?:works?|would work|is (?:good|fine|best)|instead)\b/i;

const SCHEDULE_PROPOSAL_QUESTION_RE =
  /\b(?:can|could|would) (?:we|you) (?:do|meet|come|make)\b.{0,40}\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))\b|\b(?:does|would)\b.{0,30}\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))\b.{0,20}\bwork\b/i;

const COMPLETION_UPDATE_RE =
  /\b(?:return|form|paperwork|document|deposit|payment|transfer)\b.{0,50}\b(?:submitted|sent|completed|done|paid)\b|\b(?:submitted|sent|completed|done|paid)\b.{0,50}\b(?:return|form|paperwork|document|deposit|payment|transfer)\b/i;

const ADMIN_STEP_RE =
  /\b(?:return|form|paperwork|document|deposit|payment|transfer)\b/i;

const NEGATED_COMPLETION_RE =
  /\b(?:not|never)\b(?:\s+[a-z]+){0,4}\s+(?:submitted|sent|completed|done|paid)\b/i;

const CUSTOMER_FUTURE_ACTION_RE =
  /^(?:i|we)(?:['’]ll|\s+(?:will|can|plan to|are going to))\s+(?:send|share|provide|review|check|look over|discuss|call|email|text|follow up|get back to you|let you know)\b/i;

const CLOSED_LOOP_RE =
  /^(?:ok(?:ay)?(?: thanks?)?|thanks?(?: you)?(?: so much| again)?|thank you(?: so much| again)?|i appreciate it|appreciate it|got it(?: thanks?)?|perfect(?: thanks?)?|you(?:'|’)re welcome|sounds good(?: thanks?)?|all sounds great(?: have a good day)?|have a good(?: day| one| weekend)|you too)$/i;

const SPECIFIC_ACKNOWLEDGEMENT_RE =
  /^(?:thanks?(?: you)? for (?:(?:the )?(?:quote|estimate|proposal|invoice|update|information|info|photos?|files?)|(?:coming|stopping) by(?: .{1,40})?)|(?:the )?(?:quote|estimate|proposal|invoice|document|photos?|files?) (?:was |were )?received(?: thanks?)?)$/i;

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

function hasIncompleteAdminStep(body: string): boolean {
  if (!ADMIN_STEP_RE.test(body)) return false;
  const normalized = body
    .toLowerCase()
    .replace(/\b(is|was|were|has|have|had)n['’]?t\b/g, "$1 not")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return NEGATED_COMPLETION_RE.test(normalized);
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
  const asksForAction = QUESTION_RE.test(body) || DIRECT_REQUEST_RE.test(body);

  if (isMaterialDecisionReversal(body)) {
    return {
      disposition: "operator_input_required",
      mode: "clarify",
      reason:
        "Customer changed or paused the decision. Operator review required.",
    };
  }

  if (
    DECLARATIVE_SCHEDULE_CHANGE_RE.test(body) ||
    SCHEDULE_PROPOSAL_QUESTION_RE.test(body) ||
    (SCHEDULE_CONTEXT_RE.test(body) && asksForAction)
  ) {
    return {
      disposition: "operator_input_required",
      mode: "schedule",
      reason: "Schedule timing needs calendar verification before reply.",
    };
  }

  const latestCarriesAccept = input.accept.evidenceMessageIds.includes(
    latest.providerMessageId
  );
  if (
    latestCarriesAccept &&
    input.accept.detected &&
    input.accept.confidence === "high"
  ) {
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

  if (hasIncompleteAdminStep(body)) {
    return {
      disposition: "operator_input_required",
      mode: "clarify",
      reason: "Payment or paperwork is incomplete. Operator review required.",
    };
  }

  const normalized = normalizedSentence(body);
  if (
    CLOSED_LOOP_RE.test(normalized) ||
    SPECIFIC_ACKNOWLEDGEMENT_RE.test(normalized) ||
    CUSTOMER_FUTURE_ACTION_RE.test(body) ||
    COMPLETION_UPDATE_RE.test(body)
  ) {
    return {
      disposition: "no_reply_required",
      mode: "no_reply",
      reason: "Latest message closes the loop. No reply needed.",
    };
  }

  const hasNewAttachment = latest.attachments.some(
    (attachment) => attachment.requiresInspection
  );
  if (hasNewAttachment) {
    return {
      disposition: "reply_required",
      mode: "acknowledge_and_advance",
      reason:
        "Customer sent new material. Acknowledge it and state the next step.",
    };
  }

  return {
    disposition: "operator_input_required",
    mode: "clarify",
    reason: "Message intent is unclear. Operator review required.",
  };
}
