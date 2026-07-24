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
  /** Both values are required before one message may inherit thread context. */
  connectionId?: string;
  providerThreadId?: string;
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
const ESTIMATE_REQUEST_RE =
  /\b(?:send|provide|get|need|waiting for|looking for)\b.{0,30}\b(?:estimate|quote|proposal|pricing|price)\b|\b(?:estimate|quote|proposal|pricing|price)\b.{0,30}\b(?:please|when you can|would like|can you)\b/i;

const COMMERCIAL_ACCEPTANCE_RE =
  /\b(?:we|i)(?:(?:'|’)ve| have)?\s+(?:accept(?:ed)?|approve(?:d)?|would like to proceed|want to proceed|are ready to proceed)\b|\bwe(?:'|’)re\s+ready to proceed\b|\blet(?:'|’)s\s+proceed\b|\bplease\s+proceed\b|\bgo ahead\b|\btake you up on\b|\bready to move (?:ahead|forward)\b/i;
const GENERIC_ACCEPT_OR_APPROVE_RE =
  /\b(?:we|i)(?:(?:'|’)ve| have)?\s+(?:accept(?:ed)?|approve(?:d)?)\b/i;
const COMMERCIAL_DEAL_CONTEXT_RE =
  /\b(?:estimate|quote|proposal|offer|contract|pricing|price|cost|scope(?: of work)?|work|job|project|install(?:ation|ing)?|remov(?:al|e|ing)|supply|replace|repair|build|construct)\b|\$\s*\d/i;
const STANDALONE_GENERIC_ACCEPTANCE_RE =
  /^\s*(?:we|i)(?:(?:'|’)ve| have)?\s+(?:accept(?:ed)?|approve(?:d)?)[.!]?\s*$/i;
const UNAMBIGUOUS_ACCEPTANCE_ACTION_RE =
  /\b(?:please proceed|ready to proceed|would like to proceed|want to proceed|go ahead|take you up on|ready to move (?:ahead|forward)|book it|let'?s do it)\b/i;
const DIRECT_CUSTOMER_COMMITMENT_RE =
  /\b(?:we|i)(?:(?:'|’)ve| have)?\s+(?:would like to proceed|want to proceed|are ready to proceed|accept(?:ed)?\s+and\s+(?:are\s+)?ready to proceed)\b|\bwe(?:'|’)re\s+ready to proceed\b|\b(?:please\s+proceed|go ahead|take you up on|ready to move (?:ahead|forward)|book it|let(?:'|’)s (?:do it|proceed))\b/i;
const ADMINISTRATIVE_ACCEPTANCE_OBJECT_RE =
  /\b(?:accept(?:ed|ing)?|approv(?:e|ed|ing))\s+(?:(?:the|an?|your|this|our)\s+)?(?:calendar\s+)?(?:invitation|meeting|appointment|request|access|colou?r(?: selection)?|sample|date|time|payment method)\b/i;
const NON_AUTHORIZING_QUOTE_ACCEPTANCE_RE =
  /\b(?:quote|estimate|proposal)\b.{0,80}\b(?:for\s+(?:review|budgeting|discussion|comparison|reference)(?:\s+purposes?)?\s+only|as\s+(?:a\s+)?(?:starting point|basis)\s+for\s+negotiation|(?:was|is|has been)\s+(?:accepted|approved)\s+by\s+(?:(?:our|the)\s+)?(?:software|system|portal|app)|(?:was|is|has been)\s+(?:accepted|approved)\s+into\s+(?:(?:our|the)\s+)?(?:records|system|portal|app)|format\b.{0,40}\bnot\s+(?:the\s+)?work)\b|\baccept(?:ed|ing)?\s+that\b|\baccept(?:ed|ing)?\s+delivery\s+of\s+(?:the\s+|our\s+|your\s+)?(?:quote|estimate|proposal)\b|\bapprov(?:e|ed|ing)\s+(?:the\s+|our\s+|your\s+)?(?:quote|estimate|proposal)\s+(?:format|layout|template|wording)\b/i;
const NON_AUTHORIZING_INTERNAL_QUOTE_RE =
  /\b(?:quote|estimate|proposal)\b.{0,100}\b(?:for\s+(?:(?:internal|management)\s+)?(?:review|consideration|tender evaluation|filing|reference|discussion|budgeting|comparison)(?:\s+purposes?)?(?:\s+only)?|as\s+one\s+of\s+(?:\w+\s+){0,2}options?\b|to\s+compare\b|(?:accepted|approved)\b.{0,30}\bby\s+(?:(?:our|the)\s+)?(?:spam filter|software|system|portal|app)|(?:accepted|approved)\b.{0,30}\binto\s+(?:(?:our|the)\s+)?(?:document\s+)?(?:records|system|portal|app)|(?:price|amount)\b.{0,40}\bnot\s+yet\s+(?:the\s+)?(?:project|work|job|scope))\b|\b(?:accept|accepted|approve|approved)\s+(?:the\s+)?quoted\s+(?:amount|price)\b.{0,50}\b(?:but|and)\s+not\s+(?:the\s+)?(?:scope|work|project|job)\b/i;
const NON_AUTHORIZING_PARTIAL_APPROVAL_RE =
  /\b(?:accept\w*|approv\w*)\b.{0,80}\b(?:budget|price|cost|amount|materials?)\b.{0,100}\b(?:but|however|yet)\b.{0,60}\b(?:not|still\s+need|need\s+to|pending)\b.{0,50}\b(?:quote|estimate|proposal|work|project|job|installation|scope)\b|\b(?:quote|estimate|proposal)\b.{0,80}\b(?:accept\w*|approv\w*)\b.{0,50}\bfor\s+(?:insurance|grant)(?:\s+purposes?)?\b/i;
const REPORTED_THIRD_PARTY_INTENT_RE =
  /\b(?:my|our|his|her|their)\s+(?:neighbou?r|designer|architect|friend|customer|client|boss|manager|spouse|husband|wife|colleague|tenant|strata)\s+(?:said|says|asked|asks|told|wants?|plans?|accept(?:ed|s)?|approv(?:ed|es)?)\b|\bthe\s+(?:other\s+)?(?:customer|client|person|owner|tenant|strata)\s+(?:said|says|asked|asks|wants?|plans?)\b|\b(?:i am|i['’]m|we are|we['’]re)\s+asking\s+for\s+(?:my|our|his|her|their|the)\b/i;
const REPORTED_NAMED_THIRD_PARTY_INTENT_RE =
  /\b[A-Z][A-Za-z.'’-]{2,40}\s+(?:said|says|asked|asks|told|wants?|plans?)\b/;
const ADDITIONAL_COMMERCIAL_ACCEPTANCE_RE =
  /\bsounds good\b.{0,30}\b(?:let'?s do it|go ahead|proceed|book it)\b|\b(?:book it|let'?s do it)\b|\b(?:that|the|your)\s+(?:quote|estimate|proposal)\s+(?:works for us|sounds good|looks good)\b/i;
const EXPLICIT_DOCUMENT_ACCEPTANCE_RE =
  /\b(?:accepted|approved)\s+(?:the|your|this)?\s*(?:estimate|quote|proposal|contract)\b|\b(?:estimate|quote|proposal|contract)\s+(?:is|was|has been)\s+(?:accepted|approved)\b/i;
const PREQUOTE_PROCEED_RE =
  /\b(?:proceed|go ahead|move (?:ahead|forward))\b.{0,100}\b(?:with\s+)?(?:creat(?:e|ing)|get(?:ting)?|obtain(?:ing)?|receiv(?:e|ing)|prepar(?:e|ing)|send(?:ing)?|provid(?:e|ing))\s+(?:a\s+|the\s+|your\s+)?(?:quote|estimate|proposal|pricing)\b|\b(?:proceed|go ahead|move (?:ahead|forward))\s+with\s+(?:an?\s+)(?:quote|estimate|proposal)\b/i;
const ANAPHORIC_ACCEPTANCE_RE =
  /^(?:(?:sounds (?:good|great)[,;]?\s*)?(?:please\s+proceed|go ahead|let(?:'|’)s (?:do it|proceed)|book it)|(?:we|i)(?:\s+are|(?:'|’)re)?\s+ready to proceed|ready to move (?:ahead|forward))[.!]?\s*$/i;
const STANDALONE_POSITIVE_ACKNOWLEDGEMENT_RE =
  /^(?:sounds (?:good|great)|looks good|works for us)[.!]?\s*$/i;
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
const SCHEDULE_DATE_ANCHOR_TEXT =
  "(?:tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next\\s+week|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:\\s*,?\\s*\\d{4})?|\\d{1,2}(?:st|nd|rd|th)|\\d{1,2}[-/]\\d{1,2}(?:[-/]\\d{2,4})?|\\d{4}[-/]\\d{1,2}[-/]\\d{1,2})";
const SCHEDULE_CONFIRMED_RE = new RegExp(
  `\\b(?:confirmed|booked|scheduled)\\b.{0,100}\\b${SCHEDULE_DATE_ANCHOR_TEXT}\\b|\\b${SCHEDULE_DATE_ANCHOR_TEXT}\\b.{0,80}\\b(?:is good|works?|confirmed|booked|scheduled|start)\\b`,
  "i"
);
const COMMITTED_EXECUTION_DETAIL_INQUIRY_RE = new RegExp(
  `\\b(?:what\\s+time|when)\\s+(?:will|does)\\s+(?:your|the)\\s+crew\\s+(?:arrive|come|be\\s+(?:there|on[ -]?site))\\s+(?:on\\s+)?${SCHEDULE_DATE_ANCHOR_TEXT}\\b\\s*\\?`,
  "i"
);
const BARE_SCHEDULE_CONFIRMATION_RE =
  /^(?:(?:hi|hello|hey)\s+[a-z][a-z .'-]{0,50},?\s*)?(?:booked|scheduled|confirmed)[.!]?\s*$/i;
const DECLARATIVE_EXECUTION_SCHEDULE_RE = new RegExp(
  `\\b(?:installation|work|job|project|crew)\\s+(?:(?:will\\s+)?(?:starts?|begins?|arrives?|comes?)|(?:is|are)\\s+(?:starting|beginning|arriving|coming))\\s+(?:on\\s+)?(?:the\\s+)?${SCHEDULE_DATE_ANCHOR_TEXT}\\b|\\bwe\\s+(?:(?:will\\s+)?(?:start|begin)|(?:are|['’]re)\\s+(?:starting|beginning))\\s+(?:the\\s+)?(?:installation|work|job|project)\\s+(?:on\\s+)?(?:the\\s+)?${SCHEDULE_DATE_ANCHOR_TEXT}\\b`,
  "i"
);
const ALTERNATE_EXECUTION_SCHEDULE_RE = new RegExp(
  `\\b(?:installation|crew|work|repair|replacement|removal|build|delivery|pickup)\\s+(?:is|are)\\s+(?:set|locked\\s+in|slated)\\s+for\\s+${SCHEDULE_DATE_ANCHOR_TEXT}\\b|\\bwe\\s+(?:are|['’]re)\\s+on\\s+for\\s+${SCHEDULE_DATE_ANCHOR_TEXT}\\b.{0,80}\\b(?:installation|repair|replacement|removal|work|job|project)\\b|\\b(?:installation|repair|replacement|removal|work|job|project)\\s+goes?\\s+ahead\\s+${SCHEDULE_DATE_ANCHOR_TEXT}\\b|\\b(?:your\\s+)?install(?:ation)?\\s+date\\s+is\\s+${SCHEDULE_DATE_ANCHOR_TEXT}\\b|\\bwe\\s+have\\s+you\\s+down\\s+for\\s+(?:installation|repair|replacement|removal|work)\\s+${SCHEDULE_DATE_ANCHOR_TEXT}\\b`,
  "i"
);
const SCHEDULE_FACT_RE = new RegExp(
  `\\b(?:confirmed|booked|scheduled|availability|start date|week of|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)|${SCHEDULE_DATE_ANCHOR_TEXT})\\b`,
  "i"
);
const SCHEDULE_FACT_CONTEXT_RE =
  /\b(?:need(?:ed)?\s+(?:it|them|this|the work)?\s*until|start(?:ing)?(?:\s+us)?|week of|on for|schedule|book(?:ed|ing)?|availability|available|installation|crew|work date|project date|deadline|timeline|pickup|delivery|ready (?:by|for))\b/i;
const SEE_YOU_EXECUTION_SCHEDULE_RE = new RegExp(
  `\\bsee you\\s+(?:on\\s+)?${SCHEDULE_DATE_ANCHOR_TEXT}\\b`,
  "i"
);
const CONDITIONAL_PAYMENT_RE =
  /\b(?:if|once|when|after|upon|pending|will be|would be|can be|could be)\b.{0,80}\b(?:paid|sent|received|confirmed|deposit|payment)\b|\b(?:will|would|can|could|going to|plan(?:ning)? to|intend(?:ing)? to)\b.{0,80}\b(?:pay|send|have|make|get)\b.{0,60}\b(?:paid|sent|received|confirmed|deposit|payment)\b|\b(?:deposit|payment)\b.{0,100}\b(?:will|would|can|could|going to|plan(?:ning)? to|intend(?:ing)? to)\b.{0,60}\b(?:pay|send|have|make|get|paid|sent)\b/i;
const CONDITIONAL_SCHEDULE_RE =
  /\b(?:if|once|when|after|pending|tentative|proposed|available|availability|can be|could be|would be|may be|might be)\b.{0,80}\b(?:confirmed|booked|scheduled|start|begin|arrive|install(?:ation)?)\b|\b(?:confirmed|booked|scheduled|start(?:s|ing)?|begin(?:s|ning)?|arriv(?:e|es|ing))\b.{0,80}\b(?:if|unless|pending|tentative|subject to|assuming)\b/i;
const NEGATED_SCHEDULE_RE =
  /\b(?:not|never|cannot|can'?t|unable to|hasn'?t|haven'?t|has not|have not)\b.{0,60}\b(?:confirmed|booked|scheduled|start(?:ing)?)\b|\b(?:isn['’]?t|aren['’]?t|wasn['’]?t|weren['’]?t)\s+(?:confirmed|booked|scheduled)\b|\b(?:is|are|was|were)\s+(?:no longer|not)\s+(?:confirmed|booked|scheduled)\b|\bno\s+(?:(?:installation|crew|work|job|project|start|date|day)\s+)?(?:is\s+)?(?:confirmed|booked|scheduled|start(?:ing)?)\b|\bnothing(?:\s+is)?\s+(?:confirmed|booked|scheduled|start(?:ing)?)\b/i;
const EXECUTION_SCHEDULE_CONTEXT_RE =
  /\b(?:install(?:ation|ing)?|repair(?:ed|ing|s)?|replac(?:e|ed|ement|ing)|remov(?:e|ed|al|ing)|build(?:ing|s)?|construct(?:ed|ing|ion)?|suppl(?:y|ied|ies|ying)|crew|on[ -]?site|start(?:ing)?|deliver(?:y|ing)?|pickup|fabricat(?:e|ion|ing))\b|\b(?:the|this|our|your|their)\s+(?:work|job|project)\s+(?:(?:is|was|has been|had been|will be)\s+)?(?:scheduled|booked|confirmed|start(?:s|ing)?|begin(?:s|ning)?)\b|\b(?:work|job|project)\s+(?:starts?|begins?|is\s+(?:starting|beginning))\b/i;
const PRE_SALE_ACTIVITY_RE =
  /\b(?:consultation|measur(?:e|es|ed|ing|ement|ements)|walk[ -]?through|site[ -]?visit|inspection)\b|\b(?:estimate|quote|proposal|sales)\b.{0,60}\b(?:appointment|meeting|visit|call|review)\b|\b(?:appointment|meeting|visit|call|review)\b.{0,60}\b(?:estimate|quote|proposal|sales)\b/i;
const QUOTE_DELIVERY_TIMING_RE =
  /\b(?:quote|estimate|proposal)\b.{0,100}\b(?:in(?:to)? (?:your|the) inbox|by e-?mail|e-?mailed|send|sent|deliver(?:ed|y)?|receiv(?:e|ed)|arriv(?:e|ed))\b|\b(?:send|sent|deliver(?:ed|y)?|receiv(?:e|ed)|arriv(?:e|ed)|in(?:to)? (?:your|the) inbox|by e-?mail)\b.{0,100}\b(?:quote|estimate|proposal)\b/i;
const NON_EXECUTION_SCHEDULE_RE =
  /\b(?:quote|estimate|proposal)\b.{0,100}\b(?:valid(?:ity)?|expires?|expiry|good (?:through|until)|in(?:to)? (?:your|the) inbox|by e-?mail|e-?mailed|send|sent|deliver(?:ed|y)?|receiv(?:e|ed)|arriv(?:e|ed))\b|\b(?:valid(?:ity)?|expires?|expiry|good (?:through|until)|send|sent|deliver(?:ed|y)?|receiv(?:e|ed)|arriv(?:e|ed)|in(?:to)? (?:your|the) inbox|by e-?mail)\b.{0,100}\b(?:quote|estimate|proposal)\b|\b(?:repair|install(?:ation)?|removal|replacement)?\s*(?:quote|estimate|proposal)\s+(?:(?:is|was|has been|will be)\s+)?(?:booked|scheduled|confirmed)\b|\b(?:deposit|payment)\s+(?:(?:is|was|has been|will be)\s+)?(?:booked|scheduled)\b|\b(?:offer|promotion|promo|discount|coupon)\b.{0,80}\b(?:valid|expires?|expiry|until|through)\b|\b(?:business|office|studio|shop|holiday)\b.{0,60}\b(?:hours?|clos(?:e|ed|ure))\b|\b(?:hours?|clos(?:e|ed|ure))\b.{0,60}\b(?:business|office|studio|shop|holiday)\b|\b(?:call|meeting|appointment|interview|photoshoot|photo shoot|work order|work permit|material sample|sample delivery|invoice|report|e-?mail|status update|contract signing|design review|colou?r selection|materials? order|shop drawings?|warranty registration|insurance paperwork)\b.{0,60}\b(?:booked|scheduled|confirmed|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b(?:booked|scheduled|confirmed|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.{0,60}\b(?:call|meeting|appointment|interview|photoshoot|photo shoot|work order|work permit|material sample|sample delivery|invoice|report|e-?mail|status update|contract signing|design review|colou?r selection|materials? order|shop drawings?|warranty registration|insurance paperwork)\b/i;
const SCHEDULE_CHANGE_OR_CANCELLATION_RE =
  /\b(?:cancel(?:led|ed|ing)?|postpon(?:e|ed|ing)|reschedul(?:e|ed|ing)|delay(?:ed|ing)?)\b/i;
const CONFIRMED_RESCHEDULE_RE = new RegExp(
  `\\brescheduled\\b.{0,80}\\b(?:for|to)\\b.{0,20}\\b${SCHEDULE_DATE_ANCHOR_TEXT}\\b`,
  "i"
);
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
const ADMINISTRATIVE_DEFERRAL_OBJECT_RE =
  /\b(?:meeting|call|site[ -]?visit|consultation|measurement(?: appointment)?|appointment)\b/i;
const RESOLVED_OR_ADMINISTRATIVE_DEFERRAL_RE =
  /\b(?:done|finished)\s+(?:with\s+)?(?:delay|postpon|deferr|paus|wait|hold)\w*\b|\b(?:delay|deferral|postponement)\b.{0,50}\b(?:is|was|has been|had been)\s+(?:resolved|cleared|finished|over)\b|\b(?:budget|funds?)\b.{0,50}\b(?:approved|available|restored)\b.{0,50}\bafter\s+(?:the\s+)?(?:delay|deferral|postponement)\b|\b(?:delay|postpone|defer|hold off)\w*\s+(?:the\s+)?(?:billing|invoice|payment|deposit)\b/i;
const CUSTOMER_DECLINE_RE =
  /\b(?:cancel(?:led|ed|ing)?(?: the| this| our)? (?:job|project|work|installation)|cancel(?:led|ed)? (?:it|this) (?:entirely|altogether)|do not proceed|don'?t proceed|decid(?:e|ed) not to (?:proceed|move forward)|not moving forward|hired someone else|going with someone else|declin(?:e|ed)(?: the)? (?:quote|estimate|proposal|work|job|project|installation)|no longer (?:want|need) (?:the|this)? ?(?:work|job|project|installation))\b/gi;
const COMMERCIAL_REVERSAL_ACTION_RE =
  /\b(?:cancel(?:l?ed|l?ing)?|withdraw(?:n|ing)?|reject(?:ed|ing|ion)?|stop(?:ping)?)\b.{0,60}\b(?:quote|estimate|proposal|work|job|project|installation)\b|\b(?:quote|estimate|proposal|work|job|project|installation)\b.{0,40}\b(?:cancell?ation|withdrawal|rejection)\b|\bclose\s+(?:the\s+)?project\b.{0,40}\bwithout\s+starting\b/gi;
const RETRACTED_ACCEPTANCE_RE =
  /\b(?:accept(?:ed)?|approv(?:e|ed)|said\s+go ahead|quote was accepted)\b.{0,160}\b(?:changed (?:my|our) minds?|cancel(?:l?ed|l?ing)?\s+(?:it|this)|by mistake|accidentally|disregard|ignore (?:that|the)?\s*acceptance|want to withdraw|stop (?:the )?(?:work|job|project|installation))\b/gi;
const CONTEXTUAL_CUSTOMER_DECLINE_RE =
  /\b(?:(?:please\s+)?cancel\s+(?:it|this)(?:\s*,?\s*please)?|(?:we|i)\s+no longer (?:want|need) (?:it|this))(?=\s*(?:[.!?]|$))/gi;
const ROUTINE_RESCHEDULE_RE = new RegExp(
  `\\bcancel\\w*\\b[\\s\\S]{0,180}\\b(?:(?:move|reschedul|switch|change|book)\\w*[\\s\\S]{0,60}\\b${SCHEDULE_DATE_ANCHOR_TEXT}\\b|(?:need|want|prefer)\\s+(?:the\\s+)?${SCHEDULE_DATE_ANCHOR_TEXT}\\b[\\s\\S]{0,30}\\binstead\\b|${SCHEDULE_DATE_ANCHOR_TEXT}\\b[\\s\\S]{0,20}\\bworks?\\b|still\\s+(?:proceeding|moving forward)|(?:project|work|job|installation)\\s+should\\s+proceed)`,
  "i"
);
const NEGATED_DECLINE_PREFIX_RE =
  /(?:\b(?:have|has|had|are|is|was|were|do|does|did|will|would|can|could)\s+not|\b(?:haven|hasn|hadn|aren|isn|wasn|weren|don|doesn|didn|won|wouldn|can|couldn)['’]t|\bnever|\bnothing\s+(?:is|was|has been|had been))(?:\s+\w+){0,2}\s*$/i;
const HYPOTHETICAL_DECLINE_PREFIX_RE =
  /\b(?:if|unless|in case|depending on|may|might|could|should|would)\b[\s\S]*$/i;
const DIRECT_DECLINE_REQUEST_RE =
  /\b(?:please|can you|could you|would you|can we|could we|would we|would it be possible to|we need to|we have to|we must|we would like to|i would like to|would like to)\s+(?:cancel|decline|stop)\b/i;
const ADMINISTRATIVE_CANCELLATION_RE =
  /\b(?:cancel(?:led|ed|ing)?|declin(?:e|ed|ing))\s+(?:(?:the|this|our|my|your)\s+)?(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:['’]s)?\s+)?(?:calendar invitation|site[ -]?visit|consultation(?: appointment)?|measurement(?: appointment)?|estimate appointment|appointment|meeting|installation date|start date|work date|project date|date|day|time|slot|payment method|payment authorization|payment authentication|card)\b|\b(?:calendar invitation|site[ -]?visit|consultation(?: appointment)?|measurement(?: appointment)?|estimate appointment|appointment|meeting|installation date|start date|work date|project date|date|day|time|slot|payment method|payment authorization|payment authentication|card)\b.{0,40}\b(?:(?:was|is|has been|had been)\s+)?(?:cancel(?:led|ed|ing)?|declin(?:e|ed|ing))\b/i;
const ADMINISTRATIVE_DECLINE_OBJECT_RE =
  /\b(?:not moving forward|decid(?:e|ed) not to (?:proceed|move forward))\b.{0,80}\b(?:site[ -]?visit|consultation|meeting|call|measurement(?: appointment)?|appointment)\b/i;
const NON_DEAL_ACCEPTANCE_OBJECT_RE =
  /\baccept(?:ed|ing)?\s+(?:(?:your|the|an?)\s+)?(?:invitation|request)\s+to\s+(?:quote|bid|tender)\b|\baccept(?:ed|ing)?\s+(?:(?:your|the|an?)\s+)?(?:rfq|invitation to tender)\b/i;
const ADMINISTRATIVE_PROCEED_OBJECT_RE =
  /\b(?:ready to proceed|go ahead|please proceed|let(?:'|’)s proceed|proceed)\b.{0,100}\b(?:site[ -]?visit|measurement(?: appointment)?|consultation|meeting|call|quote (?:review|request|process|cancell?ation|rejection)|estimate (?:review|request|process|cancell?ation|rejection)|proposal (?:review|request|process|withdrawal|rejection)|invoice|payment reminder|deposit invoice|payment link|deposit details?|material sample|colou?r selection|appointment date|drawing review|refund(?:ing)?|revers(?:e|ing|al)|chargeback|cancel(?:l?ing)? (?:the )?(?:deposit|payment|quote|estimate|proposal|project|work|job|installation)|withdraw(?:ing)? (?:the )?(?:quote|estimate|proposal)|close (?:the )?project)\b/i;
const COMMERCIAL_PROCEED_OBJECT_RE =
  /\b(?:go ahead|proceed)\s+with\s+(?:(?:the|this|our|your)\s+)?(?:accepted\s+)?(?:quote|estimate|proposal|contract|work|job|project|installation|railing|deck|fence|repair|replacement|removal|build|construction)\b/i;
const NON_AUTHORITATIVE_ACCEPTANCE_RE =
  /\b(?:i|we)\s+(?:thought|think|believed?|heard)\b.{0,100}\b(?:accept(?:ed|ing)?|approv(?:e|ed|ing)|go ahead|proceed)\b|\b(?:almost|nearly|maybe|perhaps)\b.{0,80}\b(?:accept(?:ed|ing)?|approv(?:e|ed|ing)|go ahead|proceed)\b|\b(?:may|might|should|plan(?:ned)?\s+to|are planning to|were planning to)\s+(?:accept|approve|go ahead|proceed)\b|\b(?:were|was)\s+(?:asked|told|advised)\s+to\s+(?:accept|approve|go ahead|proceed)\b|\b(?:recommended|suggested)\b.{0,60}\b(?:accept|approve|go ahead|proceed)\b/i;
const NON_AUTHORITATIVE_DEFERRAL_RE =
  /\b(?:maybe|perhaps|almost|nearly)\b.{0,80}\b(?:delay|postpon|deferr|paus|revisit|wait|hold(?:ing)? off|put(?:ting)? (?:this|it) off)\w*\b|\b(?:considering|considered|thinking about)\b.{0,60}\b(?:delay|postpon|deferr|paus|revisit|wait|holding off|putting (?:this|it) off)\w*\b|\b(?:i|we)\s+(?:thought|think|believed?)\b.{0,100}\b(?:delay|postpon|deferr|paus|revisit|wait|hold off)\w*\b|\b(?:were|was)\s+(?:told|advised)\s+to\s+(?:delay|postpone|defer|pause|revisit|wait|hold off)\b|\b(?:recommended|suggested)\b.{0,60}\b(?:delay|postpon|deferr|paus|revisit|wait|hold off)\w*\b|\bshould\s+(?:delay|postpone|defer|pause|revisit|wait|hold off)\b/i;
const EXPLICIT_ANTI_DEFERRAL_RE =
  /\b(?:can(?:not|['’]t)|could(?:\s+not|n['’]t))\s+afford\s+to\s+(?:delay|postpone|defer|pause|wait|hold off|put (?:this|it) off)\b|\b(?:was|were|am|is|are)\s+unable\s+to\s+(?:delay|postpone|defer|pause|wait|hold off|put (?:this|it) off)\b|\b(?:need|want|plan|decid(?:e|ed))\s+to\s+avoid\s+(?:delay|postpon|deferr|paus|wait|hold)\w*\b|\bdecid(?:e|ed)\s+against\s+(?:delay|postpon|deferr|paus|wait|hold)\w*\b|\b(?:delay|postpon|deferr|paus|wait|hold)\w*\b.{0,50}\b(?:is|are|was|were)\s+(?:not|never)\s+(?:an?\s+)?(?:option|possibility|plan)\b/i;
const NON_AUTHORITATIVE_DECLINE_RE =
  /\b(?:maybe|perhaps|almost|nearly)\b.{0,80}\b(?:cancel\w*|declin\w*|reject\w*|stop\w*|hir(?:e|ed|ing) someone else)\b|\b(?:considering|considered|thinking about)\b.{0,60}\b(?:cancel\w*|declin\w*|reject\w*|stop\w*|hir(?:e|ing) someone else)\b|\b(?:i|we)\s+(?:thought|think|believed?)\b.{0,100}\b(?:cancel\w*|declin\w*|reject\w*|stop\w*|hired someone else)\b|\b(?:were|was)\s+(?:told|advised)\s+to\s+(?:cancel|decline|reject|stop)\b|\b(?:recommended|suggested)\b.{0,60}\b(?:cancel\w*|declin\w*|reject\w*|stop\w*)\b|\bshould\s+(?:cancel|decline|reject|stop)\b/i;
const NON_AUTHORITATIVE_PAYMENT_RE =
  /\b(?:i|we)\s+(?:thought|think|heard|were told|was told)\b.{0,100}\b(?:deposit|payment)\b.{0,60}\b(?:paid|sent|received|confirmed)\b|\b(?:hopefully|apparently|reportedly)\b.{0,100}\b(?:deposit|payment)\b.{0,60}\b(?:paid|sent|received|confirmed)\b|\b(?:bank|neighbou?r|accountant|friend|spouse|husband|wife)\b.{0,60}\b(?:said|says|told|reported)\b.{0,80}\b(?:deposit|payment)\b|\b(?:deposit|payment)\b.{0,80}\b(?:according to|per)\s+(?:my|our|the)?\s*(?:bank|neighbou?r|accountant|friend|spouse|husband|wife)\b/i;
const NON_AUTHORITATIVE_DEPOSIT_REQUEST_RE =
  /\b(?:i|we)\s+(?:thought|think)\b.{0,100}\b(?:ask|send|provide|share)\w*\b.{0,80}\b(?:deposit|payment)\b|\b(?:were|was)\s+told\s+to\s+ask\b.{0,80}\b(?:deposit|payment)\b|\b(?:maybe|perhaps|may|might|almost|considering)\b.{0,80}\b(?:ask|send|provide|share)\w*\b.{0,80}\b(?:deposit|payment)\b|\b(?:bank|accountant|neighbou?r|friend)\b.{0,60}\b(?:asked|asks|wants?|wanted)\b.{0,80}\b(?:deposit|payment)\b/i;
const NON_AUTHORITATIVE_SCHEDULE_RE =
  /\b(?:should|could|may|might|will)\s+(?:(?:have|had)\s+been\s+|get\s+|be\s+)?(?:scheduled|booked|confirmed)\b|\b(?:was|is|are|were)\s+(?:supposed|expected|planned)\s+to\s+be\s+(?:scheduled|booked|confirmed)\b|\b(?:hopefully|apparently|reportedly|likely|probably)\b.{0,80}\b(?:scheduled|booked|confirmed)\b|\b(?:i|we)\s+(?:thought|think|believed?)\b.{0,100}\b(?:scheduled|booked|confirmed)\b/i;
const NON_ASSERTIVE_EPISTEMIC_PREFIX_RE =
  /\b(?:(?:i|we)\s+(?:assume|understand|believe|think|thought|heard|guess|suppose)|it\s+(?:seems?|appears?)|apparently|reportedly|allegedly|supposedly|perhaps|maybe)\b[\s\S]*$/i;
const NON_ASSERTIVE_VERIFICATION_PREFIX_RE =
  /\b(?:there\s+(?:is|was)|we\s+(?:have|had)|i\s+(?:have|had))\s+no\s+(?:confirmation|proof|evidence)\b[\s\S]*$|\bno\s+(?:one|body)\s+(?:confirmed|verified|proved)\b[\s\S]*$|\b(?:still\s+)?waiting\s+(?:to\s+hear|to\s+learn|to\s+find\s+out|for\s+(?:confirmation|proof|evidence))\b[\s\S]*$|\b(?:i|we)\s+(?:need|want)\s+(?:confirmation|proof|evidence)\b[\s\S]*$|\b(?:need|want)\s+to\s+(?:confirm|check|verify)\s+whether\b[\s\S]*$|\b(?:i|we)\s+(?:do\s+not|don['’]t|cannot|can['’]t)\s+know\b[\s\S]*$|\b(?:it\s+(?:is|was)\s+)?(?:unclear|unknown|not\s+clear|not\s+certain)|\b(?:i|we)(?:\s+am|\s+are|['’]m|['’]re)?\s+not\s+sure\b[\s\S]*$|\b(?:the\s+)?question\s+(?:is|was)\s+whether\b[\s\S]*$/i;
const NON_ASSERTIVE_REPORTED_PREFIX_RE =
  /\b(?:(?:the\s+)?(?:e-?mail|message|thread|note|sender|customer|client|owner|bank|accountant|neighbou?r|friend|spouse|husband|wife)|someone|somebody)\s+(?:said|says|claimed|claims|reported|reports|suggested|suggests|indicated|indicates|mentioned|mentions|told)\b[\s\S]*$/i;
const NON_ASSERTIVE_NAMED_REPORT_PREFIX_RE =
  /\b[A-Z][A-Za-z.'’-]{2,40}\s+(?:said|says|claimed|claims|reported|reports|suggested|suggests|indicated|indicates|mentioned|mentions|told)\b[\s\S]*$/;
const NON_ASSERTIVE_EXAMPLE_PREFIX_RE =
  /\b(?:for example|example(?: only)?|sample(?: text| message| reply)?|template(?: text| message| reply)?|hypothetical(?:ly)?|suppose|imagine)\b[\s\S]*$/i;
const NON_ASSERTIVE_ARTIFACT_PREFIX_RE =
  /\b(?:example(?:\s+only)?|sample(?:\s+only)?|draft(?:\s+wording)?|placeholder|template)\b[\s\S]*$|\b(?:(?:the|an?|our)\s+)?(?:invoice|permit|calendar|system|software|portal|app|spam filter|notice|e-?mail|message|document)(?:\s+(?:says|states|shows|reads|claims|reports|marked|flagged|contains|includes))?\b[\s\S]*$|\b(?:words?|phrase|text|wording)\b[\s\S]*$/i;
const NON_ASSERTIVE_ARTIFACT_SUFFIX_RE =
  /^\s*(?:as\s+(?:an?\s+)?example(?:\s+only)?|example(?:\s+only)?|is\s+example\s+text|in\s+(?:the\s+|a\s+)?(?:sample\s+quote|planning\s+document)|according\s+to\s+(?:the\s+|a\s+)?draft(?:\s+schedule)?|sample(?:\s+only)?|notice|confirmation|flag|e-?mail|question|paperwork|form|screenshot|e-?mail\s+template|template|draft|placeholder)\b/i;
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
const ACTION_ONLY_ARTIFACT_REQUEST_RE =
  /^\s*(?:(?:please)\s+|(?:can|could|would|will)\s+(?:you|we)\s+)(?:send|share|provide|attach|confirm)\b.{0,120}\b(?:pictures?|photos?|dimensions?|measurements?|drawings?|quotes?|estimates?|proposals?)\b/i;
const COMMERCIAL_SCOPE_ACTION_RE =
  /\b(?:install|remove|replace|repair|build|construct|supply)\w*\b/i;

export function isActionOnlyCommercialArtifactRequest(value: string): boolean {
  return (
    ACTION_ONLY_ARTIFACT_REQUEST_RE.test(value) &&
    !COMMERCIAL_SCOPE_ACTION_RE.test(value)
  );
}

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

function sentenceAroundMatch(
  body: string,
  index: number,
  length: number
): string {
  let start = 0;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (/[.!?\n]/.test(body[cursor] ?? "")) {
      start = cursor + 1;
      break;
    }
  }
  let end = body.length;
  for (let cursor = index + length; cursor < body.length; cursor += 1) {
    if (/[.!?\n]/.test(body[cursor] ?? "")) {
      end = cursor + 1;
      break;
    }
  }
  return body.slice(start, end).trim();
}

function isNonAssertedClaim(body: string, patterns: RegExp[]): boolean {
  const claim = patterns
    .map((pattern) =>
      new RegExp(pattern.source, pattern.flags.replace("g", "")).exec(body)
    )
    .filter((match): match is RegExpExecArray => match !== null)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))[0];
  if (!claim) return false;
  const prefix = body.slice(0, claim.index ?? 0);
  const prefixThroughClaim = body.slice(
    0,
    (claim.index ?? 0) + claim[0].length
  );
  const suffix = body.slice((claim.index ?? 0) + claim[0].length);
  return (
    NON_ASSERTIVE_EPISTEMIC_PREFIX_RE.test(prefix) ||
    NON_ASSERTIVE_VERIFICATION_PREFIX_RE.test(prefixThroughClaim) ||
    NON_ASSERTIVE_REPORTED_PREFIX_RE.test(prefix) ||
    NON_ASSERTIVE_NAMED_REPORT_PREFIX_RE.test(prefix) ||
    NON_ASSERTIVE_EXAMPLE_PREFIX_RE.test(prefix) ||
    NON_ASSERTIVE_ARTIFACT_PREFIX_RE.test(prefix) ||
    NON_ASSERTIVE_ARTIFACT_SUFFIX_RE.test(suffix)
  );
}

function hasDeferralAction(body: string): boolean {
  if (
    EXPLICIT_ANTI_DEFERRAL_RE.test(body) ||
    RESOLVED_OR_ADMINISTRATIVE_DEFERRAL_RE.test(body)
  ) {
    return false;
  }
  for (const match of body.matchAll(DEFERRAL_ACTION_VERB_RE)) {
    const matchIndex = match.index ?? 0;
    const clause = clauseAroundMatch(body, matchIndex, match[0].length);
    const clauseMatchIndex = clause
      .toLowerCase()
      .indexOf(match[0].toLowerCase());
    const prefix = clause.slice(0, Math.max(0, clauseMatchIndex));
    if (NEGATED_DEFERRAL_ACTION_PREFIX_RE.test(prefix)) continue;
    if (DIRECT_DEFERRAL_REQUEST_RE.test(clause)) return true;
    if (NON_ASSERTIVE_VERIFICATION_PREFIX_RE.test(clause)) continue;
    if (NON_AUTHORITATIVE_DEFERRAL_RE.test(clause)) continue;
    if (isNonAssertedClaim(clause, [DEFERRAL_ACTION_VERB_RE])) continue;
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

function hasCustomerDecline(
  body: string,
  priorCommerciallyCommitted: boolean
): boolean {
  const patterns = priorCommerciallyCommitted
    ? [
        CUSTOMER_DECLINE_RE,
        COMMERCIAL_REVERSAL_ACTION_RE,
        RETRACTED_ACCEPTANCE_RE,
        CONTEXTUAL_CUSTOMER_DECLINE_RE,
      ]
    : [
        CUSTOMER_DECLINE_RE,
        COMMERCIAL_REVERSAL_ACTION_RE,
        RETRACTED_ACCEPTANCE_RE,
      ];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of body.matchAll(pattern)) {
      const matchIndex = match.index ?? 0;
      const clause = clauseAroundMatch(body, matchIndex, match[0].length);
      const sentence = sentenceAroundMatch(body, matchIndex, match[0].length);
      const clauseMatchIndex = clause
        .toLowerCase()
        .indexOf(match[0].toLowerCase());
      const prefix = clause.slice(0, Math.max(0, clauseMatchIndex));
      if (
        /^\s*(?:please\s+)?(?:cancel|declin)/i.test(match[0]) &&
        ADMINISTRATIVE_CANCELLATION_RE.test(clause)
      ) {
        continue;
      }
      if (ROUTINE_RESCHEDULE_RE.test(sentence)) continue;
      if (
        ADMINISTRATIVE_DECLINE_OBJECT_RE.test(clause) &&
        !/\b(?:project|work|job|quote|estimate|proposal|installation)\b/i.test(
          clause
        )
      ) {
        continue;
      }
      if (NEGATED_DECLINE_PREFIX_RE.test(prefix)) continue;
      if (DIRECT_DECLINE_REQUEST_RE.test(clause)) return true;
      if (NON_AUTHORITATIVE_DECLINE_RE.test(clause)) continue;
      if (isNonAssertedClaim(clause, patterns)) continue;
      if (HYPOTHETICAL_DECLINE_PREFIX_RE.test(prefix)) continue;
      if (
        isInterrogativeClaim(clause, [
          CUSTOMER_DECLINE_RE,
          COMMERCIAL_REVERSAL_ACTION_RE,
          RETRACTED_ACCEPTANCE_RE,
          CONTEXTUAL_CUSTOMER_DECLINE_RE,
        ])
      ) {
        continue;
      }
      return true;
    }
  }
  return false;
}

function hasExplicitAcceptance(body: string, subject: string): boolean {
  const clauses = commercialClauses(body);
  return clauses.some((clause) => {
    const value = clause.trim();
    const conditionValue = value
      .replace(ACCEPTANCE_FOLLOW_UP_SCHEDULING_QUESTION_RE, "")
      .replace(COMPLETED_ACCEPTANCE_REVIEW_PREFIX_RE, "")
      .trim();
    const genericAcceptance = GENERIC_ACCEPT_OR_APPROVE_RE.test(value);
    const anaphoricAcceptance =
      ANAPHORIC_ACCEPTANCE_RE.test(conditionValue) ||
      DIRECT_CUSTOMER_COMMITMENT_RE.test(conditionValue) ||
      STANDALONE_POSITIVE_ACKNOWLEDGEMENT_RE.test(conditionValue);
    const hasScopedProceedObject = /\b(?:go ahead|proceed)\s+with\b/i.test(
      value
    );
    const hasCommercialContext =
      COMMERCIAL_DEAL_CONTEXT_RE.test(value) ||
      ((anaphoricAcceptance ||
        (genericAcceptance && STANDALONE_GENERIC_ACCEPTANCE_RE.test(value))) &&
        (COMMERCIAL_DEAL_CONTEXT_RE.test(subject) ||
          COMMERCIAL_DEAL_CONTEXT_RE.test(body)));
    return (
      (COMMERCIAL_ACCEPTANCE_RE.test(value) ||
        ADDITIONAL_COMMERCIAL_ACCEPTANCE_RE.test(value) ||
        EXPLICIT_DOCUMENT_ACCEPTANCE_RE.test(value) ||
        STANDALONE_POSITIVE_ACKNOWLEDGEMENT_RE.test(value)) &&
      hasCommercialContext &&
      !ADMINISTRATIVE_ACCEPTANCE_OBJECT_RE.test(value) &&
      !NON_AUTHORIZING_QUOTE_ACCEPTANCE_RE.test(value) &&
      !NON_AUTHORIZING_INTERNAL_QUOTE_RE.test(value) &&
      !NON_AUTHORIZING_PARTIAL_APPROVAL_RE.test(value) &&
      !ADMINISTRATIVE_PROCEED_OBJECT_RE.test(value) &&
      !PREQUOTE_PROCEED_RE.test(value) &&
      !NON_DEAL_ACCEPTANCE_OBJECT_RE.test(value) &&
      (!hasScopedProceedObject || COMMERCIAL_PROCEED_OBJECT_RE.test(value)) &&
      !NON_AUTHORITATIVE_ACCEPTANCE_RE.test(value) &&
      !isNonAssertedClaim(value, [
        COMMERCIAL_ACCEPTANCE_RE,
        ADDITIONAL_COMMERCIAL_ACCEPTANCE_RE,
        EXPLICIT_DOCUMENT_ACCEPTANCE_RE,
        STANDALONE_POSITIVE_ACKNOWLEDGEMENT_RE,
      ]) &&
      !CONDITIONAL_ACCEPTANCE_RE.test(conditionValue) &&
      !NEGATED_ACCEPTANCE_RE.test(value) &&
      !isInterrogativeClaim(value, [
        COMMERCIAL_ACCEPTANCE_RE,
        ADDITIONAL_COMMERCIAL_ACCEPTANCE_RE,
        EXPLICIT_DOCUMENT_ACCEPTANCE_RE,
        STANDALONE_POSITIVE_ACKNOWLEDGEMENT_RE,
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
    const abbreviatedMonthPoint =
      char === "." &&
      /\b(?:jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)$/i.test(
        body.slice(Math.max(0, index - 6), index)
      );
    if (
      !decimalPoint &&
      !abbreviatedMonthPoint &&
      /[.!?;\n]/.test(char ?? "")
    ) {
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

function hasPaymentConfirmation(
  body: string,
  requireDirectCustomerEvidence: boolean
): boolean {
  return commercialClauses(body).some(
    (clause) =>
      COMPLETED_PAYMENT_FACT_RE.test(clause) &&
      !isNonAssertedClaim(clause, [COMPLETED_PAYMENT_FACT_RE]) &&
      (!requireDirectCustomerEvidence ||
        !NON_AUTHORITATIVE_PAYMENT_RE.test(clause)) &&
      (!PAYMENT_ADMINISTRATION_RE.test(clause) ||
        COMPLETED_PAYMENT_FACT_RE.test(clause)) &&
      !CONDITIONAL_PAYMENT_RE.test(clause) &&
      !NEGATED_PAYMENT_RE.test(clause) &&
      !PAYMENT_REVERSAL_RE.test(clause) &&
      !confirmationRequestGovernsClaim(clause, COMPLETED_PAYMENT_FACT_RE) &&
      !isInterrogativeClaim(clause, [COMPLETED_PAYMENT_FACT_RE])
  );
}

function hasDirectDepositRequest(body: string): boolean {
  return commercialClauses(body).some(
    (clause) =>
      DEPOSIT_REQUEST_RE.test(clause) &&
      !NON_AUTHORITATIVE_DEPOSIT_REQUEST_RE.test(clause) &&
      !CONDITIONAL_DEPOSIT_RE.test(clause) &&
      !NEGATED_DEPOSIT_REQUEST_RE.test(clause) &&
      !PREQUOTE_DEPOSIT_DETAILS_RE.test(clause)
  );
}

function hasScheduleConfirmation(
  body: string,
  commerciallyCommitted: boolean,
  hasSameThreadExecutionProposal: boolean,
  allowCommittedExecutionDetailInquiry: boolean
): boolean {
  return commercialClauses(body).some((clause) => {
    const correctionMarkers = [...clause.matchAll(COMMERCIAL_CORRECTION_RE)];
    const correction = correctionMarkers.at(-1);
    const currentClause =
      correction && SCHEDULE_CHANGE_OR_CANCELLATION_RE.test(clause)
        ? clause.slice((correction.index ?? 0) + correction[0].length).trim()
        : clause;
    const committedExecutionDetailInquiry =
      allowCommittedExecutionDetailInquiry &&
      COMMITTED_EXECUTION_DETAIL_INQUIRY_RE.test(currentClause);
    const guardedSchedule =
      SCHEDULE_CONFIRMED_RE.test(currentClause) ||
      DECLARATIVE_EXECUTION_SCHEDULE_RE.test(currentClause) ||
      ALTERNATE_EXECUTION_SCHEDULE_RE.test(currentClause) ||
      CONFIRMED_RESCHEDULE_RE.test(currentClause) ||
      committedExecutionDetailInquiry ||
      (hasSameThreadExecutionProposal &&
        BARE_SCHEDULE_CONFIRMATION_RE.test(currentClause)) ||
      (commerciallyCommitted &&
        SEE_YOU_EXECUTION_SCHEDULE_RE.test(currentClause));
    return (
      guardedSchedule &&
      (EXECUTION_SCHEDULE_CONTEXT_RE.test(clause) ||
        commerciallyCommitted ||
        hasSameThreadExecutionProposal) &&
      !PRE_SALE_ACTIVITY_RE.test(currentClause) &&
      !NON_EXECUTION_SCHEDULE_RE.test(currentClause) &&
      (!SCHEDULE_CHANGE_OR_CANCELLATION_RE.test(currentClause) ||
        CONFIRMED_RESCHEDULE_RE.test(currentClause)) &&
      !SCHEDULE_INQUIRY_RE.test(currentClause) &&
      !CONDITIONAL_SCHEDULE_RE.test(currentClause) &&
      !NON_AUTHORITATIVE_SCHEDULE_RE.test(currentClause) &&
      !isNonAssertedClaim(currentClause, [
        SCHEDULE_CONFIRMED_RE,
        DECLARATIVE_EXECUTION_SCHEDULE_RE,
        ALTERNATE_EXECUTION_SCHEDULE_RE,
        CONFIRMED_RESCHEDULE_RE,
        SEE_YOU_EXECUTION_SCHEDULE_RE,
        COMMITTED_EXECUTION_DETAIL_INQUIRY_RE,
      ]) &&
      !NEGATED_SCHEDULE_RE.test(currentClause) &&
      !confirmationRequestGovernsClaim(
        currentClause,
        SCHEDULE_CONFIRMED_RE.test(currentClause)
          ? SCHEDULE_CONFIRMED_RE
          : DECLARATIVE_EXECUTION_SCHEDULE_RE.test(currentClause)
            ? DECLARATIVE_EXECUTION_SCHEDULE_RE
            : ALTERNATE_EXECUTION_SCHEDULE_RE.test(currentClause)
              ? ALTERNATE_EXECUTION_SCHEDULE_RE
              : CONFIRMED_RESCHEDULE_RE.test(currentClause)
                ? CONFIRMED_RESCHEDULE_RE
                : SEE_YOU_EXECUTION_SCHEDULE_RE
      ) &&
      (committedExecutionDetailInquiry ||
        !isInterrogativeClaim(currentClause, [
          SCHEDULE_CONFIRMED_RE,
          DECLARATIVE_EXECUTION_SCHEDULE_RE,
          ALTERNATE_EXECUTION_SCHEDULE_RE,
          CONFIRMED_RESCHEDULE_RE,
          SEE_YOU_EXECUTION_SCHEDULE_RE,
          COMMITTED_EXECUTION_DETAIL_INQUIRY_RE,
        ]))
    );
  });
}

function isExcludedScopeStatement(
  message: CommercialOutcomeMessage,
  value: string
): boolean {
  // A customer asking whether OPS can help with work is not a declaration that
  // the customer or another party will self-perform that scope.
  if (value.includes("?")) return false;
  if (/^\s*(?:if|unless|when|once)\b/i.test(value)) return false;
  if (EXPLICIT_SCOPE_EXCLUSION_RE.test(value)) return true;
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
  body: string,
  hasSameThreadExecutionProposal = false
): CommercialSignal[] {
  const signals: CommercialSignal[] = [];
  const trustedCustomerInbound =
    message.direction === "inbound" && message.authorRole === "customer";
  const trustedCustomerAuthored =
    trustedCustomerInbound &&
    !REPORTED_THIRD_PARTY_INTENT_RE.test(body) &&
    !REPORTED_NAMED_THIRD_PARTY_INTENT_RE.test(body);
  const trustedOperatorOutbound =
    message.direction === "outbound" && message.authorRole === "operator";
  const trustedCommercialAuthor =
    trustedCustomerInbound || trustedOperatorOutbound;
  if (
    trustedCustomerAuthored &&
    hasCustomerDecline(body, priorCommerciallyCommitted)
  ) {
    signals.push("customer_declined");
  }
  if (trustedCustomerAuthored && hasExplicitAcceptance(body, message.subject)) {
    signals.push("explicit_acceptance");
  }
  if (trustedCustomerAuthored && hasDirectDepositRequest(body)) {
    signals.push("deposit_requested");
  }
  if (
    trustedCommercialAuthor &&
    hasPaymentConfirmation(body, trustedCustomerInbound)
  ) {
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
    hasScheduleConfirmation(
      body,
      commerciallyCommitted,
      hasSameThreadExecutionProposal,
      trustedCustomerAuthored
    )
  ) {
    signals.push("schedule_confirmed");
  }
  if (
    trustedCustomerAuthored &&
    hasDeferralAction(body) &&
    !(
      ADMINISTRATIVE_DEFERRAL_OBJECT_RE.test(body) &&
      !/\b(?:project|work|job|quote|estimate|proposal|installation)\b/i.test(
        body
      )
    ) &&
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
  priorCommerciallyCommitted: boolean,
  hasSameThreadExecutionProposal = false
): { signals: CommercialSignal[]; unresolvedConflict: boolean } {
  const body = cleanBody(message.body);
  const signals = collectMessageSignals(
    message,
    priorCommerciallyCommitted,
    body,
    hasSameThreadExecutionProposal
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
    correctionBody,
    hasSameThreadExecutionProposal
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

type CommercialEpisodeTransition = "revision" | "add_on" | "ambiguous" | null;

const SAME_DOCUMENT_REVISION_RE =
  /\b(?:revised|updated|changed|reworked|requoted)\s+(?:estimate|quote|proposal)\b|\b(?:revise|update|change|rework|requote)\s+(?:the|that|this|your|our|existing)\s+(?:estimate|quote|proposal)\b|\b(?:estimate|quote|proposal)\s+(?:was|is|has been|had been)?\s*(?:revised|updated|changed|reworked|requoted)\b|\b(?:current\s+)?(?:revised|updated|changed)\b.{0,50}\b(?:total|price|pricing)\b|\b(?:revised|updated|changed)\s+scope(?:\s+of\s+work)?\s*(?::|to\b|now\b|is\b)|\b(?:remove|swap|replace|add)\b.{0,60}\b(?:from|to|in)\s+(?:the|that|your|our|existing)\s+(?:estimate|quote|proposal)\b|\b(?:instead of|rather than)\b.{0,80}\b(?:the|that|your|our|existing)\s+(?:estimate|quote|proposal)\b/i;
const EXPLICIT_ADD_ON_QUOTE_RE =
  /\b(?:separate|another|additional|optional)\b.{0,50}\b(?:estimate|quote|proposal)\b|\b(?:estimate|quote|proposal)\b.{0,50}\b(?:for|on|covering)?\s*(?:an?\s+)?(?:separate|additional|optional)\b/i;

function commercialEpisodeTransition(
  message: CommercialOutcomeMessage,
  signals: CommercialSignal[]
): CommercialEpisodeTransition {
  const trustedCustomerInbound =
    message.direction === "inbound" && message.authorRole === "customer";
  const trustedOperatorOutbound =
    message.direction === "outbound" && message.authorRole === "operator";
  if (!trustedCustomerInbound && !trustedOperatorOutbound) return null;
  const body = cleanBody(message.body);
  // A customer's decisive reply may naturally repeat "updated quote." That is
  // fresh authority, not another revision boundary. Operator-authored revised
  // documents remain boundaries even when they also mention payment/schedule.
  if (trustedCustomerInbound && signals.length > 0) return null;
  if (SAME_DOCUMENT_REVISION_RE.test(body)) return "revision";
  if (signals.length > 0) return null;
  if (
    EXPLICIT_ADD_ON_QUOTE_RE.test(body) &&
    /\b(?:estimate|quote|proposal)\b/i.test(body)
  ) {
    return "add_on";
  }
  if (!trustedCustomerInbound || !ESTIMATE_REQUEST_RE.test(body)) return null;
  const scopedRequest = commercialClauses(body).some(
    (clause) =>
      ESTIMATE_REQUEST_RE.test(clause) &&
      (isCurrentCommercialScopeStatement(clause) ||
        scopeTerms(clause).size >= 2)
  );
  return scopedRequest ? "ambiguous" : null;
}

type EvaluatedCommercialMessage = {
  message: CommercialOutcomeMessage;
  signals: CommercialSignal[];
  episodeTransition: CommercialEpisodeTransition;
};

function mailboxThreadKey(message: CommercialOutcomeMessage): string | null {
  const connectionId = message.connectionId?.trim();
  const providerThreadId = message.providerThreadId?.trim();
  return connectionId && providerThreadId
    ? `${connectionId}:${providerThreadId}`
    : null;
}

function hasExecutionScheduleProposal(
  message: CommercialOutcomeMessage
): boolean {
  const trustedParticipant =
    (message.direction === "outbound" && message.authorRole === "operator") ||
    (message.direction === "inbound" && message.authorRole === "customer");
  if (!trustedParticipant) {
    return false;
  }
  return commercialClauses(cleanBody(message.body)).some(
    (clause) =>
      clause.includes("?") &&
      !PRE_SALE_ACTIVITY_RE.test(clause) &&
      !NON_EXECUTION_SCHEDULE_RE.test(clause) &&
      EXECUTION_SCHEDULE_CONTEXT_RE.test(clause) &&
      SCHEDULE_FACT_RE.test(clause) &&
      /\b(?:schedule|book|start|begin|arrive|come|install)\w*\b/i.test(clause)
  );
}

function confirmedScheduleFactBody(
  evidence: EvaluatedCommercialMessage[],
  confirmedIndex: number
): string {
  const confirmed = evidence[confirmedIndex]!;
  const body = cleanBody(confirmed.message.body);
  if (!BARE_SCHEDULE_CONFIRMATION_RE.test(body)) return body;
  const threadKey = mailboxThreadKey(confirmed.message);
  if (!threadKey) return body;
  for (let index = confirmedIndex - 1; index >= 0; index -= 1) {
    const prior = evidence[index]!;
    if (mailboxThreadKey(prior.message) !== threadKey) continue;
    if (
      prior.signals.includes("budget_timing_deferral") ||
      prior.signals.includes("customer_declined") ||
      prior.episodeTransition === "revision" ||
      prior.episodeTransition === "ambiguous"
    ) {
      break;
    }
    if (hasExecutionScheduleProposal(prior.message)) {
      return cleanBody(prior.message.body);
    }
  }
  return body;
}

function sortedCommercialMessages(
  input: CommercialOutcomeMessage[]
): CommercialOutcomeMessage[] {
  return [...input]
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
}

function evaluateCommercialHistory(
  input: CommercialOutcomeMessage[],
  initiallyCommitted = false
): {
  evaluated: EvaluatedCommercialMessage[];
  episodeStartIndex: number;
  stickyCustomerVeto: EvaluatedCommercialMessage | null;
  decisivePositive: EvaluatedCommercialMessage | null;
  unresolvedCustomerConflict: boolean;
} {
  const messages = sortedCommercialMessages(input);
  const evaluated: EvaluatedCommercialMessage[] = [];
  let episodeStartIndex = 0;
  let priorCommerciallyCommitted = initiallyCommitted;
  let stickyCustomerVeto: EvaluatedCommercialMessage | null = null;
  let decisivePositive: EvaluatedCommercialMessage | null = null;
  let unresolvedCustomerConflict = false;
  const executionScheduleProposalThreads = new Set<string>();

  for (const message of messages) {
    const threadKey = mailboxThreadKey(message);
    const evaluation = messageSignals(
      message,
      priorCommerciallyCommitted,
      Boolean(threadKey && executionScheduleProposalThreads.has(threadKey))
    );
    const episodeTransition = commercialEpisodeTransition(
      message,
      evaluation.signals
    );
    const signals =
      episodeTransition === "revision"
        ? evaluation.signals.filter((signal) =>
            ["payment_confirmed", "schedule_confirmed"].includes(signal)
          )
        : evaluation.signals;
    const entry = { message, signals, episodeTransition };
    evaluated.push(entry);

    if (episodeTransition === "revision") {
      const operatorCannotReopenCustomerVeto =
        stickyCustomerVeto !== null &&
        message.direction === "outbound" &&
        message.authorRole === "operator";
      if (operatorCannotReopenCustomerVeto) {
        episodeStartIndex = evaluated.length - 1;
        decisivePositive = null;
        priorCommerciallyCommitted = false;
        executionScheduleProposalThreads.clear();
        continue;
      }
      const invalidatesPriorAuthority: boolean =
        priorCommerciallyCommitted ||
        stickyCustomerVeto !== null ||
        decisivePositive !== null ||
        unresolvedCustomerConflict;
      episodeStartIndex = evaluated.length - 1;
      stickyCustomerVeto = null;
      decisivePositive = null;
      if (signals.length > 0) {
        decisivePositive = entry;
        unresolvedCustomerConflict = false;
        priorCommerciallyCommitted = true;
      } else {
        unresolvedCustomerConflict = invalidatesPriorAuthority;
        priorCommerciallyCommitted = false;
      }
      executionScheduleProposalThreads.clear();
      continue;
    }

    if (episodeTransition === "ambiguous") {
      const invalidatesPriorAuthority =
        priorCommerciallyCommitted ||
        stickyCustomerVeto !== null ||
        decisivePositive !== null ||
        unresolvedCustomerConflict;
      episodeStartIndex = evaluated.length - 1;
      stickyCustomerVeto = null;
      decisivePositive = null;
      unresolvedCustomerConflict = invalidatesPriorAuthority;
      priorCommerciallyCommitted = false;
      executionScheduleProposalThreads.clear();
      continue;
    }

    if (threadKey && hasExecutionScheduleProposal(message)) {
      executionScheduleProposalThreads.add(threadKey);
    }
    if (
      threadKey &&
      SCHEDULE_CHANGE_OR_CANCELLATION_RE.test(cleanBody(message.body))
    ) {
      executionScheduleProposalThreads.delete(threadKey);
    }

    if (evaluation.unresolvedConflict) {
      stickyCustomerVeto = null;
      decisivePositive = null;
      unresolvedCustomerConflict = true;
      priorCommerciallyCommitted = false;
      executionScheduleProposalThreads.clear();
      continue;
    }
    if (
      signals.includes("budget_timing_deferral") ||
      signals.includes("customer_declined")
    ) {
      stickyCustomerVeto = entry;
      unresolvedCustomerConflict = false;
      priorCommerciallyCommitted = false;
      executionScheduleProposalThreads.clear();
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

  return {
    evaluated,
    episodeStartIndex,
    stickyCustomerVeto,
    decisivePositive,
    unresolvedCustomerConflict,
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
  return evaluateCommercialHistory(input, priorCommerciallyCommitted)
    .unresolvedCustomerConflict;
}

/**
 * Return the complete trusted correspondence for the current commercial
 * episode. Summary extraction uses this same boundary as terminal conversion,
 * so an older accepted price, schedule, objection, or action cannot leak into a
 * newer quote revision.
 */
export function currentCommercialEpisodeMessages(
  input: CommercialOutcomeMessage[]
): CommercialOutcomeMessage[] {
  const { evaluated, episodeStartIndex } = evaluateCommercialHistory(input);
  const episode = evaluated.slice(episodeStartIndex);
  return partitionAddOnEvidence(episode).includedEvidence.map(
    (entry) => entry.message
  );
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

const COMMERCIAL_SCOPE_OBJECT_STOPWORDS = new Set([
  "accept",
  "accepted",
  "additional",
  "another",
  "approve",
  "approved",
  "available",
  "book",
  "booked",
  "booking",
  "cancel",
  "cancelled",
  "canceled",
  "charge",
  "confirm",
  "confirmed",
  "cost",
  "date",
  "delay",
  "delayed",
  "dollar",
  "dollars",
  "estimate",
  "extra",
  "friday",
  "install",
  "monday",
  "optional",
  "please",
  "price",
  "proceed",
  "proposal",
  "quote",
  "remove",
  "repair",
  "replace",
  "reschedule",
  "rescheduled",
  "saturday",
  "schedule",
  "scheduled",
  "separate",
  "sunday",
  "supply",
  "thursday",
  "today",
  "tomorrow",
  "total",
  "tuesday",
  "wednesday",
]);

function commercialScopeObjectTerms(value: string): Set<string> {
  return new Set(
    [...scopeTerms(value)].filter(
      (term) =>
        !COMMERCIAL_SCOPE_OBJECT_STOPWORDS.has(term) &&
        !/^\d+(?:\.\d+)?$/.test(term)
    )
  );
}

function messageCommercialScopeObjectTerms(
  message: CommercialOutcomeMessage
): Set<string> {
  const bodyTerms = commercialScopeObjectTerms(cleanBody(message.body));
  return bodyTerms.size > 0
    ? bodyTerms
    : commercialScopeObjectTerms(message.subject);
}

function setsOverlap(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  return [...left].some((term) => right.has(term));
}

interface AddOnEvidenceBranch {
  entries: EvaluatedCommercialMessage[];
  matchingTerms: Set<string>;
  baseTermsAtOpen: Set<string>;
  threadKey: string | null;
  accepted: boolean;
}

interface AddOnEvidencePartition {
  baseEvidence: EvaluatedCommercialMessage[];
  acceptedBranches: AddOnEvidenceBranch[];
  includedEvidence: EvaluatedCommercialMessage[];
}

function partitionAddOnEvidence(
  evidence: EvaluatedCommercialMessage[]
): AddOnEvidencePartition {
  const baseEvidence: EvaluatedCommercialMessage[] = [];
  const branches: AddOnEvidenceBranch[] = [];

  for (const entry of evidence) {
    if (entry.episodeTransition === "add_on") {
      const baseTermsAtOpen = new Set(
        baseEvidence.flatMap((baseEntry) => [
          ...messageCommercialScopeObjectTerms(baseEntry.message),
        ])
      );
      const requestTerms = messageCommercialScopeObjectTerms(entry.message);
      const distinctiveRequestTerms = new Set(
        [...requestTerms].filter((term) => !baseTermsAtOpen.has(term))
      );
      branches.push({
        entries: [entry],
        matchingTerms:
          distinctiveRequestTerms.size > 0
            ? distinctiveRequestTerms
            : requestTerms,
        baseTermsAtOpen,
        threadKey: mailboxThreadKey(entry.message),
        accepted: false,
      });
      continue;
    }

    const candidateTerms = messageCommercialScopeObjectTerms(entry.message);
    const scopedTargetBranch = [...branches]
      .reverse()
      .find(
        (branch) =>
          candidateTerms.size > 0 &&
          branch.matchingTerms.size > 0 &&
          setsOverlap(candidateTerms, branch.matchingTerms)
      );
    const entryThreadKey = mailboxThreadKey(entry.message);
    const terseSameThreadTarget =
      candidateTerms.size === 0 && entryThreadKey
        ? [...branches]
            .reverse()
            .find(
              (branch) =>
                !branch.accepted && branch.threadKey === entryThreadKey
            )
        : undefined;
    const targetBranch = scopedTargetBranch ?? terseSameThreadTarget;
    if (!targetBranch) {
      baseEvidence.push(entry);
      continue;
    }

    targetBranch.entries.push(entry);
    for (const term of candidateTerms) {
      if (!targetBranch.baseTermsAtOpen.has(term)) {
        targetBranch.matchingTerms.add(term);
      }
    }
    if (
      entry.signals.some(
        (signal) =>
          signal !== "budget_timing_deferral" && signal !== "customer_declined"
      )
    ) {
      targetBranch.accepted = true;
    }
  }

  const acceptedBranches = branches.filter((branch) => branch.accepted);
  const included = new Set<EvaluatedCommercialMessage>([
    ...baseEvidence,
    ...acceptedBranches.flatMap((branch) => branch.entries),
  ]);
  return {
    baseEvidence,
    acceptedBranches,
    includedEvidence: evidence.filter((entry) => included.has(entry)),
  };
}

function scopeStatementsOverlap(left: string, right: string): boolean {
  const rightTerms = scopeTerms(right);
  return [...scopeTerms(left)].some((term) => rightTerms.has(term));
}

function scopeActionTerms(value: string): Set<string> {
  const matches =
    value.match(
      /\b(?:install(?:ation|ing)?|supply|supplies|supplied|supplying|provide|provided|providing|replace|replaced|replacement|replacing|repair|repaired|repairing|build|building|construct|constructing|remove|removed|removal|removing|include|included|including|exclude|excluded|excluding|handle|handled|handling)\b/gi
    ) ?? [];
  return new Set(matches.map(normalizeScopeTerm));
}

function scopeActionsOverlap(left: string, right: string): boolean {
  const rightActions = scopeActionTerms(right);
  return [...scopeActionTerms(left)].some((term) => rightActions.has(term));
}

function acceptedQuoteCarriesScopedObject(value: string): boolean {
  const acceptedDocumentObject =
    value.match(
      /\b(?:accept(?:ed)?|approv(?:e|ed))\b\s+(?:(?:the|your|this|our)\s+)?(.{1,100}?)\s+(?:estimate|quote|proposal)\b/i
    )?.[1] ??
    value.match(
      /\b(?:proceed|go ahead)\s+with\s+(?:(?:the|your|this|our)\s+)(.{1,100}?)\s+(?:estimate|quote|proposal)\b/i
    )?.[1] ??
    null;
  if (!acceptedDocumentObject) return false;
  const withoutPrice = acceptedDocumentObject.replace(
    /\$\s*[0-9][0-9,]*(?:\.\d{1,2})?/g,
    " "
  );
  return [...scopeTerms(withoutPrice)].some((term) => /[a-z]/i.test(term));
}

function isCurrentCommercialScopeStatement(value: string): boolean {
  if (isActionOnlyCommercialArtifactRequest(value)) return false;
  if (
    (SCHEDULE_FACT_RE.test(value) ||
      SCHEDULE_CHANGE_OR_CANCELLATION_RE.test(value)) &&
    EXECUTION_SCHEDULE_CONTEXT_RE.test(value) &&
    commercialScopeObjectTerms(value).size === 0
  ) {
    return false;
  }
  if (
    /\b(?:booked|scheduled|confirmed)\s+(?:the\s+)?(?:repair\s+)?(?:project|job|work)\b/i.test(
      value
    ) &&
    !/\b(?:install|remove|replac(?:e|ed|ement|ing)|build|construct|supply)\w*\b/i.test(
      value
    )
  ) {
    return false;
  }
  return (
    scopeActionTerms(value).size > 0 ||
    EXPLICIT_SCOPE_CONTEXT_RE.test(value) ||
    acceptedQuoteCarriesScopedObject(value)
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
    const sentences = cleanBody(message.body).match(/[^.!?\n]+[.!?]?/g) ?? [];
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
    for (const price of extractCommercialDealPriceMatches(
      cleanBody(message.body)
    )) {
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

function explicitCombinedDealTotal(
  messages: CommercialOutcomeMessage[]
): number | null {
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex -= 1
  ) {
    const matches = extractCommercialDealPriceMatches(
      cleanBody(messages[messageIndex].body)
    );
    for (
      let priceIndex = matches.length - 1;
      priceIndex >= 0;
      priceIndex -= 1
    ) {
      const match = matches[priceIndex];
      if (
        /\b(?:combined|grand|final)\s+total\b|\btotal\s+(?:for|with|including)\b.{0,80}\b(?:and|plus|add[ -]?on|together)\b/i.test(
          match.segment
        )
      ) {
        return match.value;
      }
    }
  }
  return null;
}

function acceptedCommercialPrice(
  partition: AddOnEvidencePartition
): number | null {
  const includedMessages = partition.includedEvidence.map(
    (entry) => entry.message
  );
  const explicitCombinedTotal = explicitCombinedDealTotal(includedMessages);
  if (explicitCombinedTotal !== null) return explicitCombinedTotal;

  const basePrice = currentMoney(
    partition.baseEvidence.map((entry) => entry.message)
  );
  if (partition.acceptedBranches.length === 0) return basePrice;

  const acceptedAddOnPrices = partition.acceptedBranches
    .map((branch) => currentMoney(branch.entries.map((entry) => entry.message)))
    .filter((price): price is number => price !== null);
  const components = [
    ...(basePrice === null ? [] : [basePrice]),
    ...acceptedAddOnPrices,
  ];
  if (components.length === 0) return null;
  return (
    Math.round(
      components.reduce((total, component) => total + component, 0) * 100
    ) / 100
  );
}

function acceptedCommercialScope(input: {
  partition: AddOnEvidencePartition;
  postDecisionBaseScopeEvidence: EvaluatedCommercialMessage[];
  excludedScope: string | null;
}): string | null {
  const scopes = [
    currentScopeStatement(
      [
        ...input.partition.baseEvidence,
        ...input.postDecisionBaseScopeEvidence,
      ].map((entry) => entry.message),
      input.excludedScope
    ),
    ...input.partition.acceptedBranches.map((branch) =>
      currentScopeStatement(
        branch.entries.map((entry) => entry.message),
        input.excludedScope
      )
    ),
  ].filter((scope): scope is string => scope !== null);
  const uniqueScopes = [
    ...new Map(scopes.map((scope) => [scope.toLowerCase(), scope])).values(),
  ];
  return uniqueScopes.length > 0 ? uniqueScopes.join(" ") : null;
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
      QUOTE_DELIVERY_TIMING_RE.test(body) ||
      NON_EXECUTION_SCHEDULE_RE.test(body)
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
const DEFAULT_UNDATED_DEFERRAL_FOLLOW_UP_MONTHS = 3;

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

  if (DEFERRAL_CAUSE_RE.test(body)) {
    return {
      followUpAt: addCalendarMonths(
        occurredAt,
        DEFAULT_UNDATED_DEFERRAL_FOLLOW_UP_MONTHS
      ).toISOString(),
      nextAction: `Follow up in ${DEFAULT_UNDATED_DEFERRAL_FOLLOW_UP_MONTHS} months to reassess the customer's budget and timing.`,
    };
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
  const {
    evaluated,
    episodeStartIndex,
    stickyCustomerVeto,
    decisivePositive,
    unresolvedCustomerConflict,
  } = evaluateCommercialHistory(input.messages);
  if (unresolvedCustomerConflict) return null;
  const decisive = stickyCustomerVeto ?? decisivePositive;
  if (!decisive) return null;

  // `provider_message_id` is mailbox-scoped, not globally unique. Keep the
  // exact evaluated entry so two connected mailboxes cannot collapse onto the
  // wrong decision boundary when a provider reuses an opaque message id.
  const decisiveIndex = evaluated.indexOf(decisive);
  const decisionEvidence = evaluated.slice(
    episodeStartIndex,
    decisiveIndex + 1
  );
  // The decisive signal determines the outcome, but facts must reflect every
  // message evaluated through the durable high-water mark. A later price or
  // scope revision does not become "superseded" merely because it repeats no
  // acceptance keyword.
  const completeEvidence = evaluated.slice(episodeStartIndex);
  const completePartition = partitionAddOnEvidence(completeEvidence);
  const decisionPartition = partitionAddOnEvidence(decisionEvidence);
  const commercialFactEvidence = completePartition.includedEvidence;
  const completeBaseEvidence = new Set(completePartition.baseEvidence);
  const postDecisionScopeEvidence: EvaluatedCommercialMessage[] = [];
  for (const entry of completeEvidence.slice(decisionEvidence.length)) {
    if (!completeBaseEvidence.has(entry)) continue;
    const body = cleanBody(entry.message.body);
    if (
      entry.message.direction === "outbound" &&
      entry.message.authorRole === "operator" &&
      extractCommercialDealPriceMatches(body).length === 0 &&
      !/\b(?:estimate|quote|proposal)\b/i.test(body) &&
      !body.includes("?") &&
      /\bwe\s+(?:will|['’]ll|are going to)\b/i.test(body) &&
      /\b(?:as part of|included in|within)\s+(?:the|this|your|our)\b/i.test(
        body
      ) &&
      isCurrentCommercialScopeStatement(body)
    ) {
      postDecisionScopeEvidence.push(entry);
    }
  }
  const observedSignals = [
    ...new Set(decisionEvidence.flatMap((entry) => entry.signals)),
  ] as CommercialSignal[];
  const deferred = decisive.signals.includes("budget_timing_deferral");
  const declined = decisive.signals.includes("customer_declined") && !deferred;
  const deferredTiming = deferred
    ? resolveDeferredTiming(
        cleanBody(decisive.message.body),
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
    commercialFactEvidence.map((entry) => entry.message)
  );
  const currentScope = acceptedCommercialScope({
    partition: decisionPartition,
    postDecisionBaseScopeEvidence: postDecisionScopeEvidence,
    excludedScope,
  });
  let guardedSchedule: string | null = null;
  for (
    let entryIndex = commercialFactEvidence.length - 1;
    entryIndex >= 0;
    entryIndex -= 1
  ) {
    const entry = commercialFactEvidence[entryIndex]!;
    const body = cleanBody(entry.message.body);
    if (PRE_SALE_ACTIVITY_RE.test(body)) continue;
    if (entry.signals.includes("schedule_confirmed")) {
      guardedSchedule = confirmedScheduleFactBody(
        commercialFactEvidence,
        entryIndex
      );
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
        lastScheduleFactBody(
          commercialFactEvidence.map((entry) => entry.message)
        ));
  const facts: CommercialFacts = {
    currentPrice: acceptedCommercialPrice(decisionPartition),
    currentScope,
    excludedScope,
    schedule,
    objection: deferred || declined ? cleanBody(decisive.message.body) : null,
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

const NON_AUTHORIAL_FOOTER_START_RE =
  /(?:^|[\r\n])\s*(?:messages? may be (?:stored|retained|processed|analysed|analyzed)|this (?:message|e-?mail)(?: and (?:any )?attachments?)? (?:is|are) (?:confidential|intended only)|your use of (?:this|the) messaging service is subject to|privacy policy\s*(?:,|and|&|\|)\s*(?:our\s+)?cookie policy|cookie policy\s*(?:,|and|&|\|)\s*(?:our\s+)?privacy policy|to (?:stop|unsubscribe from) receiving (?:these|this) (?:messages|e-?mails))\b/i;
const AUTHORIAL_CONTINUATION_AFTER_FOOTER_RE =
  /[\r\n]\s*(?:p\.?\s*s\.?|postscript|correction|correcting that|update|actually|however|to clarify|clarification)\s*[:;,—–-]?\s*(?=[^\r\n]*\b(?:accept\w*|approv\w*|go ahead|proceed|cancel\w*|declin\w*|withdraw\w*|changed (?:my|our) minds?|postpon\w*|defer\w*|delay\w*|deposit|payment|paid|received|revers\w*|refund\w*|chargeback|scheduled|booked|rescheduled)\b)/i;

/**
 * Remove provider/platform legal tails before commercial classification.
 * These blocks are non-authorial transport data, not customer intent. The
 * first marker is an explicit trust boundary: everything after it is ignored.
 */
export function normalizeCommercialEvidenceBody(
  value: string | null | undefined
): string {
  const source = value ?? "";
  const footer = NON_AUTHORIAL_FOOTER_START_RE.exec(source);
  if (!footer) return source.replace(/\s+/g, " ").trim();
  const footerIndex = footer.index ?? 0;
  const footerTail = source.slice(footerIndex + footer[0].length);
  const continuation = AUTHORIAL_CONTINUATION_AFTER_FOOTER_RE.exec(footerTail);
  const authored = continuation
    ? `${source.slice(0, footerIndex)}\n${footerTail.slice(continuation.index + 1)}`
    : source.slice(0, footerIndex);
  return authored.replace(/\s+/g, " ").trim();
}

function cleanBody(value: string | null | undefined): string {
  return normalizeCommercialEvidenceBody(value);
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
  let priorOutboundEstimateContext = false;
  const commercialMessages: CommercialOutcomeMessage[] = [];

  for (const [index, message] of messages.entries()) {
    const fullBody = cleanBody(message.body);
    if (!fullBody) continue;

    const latestReply = cleanBody(latestReplySegment(message.body ?? ""));
    const quotedEstimateContext =
      latestReply !== fullBody && ESTIMATE_CONTEXT_RE.test(fullBody);
    commercialMessages.push({
      connectionId: "legacy-terminal-stage",
      providerThreadId: "legacy-terminal-stage",
      providerMessageId: `legacy-terminal-stage-${index}`,
      occurredAt: new Date(Date.UTC(2000, 0, 1, 0, 0, 0, index)).toISOString(),
      direction: message.direction,
      authorRole: message.direction === "inbound" ? "customer" : "operator",
      subject:
        priorOutboundEstimateContext || quotedEstimateContext ? "Estimate" : "",
      body: latestReply,
    });

    if (
      message.direction === "outbound" &&
      ESTIMATE_CONTEXT_RE.test(fullBody)
    ) {
      priorOutboundEstimateContext = true;
    }
  }

  const outcome = detectCommercialOutcome({
    messages: commercialMessages,
    now: new Date("2100-01-01T00:00:00.000Z"),
  });
  return outcome?.outcome === "won"
    ? { terminalFlag: "likely_won", stage: "won" }
    : null;
}
