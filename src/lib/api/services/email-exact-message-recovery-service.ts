import { createHash } from "node:crypto";

import { startOfDay, subDays } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  NormalizedEmail,
  ProviderReadPolicy,
} from "@/lib/api/services/email-provider";

const VANCOUVER_TIME_ZONE = "America/Vancouver";
const RECOVERY_WINDOW_DAYS = 7;
const RECOVERY_MANIFEST_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SIMPLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EXACT_RFC3339_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/;

export interface EmailExactMessageRecoveryOpportunitySnapshot {
  updatedAt: string;
  stage: string;
  stageManuallySet: boolean;
  assignedTo: string | null;
  assignmentVersion: number;
  projectId: string | null;
}

export interface EmailExactMessageRecoveryUnansweredDraftProjection {
  workstream: "sales" | "warranty" | "service" | "current_project";
  responseDisposition: "reply_required" | "no_reply_required";
  conversationScope: "message";
}

interface EmailExactMessageRecoveryEntryBase {
  providerThreadId: string;
  providerMessageId: string;
  providerOccurredAt: string;
  unansweredDraftProjection?: EmailExactMessageRecoveryUnansweredDraftProjection;
}

export interface EmailExactMessageRecoveryIngestEntry extends EmailExactMessageRecoveryEntryBase {
  action: "ingest";
}

export interface EmailExactMessageRecoveryReparentEntry extends EmailExactMessageRecoveryEntryBase {
  action: "reparent";
  sourceOpportunityId: string;
  targetOpportunityId: string;
  activityId: string;
  correspondenceEventId: string;
  targetEmail: string;
  sourceSnapshot: EmailExactMessageRecoveryOpportunitySnapshot;
  targetSnapshot: EmailExactMessageRecoveryOpportunitySnapshot;
}

export interface EmailExactMessageRecoveryCreateTargetEntry extends EmailExactMessageRecoveryEntryBase {
  action: "create_target_and_reparent";
  sourceOpportunityId: string;
  activityId: string;
  correspondenceEventId: string;
  targetEmail: string;
  targetLead: {
    sourceThreadKey: string;
    title: string;
    contactName: string | null;
  };
  sourceSnapshot: EmailExactMessageRecoveryOpportunitySnapshot;
}

export type EmailExactMessageRecoveryEntry =
  | EmailExactMessageRecoveryIngestEntry
  | EmailExactMessageRecoveryReparentEntry
  | EmailExactMessageRecoveryCreateTargetEntry;

export interface EmailExactMessageRecoveryManifest {
  schemaVersion: 1;
  companyId: string;
  actorUserId: string;
  connectionId: string;
  generatedAt: string;
  cutoffAt: string;
  entries: EmailExactMessageRecoveryEntry[];
}

export interface EmailExactMessageRecoveryProviderReader {
  fetchThread(
    threadId: string,
    readPolicy?: ProviderReadPolicy
  ): Promise<NormalizedEmail[]>;
}

export interface EmailExactMessageRecoveryInspection {
  activity: {
    id: string;
    opportunityId: string | null;
    direction: string | null;
    fromEmail: string | null;
    toEmails: string[];
    ccEmails: string[];
  };
  correspondenceEvent: {
    id: string;
    activityId: string | null;
    opportunityId: string;
    projectionApplied: boolean;
    direction: string;
    partyRole: string;
    isMeaningful: boolean;
  };
  sourceSnapshot: EmailExactMessageRecoveryOpportunitySnapshot;
  targetSnapshot: EmailExactMessageRecoveryOpportunitySnapshot;
  targetIdentityEmails: string[];
}

export interface EmailExactMessageRecoveryCreateTargetInspection {
  activity: {
    id: string;
    opportunityId: string | null;
    connectionId: string | null;
    direction: string | null;
    fromEmail: string | null;
  };
  correspondenceEvent: {
    id: string;
    activityId: string | null;
    opportunityId: string;
    projectionApplied: boolean;
    direction: string;
    partyRole: string;
    isMeaningful: boolean;
    fromEmail: string | null;
  };
  sourceSnapshot: EmailExactMessageRecoveryOpportunitySnapshot;
  existingTarget: {
    id: string;
    sourceThreadKey: string;
    identityEmails: string[];
  } | null;
}

export interface EmailExactMessageRecoveryReparentInput {
  companyId: string;
  actorUserId: string;
  connectionId: string;
  providerThreadId: string;
  providerMessageId: string;
  sourceOpportunityId: string;
  targetOpportunityId: string;
  activityId: string;
  correspondenceEventId: string;
  targetEmail: string;
  sourceSnapshot: EmailExactMessageRecoveryOpportunitySnapshot;
  targetSnapshot: EmailExactMessageRecoveryOpportunitySnapshot;
  manifestSha256: string;
  entrySha256: string;
}

export interface EmailExactMessageRecoveryCreateTargetInput {
  companyId: string;
  actorUserId: string;
  connectionId: string;
  providerThreadId: string;
  providerMessageId: string;
  sourceOpportunityId: string;
  activityId: string;
  correspondenceEventId: string;
  targetEmail: string;
  targetLead: EmailExactMessageRecoveryCreateTargetEntry["targetLead"];
  sourceSnapshot: EmailExactMessageRecoveryOpportunitySnapshot;
  manifestSha256: string;
  entrySha256: string;
}

export interface EmailExactMessageRecoveryReparentResult {
  applied: boolean;
  alreadyApplied: boolean;
  pendingAttachmentAttribution: boolean;
  activityId: string;
  correspondenceEventId: string;
  sourceOpportunityId: string;
  targetOpportunityId: string;
}

export interface EmailExactMessageRecoveryApplicationInspection {
  status: "attachment_pending" | "complete";
}

export interface EmailExactMessageRecoveryWorkState {
  action: EmailExactMessageRecoveryEntry["action"];
  activityId: string | null;
  opportunityId: string | null;
  sourceOpportunityId: string | null;
  targetOpportunityId: string | null;
  correspondenceEventId: string | null;
  message: NormalizedEmail;
  mutationCompleted: boolean;
  attachmentRequired: boolean;
  attachmentCompleted: boolean;
  repairRequired: boolean;
  repairCompleted: boolean;
  draftProjectionRequired: boolean;
  draftProjectionCompleted: boolean;
}

export type EmailExactMessageRecoveryWorkStep =
  | "mutation"
  | "attachment"
  | "repair"
  | "draft_projection";

export interface EmailExactMessageRecoveryStore {
  findExactActivity(input: {
    companyId: string;
    connectionId: string;
    providerThreadId: string;
    providerMessageId: string;
  }): Promise<{ activityId: string; opportunityId: string | null } | null>;
  inspectExactMessage(
    input: EmailExactMessageRecoveryReparentInput
  ): Promise<EmailExactMessageRecoveryInspection>;
  reparentExactMessage(
    input: EmailExactMessageRecoveryReparentInput
  ): Promise<EmailExactMessageRecoveryReparentResult>;
  inspectExactMessageForTargetCreation(
    input: EmailExactMessageRecoveryCreateTargetInput
  ): Promise<EmailExactMessageRecoveryCreateTargetInspection>;
  createTargetAndReparentExactMessage(
    input: EmailExactMessageRecoveryCreateTargetInput
  ): Promise<EmailExactMessageRecoveryReparentResult>;
  inspectRecoveryApplication(input: {
    companyId: string;
    connectionId: string;
    providerThreadId: string;
    providerMessageId: string;
    manifestSha256: string;
    entrySha256: string;
  }): Promise<EmailExactMessageRecoveryApplicationInspection | null>;
  inspectRecoveryWork(input: {
    companyId: string;
    connectionId: string;
    providerThreadId: string;
    providerMessageId: string;
    manifestSha256: string;
    entrySha256: string;
  }): Promise<EmailExactMessageRecoveryWorkState | null>;
  registerRecoveryWork(input: {
    companyId: string;
    actorUserId: string;
    connectionId: string;
    providerThreadId: string;
    providerMessageId: string;
    action: EmailExactMessageRecoveryEntry["action"];
    manifestSha256: string;
    entrySha256: string;
    manifestGeneratedAt: string;
    manifestCutoffAt: string;
    activityId: string | null;
    opportunityId: string | null;
    sourceOpportunityId: string | null;
    targetOpportunityId: string | null;
    correspondenceEventId: string | null;
    attachmentRequired: boolean;
    repairRequired: boolean;
    draftProjectionRequired: boolean;
    message: NormalizedEmail;
  }): Promise<EmailExactMessageRecoveryWorkState>;
  abandonRecoveryWork(input: {
    actorUserId: string;
    companyId: string;
    connectionId: string;
    providerThreadId: string;
    providerMessageId: string;
    priorManifestSha256: string;
    priorEntrySha256: string;
    supersedingManifestSha256: string;
    supersedingEntrySha256: string;
  }): Promise<boolean>;
  markRecoveryWorkStep(input: {
    companyId: string;
    actorUserId: string;
    connectionId: string;
    providerThreadId: string;
    providerMessageId: string;
    manifestSha256: string;
    entrySha256: string;
    step: EmailExactMessageRecoveryWorkStep;
    activityId: string | null;
    opportunityId: string | null;
    sourceOpportunityId: string | null;
    targetOpportunityId: string | null;
    correspondenceEventId: string | null;
  }): Promise<EmailExactMessageRecoveryWorkState>;
}

export interface EmailExactMessageRecoveryIngestInput {
  companyId: string;
  actorUserId: string;
  connectionId: string;
  entry: EmailExactMessageRecoveryIngestEntry;
  message: NormalizedEmail;
  manifestSha256: string;
  entrySha256: string;
}

export interface EmailExactMessageRecoveryIngestResult {
  applied: boolean;
  alreadyApplied: boolean;
  activityId: string;
  opportunityId: string | null;
}

export type EmailExactMessageRecoveryIngestAdapter = (
  input: EmailExactMessageRecoveryIngestInput
) => Promise<EmailExactMessageRecoveryIngestResult>;

