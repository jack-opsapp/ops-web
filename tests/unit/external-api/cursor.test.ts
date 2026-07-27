import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ExternalApiCursorError,
  LEAD_FEED_CURSOR_TTL_MS,
  openLeadFeedCursor,
  openLeadSyncCheckpoint,
  parseExternalApiCursorKeyRing,
  sealLeadFeedCursor,
  sealLeadSyncCheckpoint,
} from "@/lib/external-api/analytics/cursor";

const keyRing = parseExternalApiCursorKeyRing(
  JSON.stringify({
    activeKid: "7",
    keys: { "7": randomBytes(32).toString("base64url") },
  })
);
const now = new Date("2026-07-27T12:00:00.000Z");
const actor = {
  apiVersion: "v1" as const,
  projectionVersion: 1 as const,
  principalId: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  authorizationEpoch: 4,
  scopes: ["analytics.leads.read" as const],
};

describe("external lead feed cursors", () => {
  it("round-trips an encrypted page cursor bound to the stable snapshot", () => {
    const claims = {
      purpose: "lead_page" as const,
      ...actor,
      mode: "full" as const,
      highWater: "912",
      checkpointSequence: null,
      afterPublicLeadId: "33333333-3333-4333-8333-333333333333",
      afterSequence: null,
      filters: { stage: ["new_lead" as const] },
      filtered: true,
      sort: "public_lead_id" as const,
      dataThrough: "2026-07-27T11:59:00.000Z",
      expiresAt: now.getTime() + LEAD_FEED_CURSOR_TTL_MS,
    };
    const token = sealLeadFeedCursor(claims, keyRing);

    expect(token).toMatch(/^cur_7_[A-Za-z0-9_-]+$/);
    expect(openLeadFeedCursor(token, keyRing, now)).toEqual(claims);
    expect(Buffer.from(token, "utf8").toString()).not.toContain(
      actor.companyId
    );
    expect(token).not.toContain("912");
  });

  it("rejects tampering, expiry, and unavailable key versions", () => {
    const token = sealLeadFeedCursor(
      {
        purpose: "lead_page",
        ...actor,
        mode: "incremental",
        highWater: "99",
        checkpointSequence: "80",
        afterPublicLeadId: null,
        afterSequence: "90",
        filters: null,
        filtered: false,
        sort: "change_sequence",
        dataThrough: "2026-07-27T11:59:00.000Z",
        expiresAt: now.getTime() + 1,
      },
      keyRing
    );
    expect(() =>
      openLeadFeedCursor(`${token.slice(0, -1)}A`, keyRing, now)
    ).toThrow(ExternalApiCursorError);
    expect(() =>
      openLeadFeedCursor(token, keyRing, new Date(now.getTime() + 2))
    ).toThrow(ExternalApiCursorError);
    expect(() =>
      openLeadFeedCursor(token.replace("cur_7_", "cur_8_"), keyRing, now)
    ).toThrow(ExternalApiCursorError);
  });

  it("round-trips opaque checkpoints without a readable sequence or identity", () => {
    const token = sealLeadSyncCheckpoint(
      {
        purpose: "lead_checkpoint",
        ...actor,
        sequence: "123456",
        dataThrough: "2026-07-27T11:59:00.000Z",
        issuedAt: now.getTime(),
      },
      keyRing
    );
    expect(token).toMatch(/^sync_7_[A-Za-z0-9_-]+$/);
    expect(openLeadSyncCheckpoint(token, keyRing)).toMatchObject({
      sequence: "123456",
      companyId: actor.companyId,
    });
    expect(token).not.toContain("123456");
    expect(token).not.toContain(actor.principalId);
  });

  it("requires an explicit exact 32-byte key ring", () => {
    expect(() => parseExternalApiCursorKeyRing(undefined)).toThrow(
      "EXTERNAL_API_CURSOR_ENCRYPTION_KEYS is required"
    );
    expect(() =>
      parseExternalApiCursorKeyRing(
        JSON.stringify({
          activeKid: "1",
          keys: { "1": randomBytes(31).toString("base64url") },
        })
      )
    ).toThrow("must be a unique 32-byte key");
  });
});
