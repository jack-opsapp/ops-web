/**
 * Engine readiness: the seven checks the admin ledger shows while the
 * account is dark. Pure function over probe + database facts.
 */
import { describe, it, expect } from "vitest";
import { computeReadiness, READINESS_KEYS, type ReadinessInputs } from "@/lib/ads/readiness";

const GREEN_PROBE: NonNullable<ReadinessInputs["probe"]> = {
  probedAt: "2026-09-09T02:29:40.415Z",
  mutateStatus: 200,
  mutateErrorCode: null,
  serviceAccountRole: "STANDARD",
  acceptedCustomerDataTerms: true,
  enhancedConversionsForLeadsEnabled: true,
  dataManager: { status: 200, errorStatus: null, reason: null },
};

function inputs(over: Partial<ReadinessInputs> = {}): ReadinessInputs {
  return {
    probe: GREEN_PROBE,
    conversionActionCount: 3,
    clickIdCompanies30d: 4,
    eventStates: { sent: 2, queued: 1 },
    ...over,
  };
}

describe("computeReadiness", () => {
  it("lists the seven checks in order and reports all ready when everything is green", () => {
    const out = computeReadiness(inputs());
    expect(out.checks.map((c) => c.key)).toEqual([...READINESS_KEYS]);
    expect(READINESS_KEYS).toEqual([
      "service_account_role",
      "customer_data_terms",
      "enhanced_conversions_for_leads",
      "data_manager_api",
      "conversion_actions",
      "click_id_capture",
      "first_event_sent",
    ]);
    expect(out.checks.every((c) => c.state === "ready")).toBe(true);
    expect(out.allReady).toBe(true);
    expect(out.probedAt).toBe(GREEN_PROBE.probedAt);
  });

  it("marks the four account checks pending until a probe has run", () => {
    const out = computeReadiness(inputs({ probe: null }));
    const byKey = Object.fromEntries(out.checks.map((c) => [c.key, c]));
    for (const key of ["service_account_role", "customer_data_terms", "enhanced_conversions_for_leads", "data_manager_api"]) {
      expect(byKey[key].state).toBe("pending");
      expect(byKey[key].reason).toBe("Not probed yet");
    }
    expect(out.probedAt).toBeNull();
    expect(out.allReady).toBe(false);
  });

  it("names the account action that is still missing", () => {
    const out = computeReadiness(
      inputs({
        probe: {
          ...GREEN_PROBE,
          mutateStatus: 403,
          mutateErrorCode: "authorizationError.ACTION_NOT_PERMITTED",
          serviceAccountRole: "READ_ONLY",
          acceptedCustomerDataTerms: false,
          enhancedConversionsForLeadsEnabled: false,
          dataManager: { status: 403, errorStatus: "PERMISSION_DENIED", reason: "SERVICE_DISABLED" },
        },
      })
    );
    const byKey = Object.fromEntries(out.checks.map((c) => [c.key, c]));
    expect(byKey.service_account_role).toMatchObject({ state: "blocked", reason: "Role is Read only on the manager account" });
    expect(byKey.customer_data_terms).toMatchObject({ state: "blocked", reason: "Customer data terms not accepted" });
    expect(byKey.enhanced_conversions_for_leads).toMatchObject({ state: "blocked", reason: "Enhanced conversions for leads is off" });
    expect(byKey.data_manager_api).toMatchObject({ state: "blocked", reason: "Data Manager API is not enabled on the Cloud project" });
    expect(out.allReady).toBe(false);
  });

  it("treats a validation 4xx from the Data Manager as reachable, and an auth failure as blocked", () => {
    const invalid = computeReadiness(
      inputs({ probe: { ...GREEN_PROBE, dataManager: { status: 400, errorStatus: "INVALID_ARGUMENT", reason: null } } })
    );
    expect(invalid.checks.find((c) => c.key === "data_manager_api")).toMatchObject({ state: "ready" });
    const denied = computeReadiness(
      inputs({ probe: { ...GREEN_PROBE, dataManager: { status: 401, errorStatus: "UNAUTHENTICATED", reason: null } } })
    );
    expect(denied.checks.find((c) => c.key === "data_manager_api")).toMatchObject({
      state: "blocked",
      reason: "Data Manager API rejected the service account",
    });
    const down = computeReadiness(
      inputs({ probe: { ...GREEN_PROBE, dataManager: { status: 503, errorStatus: "UNAVAILABLE", reason: null } } })
    );
    expect(down.checks.find((c) => c.key === "data_manager_api")).toMatchObject({ state: "pending" });
  });

  it("explains a write refusal that is not a role problem", () => {
    const out = computeReadiness(
      inputs({ probe: { ...GREEN_PROBE, mutateStatus: 403, mutateErrorCode: "authorizationError.DEVELOPER_TOKEN_NOT_APPROVED", serviceAccountRole: "STANDARD" } })
    );
    expect(out.checks.find((c) => c.key === "service_account_role")).toMatchObject({
      state: "blocked",
      reason: "Write refused: authorizationError.DEVELOPER_TOKEN_NOT_APPROVED",
    });
  });

  it("tracks the conversion-action ledger", () => {
    expect(computeReadiness(inputs({ conversionActionCount: 0 })).checks.find((c) => c.key === "conversion_actions")).toMatchObject({
      state: "pending",
      reason: "Setup has not run",
    });
    expect(computeReadiness(inputs({ conversionActionCount: 2 })).checks.find((c) => c.key === "conversion_actions")).toMatchObject({
      state: "blocked",
      reason: "2 of 3 conversion actions recorded",
    });
    expect(computeReadiness(inputs({ conversionActionCount: 3 })).checks.find((c) => c.key === "conversion_actions")).toMatchObject({
      state: "ready",
      reason: "3 of 3 conversion actions recorded",
    });
  });

  it("keeps click-id capture pending until real traffic arrives", () => {
    expect(computeReadiness(inputs({ clickIdCompanies30d: 0 })).checks.find((c) => c.key === "click_id_capture")).toMatchObject({
      state: "pending",
      reason: "No Google click ids in the last 30 days",
    });
    expect(computeReadiness(inputs({ clickIdCompanies30d: 1 })).checks.find((c) => c.key === "click_id_capture")).toMatchObject({
      state: "ready",
      reason: "1 company with a Google click id in the last 30 days",
    });
    expect(computeReadiness(inputs({ clickIdCompanies30d: 4 })).checks.find((c) => c.key === "click_id_capture")).toMatchObject({
      reason: "4 companies with a Google click id in the last 30 days",
    });
  });

  it("reports the first delivered event, failures, and an empty outbox", () => {
    expect(computeReadiness(inputs({ eventStates: {} })).checks.find((c) => c.key === "first_event_sent")).toMatchObject({
      state: "pending",
      reason: "No events queued yet",
    });
    expect(computeReadiness(inputs({ eventStates: { queued: 3 } })).checks.find((c) => c.key === "first_event_sent")).toMatchObject({
      state: "pending",
      reason: "3 events queued, none sent yet",
    });
    expect(computeReadiness(inputs({ eventStates: { failed: 2, queued: 1 } })).checks.find((c) => c.key === "first_event_sent")).toMatchObject({
      state: "blocked",
      reason: "2 events failed to reach Google",
    });
    expect(computeReadiness(inputs({ eventStates: { sent: 5, failed: 1 } })).checks.find((c) => c.key === "first_event_sent")).toMatchObject({
      state: "ready",
      reason: "5 events delivered",
    });
  });
});
