import { describe, expect, it } from "vitest";

import { opaqueEmailCorrelationMarkerSchema } from "@/lib/external-api/contracts/common";
import {
  InvalidEmailCorrelationMarkerError,
  openEmailCorrelationMarker,
  sealEmailCorrelationMarker,
} from "@/lib/external-api/intake/email-correlation";

const COMPANY_ID = "c4f852a5-3530-4b2f-b5fa-0a747d32e44a";
const MAILBOX_ID = "51fb3a56-08c5-4512-b912-a549833687bd";
const SOURCE_ID = "d960d8d5-1b5f-41c4-9c64-521ae14ae77e";
const SUBMISSION_ID = "fe1df0ba-9d0d-4ee7-ad9a-f86fa37d4174";
const LEAD_ID = "8951b471-c0de-4ce4-8d95-daaba9b53da5";
const NOW = new Date("2026-07-26T20:00:00.000Z");
const EXPIRES_AT = new Date("2026-08-25T20:00:00.000Z");

const oldRing = {
  activeKid: 1,
  keys: new Map([[1, Buffer.alloc(32, 1)]]),
};
const rotatedRing = {
  activeKid: 2,
  keys: new Map([
    [1, Buffer.alloc(32, 1)],
    [2, Buffer.alloc(32, 2)],
  ]),
};

const binding = {
  companyId: COMPANY_ID,
  mailboxId: MAILBOX_ID,
  sourceId: SOURCE_ID,
};

describe("external intake email correlation marker", () => {
  it("seals identifiers into a bounded opaque authenticated marker", () => {
    const marker = sealEmailCorrelationMarker(
      {
        ...binding,
        submissionId: SUBMISSION_ID,
        leadId: LEAD_ID,
        expiresAt: EXPIRES_AT,
      },
      oldRing,
      () => Buffer.alloc(12, 9)
    );

    expect(opaqueEmailCorrelationMarkerSchema.parse(marker)).toBe(marker);
    expect(marker).not.toContain(COMPANY_ID);
    expect(marker).not.toContain(SUBMISSION_ID);
    const envelope = Buffer.from(marker.slice(4), "base64url");
    const readableEnvelope = envelope.toString("utf8");
    expect(readableEnvelope).not.toContain(COMPANY_ID);
    expect(readableEnvelope).not.toContain(SUBMISSION_ID);
    expect(
      envelope.includes(Buffer.from(SUBMISSION_ID.replaceAll("-", ""), "hex"))
    ).toBe(false);
    expect(
      envelope.includes(Buffer.from(LEAD_ID.replaceAll("-", ""), "hex"))
    ).toBe(false);

    expect(
      openEmailCorrelationMarker(marker, binding, rotatedRing, NOW)
    ).toEqual({
      submissionId: SUBMISSION_ID,
      leadId: LEAD_ID,
      expiresAt: EXPIRES_AT.toISOString(),
      keyVersion: 1,
    });
  });

  it("uses the active key for new markers while retaining old-key decryption", () => {
    const oldMarker = sealEmailCorrelationMarker(
      {
        ...binding,
        submissionId: SUBMISSION_ID,
        leadId: LEAD_ID,
        expiresAt: EXPIRES_AT,
      },
      oldRing
    );
    const newMarker = sealEmailCorrelationMarker(
      {
        ...binding,
        submissionId: SUBMISSION_ID,
        leadId: LEAD_ID,
        expiresAt: EXPIRES_AT,
      },
      rotatedRing
    );

    expect(
      openEmailCorrelationMarker(oldMarker, binding, rotatedRing, NOW)
        .keyVersion
    ).toBe(1);
    expect(
      openEmailCorrelationMarker(newMarker, binding, rotatedRing, NOW)
        .keyVersion
    ).toBe(2);
  });

  it.each([
    ["wrong company", { ...binding, companyId: LEAD_ID }],
    ["wrong mailbox", { ...binding, mailboxId: LEAD_ID }],
    ["wrong source", { ...binding, sourceId: LEAD_ID }],
  ])("rejects %s binding", (_label, wrongBinding) => {
    const marker = sealEmailCorrelationMarker(
      {
        ...binding,
        submissionId: SUBMISSION_ID,
        leadId: LEAD_ID,
        expiresAt: EXPIRES_AT,
      },
      oldRing
    );
    expect(() =>
      openEmailCorrelationMarker(marker, wrongBinding, oldRing, NOW)
    ).toThrow(InvalidEmailCorrelationMarkerError);
  });

  it("rejects tampering, expiry, and plain identifiers", () => {
    const marker = sealEmailCorrelationMarker(
      {
        ...binding,
        submissionId: SUBMISSION_ID,
        leadId: LEAD_ID,
        expiresAt: EXPIRES_AT,
      },
      oldRing
    );
    const replacement = marker.endsWith("A") ? "B" : "A";
    const tampered = `${marker.slice(0, -1)}${replacement}`;

    expect(() =>
      openEmailCorrelationMarker(tampered, binding, oldRing, NOW)
    ).toThrow(InvalidEmailCorrelationMarkerError);
    expect(() =>
      openEmailCorrelationMarker(marker, binding, oldRing, EXPIRES_AT)
    ).toThrow(InvalidEmailCorrelationMarkerError);
    expect(() =>
      openEmailCorrelationMarker(SUBMISSION_ID, binding, oldRing, NOW)
    ).toThrow(InvalidEmailCorrelationMarkerError);
    expect(() =>
      openEmailCorrelationMarker(
        "lead_abcdefghijklmnopqrstuv",
        binding,
        oldRing,
        NOW
      )
    ).toThrow(InvalidEmailCorrelationMarkerError);
  });
});
