import { extractCommercialDealPrices } from "@/lib/email/commercial-price";

export type ConversationFactKind =
  "price" | "scope" | "schedule" | "objection" | "next_action";

export interface TrustedEmailMessage {
  activityId: string;
  eventId: string;
  evidenceKey: string;
  providerMessageId: string;
  providerThreadId: string;
  connectionId: string;
  occurredAt: string;
  direction: "inbound" | "outbound";
  authorRole: "customer" | "operator";
  subject: string;
  body: string;
}

export interface ConversationFactObservation {
  at: string;
  author_role: "customer" | "operator";
  connection_id: string;
  provider_thread_id: string;
  evidence_key: string;
  text: string;
}

export interface ConversationFold {
  source_message_count: number;
  recent_message_count: number;
  observations: Record<ConversationFactKind, ConversationFactObservation[]>;
}

export const CONVERSATION_FACT_PATTERNS: Record<ConversationFactKind, RegExp> =
  {
    price:
      /\$\s*[0-9][0-9,]*(?:\.\d{1,2})?|\b(?:quote|estimate|proposal|price|pricing|cost|total|budget|discount(?:ed)?|deposit|payment)\b/i,
    scope:
      /\b(?:scope|include(?:d|s|ing)?|exclude(?:d|s|ing)?|without|supply|provide|install(?:ation|ing)?|remove|replac(?:e|ed|ement|ing)|repair|build|construct|material|finish|dimension|size|colou?r|option|revision|revised|addition|added)\b/i,
    schedule:
      /\b(?:schedule(?:d)?|book(?:ing|ed)?|availability|available|start(?:ing)?|finish(?:ed|ing)?|complete(?:d|ing)?|deadline|timeline|timing|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|spring|summer|fall|autumn|winter|next week|this week|week of|end of|date)\b/i,
    objection:
      /\b(?:objection|concern|issue|problem|budget|afford|funds?|cash|too expensive|delay|postpone|hold off|not ready|cannot|can'?t|unable|conflict|occupied)\b/i,
    next_action:
      /\b(?:next action|next step|follow[ -]?up|please|let (?:me|us) know|confirm|send|sent|provide|provided|share|shared|attach(?:ed)?|include(?:d)?|call|reply|respond|need from|waiting for|instructions?|book(?:ed|ing)?|schedule)\b|\?/i,
  };

const DEFAULT_FACTS_PER_KIND = 3;
const FACT_TEXT_CAP = 400;

function clip(value: string, max: number): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function factSegments(body: string): string[] {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  return normalized
    .split(/(?<=[!?])\s+|\.\s+(?=[A-Z0-9])/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

/**
 * Fold every authorized email into a fixed-size set of the newest observations
 * for the fact classes shared by summaries, drafting, and stage review.
 */
export function buildConversationFold(
  completeEmailHistory: TrustedEmailMessage[],
  recentMessageCount: number,
  factsPerKindCap: number | null = DEFAULT_FACTS_PER_KIND
): ConversationFold {
  const observations: ConversationFold["observations"] = {
    price: [],
    scope: [],
    schedule: [],
    objection: [],
    next_action: [],
  };

  for (const message of completeEmailHistory) {
    for (const segment of factSegments(message.body)) {
      for (const kind of Object.keys(
        CONVERSATION_FACT_PATTERNS
      ) as ConversationFactKind[]) {
        const pattern = CONVERSATION_FACT_PATTERNS[kind];
        pattern.lastIndex = 0;
        if (!pattern.test(segment)) continue;
        if (
          kind === "price" &&
          extractCommercialDealPrices(segment).length === 0
        ) {
          continue;
        }
        const text = clip(segment, FACT_TEXT_CAP);
        if (!text) continue;

        const facts = observations[kind];
        const duplicateIndex = facts.findIndex(
          (fact) => fact.text.toLowerCase() === text.toLowerCase()
        );
        if (duplicateIndex >= 0) facts.splice(duplicateIndex, 1);
        facts.push({
          at: message.occurredAt,
          author_role: message.authorRole,
          connection_id: message.connectionId,
          provider_thread_id: message.providerThreadId,
          evidence_key: message.evidenceKey,
          text,
        });
        if (
          factsPerKindCap !== null &&
          facts.length > Math.max(0, factsPerKindCap)
        ) {
          facts.shift();
        }
      }
    }
  }

  return {
    source_message_count: completeEmailHistory.length,
    recent_message_count: recentMessageCount,
    observations,
  };
}