export interface EmailExactMessageRecoveryReparentRepairInput {
  companyId: string;
  actorUserId: string;
  connectionId: string;
  entry:
    | EmailExactMessageRecoveryReparentEntry
    | EmailExactMessageRecoveryCreateTargetEntry;
  message: NormalizedEmail;
  sourceOpportunityId: string;
  targetOpportunityId: string;
  activityId: string;
  correspondenceEventId: string;
  manifestSha256: string;
  entrySha256: string;
}

/**
 * Canonical, retry-safe post-move repair. Implementations must rebuild the
 * message-scoped target evidence, evaluate the guarded target commercial
 * outcome, and refresh both source and target lead summaries. Throw unless all
 * three operations complete; the caller will retry the exact approved entry.
 */
export type EmailExactMessageRecoveryReparentRepairAdapter = (
  input: EmailExactMessageRecoveryReparentRepairInput
) => Promise<void>;

export interface EmailExactMessageRecoveryDraftProjectionInput {
  companyId: string;
  actorUserId: string;
  connectionId: string;
  entry: EmailExactMessageRecoveryEntry;
  message: NormalizedEmail;
  opportunityId: string;
  activityId: string;
  correspondenceEventId: string | null;
  projection: EmailExactMessageRecoveryUnansweredDraftProjection;
  manifestSha256: string;
  entrySha256: string;
}

export type EmailExactMessageRecoveryDraftProjectionAdapter = (
  input: EmailExactMessageRecoveryDraftProjectionInput
) => Promise<void>;

export interface EmailExactMessageRecoveryResultEntry {
  action: EmailExactMessageRecoveryEntry["action"];
  providerThreadId: string;
  providerMessageId: string;
  status:
    | "ready"
    | "applied"
    | "already_applied"
    | "pending_attachment_attribution"
    | "skipped_expired";
  activityId: string | null;
  opportunityId: string | null;
}

export interface EmailExactMessageRecoveryResult {
  mode: "dry-run" | "apply";
  manifestSha256: string;
  cutoffAt: string;
  entries: EmailExactMessageRecoveryResultEntry[];
}

export interface SupersedeEmailExactMessageRecoveryResult {
  priorManifestSha256: string;
  supersedingManifestSha256: string;
  providerMessageIds: string[];
}

interface RunEmailExactMessageRecoveryInput {
  manifest: EmailExactMessageRecoveryManifest;
  provider: EmailExactMessageRecoveryProviderReader;
  store: EmailExactMessageRecoveryStore;
  ingestExactMessage: EmailExactMessageRecoveryIngestAdapter;
  repairReparentedMessage?: EmailExactMessageRecoveryReparentRepairAdapter;
  projectUnansweredDraft?: EmailExactMessageRecoveryDraftProjectionAdapter;
  now?: Date;
  apply?: boolean;
  approvedManifestSha256?: string | null;
}

interface ValidatedEntry {
  entry: EmailExactMessageRecoveryEntry;
  message: NormalizedEmail;
  entrySha256: string;
  inspection?: EmailExactMessageRecoveryInspection;
  createTargetInspection?: EmailExactMessageRecoveryCreateTargetInspection;
  alreadyAppliedActivity?: {
    activityId: string;
    opportunityId: string | null;
  };
  workState?: EmailExactMessageRecoveryWorkState;
}

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

function sha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export function buildEmailExactMessageRecoveryManifestHash(
  manifest: EmailExactMessageRecoveryManifest
): string {
  return sha256(manifest);
}

export function computeVancouverSevenDayCutoff(now: Date): Date {
  assertValidDate(now, "now");
  const vancouverNow = toZonedTime(now, VANCOUVER_TIME_ZONE);
  const localCutoff = startOfDay(subDays(vancouverNow, RECOVERY_WINDOW_DAYS));
  return fromZonedTime(localCutoff, VANCOUVER_TIME_ZONE);
}

function assertValidDate(date: Date, label: string): void {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new Error(`${label} must be a valid date`);
  }
}

function parseExactIsoDate(value: unknown, label: string): Date {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required`);
  }
  const parsed = new Date(value);
  assertValidDate(parsed, label);
  if (parsed.toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp`);
  }
  return parsed;
}

function assertExactRfc3339Timestamp(value: unknown, label: string): void {
  if (typeof value !== "string") {
    throw new Error(`${label} is required`);
  }
  const match = EXACT_RFC3339_TIMESTAMP_PATTERN.exec(value);
  if (!match) {
    throw new Error(`${label} must be an exact RFC3339 timestamp`);
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = match[10] === undefined ? 0 : Number(match[10]);
  const offsetMinute = match[11] === undefined ? 0 : Number(match[11]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    daysInMonth === undefined ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59 ||
    !Number.isFinite(new Date(value).getTime())
  ) {
    throw new Error(`${label} must be an exact RFC3339 timestamp`);
  }
}

function assertUuid(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error(`${label} must be a UUID`);
  }
}

function assertNonBlank(
  value: unknown,
  label: string
): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required`);
  }
  if (value !== value.trim()) {
    throw new Error(`${label} must not contain surrounding whitespace`);
  }
}

function assertBoundedText(
  value: unknown,
  label: string,
  maxLength: number
): asserts value is string {
  assertNonBlank(value, label);
  if (value.length > maxLength) {
    throw new Error(`${label} must be at most ${maxLength} characters`);
  }
}

function assertSnapshot(
  value: unknown,
  label: string
): asserts value is EmailExactMessageRecoveryOpportunitySnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is required`);
  }
  const snapshot = value as Record<string, unknown>;
  assertExactRfc3339Timestamp(snapshot.updatedAt, `${label}.updatedAt`);
  assertNonBlank(snapshot.stage, `${label}.stage`);
  if (typeof snapshot.stageManuallySet !== "boolean") {
    throw new Error(`${label}.stageManuallySet must be boolean`);
  }
  if (snapshot.assignedTo !== null) {
    assertUuid(snapshot.assignedTo, `${label}.assignedTo`);
  }
  if (
    !Number.isSafeInteger(snapshot.assignmentVersion) ||
    Number(snapshot.assignmentVersion) < 0
  ) {
    throw new Error(
      `${label}.assignmentVersion must be a non-negative integer`
    );
  }
  if (snapshot.projectId !== null) {
    assertUuid(snapshot.projectId, `${label}.projectId`);
  }
}

function validateManifest(
  manifest: EmailExactMessageRecoveryManifest,
  now: Date
): Date {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("manifest must be an object");
  }
  if (manifest.schemaVersion !== 1) {
    throw new Error("manifest schemaVersion must be 1");
  }
  assertUuid(manifest.companyId, "manifest.companyId");
  assertUuid(manifest.actorUserId, "manifest.actorUserId");
  assertUuid(manifest.connectionId, "manifest.connectionId");
  const generatedAt = parseExactIsoDate(
    manifest.generatedAt,
    "manifest.generatedAt"
  );
  if (generatedAt.getTime() > now.getTime()) {
    throw new Error("manifest.generatedAt must not be in the future");
  }

  const expectedCutoff = computeVancouverSevenDayCutoff(generatedAt);
  const declaredCutoff = parseExactIsoDate(
    manifest.cutoffAt,
    "manifest.cutoffAt"
  );
  if (declaredCutoff.getTime() !== expectedCutoff.getTime()) {
    throw new Error(
      `manifest cutoff must equal its generated-at seven-day Vancouver cutoff ${expectedCutoff.toISOString()}`
    );
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    throw new Error("manifest.entries must contain at least one exact message");
  }

  const exactMessageKeys = new Set<string>();
  for (const [index, entry] of manifest.entries.entries()) {
    const label = `manifest.entries[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${label} must be an object`);
    }
    if (
      entry.action !== "ingest" &&
      entry.action !== "reparent" &&
      entry.action !== "create_target_and_reparent"
    ) {
      throw new Error(
        `${label}.action must be ingest, reparent, or create_target_and_reparent`
      );
    }
    assertNonBlank(entry.providerThreadId, `${label}.providerThreadId`);
    assertNonBlank(entry.providerMessageId, `${label}.providerMessageId`);
    const occurredAt = parseExactIsoDate(
      entry.providerOccurredAt,
      `${label}.providerOccurredAt`
    );
    if (
      occurredAt.getTime() < expectedCutoff.getTime() ||
      occurredAt.getTime() > generatedAt.getTime()
    ) {
      throw new Error(
        `${label} is outside the seven-day Vancouver recovery window`
      );
    }

    const exactMessageKey = [
      manifest.connectionId,
      entry.providerThreadId,
      entry.providerMessageId,
    ].join("\u0000");
    if (exactMessageKeys.has(exactMessageKey)) {
      throw new Error(`${label} duplicates an exact allowlisted message`);
    }
    exactMessageKeys.add(exactMessageKey);

    if (entry.unansweredDraftProjection !== undefined) {
      const projection = entry.unansweredDraftProjection;
      if (
        !projection ||
        typeof projection !== "object" ||
        Array.isArray(projection)
      ) {
        throw new Error(`${label}.unansweredDraftProjection must be an object`);
      }
      const keys = Object.keys(projection).sort();
      if (
        keys.join(",") !== "conversationScope,responseDisposition,workstream"
      ) {
        throw new Error(
          `${label}.unansweredDraftProjection contains unsupported fields`
        );
      }
      if (
        !["sales", "warranty", "service", "current_project"].includes(
          projection.workstream
        )
      ) {
        throw new Error(
          `${label}.unansweredDraftProjection.workstream is invalid`
        );
      }
      if (
        !["reply_required", "no_reply_required"].includes(
          projection.responseDisposition
        )
      ) {
        throw new Error(
          `${label}.unansweredDraftProjection.responseDisposition is invalid`
        );
      }
      if (projection.conversationScope !== "message") {
        throw new Error(
          `${label}.unansweredDraftProjection.conversationScope must be message`
        );
      }
    }

    if (
      entry.action === "reparent" ||
      entry.action === "create_target_and_reparent"
    ) {
      assertUuid(entry.sourceOpportunityId, `${label}.sourceOpportunityId`);
      assertUuid(entry.activityId, `${label}.activityId`);
      assertUuid(entry.correspondenceEventId, `${label}.correspondenceEventId`);
      assertNonBlank(entry.targetEmail, `${label}.targetEmail`);
      if (
        entry.targetEmail !== entry.targetEmail.toLowerCase() ||
        !SIMPLE_EMAIL_PATTERN.test(entry.targetEmail)
      ) {
        throw new Error(`${label}.targetEmail must be a normalized email`);
      }
      assertSnapshot(entry.sourceSnapshot, `${label}.sourceSnapshot`);
    }

    if (entry.action === "reparent") {
      assertUuid(entry.targetOpportunityId, `${label}.targetOpportunityId`);
      if (entry.sourceOpportunityId === entry.targetOpportunityId) {
        throw new Error(`${label} source and target opportunities must differ`);
      }
      assertSnapshot(entry.targetSnapshot, `${label}.targetSnapshot`);
    }

    if (entry.action === "create_target_and_reparent") {
      if (
        !entry.targetLead ||
        typeof entry.targetLead !== "object" ||
        Array.isArray(entry.targetLead)
      ) {
        throw new Error(`${label}.targetLead is required`);
      }
      const targetLeadKeys = Object.keys(entry.targetLead).sort();
      if (targetLeadKeys.join(",") !== "contactName,sourceThreadKey,title") {
        throw new Error(`${label}.targetLead contains unsupported fields`);
      }
      assertBoundedText(
        entry.targetLead.sourceThreadKey,
        `${label}.targetLead.sourceThreadKey`,
        2_048
      );
      const expectedSourceKeySuffix = `:${manifest.connectionId}:message:${entry.providerMessageId}`;
      if (
        !entry.targetLead.sourceThreadKey.startsWith("email:") ||
        !entry.targetLead.sourceThreadKey.endsWith(expectedSourceKeySuffix)
      ) {
        throw new Error(
          `${label}.targetLead.sourceThreadKey must be the canonical exact message key`
        );
      }
      assertBoundedText(
        entry.targetLead.title,
        `${label}.targetLead.title`,
        500
      );
      if (entry.targetLead.contactName !== null) {
        assertBoundedText(
          entry.targetLead.contactName,
          `${label}.targetLead.contactName`,
          200
        );
      }
    }
  }

  return expectedCutoff;
}

