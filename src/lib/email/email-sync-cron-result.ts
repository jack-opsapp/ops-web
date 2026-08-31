export interface EmailSyncCronResult {
  connectionId: string;
  email: string;
  provider: string;
  activitiesCreated: number;
  newLeads: number;
  continuationPending?: boolean;
  /** The invocation deadline stopped this connection's cycle early. Healthy
   * backpressure, not a failure: durable progress was checkpointed and the
   * remainder resumes on the next tick. */
  deadlineDeferred?: boolean;
  errors?: string[];
}

interface EmailSyncCronConnection {
  id: string;
  email: string;
  provider: string;
}

interface EmailSyncEngineResult {
  activitiesCreated: number;
  newLeads: number;
  continuationPending?: boolean;
  deadlineDeferred?: boolean;
  errors: string[];
}

/** Keep fail-closed engine errors visible to the cron caller and run ledger. */
export function buildEmailSyncCronResult(
  connection: EmailSyncCronConnection,
  result: EmailSyncEngineResult
): EmailSyncCronResult {
  return {
    connectionId: connection.id,
    email: connection.email,
    provider: connection.provider,
    activitiesCreated: result.activitiesCreated,
    newLeads: result.newLeads,
    ...(result.continuationPending ? { continuationPending: true } : {}),
    ...(result.deadlineDeferred ? { deadlineDeferred: true } : {}),
    ...(result.errors.length > 0 ? { errors: result.errors } : {}),
  };
}
