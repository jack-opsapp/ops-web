import { randomUUID } from "node:crypto";

import { z } from "zod";

export const externalRequestIdSchema = z
  .string()
  .regex(
    /^req_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );

export function createExternalRequestId(): string {
  return `req_${randomUUID()}`;
}

export function externalRequestIdToAuditUuid(requestId: string): string {
  return externalRequestIdSchema.parse(requestId).slice(4);
}

export type ExternalRequestIdentity = Readonly<{
  publicRequestId: string;
  auditRequestId: string;
}>;

export function createExternalRequestIdentity(): ExternalRequestIdentity {
  const publicRequestId = createExternalRequestId();
  return Object.freeze({
    publicRequestId,
    auditRequestId: externalRequestIdToAuditUuid(publicRequestId),
  });
}

export function resolveExternalRequestId(_headers: Headers): string {
  // Request IDs are server-owned database identities. A caller-supplied
  // correlation header must never be allowed to select the audit primary key.
  return createExternalRequestId();
}
