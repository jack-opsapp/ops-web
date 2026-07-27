// @vitest-environment node

import { createHash } from "node:crypto";

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const queue = vi.hoisted(() => ({
  receive: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/external-api/uploads/queue-consumer", () => ({
  receiveExternalIntakeQueueMessages: queue.receive,
  deleteExternalIntakeQueueMessage: queue.remove,
}));

import { runExternalIntakeMaintenance } from "@/lib/external-api/uploads/attachment-runtime";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";
const BATCH_ID = "33333333-3333-4333-8333-333333333333";
const INTENT_ID = "44444444-4444-4444-8444-444444444444";
const INSPECTION_ID = "55555555-5555-4555-8555-555555555555";
const DELIVERY_ID = "66666666-6666-4666-8666-666666666666";
const ORIGINAL_DELIVERY_ID = "88888888-8888-4888-8888-888888888888";
const LEASE_TOKEN = "77777777-7777-4777-8777-777777777777";
const SOURCE_KEY = `quarantine/${COMPANY_ID}/${SOURCE_ID}/${BATCH_ID}/${INTENT_ID}`;

function checksum(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("external intake attachment runtime adapter", () => {
  beforeEach(() => {
    vi.stubEnv("EXTERNAL_INTAKE_AWS_REGION", "us-west-2");
    vi.stubEnv("EXTERNAL_INTAKE_S3_BUCKET", "private-test-bucket");
    vi.stubEnv("EXTERNAL_INTAKE_WORKER_AWS_ACCESS_KEY_ID", "test-key");
    vi.stubEnv("EXTERNAL_INTAKE_WORKER_AWS_SECRET_ACCESS_KEY", "test-secret");
    vi.stubEnv(
      "EXTERNAL_INTAKE_UPLOAD_QUEUE_URL",
      "https://sqs.us-west-2.amazonaws.com/1/upload"
    );
    vi.stubEnv(
      "EXTERNAL_INTAKE_SCAN_QUEUE_URL",
      "https://sqs.us-west-2.amazonaws.com/1/scan"
    );
    queue.receive.mockReset();
    queue.remove.mockReset();
  });

  it("copies only a clean, sanitized derivative and records exact version evidence", async () => {
    const source = await sharp({
      create: {
        width: 3,
        height: 2,
        channels: 3,
        background: "#406078",
      },
    })
      .withMetadata({
        exif: { IFD0: { Artist: "private source metadata" } },
      })
      .png()
      .toBuffer();
    const sourceChecksum = checksum(source);
    queue.receive.mockResolvedValue([
      {
        queueUrl: "https://sqs.test/upload",
        messageId: "message-1",
        receiptHandle: "receipt-1",
        events: [
          {
            providerEventId: "message-1:0",
            eventType: "object_created",
            objectKey: SOURCE_KEY,
            objectVersionId: "source-v1",
            providerSequencer: "001",
            observedSizeBytes: source.length,
            guardDutyStatus: null,
            occurredAt: "2026-07-26T20:00:00.000Z",
          },
        ],
      },
    ]);

    const objects = new Map<
      string,
      { bytes: Buffer; versionId: string; checksum: string }
    >([
      [
        SOURCE_KEY,
        {
          bytes: source,
          versionId: "source-v1",
          checksum: sourceChecksum,
        },
      ],
    ]);
    const putInputs: Array<PutObjectCommand["input"]> = [];
    const s3 = {
      send: vi.fn(async (command: unknown) => {
        if (command instanceof HeadObjectCommand) {
          const object = objects.get(command.input.Key!);
          if (!object) {
            throw Object.assign(new Error("missing"), {
              name: "NotFound",
              $metadata: { httpStatusCode: 404 },
            });
          }
          return {
            VersionId: object.versionId,
            ContentLength: object.bytes.length,
            ChecksumSHA256: Buffer.from(object.checksum, "hex").toString(
              "base64"
            ),
          };
        }
        if (command instanceof GetObjectCommand) {
          const object = objects.get(command.input.Key!);
          if (!object) throw new Error("missing");
          return {
            VersionId: object.versionId,
            ContentLength: object.bytes.length,
            ChecksumSHA256: Buffer.from(object.checksum, "hex").toString(
              "base64"
            ),
            Body: {
              transformToByteArray: async () => object.bytes,
            },
          };
        }
        if (command instanceof PutObjectCommand) {
          putInputs.push(command.input);
          const bytes = Buffer.from(command.input.Body as Uint8Array);
          objects.set(command.input.Key!, {
            bytes,
            versionId: "delivery-v1",
            checksum: checksum(bytes),
          });
          return { VersionId: "delivery-v1" };
        }
        throw new Error("unexpected command");
      }),
    } as unknown as S3Client;

    const rpcCalls: Array<{
      name: string;
      args: Record<string, unknown>;
    }> = [];
    const supabase = {
      rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args });
        switch (name) {
          case "record_external_intake_object_event_as_system":
            return { data: { status: "recorded" }, error: null };
          case "maintain_external_intake_files_as_system":
            return {
              data: {
                expired: 0,
                terminalized: 0,
                cleanup_scheduled: 0,
                credentials_retired: 2,
              },
              error: null,
            };
          case "claim_external_intake_inspections_as_system":
            return {
              data: [
                {
                  id: INSPECTION_ID,
                  intent_id: INTENT_ID,
                  company_id: COMPANY_ID,
                  object_key: SOURCE_KEY,
                  object_version_id: "source-v1",
                  filename: "site-photo.png",
                  declared_content_type: "image/png",
                  expected_size_bytes: source.length,
                  expected_checksum_sha256: sourceChecksum,
                  observed_size_bytes: source.length,
                  observed_checksum_sha256: sourceChecksum,
                  guardduty_status: "NO_THREATS_FOUND",
                  first_queued_at: "2026-07-26T20:00:00.000Z",
                  deadline_at: "2026-07-27T20:00:00.000Z",
                  delete_not_before: "2026-07-26T20:02:00.000Z",
                  attempts: 1,
                  generation: 1,
                  lease_token: LEASE_TOKEN,
                },
              ],
              error: null,
            };
          case "stage_external_intake_delivery_as_system":
            return {
              data: {
                status: "staged",
                delivery_id:
                  args.p_delivery_mode === "inline_image"
                    ? DELIVERY_ID
                    : ORIGINAL_DELIVERY_ID,
                state: "staged",
                object_version_id: null,
                size_bytes: null,
                checksum_sha256: null,
              },
              error: null,
            };
          case "record_external_intake_delivery_as_system":
          case "finish_external_intake_inspection_as_system":
            return { data: true, error: null };
          case "claim_external_intake_cleanups_as_system":
          case "claim_external_intake_delivery_cleanups_as_system":
          case "claim_external_intake_project_file_projections_as_system":
          case "claim_external_intake_erasures_as_system":
            return { data: [], error: null };
          default:
            throw new Error(`unexpected rpc ${name}`);
        }
      }),
    };

    const result = await runExternalIntakeMaintenance(
      supabase as never,
      {
        eventLimit: 2,
        inspectionLimit: 2,
        cleanupLimit: 2,
      },
      {
        s3,
        now: () => new Date("2026-07-26T20:01:00.000Z"),
        workerId: () => "test-worker",
      }
    );

    expect(result).toMatchObject({
      eventsRecorded: 1,
      inspectionsClaimed: 1,
      accepted: 1,
      credentialsRetired: 2,
      errors: [],
    });
    expect(queue.remove).toHaveBeenCalledOnce();
    expect(putInputs).toHaveLength(2);
    const derivativeInput = putInputs.find((input) =>
      input.Key?.startsWith("safe-derivative/")
    );
    const originalInput = putInputs.find((input) =>
      input.Key?.startsWith("accepted-original/")
    );
    expect(derivativeInput?.Key).toMatch(
      new RegExp(
        `^safe-derivative/${COMPANY_ID}/${INTENT_ID}/[0-9a-f-]{36}\\.png$`
      )
    );
    expect(originalInput?.Key).toMatch(
      new RegExp(`^accepted-original/${COMPANY_ID}/${INTENT_ID}/[0-9a-f-]{36}$`)
    );
    expect(derivativeInput?.IfNoneMatch).toBe("*");
    expect(derivativeInput?.Tagging).toBe(
      "GuardDutyMalwareScanStatus=NO_THREATS_FOUND&ops-disposition=accepted"
    );
    expect(derivativeInput?.CacheControl).toBe("no-store, max-age=0");
    expect(originalInput?.CacheControl).toBe("no-store, max-age=0");
    expect(derivativeInput?.ContentDisposition).toBe("inline");
    expect(originalInput?.ContentDisposition).toBe(
      'attachment; filename="website-attachment"'
    );
    const derivative = Buffer.from(derivativeInput?.Body as Uint8Array);
    expect((await sharp(derivative).metadata()).exif).toBeUndefined();

    const finish = rpcCalls.find(
      (call) => call.name === "finish_external_intake_inspection_as_system"
    );
    expect(finish?.args).toMatchObject({
      p_outcome: "accepted",
      p_delivery_object_id: DELIVERY_ID,
      p_accepted_object_version_id: "delivery-v1",
      p_delivery_mode: "inline_image",
    });
  });
});
