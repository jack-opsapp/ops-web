import "server-only";

import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { z } from "zod";

import {
  getExternalIntakeWorkerCredentials,
  readExternalIntakeStorageConfig,
} from "./s3-client";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const OBJECT_KEY_PATTERN =
  /^quarantine\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/i;

const guardDutyStatusSchema = z.enum([
  "NO_THREATS_FOUND",
  "THREATS_FOUND",
  "UNSUPPORTED",
  "ACCESS_DENIED",
  "FAILED",
]);

export interface NormalizedExternalIntakeQueueEvent {
  providerEventId: string;
  eventType: "object_created" | "guardduty_result";
  objectKey: string;
  objectVersionId: string;
  providerSequencer: string | null;
  observedSizeBytes: number | null;
  guardDutyStatus: z.infer<typeof guardDutyStatusSchema> | null;
  occurredAt: string;
}

export interface ReceivedExternalIntakeQueueMessage {
  queueUrl: string;
  messageId: string;
  receiptHandle: string;
  events: NormalizedExternalIntakeQueueEvent[];
}

let externalIntakeSqsClient: SQSClient | null = null;

function invalid(): never {
  throw new Error("external_intake_queue_event_invalid");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, minimum = 1, maximum = 1024): string {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    invalid();
  }
  return value;
}

function occurredAt(value: unknown): string {
  const raw = requiredString(value, 20, 64);
  const milliseconds = Date.parse(raw);
  if (!Number.isFinite(milliseconds)) invalid();
  return new Date(milliseconds).toISOString();
}

function decodedObjectKey(value: unknown): string {
  const raw = requiredString(value, 1, 1024);
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw.replace(/\+/g, " "));
  } catch {
    invalid();
  }
  return decoded;
}

function objectKey(value: unknown): string {
  const decoded = decodedObjectKey(value);
  if (!OBJECT_KEY_PATTERN.test(decoded)) invalid();
  return decoded;
}

function unwrapBody(body: string): unknown {
  if (body.length < 2 || body.length > 256 * 1024) invalid();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    invalid();
  }
  const record = asRecord(parsed);
  if (typeof record.Message === "string") {
    if (record.Message.length > 256 * 1024) invalid();
    try {
      parsed = JSON.parse(record.Message);
    } catch {
      invalid();
    }
  }
  return parsed;
}

function parseS3Events(
  payload: Record<string, unknown>,
  messageId: string,
  expectedBucket: string
): NormalizedExternalIntakeQueueEvent[] | null {
  if (!Array.isArray(payload.Records)) return null;
  if (payload.Records.length < 1 || payload.Records.length > 10) invalid();

  return payload.Records.map((value, index) => {
    const record = asRecord(value);
    const majorVersion = requiredString(record.eventVersion, 3, 16).split(
      "."
    )[0];
    if (
      majorVersion !== "2" ||
      record.eventSource !== "aws:s3" ||
      typeof record.eventName !== "string" ||
      !record.eventName.startsWith("ObjectCreated:")
    ) {
      invalid();
    }
    const s3 = asRecord(record.s3);
    const bucket = asRecord(s3.bucket);
    const object = asRecord(s3.object);
    if (bucket.name !== expectedBucket) invalid();
    const size = object.size;
    if (
      typeof size !== "number" ||
      !Number.isSafeInteger(size) ||
      size < 1 ||
      size > MAX_FILE_BYTES
    ) {
      invalid();
    }
    return {
      providerEventId: `${messageId}:${index}`,
      eventType: "object_created" as const,
      objectKey: objectKey(object.key),
      objectVersionId: requiredString(object.versionId),
      providerSequencer:
        typeof object.sequencer === "string"
          ? requiredString(object.sequencer, 1, 256)
          : null,
      observedSizeBytes: size,
      guardDutyStatus: null,
      occurredAt: occurredAt(record.eventTime),
    };
  });
}

