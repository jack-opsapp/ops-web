import "server-only";

const COMPONENTS = [
  "summary",
  "lifecycle",
  "commercial",
  "event_handoff",
] as const;

export type PhaseCLeadIntelligenceComponent = (typeof COMPONENTS)[number];
export type PhaseCLeadIntelligenceComponentOutcome =
  | "applied"
  | "unchanged"
  | "skipped"
  | "review";

export interface ClaimedPhaseCLeadIntelligenceWork {
  companyId: string;
  opportunityId: string;
  requiredEventId: string;
  requiredEventAt: string;
  requiredActivityId: string | null;
  requiredConnectionId: string | null;
  requiredProviderThreadId: string;
  attemptCount: number;
  componentOutcomes: Record<string, unknown>;
  componentErrors: Record<string, unknown>;
}

export interface PhaseCLeadIntelligenceComponentResult {
  outcome: PhaseCLeadIntelligenceComponentOutcome;
  detail?: Record<string, unknown>;
  /** Phase C being disabled is a durable skip for every remaining component. */
  skipRemainingReason?: string;
}

export interface PhaseCLeadIntelligenceWorkDependencies {
  workerId(): string;
  claim(input: {
    workerId: string;
    limit: number;
    leaseSeconds: number;
  }): Promise<ClaimedPhaseCLeadIntelligenceWork[]>;
  isComponentComplete(
    work: ClaimedPhaseCLeadIntelligenceWork,
    component: PhaseCLeadIntelligenceComponent
  ): boolean;
  processComponent(input: {
    work: ClaimedPhaseCLeadIntelligenceWork;
    component: PhaseCLeadIntelligenceComponent;
  }): Promise<PhaseCLeadIntelligenceComponentResult>;
  acknowledge(input: {
    companyId: string;
    opportunityId: string;
    expectedRequiredEventId: string;
    workerId: string;
    component: PhaseCLeadIntelligenceComponent;
    outcome: PhaseCLeadIntelligenceComponentOutcome;
    detail: Record<string, unknown>;
  }): Promise<"acknowledged" | "completed" | "superseded" | "lease_lost">;
  fail(input: {
    companyId: string;
    opportunityId: string;
    expectedRequiredEventId: string;
    workerId: string;
    errorCode: string;
    errorMessage: string;
    retrySeconds: number;
    componentErrors: Partial<
      Record<PhaseCLeadIntelligenceComponent, { code: string; message: string }>
    >;
  }): Promise<"retry_scheduled" | "superseded" | "lease_lost">;
}

export interface PhaseCLeadIntelligenceWorkerResult {
  claimed: number;
  completed: number;
  superseded: number;
  retrying: number;
  failed: number;
  componentsApplied: number;
  componentsReviewed: number;
  componentsSkippedAsComplete: number;
  errors: Array<{ opportunityId: string; error: string }>;
}

export interface PhaseCLeadIntelligenceWorkerOptions {
  limit?: number;
  leaseSeconds?: number;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value as number)));
}

