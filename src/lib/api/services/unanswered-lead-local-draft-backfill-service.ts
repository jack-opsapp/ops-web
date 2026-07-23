const VANCOUVER_TIME_ZONE = "America/Vancouver";
const CALENDAR_DAY_MS = 24 * 60 * 60 * 1000;
const EXECUTION_CONCURRENCY = 3;

const ACTIVE_SALES_STAGES = new Set([
  "new_lead",
  "qualifying",
  "quoting",
  "quoted",
  "follow_up",
  "negotiation",
]);
const TERMINAL_STAGES = new Set(["won", "lost", "discarded"]);

export type UnansweredLeadWorkstream =
  | "sales"
  | "warranty"
  | "service"
  | "current_project"
  | "internal"
  | "automated"
  | "unknown";

export type UnansweredLeadPartyRole =
  | "customer"
  | "ops"
  | "internal"
  | "provider"
  | "system"
  | "marketing"
  | "unknown";

export type UnansweredLeadResponseDisposition =
  | "reply_required"
  | "no_reply_required"
  | "unknown";

export interface UnansweredLeadCorrespondenceSnapshot {
  id: string;
  activityId: string | null;
  opportunityId: string;
  connectionId: string | null;
  providerThreadId: string | null;
  providerMessageId: string | null;
  direction: "inbound" | "outbound";
  partyRole: UnansweredLeadPartyRole;
  /** Exact normalized envelope sender; never inferred from subject/body text. */
  fromEmail: string | null;
  /** Structured envelope recipients used only to prove an OPS answer. */
  toEmails: string[];
  ccEmails: string[];
  isMeaningful: boolean;
  noiseReason: string | null;
  responseDisposition: UnansweredLeadResponseDisposition;
  /** Message scope means a forwarded form message must start a new reply thread. */
  conversationScope: "message" | "thread";
  occurredAt: string;
  /** Customer-controlled data. Selection and authorization must never inspect it. */
  untrustedSubject: string | null;
  /** Customer-controlled data. It is passed only to the isolated copy generator. */
  untrustedBodyText: string | null;
}

export interface UnansweredLeadOpportunitySnapshot {
  id: string;
  /** Human-readable audit label only; never used as decision evidence. */
  label: string;
  companyId: string;
  stage: string;
  stageManuallySet: boolean;
  assignmentVersion: number;
  assignedTo: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  mergedIntoOpportunityId: string | null;
  projectId: string | null;
  projectRef: string | null;
  /** Structured upstream disposition. Email body text is not classification authority. */
  workstream: UnansweredLeadWorkstream;
  contactName: string | null;
  contactEmail: string | null;
  /** All opportunity correspondence, regardless of provider-thread fragmentation. */
  events: UnansweredLeadCorrespondenceSnapshot[];
}

export interface VancouverCalendarWindow {
  timeZone: typeof VANCOUVER_TIME_ZONE;
  startInclusive: Date;
  endInclusive: Date;
}

export type UnansweredLeadDraftExclusionReason =
  | "wrong_company"
  | "deleted"
  | "archived"
  | "merged"
  | "terminal_stage"
  | "inactive_stage"
  | "current_project"
  | "not_sales"
  | "missing_recipient"
  | "no_meaningful_customer_inbound"
  | "outside_window"
  | "no_reply_required"
  | "missing_source_provenance"
  | "answered"
  | "unauthorized";

export interface UnansweredLeadDraftCandidate {
  opportunityId: string;
  label: string;
  companyId: string;
  recipientName: string | null;
  recipientEmail: string;
  sourceEventId: string;
  sourceActivityId: string;
  sourceConnectionId: string;
  sourceProviderThreadId: string;
  sourceProviderMessageId: string;
  sourceOccurredAt: string;
  /** Null for forwarded form submissions so no reply can target the forwarder. */
  providerThreadId: string | null;
  expectedStage: string;
  expectedStageManuallySet: boolean;
  expectedAssignmentVersion: number;
  expectedAssignedTo: string | null;
  expectedWorkstream: UnansweredLeadWorkstream;
}

export interface UnansweredLeadDraftExclusion {
  opportunityId: string;
  label: string;
  reason: UnansweredLeadDraftExclusionReason;
}

