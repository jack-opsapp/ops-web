import "server-only";

import { createHash, createHmac, randomUUID } from "node:crypto";

import { getSignedUrl } from "@aws-sdk/cloudfront-signer";

import { getExternalIntakeWorkerCredentials } from "./s3-client";

const ATTACHMENT_DELIVERY_MAX_SECONDS = 300;
const DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const OBJECT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~!$&'()*+,;=:@/-]*$/;

type AttachmentDeliveryMode = "inline-image" | "attachment";

interface AttachmentDeliveryInput {
  objectKey: string;
  mode: AttachmentDeliveryMode;
  expiresInSeconds: number;
}

interface AttachmentDeliveryDependencies {
  now?: () => Date;
}

export interface AttachmentDeliveryCapability {
  url: string;
  mode: AttachmentDeliveryMode;
  expiresAt: string;
}

interface InvalidationDependencies {
  now?: () => Date;
  callerReference?: () => string;
  fetch?: typeof fetch;
}

function failInvalid(): never {
  throw new Error("invalid_attachment_delivery");
}

function readSigningConfiguration() {
  const domain = process.env.EXTERNAL_INTAKE_CLOUDFRONT_DOMAIN?.trim();
  const keyPairId = process.env.EXTERNAL_INTAKE_CLOUDFRONT_KEY_PAIR_ID?.trim();
  const privateKey =
    process.env.EXTERNAL_INTAKE_CLOUDFRONT_PRIVATE_KEY?.replace(
      /\\n/g,
      "\n"
    ).trim();

  if (
    !domain ||
    !DOMAIN_PATTERN.test(domain) ||
    !keyPairId ||
    !privateKey ||
    !privateKey.includes("BEGIN PRIVATE KEY") ||
    !privateKey.includes("END PRIVATE KEY")
  ) {
    throw new Error("attachment_delivery_unavailable");
  }

  return { domain, keyPairId, privateKey };
}

function assertDeliveryInput(input: AttachmentDeliveryInput): void {
  const pathSegments = input.objectKey.split("/");
  if (
    (input.mode !== "inline-image" && input.mode !== "attachment") ||
    !Number.isSafeInteger(input.expiresInSeconds) ||
    input.expiresInSeconds <= 0 ||
    input.expiresInSeconds > ATTACHMENT_DELIVERY_MAX_SECONDS ||
    !OBJECT_KEY_PATTERN.test(input.objectKey) ||
    pathSegments.some(
      (segment) => segment.length === 0 || segment === "." || segment === ".."
    ) ||
    input.objectKey.includes("?") ||
    input.objectKey.includes("#") ||
    input.objectKey.startsWith("/") ||
    input.objectKey.endsWith("/")
  ) {
    failInvalid();
  }

  const isSafeDerivative = input.objectKey.startsWith("safe-derivative/");
  const isAcceptedOriginal = input.objectKey.startsWith("accepted-original/");
  if (
    (input.mode === "inline-image" && !isSafeDerivative) ||
    (input.mode === "attachment" && !isAcceptedOriginal)
  ) {
    failInvalid();
  }
}

