import { randomBytes } from "node:crypto";

import { z } from "zod";

export const externalRequestIdSchema = z
  .string()
  .regex(/^req_[A-Za-z0-9_-]{22,64}$/);

export function createExternalRequestId(): string {
  return `req_${randomBytes(18).toString("base64url")}`;
}

export function resolveExternalRequestId(headers: Headers): string {
  const supplied = headers.get("x-request-id");
  const parsed = externalRequestIdSchema.safeParse(supplied);
  return parsed.success ? parsed.data : createExternalRequestId();
}