function parseGuardDutyEvent(
  payload: Record<string, unknown>,
  expectedBucket: string
): NormalizedExternalIntakeQueueEvent[] | null {
  if (
    payload.source !== "aws.guardduty" ||
    payload["detail-type"] !== "GuardDuty Malware Protection Object Scan Result"
  ) {
    return null;
  }
  const detail = asRecord(payload.detail);
  const object = asRecord(detail.s3ObjectDetails);
  const scan = asRecord(detail.scanResultDetails);
  if (
    detail.resourceType !== "S3_OBJECT" ||
    object.bucketName !== expectedBucket
  ) {
    invalid();
  }
  const status = guardDutyStatusSchema.safeParse(scan.scanResultStatus);
  if (!status.success) invalid();
  const decodedKey = decodedObjectKey(object.objectKey);
  if (!OBJECT_KEY_PATTERN.test(decodedKey)) {
    return [];
  }

  return [
    {
      providerEventId: requiredString(payload.id, 1, 512),
      eventType: "guardduty_result",
      objectKey: decodedKey,
      objectVersionId: requiredString(object.versionId),
      providerSequencer: null,
      observedSizeBytes: null,
      guardDutyStatus: status.data,
      occurredAt: occurredAt(payload.time),
    },
  ];
}

export function parseExternalIntakeQueueMessage(
  body: string,
  messageId: string,
  expectedBucket: string
): NormalizedExternalIntakeQueueEvent[] {
  const safeMessageId = requiredString(messageId, 1, 256);
  const safeBucket = requiredString(expectedBucket, 3, 63);
  const payload = asRecord(unwrapBody(body));
  const events =
    parseS3Events(payload, safeMessageId, safeBucket) ??
    parseGuardDutyEvent(payload, safeBucket);
  if (!events) invalid();
  return events;
}

function getSqsClient(): SQSClient {
  if (externalIntakeSqsClient) return externalIntakeSqsClient;
  const config = readExternalIntakeStorageConfig();
  externalIntakeSqsClient = new SQSClient({
    region: config.region,
    credentials: getExternalIntakeWorkerCredentials(),
  });
  return externalIntakeSqsClient;
}

function queueUrls(): string[] {
  const upload = process.env.EXTERNAL_INTAKE_UPLOAD_QUEUE_URL?.trim();
  const scan = process.env.EXTERNAL_INTAKE_SCAN_QUEUE_URL?.trim();
  if (
    !upload ||
    !scan ||
    !upload.startsWith("https://") ||
    !scan.startsWith("https://")
  ) {
    throw new Error("external_intake_queue_unavailable");
  }
  return [upload, scan];
}

export async function receiveExternalIntakeQueueMessages(
  limit: number
): Promise<ReceivedExternalIntakeQueueMessage[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
    throw new Error("external_intake_queue_limit_invalid");
  }
  const config = readExternalIntakeStorageConfig();
  const urls = queueUrls();
  const perQueue = Math.min(10, Math.max(1, Math.ceil(limit / urls.length)));
  const client = getSqsClient();
  const batches = await Promise.all(
    urls.map(async (queueUrl) => {
      const response = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: perQueue,
          VisibilityTimeout: 360,
          WaitTimeSeconds: 0,
        })
      );
      return (response.Messages ?? []).map((message) => {
        if (!message.MessageId || !message.ReceiptHandle || !message.Body) {
          invalid();
        }
        return {
          queueUrl,
          messageId: message.MessageId,
          receiptHandle: message.ReceiptHandle,
          events: parseExternalIntakeQueueMessage(
            message.Body,
            message.MessageId,
            config.bucket
          ),
        };
      });
    })
  );
  return batches.flat().slice(0, limit);
}

export async function deleteExternalIntakeQueueMessage(
  message: Pick<
    ReceivedExternalIntakeQueueMessage,
    "queueUrl" | "receiptHandle"
  >
): Promise<void> {
  await getSqsClient().send(
    new DeleteMessageCommand({
      QueueUrl: message.queueUrl,
      ReceiptHandle: message.receiptHandle,
    })
  );
}