function snapshotsEqual(
  actual: EmailExactMessageRecoveryOpportunitySnapshot,
  expected: EmailExactMessageRecoveryOpportunitySnapshot
): boolean {
  return (
    actual.updatedAt === expected.updatedAt &&
    actual.stage === expected.stage &&
    actual.stageManuallySet === expected.stageManuallySet &&
    actual.assignedTo === expected.assignedTo &&
    actual.assignmentVersion === expected.assignmentVersion &&
    actual.projectId === expected.projectId
  );
}

/**
 * Explicitly release only reviewed, never-started durable rows so a newly
 * approved content-addressed manifest can register the same provider message.
 * The database independently re-proves current actor authority and unchanged
 * product state; this helper performs no provider read and no product write.
 */
export async function supersedeUnstartedEmailExactMessageRecoveryWork(input: {
  priorManifest: EmailExactMessageRecoveryManifest;
  supersedingManifest: EmailExactMessageRecoveryManifest;
  providerMessageIds: string[];
  approvedSupersedingManifestSha256: string;
  store: EmailExactMessageRecoveryStore;
  now?: Date;
}): Promise<SupersedeEmailExactMessageRecoveryResult> {
  const now = input.now ?? new Date();
  assertValidDate(now, "now");
  validateManifest(input.priorManifest, now);
  validateManifest(input.supersedingManifest, now);

  const priorManifestSha256 = sha256(input.priorManifest);
  const supersedingManifestSha256 = sha256(input.supersedingManifest);
  if (
    !SHA256_PATTERN.test(input.approvedSupersedingManifestSha256) ||
    input.approvedSupersedingManifestSha256 !== supersedingManifestSha256
  ) {
    throw new Error("approved superseding manifest sha256 does not match");
  }
  if (priorManifestSha256 === supersedingManifestSha256) {
    throw new Error("superseding manifest must differ from the prior manifest");
  }
  if (
    now.getTime() - new Date(input.supersedingManifest.generatedAt).getTime() >
    RECOVERY_MANIFEST_MAX_AGE_MS
  ) {
    throw new Error("superseding manifest.generatedAt is older than 24 hours");
  }
  if (
    input.priorManifest.companyId !== input.supersedingManifest.companyId ||
    input.priorManifest.connectionId !== input.supersedingManifest.connectionId
  ) {
    throw new Error("superseding manifest changed company or mailbox identity");
  }
  if (
    !Array.isArray(input.providerMessageIds) ||
    input.providerMessageIds.length !== 1
  ) {
    throw new Error(
      "reviewed supersession supports exactly one provider message per manifest"
    );
  }
  const providerMessageIds = [...new Set(input.providerMessageIds)];
  if (
    providerMessageIds.length !== input.providerMessageIds.length ||
    providerMessageIds.some(
      (providerMessageId) =>
        typeof providerMessageId !== "string" || providerMessageId.trim() === ""
    )
  ) {
    throw new Error(
      "supersession provider message ids must be unique and nonblank"
    );
  }
  if (
    input.supersedingManifest.entries.length !== 1 ||
    input.supersedingManifest.entries[0]?.providerMessageId !==
      providerMessageIds[0]
  ) {
    throw new Error(
      "superseding manifest must contain only the one explicitly selected message"
    );
  }
  const selectedProviderMessageIds = new Set(providerMessageIds);
  const priorProviderMessageIds = new Set(
    input.priorManifest.entries.map((entry) => entry.providerMessageId)
  );
  if (
    input.supersedingManifest.entries.some(
      (entry) =>
        priorProviderMessageIds.has(entry.providerMessageId) &&
        !selectedProviderMessageIds.has(entry.providerMessageId)
    )
  ) {
    throw new Error(
      "superseding manifest must omit prior rows that were not explicitly selected"
    );
  }

  for (const providerMessageId of providerMessageIds) {
    const priorEntry = input.priorManifest.entries.find(
      (entry) => entry.providerMessageId === providerMessageId
    );
    const supersedingEntry = input.supersedingManifest.entries.find(
      (entry) => entry.providerMessageId === providerMessageId
    );
    if (!priorEntry || !supersedingEntry) {
      throw new Error(
        "supersession message must exist uniquely in both reviewed manifests"
      );
    }
    if (
      priorEntry.providerThreadId !== supersedingEntry.providerThreadId ||
      priorEntry.providerOccurredAt !== supersedingEntry.providerOccurredAt
    ) {
      throw new Error("supersession changed exact provider message identity");
    }
    await input.store.abandonRecoveryWork({
      actorUserId: input.supersedingManifest.actorUserId,
      companyId: input.supersedingManifest.companyId,
      connectionId: input.supersedingManifest.connectionId,
      providerThreadId: priorEntry.providerThreadId,
      providerMessageId,
      priorManifestSha256,
      priorEntrySha256: sha256(priorEntry),
      supersedingManifestSha256,
      supersedingEntrySha256: sha256(supersedingEntry),
    });
  }

  return {
    priorManifestSha256,
    supersedingManifestSha256,
    providerMessageIds,
  };
}

