/**
 * Google Ads engine — readiness checks.
 *
 * Seven facts the admin ledger shows while the account is dark, computed from
 * the last stored probe plus live database counts. Pure: no I/O here. The
 * probe route (`/api/internal/ads/setup/probe`) refreshes the stored probe;
 * the admin readiness route pairs it with the counts and calls computeReadiness.
 *
 * States: ready (fact confirmed), blocked (an action is missing — the reason
 * names it), pending (nothing to judge yet — no probe, no traffic, no events).
 */

export const READINESS_KEYS = [
  "service_account_role",
  "customer_data_terms",
  "enhanced_conversions_for_leads",
  "data_manager_api",
  "conversion_actions",
  "click_id_capture",
  "first_event_sent",
] as const;

export type ReadinessKey = (typeof READINESS_KEYS)[number];
export type ReadinessState = "ready" | "blocked" | "pending";

export interface ReadinessCheck {
  key: ReadinessKey;
  state: ReadinessState;
  /** One short sentence; shown verbatim under the row title. */
  reason: string;
}

/** The stored result of the write-access probe (see scripts/ads/validate-probe.mjs). */
export interface StoredProbe {
  probedAt: string;
  mutateStatus: number | null;
  mutateErrorCode: string | null;
  serviceAccountRole: string | null;
  acceptedCustomerDataTerms: boolean;
  enhancedConversionsForLeadsEnabled: boolean;
  dataManager: { status: number | null; errorStatus: string | null; reason: string | null };
}

export interface ReadinessInputs {
  probe: StoredProbe | null;
  /** Rows in ads_conversion_actions (three when setup has run). */
  conversionActionCount: number;
  /** Companies whose trial_attributions carry any Google click id, last 30 days. */
  clickIdCompanies30d: number;
  /** ads_conversion_events grouped by state. */
  eventStates: Partial<Record<"queued" | "sent" | "failed" | "skipped", number>>;
}

export interface ReadinessResult {
  checks: ReadinessCheck[];
  probedAt: string | null;
  allReady: boolean;
}

export const CONVERSION_ACTION_TARGET_COUNT = 3;

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function serviceAccountRole(probe: StoredProbe | null): ReadinessCheck {
  const key = "service_account_role";
  if (!probe) return { key, state: "pending", reason: "Not probed yet" };
  if (probe.mutateStatus === 200) {
    return { key, state: "ready", reason: `Role is ${roleLabel(probe.serviceAccountRole)} on the manager account` };
  }
  if (probe.serviceAccountRole === "READ_ONLY") {
    return { key, state: "blocked", reason: "Role is Read only on the manager account" };
  }
  if (probe.mutateErrorCode) {
    return { key, state: "blocked", reason: `Write refused: ${probe.mutateErrorCode}` };
  }
  return {
    key,
    state: "blocked",
    reason: `Write refused with HTTP ${probe.mutateStatus ?? "error"}`,
  };
}

function roleLabel(role: string | null): string {
  switch (role) {
    case "STANDARD":
      return "Standard";
    case "ADMIN":
      return "Admin";
    case "READ_ONLY":
      return "Read only";
    case "EMAIL_ONLY":
      return "Email only";
    default:
      return role ?? "unknown";
  }
}

function customerDataTerms(probe: StoredProbe | null): ReadinessCheck {
  const key = "customer_data_terms";
  if (!probe) return { key, state: "pending", reason: "Not probed yet" };
  return probe.acceptedCustomerDataTerms
    ? { key, state: "ready", reason: "Customer data terms accepted" }
    : { key, state: "blocked", reason: "Customer data terms not accepted" };
}

function enhancedConversions(probe: StoredProbe | null): ReadinessCheck {
  const key = "enhanced_conversions_for_leads";
  if (!probe) return { key, state: "pending", reason: "Not probed yet" };
  return probe.enhancedConversionsForLeadsEnabled
    ? { key, state: "ready", reason: "Enhanced conversions for leads is on" }
    : { key, state: "blocked", reason: "Enhanced conversions for leads is off" };
}

function dataManagerApi(probe: StoredProbe | null): ReadinessCheck {
  const key = "data_manager_api";
  if (!probe) return { key, state: "pending", reason: "Not probed yet" };
  const { status, errorStatus, reason } = probe.dataManager;
  if (status === 200) return { key, state: "ready", reason: "Data Manager API accepted a validation request" };
  if (status === null || status === 0) return { key, state: "pending", reason: "Data Manager API could not be reached" };
  if (reason === "SERVICE_DISABLED") {
    return { key, state: "blocked", reason: "Data Manager API is not enabled on the Cloud project" };
  }
  if (errorStatus === "PERMISSION_DENIED" || errorStatus === "UNAUTHENTICATED" || status === 401 || status === 403) {
    return { key, state: "blocked", reason: "Data Manager API rejected the service account" };
  }
  if (status >= 400 && status < 500) {
    return { key, state: "ready", reason: "Data Manager API reachable (validation answered)" };
  }
  return { key, state: "pending", reason: `Data Manager API answered HTTP ${status}` };
}

function conversionActions(count: number): ReadinessCheck {
  const key = "conversion_actions";
  if (count <= 0) return { key, state: "pending", reason: "Setup has not run" };
  const reason = `${count} of ${CONVERSION_ACTION_TARGET_COUNT} conversion actions recorded`;
  return count >= CONVERSION_ACTION_TARGET_COUNT
    ? { key, state: "ready", reason }
    : { key, state: "blocked", reason };
}

function clickIdCapture(companies: number): ReadinessCheck {
  const key = "click_id_capture";
  if (companies <= 0) return { key, state: "pending", reason: "No Google click ids in the last 30 days" };
  return {
    key,
    state: "ready",
    reason: `${plural(companies, "company", "companies")} with a Google click id in the last 30 days`,
  };
}

function firstEventSent(states: ReadinessInputs["eventStates"]): ReadinessCheck {
  const key = "first_event_sent";
  const sent = states.sent ?? 0;
  const failed = states.failed ?? 0;
  const queued = states.queued ?? 0;
  if (sent > 0) return { key, state: "ready", reason: `${plural(sent, "event", "events")} delivered` };
  if (failed > 0) return { key, state: "blocked", reason: `${plural(failed, "event", "events")} failed to reach Google` };
  if (queued > 0) return { key, state: "pending", reason: `${plural(queued, "event", "events")} queued, none sent yet` };
  return { key, state: "pending", reason: "No events queued yet" };
}

export function computeReadiness(inputs: ReadinessInputs): ReadinessResult {
  const checks: ReadinessCheck[] = [
    serviceAccountRole(inputs.probe),
    customerDataTerms(inputs.probe),
    enhancedConversions(inputs.probe),
    dataManagerApi(inputs.probe),
    conversionActions(inputs.conversionActionCount),
    clickIdCapture(inputs.clickIdCompanies30d),
    firstEventSent(inputs.eventStates),
  ];
  return {
    checks,
    probedAt: inputs.probe?.probedAt ?? null,
    allReady: checks.every((c) => c.state === "ready"),
  };
}