export interface UnansweredLeadDraftPlan {
  window: VancouverCalendarWindow;
  candidates: UnansweredLeadDraftCandidate[];
  excluded: UnansweredLeadDraftExclusion[];
}

export interface UnansweredLeadDraftAuthorization {
  inboxAllowed: boolean;
  pipelineAllowed: boolean;
}

export interface UntrustedConversationMessage {
  direction: "inbound" | "outbound";
  occurredAt: string;
  untrustedSubject: string | null;
  untrustedBodyText: string | null;
}

export interface UntrustedConversationSnapshot {
  sourceEventId: string;
  messages: UntrustedConversationMessage[];
}

export interface LocalGeneratedCopy {
  subject: string;
  body: string;
  aiDraftHistoryId: string;
}

export interface LocalSystemHandoffPersistenceInput {
  actorUserId: string;
  companyId: string;
  opportunityId: string;
  connectionId: string;
  recipientName: string | null;
  recipientEmail: string;
  sourceEventId: string;
  sourceActivityId: string;
  sourceProviderMessageId: string;
  sourceProviderThreadId: string;
  sourceOccurredAt: string;
  providerThreadId: string | null;
  providerDraftId: null;
  origin: "system_handoff";
  subject: string;
  body: string;
  aiDraftHistoryId: string;
  expectedWorkstream: UnansweredLeadWorkstream;
  expectedStage: string;
  expectedStageManuallySet: boolean;
  expectedAssignmentVersion: number;
  expectedAssignedTo: string | null;
}

export type LocalSystemHandoffPersistenceResult =
  | "created"
  | "already_exists"
  | "stale";

export interface UnansweredLeadDraftBackfillDependencies {
  loadOpportunitySnapshots(input: {
    companyId: string;
    window: VancouverCalendarWindow;
  }): Promise<UnansweredLeadOpportunitySnapshot[]>;
  loadCurrentOpportunitySnapshot(input: {
    companyId: string;
    opportunityId: string;
    sourceEventId: string;
  }): Promise<UnansweredLeadOpportunitySnapshot | null>;
  /** Must bridge both canonical inbox and canonical pipeline authorization. */
  authorizeCurrentAccess(input: {
    actorUserId: string;
    companyId: string;
    opportunityId: string;
    connectionId: string;
    expectedAssignmentVersion: number;
    expectedAssignedTo: string | null;
  }): Promise<UnansweredLeadDraftAuthorization>;
  claimLocalGeneration(input: {
    companyId: string;
    opportunityId: string;
    sourceEventId: string;
  }): Promise<{
    acquired: boolean;
    claimToken: string | null;
    reason: "acquired" | "existing_draft" | "generation_in_progress";
  }>;
  releaseLocalGeneration(input: {
    companyId: string;
    opportunityId: string;
    sourceEventId: string;
    claimToken: string;
  }): Promise<void>;
  loadUntrustedConversation(input: {
    companyId: string;
    opportunityId: string;
    sourceEventId: string;
  }): Promise<UntrustedConversationSnapshot>;
  /**
   * Receives customer-controlled text as data. Its adapter must keep that data
   * below a system-level instruction boundary and must not grant tool access.
   */
  generateLocalCopy(input: {
    actorUserId: string;
    candidate: UnansweredLeadDraftCandidate;
    untrustedConversation: UntrustedConversationSnapshot;
  }): Promise<LocalGeneratedCopy>;
  /**
   * Adapter must recheck every expected value atomically with the insert.
   * The only permitted durable result is an OPS-local lifecycle draft.
   */
  persistLocalSystemHandoff(
    input: LocalSystemHandoffPersistenceInput
  ): Promise<LocalSystemHandoffPersistenceResult>;
}

export interface UnansweredLeadDraftBackfillInput {
  actorUserId: string;
  companyId: string;
  now?: Date;
}

export type UnansweredLeadDraftExecutionStatus =
  | "created"
  | "already_exists"
  | "generation_in_progress"
  | "stale"
  | "failed";

export interface UnansweredLeadDraftExecutionItem {
  opportunityId: string;
  status: UnansweredLeadDraftExecutionStatus;
  reason?: "candidate_changed" | "authorization_changed" | "execution_failed";
}

export interface UnansweredLeadDraftExecutionResult {
  plan: UnansweredLeadDraftPlan;
  items: UnansweredLeadDraftExecutionItem[];
}

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