function normalizedEmailSet(
  values: Array<string | null | undefined>
): Set<string> {
  return new Set(
    values
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

function validateReparentInspection(
  entry: EmailExactMessageRecoveryReparentEntry,
  inspection: EmailExactMessageRecoveryInspection
): void {
  if (inspection.activity.id !== entry.activityId) {
    throw new Error("exact activity identity changed");
  }
  if (
    inspection.correspondenceEvent.id !== entry.correspondenceEventId ||
    inspection.correspondenceEvent.activityId !== entry.activityId
  ) {
    throw new Error("exact correspondence event identity changed");
  }
  if (!inspection.correspondenceEvent.projectionApplied) {
    throw new Error("exact correspondence event projection is still pending");
  }
  if (
    inspection.activity.direction !== "inbound" ||
    inspection.correspondenceEvent.direction !== "inbound" ||
    inspection.correspondenceEvent.partyRole !== "customer" ||
    inspection.correspondenceEvent.isMeaningful !== true
  ) {
    throw new Error("exact event is not a meaningful customer inbound");
  }

  const activityOwner = inspection.activity.opportunityId;
  const eventOwner = inspection.correspondenceEvent.opportunityId;
  const isUnapplied =
    activityOwner === entry.sourceOpportunityId &&
    eventOwner === entry.sourceOpportunityId;
  const isAlreadyApplied =
    activityOwner === entry.targetOpportunityId &&
    eventOwner === entry.targetOpportunityId;
  if (!isUnapplied && !isAlreadyApplied) {
    throw new Error("exact message ownership changed");
  }

  if (isUnapplied) {
    if (!snapshotsEqual(inspection.sourceSnapshot, entry.sourceSnapshot)) {
      throw new Error("source opportunity snapshot changed");
    }
    if (!snapshotsEqual(inspection.targetSnapshot, entry.targetSnapshot)) {
      throw new Error("target opportunity snapshot changed");
    }
  }

  const activityParticipants = normalizedEmailSet([
    inspection.activity.fromEmail,
    ...inspection.activity.toEmails,
    ...inspection.activity.ccEmails,
  ]);
  if (!activityParticipants.has(entry.targetEmail)) {
    throw new Error("target email is not an exact activity participant");
  }
  if (
    !normalizedEmailSet(inspection.targetIdentityEmails).has(entry.targetEmail)
  ) {
    throw new Error("target email is not a persisted target customer identity");
  }
}

function validateCreateTargetInspection(
  entry: EmailExactMessageRecoveryCreateTargetEntry,
  inspection: EmailExactMessageRecoveryCreateTargetInspection,
  expectedConnectionId: string
): void {
  if (inspection.activity.id !== entry.activityId) {
    throw new Error("exact activity identity changed");
  }
  if (
    inspection.correspondenceEvent.id !== entry.correspondenceEventId ||
    inspection.correspondenceEvent.activityId !== entry.activityId
  ) {
    throw new Error("exact correspondence event identity changed");
  }
  if (!inspection.correspondenceEvent.projectionApplied) {
    throw new Error("exact correspondence event projection is still pending");
  }
  if (
    inspection.activity.direction !== "inbound" ||
    inspection.correspondenceEvent.direction !== "inbound" ||
    inspection.correspondenceEvent.partyRole !== "customer" ||
    inspection.correspondenceEvent.isMeaningful !== true
  ) {
    throw new Error("exact event is not a meaningful customer inbound");
  }
  if (
    inspection.activity.connectionId !== null &&
    inspection.activity.connectionId !== expectedConnectionId
  ) {
    throw new Error("exact activity mailbox identity changed");
  }
  if (
    !normalizedEmailSet([inspection.activity.fromEmail]).has(
      entry.targetEmail
    ) ||
    !normalizedEmailSet([inspection.correspondenceEvent.fromEmail]).has(
      entry.targetEmail
    )
  ) {
    throw new Error("target email is not the exact effective customer sender");
  }

  const existingTarget = inspection.existingTarget;
  const activityOwner = inspection.activity.opportunityId;
  const eventOwner = inspection.correspondenceEvent.opportunityId;
  const isUnapplied =
    activityOwner === entry.sourceOpportunityId &&
    eventOwner === entry.sourceOpportunityId;
  const isAlreadyApplied = Boolean(
    existingTarget &&
    activityOwner === existingTarget.id &&
    eventOwner === existingTarget.id
  );
  if (!isUnapplied && !isAlreadyApplied) {
    throw new Error("exact message ownership changed");
  }
  if (isUnapplied) {
    if (!snapshotsEqual(inspection.sourceSnapshot, entry.sourceSnapshot)) {
      throw new Error("source opportunity snapshot changed");
    }
  }

  if (!existingTarget) return;
  if (existingTarget.sourceThreadKey !== entry.targetLead.sourceThreadKey) {
    throw new Error("existing target source identity changed");
  }
  if (
    !normalizedEmailSet(existingTarget.identityEmails).has(entry.targetEmail)
  ) {
    throw new Error("target email is not a persisted target customer identity");
  }
}

function reparentInput(
  manifest: EmailExactMessageRecoveryManifest,
  entry: EmailExactMessageRecoveryReparentEntry,
  manifestSha256: string,
  entrySha256: string
): EmailExactMessageRecoveryReparentInput {
  return {
    companyId: manifest.companyId,
    actorUserId: manifest.actorUserId,
    connectionId: manifest.connectionId,
    providerThreadId: entry.providerThreadId,
    providerMessageId: entry.providerMessageId,
    sourceOpportunityId: entry.sourceOpportunityId,
    targetOpportunityId: entry.targetOpportunityId,
    activityId: entry.activityId,
    correspondenceEventId: entry.correspondenceEventId,
    targetEmail: entry.targetEmail,
    sourceSnapshot: entry.sourceSnapshot,
    targetSnapshot: entry.targetSnapshot,
    manifestSha256,
    entrySha256,
  };
}

function createTargetInput(
  manifest: EmailExactMessageRecoveryManifest,
  entry: EmailExactMessageRecoveryCreateTargetEntry,
  manifestSha256: string,
  entrySha256: string
): EmailExactMessageRecoveryCreateTargetInput {
  return {
    companyId: manifest.companyId,
    actorUserId: manifest.actorUserId,
    connectionId: manifest.connectionId,
    providerThreadId: entry.providerThreadId,
    providerMessageId: entry.providerMessageId,
    sourceOpportunityId: entry.sourceOpportunityId,
    activityId: entry.activityId,
    correspondenceEventId: entry.correspondenceEventId,
    targetEmail: entry.targetEmail,
    targetLead: entry.targetLead,
    sourceSnapshot: entry.sourceSnapshot,
    manifestSha256,
    entrySha256,
  };
}

async function loadExpiredManifestRecoveryWork(input: {
  manifest: EmailExactMessageRecoveryManifest;
  manifestSha256: string;
  store: EmailExactMessageRecoveryStore;
}): Promise<Map<string, EmailExactMessageRecoveryWorkState>> {
  const states = new Map<string, EmailExactMessageRecoveryWorkState>();
  for (const entry of input.manifest.entries) {
    const entrySha256 = sha256(entry);
    const state = await input.store.inspectRecoveryWork({
      companyId: input.manifest.companyId,
      connectionId: input.manifest.connectionId,
      providerThreadId: entry.providerThreadId,
      providerMessageId: entry.providerMessageId,
      manifestSha256: input.manifestSha256,
      entrySha256,
    });
    if (!state) continue;
    if (state.action !== entry.action) {
      throw new Error("expired recovery work action changed");
    }
    states.set(entrySha256, state);
  }

  if (states.size === 0) {
    throw new Error("manifest.generatedAt is older than 24 hours");
  }
  return states;
}

export async function runEmailExactMessageRecovery(
  input: RunEmailExactMessageRecoveryInput
): Promise<EmailExactMessageRecoveryResult> {
  const now = input.now ?? new Date();
  assertValidDate(now, "now");
  const cutoff = validateManifest(input.manifest, now);
  const manifestSha256 = buildEmailExactMessageRecoveryManifestHash(
    input.manifest
  );
  const apply = input.apply === true;
  const manifestExpired =
    now.getTime() - new Date(input.manifest.generatedAt).getTime() >
    RECOVERY_MANIFEST_MAX_AGE_MS;

  if (apply) {
    if (!SHA256_PATTERN.test(input.approvedManifestSha256 ?? "")) {
      throw new Error(
        "apply requires an approved manifest sha256 with 64 lowercase hexadecimal characters"
      );
    }
    if (input.approvedManifestSha256 !== manifestSha256) {
      throw new Error("approved manifest sha256 does not match");
    }
  }

  const expiredWorkStates = manifestExpired
    ? await loadExpiredManifestRecoveryWork({
        manifest: input.manifest,
        manifestSha256,
        store: input.store,
      })
    : null;

  const missingExpiredEntryCount = expiredWorkStates
    ? input.manifest.entries.reduce(
        (count, entry) =>
          count + (expiredWorkStates.has(sha256(entry)) ? 0 : 1),
        0
      )
    : 0;

  const executableEntries = input.manifest.entries.flatMap((entry) => {
    const state = expiredWorkStates?.get(sha256(entry));
    if (expiredWorkStates && (!state || recoveryWorkIsComplete(state))) {
      return [];
    }
    return [{ entry, state }];
  });
  if (apply) {
    if (
      executableEntries.some(
        ({ entry, state }) =>
          (entry.action === "reparent" ||
            entry.action === "create_target_and_reparent") &&
          state?.repairCompleted !== true
      ) &&
      !input.repairReparentedMessage
    ) {
      throw new Error(
        "reparent apply requires canonical post-move lifecycle and summary repair"
      );
    }
    if (
      executableEntries.some(
        ({ entry, state }) =>
          entry.unansweredDraftProjection !== undefined &&
          state?.draftProjectionCompleted !== true
      ) &&
      !input.projectUnansweredDraft
    ) {
      throw new Error(
        "apply requires an approved unanswered-draft projection adapter"
      );
    }
  }

  const messagesByThread = new Map<string, NormalizedEmail[]>();
  for (const entry of manifestExpired ? [] : input.manifest.entries) {
    if (!messagesByThread.has(entry.providerThreadId)) {
      messagesByThread.set(
        entry.providerThreadId,
        await input.provider.fetchThread(entry.providerThreadId, {
          context: "exact-message recovery manifest validation",
          oauthTokenMode: "current_only_no_persist",
        })
      );
    }
  }

  const validated: ValidatedEntry[] = [];
  for (const entry of input.manifest.entries) {
    const entrySha256 = sha256(entry);
    if (expiredWorkStates) {
      const workState = expiredWorkStates.get(entrySha256);
      if (!workState || recoveryWorkIsComplete(workState)) continue;
      if (
        workState.message.id !== entry.providerMessageId ||
        workState.message.threadId !== entry.providerThreadId ||
        workState.message.date.toISOString() !== entry.providerOccurredAt
      ) {
        throw new Error("expired recovery work message identity changed");
      }
      validated.push({
        entry,
        message: workState.message,
        entrySha256,
        workState,
      });
      continue;
    }

    const exactMatches = (
      messagesByThread.get(entry.providerThreadId) ?? []
    ).filter(
      (message) =>
        message.id === entry.providerMessageId &&
        message.threadId === entry.providerThreadId
    );
    if (exactMatches.length !== 1) {
      throw new Error(
        "exact provider message not found uniquely in allowed thread"
      );
    }
    const message = exactMatches[0];
    assertValidDate(message.date, "provider message date");
    if (message.date.toISOString() !== entry.providerOccurredAt) {
      throw new Error("exact provider message timestamp changed");
    }
    if (
      message.date.getTime() < cutoff.getTime() ||
      message.date.getTime() > now.getTime()
    ) {
      throw new Error(
        "exact provider message is outside the seven-day Vancouver recovery window"
      );
    }

    if (entry.action === "ingest") {
      const alreadyAppliedActivity = await input.store.findExactActivity({
        companyId: input.manifest.companyId,
        connectionId: input.manifest.connectionId,
        providerThreadId: entry.providerThreadId,
        providerMessageId: entry.providerMessageId,
      });
      validated.push({
        entry,
        message,
        entrySha256,
        alreadyAppliedActivity: alreadyAppliedActivity ?? undefined,
      });
      continue;
    }

    if (entry.action === "reparent") {
      const exactReparentInput = reparentInput(
        input.manifest,
        entry,
        manifestSha256,
        entrySha256
      );
      const inspection =
        await input.store.inspectExactMessage(exactReparentInput);
      validateReparentInspection(entry, inspection);
      validated.push({ entry, message, entrySha256, inspection });
      continue;
    }

    const exactCreateTargetInput = createTargetInput(
      input.manifest,
      entry,
      manifestSha256,
      entrySha256
    );
    const createTargetInspection =
      await input.store.inspectExactMessageForTargetCreation(
        exactCreateTargetInput
      );
    validateCreateTargetInspection(
      entry,
      createTargetInspection,
      input.manifest.connectionId
    );
    validated.push({
      entry,
      message,
      entrySha256,
      createTargetInspection,
    });
  }

  if (!apply) {
    if (expiredWorkStates) {
      return {
        mode: "dry-run",
        manifestSha256,
        cutoffAt: cutoff.toISOString(),
        entries: input.manifest.entries.map((entry) => {
          const state = expiredWorkStates.get(sha256(entry));
          return {
            action: entry.action,
            providerThreadId: entry.providerThreadId,
            providerMessageId: entry.providerMessageId,
            status: !state
              ? "skipped_expired"
              : recoveryWorkIsComplete(state)
                ? "already_applied"
                : state.attachmentRequired && !state.attachmentCompleted
                  ? "pending_attachment_attribution"
                  : "ready",
            activityId: state?.activityId ?? null,
            opportunityId:
              state?.opportunityId ?? state?.targetOpportunityId ?? null,
          };
        }),
      };
    }
    return {
      mode: "dry-run",
      manifestSha256,
      cutoffAt: cutoff.toISOString(),
      entries: validated.map(
        ({
          entry,
          alreadyAppliedActivity,
          inspection,
          createTargetInspection,
        }) => ({
          action: entry.action,
          providerThreadId: entry.providerThreadId,
          providerMessageId: entry.providerMessageId,
          status:
            (alreadyAppliedActivity?.opportunityId !== null &&
              alreadyAppliedActivity?.opportunityId !== undefined) ||
            (entry.action === "reparent" &&
              inspection?.activity.opportunityId ===
                entry.targetOpportunityId) ||
            (entry.action === "create_target_and_reparent" &&
              createTargetInspection !== undefined &&
              createTargetInspection.existingTarget?.id ===
                createTargetInspection.activity.opportunityId)
              ? "already_applied"
              : "ready",
          activityId:
            alreadyAppliedActivity?.activityId ??
            (entry.action === "reparent" ||
            entry.action === "create_target_and_reparent"
              ? entry.activityId
              : null),
          opportunityId:
            alreadyAppliedActivity?.opportunityId ??
            (entry.action === "reparent"
              ? entry.targetOpportunityId
              : entry.action === "create_target_and_reparent"
                ? (createTargetInspection?.existingTarget?.id ?? null)
                : null),
        })
      ),
    };
  }

  const workStates = expiredWorkStates ?? new Map();
  if (!expiredWorkStates) {
    // Persist every exact entry as immutable, content-addressed work before the
    // first product mutation. A crash or sibling-entry failure can therefore
    // resume only the missing end-to-end steps, even after the 24-hour intake
    // window closes.
    for (const item of validated) {
      const { entry } = item;
      const state = await input.store.registerRecoveryWork({
        companyId: input.manifest.companyId,
        actorUserId: input.manifest.actorUserId,
        connectionId: input.manifest.connectionId,
        providerThreadId: entry.providerThreadId,
        providerMessageId: entry.providerMessageId,
        action: entry.action,
        manifestSha256,
        entrySha256: item.entrySha256,
        manifestGeneratedAt: input.manifest.generatedAt,
        manifestCutoffAt: input.manifest.cutoffAt,
        activityId:
          entry.action === "ingest"
            ? (item.alreadyAppliedActivity?.activityId ?? null)
            : entry.activityId,
        opportunityId:
          entry.action === "ingest"
            ? (item.alreadyAppliedActivity?.opportunityId ?? null)
            : null,
        sourceOpportunityId:
          entry.action === "ingest" ? null : entry.sourceOpportunityId,
        targetOpportunityId:
          entry.action === "reparent"
            ? entry.targetOpportunityId
            : entry.action === "create_target_and_reparent"
              ? (item.createTargetInspection?.existingTarget?.id ?? null)
              : null,
        correspondenceEventId:
          entry.action === "ingest" ? null : entry.correspondenceEventId,
        attachmentRequired: entry.action !== "ingest",
        repairRequired: entry.action !== "ingest",
        draftProjectionRequired: entry.unansweredDraftProjection !== undefined,
        message: item.message,
      });
      if (
        state.action !== entry.action ||
        state.message.id !== entry.providerMessageId ||
        state.message.threadId !== entry.providerThreadId
      ) {
        throw new Error("registered exact recovery work identity changed");
      }
      item.workState = state;
      workStates.set(item.entrySha256, state);
    }
  }

  const productAppliedEntries = new Set<string>();
  const errors: Error[] = [];
  const rememberError = (error: unknown) => {
    errors.push(error instanceof Error ? error : new Error(String(error)));
  };
  const markStep = async (
    item: ValidatedEntry,
    step: EmailExactMessageRecoveryWorkStep,
    identity: {
      activityId: string | null;
      opportunityId: string | null;
      sourceOpportunityId: string | null;
      targetOpportunityId: string | null;
      correspondenceEventId: string | null;
    }
  ) => {
    const state = await input.store.markRecoveryWorkStep({
      companyId: input.manifest.companyId,
      actorUserId: input.manifest.actorUserId,
      connectionId: input.manifest.connectionId,
      providerThreadId: item.entry.providerThreadId,
      providerMessageId: item.entry.providerMessageId,
      manifestSha256,
      entrySha256: item.entrySha256,
      step,
      ...identity,
    });
    item.workState = state;
    workStates.set(item.entrySha256, state);
    return state;
  };

  // Phase one drains every guarded product mutation/attachment checkpoint
  // before any repair can update a shared source snapshot. Errors are retained
  // while other independently registered entries continue to a repairable
  // durable state.
  for (const item of validated) {
    const { entry } = item;
    let state = item.workState ?? workStates.get(item.entrySha256);
    if (!state) continue;
    try {
      if (entry.action === "ingest") {
        if (state.mutationCompleted) continue;
        const adapterResult = await input.ingestExactMessage({
          companyId: input.manifest.companyId,
          actorUserId: input.manifest.actorUserId,
          connectionId: input.manifest.connectionId,
          entry,
          message: state.message,
          manifestSha256,
          entrySha256: item.entrySha256,
        });
        const recoveredOrphan =
          item.alreadyAppliedActivity?.opportunityId === null &&
          adapterResult.opportunityId !== null;
        const result = recoveredOrphan
          ? { ...adapterResult, applied: true, alreadyApplied: false }
          : adapterResult;
        if (result.applied === result.alreadyApplied) {
          throw new Error(
            "canonical ingestion adapter returned an invalid application state"
          );
        }
        if (state.activityId && result.activityId !== state.activityId) {
          throw new Error(
            "canonical ingestion adapter changed the exact activity identity"
          );
        }
        if (!result.opportunityId) {
          throw new Error(
            "canonical ingestion adapter did not resolve an opportunity"
          );
        }
        if (result.applied) {
          productAppliedEntries.add(item.entrySha256);
        }
        await markStep(item, "mutation", {
          activityId: result.activityId,
          opportunityId: result.opportunityId,
          sourceOpportunityId: null,
          targetOpportunityId: null,
          correspondenceEventId: null,
        });
        continue;
      }

      if (state.attachmentCompleted) continue;
      const result =
        entry.action === "reparent"
          ? await input.store.reparentExactMessage(
              reparentInput(
                input.manifest,
                entry,
                manifestSha256,
                item.entrySha256
              )
            )
          : await input.store.createTargetAndReparentExactMessage(
              createTargetInput(
                input.manifest,
                entry,
                manifestSha256,
                item.entrySha256
              )
            );
      if (
        typeof result.pendingAttachmentAttribution !== "boolean" ||
        (!result.pendingAttachmentAttribution &&
          result.applied === result.alreadyApplied) ||
        (result.pendingAttachmentAttribution && result.alreadyApplied)
      ) {
        throw new Error("reparent RPC returned an invalid application state");
      }
      if (result.applied) {
        productAppliedEntries.add(item.entrySha256);
      }
      const identity = {
        activityId: result.activityId,
        opportunityId: null,
        sourceOpportunityId: result.sourceOpportunityId,
        targetOpportunityId: result.targetOpportunityId,
        correspondenceEventId: result.correspondenceEventId,
      };
      if (!state.mutationCompleted) {
        state = await markStep(item, "mutation", identity);
      }
      if (!result.pendingAttachmentAttribution && !state.attachmentCompleted) {
        await markStep(item, "attachment", identity);
      }
    } catch (error) {
      rememberError(error);
    }
  }

  // Phase two drains every repair that is ready, even when a sibling mutation
  // failed. The durable step marker is written only after the idempotent repair
  // returns, so crash-after-repair safely replays rather than losing work.
  for (const item of validated) {
    const { entry } = item;
    if (entry.action === "ingest") continue;
    const state = item.workState ?? workStates.get(item.entrySha256);
    if (
      !state ||
      !state.mutationCompleted ||
      !state.attachmentCompleted ||
      state.repairCompleted
    ) {
      continue;
    }
    try {
      if (
        !state.activityId ||
        !state.sourceOpportunityId ||
        !state.targetOpportunityId ||
        !state.correspondenceEventId
      ) {
        throw new Error("exact recovery repair identity is incomplete");
      }
      await input.repairReparentedMessage!({
        companyId: input.manifest.companyId,
        actorUserId: input.manifest.actorUserId,
        connectionId: input.manifest.connectionId,
        entry,
        message: state.message,
        sourceOpportunityId: state.sourceOpportunityId,
        targetOpportunityId: state.targetOpportunityId,
        activityId: state.activityId,
        correspondenceEventId: state.correspondenceEventId,
        manifestSha256,
        entrySha256: item.entrySha256,
      });
      await markStep(item, "repair", {
        activityId: state.activityId,
        opportunityId: state.opportunityId,
        sourceOpportunityId: state.sourceOpportunityId,
        targetOpportunityId: state.targetOpportunityId,
        correspondenceEventId: state.correspondenceEventId,
      });
    } catch (error) {
      rememberError(error);
    }
  }

  // Phase three projects only explicitly approved draft work after canonical
  // persistence (and, for moves, repair) is durably complete.
  for (const item of validated) {
    const { entry } = item;
    const state = item.workState ?? workStates.get(item.entrySha256);
    if (
      !state ||
      !state.draftProjectionRequired ||
      state.draftProjectionCompleted ||
      !state.mutationCompleted ||
      (state.repairRequired && !state.repairCompleted)
    ) {
      continue;
    }
    try {
      if (
        !entry.unansweredDraftProjection ||
        !state.activityId ||
        !(state.opportunityId ?? state.targetOpportunityId)
      ) {
        throw new Error(
          "exact recovery draft projection identity is incomplete"
        );
      }
      await input.projectUnansweredDraft!({
        companyId: input.manifest.companyId,
        actorUserId: input.manifest.actorUserId,
        connectionId: input.manifest.connectionId,
        entry,
        message: state.message,
        opportunityId: (state.opportunityId ?? state.targetOpportunityId)!,
        activityId: state.activityId,
        correspondenceEventId: state.correspondenceEventId,
        projection: entry.unansweredDraftProjection,
        manifestSha256,
        entrySha256: item.entrySha256,
      });
      await markStep(item, "draft_projection", {
        activityId: state.activityId,
        opportunityId: state.opportunityId,
        sourceOpportunityId: state.sourceOpportunityId,
        targetOpportunityId: state.targetOpportunityId,
        correspondenceEventId: state.correspondenceEventId,
      });
    } catch (error) {
      rememberError(error);
    }
  }

  if (missingExpiredEntryCount > 0) {
    rememberError(
      new Error(
        "expired manifest is missing durable work for one or more exact entries; a new reviewed manifest approval is required"
      )
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `Exact-message recovery left durable work pending: ${errors.map((error) => error.message).join("; ")}`
    );
  }

  const results: EmailExactMessageRecoveryResultEntry[] =
    input.manifest.entries.map((entry) => {
      const entrySha256 = sha256(entry);
      const state = workStates.get(entrySha256);
      return {
        action: entry.action,
        providerThreadId: entry.providerThreadId,
        providerMessageId: entry.providerMessageId,
        status: !state
          ? "skipped_expired"
          : state.attachmentRequired && !state.attachmentCompleted
            ? "pending_attachment_attribution"
            : productAppliedEntries.has(entrySha256)
              ? "applied"
              : "already_applied",
        activityId: state?.activityId ?? null,
        opportunityId:
          state?.opportunityId ?? state?.targetOpportunityId ?? null,
      };
    });

  return {
    mode: "apply",
    manifestSha256,
    cutoffAt: cutoff.toISOString(),
    entries: results,
  };
}

function mapSnapshot(
  row: Record<string, unknown>
): EmailExactMessageRecoveryOpportunitySnapshot {
  const projectRef = (row.project_ref as string | null) ?? null;
  const projectId = (row.project_id as string | null) ?? null;
  if (projectRef !== projectId) {
    throw new Error("opportunity project identity is inconsistent");
  }
  return {
    updatedAt: row.updated_at as string,
    stage: row.stage as string,
    stageManuallySet: row.stage_manually_set as boolean,
    assignedTo: (row.assigned_to as string | null) ?? null,
    assignmentVersion: row.assignment_version as number,
    projectId,
  };
}

function serializeRecoveryMessage(
  message: NormalizedEmail
): Record<string, unknown> {
  return {
    ...message,
    date: message.date.toISOString(),
  };
}

function parseRecoveryMessage(value: unknown): NormalizedEmail {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("exact recovery work returned an invalid message payload");
  }
  const row = value as Record<string, unknown>;
  for (const key of [
    "id",
    "threadId",
    "from",
    "fromName",
    "subject",
    "snippet",
    "bodyText",
  ]) {
    if (typeof row[key] !== "string") {
      throw new Error(
        "exact recovery work returned an invalid message payload"
      );
    }
  }
  for (const key of ["to", "cc", "labelIds"]) {
    if (
      !Array.isArray(row[key]) ||
      !(row[key] as unknown[]).every((item) => typeof item === "string")
    ) {
      throw new Error(
        "exact recovery work returned an invalid message payload"
      );
    }
  }
  if (
    typeof row.isRead !== "boolean" ||
    typeof row.hasAttachments !== "boolean" ||
    typeof row.sizeEstimate !== "number"
  ) {
    throw new Error("exact recovery work returned an invalid message payload");
  }
  const date = parseExactIsoDate(row.date, "exact recovery work message date");
  return { ...(row as unknown as NormalizedEmail), date };
}

function parseRecoveryWorkState(
  value: unknown,
  label: string
): EmailExactMessageRecoveryWorkState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} returned an invalid result`);
  }
  const row = value as Record<string, unknown>;
  if (
    row.action !== "ingest" &&
    row.action !== "reparent" &&
    row.action !== "create_target_and_reparent"
  ) {
    throw new Error(`${label} returned an invalid action`);
  }
  for (const key of [
    "mutation_completed",
    "attachment_required",
    "attachment_completed",
    "repair_required",
    "repair_completed",
    "draft_projection_required",
    "draft_projection_completed",
  ]) {
    if (typeof row[key] !== "boolean") {
      throw new Error(`${label} returned an invalid step state`);
    }
  }
  return {
    action: row.action,
    activityId: (row.activity_id as string | null) ?? null,
    opportunityId: (row.opportunity_id as string | null) ?? null,
    sourceOpportunityId: (row.source_opportunity_id as string | null) ?? null,
    targetOpportunityId: (row.target_opportunity_id as string | null) ?? null,
    correspondenceEventId:
      (row.correspondence_event_id as string | null) ?? null,
    message: parseRecoveryMessage(row.message_payload),
    mutationCompleted: row.mutation_completed as boolean,
    attachmentRequired: row.attachment_required as boolean,
    attachmentCompleted: row.attachment_completed as boolean,
    repairRequired: row.repair_required as boolean,
    repairCompleted: row.repair_completed as boolean,
    draftProjectionRequired: row.draft_projection_required as boolean,
    draftProjectionCompleted: row.draft_projection_completed as boolean,
  };
}

function recoveryWorkIsComplete(
  state: EmailExactMessageRecoveryWorkState
): boolean {
  return (
    state.mutationCompleted &&
    (!state.attachmentRequired || state.attachmentCompleted) &&
    (!state.repairRequired || state.repairCompleted) &&
    (!state.draftProjectionRequired || state.draftProjectionCompleted)
  );
}

function expectOneRow(
  rows: Array<Record<string, unknown>> | null,
  label: string
): Record<string, unknown> {
  if (!rows || rows.length !== 1) {
    throw new Error(`${label} was not found uniquely`);
  }
  return rows[0];
}

export class SupabaseEmailExactMessageRecoveryStore implements EmailExactMessageRecoveryStore {
  constructor(private readonly supabase: SupabaseClient) {}

  async inspectRecoveryWork(input: {
    companyId: string;
    connectionId: string;
    providerThreadId: string;
    providerMessageId: string;
    manifestSha256: string;
    entrySha256: string;
  }): Promise<EmailExactMessageRecoveryWorkState | null> {
    const { data, error } = await this.supabase.rpc(
      "inspect_exact_message_recovery_work_as_system",
      {
        p_company_id: input.companyId,
        p_connection_id: input.connectionId,
        p_provider_thread_id: input.providerThreadId,
        p_provider_message_id: input.providerMessageId,
        p_manifest_sha256: input.manifestSha256,
        p_entry_sha256: input.entrySha256,
      }
    );
    if (error) {
      throw new Error(
        `Failed to inspect exact recovery work: ${error.message}`
      );
    }
    if (data === null) return null;
    return parseRecoveryWorkState(data, "exact recovery work inspection");
  }

  async registerRecoveryWork(input: {
    companyId: string;
    actorUserId: string;
    connectionId: string;
    providerThreadId: string;
    providerMessageId: string;
    action: EmailExactMessageRecoveryEntry["action"];
    manifestSha256: string;
    entrySha256: string;
    manifestGeneratedAt: string;
    manifestCutoffAt: string;
    activityId: string | null;
    opportunityId: string | null;
    sourceOpportunityId: string | null;
    targetOpportunityId: string | null;
    correspondenceEventId: string | null;
    attachmentRequired: boolean;
    repairRequired: boolean;
    draftProjectionRequired: boolean;
    message: NormalizedEmail;
  }): Promise<EmailExactMessageRecoveryWorkState> {
    const { data, error } = await this.supabase.rpc(
      "register_exact_message_recovery_work_as_system",
      {
        p_actor_user_id: input.actorUserId,
        p_company_id: input.companyId,
        p_connection_id: input.connectionId,
        p_provider_thread_id: input.providerThreadId,
        p_provider_message_id: input.providerMessageId,
        p_action: input.action,
        p_manifest_sha256: input.manifestSha256,
        p_entry_sha256: input.entrySha256,
        p_manifest_generated_at: input.manifestGeneratedAt,
        p_manifest_cutoff_at: input.manifestCutoffAt,
        p_activity_id: input.activityId,
        p_opportunity_id: input.opportunityId,
        p_source_opportunity_id: input.sourceOpportunityId,
        p_target_opportunity_id: input.targetOpportunityId,
        p_correspondence_event_id: input.correspondenceEventId,
        p_attachment_required: input.attachmentRequired,
        p_repair_required: input.repairRequired,
        p_draft_projection_required: input.draftProjectionRequired,
        p_message_payload: serializeRecoveryMessage(input.message),
      }
    );
    if (error) {
      throw new Error(
        `Failed to register exact recovery work: ${error.message}`
      );
    }
    return parseRecoveryWorkState(data, "exact recovery work registration");
  }

  async abandonRecoveryWork(input: {
    actorUserId: string;
    companyId: string;
    connectionId: string;
    providerThreadId: string;
    providerMessageId: string;
    priorManifestSha256: string;
    priorEntrySha256: string;
    supersedingManifestSha256: string;
    supersedingEntrySha256: string;
  }): Promise<boolean> {
    const { data, error } = await this.supabase.rpc(
      "abandon_exact_message_recovery_work_as_system",
      {
        p_actor_user_id: input.actorUserId,
        p_company_id: input.companyId,
        p_connection_id: input.connectionId,
        p_provider_thread_id: input.providerThreadId,
        p_provider_message_id: input.providerMessageId,
        p_manifest_sha256: input.priorManifestSha256,
        p_entry_sha256: input.priorEntrySha256,
        p_superseding_manifest_sha256: input.supersedingManifestSha256,
        p_superseding_entry_sha256: input.supersedingEntrySha256,
      }
    );
    if (error) {
      throw new Error(
        `Failed to supersede exact recovery work: ${error.message}`
      );
    }
    if (data !== true) {
      throw new Error("Exact recovery work supersession was not acknowledged");
    }
    return true;
  }

  async markRecoveryWorkStep(input: {
    companyId: string;
    actorUserId: string;
    connectionId: string;
    providerThreadId: string;
    providerMessageId: string;
    manifestSha256: string;
    entrySha256: string;
    step: EmailExactMessageRecoveryWorkStep;
    activityId: string | null;
    opportunityId: string | null;
    sourceOpportunityId: string | null;
    targetOpportunityId: string | null;
    correspondenceEventId: string | null;
  }): Promise<EmailExactMessageRecoveryWorkState> {
    const { data, error } = await this.supabase.rpc(
      "mark_exact_message_recovery_work_step_as_system",
      {
        p_actor_user_id: input.actorUserId,
        p_company_id: input.companyId,
        p_connection_id: input.connectionId,
        p_provider_thread_id: input.providerThreadId,
        p_provider_message_id: input.providerMessageId,
        p_manifest_sha256: input.manifestSha256,
        p_entry_sha256: input.entrySha256,
        p_step: input.step,
        p_activity_id: input.activityId,
        p_opportunity_id: input.opportunityId,
        p_source_opportunity_id: input.sourceOpportunityId,
        p_target_opportunity_id: input.targetOpportunityId,
        p_correspondence_event_id: input.correspondenceEventId,
      }
    );
    if (error) {
      throw new Error(
        `Failed to mark exact recovery ${input.step}: ${error.message}`
      );
    }
    return parseRecoveryWorkState(data, "exact recovery work step");
  }

  async inspectRecoveryApplication(input: {
    companyId: string;
    connectionId: string;
    providerThreadId: string;
    providerMessageId: string;
    manifestSha256: string;
    entrySha256: string;
  }): Promise<EmailExactMessageRecoveryApplicationInspection | null> {
    const { data, error } = await this.supabase.rpc(
      "inspect_exact_message_recovery_application_as_system",
      {
        p_company_id: input.companyId,
        p_connection_id: input.connectionId,
        p_provider_thread_id: input.providerThreadId,
        p_provider_message_id: input.providerMessageId,
        p_manifest_sha256: input.manifestSha256,
        p_entry_sha256: input.entrySha256,
      }
    );
    if (error) {
      throw new Error(
        `Failed to inspect exact recovery application: ${error.message}`
      );
    }
    if (data === null) return null;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("exact recovery application inspection is invalid");
    }
    const status = (data as Record<string, unknown>).status;
    if (status !== "attachment_pending" && status !== "complete") {
      throw new Error("exact recovery application status is invalid");
    }
    return { status };
  }

  async findExactActivity(input: {
    companyId: string;
    connectionId: string;
    providerThreadId: string;
    providerMessageId: string;
  }): Promise<{ activityId: string; opportunityId: string | null } | null> {
    const { data, error } = await this.supabase
      .from("activities")
      .select("id, opportunity_id")
      .eq("company_id", input.companyId)
      .eq("email_connection_id", input.connectionId)
      .eq("email_thread_id", input.providerThreadId)
      .eq("email_message_id", input.providerMessageId)
      .eq("type", "email")
      .limit(2);
    if (error) {
      throw new Error(
        `Failed to inspect exact email activity: ${error.message}`
      );
    }
    if (!data || data.length === 0) {
      const { data: eventRows, error: eventError } = await this.supabase
        .from("opportunity_correspondence_events")
        .select("id, activity_id, opportunity_id")
        .eq("company_id", input.companyId)
        .eq("connection_id", input.connectionId)
        .eq("provider_thread_id", input.providerThreadId)
        .eq("provider_message_id", input.providerMessageId)
        .limit(2);
      if (eventError) {
        throw new Error(
          `Failed to inspect exact correspondence event: ${eventError.message}`
        );
      }
      if (!eventRows || eventRows.length === 0) return null;
      if (eventRows.length !== 1) {
        throw new Error("exact correspondence event was not found uniquely");
      }

      const event = eventRows[0] as Record<string, unknown>;
      if (typeof event.activity_id !== "string") {
        throw new Error("exact correspondence event has no activity identity");
      }
      const { data: legacyRows, error: legacyError } = await this.supabase
        .from("activities")
        .select("id, opportunity_id")
        .eq("id", event.activity_id)
        .eq("company_id", input.companyId)
        .is("email_connection_id", null)
        .eq("email_thread_id", input.providerThreadId)
        .eq("email_message_id", input.providerMessageId)
        .eq("type", "email")
        .limit(2);
      if (legacyError) {
        throw new Error(
          `Failed to inspect proven legacy email activity: ${legacyError.message}`
        );
      }
      if (!legacyRows || legacyRows.length !== 1) {
        throw new Error(
          "exact correspondence event does not identify one legacy email activity"
        );
      }
      const legacy = legacyRows[0] as Record<string, unknown>;
      if (legacy.opportunity_id !== event.opportunity_id) {
        throw new Error(
          "legacy email activity owner differs from exact correspondence event"
        );
      }
      return {
        activityId: legacy.id as string,
        opportunityId: (legacy.opportunity_id as string | null) ?? null,
      };
    }
    if (data.length !== 1) {
      throw new Error("exact email activity was not found uniquely");
    }
    return {
      activityId: data[0].id as string,
      opportunityId: (data[0].opportunity_id as string | null) ?? null,
    };
  }

  async inspectExactMessage(
    input: EmailExactMessageRecoveryReparentInput
  ): Promise<EmailExactMessageRecoveryInspection> {
    const [activityResult, eventResult, opportunityResult] = await Promise.all([
      this.supabase
        .from("activities")
        .select(
          "id, opportunity_id, email_connection_id, direction, from_email, to_emails, cc_emails"
        )
        .eq("id", input.activityId)
        .eq("company_id", input.companyId)
        .eq("email_thread_id", input.providerThreadId)
        .eq("email_message_id", input.providerMessageId)
        .eq("type", "email")
        .limit(2),
      this.supabase
        .from("opportunity_correspondence_events")
        .select(
          "id, activity_id, opportunity_id, opportunity_projection_applied, direction, party_role, is_meaningful"
        )
        .eq("id", input.correspondenceEventId)
        .eq("company_id", input.companyId)
        .eq("connection_id", input.connectionId)
        .eq("provider_thread_id", input.providerThreadId)
        .eq("provider_message_id", input.providerMessageId)
        .eq("activity_id", input.activityId)
        .limit(2),
      this.supabase
        .from("opportunities")
        .select(
          "id, updated_at, stage, stage_manually_set, assigned_to, assignment_version, project_id, project_ref, client_id, client_ref, contact_email"
        )
        .eq("company_id", input.companyId)
        .is("deleted_at", null)
        .in("id", [input.sourceOpportunityId, input.targetOpportunityId])
        .limit(2),
    ]);

    if (activityResult.error) {
      throw new Error(
        `Failed to inspect exact email activity: ${activityResult.error.message}`
      );
    }
    if (eventResult.error) {
      throw new Error(
        `Failed to inspect exact correspondence event: ${eventResult.error.message}`
      );
    }
    if (opportunityResult.error) {
      throw new Error(
        `Failed to inspect recovery opportunities: ${opportunityResult.error.message}`
      );
    }

    const activity = expectOneRow(
      activityResult.data as Array<Record<string, unknown>> | null,
      "exact email activity"
    );
    const event = expectOneRow(
      eventResult.data as Array<Record<string, unknown>> | null,
      "exact correspondence event"
    );
    const activityConnectionId =
      (activity.email_connection_id as string | null) ?? null;
    if (
      activityConnectionId !== null &&
      activityConnectionId !== input.connectionId
    ) {
      throw new Error("exact email activity belongs to another mailbox");
    }
    const opportunities = (opportunityResult.data ?? []) as Array<
      Record<string, unknown>
    >;
    const source = opportunities.find(
      (row) => row.id === input.sourceOpportunityId
    );
    const target = opportunities.find(
      (row) => row.id === input.targetOpportunityId
    );
    if (!source || !target || opportunities.length !== 2) {
      throw new Error("recovery opportunities were not found uniquely");
    }

    const targetEmails = [target.contact_email as string | null];
    const targetClientRef = (target.client_ref as string | null) ?? null;
    const targetClientIdColumn = (target.client_id as string | null) ?? null;
    if (
      targetClientRef &&
      targetClientIdColumn &&
      targetClientRef !== targetClientIdColumn
    ) {
      throw new Error("target opportunity client identity is inconsistent");
    }
    const targetClientId = targetClientRef ?? targetClientIdColumn;
    if (targetClientId) {
      const [clientResult, alternateResult] = await Promise.all([
        this.supabase
          .from("clients")
          .select("email")
          .eq("id", targetClientId)
          .eq("company_id", input.companyId)
          .is("deleted_at", null)
          .limit(1),
        this.supabase
          .from("sub_clients")
          .select("email")
          .eq("client_id", targetClientId)
          .eq("company_id", input.companyId)
          .is("deleted_at", null),
      ]);
      if (clientResult.error || alternateResult.error) {
        throw new Error(
          `Failed to inspect target customer identities: ${clientResult.error?.message ?? alternateResult.error?.message}`
        );
      }
      for (const row of clientResult.data ?? []) targetEmails.push(row.email);
      for (const row of alternateResult.data ?? [])
        targetEmails.push(row.email);
    }

    return {
      activity: {
        id: activity.id as string,
        opportunityId: (activity.opportunity_id as string | null) ?? null,
        direction: (activity.direction as string | null) ?? null,
        fromEmail: (activity.from_email as string | null) ?? null,
        toEmails: (activity.to_emails as string[] | null) ?? [],
        ccEmails: (activity.cc_emails as string[] | null) ?? [],
      },
      correspondenceEvent: {
        id: event.id as string,
        activityId: (event.activity_id as string | null) ?? null,
        opportunityId: event.opportunity_id as string,
        projectionApplied: event.opportunity_projection_applied as boolean,
        direction: event.direction as string,
        partyRole: event.party_role as string,
        isMeaningful: event.is_meaningful as boolean,
      },
      sourceSnapshot: mapSnapshot(source),
      targetSnapshot: mapSnapshot(target),
      targetIdentityEmails: [...normalizedEmailSet(targetEmails)],
    };
  }

  async inspectExactMessageForTargetCreation(
    input: EmailExactMessageRecoveryCreateTargetInput
  ): Promise<EmailExactMessageRecoveryCreateTargetInspection> {
    const [activityResult, eventResult, sourceResult, targetResult] =
      await Promise.all([
        this.supabase
          .from("activities")
          .select(
            "id, opportunity_id, email_connection_id, direction, from_email"
          )
          .eq("id", input.activityId)
          .eq("company_id", input.companyId)
          .eq("email_thread_id", input.providerThreadId)
          .eq("email_message_id", input.providerMessageId)
          .eq("type", "email")
          .limit(2),
        this.supabase
          .from("opportunity_correspondence_events")
          .select(
            "id, activity_id, opportunity_id, opportunity_projection_applied, direction, party_role, is_meaningful, from_email"
          )
          .eq("id", input.correspondenceEventId)
          .eq("company_id", input.companyId)
          .eq("connection_id", input.connectionId)
          .eq("provider_thread_id", input.providerThreadId)
          .eq("provider_message_id", input.providerMessageId)
          .eq("activity_id", input.activityId)
          .limit(2),
        this.supabase
          .from("opportunities")
          .select(
            "id, updated_at, stage, stage_manually_set, assigned_to, assignment_version, project_id, project_ref"
          )
          .eq("id", input.sourceOpportunityId)
          .eq("company_id", input.companyId)
          .is("deleted_at", null)
          .limit(2),
        this.supabase
          .from("opportunities")
          .select("id, source_thread_key, contact_email, client_id, client_ref")
          .eq("company_id", input.companyId)
          .eq("source_thread_key", input.targetLead.sourceThreadKey)
          .is("deleted_at", null)
          .limit(2),
      ]);

    for (const [label, error] of [
      ["exact email activity", activityResult.error],
      ["exact correspondence event", eventResult.error],
      ["source opportunity", sourceResult.error],
      ["target source identity", targetResult.error],
    ] as const) {
      if (error) {
        throw new Error(
          `Failed to inspect ${label}: ${error.message ?? "unknown error"}`
        );
      }
    }

    const activity = expectOneRow(
      activityResult.data as Array<Record<string, unknown>> | null,
      "exact email activity"
    );
    const event = expectOneRow(
      eventResult.data as Array<Record<string, unknown>> | null,
      "exact correspondence event"
    );
    const source = expectOneRow(
      sourceResult.data as Array<Record<string, unknown>> | null,
      "source opportunity"
    );
    const targetRows = (targetResult.data ?? []) as Array<
      Record<string, unknown>
    >;
    if (targetRows.length > 1) {
      throw new Error("target source identity was not found uniquely");
    }

    const activityConnectionId =
      (activity.email_connection_id as string | null) ?? null;
    if (
      activityConnectionId !== null &&
      activityConnectionId !== input.connectionId
    ) {
      throw new Error("exact email activity belongs to another mailbox");
    }

    let existingTarget: EmailExactMessageRecoveryCreateTargetInspection["existingTarget"] =
      null;
    const target = targetRows[0];
    if (target) {
      const targetEmails = [target.contact_email as string | null];
      const targetClientRef = (target.client_ref as string | null) ?? null;
      const targetClientIdColumn = (target.client_id as string | null) ?? null;
      if (
        targetClientRef &&
        targetClientIdColumn &&
        targetClientRef !== targetClientIdColumn
      ) {
        throw new Error("target opportunity client identity is inconsistent");
      }
      const targetClientId = targetClientRef ?? targetClientIdColumn;
      if (targetClientId) {
        const [clientResult, alternateResult] = await Promise.all([
          this.supabase
            .from("clients")
            .select("email")
            .eq("id", targetClientId)
            .eq("company_id", input.companyId)
            .is("deleted_at", null)
            .limit(1),
          this.supabase
            .from("sub_clients")
            .select("email")
            .eq("client_id", targetClientId)
            .eq("company_id", input.companyId)
            .is("deleted_at", null),
        ]);
        if (clientResult.error || alternateResult.error) {
          throw new Error(
            `Failed to inspect target customer identities: ${clientResult.error?.message ?? alternateResult.error?.message}`
          );
        }
        for (const row of clientResult.data ?? []) targetEmails.push(row.email);
        for (const row of alternateResult.data ?? [])
          targetEmails.push(row.email);
      }
      existingTarget = {
        id: target.id as string,
        sourceThreadKey: target.source_thread_key as string,
        identityEmails: [...normalizedEmailSet(targetEmails)],
      };
    }

    return {
      activity: {
        id: activity.id as string,
        opportunityId: (activity.opportunity_id as string | null) ?? null,
        connectionId: activityConnectionId,
        direction: (activity.direction as string | null) ?? null,
        fromEmail: (activity.from_email as string | null) ?? null,
      },
      correspondenceEvent: {
        id: event.id as string,
        activityId: (event.activity_id as string | null) ?? null,
        opportunityId: event.opportunity_id as string,
        projectionApplied: event.opportunity_projection_applied as boolean,
        direction: event.direction as string,
        partyRole: event.party_role as string,
        isMeaningful: event.is_meaningful as boolean,
        fromEmail: (event.from_email as string | null) ?? null,
      },
      sourceSnapshot: mapSnapshot(source),
      existingTarget,
    };
  }

  async reparentExactMessage(
    input: EmailExactMessageRecoveryReparentInput
  ): Promise<EmailExactMessageRecoveryReparentResult> {
    const { data, error } = await this.supabase.rpc(
      "reparent_opportunity_email_message_guarded",
      {
        p_actor_user_id: input.actorUserId,
        p_company_id: input.companyId,
        p_connection_id: input.connectionId,
        p_provider_thread_id: input.providerThreadId,
        p_provider_message_id: input.providerMessageId,
        p_source_opportunity_id: input.sourceOpportunityId,
        p_target_opportunity_id: input.targetOpportunityId,
        p_expected_activity_id: input.activityId,
        p_expected_correspondence_event_id: input.correspondenceEventId,
        p_target_email: input.targetEmail,
        p_manifest_sha256: input.manifestSha256,
        p_entry_sha256: input.entrySha256,
        p_expected_source_updated_at: input.sourceSnapshot.updatedAt,
        p_expected_target_updated_at: input.targetSnapshot.updatedAt,
        p_expected_source_stage: input.sourceSnapshot.stage,
        p_expected_target_stage: input.targetSnapshot.stage,
        p_expected_source_stage_manually_set:
          input.sourceSnapshot.stageManuallySet,
        p_expected_target_stage_manually_set:
          input.targetSnapshot.stageManuallySet,
        p_expected_source_assigned_to: input.sourceSnapshot.assignedTo,
        p_expected_target_assigned_to: input.targetSnapshot.assignedTo,
        p_expected_source_assignment_version:
          input.sourceSnapshot.assignmentVersion,
        p_expected_target_assignment_version:
          input.targetSnapshot.assignmentVersion,
        p_expected_source_project_id: input.sourceSnapshot.projectId,
        p_expected_target_project_id: input.targetSnapshot.projectId,
      }
    );
    if (error) {
      throw new Error(
        `Failed to reparent exact email message: ${error.message}`
      );
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("reparent RPC returned an invalid result");
    }
    const result = data as Record<string, unknown>;
    if (
      typeof result.applied !== "boolean" ||
      typeof result.already_applied !== "boolean" ||
      typeof result.pending_attachment_attribution !== "boolean"
    ) {
      throw new Error("reparent RPC returned an invalid application state");
    }
    return {
      applied: result.applied,
      alreadyApplied: result.already_applied,
      pendingAttachmentAttribution: result.pending_attachment_attribution,
      activityId: result.activity_id as string,
      correspondenceEventId: result.correspondence_event_id as string,
      sourceOpportunityId: result.source_opportunity_id as string,
      targetOpportunityId: result.target_opportunity_id as string,
    };
  }

  async createTargetAndReparentExactMessage(
    input: EmailExactMessageRecoveryCreateTargetInput
  ): Promise<EmailExactMessageRecoveryReparentResult> {
    const { data, error } = await this.supabase.rpc(
      "create_target_and_reparent_opportunity_email_message_guarded",
      {
        p_actor_user_id: input.actorUserId,
        p_company_id: input.companyId,
        p_connection_id: input.connectionId,
        p_provider_thread_id: input.providerThreadId,
        p_provider_message_id: input.providerMessageId,
        p_source_opportunity_id: input.sourceOpportunityId,
        p_expected_activity_id: input.activityId,
        p_expected_correspondence_event_id: input.correspondenceEventId,
        p_target_email: input.targetEmail,
        p_target_source_thread_key: input.targetLead.sourceThreadKey,
        p_target_title: input.targetLead.title,
        p_target_contact_name: input.targetLead.contactName,
        p_manifest_sha256: input.manifestSha256,
        p_entry_sha256: input.entrySha256,
        p_expected_source_updated_at: input.sourceSnapshot.updatedAt,
        p_expected_source_stage: input.sourceSnapshot.stage,
        p_expected_source_stage_manually_set:
          input.sourceSnapshot.stageManuallySet,
        p_expected_source_assigned_to: input.sourceSnapshot.assignedTo,
        p_expected_source_assignment_version:
          input.sourceSnapshot.assignmentVersion,
        p_expected_source_project_id: input.sourceSnapshot.projectId,
      }
    );
    if (error) {
      throw new Error(
        `Failed to create target and reparent exact email message: ${error.message}`
      );
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("create-target reparent RPC returned an invalid result");
    }
    const result = data as Record<string, unknown>;
    if (
      typeof result.applied !== "boolean" ||
      typeof result.already_applied !== "boolean" ||
      typeof result.pending_attachment_attribution !== "boolean"
    ) {
      throw new Error(
        "create-target reparent RPC returned an invalid application state"
      );
    }
    return {
      applied: result.applied,
      alreadyApplied: result.already_applied,
      pendingAttachmentAttribution: result.pending_attachment_attribution,
      activityId: result.activity_id as string,
      correspondenceEventId: result.correspondence_event_id as string,
      sourceOpportunityId: result.source_opportunity_id as string,
      targetOpportunityId: result.target_opportunity_id as string,
    };
  }
}