export function createExternalAttachmentDeliveryUrl(
  input: AttachmentDeliveryInput,
  dependencies: AttachmentDeliveryDependencies = {}
): AttachmentDeliveryCapability {
  assertDeliveryInput(input);
  const now = dependencies.now?.() ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    failInvalid();
  }

  const expiresAt = new Date(
    now.getTime() + input.expiresInSeconds * 1_000
  ).toISOString();
  const config = readSigningConfiguration();
  const unsignedUrl = `https://${config.domain}/${input.objectKey}`;

  return {
    url: getSignedUrl({
      url: unsignedUrl,
      keyPairId: config.keyPairId,
      privateKey: config.privateKey,
      dateLessThan: expiresAt,
    }),
    mode: input.mode,
    expiresAt,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function invalidationConfiguration() {
  const distributionId =
    process.env.EXTERNAL_INTAKE_CLOUDFRONT_DISTRIBUTION_ID?.trim();
  const { accessKeyId, secretAccessKey } = getExternalIntakeWorkerCredentials();
  if (
    !distributionId ||
    !/^[A-Z0-9]{8,32}$/.test(distributionId) ||
    !accessKeyId ||
    !secretAccessKey
  ) {
    throw new Error("attachment_invalidation_unavailable");
  }
  return { distributionId, accessKeyId, secretAccessKey };
}

function assertInvalidationPaths(paths: string[]): string[] {
  const unique = [...new Set(paths)];
  if (
    unique.length < 1 ||
    unique.length > 100 ||
    unique.some((path) => {
      const objectKey = path.startsWith("/") ? path.slice(1) : "";
      return (
        !path.startsWith("/") ||
        path.includes("*") ||
        path.includes("?") ||
        path.includes("#") ||
        !OBJECT_KEY_PATTERN.test(objectKey) ||
        objectKey.split("/").some((part) => part === "." || part === "..") ||
        (!objectKey.startsWith("safe-derivative/") &&
          !objectKey.startsWith("accepted-original/"))
      );
    })
  ) {
    throw new Error("invalid_attachment_invalidation");
  }
  return unique.sort();
}

/**
 * Submit one exact-path CloudFront invalidation without adding another AWS
 * package to the runtime. CloudFront uses the ordinary SigV4 REST boundary;
 * the implementation signs only this fixed operation and allowlisted paths.
 */
export async function invalidateExternalAttachmentDeliveryPaths(
  inputPaths: string[],
  dependencies: InvalidationDependencies = {}
): Promise<string> {
  const paths = assertInvalidationPaths(inputPaths);
  const config = invalidationConfiguration();
  const now = dependencies.now?.() ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new Error("invalid_attachment_invalidation");
  }
  const amzDate = now
    .toISOString()
    .replace(/[:-]|\.\d{3}/g, "")
    .replace("Z", "Z");
  const date = amzDate.slice(0, 8);
  const host = "cloudfront.amazonaws.com";
  const canonicalUri = `/2020-05-31/distribution/${config.distributionId}/invalidation`;
  const callerReference =
    dependencies.callerReference?.() ??
    `external-intake-erasure-${randomUUID()}`;
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<InvalidationBatch xmlns="http://cloudfront.amazonaws.com/doc/2020-05-31/">' +
    `<Paths><Quantity>${paths.length}</Quantity><Items>` +
    paths.map((path) => `<Path>${xml(path)}</Path>`).join("") +
    "</Items></Paths>" +
    `<CallerReference>${xml(callerReference)}</CallerReference>` +
    "</InvalidationBatch>";
  const bodyHash = sha256(body);
  const signedHeaderEntries = [
    ["content-type", "application/xml"],
    ["host", host],
    ["x-amz-content-sha256", bodyHash],
    ["x-amz-date", amzDate],
  ] as const;
  const canonicalHeaders =
    signedHeaderEntries
      .map(([key, value]) => `${key}:${value.trim()}`)
      .join("\n") + "\n";
  const signedHeaders = signedHeaderEntries.map(([key]) => key).join(";");
  const canonicalRequest = [
    "POST",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    bodyHash,
  ].join("\n");
  const scope = `${date}/us-east-1/cloudfront/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256(canonicalRequest),
  ].join("\n");
  const dateKey = hmac(`AWS4${config.secretAccessKey}`, date);
  const regionKey = hmac(dateKey, "us-east-1");
  const serviceKey = hmac(regionKey, "cloudfront");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");
  const headers = new Headers({
    "content-type": "application/xml",
    "x-amz-content-sha256": bodyHash,
    "x-amz-date": amzDate,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  });
  const response = await (dependencies.fetch ?? fetch)(
    `https://${host}${canonicalUri}`,
    {
      method: "POST",
      headers,
      body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    }
  );
  const responseBody = await response.text();
  if (!response.ok) {
    throw new Error("attachment_invalidation_failed");
  }
  const invalidationId = responseBody.match(
    /<Id>([A-Z0-9_-]{1,128})<\/Id>/
  )?.[1];
  if (!invalidationId) {
    throw new Error("attachment_invalidation_invalid_response");
  }
  return invalidationId;
}

export async function verifyExternalAttachmentDeliveryDenied(
  objectKeys: string[],
  request: typeof fetch = fetch
): Promise<boolean> {
  const unique = [...new Set(objectKeys)].sort();
  if (unique.length < 1 || unique.length > 100) return false;
  const results = await Promise.all(
    unique.map(async (objectKey) => {
      const inline = objectKey.startsWith("safe-derivative/");
      const capability = createExternalAttachmentDeliveryUrl({
        objectKey,
        mode: inline ? "inline-image" : "attachment",
        expiresInSeconds: 60,
      });
      try {
        const response = await request(capability.url, {
          method: "HEAD",
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        });
        return response.status === 403 || response.status === 404;
      } catch {
        return false;
      }
    })
  );
  return results.every(Boolean);
}
