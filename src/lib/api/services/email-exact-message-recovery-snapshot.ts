import { createHash } from "node:crypto";

import type {
  EmailExactMessageRecoveryManifest,
  EmailExactMessageRecoveryProviderReader,
} from "./email-exact-message-recovery-service";
import type { NormalizedEmail } from "./email-provider";

const SIMPLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TEXT_LENGTH = 10 * 1024 * 1024;
const SNAPSHOT_MESSAGE_KEYS = [
  "bodyText",
  "cc",
  "from",
  "fromName",
  "hasAttachments",
  "id",
  "isRead",
  "labelIds",
  "occurredAt",
  "snippet",
  "subject",
  "threadId",
  "to",
].sort();

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)])
    );
  }
  return value;
}

export function buildEmailExactMessageRecoverySnapshotHash(
  value: unknown
): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

interface RecoverySnapshotManifest {
  connectionId: string;
  entries: Array<{
    providerThreadId: string;
    providerMessageId: string;
    providerOccurredAt: string;
  }>;
}

function assertRecord(
  value: unknown,
  label: string
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function requiredString(
  value: unknown,
  label: string,
  maxLength = MAX_TEXT_LENGTH
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    throw new Error(`${label} must be a non-empty bounded string`);
  }
  return value;
}

function optionalText(
  value: unknown,
  label: string,
  maxLength = MAX_TEXT_LENGTH
): string {
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(`${label} must be bounded text`);
  }
  return value;
}

function normalizedEmail(value: unknown, label: string): string {
  const email = requiredString(value, label, 320);
  if (email !== email.toLowerCase() || !SIMPLE_EMAIL_PATTERN.test(email)) {
    throw new Error(`${label} must be a normalized email`);
  }
  return email;
}

function normalizedEmailList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 200) {
    throw new Error(`${label} must be a bounded email array`);
  }
  const emails = value.map((email, index) =>
    normalizedEmail(email, `${label}[${index}]`)
  );
  if (new Set(emails).size !== emails.length) {
    throw new Error(`${label} must not contain duplicates`);
  }
  return emails;
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 500) {
    throw new Error(`${label} must be a bounded string array`);
  }
  const strings = value.map((item, index) =>
    requiredString(item, `${label}[${index}]`, 500)
  );
  if (new Set(strings).size !== strings.length) {
    throw new Error(`${label} must not contain duplicates`);
  }
  return strings;
}

function exactDate(value: unknown, label: string): Date {
  const timestamp = requiredString(value, label, 64);
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== timestamp) {
    throw new Error(`${label} must be an exact RFC3339 timestamp`);
  }
  return date;
}

function snapshotMessage(
  value: unknown,
  index: number,
  expected: RecoverySnapshotManifest["entries"][number]
): NormalizedEmail {
  const label = `provider snapshot messages[${index}]`;
  assertRecord(value, label);
  if (Object.keys(value).sort().join(",") !== SNAPSHOT_MESSAGE_KEYS.join(",")) {
    throw new Error(`${label} contains unsupported fields`);
  }

  const id = requiredString(value.id, `${label}.id`, 2_048);
  const threadId = requiredString(value.threadId, `${label}.threadId`, 2_048);
  const date = exactDate(value.occurredAt, `${label}.occurredAt`);
  if (
    id !== expected.providerMessageId ||
    threadId !== expected.providerThreadId ||
    date.toISOString() !== expected.providerOccurredAt
  ) {
    throw new Error("provider snapshot message identity changed");
  }
  if (typeof value.hasAttachments !== "boolean") {
    throw new Error(`${label}.hasAttachments must be boolean`);
  }
  if (value.hasAttachments) {
    throw new Error("provider snapshot recovery does not support attachments");
  }
  if (typeof value.isRead !== "boolean") {
    throw new Error(`${label}.isRead must be boolean`);
  }

  const from = normalizedEmail(value.from, `${label}.from`);
  const fromName = optionalText(value.fromName, `${label}.fromName`, 500);
  const to = normalizedEmailList(value.to, `${label}.to`);
  const cc = normalizedEmailList(value.cc, `${label}.cc`);
  const subject = optionalText(value.subject, `${label}.subject`, 2_048);
  const snippet = optionalText(value.snippet, `${label}.snippet`);
  const bodyText = optionalText(value.bodyText, `${label}.bodyText`);
  const labelIds = stringList(value.labelIds, `${label}.labelIds`);
  return {
    id,
    threadId,
    from,
    fromName,
    to,
    cc,
    subject,
    snippet,
    bodyText,
    // The connector snapshot does not expose provider authentication results.
    // Never promote a visible From header into authenticated transport proof.
    authenticatedFromDomains: [],
    date,
    labelIds,
    isRead: value.isRead,
    hasAttachments: false,
    sizeEstimate: Buffer.byteLength(
      [subject, snippet, bodyText].join("\n"),
      "utf8"
    ),
  };
}

export function createEmailExactMessageRecoverySnapshotProvider(
  value: unknown,
  manifest: EmailExactMessageRecoveryManifest | RecoverySnapshotManifest
): EmailExactMessageRecoveryProviderReader {
  assertRecord(value, "provider snapshot");
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "connectionId,messages,schemaVersion") {
    throw new Error("provider snapshot contains unsupported fields");
  }
  if (value.schemaVersion !== 1) {
    throw new Error("provider snapshot schemaVersion must be 1");
  }
  if (value.connectionId !== manifest.connectionId) {
    throw new Error("provider snapshot connection identity changed");
  }
  if (
    !Array.isArray(value.messages) ||
    value.messages.length !== manifest.entries.length
  ) {
    throw new Error(
      "provider snapshot must contain exactly the manifest messages"
    );
  }

  const expectedByKey = new Map(
    manifest.entries.map((entry) => [
      `${entry.providerThreadId}\u0000${entry.providerMessageId}`,
      entry,
    ])
  );
  if (expectedByKey.size !== manifest.entries.length) {
    throw new Error("manifest exact message identities must be unique");
  }

  const messagesByThread = new Map<string, NormalizedEmail[]>();
  const seenKeys = new Set<string>();
  for (const [index, rawMessage] of value.messages.entries()) {
    assertRecord(rawMessage, `provider snapshot messages[${index}]`);
    const key = `${String(rawMessage.threadId)}\u0000${String(rawMessage.id)}`;
    const expected = expectedByKey.get(key);
    if (!expected || seenKeys.has(key)) {
      throw new Error("provider snapshot message identity changed");
    }
    const message = snapshotMessage(rawMessage, index, expected);
    seenKeys.add(key);
    const threadMessages = messagesByThread.get(message.threadId) ?? [];
    threadMessages.push(message);
    messagesByThread.set(message.threadId, threadMessages);
  }
  if (seenKeys.size !== manifest.entries.length) {
    throw new Error(
      "provider snapshot must contain exactly the manifest messages"
    );
  }

  return {
    async fetchThread(threadId: string): Promise<NormalizedEmail[]> {
      return [...(messagesByThread.get(threadId) ?? [])];
    },
  };
}
