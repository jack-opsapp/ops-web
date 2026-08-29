import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  LEAD_SUMMARY_DEFERRAL_ATTEMPT_CAP,
  applyLeadSummaryDeferralCap,
  decodeEmailSyncContinuation,
  encodeEmailSyncContinuation,
  isEmailSyncContinuationPending,
} from "@/lib/email/email-sync-continuation";

const PROVIDER_TOKEN = "3341840";

describe("continuation envelope carries bounded summary attempts", () => {
  it("tolerates a v1 payload written before the attempts field existed", () => {
    const legacy = `ops-email-sync:v1:${JSON.stringify({
      providerToken: PROVIDER_TOKEN,
      pendingLeadSummaryOpportunityIds: ["opportunity-1"],
    })}`;

    expect(decodeEmailSyncContinuation(legacy)).toEqual({
      providerToken: PROVIDER_TOKEN,
      pendingLeadSummaryOpportunityIds: ["opportunity-1"],
      pendingLeadSummaryAttempts: {},
    });
  });

  it("round-trips attempts and keeps the field out of the payload when empty", () => {
    const withAttempts = encodeEmailSyncContinuation({
      providerToken: PROVIDER_TOKEN,
      pendingLeadSummaryOpportunityIds: ["opportunity-1", "opportunity-2"],
      pendingLeadSummaryAttempts: { "opportunity-1": 2 },
    });
    expect(decodeEmailSyncContinuation(withAttempts)).toEqual({
      providerToken: PROVIDER_TOKEN,
      pendingLeadSummaryOpportunityIds: ["opportunity-1", "opportunity-2"],
      pendingLeadSummaryAttempts: { "opportunity-1": 2 },
    });

    const withoutAttempts = encodeEmailSyncContinuation({
      providerToken: PROVIDER_TOKEN,
      pendingLeadSummaryOpportunityIds: ["opportunity-1"],
      pendingLeadSummaryAttempts: {},
    });
    expect(withoutAttempts).not.toContain("pendingLeadSummaryAttempts");
  });

  it("prunes attempts for opportunities that are no longer pending", () => {
    const encoded = encodeEmailSyncContinuation({
      providerToken: PROVIDER_TOKEN,
      pendingLeadSummaryOpportunityIds: ["opportunity-1"],
      pendingLeadSummaryAttempts: { "opportunity-1": 1, "opportunity-gone": 2 },
    });
    expect(
      decodeEmailSyncContinuation(encoded).pendingLeadSummaryAttempts
    ).toEqual({ "opportunity-1": 1 });
  });

  it("still collapses to the bare provider token once nothing is pending", () => {
    const encoded = encodeEmailSyncContinuation({
      providerToken: PROVIDER_TOKEN,
      pendingLeadSummaryOpportunityIds: [],
      pendingLeadSummaryAttempts: { "opportunity-1": 3 },
    });
    expect(encoded).toBe(PROVIDER_TOKEN);
    expect(isEmailSyncContinuationPending(encoded)).toBe(false);
  });

  it("rejects a malformed attempts map instead of guessing", () => {
    const bad = `ops-email-sync:v1:${JSON.stringify({
      providerToken: PROVIDER_TOKEN,
      pendingLeadSummaryOpportunityIds: ["opportunity-1"],
      pendingLeadSummaryAttempts: { "opportunity-1": "two" },
    })}`;
    expect(() => decodeEmailSyncContinuation(bad)).toThrow(
      /pendingLeadSummaryAttempts/
    );
  });
});

