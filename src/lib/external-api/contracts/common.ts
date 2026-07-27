import { z } from "zod";

export const EXTERNAL_API_VERSION = "v1" as const;
export const MAX_JSON_BODY_BYTES = 256 * 1024;
export const MAX_FILES_PER_BATCH = 10;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_UPLOAD_BATCH_BYTES = 50 * 1024 * 1024;
export const MAX_ANSWER_COUNT = 100;
export const DEFAULT_LEAD_FEED_PAGE_SIZE = 100;
export const MAX_LEAD_FEED_PAGE_SIZE = 250;

const opaqueId = (prefix: string, maximumLength = 128) =>
  z
    .string()
    .regex(
      new RegExp(`^${prefix}_[A-Za-z0-9_-]{22,${maximumLength}}$`),
      `Expected an opaque ${prefix} identifier`
    );

export const opaqueSourceIdSchema = opaqueId("src");
export const opaqueFormIdSchema = opaqueId("frm");
export const opaqueUploadIdSchema = opaqueId("upl");
export const opaqueSubmissionIdSchema = opaqueId("sub");
export const opaqueLeadIdSchema = opaqueId("lead");
export const opaqueCampaignHandleSchema = opaqueId("cmp");
export const opaqueAttributionHandleSchema = opaqueId("attr");
export const opaquePathHandleSchema = opaqueId("path");
export const opaqueCursorSchema = opaqueId("cur", 4096);
export const opaqueSyncCheckpointSchema = opaqueId("sync", 2048);
export const opaqueEmailCorrelationMarkerSchema = opaqueId("emc");

export const timestampSchema = z.string().datetime({ offset: true });
export const minuteTimestampSchema = timestampSchema.refine((value) => {
  const parsed = new Date(value);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.getUTCSeconds() === 0 &&
    parsed.getUTCMilliseconds() === 0
  );
}, "Timestamp must be rounded to minute precision");

export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Expected a real calendar date");

export const safeKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z][A-Za-z0-9_.:-]*$/);

export const safeLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
    message: "Control characters are not permitted",
  });

export const hostnameSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
  );

export const isoCountryCodeSchema = z.string().regex(/^[A-Z]{2}$/);

export const httpUrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  }, "Only HTTP(S) URLs are accepted");

export const httpsUrlSchema = httpUrlSchema.refine(
  (value) => new URL(value).protocol === "https:",
  "HTTPS is required"
);

export const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._~:+/-]{7,127}$/);

export const idempotencyNamespaceSchema = z.enum([
  "upload_batch",
  "submission",
]);

export const idempotencyIdentitySchema = z
  .object({
    namespace: idempotencyNamespaceSchema,
    key: idempotencyKeySchema,
  })
  .strict();

export const externalApiScopeSchema = z.enum([
  "intake.write",
  "analytics.leads.read",
  "analytics.financial.read",
]);

export const credentialClassSchema = z.enum(["intake", "analytics"]);

export const intakeGrantSchema = z
  .object({
    credentialClass: z.literal("intake"),
    scopes: z.tuple([z.literal("intake.write")]),
    allowedSourceIds: z.array(opaqueSourceIdSchema).min(1).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.allowedSourceIds).size !== value.allowedSourceIds.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allowedSourceIds"],
        message: "Source IDs must be unique",
      });
    }
  });

export const analyticsGrantSchema = z
  .object({
    credentialClass: z.literal("analytics"),
    scopes: z
      .array(z.enum(["analytics.leads.read", "analytics.financial.read"]))
      .min(1)
      .max(2),
  })
  .strict()
  .superRefine((value, context) => {
    const scopes = new Set(value.scopes);
    if (!scopes.has("analytics.leads.read")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scopes"],
        message: "Financial access requires lead-read access",
      });
    }
    if (scopes.size !== value.scopes.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scopes"],
        message: "Scopes must be unique",
      });
    }
  });

export const credentialGrantSchema = z.union([
  intakeGrantSchema,
  analyticsGrantSchema,
]);

export type ExternalApiScope = z.infer<typeof externalApiScopeSchema>;
export type CredentialGrant = z.infer<typeof credentialGrantSchema>;
export type IdempotencyIdentity = z.infer<typeof idempotencyIdentitySchema>;
