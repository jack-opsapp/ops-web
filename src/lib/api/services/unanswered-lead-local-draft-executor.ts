import { createHash } from "node:crypto";

import {
  UnansweredLeadLocalDraftBackfillService,
  previousSevenVancouverCalendarDays,
  selectUnansweredLeadDraftCandidates,
  type UnansweredLeadDraftBackfillDependencies,
  type UnansweredLeadDraftCandidate,
  type UnansweredLeadDraftExecutionItem,
  type VancouverCalendarWindow,
} from "@/lib/api/services/unanswered-lead-local-draft-backfill-service";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MANIFEST_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACTIVE_SALES_STAGES = new Set([
  "new_lead",
  "qualifying",
  "quoting",
  "quoted",
  "follow_up",
  "negotiation",
]);

const MANIFEST_KEYS = [
  "actorUserId",
  "companyId",
  "cutoffAt",
  "entries",
  "generatedAt",
  "schemaVersion",
].sort();
const ENTRY_KEYS = [
  "expectedAssignedTo",
  "expectedAssignmentVersion",
  "expectedStage",
  "expectedStageManuallySet",
  "expectedWorkstream",
  "label",
  "opportunityId",
  "providerThreadId",
  "recipientEmail",
  "recipientName",
  "sourceActivityId",
  "sourceConnectionId",
  "sourceEventId",
  "sourceOccurredAt",
  "sourceProviderMessageId",
  "sourceProviderThreadId",
].sort();

export interface ApprovedUnansweredLeadDraftManifestEntry {
  opportunityId: string;
  label: string;
  recipientName: string | null;
  recipientEmail: string;
  sourceEventId: string;
  sourceActivityId: string;
  sourceConnectionId: string;
  sourceProviderThreadId: string;
  sourceProviderMessageId: string;
  sourceOccurredAt: string;
  providerThreadId: string | null;
  expectedStage: string;
  expectedStageManuallySet: boolean;
  expectedAssignmentVersion: number;
  expectedAssignedTo: string | null;
  expectedWorkstream: "sales";
}

export interface ApprovedUnansweredLeadDraftManifest {
  schemaVersion: 1;
  companyId: string;
  actorUserId: string;
  generatedAt: string;
  cutoffAt: string;
  entries: ApprovedUnansweredLeadDraftManifestEntry[];
}

export interface ApprovedUnansweredLeadDraftExecutionEntry {
  opportunityId: string;
  sourceEventId: string;
  status: "ready" | "unauthorized" | UnansweredLeadDraftExecutionItem["status"];
  reason?: UnansweredLeadDraftExecutionItem["reason"];
}

export interface ApprovedUnansweredLeadDraftExecutionResult {
  mode: "dry-run" | "apply";
  manifestSha256: string;
  cutoffAt: string;
  generatedAt: string;
  entries: ApprovedUnansweredLeadDraftExecutionEntry[];
}

export interface RunApprovedUnansweredLeadLocalDraftBackfillInput {
  manifest: ApprovedUnansweredLeadDraftManifest;
  dependencies: UnansweredLeadDraftBackfillDependencies;
  now?: Date;
  apply?: boolean;
  approvedManifestSha256?: string | null;
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

export function buildUnansweredLeadDraftManifestHash(
  manifest: ApprovedUnansweredLeadDraftManifest
): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(manifest)))
    .digest("hex");
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: string[],
  label: string
): void {
  const actual = Object.keys(value).sort();
  if (actual.join(",") !== expected.join(",")) {
    throw new Error(`${label} contains unsupported or missing fields`);
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
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim()
  ) {
    throw new Error(`${label} must be a non-blank trimmed string`);
  }
}