function requiredDateParts(date: Date, timeZone: string): LocalDateParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const parsed = Number(parts.find((part) => part.type === type)?.value);
    if (!Number.isInteger(parsed)) throw new Error("Invalid local date part");
    return parsed;
  };
  return { year: value("year"), month: value("month"), day: value("day") };
}

function timeZoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const parsed = Number(parts.find((part) => part.type === type)?.value);
    if (!Number.isInteger(parsed)) throw new Error("Invalid local time part");
    return parsed;
  };
  const representedAsUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second")
  );
  return representedAsUtc - at.getTime();
}

function zonedMidnightUtc(parts: LocalDateParts, timeZone: string): Date {
  const desired = Date.UTC(parts.year, parts.month - 1, parts.day);
  let guess = new Date(desired);
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const corrected = new Date(desired - timeZoneOffsetMs(guess, timeZone));
    if (corrected.getTime() === guess.getTime()) return corrected;
    guess = corrected;
  }
  return guess;
}

/** From Vancouver midnight seven local dates earlier through the exact run time. */
export function previousSevenVancouverCalendarDays(
  now = new Date()
): VancouverCalendarWindow {
  if (Number.isNaN(now.getTime())) throw new Error("Invalid backfill time");
  const today = requiredDateParts(now, VANCOUVER_TIME_ZONE);
  const startOrdinal = new Date(
    Date.UTC(today.year, today.month - 1, today.day) - 7 * CALENDAR_DAY_MS
  );
  const startParts = {
    year: startOrdinal.getUTCFullYear(),
    month: startOrdinal.getUTCMonth() + 1,
    day: startOrdinal.getUTCDate(),
  };
  return {
    timeZone: VANCOUVER_TIME_ZONE,
    startInclusive: zonedMidnightUtc(startParts, VANCOUVER_TIME_ZONE),
    endInclusive: new Date(now),
  };
}

function eventTime(event: UnansweredLeadCorrespondenceSnapshot): number | null {
  const value = Date.parse(event.occurredAt);
  return Number.isFinite(value) ? value : null;
}

function compareEvents(
  left: UnansweredLeadCorrespondenceSnapshot,
  right: UnansweredLeadCorrespondenceSnapshot
): number {
  const leftTime = eventTime(left) ?? Number.NEGATIVE_INFINITY;
  const rightTime = eventTime(right) ?? Number.NEGATIVE_INFINITY;
  if (leftTime !== rightTime) return leftTime - rightTime;
  return left.id.localeCompare(right.id);
}

function isMeaningfulCustomerInbound(
  event: UnansweredLeadCorrespondenceSnapshot
): boolean {
  return (
    event.direction === "inbound" &&
    event.partyRole === "customer" &&
    event.isMeaningful === true &&
    event.noiseReason === null
  );
}

function isMeaningfulOpsOutbound(
  event: UnansweredLeadCorrespondenceSnapshot
): boolean {
  return (
    event.direction === "outbound" &&
    event.partyRole === "ops" &&
    event.isMeaningful === true &&
    event.noiseReason === null
  );
}

function normalizedEmailSet(values: string[]): Set<string> {
  return new Set(
    values
      .map((value) => normalizedEmail(value))
      .filter((value): value is string => value !== null)
  );
}

function outboundAnswersInbound(
  outbound: UnansweredLeadCorrespondenceSnapshot,
  inbound: UnansweredLeadCorrespondenceSnapshot,
  recipientEmail: string
): boolean {
  if (
    !isMeaningfulOpsOutbound(outbound) ||
    compareEvents(outbound, inbound) <= 0
  ) {
    return false;
  }
  const outboundRecipients = normalizedEmailSet([
    ...outbound.toEmails,
    ...outbound.ccEmails,
  ]);
  if (outboundRecipients.has(recipientEmail)) return true;
  return (
    inbound.conversationScope === "thread" &&
    outbound.connectionId === inbound.connectionId &&
    outbound.providerThreadId === inbound.providerThreadId
  );
}

function normalizedEmail(value: string | null): string | null {
  const email = value?.trim().toLowerCase() ?? "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function exclusion(
  snapshot: UnansweredLeadOpportunitySnapshot,
  reason: UnansweredLeadDraftExclusionReason
): UnansweredLeadDraftExclusion {
  return { opportunityId: snapshot.id, label: snapshot.label, reason };
}

