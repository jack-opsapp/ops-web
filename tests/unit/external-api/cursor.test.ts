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

/** Offset of the base64url body after the `<prefix>_<kid>_` header. */
function sealedBodyStart(token: string): number {
  const header = /^(?:cur|sync)_\d+_/.exec(token);
  if (!header) throw new Error(`unexpected token shape: ${token}`);
  return header[0].length;
}

/**
 * Asserts a claim is unreadable from a sealed token: its JSON serialisation
 * appears neither in the token text nor in the decoded nonce ‖ ciphertext ‖
 * tag bytes. Matching the full `"key":"value"` fragment (never a bare short
 * value) keeps this deterministic: a bare value like `912` shows up in random
 * base64url text by coincidence roughly once every few hundred seals.
 */
function expectClaimSealed(
  token: string,
  claims: Record<string, unknown>,
  key: string
): void {
  const fragment = JSON.stringify({ [key]: claims[key] }).slice(1, -1);
  const packed = Buffer.from(token.slice(sealedBodyStart(token)), "base64url");
  expect(fragment.length).toBeGreaterThanOrEqual(12);
  expect(token).not.toContain(fragment);
  expect(packed.includes(Buffer.from(fragment, "utf8"))).toBe(false);
  expect(packed.toString("latin1")).not.toContain(fragment);
}

/**
 * Flips one character in the middle of a sealed token's base64url body.
 * The body is nonce ‖ ciphertext ‖ auth tag, so a mid-body change always
 * alters the sealed bytes and must fail authentication. The replacement is
 * chosen relative to the character being replaced, so the mutation can
 * never be a no-op regardless of what the random nonce produced.
 */
function corruptSealedBody(token: string): string {
  const bodyStart = sealedBodyStart(token);
  const index = bodyStart + Math.floor((token.length - bodyStart) / 2);
  const replacement = token[index] === "A" ? "B" : "A";
  return `${token.slice(0, index)}${replacement}${token.slice(index + 1)}`;
}

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
    expectClaimSealed(token, claims, "companyId");
    expectClaimSealed(token, claims, "highWater");
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
      openLeadFeedCursor(corruptSealedBody(token), keyRing, now)
    ).toThrow(ExternalApiCursorError);
    expect(() =>
      openLeadFeedCursor(token, keyRing, new Date(now.getTime() + 2))
    ).toThrow(ExternalApiCursorError);
    expect(() =>
      openLeadFeedCursor(token.replace("cur_7_", "cur_8_"), keyRing, now)
    ).toThrow(ExternalApiCursorError);
  });

  it("round-trips opaque checkpoints without a readable sequence or identity", () => {
    const claims = {
      purpose: "lead_checkpoint" as const,
      ...actor,
      sequence: "123456",
      dataThrough: "2026-07-27T11:59:00.000Z",
      issuedAt: now.getTime(),
    };
    const token = sealLeadSyncCheckpoint(claims, keyRing);
    expect(token).toMatch(/^sync_7_[A-Za-z0-9_-]+$/);
    expect(openLeadSyncCheckpoint(token, keyRing)).toMatchObject({
      sequence: "123456",
      companyId: actor.companyId,
    });
    expectClaimSealed(token, claims, "sequence");
    expectClaimSealed(token, claims, "principalId");
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
