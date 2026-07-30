import { getEncoding, type Tiktoken } from "js-tiktoken";

import {
  buildConversationFold,
  CONVERSATION_FACT_PATTERNS,
  type ConversationFactKind,
  type ConversationFold,
  type TrustedEmailMessage,
} from "./conversation-fact-fold";

export const MAX_CONVERSATION_CONTEXT_RETRIEVAL_ROUNDS = 2;
export const DEFAULT_CONVERSATION_CONTEXT_TOKEN_BUDGET = 8_000;
export const DEFAULT_CONVERSATION_RETRIEVAL_TOKEN_BUDGET = 2_500;

const DEFAULT_MAX_CHUNK_TOKENS = 600;
const MANIFEST_TOKEN_RESERVE = 180;

let contextEncoding: Tiktoken | null = null;

function encoding(): Tiktoken {
  contextEncoding ??= getEncoding("cl100k_base");
  return contextEncoding;
}

export function countConversationTokens(text: string): number {
  return encoding().encode(text).length;
}

function truncateToTokens(text: string, maxTokens: number): string {
  const tokens = encoding().encode(text);
  if (tokens.length <= maxTokens) return text;
  return `${encoding().decode(tokens.slice(0, Math.max(0, maxTokens - 1))).trimEnd()}…`;
}

export interface ConversationContextChunk {
  chunkId: string;
  messageId: string;
  evidenceKey: string;
  providerThreadId: string;
  occurredAt: string;
  direction: "inbound" | "outbound";
  authorRole: "customer" | "operator";
  subject: string;
  text: string;
  chunkIndex: number;
  chunkCount: number;
  partial: boolean;
  tokenCount: number;
}

export interface ConversationContextManifest {
  clipped: boolean;
  totalMessages: number;
  includedMessages: number;
  omittedMessages: number;
  includedMessageIds: string[];
  omittedMessageIds: string[];
  partialMessageIds: string[];
  omittedDateRange: { from: string; to: string } | null;
  retrievalAvailable: boolean;
}

export interface ConversationContextPack {
  promptText: string;
  selectedChunks: ConversationContextChunk[];
  factFold: ConversationFold;
  manifest: ConversationContextManifest;
  tokenCount: number;
}

export interface BuildConversationContextPackInput {
  messages: TrustedEmailMessage[];
  olderSummary?: string | null;
  currentFacts?: Record<string, unknown> | null;
  tokenBudget?: number;
  maxChunkTokens?: number;
}

export interface ConversationContextRetrievalRequest {
  factKind?: ConversationFactKind | null;
  query?: string | null;
  before?: string | null;
  after?: string | null;
  evidenceKeys?: string[] | null;
}

export interface ConversationContextRetrievalResult {
  text: string;
  chunks: ConversationContextChunk[];
  tokenCount: number;
  unresolved: boolean;
}

function splitOversizedFragment(
  fragment: string,
  maxChunkTokens: number
): string[] {
  if (countConversationTokens(fragment) <= maxChunkTokens) return [fragment];
  const sentences = fragment
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (sentences.length > 1) {
    return sentences.flatMap((sentence) =>
      splitOversizedFragment(sentence, maxChunkTokens)
    );
  }

  const tokens = encoding().encode(fragment);
  const slices: string[] = [];
  for (let index = 0; index < tokens.length; index += maxChunkTokens) {
    const decoded = encoding()
      .decode(tokens.slice(index, index + maxChunkTokens))
      .trim();
    if (decoded) slices.push(decoded);
  }
  return slices;
}

function chunkBody(body: string, maxChunkTokens: number): string[] {
  const fragments = body
    .split(/\n{2,}/)
    .flatMap((paragraph) =>
      splitOversizedFragment(paragraph.trim(), maxChunkTokens)
    )
    .filter(Boolean);
  if (fragments.length === 0) return [""];

  const chunks: string[] = [];
  let current = "";
  for (const fragment of fragments) {
    const candidate = current ? `${current}\n\n${fragment}` : fragment;
    if (
      current &&
      countConversationTokens(candidate) > maxChunkTokens
    ) {
      chunks.push(current);
      current = fragment;
    } else {
      current = candidate;
    }
  }
  if (current || chunks.length === 0) chunks.push(current);
  return chunks;
}