function evaluateSnapshot(
  snapshot: UnansweredLeadOpportunitySnapshot,
  window: VancouverCalendarWindow
):
  | { candidate: UnansweredLeadDraftCandidate; excluded?: never }
  | { candidate?: never; excluded: UnansweredLeadDraftExclusion } {
  if (snapshot.deletedAt) {
    return { excluded: exclusion(snapshot, "deleted") };
  }
  if (snapshot.archivedAt) {
    return { excluded: exclusion(snapshot, "archived") };
  }
  if (snapshot.mergedIntoOpportunityId) {
    return { excluded: exclusion(snapshot, "merged") };
  }
  if (TERMINAL_STAGES.has(snapshot.stage)) {
    return { excluded: exclusion(snapshot, "terminal_stage") };
  }
  if (!ACTIVE_SALES_STAGES.has(snapshot.stage)) {
    return { excluded: exclusion(snapshot, "inactive_stage") };
  }
  if (
    snapshot.projectId ||
    snapshot.projectRef ||
    snapshot.workstream === "current_project"
  ) {
    return { excluded: exclusion(snapshot, "current_project") };
  }
  if (snapshot.workstream !== "sales") {
    return { excluded: exclusion(snapshot, "not_sales") };
  }
  const inbound = snapshot.events
    .filter(isMeaningfulCustomerInbound)
    .filter((event) => eventTime(event) !== null)
    .sort(compareEvents)
    .at(-1);
  if (!inbound) {
    return { excluded: exclusion(snapshot, "no_meaningful_customer_inbound") };
  }
  const recipientEmail = normalizedEmail(inbound.fromEmail);
  if (!recipientEmail) {
    return { excluded: exclusion(snapshot, "missing_recipient") };
  }
  const inboundTime = eventTime(inbound)!;
  if (
    inboundTime < window.startInclusive.getTime() ||
    inboundTime > window.endInclusive.getTime()
  ) {
    return { excluded: exclusion(snapshot, "outside_window") };
  }
  if (inbound.responseDisposition !== "reply_required") {
    return { excluded: exclusion(snapshot, "no_reply_required") };
  }
  if (
    !inbound.activityId ||
    !inbound.connectionId ||
    !inbound.providerThreadId ||
    !inbound.providerMessageId
  ) {
    return { excluded: exclusion(snapshot, "missing_source_provenance") };
  }
  const laterOutbound = snapshot.events.some((event) =>
    outboundAnswersInbound(event, inbound, recipientEmail)
  );
  if (laterOutbound) {
    return { excluded: exclusion(snapshot, "answered") };
  }

  return {
    candidate: {
      opportunityId: snapshot.id,
      label: snapshot.label,
      companyId: snapshot.companyId,
      recipientName:
        normalizedEmail(snapshot.contactEmail) === recipientEmail
          ? snapshot.contactName?.trim() || null
          : null,
      recipientEmail,
      sourceEventId: inbound.id,
      sourceActivityId: inbound.activityId,
      sourceConnectionId: inbound.connectionId,
      sourceProviderThreadId: inbound.providerThreadId,
      sourceProviderMessageId: inbound.providerMessageId,
      sourceOccurredAt: inbound.occurredAt,
      providerThreadId:
        inbound.conversationScope === "thread"
          ? inbound.providerThreadId
          : null,
      expectedStage: snapshot.stage,
      expectedStageManuallySet: snapshot.stageManuallySet,
      expectedAssignmentVersion: snapshot.assignmentVersion,
      expectedAssignedTo: snapshot.assignedTo,
      expectedWorkstream: snapshot.workstream,
    },
  };
}

export function selectUnansweredLeadDraftCandidates(
  snapshots: UnansweredLeadOpportunitySnapshot[],
  window: VancouverCalendarWindow,
  companyId?: string
): UnansweredLeadDraftPlan {
  const candidates: UnansweredLeadDraftCandidate[] = [];
  const excluded: UnansweredLeadDraftExclusion[] = [];

  for (const snapshot of snapshots) {
    if (companyId && snapshot.companyId !== companyId) {
      excluded.push(exclusion(snapshot, "wrong_company"));
      continue;
    }
    const decision = evaluateSnapshot(snapshot, window);
    if (decision.candidate) candidates.push(decision.candidate);
    else excluded.push(decision.excluded);
  }

  candidates.sort((left, right) =>
    left.opportunityId.localeCompare(right.opportunityId)
  );
  return { window, candidates, excluded };
}