describe("lead-summary deferral cap", () => {
  const deferral = (
    opportunityId: string,
    reason: "provider_unavailable" | "model_contract" | "model_refusal"
  ) => ({ opportunityId, reason, error: `${reason} for ${opportunityId}` });

  it("counts only model contract and refusal deferrals", () => {
    const result = applyLeadSummaryDeferralCap({
      remainingOpportunityIds: ["a", "b", "c"],
      deferred: [
        deferral("a", "model_contract"),
        deferral("b", "model_refusal"),
        deferral("c", "provider_unavailable"),
      ],
      attempts: {},
    });

    expect(result.attempts).toEqual({ a: 1, b: 1 });
    expect(result.pendingOpportunityIds).toEqual(["a", "b", "c"]);
    expect(result.quarantined).toEqual([]);
  });

  it("does not count an opportunity that only ran out of cycle budget", () => {
    const result = applyLeadSummaryDeferralCap({
      remainingOpportunityIds: ["budgeted"],
      deferred: [],
      attempts: { budgeted: 1 },
    });

    expect(result.attempts).toEqual({ budgeted: 1 });
    expect(result.quarantined).toEqual([]);
  });

  it("drops an opportunity from the envelope once it hits the cap", () => {
    const result = applyLeadSummaryDeferralCap({
      remainingOpportunityIds: ["stuck", "healthy"],
      deferred: [deferral("stuck", "model_contract")],
      attempts: { stuck: LEAD_SUMMARY_DEFERRAL_ATTEMPT_CAP - 1 },
    });

    expect(result.pendingOpportunityIds).toEqual(["healthy"]);
    expect(result.attempts).toEqual({});
    expect(result.quarantined).toEqual([
      {
        opportunityId: "stuck",
        reason: "model_contract",
        lastError: "model_contract for stuck",
        deferralCount: LEAD_SUMMARY_DEFERRAL_ATTEMPT_CAP,
      },
    ]);
  });

  it("only ever removes work from the envelope", () => {
    const remaining = ["a", "b"];
    const result = applyLeadSummaryDeferralCap({
      remainingOpportunityIds: remaining,
      deferred: [
        deferral("a", "model_contract"),
        deferral("b", "model_contract"),
      ],
      attempts: {
        a: LEAD_SUMMARY_DEFERRAL_ATTEMPT_CAP - 1,
        b: LEAD_SUMMARY_DEFERRAL_ATTEMPT_CAP - 1,
      },
    });

    expect(result.pendingOpportunityIds).toEqual([]);
    expect(result.quarantined).toHaveLength(2);
    for (const id of result.pendingOpportunityIds) {
      expect(remaining).toContain(id);
    }
  });

  it("forgets attempts for an opportunity that converged", () => {
    const result = applyLeadSummaryDeferralCap({
      remainingOpportunityIds: [],
      deferred: [],
      attempts: { converged: 2 },
    });

    expect(result.attempts).toEqual({});
    expect(result.pendingOpportunityIds).toEqual([]);
    expect(result.quarantined).toEqual([]);
  });

  it("collapses the envelope to a completed cursor once the last stuck lead is quarantined", () => {
    // Three cycles of the same model-contract failure, exactly as the primary
    // mailbox saw for seven days. The envelope must end EMPTY so the sync
    // stamps completion instead of checkpointing forever.
    let attempts: Record<string, number> = {};
    let pending = ["stuck"];
    let quarantined: unknown[] = [];
    for (let cycle = 0; cycle < LEAD_SUMMARY_DEFERRAL_ATTEMPT_CAP; cycle += 1) {
      const result = applyLeadSummaryDeferralCap({
        remainingOpportunityIds: pending,
        deferred: [deferral("stuck", "model_contract")],
        attempts,
      });
      attempts = result.attempts;
      pending = result.pendingOpportunityIds;
      quarantined = result.quarantined;
    }

    expect(pending).toEqual([]);
    expect(quarantined).toHaveLength(1);

    const encoded = encodeEmailSyncContinuation({
      providerToken: PROVIDER_TOKEN,
      pendingLeadSummaryOpportunityIds: pending,
      pendingLeadSummaryAttempts: attempts,
    });
    expect(encoded).toBe(PROVIDER_TOKEN);
    expect(isEmailSyncContinuationPending(encoded)).toBe(false);
  });

  it("keeps a provider outage retryable forever", () => {
    let attempts: Record<string, number> = {};
    for (let cycle = 0; cycle < 10; cycle += 1) {
      const result = applyLeadSummaryDeferralCap({
        remainingOpportunityIds: ["outage"],
        deferred: [deferral("outage", "provider_unavailable")],
        attempts,
      });
      attempts = result.attempts;
      expect(result.quarantined).toEqual([]);
      expect(result.pendingOpportunityIds).toEqual(["outage"]);
    }
  });
});

describe("lead-summary quarantine migration contract", () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/20260830110000_lead_summary_refresh_quarantine.sql"
    ),
    "utf8"
  );

  it("creates the ledger with service-role-only access", () => {
    expect(migration).toContain(
      "create table if not exists public.lead_summary_refresh_quarantine"
    );
    expect(migration).toContain(
      "alter table public.lead_summary_refresh_quarantine enable row level security"
    );
    expect(migration).toMatch(
      /revoke all on table public\.lead_summary_refresh_quarantine\s+from public, anon, authenticated/
    );
    expect(migration).toContain("to service_role");
  });

  it("dedupes the rail alert to one open row per opportunity", () => {
    expect(migration).toContain(
      "create unique index if not exists notifications_lead_summary_quarantine_unique"
    );
    expect(migration).toContain("'lead-summary-quarantine:'");
    expect(migration).toContain("on conflict do nothing");
    expect(migration).toContain("'Review lead summary'");
  });

  it("ships both lifecycle helpers as security-definer service-role functions", () => {
    for (const fn of [
      "public.upsert_lead_summary_refresh_quarantine",
      "public.release_lead_summary_refresh_quarantine",
    ]) {
      expect(migration).toContain(`create or replace function ${fn}`);
      expect(migration).toContain(`grant execute on function ${fn}`);
    }
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = pg_catalog, pg_temp");
    expect(migration).toContain("service role required");
  });

  it("never quarantines for a provider outage", () => {
    expect(migration).not.toContain("provider_unavailable");
  });
});
