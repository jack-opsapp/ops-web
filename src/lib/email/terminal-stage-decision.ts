import { extractCommercialDealPriceMatches } from "./commercial-price";

export interface TerminalStageMessage {
  direction: "inbound" | "outbound";
  body: string | null | undefined;
}

export interface TerminalStageDetection {
  terminalFlag: "likely_won";
  stage: "won";
}

export type CommercialSignal =
  | "explicit_acceptance"
  | "schedule_confirmed"
  | "deposit_requested"
  | "payment_confirmed"
  | "budget_timing_deferral"
  | "customer_declined";

export interface CommercialOutcomeMessage {
  /** Mailbox-scoped durable key; provider id is the safe fallback in pure use. */
  evidenceKey?: string;
  providerMessageId: string;
  occurredAt: string;
  direction: "inbound" | "outbound";
  authorRole: "customer" | "operator" | "untrusted";
  subject: string;
  body: string;
}

export interface CommercialFacts {
  currentPrice: number | null;
  currentScope: string | null;
  excludedScope: string | null;
  schedule: string | null;
  objection: string | null;
  nextAction: string | null;
}

export type CommercialOutcomeDecision =
  | {
      outcome: "won";
      confidence: "high";
      reasonCode: "customer_committed";
      decisiveEvidenceKey: string;
      decisiveMessageId: string;
      decisiveDirection: "inbound" | "outbound";
      evidenceMessageIds: string[];
      decisiveSignals: CommercialSignal[];
      signals: CommercialSignal[];
      followUpAt: null;
      facts: CommercialFacts;
    }
  | {
      outcome: "deferred";
      confidence: "high";
      reasonCode: "budget_timing";
      decisiveEvidenceKey: string;
      decisiveMessageId: string;
      decisiveDirection: "inbound";
      evidenceMessageIds: string[];
      decisiveSignals: CommercialSignal[];
      signals: CommercialSignal[];
      followUpAt: string;
      facts: CommercialFacts;
    }
  | {
      outcome: "declined";
      confidence: "high";
      reasonCode: "customer_declined";
      decisiveEvidenceKey: string;
      decisiveMessageId: string;
      decisiveDirection: "inbound";
      evidenceMessageIds: string[];
      decisiveSignals: CommercialSignal[];
      signals: CommercialSignal[];
      followUpAt: null;
      facts: CommercialFacts;
    }
  | null;

const ESTIMATE_CONTEXT_RE =
  /\b(?:estimate|quote|proposal|pricing|price|cost|scope of work)\b/i;
const ACCEPTED_DOCUMENT_RE =
  /\b(?:accepted|signed|approved|approval|go-ahead|go ahead)\b.{0,40}\b(?:estimate|quote|proposal|contract)\b|\b(?:estimate|quote|proposal|contract)\b.{0,40}\b(?:accepted|signed|approved)\b/i;
const ACCEPTANCE_RE =
  /\b(?:go ahead|approved|accepted|i accept|we accept|let'?s proceed|proceed|let'?s book|book it|sounds good|sounds great|looks good|works for us|we are good to go)\b/i;
const ESTIMATE_REQUEST_RE =
  /\b(?:send|provide|get|need|waiting for|looking for)\b.{0,30}\b(?:estimate|quote|proposal|pricing|price)\b|\b(?:estimate|quote|proposal|pricing|price)\b.{0,30}\b(?:please|when you can|would like|can you)\b/i;
const CREW_SCHEDULING_RE =
  /\bcrew\b.{0,80}\b(?:arriv(?:e|ing|al)|start(?:ing)?|coming|on site|show(?:ing)? up|scheduled|booked)\b|\b(?:arriv(?:e|ing|al)|start(?:ing)?|coming|on site|show(?:ing)? up|scheduled|booked)\b.{0,80}\bcrew\b/i;