function chunkMessage(
  message: TrustedEmailMessage,
  maxChunkTokens: number
): ConversationContextChunk[] {
  const texts = chunkBody(message.body, maxChunkTokens);
  return texts.map((text, chunkIndex) => {
    const chunkCount = texts.length;
    return {
      chunkId: `${message.evidenceKey}:${chunkIndex}`,
      messageId: message.providerMessageId,
      evidenceKey: message.evidenceKey,
      providerThreadId: message.providerThreadId,
      occurredAt: message.occurredAt,
      direction: message.direction,
      authorRole: message.authorRole,
      subject: message.subject,
      text,
      chunkIndex,
      chunkCount,
      partial: chunkCount > 1,
      tokenCount: countConversationTokens(text),
    };
  });
}

function renderChunk(chunk: ConversationContextChunk): string {
  return [
    `[${chunk.chunkId}] ${chunk.occurredAt} ${chunk.authorRole} ${chunk.direction}`,
    `Subject: ${chunk.subject || "—"}`,
    chunk.text || "—",
  ].join("\n");
}

function renderFold(fold: ConversationFold): string {
  const observations = Object.fromEntries(
    Object.entries(fold.observations).map(([kind, facts]) => [
      kind,
      facts.map((fact) => ({
        at: fact.at,
        author_role: fact.author_role,
        evidence_key: fact.evidence_key,
        text: truncateToTokens(fact.text, 80),
      })),
    ])
  );
  return JSON.stringify({
    source_message_count: fold.source_message_count,
    observations,
  });
}

function priorityChunks(
  messages: TrustedEmailMessage[],
  chunks: ConversationContextChunk[],
  fold: ConversationFold
): ConversationContextChunk[] {
  const newestFirst = [...messages].sort(
    (left, right) =>
      right.occurredAt.localeCompare(left.occurredAt) ||
      right.providerMessageId.localeCompare(left.providerMessageId)
  );
  const chunksByMessage = new Map<string, ConversationContextChunk[]>();
  for (const chunk of chunks) {
    const current = chunksByMessage.get(chunk.messageId) ?? [];
    current.push(chunk);
    chunksByMessage.set(chunk.messageId, current);
  }

  const ordered: ConversationContextChunk[] = [];
  const seen = new Set<string>();
  const add = (chunk: ConversationContextChunk | undefined) => {
    if (!chunk || seen.has(chunk.chunkId)) return;
    seen.add(chunk.chunkId);
    ordered.push(chunk);
  };
  const addMessage = (message: TrustedEmailMessage | undefined) => {
    if (!message) return;
    for (const chunk of chunksByMessage.get(message.providerMessageId) ?? []) {
      add(chunk);
    }
  };

  addMessage(newestFirst.find((message) => message.authorRole === "customer"));

  for (const kind of Object.keys(fold.observations) as ConversationFactKind[]) {
    const newestFact = fold.observations[kind].at(-1);
    if (!newestFact) continue;
    add(
      chunks.find(
        (chunk) =>
          chunk.evidenceKey === newestFact.evidence_key &&
          chunk.text.toLowerCase().includes(
            newestFact.text.slice(0, 40).toLowerCase()
          )
      ) ??
        chunks.find(
          (chunk) => chunk.evidenceKey === newestFact.evidence_key
        )
    );
  }

  addMessage(newestFirst[0]);

  let expectedRole: "customer" | "operator" =
    newestFirst[0]?.authorRole === "customer" ? "operator" : "customer";
  const remaining = [...newestFirst];
  while (remaining.length > 0) {
    const index = remaining.findIndex(
      (message) => message.authorRole === expectedRole
    );
    const [next] = remaining.splice(index >= 0 ? index : 0, 1);
    addMessage(next);
    expectedRole = expectedRole === "customer" ? "operator" : "customer";
  }
  return ordered;
}

