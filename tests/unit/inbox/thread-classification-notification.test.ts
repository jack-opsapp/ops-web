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

const phaseCRouteMock = vi.hoisted(() =>
  vi.fn(async () => ({
    outcome: "auto_drafted",
    category: "CUSTOMER",
    effectiveLevel: "auto_draft",
  }))
);

// Phase C router — capture only, never the real implementation.
vi.mock("@/lib/api/services/phase-c-autonomy-router", () => ({
  PhaseCAutonomyRouter: {
    route: phaseCRouteMock,
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
vi.mock("@/lib/api/services/thread-classifier-service", () => ({
  ThreadClassifier: {
    CLASSIFIER_VERSION: "thread-test-v1",
    classifyThread: vi.fn(async () => ({
      primaryCategory: "OTHER",
      labels: [],
      aiSummary: "Classification unavailable — review manually.",
      confidence: 0,
    })),
  },
}));

// The assignment-aware notification helper is dynamically imported by
// fireThreadNotifications. Its own focused tests cover the guarded RPC.
const createClassifiedEmailThreadNotifications = vi.fn(async () => 0);
const emailThreadUpdatePayloads: Array<Record<string, unknown>> = [];
vi.mock("@/lib/email/email-opportunity-notification", () => ({
  createClassifiedEmailThreadNotifications,
}));

import { EmailThreadService } from "@/lib/api/services/email-thread-service";
import { ThreadClassifier } from "@/lib/api/services/thread-classifier-service";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import type { EmailThread } from "@/lib/types/email-thread";

// Minimal Supabase double. The email_threads UPDATE…select…single returns the
// post-classification row (this is `next`); opportunityId on that row is what
// drives the action_url joiner.
function makeDouble(opts: {
  nextOpportunityId: string | null;
  activityBody?: string;
  summaryConflictsRemaining?: number;
}) {
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
    message_count: 1,
    last_message_at: new Date().toISOString(),
    category_manually_set: false,
  };
  return {
    from(table: string) {
      let isUpdate = false;
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.eq = chain;
      builder.in = chain;
      builder.lt = chain;
      builder.is = chain;
      builder.order = chain;
      builder.update = (payload: Record<string, unknown>) => {
        isUpdate = true;
        if (table === "email_threads") emailThreadUpdatePayloads.push(payload);
        return builder;
      };
      builder.limit = async () => {
        if (table === "activities") {
          return {
            data: [
              {
                from_email: "client@acme.com",
                direction: "inbound",
                body_text: opts.activityBody ?? "Any update on the quote?",
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
        if (
          table === "email_threads" &&
          isUpdate &&
          (opts.summaryConflictsRemaining ?? 0) > 0
        ) {
          opts.summaryConflictsRemaining! -= 1;
          return { data: null, error: null };
        }
        return {
          data: table === "email_threads" ? updatedRow : null,
          error: null,
        };
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
  createClassifiedEmailThreadNotifications.mockClear();
  phaseCRouteMock.mockClear();
  emailThreadUpdatePayloads.length = 0;
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
    expect(emailThreadUpdatePayloads).toContainEqual(
      expect.objectContaining({ ai_summary: "Any update on the quote?" })
    );
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

  it("replaces a generic classifier placeholder with the current message", async () => {
    setSupabaseOverride(makeDouble({ nextOpportunityId: "opp-1" }) as never);

    await EmailThreadService.classifyAndUpdate(
      inputThread({ categoryManuallySet: true })
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(emailThreadUpdatePayloads).toContainEqual(
      expect.objectContaining({
        ai_summary: "Any update on the quote?",
      })
    );
    expect(emailThreadUpdatePayloads).not.toContainEqual(
      expect.objectContaining({
        ai_summary: expect.stringMatching(/Classification unavailable/i),
      })
    );
  });

  it("refreshes only the narrative without category, Phase C, or notification side effects", async () => {
    setSupabaseOverride(makeDouble({ nextOpportunityId: "opp-1" }) as never);

    await EmailThreadService.refreshSummaryOnly(
      inputThread({
        categoryManuallySet: true,
        primaryCategory: "OTHER",
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(emailThreadUpdatePayloads).toHaveLength(1);
    expect(emailThreadUpdatePayloads[0]).toEqual({
      ai_summary: "Any update on the quote?",
    });
    expect(phaseCRouteMock).not.toHaveBeenCalled();
    expect(createClassifiedEmailThreadNotifications).not.toHaveBeenCalled();
  });

  it("retries a summary-only CAS conflict instead of falsely reporting a stale winner", async () => {
    setSupabaseOverride(
      makeDouble({
        nextOpportunityId: "opp-1",
        summaryConflictsRemaining: 1,
      }) as never
    );

    await EmailThreadService.refreshSummaryOnly(inputThread());

    expect(emailThreadUpdatePayloads).toEqual([
      { ai_summary: "Any update on the quote?" },
      { ai_summary: "Any update on the quote?" },
    ]);
    expect(phaseCRouteMock).not.toHaveBeenCalled();
    expect(createClassifiedEmailThreadNotifications).not.toHaveBeenCalled();
  });

  it("replaces a vague ungrounded narrative with the newest cleaned message", async () => {
    const activityBody =
      "The revised quote is $8,450 for cedar railings with September installation.";
    setSupabaseOverride(
      makeDouble({ nextOpportunityId: "opp-1", activityBody }) as never
    );
    vi.mocked(ThreadClassifier.classifyThread).mockResolvedValueOnce({
      threadId: "thr-1",
      primaryCategory: "CUSTOMER",
      labels: [],
      ballInCourt: "operator",
      aiSummary: "Customer is discussing the project; follow up.",
      confidence: 0.8,
      reasoning: "test",
    });

    await EmailThreadService.classifyAndUpdate(inputThread());
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(emailThreadUpdatePayloads).toContainEqual(
      expect.objectContaining({ ai_summary: activityBody })
    );
  });

  it("keeps a grounded narrative for a legitimate sparse inquiry", async () => {
    setSupabaseOverride(
      makeDouble({
        nextOpportunityId: "opp-1",
        activityBody: "Could you quote cedar railings?",
      }) as never
    );
    const grounded = "Customer requested an estimate for cedar railings.";
    vi.mocked(ThreadClassifier.classifyThread).mockResolvedValueOnce({
      threadId: "thr-1",
      primaryCategory: "CUSTOMER",
      labels: [],
      ballInCourt: "operator",
      aiSummary: grounded,
      confidence: 0.8,
      reasoning: "test",
    });

    await EmailThreadService.classifyAndUpdate(inputThread());
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(emailThreadUpdatePayloads).toContainEqual(
      expect.objectContaining({ ai_summary: grounded })
    );
  });

  it("rejects a partly grounded narrative that invents a numeric fact", async () => {
    const activityBody = "Could you quote cedar railings?";
    setSupabaseOverride(
      makeDouble({ nextOpportunityId: "opp-1", activityBody }) as never
    );
    vi.mocked(ThreadClassifier.classifyThread).mockResolvedValueOnce({
      threadId: "thr-1",
      primaryCategory: "CUSTOMER",
      labels: [],
      ballInCourt: "operator",
      aiSummary: "Cedar railings were quoted at $9,999.",
      confidence: 0.8,
      reasoning: "test",
    });

    await EmailThreadService.classifyAndUpdate(inputThread());
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(emailThreadUpdatePayloads).toContainEqual(
      expect.objectContaining({ ai_summary: activityBody })
    );
  });

  it("does not ground a model narrative in stripped quoted history", async () => {
    setSupabaseOverride(
      makeDouble({
        nextOpportunityId: "opp-1",
        activityBody:
          "Current request is cedar railings.\n\nOn Monday, Canpro wrote:\n> The landscaping project is ready.",
      }) as never
    );
    vi.mocked(ThreadClassifier.classifyThread).mockResolvedValueOnce({
      threadId: "thr-1",
      primaryCategory: "CUSTOMER",
      labels: [],
      ballInCourt: "operator",
      aiSummary: "Customer says the landscaping project is ready.",
      confidence: 0.8,
      reasoning: "test",
    });

    await EmailThreadService.classifyAndUpdate(inputThread());
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(emailThreadUpdatePayloads).toContainEqual(
      expect.objectContaining({
        ai_summary: "Current request is cedar railings.",
      })
    );
  });
});
