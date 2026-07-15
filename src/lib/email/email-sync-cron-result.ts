export interface EmailSyncCronResult {
  connectionId: string;
  email: string;
  provider: string;
  activitiesCreated: number;
  newLeads: number;
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
    ...(result.errors.length > 0 ? { errors: result.errors } : {}),
  };
}