function manifestFor(
  messages: TrustedEmailMessage[],
  allChunks: ConversationContextChunk[],
  selectedChunks: ConversationContextChunk[]
): ConversationContextManifest {
  const selectedByMessage = new Map<string, number>();
  for (const chunk of selectedChunks) {
    selectedByMessage.set(
      chunk.messageId,
      (selectedByMessage.get(chunk.messageId) ?? 0) + 1
    );
  }
  const includedMessageIds = messages
    .filter((message) => selectedByMessage.has(message.providerMessageId))
    .map((message) => message.providerMessageId);
  const omitted = messages.filter(
    (message) => !selectedByMessage.has(message.providerMessageId)
  );
  const totalChunksByMessage = new Map<string, number>();
  for (const chunk of allChunks) {
    totalChunksByMessage.set(chunk.messageId, chunk.chunkCount);
  }
  const partialMessageIds = includedMessageIds.filter(
    (messageId) =>
      (selectedByMessage.get(messageId) ?? 0) <
      (totalChunksByMessage.get(messageId) ?? 0)
  );
  const omittedDates = omitted
    .map((message) => message.occurredAt)
    .sort((left, right) => left.localeCompare(right));
  const clipped = omitted.length > 0 || partialMessageIds.length > 0;
  return {
    clipped,
    totalMessages: messages.length,
    includedMessages: includedMessageIds.length,
    omittedMessages: omitted.length,
    includedMessageIds,
    omittedMessageIds: omitted.map((message) => message.providerMessageId),
    partialMessageIds,
    omittedDateRange:
      omittedDates.length > 0
        ? {
            from: omittedDates[0],
            to: omittedDates.at(-1)!,
          }
        : null,
    retrievalAvailable: clipped,
  };
}

function renderPack(input: {
  currentFacts: Record<string, unknown> | null;
  olderSummary: string | null;
  fold: ConversationFold;
  manifest: ConversationContextManifest;
  chunks: ConversationContextChunk[];
}): string {
  return [
    "CURRENT FACTS",
    JSON.stringify(input.currentFacts ?? {}),
    "",
    "OLDER SUMMARY",
    input.olderSummary?.trim() || "—",
    "",
    "FULL-HISTORY FACT FOLD",
    renderFold(input.fold),
    "",
    "CONTEXT MANIFEST",
    JSON.stringify(input.manifest),
    "",
    "SELECTED CONVERSATION",
    input.chunks.map(renderChunk).join("\n\n") || "—",
  ].join("\n");
}

export function buildConversationContextPack(
  input: BuildConversationContextPackInput
): ConversationContextPack {
  const tokenBudget = Math.max(256, input.tokenBudget ?? DEFAULT_CONVERSATION_CONTEXT_TOKEN_BUDGET);
  const maxChunkTokens = Math.max(
    40,
    input.maxChunkTokens ?? DEFAULT_MAX_CHUNK_TOKENS
  );
  const messages = [...input.messages].sort(
    (left, right) =>
      left.occurredAt.localeCompare(right.occurredAt) ||
      left.providerMessageId.localeCompare(right.providerMessageId)
  );
  const allChunks = messages.flatMap((message) =>
    chunkMessage(message, maxChunkTokens)
  );
  const fold = buildConversationFold(messages, 0);
  const candidates = priorityChunks(messages, allChunks, fold);
  const selectedPriority: ConversationContextChunk[] = [];

  const emptyManifest = manifestFor(messages, allChunks, []);
  const fixedText = renderPack({
    currentFacts: input.currentFacts ?? null,
    olderSummary: input.olderSummary ?? null,
    fold,
    manifest: emptyManifest,
    chunks: [],
  });
  let available =
    tokenBudget -
    countConversationTokens(fixedText) -
    MANIFEST_TOKEN_RESERVE;
  for (const chunk of candidates) {
    const renderedTokens = countConversationTokens(renderChunk(chunk)) + 2;
    if (renderedTokens > available) continue;
    selectedPriority.push(chunk);
    available -= renderedTokens;
  }

  const chronological = () =>
    [...selectedPriority].sort(
      (left, right) =>
        left.occurredAt.localeCompare(right.occurredAt) ||
        left.messageId.localeCompare(right.messageId) ||
        left.chunkIndex - right.chunkIndex
    );
  let selectedChunks = chronological();
  let manifest = manifestFor(messages, allChunks, selectedChunks);
  let promptText = renderPack({
    currentFacts: input.currentFacts ?? null,
    olderSummary: input.olderSummary ?? null,
    fold,
    manifest,
    chunks: selectedChunks,
  });
  while (
    countConversationTokens(promptText) > tokenBudget &&
    selectedPriority.length > 0
  ) {
    selectedPriority.pop();
    selectedChunks = chronological();
    manifest = manifestFor(messages, allChunks, selectedChunks);
    promptText = renderPack({
      currentFacts: input.currentFacts ?? null,
      olderSummary: input.olderSummary ?? null,
      fold,
      manifest,
      chunks: selectedChunks,
    });
  }
  if (countConversationTokens(promptText) > tokenBudget) {
    promptText = truncateToTokens(promptText, tokenBudget);
  }

  return {
    promptText,
    selectedChunks,
    factFold: fold,
    manifest,
    tokenCount: countConversationTokens(promptText),
  };
}

