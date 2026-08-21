export type PhaseCBilateralEventHandoffStatus =
  "ready" | "review" | "consumed" | "cancelled";

export interface ClaimedPhaseCBilateralEventHandoff {
  id: string;
  companyId: string;
  opportunityId: string;
  requestedOwnerUserId: string | null;
  status: PhaseCBilateralEventHandoffStatus;
  canonicalEventKind: string | null;
  canonicalEventId: string | null;
  attemptCount: number;
}

export interface PhaseCBilateralEventOutcome {
  handoffId: string;
  companyId: string;
  opportunityId: string;
  requestedOwnerUserId: string | null;
  status: Exclude<PhaseCBilateralEventHandoffStatus, "ready">;
  reviewReason: string | null;
  canonicalEventKind: string | null;
  canonicalEventId: string | null;
  eventKind?: "site_visit" | "meeting" | "call" | "work";
  eventTitle?: string;
  startsAt?: string;
  eventTimezone?: string;
  location?: string;
  leadTitle?: string;
}

export interface PhaseCBilateralEventConsumerDependencies {
  workerId(): string;
  claim(input: {
    workerId: string;
    limit: number;
    leaseSeconds: number;
  }): Promise<ClaimedPhaseCBilateralEventHandoff[]>;
  consume(input: {
    handoffId: string;
    workerId: string;
  }): Promise<PhaseCBilateralEventOutcome>;
  readback(input: {
    handoffId: string;
    canonicalEventId: string | null;
  }): Promise<PhaseCBilateralEventOutcome>;
  dispatchNotification(
    outcome: PhaseCBilateralEventOutcome
  ): Promise<{ notified: number; pushed: number }>;
  acknowledge(input: {
    handoffId: string;
    workerId: string;
  }): Promise<"acknowledged">;
  fail(input: {
    handoffId: string;
    workerId: string;
    errorCode: "consumption_failed" | "notification_failed";
    errorMessage: string;
  }): Promise<"retrying" | "failed">;
}

export interface PhaseCBilateralEventConsumerResult {
  claimed: number;
  booked: number;
  reviewed: number;
  cancelled: number;
  notified: number;
  pushed: number;
  retrying: number;
  failed: number;
  errors: Array<{ handoffId: string; error: string }>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Small sequential worker around the database's atomic booking boundary.
 * Notification retries deliberately start from the readback path, so an
 * external provider outage can never create a second OPS appointment.
 */
export class PhaseCBilateralEventConsumerService {
  constructor(
    private readonly dependencies: PhaseCBilateralEventConsumerDependencies
  ) {}

  async runWorker(
    options: {
      limit?: number;
      leaseSeconds?: number;
    } = {}
  ): Promise<PhaseCBilateralEventConsumerResult> {
    const limit = options.limit ?? 5;
    const leaseSeconds = options.leaseSeconds ?? 120;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new Error("Phase C bilateral-event limit must be between 1 and 50");
    }
    if (
      !Number.isInteger(leaseSeconds) ||
      leaseSeconds < 30 ||
      leaseSeconds > 600
    ) {
      throw new Error(
        "Phase C bilateral-event lease must be between 30 and 600 seconds"
      );
    }

    const workerId = this.dependencies.workerId();
    const claimed = await this.dependencies.claim({
      workerId,
      limit,
      leaseSeconds,
    });
    const result: PhaseCBilateralEventConsumerResult = {
      claimed: claimed.length,
      booked: 0,
      reviewed: 0,
      cancelled: 0,
      notified: 0,
      pushed: 0,
      retrying: 0,
      failed: 0,
      errors: [],
    };

    for (const handoff of claimed) {
      if (handoff.status === "cancelled") {
        result.cancelled += 1;
        await this.dependencies.acknowledge({
          handoffId: handoff.id,
          workerId,
        });
        continue;
      }

      let phase: "consumption" | "notification" = "consumption";
      try {
        const consumed =
          handoff.status === "ready"
            ? await this.dependencies.consume({
                handoffId: handoff.id,
                workerId,
              })
            : null;

        const canonicalEventId =
          consumed?.canonicalEventId ?? handoff.canonicalEventId ?? null;
        const outcome = await this.dependencies.readback({
          handoffId: handoff.id,
          canonicalEventId,
        });

        if (outcome.status === "cancelled") {
          result.cancelled += 1;
          await this.dependencies.acknowledge({
            handoffId: handoff.id,
            workerId,
          });
          continue;
        }
        if (outcome.status === "consumed") result.booked += 1;
        if (outcome.status === "review") result.reviewed += 1;

        phase = "notification";
        const delivery = await this.dependencies.dispatchNotification(outcome);
        result.notified += delivery.notified;
        result.pushed += delivery.pushed;
        await this.dependencies.acknowledge({
          handoffId: handoff.id,
          workerId,
        });
      } catch (error) {
        const message = errorMessage(error);
        result.errors.push({ handoffId: handoff.id, error: message });
        const disposition = await this.dependencies.fail({
          handoffId: handoff.id,
          workerId,
          errorCode:
            phase === "notification"
              ? "notification_failed"
              : "consumption_failed",
          errorMessage: message,
        });
        if (disposition === "failed") result.failed += 1;
        else result.retrying += 1;
      }
    }

    return result;
  }
}
