/**
 * Lead/opportunity notification deep-link hardening — email-thread builder.
 *
 * fireThreadNotifications (the "new lead landed" page) is the one builder in the
 * deep-link hardening that joins the opportunity id onto a query string that
 * ALREADY carries `?thread=` — so it must use `&opportunityId=`, not a second
 * `?`. It also stamps deep_link_type `inbox` (it routes to the inbox thread
 * surface, where an opportunity may not yet exist). This is the most
 * error-prone joiner in the change and previously had no payload assertion.
 *
 * These tests drive classifyAndUpdate down the deterministic CUSTOMER branch
 * (the path that fires the notification) and assert the exact NotificationService
 * .create payload — action_url joiner AND deepLinkType.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Phase C router — capture only, never the real implementation.
vi.mock("@/lib/api/services/phase-c-autonomy-router", () => ({
  PhaseCAutonomyRouter: {
    route: vi.fn(async () => ({
      outcome: "auto_drafted",
      category: "CUSTOMER",
      effectiveLevel: "auto_draft",
    })),
  },
}));

// Deterministic rule mocks — force the CUSTOMER branch, skip INTERNAL.
const detState = {
  internal: null as null | Record<string, unknown>,
  customer: null as null | Record<string, unknown>,
};
vi.mock("@/lib/api/services/deterministic-internal-rule", () => ({
  tryDeterministicInternal: () => detState.internal,
}));
vi.mock("@/lib/api/services/deterministic-internal-reads", () => ({
  loadCompanyUsers: async () => [],
  loadTeamForwarders: async () => [],
}));
vi.mock("@/lib/api/services/deterministic-customer-rule", () => ({
  tryDeterministicCustomer: () => detState.customer,
}));
vi.mock("@/lib/api/services/deterministic-customer-reads", () => ({
  loadOpportunityForCustomerRule: async () => ({ stage: "quoting", archivedAt: null }),
}));

// notification-service is dynamically imported by fireThreadNotifications.
const notifyCreate = vi.fn(async (_params: Record<string, unknown>) => {});
vi.mock("@/lib/api/services/notification-service", () => ({
  NotificationService: { create: notifyCreate },
}));

import { EmailThreadService } from "@/lib/api/services/email-thread-service";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import type { EmailThread } from "@/lib/types/email-thread";

// Minimal Supabase double. The email_threads UPDATE…select…single returns the
// post-classification row (this is `next`); opportunityId on that row is what
// drives the action_url joiner.
function makeDouble(opts: { nextOpportunityId: string | null }) {
  const updatedRow = {
    id: "thr-1",
    company_id: "co-1",
    connection_id: "conn-1",
    provider_thread_id: "pt-1",
    primary_category: "CUSTOMER",
    subject: "Re: Quote",
    latest_sender_email: "client@acme.com",
    latest_sender_name: "Acme",
    latest_direction: "inbound",
    opportunity_id: opts.nextOpportunityId,
    participants: ["client@acme.com"],
    labels: [],
  };
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.eq = chain;
      builder.in = chain;
      builder.lt = chain;
      builder.is = chain;
      builder.order = chain;
      builder.update = chain;
      builder.limit = async () => {
        if (table === "activities") {
          return {
            data: [
              {
                from_email: "client@acme.com",
                direction: "inbound",
                body_text: "Any update on the quote?",
                content: "",
                subject: "Re: Quote",
                created_at: new Date().toISOString(),
                to_emails: [],
                cc_emails: [],
                has_attachments: false,
              },
            ],
            error: null,
          };
        }
        return { data: [], error: null };
      };
      builder.maybeSingle = async () => {
        // fireThreadNotifications resolves the recipient from user_id.
        if (table === "email_connections")
          return { data: { email: "owner@ops.com", user_id: "owner-1" }, error: null };
        return { data: null, error: null };
      };
      builder.single = async () => {
        if (table === "email_threads") return { data: updatedRow, error: null };
        return { data: null, error: null };
      };
      return builder;
    },
  };
}

function inputThread(overrides: Partial<EmailThread> = {}): EmailThread {
  return {
    id: "thr-1",
    companyId: "co-1",
    connectionId: "conn-1",
    providerThreadId: "pt-1",
    // Non-CUSTOMER previous so the "new lead" transition fires (wasCustomer=false).
    primaryCategory: "OTHER",
    subject: "Re: Quote",
    latestSenderEmail: "client@acme.com",
    latestSenderName: "Acme",
    latestDirection: "inbound",
    // Required to enter the deterministic CUSTOMER branch.
    opportunityId: "opp-1",
    categoryManuallySet: false,
    participants: ["client@acme.com"],
    labels: [],
    messageCount: 1,
    lastMessageAt: new Date(),
    archivedAt: null,
    snoozedUntil: null,
    categoryConfidence: 0.5,
    ...(overrides as object),
  } as unknown as EmailThread;
}

beforeEach(() => {
  detState.internal = null;
  detState.customer = {
    category: "CUSTOMER",
    confidence: 0.99,
    summary: "Customer thread",
    classifierVersion: "det-customer-1",
  };
  notifyCreate.mockClear();
});

afterEach(() => {
  setSupabaseOverride(null);
});

describe("email-thread classification notification — deep-link contract", () => {
  it("joins the opportunity id with & (not a second ?) and stamps deep_link_type inbox", async () => {
    setSupabaseOverride(makeDouble({ nextOpportunityId: "opp-1" }) as never);

    await EmailThreadService.classifyAndUpdate(inputThread());
    await new Promise((r) => setTimeout(r, 20)); // fire-and-forget hook

    expect(notifyCreate).toHaveBeenCalledTimes(1);
    const payload = notifyCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.type).toBe("leads_waiting");
    expect(payload.deepLinkType).toBe("inbox");
    expect(payload.actionUrl).toBe("/inbox?thread=thr-1&opportunityId=opp-1");
    // Guard the exact regression: never a malformed double "?".
    expect(payload.actionUrl).not.toContain("?opportunityId=");
  });

  it("omits opportunityId from the action_url when the thread is not linked, still stamping inbox", async () => {
    setSupabaseOverride(makeDouble({ nextOpportunityId: null }) as never);

    await EmailThreadService.classifyAndUpdate(inputThread());
    await new Promise((r) => setTimeout(r, 20));

    expect(notifyCreate).toHaveBeenCalledTimes(1);
    const payload = notifyCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.deepLinkType).toBe("inbox");
    expect(payload.actionUrl).toBe("/inbox?thread=thr-1");
    expect(payload.actionUrl).not.toContain("opportunityId");
  });
});
