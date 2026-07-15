import { describe, expect, it } from "vitest";
import {
  decideOpportunityRelationshipMatch,
  findOpportunityRelationshipMatch,
  type OpportunityRelationshipCandidate,
  type OpportunityRelationshipFacts,
} from "@/lib/email/opportunity-relationship-matching";

function candidate(
  overrides: Partial<OpportunityRelationshipCandidate> = {}
): OpportunityRelationshipCandidate {
  return {
    id: "opp-active",
    clientId: "client-john",
    stage: "follow_up",
    archivedAt: null,
    deletedAt: null,
    contactEmail: "john@example.com",
    contactPhone: "250-555-0100",
    address: "18 Cedar Road, Victoria BC",
    title: "John Carter - Deck rebuild",
    description: "Replace the existing back deck and railing.",
    sourceEmailId: "thread-john-1",
    createdAt: "2026-05-20T17:00:00.000Z",
    updatedAt: "2026-05-21T17:00:00.000Z",
    clientEmails: ["john@example.com"],
    subClientEmails: [],
    clientPhones: ["250-555-0100"],
    subClientPhones: [],
    clientAddresses: ["18 Cedar Road, Victoria BC"],
    subClientAddresses: [],
    project: null,
    ...overrides,
  };
}

function facts(
  overrides: Partial<OpportunityRelationshipFacts> = {}
): OpportunityRelationshipFacts {
  return {
    contactName: "John Carter",
    contactEmail: "john@example.com",
    contactPhone: null,
    address: null,
    description: "Following up on the existing deck estimate.",
    subject: "Deck estimate follow-up",
    providerThreadId: "thread-new-1",
    sourcePlatform: null,
    phaseCEnabled: false,
    ...overrides,
  };
}

describe("opportunity relationship matching", () => {
  it("fails closed when a relationship lookup read fails", async () => {
    const failedQuery = {
      select() {
        return this;
      },
      eq() {
        return this;
      },
      ilike() {
        return this;
      },
      is() {
        return this;
      },
      order() {
        return this;
      },
      limit() {
        return this;
      },
      then(resolve: (value: unknown) => unknown) {
        return Promise.resolve({
          data: null,
          error: { message: "relationship database unavailable" },
        }).then(resolve);
      },
    };

    await expect(
      findOpportunityRelationshipMatch({
        supabase: { from: () => failedQuery } as never,
        companyId: "company-1",
        connectionId: "connection-1",
        providerThreadId: "thread-1",
        clientId: null,
        facts: facts(),
      })
    ).rejects.toThrow(
      "Opportunity relationship lookup failed: relationship database unavailable"
    );
  });

  it("links a new thread from the exact same customer email to an active opportunity", () => {
    const decision = decideOpportunityRelationshipMatch({
      facts: facts(),
      candidates: [candidate()],
    });

    expect(decision).toMatchObject({
      action: "link",
      opportunityId: "opp-active",
      confidence: "exact_contact_email",
      reason: expect.stringContaining("email"),
    });
  });

  it("returns the provider-linked opportunity's real client instead of a separate matcher candidate", () => {
    const decision = decideOpportunityRelationshipMatch({
      facts: facts(),
      candidates: [
        candidate({
          id: "opp-thread-owner",
          clientId: "client-thread-owner",
        }),
        candidate({ id: "opp-other", clientId: "client-other" }),
      ],
      providerLinkedOpportunityId: "opp-thread-owner",
    });

    expect(decision).toMatchObject({
      action: "link",
      opportunityId: "opp-thread-owner",
      clientId: "client-thread-owner",
      confidence: "provider_thread",
    });
  });

  it("fails closed when a provider-linked opportunity was not hydrated with its client", () => {
    expect(() =>
      decideOpportunityRelationshipMatch({
        facts: facts(),
        candidates: [candidate({ id: "opp-other" })],
        providerLinkedOpportunityId: "opp-missing",
      })
    ).toThrow("Provider-linked opportunity identity was not loaded");
  });

  it("links an existing related sub-client email to the active parent opportunity", () => {
    const decision = decideOpportunityRelationshipMatch({
      facts: facts({
        contactName: "Mary Carter",
        contactEmail: "mary@example.com",
      }),
      candidates: [
        candidate({
          contactEmail: "john@example.com",
          subClientEmails: ["mary@example.com"],
        }),
      ],
    });

    expect(decision).toMatchObject({
      action: "link",
      opportunityId: "opp-active",
      confidence: "existing_sub_client",
    });
  });

  it("links a different email at the same address only when the opportunity is active", () => {
    const decision = decideOpportunityRelationshipMatch({
      facts: facts({
        contactName: "Mary Carter",
        contactEmail: "mary.new@example.com",
        address: "18 Cedar Road, Victoria BC",
      }),
      candidates: [
        candidate({
          contactEmail: "john@example.com",
          subClientEmails: [],
        }),
      ],
    });

    expect(decision).toMatchObject({
      action: "link",
      opportunityId: "opp-active",
      confidence: "shared_active_address",
    });
  });

  it("creates a separate opportunity when the prior same-address project is closed and scope is distinct", () => {
    const decision = decideOpportunityRelationshipMatch({
      facts: facts({
        contactName: "John Carter",
        contactEmail: "john@example.com",
        address: "18 Cedar Road, Victoria BC",
        description: "Need pricing for a new detached garage soffit job.",
      }),
      candidates: [
        candidate({
          id: "opp-closed",
          stage: "won",
          project: {
            id: "project-closed",
            status: "closed",
            title: "Back deck rebuild",
            description: "Replace the existing back deck and railing.",
            address: "18 Cedar Road, Victoria BC",
            completedAt: "2026-05-01T00:00:00.000Z",
            deletedAt: null,
          },
        }),
      ],
    });

    expect(decision).toMatchObject({
      action: "create_new",
      suggestedOpportunityId: "opp-closed",
      reason: expect.stringContaining("closed"),
    });
  });

  it("does not over-link a Mary and John style case without a deterministic relationship signal", () => {
    const decision = decideOpportunityRelationshipMatch({
      facts: facts({
        contactName: "Mary Carter",
        contactEmail: "mary@example.com",
        contactPhone: null,
        address: null,
        description: "Can you call me about a quote?",
      }),
      candidates: [
        candidate({
          contactEmail: "john@example.com",
          contactPhone: null,
          clientPhones: [],
          clientAddresses: [],
        }),
      ],
    });

    expect(decision).toMatchObject({
      action: "create_new",
      reason: expect.stringContaining("No deterministic"),
    });
  });

  it("uses parsed customer identity for platform form senders, not the platform mailbox", () => {
    const decision = decideOpportunityRelationshipMatch({
      facts: facts({
        contactName: "Marcel Mercier",
        contactEmail: "marcel.mercier@example.com",
        sourcePlatform: "Wix Forms",
      }),
      candidates: [
        candidate({
          id: "opp-marcel",
          contactEmail: "marcel.mercier@example.com",
          clientEmails: ["marcel.mercier@example.com"],
        }),
      ],
    });

    expect(decision).toMatchObject({
      action: "link",
      opportunityId: "opp-marcel",
      confidence: "exact_contact_email",
    });
  });

  it("works with Phase C off when deterministic relationship evidence is present", () => {
    const decision = decideOpportunityRelationshipMatch({
      facts: facts({
        phaseCEnabled: false,
        contactEmail: "mary.new@example.com",
        contactPhone: "2505550100",
      }),
      candidates: [candidate()],
    });

    expect(decision).toMatchObject({
      action: "link",
      opportunityId: "opp-active",
      confidence: "exact_phone",
    });
  });
});