function queryTerms(value: string | null | undefined): string[] {
  return [
    ...new Set(
      (value ?? "")
        .toLowerCase()
        .split(/[^a-z0-9$]+/)
        .filter((term) => term.length >= 3)
    ),
  ];
}

export function retrieveConversationContext(input: {
  messages: TrustedEmailMessage[];
  request: ConversationContextRetrievalRequest;
  tokenBudget?: number;
  maxChunkTokens?: number;
}): ConversationContextRetrievalResult {
  const tokenBudget = Math.max(
    80,
    input.tokenBudget ?? DEFAULT_CONVERSATION_RETRIEVAL_TOKEN_BUDGET
  );
  const maxChunkTokens = Math.max(
    40,
    input.maxChunkTokens ?? DEFAULT_MAX_CHUNK_TOKENS
  );
  const authorizedEvidence = new Set(
    input.messages.map((message) => message.evidenceKey)
  );
  const requestedEvidence = new Set(
    (input.request.evidenceKeys ?? []).filter((key) =>
      authorizedEvidence.has(key)
    )
  );
  const terms = queryTerms(input.request.query);
  const beforeMs = Date.parse(input.request.before ?? "");
  const afterMs = Date.parse(input.request.after ?? "");
  const allChunks = input.messages
    .filter((message) => {
      const occurredAtMs = Date.parse(message.occurredAt);
      if (Number.isFinite(beforeMs) && occurredAtMs >= beforeMs) return false;
      if (Number.isFinite(afterMs) && occurredAtMs <= afterMs) return false;
      if (
        requestedEvidence.size > 0 &&
        !requestedEvidence.has(message.evidenceKey)
      ) {
        return false;
      }
      return true;
    })
    .flatMap((message) => chunkMessage(message, maxChunkTokens));
  const candidates = allChunks
    .map((chunk) => {
      let score = requestedEvidence.has(chunk.evidenceKey) ? 100 : 0;
      if (input.request.factKind) {
        const pattern = CONVERSATION_FACT_PATTERNS[input.request.factKind];
        pattern.lastIndex = 0;
        if (pattern.test(chunk.text)) score += 25;
        else return { chunk, score: -1 };
      }
      const lower = `${chunk.subject}\n${chunk.text}`.toLowerCase();
      score += terms.filter((term) => lower.includes(term)).length * 10;
      if (
        terms.length > 0 &&
        !terms.some((term) => lower.includes(term)) &&
        requestedEvidence.size === 0
      ) {
        return { chunk, score: -1 };
      }
      return { chunk, score };
    })
    .filter(({ score }) => score >= 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.chunk.occurredAt.localeCompare(left.chunk.occurredAt) ||
        left.chunk.chunkIndex - right.chunk.chunkIndex
    );

  const chunks: ConversationContextChunk[] = [];
  let remaining = tokenBudget;
  const addChunk = (chunk: ConversationContextChunk | undefined) => {
    if (!chunk) return;
    if (chunks.some((selected) => selected.chunkId === chunk.chunkId)) {
      return;
    }
    const renderedTokens = countConversationTokens(renderChunk(chunk)) + 2;
    if (renderedTokens > remaining) return;
    chunks.push(chunk);
    remaining -= renderedTokens;
  };
  for (const { chunk } of candidates) {
    addChunk(chunk);
    for (const adjacentIndex of [
      chunk.chunkIndex - 1,
      chunk.chunkIndex + 1,
    ]) {
      addChunk(
        allChunks.find(
          (candidate) =>
            candidate.messageId === chunk.messageId &&
            candidate.chunkIndex === adjacentIndex
        )
      );
    }
  }
  chunks.sort(
    (left, right) =>
      left.occurredAt.localeCompare(right.occurredAt) ||
      left.messageId.localeCompare(right.messageId) ||
      left.chunkIndex - right.chunkIndex
  );
  const text = chunks.map(renderChunk).join("\n\n");
  return {
    text,
    chunks,
    tokenCount: countConversationTokens(text),
    unresolved: chunks.length === 0,
  };
}

export function canRetrieveConversationContext(round: number): boolean {
  return (
    Number.isInteger(round) &&
    round >= 0 &&
    round < MAX_CONVERSATION_CONTEXT_RETRIEVAL_ROUNDS
  );
}