function sameCandidate(
  planned: UnansweredLeadDraftCandidate,
  current: UnansweredLeadDraftCandidate
): boolean {
  return (
    current.opportunityId === planned.opportunityId &&
    current.companyId === planned.companyId &&
    current.recipientName === planned.recipientName &&
    current.recipientEmail === planned.recipientEmail &&
    current.sourceEventId === planned.sourceEventId &&
    current.sourceActivityId === planned.sourceActivityId &&
    current.sourceConnectionId === planned.sourceConnectionId &&
    current.sourceProviderThreadId === planned.sourceProviderThreadId &&
    current.sourceProviderMessageId === planned.sourceProviderMessageId &&
    current.sourceOccurredAt === planned.sourceOccurredAt &&
    current.providerThreadId === planned.providerThreadId &&
    current.expectedStage === planned.expectedStage &&
    current.expectedStageManuallySet === planned.expectedStageManuallySet &&
    current.expectedAssignmentVersion === planned.expectedAssignmentVersion &&
    current.expectedAssignedTo === planned.expectedAssignedTo &&
    current.expectedWorkstream === planned.expectedWorkstream
  );
}

function isAuthorized(access: UnansweredLeadDraftAuthorization): boolean {
  return access.inboxAllowed === true && access.pipelineAllowed === true;
}

export class UnansweredLeadLocalDraftBackfillService {
  constructor(
    private readonly dependencies: UnansweredLeadDraftBackfillDependencies
  ) {}

  private authorize(
    actorUserId: string,
    candidate: UnansweredLeadDraftCandidate
  ): Promise<UnansweredLeadDraftAuthorization> {
    return this.dependencies.authorizeCurrentAccess({
      actorUserId,
      companyId: candidate.companyId,
      opportunityId: candidate.opportunityId,
      connectionId: candidate.sourceConnectionId,
      expectedAssignmentVersion: candidate.expectedAssignmentVersion,
      expectedAssignedTo: candidate.expectedAssignedTo,
    });
  }

  async plan(
    input: UnansweredLeadDraftBackfillInput
  ): Promise<UnansweredLeadDraftPlan> {
    const window = previousSevenVancouverCalendarDays(input.now);
    const snapshots = await this.dependencies.loadOpportunitySnapshots({
      companyId: input.companyId,
      window,
    });
    const deterministic = selectUnansweredLeadDraftCandidates(
      snapshots,
      window,
      input.companyId
    );
    const candidates: UnansweredLeadDraftCandidate[] = [];
    const excluded = [...deterministic.excluded];

    for (const candidate of deterministic.candidates) {
      const access = await this.authorize(input.actorUserId, candidate);
      if (isAuthorized(access)) candidates.push(candidate);
      else {
        excluded.push({
          opportunityId: candidate.opportunityId,
          label: candidate.label,
          reason: "unauthorized",
        });
      }
    }

    return { ...deterministic, candidates, excluded };
  }

  private async fence(
    actorUserId: string,
    planned: UnansweredLeadDraftCandidate,
    window: VancouverCalendarWindow
  ): Promise<"current" | "candidate_changed" | "authorization_changed"> {
    const snapshot = await this.dependencies.loadCurrentOpportunitySnapshot({
      companyId: planned.companyId,
      opportunityId: planned.opportunityId,
      sourceEventId: planned.sourceEventId,
    });
    if (!snapshot) return "candidate_changed";
    const decision = selectUnansweredLeadDraftCandidates(
      [snapshot],
      window,
      planned.companyId
    );
    const current = decision.candidates[0];
    if (!current || !sameCandidate(planned, current)) {
      return "candidate_changed";
    }
    return isAuthorized(await this.authorize(actorUserId, current))
      ? "current"
      : "authorization_changed";
  }