const WORK_START_RE =
  /\b(?:start date|when (?:can|will) you start|see you (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|deposit (?:paid|sent)|payment sent)\b/i;

const COMMERCIAL_ACCEPTANCE_RE =
  /\b(?:we|i)(?:(?:'|’)ve| have)?\s+(?:accept(?:ed)?|approve(?:d)?|would like to proceed|want to proceed|are ready to proceed)\b|\bplease\s+proceed\b|\bgo ahead\b|\btake you up on\b|\bready to move (?:ahead|forward)\b/i;
const GENERIC_ACCEPT_OR_APPROVE_RE =
  /\b(?:we|i)(?:(?:'|’)ve| have)?\s+(?:accept(?:ed)?|approve(?:d)?)\b/i;
const COMMERCIAL_DEAL_CONTEXT_RE =
  /\b(?:estimate|quote|proposal|offer|contract|pricing|price|cost|scope(?: of work)?|work|job|project|install(?:ation|ing)?|remov(?:al|e|ing)|supply|replace|repair|build|construct)\b|\$\s*\d/i;
const STANDALONE_GENERIC_ACCEPTANCE_RE =
  /^\s*(?:we|i)(?:(?:'|’)ve| have)?\s+(?:accept(?:ed)?|approve(?:d)?)[.!]?\s*$/i;
const UNAMBIGUOUS_ACCEPTANCE_ACTION_RE =
  /\b(?:please proceed|ready to proceed|would like to proceed|want to proceed|go ahead|take you up on|ready to move (?:ahead|forward)|book it|let'?s do it)\b/i;
const ADMINISTRATIVE_ACCEPTANCE_OBJECT_RE =
  /\b(?:accept(?:ed|ing)?|approv(?:e|ed|ing))\s+(?:(?:the|an?|your|this|our)\s+)?(?:calendar\s+)?(?:invitation|meeting|appointment|request|access|colou?r(?: selection)?|sample|date|time|payment method)\b/i;
const ADDITIONAL_COMMERCIAL_ACCEPTANCE_RE =
  /\bsounds good\b.{0,30}\b(?:let'?s do it|go ahead|proceed|book it)\b|\b(?:book it|let'?s do it)\b|\b(?:that|the|your)\s+(?:quote|estimate|proposal)\s+(?:works for us|sounds good|looks good)\b/i;
const EXPLICIT_DOCUMENT_ACCEPTANCE_RE =
  /\b(?:accepted|approved)\s+(?:the|your|this)?\s*(?:estimate|quote|proposal|contract)\b|\b(?:estimate|quote|proposal|contract)\s+(?:is|was|has been)\s+(?:accepted|approved)\b/i;
const PREQUOTE_PROCEED_RE =
  /\b(?:proceed|go ahead|move (?:ahead|forward))\b.{0,100}\b(?:with\s+)?(?:(?:get|obtain|receive|prepare|send|provide)(?:ting|ing)?\s+)?(?:a\s+|the\s+|your\s+)?(?:quote|estimate|proposal|pricing)\b/i;
const CONDITIONAL_ACCEPTANCE_RE =
  /\b(?:accept(?:ed|ing)?|approv(?:e|ed|ing)|proceed|go ahead|move (?:ahead|forward)|ready to proceed|book it|let'?s do it|sounds good|sounds great|looks good|works for us)\b.{0,120}\b(?:if|unless|once|when|after|upon|provided(?: that)?|subject to|assuming|pending)\b|\b(?:if|unless|once|when|after|upon|provided(?: that)?|subject to|assuming|pending)\b.{0,120}\b(?:accept(?:ed|ing)?|approv(?:e|ed|ing)|proceed|go ahead|move (?:ahead|forward)|ready to proceed|book it|let'?s do it|sounds good|sounds great|looks good|works for us)\b/i;
const ACCEPTANCE_FOLLOW_UP_SCHEDULING_QUESTION_RE =
  /(?:[,—–-]\s*)?\bwhen\s+(?:can|will|could|would)\s+(?:you|we)\b[^?]*\?/gi;
const COMPLETED_ACCEPTANCE_REVIEW_PREFIX_RE =
  /^\s*after\s+(?:(?:we|i)\s+)?(?:reviewing|reviewed|reading|read|considering|considered|discussing|discussed|looking over|looked over|going over|went over|receiving|received)\b[^,;]{0,100}[,;]\s*/i;
const NEGATED_ACCEPTANCE_RE =
  /\b(?:cannot|can'?t|can not|do not|don'?t|not|never|unable to|hasn'?t|haven'?t|has not|have not)\b.{0,50}\b(?:accept(?:ed|ing)?|approv(?:e|ed|ing)|proceed|go ahead|move (?:ahead|forward)|ready|book(?: it)?|do it)\b|\bno\s+(?:approval|authorization|permission|acceptance|agreement|go[ -]?ahead)\b/i;
const DEPOSIT_REQUEST_RE =
  /\b(?:send|provide|share)\b.{0,80}\b(?:deposit|payment)\b.{0,40}\b(?:instructions?|details?)\b|\b(?:deposit|payment)\s+(?:instructions?|details?)\b|\b(?:where|how|what)\b.{0,50}\b(?:send|pay|make|submit)\b.{0,40}\b(?:the\s+)?(?:deposit|payment)\b|\b(?:where|how|what)\b.{0,50}\b(?:deposit|payment)\b.{0,40}\b(?:send|sent|pay|paid|make|submit)\b/i;
const CONDITIONAL_DEPOSIT_RE =
  /\b(?:deposit|payment)\b.{0,80}\b(?:if|unless|once|when|after|pending|assuming|subject to)\b|\b(?:if|unless|once|when|after|pending|assuming|subject to)\b.{0,80}\b(?:deposit|payment)\b/i;
const NEGATED_DEPOSIT_REQUEST_RE =
  /\b(?:do not|don'?t|no need to|not necessary to)\b.{0,60}\b(?:send|provide|share|pay|make|submit)\b.{0,60}\b(?:deposit|payment|instructions?|details?)\b|\bno\s+(?:deposit|payment)\s+(?:instructions?|details?)\b/i;
const PREQUOTE_DEPOSIT_DETAILS_RE =
  /\b(?:send|provide|prepare|get|need|request)\b.{0,60}\b(?:a\s+|the\s+|your\s+)?(?:quote|estimate|proposal|bid|tender)\b.{0,100}\b(?:deposit|payment)\s+(?:details?|terms?|amount|requirements?|schedule)\b|\b(?:deposit|payment)\s+(?:details?|terms?|amount|requirements?|schedule)\b.{0,100}\b(?:for|with)\b.{0,30}\b(?:quote|estimate|proposal|bid|tender)\b/i;
const COMPLETED_PAYMENT_FACT_RE =
  /\b(?:deposit|payment)(?:\s+payment)?\s+(?:(?:was|is|has been|had been)\s+)?(?:paid|sent|received)\b|\b(?:paid|sent|received)(?:\s+and\s+confirmed)?\s+(?:(?:(?:the|my|your|our|his|her|their|a)\s+|[a-z][a-z-]*(?:['’]s)\s+))?(?:\d+(?:\.\d+)?\s*%\s+)?(?:deposit|payment)\b(?!\s+(?:confirmation|status|authorization|authentication|method|instructions?|details?|invoice|link|request|reminder))/i;
const PAYMENT_ADMINISTRATION_RE =
  /\b(?:deposit|payment)\b.{0,40}\b(?:instructions?|details?|invoice|link|request|reminder|receipt)\b|\b(?:instructions?|details?|invoice|link|request|reminder|receipt)\b.{0,40}\b(?:deposit|payment)\b/i;
const NEGATED_PAYMENT_RE =
  /\b(?:deposit|payment)\b.{0,60}\b(?:not|never|unpaid|outstanding|pending|hasn'?t|haven'?t|has not|have not)\b|\b(?:not|never|cannot|can'?t|hasn'?t|haven'?t|has not|have not|waiting for|pending)\b.{0,60}\b(?:paid|sent|received|confirmed|deposit|payment)\b|\bno\s+(?:deposit|payment)\b.{0,60}\b(?:paid|sent|received|confirmed)\b/i;
const PAYMENT_REVERSAL_RE =
  /\b(?:deposit|payment)\b.{0,80}\b(?:refund(?:ed)?|revers(?:ed|al)|return(?:ed)?|sent back|chargeback)\b|\b(?:refund(?:ed)?|revers(?:ed|al)|return(?:ed)?|sent back|chargeback)\b.{0,80}\b(?:deposit|payment|funds?)\b/i;
const IMPERATIVE_CONFIRMATION_REQUEST_RE =
  /\bplease\s+(?:confirm|verify|check)\b|\b(?:can|could|would|will)\s+you\s+(?:confirm|verify|check)\b|^\s*(?:confirm|verify|check)\b/i;
const SCHEDULE_CONFIRMED_RE =
  /\b(?:confirmed|booked|scheduled)\b.{0,100}\b(?:tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|next week|\d{1,2}(?:st|nd|rd|th)(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?)\b|\b(?:tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|next week|\d{1,2}(?:st|nd|rd|th))\b.{0,80}\b(?:is good|works?|confirmed|booked|scheduled|start)\b/i;
const DECLARATIVE_EXECUTION_SCHEDULE_RE =
  /\b(?:installation|work|job|project|crew)\s+(?:(?:will\s+)?(?:starts?|begins?|arrives?|comes?)|(?:is|are)\s+(?:starting|beginning|arriving|coming))\s+(?:on\s+)?(?:the\s+)?(?:tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}(?:st|nd|rd|th)?)\b|\bwe\s+(?:(?:will\s+)?(?:start|begin)|(?:are|['’]re)\s+(?:starting|beginning))\s+(?:the\s+)?(?:installation|work|job|project)\s+(?:on\s+)?(?:the\s+)?(?:tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}(?:st|nd|rd|th)?)\b/i;
const SCHEDULE_FACT_RE =
  /\b(?:confirmed|booked|scheduled|availability|start date|week of|next week|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}(?:st|nd|rd|th))\b/i;
const SCHEDULE_FACT_CONTEXT_RE =
  /\b(?:need(?:ed)?\s+(?:it|them|this|the work)?\s*until|start(?:ing)?(?:\s+us)?|week of|on for|schedule|book(?:ed|ing)?|availability|available|installation|crew|work date|project date|deadline|timeline|pickup|delivery|ready (?:by|for))\b/i;
const SEE_YOU_EXECUTION_SCHEDULE_RE =
  /\bsee you\s+(?:on\s+)?(?:tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}(?:st|nd|rd|th)?)\b/i;
const CONDITIONAL_PAYMENT_RE =
  /\b(?:if|once|when|after|upon|pending|will be|would be|can be|could be)\b.{0,80}\b(?:paid|sent|received|confirmed|deposit|payment)\b|\b(?:will|would|can|could|going to|plan(?:ning)? to|intend(?:ing)? to)\b.{0,80}\b(?:pay|send|have|make|get)\b.{0,60}\b(?:paid|sent|received|confirmed|deposit|payment)\b|\b(?:deposit|payment)\b.{0,100}\b(?:will|would|can|could|going to|plan(?:ning)? to|intend(?:ing)? to)\b.{0,60}\b(?:pay|send|have|make|get|paid|sent)\b/i;
const CONDITIONAL_SCHEDULE_RE =
  /\b(?:if|once|when|after|pending|tentative|proposed|available|availability|can be|could be|would be|may be|might be)\b.{0,80}\b(?:confirmed|booked|scheduled|start|begin|arrive|install(?:ation)?)\b|\b(?:confirmed|booked|scheduled|start(?:s|ing)?|begin(?:s|ning)?|arriv(?:e|es|ing))\b.{0,80}\b(?:if|unless|pending|tentative|subject to|assuming)\b/i;
const NEGATED_SCHEDULE_RE =
  /\b(?:not|never|cannot|can'?t|unable to|hasn'?t|haven'?t|has not|have not)\b.{0,60}\b(?:confirmed|booked|scheduled|start(?:ing)?)\b|\bno\s+(?:(?:installation|crew|work|job|project|start|date|day)\s+)?(?:is\s+)?(?:confirmed|booked|scheduled|start(?:ing)?)\b|\bnothing(?:\s+is)?\s+(?:confirmed|booked|scheduled|start(?:ing)?)\b/i;
const EXECUTION_SCHEDULE_CONTEXT_RE =
  /\b(?:install(?:ation|ing)?|crew|job|project|work|on[ -]?site|start(?:ing)?|deliver(?:y|ing)?|pickup|fabricat(?:e|ion|ing))\b/i;
const PRE_SALE_ACTIVITY_RE =
  /\b(?:consultation|measur(?:e|es|ed|ing|ement|ements)|walk[ -]?through|site[ -]?visit|inspection)\b|\b(?:estimate|quote|proposal|sales)\b.{0,60}\b(?:appointment|meeting|visit|call)\b|\b(?:appointment|meeting|visit|call)\b.{0,60}\b(?:estimate|quote|proposal|sales)\b/i;
const SCHEDULE_CHANGE_OR_CANCELLATION_RE =
  /\b(?:cancel(?:led|ed|ing)?|postpon(?:e|ed|ing)|reschedul(?:e|ed|ing)|delay(?:ed|ing)?)\b/i;
const CONFIRMED_RESCHEDULE_RE =
  /\brescheduled\b.{0,80}\b(?:for|to)\b.{0,20}\b(?:tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|next week|\d{1,2}(?:st|nd|rd|th)?)\b/i;
const SCHEDULE_INQUIRY_RE =
  /\b(?:is|are|can|could|would|will)\b.{0,60}\b(?:tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|date|day)\b.{0,60}\b(?:open|available|work|good|possible)\b\s*\?/i;
const DEFERRAL_ACTION_VERB_RE =
  /\b(?:delay(?:ed|ing)?|postpon(?:e|ed|ing)|defer(?:red|ring)?|paus(?:e|ed|ing)|revisit(?:ed|ing)?|circle(?:d|ing)? back|wait(?:ed|ing)?|hold(?:ing)? off|put(?:ting)? (?:this|it) off)\b/gi;
const NEGATED_DEFERRAL_ACTION_PREFIX_RE =
  /(?:\b(?:can(?:not|['’]t)|could(?: not|n['’]t)|will not|won(?:not|['’]t)|do not|don['’]t|does not|doesn['’]t|did not|didn['’]t|are not|aren['’]t|is not|isn['’]t|was not|wasn['’]t|were not|weren['’]t|not|never|without)(?:\s+(?:need|have|plan|going|be))?(?:\s+to)?|\bno (?:need|plans?|intention)(?:\s+(?:to|of))?|\bnothing\s+(?:is|was|has been|had been))\s*$/i;
const HYPOTHETICAL_DEFERRAL_PREFIX_RE =
  /\b(?:if|unless|in case|depending on|may|might|could|would)\b[\s\S]*$/i;
const DIRECT_DEFERRAL_REQUEST_RE =
  /\b(?:please|can you|could you|would you|can we|could we|would we|would it be possible to|we need to|we have to|we must|we would like to|i would like to|would like to|let'?s)\s+(?:delay|postpone|defer|pause|revisit|wait|hold off|put (?:this|it) off)\b/i;
const INABILITY_TO_PROCEED_RE =
  /\b(?:can(?:not|['’]t)|can not|unable to|not able to|won(?:not|['’]t) be able to)\s+(?:afford|swing|do\b|proceed|move (?:ahead|forward)|go ahead|start|schedule|fund|pay|make (?:it|this) work)\b/i;
const DEFERRAL_CAUSE_RE =
  /\b(?:budget|funds?|money|afford|cash|financ(?:e|es|ial)|repair|engine|truck|timing)\b/i;
const CUSTOMER_DECLINE_RE =
  /\b(?:cancel(?:led|ed|ing)?(?: the| this| our)? (?:job|project|work|installation)|cancel(?:led|ed)? (?:it|this) (?:entirely|altogether)|do not proceed|don'?t proceed|decid(?:e|ed) not to (?:proceed|move forward)|not moving forward|hired someone else|going with someone else|declin(?:e|ed)(?: the)? (?:quote|estimate|proposal|work|job|project|installation)|no longer (?:want|need) (?:the|this)? ?(?:work|job|project|installation)?)\b/gi;
const NEGATED_DECLINE_PREFIX_RE =
  /(?:\b(?:have|has|had|are|is|was|were|do|does|did|will|would|can|could)\s+not|\b(?:haven|hasn|hadn|aren|isn|wasn|weren|don|doesn|didn|won|wouldn|can|couldn)['’]t|\bnever|\bnothing\s+(?:is|was|has been|had been))(?:\s+\w+){0,2}\s*$/i;
const HYPOTHETICAL_DECLINE_PREFIX_RE =
  /\b(?:if|unless|in case|depending on|may|might|could|should|would)\b[\s\S]*$/i;
const DIRECT_DECLINE_REQUEST_RE =
  /\b(?:please|can you|could you|would you|can we|could we|would we|would it be possible to|we need to|we have to|we must|we would like to|i would like to|would like to)\s+(?:cancel|decline|stop)\b/i;
const ADMINISTRATIVE_CANCELLATION_RE =
  /\b(?:cancel(?:led|ed|ing)?|declin(?:e|ed|ing))\s+(?:(?:the|this|our|my|your)\s+)?(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:['’]s)?\s+)?(?:calendar invitation|site[ -]?visit|consultation(?: appointment)?|measurement(?: appointment)?|estimate appointment|appointment|meeting|installation date|start date|work date|project date|date|day|time|slot|payment method|payment authorization|payment authentication|card)\b|\b(?:calendar invitation|site[ -]?visit|consultation(?: appointment)?|measurement(?: appointment)?|estimate appointment|appointment|meeting|installation date|start date|work date|project date|date|day|time|slot|payment method|payment authorization|payment authentication|card)\b.{0,40}\b(?:(?:was|is|has been|had been)\s+)?(?:cancel(?:led|ed|ing)?|declin(?:e|ed|ing))\b/i;
const NON_DEAL_ACCEPTANCE_OBJECT_RE =
  /\baccept(?:ed|ing)?\s+(?:(?:your|the|an?)\s+)?(?:invitation|request)\s+to\s+(?:quote|bid|tender)\b|\baccept(?:ed|ing)?\s+(?:(?:your|the|an?)\s+)?(?:rfq|invitation to tender)\b/i;
const EXPLICIT_SCOPE_EXCLUSION_RE =
  /\b(?:exclude(?:d|s|ing)?|not included|no longer included|remove(?:d)? from (?:the )?scope|without)\b/i;
const SELF_PERFORMED_SCOPE_RE =
  /\b(?:owner|customer|client|homeowner|husband|wife|we|i|they|he|she)\b.{0,80}(?:\b(?:will|can|is going to)\b|(?:'|’)ll)\s+(?:(?:be able to|personally|just)\s+)*(?:handle|supply|provide|remove|complete|perform|do|take care of)\b/i;
const THIRD_PARTY_SELF_PERFORMED_SCOPE_RE =
  /\b(?:owner|customer|client|homeowner|husband|wife|they|he|she)\b.{0,80}(?:\b(?:will|can|is going to)\b|(?:'|’)ll)\s+(?:(?:be able to|personally|just)\s+)*(?:handle|supply|provide|remove|complete|perform|do|take care of)\b/i;
const EXPLICIT_SCOPE_CONTEXT_RE =
  /\b(?:scope(?: of work)?|materials?|finishes?|dimensions?|sizes?|colou?rs?|options?|revisions?|additions?)\b/i;
const INTERROGATIVE_CLAUSE_OPEN_RE =
  /^\s*(?:who|what|when|where|why|how|is|are|was|were|has|have|had|can|could|would|will|should|do|does|did|may|might)\b/i;

function isInterrogativeClaim(body: string, patterns: RegExp[]): boolean {
  const matches = patterns
    .map((pattern) =>
      new RegExp(pattern.source, pattern.flags.replace("g", "")).exec(body)
    )
    .filter((match): match is RegExpExecArray => match !== null)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const claim = matches[0];
  if (!claim) return false;

  const claimIndex = claim.index ?? 0;
  let clauseStart = 0;
  for (let index = claimIndex - 1; index >= 0; index -= 1) {
    if (/[.!?;\n]/.test(body[index] ?? "")) {
      clauseStart = index + 1;
      break;
    }
  }
  const prefix = body.slice(clauseStart, claimIndex);
  if (INTERROGATIVE_CLAUSE_OPEN_RE.test(prefix)) return true;

  const afterClaim = body.slice(claimIndex + claim[0].length);
  const nextClauseBoundary = afterClaim.search(/[.!;\n]/);
  const questionIndex = afterClaim.indexOf("?");
  if (
    questionIndex >= 0 &&
    (nextClauseBoundary < 0 || questionIndex < nextClauseBoundary) &&
    /^\s*(?:yet\s*)?\?/.test(afterClaim)
  ) {
    return true;
  }
  return false;
}

function clauseAroundMatch(
  body: string,
  index: number,
  length: number
): string {
  let start = 0;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (/[.!?;\n]/.test(body[cursor] ?? "")) {
      start = cursor + 1;
      break;
    }
  }

  let end = body.length;
  for (let cursor = index + length; cursor < body.length; cursor += 1) {
    if (/[.!?;\n]/.test(body[cursor] ?? "")) {
      end = cursor + 1;
      break;
    }
  }
  return body.slice(start, end).trim();
}

function hasDeferralAction(body: string): boolean {
  for (const match of body.matchAll(DEFERRAL_ACTION_VERB_RE)) {
    const matchIndex = match.index ?? 0;
    const clause = clauseAroundMatch(body, matchIndex, match[0].length);
    const clauseMatchIndex = clause
      .toLowerCase()
      .indexOf(match[0].toLowerCase());
    const prefix = clause.slice(0, Math.max(0, clauseMatchIndex));
    if (NEGATED_DEFERRAL_ACTION_PREFIX_RE.test(prefix)) continue;
    if (DIRECT_DEFERRAL_REQUEST_RE.test(clause)) return true;
    if (HYPOTHETICAL_DEFERRAL_PREFIX_RE.test(prefix)) continue;
    if (isInterrogativeClaim(clause, [DEFERRAL_ACTION_VERB_RE])) continue;
    return true;
  }

  const inability = INABILITY_TO_PROCEED_RE.exec(body);
  if (!inability) return false;
  const clause = clauseAroundMatch(
    body,
    inability.index ?? 0,
    inability[0].length
  );
  const clauseMatchIndex = clause
    .toLowerCase()
    .indexOf(inability[0].toLowerCase());
  const prefix = clause.slice(0, Math.max(0, clauseMatchIndex));
  return (
    !HYPOTHETICAL_DEFERRAL_PREFIX_RE.test(prefix) &&
    !isInterrogativeClaim(clause, [INABILITY_TO_PROCEED_RE])
  );
}

function hasCustomerDecline(body: string): boolean {
  for (const match of body.matchAll(CUSTOMER_DECLINE_RE)) {
    const matchIndex = match.index ?? 0;
    const clause = clauseAroundMatch(body, matchIndex, match[0].length);
    const clauseMatchIndex = clause
      .toLowerCase()
      .indexOf(match[0].toLowerCase());
    const prefix = clause.slice(0, Math.max(0, clauseMatchIndex));
    if (
      /^\s*(?:cancel|declin)/i.test(match[0]) &&
      ADMINISTRATIVE_CANCELLATION_RE.test(clause)
    ) {
      continue;
    }
    if (NEGATED_DECLINE_PREFIX_RE.test(prefix)) continue;
    if (DIRECT_DECLINE_REQUEST_RE.test(clause)) return true;
    if (HYPOTHETICAL_DECLINE_PREFIX_RE.test(prefix)) continue;
    if (isInterrogativeClaim(clause, [CUSTOMER_DECLINE_RE])) continue;
    return true;
  }
  return false;
}

function hasExplicitAcceptance(body: string, subject: string): boolean {
  const clauses = commercialClauses(body);
  return clauses.some((clause) => {
    const value = clause.trim();
    const conditionValue = value
      .replace(ACCEPTANCE_FOLLOW_UP_SCHEDULING_QUESTION_RE, "")
      .replace(COMPLETED_ACCEPTANCE_REVIEW_PREFIX_RE, "");
    const genericAcceptance = GENERIC_ACCEPT_OR_APPROVE_RE.test(value);
    const hasCommercialContext =
      COMMERCIAL_DEAL_CONTEXT_RE.test(value) ||
      UNAMBIGUOUS_ACCEPTANCE_ACTION_RE.test(value) ||
      (genericAcceptance &&
        STANDALONE_GENERIC_ACCEPTANCE_RE.test(value) &&
        (COMMERCIAL_DEAL_CONTEXT_RE.test(subject) ||
          COMMERCIAL_DEAL_CONTEXT_RE.test(body)));
    return (
      (COMMERCIAL_ACCEPTANCE_RE.test(value) ||
        ADDITIONAL_COMMERCIAL_ACCEPTANCE_RE.test(value) ||
        EXPLICIT_DOCUMENT_ACCEPTANCE_RE.test(value)) &&
      (!genericAcceptance || hasCommercialContext) &&
      !ADMINISTRATIVE_ACCEPTANCE_OBJECT_RE.test(value) &&
      !PREQUOTE_PROCEED_RE.test(value) &&
      !NON_DEAL_ACCEPTANCE_OBJECT_RE.test(value) &&
      !CONDITIONAL_ACCEPTANCE_RE.test(conditionValue) &&
      !NEGATED_ACCEPTANCE_RE.test(value) &&
      !isInterrogativeClaim(value, [
        COMMERCIAL_ACCEPTANCE_RE,
        ADDITIONAL_COMMERCIAL_ACCEPTANCE_RE,
        EXPLICIT_DOCUMENT_ACCEPTANCE_RE,
      ])
    );
  });
}

function commercialClauses(body: string): string[] {
  const clauses: string[] = [];
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    const decimalPoint =
      char === "." &&
      /\d/.test(body[index - 1] ?? "") &&
      /\d/.test(body[index + 1] ?? "");
    if (!decimalPoint && /[.!?;\n]/.test(char ?? "")) {
      const clause = body.slice(start, index + 1).trim();
      if (clause) clauses.push(clause);
      start = index + 1;
    }
  }
  const tail = body.slice(start).trim();
  if (tail) clauses.push(tail);
  return clauses.length > 0 ? clauses : [body];
}

function confirmationRequestGovernsClaim(
  clause: string,
  claimPattern: RegExp
): boolean {
  const request = IMPERATIVE_CONFIRMATION_REQUEST_RE.exec(clause);
  const claim = new RegExp(
    claimPattern.source,
    claimPattern.flags.replace("g", "")
  ).exec(clause);
  if (!request || !claim) return false;
  const requestIndex = request.index ?? 0;
  const claimIndex = claim.index ?? 0;
  return requestIndex <= claimIndex;
}

function hasPaymentConfirmation(body: string): boolean {
  return commercialClauses(body).some(
    (clause) =>
      COMPLETED_PAYMENT_FACT_RE.test(clause) &&
      (!PAYMENT_ADMINISTRATION_RE.test(clause) ||
        COMPLETED_PAYMENT_FACT_RE.test(clause)) &&
      !CONDITIONAL_PAYMENT_RE.test(clause) &&
      !NEGATED_PAYMENT_RE.test(clause) &&
      !PAYMENT_REVERSAL_RE.test(clause) &&
      !confirmationRequestGovernsClaim(clause, COMPLETED_PAYMENT_FACT_RE) &&
      !isInterrogativeClaim(clause, [COMPLETED_PAYMENT_FACT_RE])
  );
}

function hasScheduleConfirmation(
  body: string,
  commerciallyCommitted: boolean
): boolean {
  return commercialClauses(body).some((clause) => {
    const correctionMarkers = [...clause.matchAll(COMMERCIAL_CORRECTION_RE)];
    const correction = correctionMarkers.at(-1);
    const currentClause =
      correction && SCHEDULE_CHANGE_OR_CANCELLATION_RE.test(clause)
        ? clause.slice((correction.index ?? 0) + correction[0].length).trim()
        : clause;
    const guardedSchedule =
      SCHEDULE_CONFIRMED_RE.test(currentClause) ||
      DECLARATIVE_EXECUTION_SCHEDULE_RE.test(currentClause) ||
      (commerciallyCommitted &&
        SEE_YOU_EXECUTION_SCHEDULE_RE.test(currentClause));
    return (
      guardedSchedule &&
      (EXECUTION_SCHEDULE_CONTEXT_RE.test(clause) || commerciallyCommitted) &&
      !PRE_SALE_ACTIVITY_RE.test(currentClause) &&
      !SCHEDULE_CHANGE_OR_CANCELLATION_RE.test(currentClause) &&
      !SCHEDULE_INQUIRY_RE.test(currentClause) &&
      !CONDITIONAL_SCHEDULE_RE.test(currentClause) &&
      !NEGATED_SCHEDULE_RE.test(currentClause) &&
      !confirmationRequestGovernsClaim(
        currentClause,
        SCHEDULE_CONFIRMED_RE.test(currentClause)
          ? SCHEDULE_CONFIRMED_RE
          : DECLARATIVE_EXECUTION_SCHEDULE_RE.test(currentClause)
            ? DECLARATIVE_EXECUTION_SCHEDULE_RE
            : SEE_YOU_EXECUTION_SCHEDULE_RE
      ) &&
      !isInterrogativeClaim(currentClause, [
        SCHEDULE_CONFIRMED_RE,
        DECLARATIVE_EXECUTION_SCHEDULE_RE,
        SEE_YOU_EXECUTION_SCHEDULE_RE,
      ])
    );
  });
}

function isExcludedScopeStatement(
  message: CommercialOutcomeMessage,
  value: string
): boolean {
  if (EXPLICIT_SCOPE_EXCLUSION_RE.test(value)) return true;
  // A customer asking whether OPS can help with work is not a declaration that
  // the customer or another party will self-perform that scope.
  if (value.includes("?")) return false;
  if (/^\s*(?:if|unless|when|once)\b/i.test(value)) return false;
  if (!SELF_PERFORMED_SCOPE_RE.test(value)) return false;
  if (message.direction === "inbound" && message.authorRole === "customer") {
    return true;
  }
  return (
    message.direction === "outbound" &&
    message.authorRole === "operator" &&
    THIRD_PARTY_SELF_PERFORMED_SCOPE_RE.test(value)
  );
}

function excludedScopeStatement(
  message: CommercialOutcomeMessage
): string | null {
  const sentences = cleanBody(message.body).match(/[^.!?\n]+[.!?]?/g) ?? [];
  for (let index = sentences.length - 1; index >= 0; index -= 1) {
    const sentence = sentences[index].trim();
    if (sentence && isExcludedScopeStatement(message, sentence)) {
      return sentence;
    }
  }
  return null;
}

function collectMessageSignals(
  message: CommercialOutcomeMessage,
  priorCommerciallyCommitted: boolean,
  body: string
): CommercialSignal[] {
  const signals: CommercialSignal[] = [];
  const trustedCustomerInbound =
    message.direction === "inbound" && message.authorRole === "customer";
  const trustedOperatorOutbound =
    message.direction === "outbound" && message.authorRole === "operator";
  const trustedCommercialAuthor =
    trustedCustomerInbound || trustedOperatorOutbound;
  if (trustedCustomerInbound && hasCustomerDecline(body)) {
    signals.push("customer_declined");
  }
  if (trustedCustomerInbound && hasExplicitAcceptance(body, message.subject)) {
    signals.push("explicit_acceptance");
  }
  if (
    trustedCustomerInbound &&
    DEPOSIT_REQUEST_RE.test(body) &&
    !CONDITIONAL_DEPOSIT_RE.test(body) &&
    !NEGATED_DEPOSIT_REQUEST_RE.test(body) &&
    !PREQUOTE_DEPOSIT_DETAILS_RE.test(body)
  ) {
    signals.push("deposit_requested");
  }
  if (trustedCommercialAuthor && hasPaymentConfirmation(body)) {
    signals.push("payment_confirmed");
  }
  const commerciallyCommitted =
    priorCommerciallyCommitted ||
    signals.some((signal) =>
      [
        "explicit_acceptance",
        "deposit_requested",
        "payment_confirmed",
      ].includes(signal)
    );
  if (
    trustedCommercialAuthor &&
    hasScheduleConfirmation(body, commerciallyCommitted)
  ) {
    signals.push("schedule_confirmed");
  }
  if (
    trustedCustomerInbound &&
    hasDeferralAction(body) &&
    (DEFERRAL_CAUSE_RE.test(body) || INABILITY_TO_PROCEED_RE.test(body)) &&
    resolveDeferredTiming(body, new Date(message.occurredAt)) !== null
  ) {
    signals.push("budget_timing_deferral");
  }
  return signals;
}

const COMMERCIAL_CORRECTION_RE =
  /\b(?:but|however|yet|instead|nevertheless|on the other hand)\b/gi;

function messageSignals(
  message: CommercialOutcomeMessage,
  priorCommerciallyCommitted: boolean
): { signals: CommercialSignal[]; unresolvedConflict: boolean } {
  const body = cleanBody(message.body);
  const signals = collectMessageSignals(
    message,
    priorCommerciallyCommitted,
    body
  );
  const trustedCommercialAuthor =
    (message.direction === "inbound" && message.authorRole === "customer") ||
    (message.direction === "outbound" && message.authorRole === "operator");
  if (
    trustedCommercialAuthor &&
    PAYMENT_REVERSAL_RE.test(body) &&
    !signals.includes("budget_timing_deferral") &&
    !signals.includes("customer_declined") &&
    !signals.includes("explicit_acceptance")
  ) {
    return { signals: [], unresolvedConflict: true };
  }
  const hasPositive = signals.some(
    (signal) =>
      signal !== "budget_timing_deferral" && signal !== "customer_declined"
  );
  const hasVeto = signals.some(
    (signal) =>
      signal === "budget_timing_deferral" || signal === "customer_declined"
  );
  if (!hasPositive || !hasVeto) {
    return { signals, unresolvedConflict: false };
  }

  // One customer reply can quote an earlier intent and then explicitly correct
  // it. Only a clear contrast clause is allowed to resolve opposing commercial
  // signals; otherwise the message remains non-authoritative and fails closed.
  const correctionMarkers = [...body.matchAll(COMMERCIAL_CORRECTION_RE)];
  const lastCorrection = correctionMarkers.at(-1);
  if (!lastCorrection) return { signals: [], unresolvedConflict: true };

  const correctionBody = body.slice(
    (lastCorrection.index ?? 0) + lastCorrection[0].length
  );
  const correctedSignals = collectMessageSignals(
    { ...message, body: correctionBody },
    priorCommerciallyCommitted,
    correctionBody
  );
  const correctedHasPositive = correctedSignals.some(
    (signal) =>
      signal !== "budget_timing_deferral" && signal !== "customer_declined"
  );
  const correctedHasVeto = correctedSignals.some(
    (signal) =>
      signal === "budget_timing_deferral" || signal === "customer_declined"
  );
  if (correctedHasPositive === correctedHasVeto) {
    return { signals: [], unresolvedConflict: true };
  }
  return {
    signals: correctedSignals,
    unresolvedConflict: false,
  };
}

/**
 * Determine whether newer trusted correspondence leaves an earlier durable
 * commitment unresolved. Neutral messages preserve the earlier commitment;
 * a reversal or unresolved positive/veto message blocks it until a later
 * decisive commercial signal replaces that ambiguity.
 */
export function hasUnresolvedCommercialConflict(
  input: CommercialOutcomeMessage[],
  priorCommerciallyCommitted = false
): boolean {
  const messages = [...input]
    .filter(
      (message) =>
        Boolean(message.providerMessageId.trim()) &&
        Number.isFinite(Date.parse(message.occurredAt))
    )
    .sort((a, b) => {
      const timeDelta = Date.parse(a.occurredAt) - Date.parse(b.occurredAt);
      if (timeDelta !== 0) return timeDelta;
      const aKey = a.evidenceKey ?? a.providerMessageId;
      const bKey = b.evidenceKey ?? b.providerMessageId;
      return aKey.localeCompare(bKey);
    });
  let unresolved = false;
  let committed = priorCommerciallyCommitted;

  for (const message of messages) {
    const evaluation = messageSignals(message, committed);
    if (evaluation.unresolvedConflict) {
      unresolved = true;
      committed = false;
      continue;
    }
    if (
      evaluation.signals.includes("budget_timing_deferral") ||
      evaluation.signals.includes("customer_declined")
    ) {
      unresolved = false;
      committed = false;
      continue;
    }
    if (evaluation.signals.length === 0) continue;
    unresolved = false;
    committed = true;
  }

  return unresolved;
}

const SCOPE_TERM_STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "before",
  "bring",
  "charge",
  "complete",
  "cost",
  "customer",
  "doing",
  "existing",
  "extra",
  "included",
  "including",
  "installation",
  "job",
  "owner",
  "price",
  "project",
  "provide",
  "revised",
  "scope",
  "total",
  "work",
  "would",
]);

function normalizeScopeTerm(term: string): string {
  const normalized = term.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (/^remov(?:al|e|ed|es|ing)$/.test(normalized)) return "remove";
  if (/^suppl(?:y|ies|ied|ying)$/.test(normalized)) return "supply";
  if (normalized.endsWith("ies") && normalized.length > 5) {
    return `${normalized.slice(0, -3)}y`;
  }
  if (normalized.endsWith("s") && normalized.length > 4) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

function scopeTerms(value: string): Set<string> {
  return new Set(
    value
      .split(/\s+/)
      .map(normalizeScopeTerm)
      .filter((term) => term.length >= 4 && !SCOPE_TERM_STOPWORDS.has(term))
  );
}

function scopeStatementsOverlap(left: string, right: string): boolean {
  const rightTerms = scopeTerms(right);
  return [...scopeTerms(left)].some((term) => rightTerms.has(term));
}

function scopeActionTerms(value: string): Set<string> {
  const matches =
    value.match(
      /\b(?:install(?:ation|ing)?|supply|supplies|supplied|supplying|provide|provided|providing|replace|replaced|replacing|repair|repaired|repairing|build|building|construct|constructing|remove|removed|removal|removing|include|included|including|exclude|excluded|excluding|handle|handled|handling)\b/gi
    ) ?? [];
  return new Set(matches.map(normalizeScopeTerm));
}

function scopeActionsOverlap(left: string, right: string): boolean {
  const rightActions = scopeActionTerms(right);
  return [...scopeActionTerms(left)].some((term) => rightActions.has(term));
}

function isCurrentCommercialScopeStatement(value: string): boolean {
  return (
    scopeActionTerms(value).size > 0 || EXPLICIT_SCOPE_CONTEXT_RE.test(value)
  );
}

function currentScopeStatement(
  messages: CommercialOutcomeMessage[],
  excludedScope: string | null
): string | null {
  const statements: string[] = [];
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex -= 1
  ) {
    const message = messages[messageIndex];
    const sentences = message.body.match(/[^.!?\n]+[.!?]?/g) ?? [];
    for (
      let sentenceIndex = sentences.length - 1;
      sentenceIndex >= 0;
      sentenceIndex -= 1
    ) {
      const sentence = sentences[sentenceIndex].trim();
      if (!sentence || !isCurrentCommercialScopeStatement(sentence)) continue;
      if (isExcludedScopeStatement(message, sentence)) continue;
      if (
        excludedScope &&
        scopeStatementsOverlap(sentence, excludedScope) &&
        scopeActionsOverlap(sentence, excludedScope)
      ) {
        continue;
      }
      statements.unshift(sentence);
      if (statements.length === 2) return statements.join(" ");
    }
  }
  return statements[0] ?? null;
}

function currentMoney(messages: CommercialOutcomeMessage[]): number | null {
  const prices: Array<
    ReturnType<typeof extractCommercialDealPriceMatches>[number] & {
      messageIndex: number;
    }
  > = [];
  for (const [messageIndex, message] of messages.entries()) {
    for (const price of extractCommercialDealPriceMatches(message.body)) {
      prices.push({ ...price, messageIndex });
    }
  }
  const eligiblePrices = prices;
  const latest = eligiblePrices.at(-1);
  if (!latest) return null;

  // A removal add-on is superseded when the customer later confirms that they
  // will remove the old material themselves. Recover the newest earlier base
  // price instead of keeping the now-inapplicable add-on total.
  let latestExcludedScope: { index: number; body: string } | null = null;
  for (let index = 0; index < messages.length; index += 1) {
    const excludedScope = excludedScopeStatement(messages[index]);
    if (excludedScope) {
      latestExcludedScope = { index, body: excludedScope };
    }
  }
  if (
    latestExcludedScope &&
    latestExcludedScope.index > latest.messageIndex &&
    scopeStatementsOverlap(latest.segment, latestExcludedScope.body)
  ) {
    const priorBasePrice = [...eligiblePrices]
      .reverse()
      .find(
        (price) =>
          (price.messageIndex < latest.messageIndex ||
            (price.messageIndex === latest.messageIndex &&
              price.matchIndex < latest.matchIndex)) &&
          !/\bremov/i.test(price.segment)
      );
    if (priorBasePrice) return priorBasePrice.value;
  }
  return latest.value;
}

function lastMatchingBody(
  messages: CommercialOutcomeMessage[],
  pattern: RegExp
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const body = cleanBody(messages[index].body);
    pattern.lastIndex = 0;
    if (pattern.test(body)) return body;
  }
  return null;
}

function lastExcludedScopeBody(
  messages: CommercialOutcomeMessage[]
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const excludedScope = excludedScopeStatement(message);
    if (excludedScope) return excludedScope;
  }
  return null;
}

function lastScheduleFactBody(
  messages: CommercialOutcomeMessage[]
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const body = cleanBody(messages[index].body);
    if (PRE_SALE_ACTIVITY_RE.test(body)) continue;
    if (
      /\b(?:quote|estimate|proposal)\b.{0,60}\b(?:valid(?:ity)?|expires?|expiry|good (?:through|until))\b|\b(?:valid(?:ity)?|expires?|expiry|good (?:through|until))\b.{0,60}\b(?:quote|estimate|proposal)\b/i.test(
        body
      )
    ) {
      continue;
    }
    if (
      SCHEDULE_CHANGE_OR_CANCELLATION_RE.test(body) &&
      !CONFIRMED_RESCHEDULE_RE.test(body)
    ) {
      return null;
    }
    if (CONDITIONAL_SCHEDULE_RE.test(body)) continue;
    if (SCHEDULE_FACT_RE.test(body) && SCHEDULE_FACT_CONTEXT_RE.test(body)) {
      return body;
    }
  }
  return null;
}

const MONTH_INDEX_BY_NAME: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

const MONTH_COUNT_BY_WORD: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  "twenty-one": 21,
  "twenty-two": 22,
  "twenty-three": 23,
  "twenty-four": 24,
};

const NAMED_MONTH_TIMING_RE =
  /\b(?:until|to|in|around|by)\s+(?:(next)\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(20\d{2}))?\b/i;
const EXPLICIT_YEAR_TIMING_RE = /\b(?:until|to|in|by)\s+(20\d{2})\b/i;
const NAMED_SEASON_TIMING_RE =
  /\b(?:(?:until|to|in|around|by)\s+)?(?:(next|this)\s+)?(spring|summer|fall|autumn|winter)\b/i;
const RELATIVE_MONTH_TOKEN =
  "(?:\\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:[ -](?:one|two|three|four))?)";
const RELATIVE_MONTH_TIMING_RE = new RegExp(
  `\\b(?:in|for|by|another)\\s+(${RELATIVE_MONTH_TOKEN})\\s+months?\\b|\\b(?:wait|postpone|delay|hold off|put (?:this|it) off)\\b.{0,40}?\\b(${RELATIVE_MONTH_TOKEN})\\s+months?\\b`,
  "i"
);

interface DeferredTiming {
  followUpAt: string;
  nextAction: string;
}

const MAX_DEFERRED_FOLLOW_UP_MONTHS = 18;

function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function addCalendarMonths(value: Date, months: number): Date {
  const result = new Date(value.getTime());
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  result.setUTCDate(
    Math.min(
      originalDay,
      daysInUtcMonth(result.getUTCFullYear(), result.getUTCMonth())
    )
  );
  return result;
}

function addCalendarYears(value: Date, years: number): Date {
  const result = new Date(value.getTime());
  const originalMonth = result.getUTCMonth();
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCFullYear(result.getUTCFullYear() + years, originalMonth, 1);
  result.setUTCDate(
    Math.min(
      originalDay,
      daysInUtcMonth(result.getUTCFullYear(), originalMonth)
    )
  );
  return result;
}

function firstOfUtcMonth(value: Date, year: number, month: number): Date {
  const result = new Date(value.getTime());
  result.setUTCFullYear(year, month, 1);
  return result;
}

function boundedDeferredTiming(input: {
  occurredAt: Date;
  requestedFollowUp: Date;
  requestedNextAction: string;
  requestedTiming: string;
}): DeferredTiming {
  const maximumFollowUp = addCalendarMonths(
    input.occurredAt,
    MAX_DEFERRED_FOLLOW_UP_MONTHS
  );
  if (input.requestedFollowUp.getTime() <= maximumFollowUp.getTime()) {
    return {
      followUpAt: input.requestedFollowUp.toISOString(),
      nextAction: input.requestedNextAction,
    };
  }
  return {
    followUpAt: maximumFollowUp.toISOString(),
    nextAction: `Follow up within ${MAX_DEFERRED_FOLLOW_UP_MONTHS} months to reassess the customer's ${input.requestedTiming}.`,
  };
}

function relativeMonthCount(value: string): number | null {
  const normalized = value.toLowerCase().replace(/\s+/g, "-");
  const count = /^\d+$/.test(normalized)
    ? Number(normalized)
    : MONTH_COUNT_BY_WORD[normalized];
  return Number.isInteger(count) && count >= 1 && count <= 120 ? count : null;
}

function resolveDeferredTiming(
  body: string,
  occurredAt: Date
): DeferredTiming | null {
  if (!Number.isFinite(occurredAt.getTime())) return null;

  const relativeMatch = body.match(RELATIVE_MONTH_TIMING_RE);
  const relativeText = relativeMatch?.[1] ?? relativeMatch?.[2];
  if (relativeText) {
    const count = relativeMonthCount(relativeText);
    if (count !== null) {
      const label = relativeText.toLowerCase().replace(/-/g, " ");
      return boundedDeferredTiming({
        occurredAt,
        requestedFollowUp: addCalendarMonths(occurredAt, count),
        requestedNextAction: `Follow up in ${label} month${count === 1 ? "" : "s"}.`,
        requestedTiming: `${label}-month deferral`,
      });
    }
  }

  const namedMonthMatch = body.match(NAMED_MONTH_TIMING_RE);
  if (namedMonthMatch) {
    const qualifier = namedMonthMatch[1]?.toLowerCase() ?? null;
    const monthName = namedMonthMatch[2].toLowerCase();
    const explicitYear = namedMonthMatch[3] ? Number(namedMonthMatch[3]) : null;
    const month = MONTH_INDEX_BY_NAME[monthName];
    let year = explicitYear ?? occurredAt.getUTCFullYear();
    let followUp = firstOfUtcMonth(occurredAt, year, month);
    if (explicitYear !== null && followUp.getTime() <= occurredAt.getTime()) {
      return null;
    }
    if (explicitYear === null && followUp.getTime() <= occurredAt.getTime()) {
      year += 1;
      followUp = firstOfUtcMonth(occurredAt, year, month);
    }
    const displayMonth = `${monthName[0].toUpperCase()}${monthName.slice(1)}`;
    return boundedDeferredTiming({
      occurredAt,
      requestedFollowUp: followUp,
      requestedNextAction:
        explicitYear !== null
          ? `Follow up in ${displayMonth} ${explicitYear}.`
          : qualifier === "next"
            ? `Follow up next ${displayMonth}.`
            : `Follow up in ${displayMonth}.`,
      requestedTiming:
        explicitYear !== null
          ? `${displayMonth} ${explicitYear} timing`
          : `${displayMonth} timing`,
    });
  }

  if (/\blater this year\b/i.test(body)) {
    return boundedDeferredTiming({
      occurredAt,
      requestedFollowUp: addCalendarMonths(occurredAt, 3),
      requestedNextAction: "Follow up later this year.",
      requestedTiming: "later-this-year timing",
    });
  }
  if (/\bnext year\b/i.test(body)) {
    return boundedDeferredTiming({
      occurredAt,
      requestedFollowUp: addCalendarYears(occurredAt, 1),
      requestedNextAction: "Follow up next year.",
      requestedTiming: "next-year timing",
    });
  }
  if (/\b(?:next season|(?:not )?this season)\b/i.test(body)) {
    return boundedDeferredTiming({
      occurredAt,
      requestedFollowUp: addCalendarMonths(occurredAt, 6),
      requestedNextAction: "Follow up next season.",
      requestedTiming: "next-season timing",
    });
  }

  const seasonMatch = body.match(NAMED_SEASON_TIMING_RE);
  if (seasonMatch) {
    const qualifier = seasonMatch[1]?.toLowerCase() ?? null;
    const season = seasonMatch[2].toLowerCase();
    const month =
      season === "spring"
        ? 2
        : season === "summer"
          ? 5
          : season === "fall" || season === "autumn"
            ? 8
            : 11;
    let year = occurredAt.getUTCFullYear();
    let followUp = firstOfUtcMonth(occurredAt, year, month);
    if (followUp.getTime() <= occurredAt.getTime()) {
      if (qualifier === "this") return null;
      year += 1;
      followUp = firstOfUtcMonth(occurredAt, year, month);
    }
    return boundedDeferredTiming({
      occurredAt,
      requestedFollowUp: followUp,
      requestedNextAction:
        qualifier === "next"
          ? `Follow up next ${season}.`
          : `Follow up in ${season}.`,
      requestedTiming: `${season} timing`,
    });
  }

  const explicitYearMatch = body.match(EXPLICIT_YEAR_TIMING_RE);
  if (explicitYearMatch) {
    const year = Number(explicitYearMatch[1]);
    const followUp = firstOfUtcMonth(occurredAt, year, 0);
    if (followUp.getTime() <= occurredAt.getTime()) return null;
    return boundedDeferredTiming({
      occurredAt,
      requestedFollowUp: followUp,
      requestedNextAction: `Follow up in ${year}.`,
      requestedTiming: `${year} timing`,
    });
  }

  return null;
}

/**
 * Pure, newest-decisive-signal commercial outcome. Message text is treated as
 * untrusted evidence: only narrowly defined sales facts are extracted, and no
 * content is ever executed or used as an authorization identity.
 */
export function detectCommercialOutcome(input: {
  messages: CommercialOutcomeMessage[];
  now: Date;
}): CommercialOutcomeDecision {
  const messages = [...input.messages]
    .filter(
      (message) =>
        Boolean(message.providerMessageId.trim()) &&
        Number.isFinite(Date.parse(message.occurredAt))
    )
    .sort((a, b) => {
      const timeDelta = Date.parse(a.occurredAt) - Date.parse(b.occurredAt);
      if (timeDelta !== 0) return timeDelta;
      const aKey = a.evidenceKey ?? a.providerMessageId;
      const bKey = b.evidenceKey ?? b.providerMessageId;
      return aKey.localeCompare(bKey);
    });

  type EvaluatedMessage = {
    message: CommercialOutcomeMessage;
    signals: CommercialSignal[];
  };
  const evaluated: EvaluatedMessage[] = [];
  let priorCommerciallyCommitted = false;
  let stickyCustomerVeto: EvaluatedMessage | null = null;
  let decisivePositive: EvaluatedMessage | null = null;
  let unresolvedCustomerConflict = false;
  for (const message of messages) {
    const evaluation = messageSignals(message, priorCommerciallyCommitted);
    const { signals } = evaluation;
    const entry = { message, signals };
    evaluated.push(entry);
    if (evaluation.unresolvedConflict) {
      stickyCustomerVeto = null;
      decisivePositive = null;
      unresolvedCustomerConflict = true;
      priorCommerciallyCommitted = false;
      continue;
    }
    if (
      signals.includes("budget_timing_deferral") ||
      signals.includes("customer_declined")
    ) {
      stickyCustomerVeto = entry;
      unresolvedCustomerConflict = false;
      priorCommerciallyCommitted = false;
      continue;
    }
    if (signals.length === 0) continue;

    const canReopenCustomerVeto =
      (message.direction === "inbound" && message.authorRole === "customer") ||
      (stickyCustomerVeto?.signals.includes("budget_timing_deferral") ===
        true &&
        signals.includes("payment_confirmed"));
    if (stickyCustomerVeto && !canReopenCustomerVeto) continue;
    stickyCustomerVeto = null;
    unresolvedCustomerConflict = false;
    decisivePositive = entry;
    priorCommerciallyCommitted = true;
  }
  if (unresolvedCustomerConflict) return null;
  const decisive = stickyCustomerVeto ?? decisivePositive;
  if (!decisive) return null;

  // `provider_message_id` is mailbox-scoped, not globally unique. Keep the
  // exact evaluated entry so two connected mailboxes cannot collapse onto the
  // wrong decision boundary when a provider reuses an opaque message id.
  const decisiveIndex = evaluated.indexOf(decisive);
  const decisionEvidence = evaluated.slice(0, decisiveIndex + 1);
  // The decisive signal determines the outcome, but facts must reflect every
  // message evaluated through the durable high-water mark. A later price or
  // scope revision does not become "superseded" merely because it repeats no
  // acceptance keyword.
  const completeEvidence = evaluated;
  const observedSignals = [
    ...new Set(decisionEvidence.flatMap((entry) => entry.signals)),
  ] as CommercialSignal[];
  const deferred = decisive.signals.includes("budget_timing_deferral");
  const declined = decisive.signals.includes("customer_declined") && !deferred;
  const deferredTiming = deferred
    ? resolveDeferredTiming(
        decisive.message.body,
        new Date(decisive.message.occurredAt)
      )
    : null;
  if (deferred && !deferredTiming) return null;
  const signals = declined
    ? (["customer_declined"] as CommercialSignal[])
    : deferred
      ? (["budget_timing_deferral"] as CommercialSignal[])
      : observedSignals.filter(
          (signal) =>
            signal !== "budget_timing_deferral" &&
            signal !== "customer_declined"
        );
  const excludedScope = lastExcludedScopeBody(
    completeEvidence.map((entry) => entry.message)
  );
  const currentScope = currentScopeStatement(
    completeEvidence.map((entry) => entry.message),
    excludedScope
  );
  let guardedSchedule: string | null = null;
  for (const entry of [...completeEvidence].reverse()) {
    const body = cleanBody(entry.message.body);
    if (PRE_SALE_ACTIVITY_RE.test(body)) continue;
    if (entry.signals.includes("schedule_confirmed")) {
      guardedSchedule = body;
      break;
    }
    if (
      SCHEDULE_CHANGE_OR_CANCELLATION_RE.test(body) &&
      !CONFIRMED_RESCHEDULE_RE.test(body)
    ) {
      break;
    }
  }
  const schedule =
    deferred || declined
      ? null
      : (guardedSchedule ??
        lastScheduleFactBody(completeEvidence.map((entry) => entry.message)));
  const facts: CommercialFacts = {
    currentPrice: currentMoney(completeEvidence.map((entry) => entry.message)),
    currentScope,
    excludedScope,
    schedule,
    objection: deferred || declined ? decisive.message.body.trim() : null,
    nextAction: declined
      ? "Review the customer's cancellation and close or update the sales cycle."
      : deferred
        ? deferredTiming!.nextAction
        : signals.includes("payment_confirmed")
          ? "Convert or link the project and confirm the work schedule."
          : signals.includes("deposit_requested")
            ? "Send deposit or payment instructions and convert the accepted work to a project."
            : "Convert the accepted work to a project and confirm the schedule.",
  };
  const base = {
    confidence: "high" as const,
    decisiveEvidenceKey:
      decisive.message.evidenceKey ?? decisive.message.providerMessageId,
    decisiveMessageId: decisive.message.providerMessageId,
    decisiveDirection: decisive.message.direction,
    evidenceMessageIds: completeEvidence.map(
      (entry) => entry.message.providerMessageId
    ),
    decisiveSignals: decisive.signals,
    signals,
    facts,
  };
  if (declined) {
    return {
      ...base,
      outcome: "declined",
      reasonCode: "customer_declined",
      decisiveDirection: "inbound",
      followUpAt: null,
    };
  }
  if (deferred) {
    return {
      ...base,
      outcome: "deferred",
      reasonCode: "budget_timing",
      decisiveDirection: "inbound",
      followUpAt: deferredTiming!.followUpAt,
    };
  }
  return {
    ...base,
    outcome: "won",
    reasonCode: "customer_committed",
    followUpAt: null,
  };
}

function cleanBody(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function latestReplySegment(value: string): string {
  return (
    value
      .split(
        /\n\s*(?:On .{0,160}\bwrote:|Begin forwarded message:|[-]{2,}\s*Forwarded message\s*[-]{2,}|>+)/i
      )[0]
      ?.replace(/\s+/g, " ")
      .trim() ?? value
  );
}

export function detectTerminalStageFromMessages(
  messages: TerminalStageMessage[]
): TerminalStageDetection | null {
  let hasEstimateContext = false;

  for (const message of messages) {
    const body = cleanBody(message.body);
    if (!body) continue;

    if (ACCEPTED_DOCUMENT_RE.test(body)) {
      return { terminalFlag: "likely_won", stage: "won" };
    }

    if (CREW_SCHEDULING_RE.test(body) || WORK_START_RE.test(body)) {
      return { terminalFlag: "likely_won", stage: "won" };
    }

    if (message.direction === "outbound" && ESTIMATE_CONTEXT_RE.test(body)) {
      hasEstimateContext = true;
      continue;
    }

    const latestReply = latestReplySegment(message.body ?? "");
    if (
      message.direction === "inbound" &&
      ACCEPTANCE_RE.test(latestReply) &&
      !ESTIMATE_REQUEST_RE.test(latestReply) &&
      (hasEstimateContext || ESTIMATE_CONTEXT_RE.test(body))
    ) {
      return { terminalFlag: "likely_won", stage: "won" };
    }
  }

  return null;
}
