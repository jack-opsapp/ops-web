import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { getExternalLeadFeed } from "@/lib/external-api/analytics/lead-feed-service";
import {
  openLeadFeedCursor,
  openLeadSyncCheckpoint,
  parseExternalApiCursorKeyRing,
} from "@/lib/external-api/analytics/cursor";
import type { ExternalApiRequestActor } from "@/lib/external-api/auth/credential-auth";

const keyRing = parseExternalApiCursorKeyRing(
  JSON.stringify({
    activeKid: "1",
    keys: { "1": randomBytes(32).toString("base64url") },
  })
);
const now = new Date("2026-07-27T12:00:00.000Z");
const actor: ExternalApiRequestActor = {
  principalId: "11111111-1111-4111-8111-111111111111",
  credentialId: "22222222-2222-4222-8222-222222222222",
  companyId: "33333333-3333-4333-8333-333333333333",
  credentialClass: "analytics",
  scopes: ["analytics.leads.read"],
  allowedSourceIds: [],
  authorizationEpoch: 3,
  digestVersion: 1,
  credentialDigest:
    "\\xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  visiblePrefix: "opsx_1_abcdefghijkl",
};

const emptyDimension = { present: false, handle: null, label: null };
const source = {
  sourceChannel: "email" as const,
  sourceIntegrationType: "email_import" as const,
  sourceId: null,
  sourceLabel: null,
  siteHost: null,
  siteLabel: null,
  formId: null,
  formLabel: null,
  campaign: emptyDimension,
  utm: {
    source: emptyDimension,
    medium: emptyDimension,
    campaign: emptyDimension,
    term: emptyDimension,
    content: emptyDimension,
  },
  click: { providerCode: null, captured: false },
  landingPage: null,
  referrer: null,
  inquiryReceivedAt: "2026-07-27T10:00:00.000Z",
  leadCreatedAt: "2026-07-27T10:00:00.000Z",
  attributionCapturedAt: "2026-07-27T10:00:00.000Z",
  timingSource: "provider_message" as const,
  timingQuality: "provider_derived" as const,
  completeness: {
    channelKnown: true,
    authenticatedSite: false,
    configuredForm: false,
    campaignObserved: false,
    utmSetObserved: false,
    landingPageObserved: false,
    referrerObserved: false,
  },
};

function projection(publicLeadId: string) {
  return {
    operation: "upsert" as const,
    publicLeadId,
    inquiryReceivedAt: "2026-07-27T10:00:00.000Z",
    createdAt: "2026-07-27T10:00:00.000Z",
    updatedAt: "2026-07-27T10:05:00.000Z",
    currentStageEnteredAt: "2026-07-27T10:00:00.000Z",
    terminalAt: null,
    currentStage: "new_lead" as const,
    disposition: null,
    recordState: "active" as const,
    mergeTargetPublicLeadId: null,
    source,
    firstResponseAt: null,
    firstResponseMinutes: null,
    wonAt: null,
    lostAt: null,
    disqualifiedAt: null,
    discardedAt: null,
    projectConvertedAt: null,
    minutesToDecision: null,
    minutesToWin: null,
    minutesToProjectConversion: null,
    reached: {
      qualifying: false,
      quoting: false,
      quoted: false,
      followUp: false,
      negotiation: false,
      won: false,
      lost: false,
      projectConverted: false,
    },
  };
}

const missCache = {
  get: vi.fn().mockResolvedValue({ outcome: "miss", value: null }),
  set: vi.fn().mockResolvedValue(true),
};

describe("external lead feed service", () => {
  it("captures a full high-water and emits a checkpoint only on the terminal page", async () => {
    const firstPublicUuid = "44444444-4444-4444-8444-444444444444";
    const firstPublicId = "lead_RERERERERESERERERERERA";
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          high_water_sequence: "12",
          retained_from_sequence: "1",
          data_through: "2026-07-27T11:59:00.000Z",
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          items: [projection(firstPublicId)],
          has_more: true,
          last_public_lead_id: firstPublicUuid,
        },
        error: null,
      });

    const first = await getExternalLeadFeed(
      {
        actor,
        auditRequestId: "55555555-5555-4555-8555-555555555555",
        requestReceivedAt: now.toISOString(),
        query: { mode: "full", pageSize: 100 },
      },
      {
        client: { rpc },
        cache: missCache,
        cursorKeyRing: keyRing,
        now: () => now,
      }
    );
    expect(first.result.items).toHaveLength(1);
    expect(first.result.nextCursor).not.toBeNull();
    expect(first.result.nextSyncCheckpoint).toBeNull();
    expect(
      openLeadFeedCursor(first.result.nextCursor!, keyRing, now)
    ).toMatchObject({
      highWater: "12",
      afterPublicLeadId: firstPublicUuid,
      sort: "public_lead_id",
    });

    const rpcSecond = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          high_water_sequence: "18",
          retained_from_sequence: "1",
          data_through: "2026-07-27T12:01:00.000Z",
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          items: [],
          has_more: false,
          last_public_lead_id: null,
        },
        error: null,
      });
    const terminal = await getExternalLeadFeed(
      {
        actor,
        auditRequestId: "66666666-6666-4666-8666-666666666666",
        requestReceivedAt: now.toISOString(),
        query: {
          mode: "full",
          pageSize: 100,
          cursor: first.result.nextCursor!,
        },
      },
      {
        client: { rpc: rpcSecond },
        cache: missCache,
        cursorKeyRing: keyRing,
        now: () => now,
      }
    );
    expect(terminal.result.nextCursor).toBeNull();
    expect(
      openLeadSyncCheckpoint(terminal.result.nextSyncCheckpoint!, keyRing)
    ).toMatchObject({ sequence: "12" });
    expect(rpcSecond.mock.calls[1]?.[1]).toMatchObject({
      p_high_water_sequence: "12",
      p_after_public_lead_id: firstPublicUuid,
    });
  });

  it("revalidates authorization before returning a private cache hit", async () => {
    const cachedResult = {
      mode: "full" as const,
      dataThrough: "2026-07-27T11:59:00.000Z",
      items: [],
      nextCursor: null,
      nextSyncCheckpoint: null,
    };
    const cache = {
      get: vi.fn().mockResolvedValue({
        outcome: "hit" as const,
        value: cachedResult,
      }),
      set: vi.fn(),
    };
    const rpc = vi.fn().mockResolvedValue({
      data: {
        high_water_sequence: "0",
        retained_from_sequence: "1",
        data_through: "2026-07-27T11:59:00.000Z",
      },
      error: null,
    });

    const result = await getExternalLeadFeed(
      {
        actor,
        auditRequestId: "77777777-7777-4777-8777-777777777777",
        requestReceivedAt: now.toISOString(),
        query: { mode: "full", pageSize: 100 },
      },
      { client: { rpc }, cache, cursorKeyRing: keyRing, now: () => now }
    );
    expect(result.cacheResult).toBe("hit");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "authorize_external_lead_feed_as_system",
      expect.any(Object)
    );
  });
});
