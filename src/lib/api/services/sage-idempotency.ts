import "server-only";

import { createHmac } from "node:crypto";

export const SAGE_IDEMPOTENT_RESOURCES = [
  "contacts",
  "contact_payments",
  "purchase_invoices",
  "sales_estimates",
  "sales_invoices",
  "sales_quotes",
] as const;

export type SageIdempotentResource = (typeof SAGE_IDEMPOTENT_RESOURCES)[number];

export interface SageIdempotencyKey {
  id: string;
  resource: SageIdempotentResource;
}

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function accountingKey(): Buffer {
  const encoded = process.env.QB_TOKEN_ENC_KEY?.trim();
  if (!encoded) {
    throw new Error(
      "QB_TOKEN_ENC_KEY is not set — refusing to derive Sage idempotency ids."
    );
  }

  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new Error("QB_TOKEN_ENC_KEY must decode to exactly 32 bytes.");
  }
  return key;
}

export function sageIdempotencyId(
  queueId: string,
  resource: SageIdempotentResource
): string {
  if (!UUID_V4.test(queueId)) {
    throw new Error("A valid accounting queue id is required for Sage writes.");
  }
  if (!(SAGE_IDEMPOTENT_RESOURCES as readonly string[]).includes(resource)) {
    throw new Error(`Unsupported Sage idempotency resource: ${resource}`);
  }

  return createHmac("sha256", accountingKey())
    .update(`sage:${resource}:${queueId}`, "utf8")
    .digest("hex")
    .slice(0, 32);
}

export function sageIdempotencyKey(
  queueId: string,
  resource: SageIdempotentResource
): SageIdempotencyKey {
  return { id: sageIdempotencyId(queueId, resource), resource };
}