function parseCanonicalTimestamp(value: unknown, label: string): Date {
  assertNonBlank(value, label);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp`);
  }
  return parsed;
}

function exactWindow(manifest: ApprovedUnansweredLeadDraftManifest): {
  generatedAt: Date;
  window: VancouverCalendarWindow;
} {
  const generatedAt = parseCanonicalTimestamp(
    manifest.generatedAt,
    "manifest.generatedAt"
  );
  const window = previousSevenVancouverCalendarDays(generatedAt);
  const cutoffAt = parseCanonicalTimestamp(
    manifest.cutoffAt,
    "manifest.cutoffAt"
  );
  if (cutoffAt.getTime() !== window.startInclusive.getTime()) {
    throw new Error(
      `manifest cutoff must equal its generated-at seven-day Vancouver cutoff ${window.startInclusive.toISOString()}`
    );
  }
  return { generatedAt, window };
}

export function validateApprovedUnansweredLeadDraftManifest(
  manifest: ApprovedUnansweredLeadDraftManifest,
  now = new Date()
): VancouverCalendarWindow {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("manifest must be an object");
  }
  assertExactKeys(
    manifest as unknown as Record<string, unknown>,
    MANIFEST_KEYS,
    "manifest"
  );
  if (manifest.schemaVersion !== 1) {
    throw new Error("manifest.schemaVersion must be 1");
  }
  assertUuid(manifest.companyId, "manifest.companyId");
  assertUuid(manifest.actorUserId, "manifest.actorUserId");
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("now must be a valid date");
  }
  const { generatedAt, window } = exactWindow(manifest);
  if (generatedAt.getTime() > now.getTime()) {
    throw new Error("manifest.generatedAt must not be in the future");
  }
  if (now.getTime() - generatedAt.getTime() > MANIFEST_MAX_AGE_MS) {
    throw new Error("manifest.generatedAt is more than 24 hours old");
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    throw new Error("manifest.entries must contain at least one approved lead");
  }

  const opportunityIds = new Set<string>();
  const sourceEventIds = new Set<string>();
  const exactProviderMessages = new Set<string>();
  for (const [index, entry] of manifest.entries.entries()) {
    const label = `manifest.entries[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${label} must be an object`);
    }
    assertExactKeys(
      entry as unknown as Record<string, unknown>,
      ENTRY_KEYS,
      label
    );
    assertUuid(entry.opportunityId, `${label}.opportunityId`);
    assertUuid(entry.sourceEventId, `${label}.sourceEventId`);
    assertUuid(entry.sourceActivityId, `${label}.sourceActivityId`);
    assertUuid(entry.sourceConnectionId, `${label}.sourceConnectionId`);
    assertNonBlank(entry.label, `${label}.label`);
    assertNonBlank(
      entry.sourceProviderThreadId,
      `${label}.sourceProviderThreadId`
    );
    assertNonBlank(
      entry.sourceProviderMessageId,
      `${label}.sourceProviderMessageId`
    );
    if (entry.providerThreadId !== null) {
      assertNonBlank(entry.providerThreadId, `${label}.providerThreadId`);
      if (entry.providerThreadId !== entry.sourceProviderThreadId) {
        throw new Error(
          `${label}.providerThreadId must match its exact source thread`
        );
      }
    }
    if (entry.recipientName !== null) {
      assertNonBlank(entry.recipientName, `${label}.recipientName`);
    }
    assertNonBlank(entry.recipientEmail, `${label}.recipientEmail`);
    if (
      entry.recipientEmail !== entry.recipientEmail.toLowerCase() ||
      !EMAIL_PATTERN.test(entry.recipientEmail)
    ) {
      throw new Error(`${label}.recipientEmail must be a normalized email`);
    }
    const occurredAt = parseCanonicalTimestamp(
      entry.sourceOccurredAt,
      `${label}.sourceOccurredAt`
    );
    if (
      occurredAt.getTime() < window.startInclusive.getTime() ||
      occurredAt.getTime() > window.endInclusive.getTime()
    ) {
      throw new Error(`${label} is outside the seven-day Vancouver window`);
    }
    assertNonBlank(entry.expectedStage, `${label}.expectedStage`);
    if (!ACTIVE_SALES_STAGES.has(entry.expectedStage)) {
      throw new Error(`${label}.expectedStage is not an active sales stage`);
    }
    if (typeof entry.expectedStageManuallySet !== "boolean") {
      throw new Error(`${label}.expectedStageManuallySet must be boolean`);
    }
    if (
      !Number.isSafeInteger(entry.expectedAssignmentVersion) ||
      entry.expectedAssignmentVersion < 0
    ) {
      throw new Error(
        `${label}.expectedAssignmentVersion must be a non-negative integer`
      );
    }
    if (entry.expectedAssignedTo !== null) {
      assertUuid(entry.expectedAssignedTo, `${label}.expectedAssignedTo`);
    }
    if (entry.expectedWorkstream !== "sales") {
      throw new Error(`${label}.expectedWorkstream must be sales`);
    }

    const providerKey = [
      entry.sourceConnectionId,
      entry.sourceProviderThreadId,
      entry.sourceProviderMessageId,
    ].join("\u0000");
    if (
      opportunityIds.has(entry.opportunityId) ||
      sourceEventIds.has(entry.sourceEventId) ||
      exactProviderMessages.has(providerKey)
    ) {
      throw new Error(
        `${label} duplicates an approved opportunity or source event`
      );
    }
    opportunityIds.add(entry.opportunityId);
    sourceEventIds.add(entry.sourceEventId);
    exactProviderMessages.add(providerKey);
  }

  return window;
}

function candidateFromManifest(
  companyId: string,
  entry: ApprovedUnansweredLeadDraftManifestEntry
): UnansweredLeadDraftCandidate {
  return { companyId, ...entry };
}

function candidatesMatch(
  expected: UnansweredLeadDraftCandidate,
  current: UnansweredLeadDraftCandidate
): boolean {
  return (
    current.opportunityId === expected.opportunityId &&
    current.companyId === expected.companyId &&
    current.recipientName === expected.recipientName &&
    current.recipientEmail === expected.recipientEmail &&
    current.sourceEventId === expected.sourceEventId &&
    current.sourceActivityId === expected.sourceActivityId &&
    current.sourceConnectionId === expected.sourceConnectionId &&
    current.sourceProviderThreadId === expected.sourceProviderThreadId &&
    current.sourceProviderMessageId === expected.sourceProviderMessageId &&
    current.sourceOccurredAt === expected.sourceOccurredAt &&
    current.providerThreadId === expected.providerThreadId &&
    current.expectedStage === expected.expectedStage &&
    current.expectedStageManuallySet === expected.expectedStageManuallySet &&
    current.expectedAssignmentVersion === expected.expectedAssignmentVersion &&
    current.expectedAssignedTo === expected.expectedAssignedTo &&
    current.expectedWorkstream === expected.expectedWorkstream
  );
}

function assertExactWindow(
  requested: VancouverCalendarWindow,
  approved: VancouverCalendarWindow
): void {
  if (
    requested.timeZone !== approved.timeZone ||
    requested.startInclusive.getTime() !== approved.startInclusive.getTime() ||
    requested.endInclusive.getTime() !== approved.endInclusive.getTime()
  ) {
    throw new Error("approved draft execution window changed");
  }
}

function scopeDependenciesToManifest(
  manifest: ApprovedUnansweredLeadDraftManifest,
  window: VancouverCalendarWindow,
  dependencies: UnansweredLeadDraftBackfillDependencies
): UnansweredLeadDraftBackfillDependencies {
  const expectedByOpportunityId = new Map(
    manifest.entries.map((entry) => [
      entry.opportunityId,
      candidateFromManifest(manifest.companyId, entry),
    ])
  );

  return {
    ...dependencies,
    async loadOpportunitySnapshots(input) {
      if (input.companyId !== manifest.companyId) {
        throw new Error("approved draft execution company changed");
      }
      assertExactWindow(input.window, window);
      const snapshots = await dependencies.loadOpportunitySnapshots(input);
      const scoped = snapshots.filter((snapshot) =>
        expectedByOpportunityId.has(snapshot.id)
      );
      const currentPlan = selectUnansweredLeadDraftCandidates(
        scoped,
        window,
        manifest.companyId
      );
      const currentByOpportunityId = new Map(
        currentPlan.candidates.map((candidate) => [
          candidate.opportunityId,
          candidate,
        ])
      );
      for (const [opportunityId, expected] of expectedByOpportunityId) {
        const current = currentByOpportunityId.get(opportunityId);
        if (!current || !candidatesMatch(expected, current)) {
          throw new Error(`approved draft candidate changed: ${opportunityId}`);
        }
      }
      if (
        scoped.length !== expectedByOpportunityId.size ||
        currentPlan.candidates.length !== expectedByOpportunityId.size
      ) {
        throw new Error("approved draft candidate set changed");
      }
      return scoped;
    },
  };
}

function planEntryStatuses(
  manifest: ApprovedUnansweredLeadDraftManifest,
  authorizedOpportunityIds: Set<string>
): ApprovedUnansweredLeadDraftExecutionEntry[] {
  return manifest.entries.map((entry) => ({
    opportunityId: entry.opportunityId,
    sourceEventId: entry.sourceEventId,
    status: authorizedOpportunityIds.has(entry.opportunityId)
      ? "ready"
      : "unauthorized",
  }));
}

export async function runApprovedUnansweredLeadLocalDraftBackfill(
  input: RunApprovedUnansweredLeadLocalDraftBackfillInput
): Promise<ApprovedUnansweredLeadDraftExecutionResult> {
  const now = input.now ?? new Date();
  const window = validateApprovedUnansweredLeadDraftManifest(
    input.manifest,
    now
  );
  const manifestSha256 = buildUnansweredLeadDraftManifestHash(input.manifest);
  const apply = input.apply === true;

  if (apply) {
    if (!SHA256_PATTERN.test(input.approvedManifestSha256 ?? "")) {
      throw new Error(
        "apply requires an approved manifest sha256 with 64 lowercase hexadecimal characters"
      );
    }
    if (input.approvedManifestSha256 !== manifestSha256) {
      throw new Error("approved manifest sha256 does not match");
    }
  } else if (input.approvedManifestSha256) {
    throw new Error("approved manifest sha256 requires apply");
  }

  const scopedDependencies = scopeDependenciesToManifest(
    input.manifest,
    window,
    input.dependencies
  );
  const service = new UnansweredLeadLocalDraftBackfillService(
    scopedDependencies
  );
  const serviceInput = {
    actorUserId: input.manifest.actorUserId,
    companyId: input.manifest.companyId,
    now: new Date(input.manifest.generatedAt),
  };
  const plan = await service.plan(serviceInput);
  const authorizedOpportunityIds = new Set(
    plan.candidates.map((candidate) => candidate.opportunityId)
  );

  if (!apply) {
    return {
      mode: "dry-run",
      manifestSha256,
      cutoffAt: input.manifest.cutoffAt,
      generatedAt: input.manifest.generatedAt,
      entries: planEntryStatuses(input.manifest, authorizedOpportunityIds),
    };
  }
  if (authorizedOpportunityIds.size !== input.manifest.entries.length) {
    throw new Error("approved draft manifest is not currently authorized");
  }

  const executionDependencies: UnansweredLeadDraftBackfillDependencies = {
    ...scopedDependencies,
    async authorizeCurrentAccess(authorizationInput) {
      const access =
        await scopedDependencies.authorizeCurrentAccess(authorizationInput);
      if (!access.inboxAllowed || !access.pipelineAllowed) {
        throw new Error("approved draft manifest authorization changed");
      }
      return access;
    },
  };
  const execution = await new UnansweredLeadLocalDraftBackfillService(
    executionDependencies
  ).execute(serviceInput);
  const itemsByOpportunityId = new Map(
    execution.items.map((item) => [item.opportunityId, item])
  );
  const entries = input.manifest.entries.map((entry) => {
    const item = itemsByOpportunityId.get(entry.opportunityId);
    if (!item) {
      throw new Error(
        `approved draft execution omitted opportunity: ${entry.opportunityId}`
      );
    }
    return {
      opportunityId: entry.opportunityId,
      sourceEventId: entry.sourceEventId,
      status: item.status,
      ...(item.reason ? { reason: item.reason } : {}),
    };
  });

  return {
    mode: "apply",
    manifestSha256,
    cutoffAt: input.manifest.cutoffAt,
    generatedAt: input.manifest.generatedAt,
    entries,
  };
}
