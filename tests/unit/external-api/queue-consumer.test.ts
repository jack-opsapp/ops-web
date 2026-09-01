import { describe, expect, it } from "vitest";

import { parseExternalIntakeQueueMessage } from "@/lib/external-api/uploads/queue-consumer";

const KEY =
  "quarantine/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444";

describe("external intake queue parser", () => {
  it("normalizes versioned S3 create events without retaining identity or IP detail", () => {
    const result = parseExternalIntakeQueueMessage(
      JSON.stringify({
        Records: [
          {
            eventVersion: "2.4",
            eventSource: "aws:s3",
            eventTime: "2026-07-26T20:00:00.000Z",
            eventName: "ObjectCreated:Put",
            userIdentity: { principalId: "must-not-survive" },
            requestParameters: { sourceIPAddress: "192.0.2.1" },
            s3: {
              bucket: { name: "bucket" },
              object: {
                key: encodeURIComponent(KEY),
                size: 42,
                versionId: "version-1",
                sequencer: "0055AED6DCD90281E5",
              },
            },
          },
        ],
      }),
      "message-1",
      "bucket"
    );

    expect(result).toEqual([
      {
        providerEventId: "message-1:0",
        eventType: "object_created",
        objectKey: KEY,
        objectVersionId: "version-1",
        providerSequencer: "0055AED6DCD90281E5",
        observedSizeBytes: 42,
        guardDutyStatus: null,
        occurredAt: "2026-07-26T20:00:00.000Z",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("192.0.2.1");
    expect(JSON.stringify(result)).not.toContain("must-not-survive");
  });

  it("normalizes exact GuardDuty statuses and ignores threat names", () => {
    const result = parseExternalIntakeQueueMessage(
      JSON.stringify({
        version: "0",
        id: "guardduty-event-1",
        "detail-type": "GuardDuty Malware Protection Object Scan Result",
        source: "aws.guardduty",
        time: "2026-07-26T20:01:00.000Z",
        detail: {
          schemaVersion: "1.0",
          scanStatus: "COMPLETED",
          resourceType: "S3_OBJECT",
          s3ObjectDetails: {
            bucketName: "bucket",
            objectKey: KEY,
            versionId: "version-1",
          },
          scanResultDetails: {
            scanResultStatus: "THREATS_FOUND",
            threats: [{ name: "must-not-survive" }],
          },
        },
      }),
      "message-2",
      "bucket"
    );

    expect(result).toEqual([
      {
        providerEventId: "guardduty-event-1",
        eventType: "guardduty_result",
        objectKey: KEY,
        objectVersionId: "version-1",
        providerSequencer: null,
        observedSizeBytes: null,
        guardDutyStatus: "THREATS_FOUND",
        occurredAt: "2026-07-26T20:01:00.000Z",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("must-not-survive");
  });

  it("ignores GuardDuty validation-object results outside the quarantine namespace", () => {
    const result = parseExternalIntakeQueueMessage(
      JSON.stringify({
        version: "0",
        id: "guardduty-validation-event",
        "detail-type": "GuardDuty Malware Protection Object Scan Result",
        source: "aws.guardduty",
        time: "2026-07-26T20:01:00.000Z",
        detail: {
          schemaVersion: "1.0",
          scanStatus: "COMPLETED",
          resourceType: "S3_OBJECT",
          s3ObjectDetails: {
            bucketName: "bucket",
            objectKey: "malware-protection-resource-validation-object",
            versionId: "validation-version-1",
          },
          scanResultDetails: {
            scanResultStatus: "NO_THREATS_FOUND",
          },
        },
      }),
      "message-validation",
      "bucket"
    );

    expect(result).toEqual([]);
  });

  it("fails closed on wrong buckets, unversioned objects, test events, and malformed payloads", () => {
    const cases = [
      "{}",
      JSON.stringify({ Service: "Amazon S3", Event: "s3:TestEvent" }),
      JSON.stringify({
        Records: [
          {
            eventVersion: "2.4",
            eventSource: "aws:s3",
            eventTime: "2026-07-26T20:00:00.000Z",
            eventName: "ObjectCreated:Put",
            s3: {
              bucket: { name: "wrong" },
              object: { key: KEY, size: 1, versionId: "v1" },
            },
          },
        ],
      }),
      JSON.stringify({
        Records: [
          {
            eventVersion: "2.4",
            eventSource: "aws:s3",
            eventTime: "2026-07-26T20:00:00.000Z",
            eventName: "ObjectCreated:Put",
            s3: {
              bucket: { name: "bucket" },
              object: { key: KEY, size: 1 },
            },
          },
        ],
      }),
    ];

    for (const body of cases) {
      expect(() =>
        parseExternalIntakeQueueMessage(body, "message", "bucket")
      ).toThrow("external_intake_queue_event_invalid");
    }
  });
});