function retrySeconds(attemptCount: number): number {
  const exponent = Math.min(7, Math.max(0, attemptCount - 1));
  return Math.min(3_600, 30 * 2 ** exponent);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emptyResult(): PhaseCLeadIntelligenceWorkerResult {
  return {
    claimed: 0,
    completed: 0,
    superseded: 0,
    retrying: 0,
    failed: 0,
    componentsApplied: 0,
    componentsReviewed: 0,
    componentsSkippedAsComplete: 0,
    errors: [],
  };
}

/**
 * Leased, evidence-fenced orchestration for the four Phase C lead-intelligence
 * effects. A component is acknowledged only after its side effect commits.
 * Crashes and provider/model failures therefore leave the same high-water mark
 * due for replay without repeating already-acknowledged components.
 */
export class PhaseCLeadIntelligenceWorkService {
  constructor(
    private readonly dependencies: PhaseCLeadIntelligenceWorkDependencies
  ) {}

  async runWorker(
    options: PhaseCLeadIntelligenceWorkerOptions = {}
  ): Promise<PhaseCLeadIntelligenceWorkerResult> {
    const result = emptyResult();
    const workerId = this.dependencies.workerId();
    const jobs = await this.dependencies.claim({
      workerId,
      limit: boundedInteger(options.limit, 2, 1, 10),
      leaseSeconds: boundedInteger(options.leaseSeconds, 300, 30, 900),
    });
    result.claimed = jobs.length;

    for (const work of jobs) {
      let skipRemainingReason: string | null = null;
      let terminalDisposition:
        | "completed"
        | "superseded"
        | "lease_lost"
        | null = null;
      const componentErrors: Partial<
        Record<
          PhaseCLeadIntelligenceComponent,
          { code: string; message: string }
        >
      > = {};

      for (const component of COMPONENTS) {
        if (this.dependencies.isComponentComplete(work, component)) {
          result.componentsSkippedAsComplete += 1;
          continue;
        }

        let componentResult: PhaseCLeadIntelligenceComponentResult;
        try {
          componentResult = skipRemainingReason
            ? {
                outcome: "skipped",
                detail: { reason: skipRemainingReason },
              }
            : await this.dependencies.processComponent({ work, component });
          skipRemainingReason ??= componentResult.skipRemainingReason ?? null;
        } catch (error) {
          const message = errorMessage(error);
          componentErrors[component] = {
            code: `phase_c_${component}_failed`,
            message,
          };
          continue;
        }

        try {
          const disposition = await this.dependencies.acknowledge({
            companyId: work.companyId,
            opportunityId: work.opportunityId,
            expectedRequiredEventId: work.requiredEventId,
            workerId,
            component,
            outcome: componentResult.outcome,
            detail: componentResult.detail ?? {},
          });
          if (componentResult.outcome === "applied") {
            result.componentsApplied += 1;
          } else if (componentResult.outcome === "review") {
            result.componentsReviewed += 1;
          }
          if (disposition !== "acknowledged") {
            terminalDisposition = disposition;
            break;
          }
        } catch (error) {
          const message = errorMessage(error);
          componentErrors[component] = {
            code: `phase_c_${component}_ack_failed`,
            message,
          };
          break;
        }
      }

      if (terminalDisposition === "completed") {
        result.completed += 1;
        continue;
      }
      if (terminalDisposition === "superseded") {
        result.superseded += 1;
        continue;
      }
      if (terminalDisposition === "lease_lost") {
        componentErrors.summary ??= {
          code: "phase_c_lease_lost",
          message: "Phase C work lease lost before acknowledgement",
        };
      }

      const failures = Object.entries(componentErrors) as Array<
        [PhaseCLeadIntelligenceComponent, { code: string; message: string }]
      >;
      if (failures.length === 0) {
        // A row with every component already acknowledged is normally excluded
        // by the claim RPC, but treating that replay as complete is harmless.
        result.completed += 1;
        continue;
      }

      const combinedMessage = failures
        .map(([component, failure]) => `${component}: ${failure.message}`)
        .join("; ");
      const failureDisposition = await this.dependencies.fail({
        companyId: work.companyId,
        opportunityId: work.opportunityId,
        expectedRequiredEventId: work.requiredEventId,
        workerId,
        errorCode:
          failures.length === 1
            ? failures[0][1].code
            : "phase_c_components_failed",
        errorMessage: combinedMessage,
        retrySeconds: retrySeconds(work.attemptCount),
        componentErrors,
      });
      if (failureDisposition === "retry_scheduled") {
        result.retrying += 1;
      } else if (failureDisposition === "superseded") {
        result.superseded += 1;
      } else {
        result.failed += 1;
      }
      result.errors.push({
        opportunityId: work.opportunityId,
        error: combinedMessage,
      });
    }

    return result;
  }
}
