import "server-only";

import { getSignedUrl } from "@aws-sdk/cloudfront-signer";

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
