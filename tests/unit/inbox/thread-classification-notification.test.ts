/**
 * Lead/opportunity notification delivery — email-thread classification seam.
 *
 * fireThreadNotifications must delegate the exact previous/current thread
 * snapshots to the canonical assignment-aware helper. That helper and its SQL
 * migration own recipient derivation, assignment fencing, dedupe, and inbox
 * deep-link construction; this service must never recreate those rules or
 * notify a mailbox connector directly.
 *
 * These tests drive classifyAndUpdate down the deterministic CUSTOMER branch
 * (the path that fires the notification) and assert the exact helper boundary.
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
  loadOpportunityForCustomerRule: async () => ({
    stage: "quoting",
    archivedAt: null,
  }),
}));

// The assignment-aware notification helper is dynamically imported by
// fireThreadNotifications. Its own focused tests cover the guarded RPC.
const createClassifiedEmailThreadNotifications = vi.fn(async () => 0);
vi.mock("@/lib/email/email-opportunity-notification", () => ({
  createClassifiedEmailThreadNotifications,
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
      builder.maybeSingle = async () => ({ data: null, error: null });
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
  createClassifiedEmailThreadNotifications.mockClear();
});

afterEach(() => {
  setSupabaseOverride(null);
});

describe("email-thread classification notification — guarded helper boundary", () => {
  it("delegates linked thread snapshots to the assignment-aware helper", async () => {
    setSupabaseOverride(makeDouble({ nextOpportunityId: "opp-1" }) as never);

    await EmailThreadService.classifyAndUpdate(inputThread());
    await new Promise((r) => setTimeout(r, 20)); // fire-and-forget hook

    expect(createClassifiedEmailThreadNotifications).toHaveBeenCalledTimes(1);
    expect(createClassifiedEmailThreadNotifications).toHaveBeenCalledWith({
      previous: expect.objectContaining({
        id: "thr-1",
        opportunityId: "opp-1",
        primaryCategory: "OTHER",
      }),
      next: expect.objectContaining({
        id: "thr-1",
        companyId: "co-1",
        connectionId: "conn-1",
        providerThreadId: "pt-1",
        opportunityId: "opp-1",
        primaryCategory: "CUSTOMER",
      }),
      supabase: expect.anything(),
    });
  });

  it("delegates an unlinked snapshot without inventing a connector recipient", async () => {
    setSupabaseOverride(makeDouble({ nextOpportunityId: null }) as never);

    await EmailThreadService.classifyAndUpdate(inputThread());
    await new Promise((r) => setTimeout(r, 20));

    expect(createClassifiedEmailThreadNotifications).toHaveBeenCalledTimes(1);
    expect(createClassifiedEmailThreadNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        next: expect.objectContaining({ opportunityId: null }),
      })
    );
  });
});
