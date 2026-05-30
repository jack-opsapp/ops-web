/**
 * P4-A — Phase C router uniform firing.
 *
 * Before P4-A, EmailThreadService.classifyAndUpdate early-returned on the
 * deterministic INTERNAL and CUSTOMER branches WITHOUT invoking the Phase C
 * autonomy router. For CUSTOMER (the only category Canpro enabled, at
 * auto_draft) this meant auto_draft was silently inert on first deterministic
 * classification.
 *
 * These tests drive classifyAndUpdate down the deterministic CUSTOMER and
 * INTERNAL branches and assert the router fires for both. All heavy
 * dependencies are mocked: the deterministic rules (so we control which branch
 * is taken), the classifier/reads (unused on the deterministic path), and the
 * Phase C router module (so we can capture .route() calls).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Router capture ───────────────────────────────────────────────────────────
const routerCalls: Array<{ id: string; primaryCategory: string }> = [];
vi.mock("@/lib/api/services/phase-c-autonomy-router", () => ({
  PhaseCAutonomyRouter: {
    route: vi.fn(async (thread: { id: string; primaryCategory: string }) => {
      routerCalls.push({ id: thread.id, primaryCategory: thread.primaryCategory });
      return { outcome: "auto_drafted", category: thread.primaryCategory, effectiveLevel: "auto_draft" };
    }),
  },
}));

// ── Deterministic rule mocks (control which branch classifyAndUpdate takes) ──
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
const notifyCreate = vi.fn(async () => {});
vi.mock("@/lib/api/services/notification-service", () => ({
  NotificationService: { create: notifyCreate },
}));

import { EmailThreadService } from "@/lib/api/services/email-thread-service";
import { PhaseCAutonomyRouter } from "@/lib/api/services/phase-c-autonomy-router";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import type { EmailThread } from "@/lib/types/email-thread";

// Minimal Supabase double: serves the activities select (1 inbound message),
// the email_connections email lookup, and the email_threads UPDATE...select.
function makeDouble() {
  const updatedRow = {
    id: "thr-1",
    company_id: "co-1",
    connection_id: "conn-1",
    provider_thread_id: "pt-1",
    primary_category: "CUSTOMER",
    subject: "Re: Quote",
    latest_sender_email: "client@acme.com",
    opportunity_id: "opp-1",
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
        if (table === "email_connections") return { data: { email: "owner@ops.com" }, error: null };
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

function baseThread(overrides: Partial<EmailThread> = {}): EmailThread {
  return {
    id: "thr-1",
    companyId: "co-1",
    connectionId: "conn-1",
    providerThreadId: "pt-1",
    primaryCategory: "CUSTOMER",
    subject: "Re: Quote",
    latestSenderEmail: "client@acme.com",
    latestSenderName: "Acme",
    latestDirection: "inbound",
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
  routerCalls.length = 0;
  detState.internal = null;
  detState.customer = null;
  notifyCreate.mockClear();
  (PhaseCAutonomyRouter.route as ReturnType<typeof vi.fn>).mockClear();
  setSupabaseOverride(makeDouble() as never);
});

afterEach(() => {
  setSupabaseOverride(null);
});

describe("P4-A — Phase C router uniform firing", () => {
  it("fires the router on the deterministic CUSTOMER branch", async () => {
    detState.customer = {
      category: "CUSTOMER",
      confidence: 0.99,
      summary: "Customer thread",
      classifierVersion: "det-customer-1",
    };

    await EmailThreadService.classifyAndUpdate(baseThread());

    // fire-and-forget — let the microtask + dynamic import resolve.
    await new Promise((r) => setTimeout(r, 20));

    expect(routerCalls).toHaveLength(1);
    expect(routerCalls[0]).toMatchObject({ id: "thr-1", primaryCategory: "CUSTOMER" });
  });

  it("fires the router on the deterministic INTERNAL branch (no notification)", async () => {
    detState.internal = {
      category: "INTERNAL",
      confidence: 0.99,
      summary: "Internal thread",
      classifierVersion: "det-internal-1",
    };

    await EmailThreadService.classifyAndUpdate(baseThread({ primaryCategory: "INTERNAL" }));
    await new Promise((r) => setTimeout(r, 20));

    expect(routerCalls).toHaveLength(1);
    // INTERNAL must NOT page the operator.
    expect(notifyCreate).not.toHaveBeenCalled();
  });
});
