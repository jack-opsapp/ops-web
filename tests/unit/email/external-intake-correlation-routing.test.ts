import { describe, expect, it, vi } from "vitest";

import { sealEmailCorrelationMarker } from "@/lib/external-api/intake/email-correlation";
import { resolveExternalIntakeEmailCorrelation } from "@/lib/external-api/intake/email-correlation-routing";

const COMPANY_ID = "10000000-0000-4000-8000-000000000001";
const MAILBOX_ID = "10000000-0000-4000-8000-000000000002";
const SOURCE_ID = "10000000-0000-4000-8000-000000000003";
const OTHER_SOURCE_ID = "10000000-0000-4000-8000-000000000004";
const SUBMISSION_ID = "10000000-0000-4000-8000-000000000005";
const OPPORTUNITY_ID = "10000000-0000-4000-8000-000000000006";
const CLIENT_ID = "10000000-0000-4000-8000-000000000007";
const NOW = new Date("2026-07-26T22:00:00.000Z");
const keyRing = {
  activeKid: 1,
  keys: new Map([[1, Buffer.alloc(32, 9)]]),
};

function marker(overrides: { mailboxId?: string; sourceId?: string } = {}) {
  return sealEmailCorrelationMarker(
    {
      companyId: COMPANY_ID,
      mailboxId: overrides.mailboxId ?? MAILBOX_ID,
      sourceId: overrides.sourceId ?? SOURCE_ID,
      submissionId: SUBMISSION_ID,
      leadId: OPPORTUNITY_ID,
      expiresAt: new Date("2026-08-01T00:00:00.000Z"),
    },
    keyRing,
    () => Buffer.alloc(12, 8)
  );
}

describe("external intake email correlation routing", () => {
  it("binds the encrypted marker to the current company, mailbox, source, and database mapping", async () => {
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === "list_external_intake_email_correlation_sources_as_system") {
        return { data: [OTHER_SOURCE_ID, SOURCE_ID], error: null };
      }
      expect(args).toMatchObject({
        p_company_id: COMPANY_ID,
        p_mailbox_id: MAILBOX_ID,
        p_source_id: SOURCE_ID,
        p_submission_id: SUBMISSION_ID,
        p_opportunity_id: OPPORTUNITY_ID,
      });
      return {
        data: {
          status: "found",
          opportunity_id: OPPORTUNITY_ID,
          client_id: CLIENT_ID,
        },
        error: null,
      };
    });

    await expect(
      resolveExternalIntakeEmailCorrelation(
        {
          marker: marker(),
          companyId: COMPANY_ID,
          mailboxId: MAILBOX_ID,
        },
        { client: { rpc }, keyRing, now: NOW }
      )
    ).resolves.toEqual({
      opportunityId: OPPORTUNITY_ID,
      clientId: CLIENT_ID,
    });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("does not route a marker copied to another mailbox", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [SOURCE_ID],
      error: null,
    });
    await expect(
      resolveExternalIntakeEmailCorrelation(
        {
          marker: marker({ mailboxId: OTHER_SOURCE_ID }),
          companyId: COMPANY_ID,
          mailboxId: MAILBOX_ID,
        },
        { client: { rpc }, keyRing, now: NOW }
      )
    ).resolves.toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("fails closed to ordinary ingestion for malformed, expired, or unconfigured markers", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [SOURCE_ID],
      error: null,
    });
    await expect(
      resolveExternalIntakeEmailCorrelation(
        {
          marker: "emc_not-a-valid-envelope-value",
          companyId: COMPANY_ID,
          mailboxId: MAILBOX_ID,
        },
        { client: { rpc }, keyRing, now: NOW }
      )
    ).resolves.toBeNull();
    await expect(
      resolveExternalIntakeEmailCorrelation(
        {
          marker: marker(),
          companyId: COMPANY_ID,
          mailboxId: MAILBOX_ID,
        },
        {
          client: { rpc },
          keyRing,
          now: new Date("2026-09-01T00:00:00.000Z"),
        }
      )
    ).resolves.toBeNull();
    await expect(
      resolveExternalIntakeEmailCorrelation(
        {
          marker: marker(),
          companyId: COMPANY_ID,
          mailboxId: MAILBOX_ID,
        },
        { client: { rpc } }
      )
    ).resolves.toBeNull();
  });

  it("keeps database failures retryable instead of silently falling through", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "database unavailable" },
    });
    await expect(
      resolveExternalIntakeEmailCorrelation(
        {
          marker: marker(),
          companyId: COMPANY_ID,
          mailboxId: MAILBOX_ID,
        },
        { client: { rpc }, keyRing, now: NOW }
      )
    ).rejects.toThrow("source lookup failed");
  });
});