  private async processCandidate(
    actorUserId: string,
    candidate: UnansweredLeadDraftCandidate,
    window: VancouverCalendarWindow
  ): Promise<UnansweredLeadDraftExecutionItem> {
    const initialFence = await this.fence(actorUserId, candidate, window);
    if (initialFence !== "current") {
      return {
        opportunityId: candidate.opportunityId,
        status: "stale",
        reason: initialFence,
      };
    }

    const claim = await this.dependencies.claimLocalGeneration({
      companyId: candidate.companyId,
      opportunityId: candidate.opportunityId,
      sourceEventId: candidate.sourceEventId,
    });
    if (!claim.acquired || !claim.claimToken) {
      return {
        opportunityId: candidate.opportunityId,
        status:
          claim.reason === "existing_draft"
            ? "already_exists"
            : "generation_in_progress",
      };
    }

    try {
      const untrustedConversation =
        await this.dependencies.loadUntrustedConversation({
          companyId: candidate.companyId,
          opportunityId: candidate.opportunityId,
          sourceEventId: candidate.sourceEventId,
        });
      if (untrustedConversation.sourceEventId !== candidate.sourceEventId) {
        return {
          opportunityId: candidate.opportunityId,
          status: "stale",
          reason: "candidate_changed",
        };
      }

      const generated = await this.dependencies.generateLocalCopy({
        actorUserId,
        candidate,
        untrustedConversation,
      });
      if (!generated.subject.trim() || !generated.body.trim()) {
        return {
          opportunityId: candidate.opportunityId,
          status: "failed",
          reason: "execution_failed",
        };
      }

      const finalFence = await this.fence(actorUserId, candidate, window);
      if (finalFence !== "current") {
        return {
          opportunityId: candidate.opportunityId,
          status: "stale",
          reason: finalFence,
        };
      }

      const persisted = await this.dependencies.persistLocalSystemHandoff({
        actorUserId,
        companyId: candidate.companyId,
        opportunityId: candidate.opportunityId,
        connectionId: candidate.sourceConnectionId,
        recipientName: candidate.recipientName,
        recipientEmail: candidate.recipientEmail,
        sourceEventId: candidate.sourceEventId,
        sourceActivityId: candidate.sourceActivityId,
        sourceProviderMessageId: candidate.sourceProviderMessageId,
        sourceProviderThreadId: candidate.sourceProviderThreadId,
        sourceOccurredAt: candidate.sourceOccurredAt,
        providerThreadId: candidate.providerThreadId,
        providerDraftId: null,
        origin: "system_handoff",
        subject: generated.subject.trim(),
        body: generated.body.trim(),
        aiDraftHistoryId: generated.aiDraftHistoryId,
        expectedWorkstream: candidate.expectedWorkstream,
        expectedStage: candidate.expectedStage,
        expectedStageManuallySet: candidate.expectedStageManuallySet,
        expectedAssignmentVersion: candidate.expectedAssignmentVersion,
        expectedAssignedTo: candidate.expectedAssignedTo,
      });
      return {
        opportunityId: candidate.opportunityId,
        status: persisted,
        ...(persisted === "stale"
          ? { reason: "candidate_changed" as const }
          : {}),
      };
    } catch {
      return {
        opportunityId: candidate.opportunityId,
        status: "failed",
        reason: "execution_failed",
      };
    } finally {
      try {
        await this.dependencies.releaseLocalGeneration({
          companyId: candidate.companyId,
          opportunityId: candidate.opportunityId,
          sourceEventId: candidate.sourceEventId,
          claimToken: claim.claimToken,
        });
      } catch {
        // The bounded claim expires. Never turn a durable local draft into an
        // apparent failure merely because lease cleanup needs to converge.
      }
    }
  }

  async execute(
    input: UnansweredLeadDraftBackfillInput
  ): Promise<UnansweredLeadDraftExecutionResult> {
    const plan = await this.plan(input);
    const items = new Array<UnansweredLeadDraftExecutionItem>(
      plan.candidates.length
    );
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
      while (nextIndex < plan.candidates.length) {
        const index = nextIndex;
        nextIndex += 1;
        const candidate = plan.candidates[index];
        if (!candidate) continue;
        items[index] = await this.processCandidate(
          input.actorUserId,
          candidate,
          plan.window
        );
      }
    };
    await Promise.all(
      Array.from(
        {
          length: Math.min(EXECUTION_CONCURRENCY, plan.candidates.length),
        },
        worker
      )
    );
    return { plan, items };
  }
}
