import { describe, expect, it } from "vitest";
import {
  buildLeadEnrichmentUpdates,
  getLeadEnrichmentSchemaGaps,
  leadEnrichmentFactsFromEmail,
} from "@/lib/email/lead-enrichment";
import type { NormalizedEmail } from "@/lib/api/services/email-provider";
import type { EmailConnection, SyncProfile } from "@/lib/types/email-connection";

function baseEmail(overrides: Partial<NormalizedEmail> = {}): NormalizedEmail {
  return {
    id: "provider-message-1",
    threadId: "provider-thread-1",
    from: "Canpro Deck and Rail <notifications@wix-forms.com>",
    fromName: "Canpro Deck and Rail",
    to: ["office@example-contractors.com"],
    cc: [],
    subject: "Contact Us got a new submission",
    snippet: "Submission summary",
    bodyText: "Submission summary",
    date: new Date("2026-05-26T17:00:00.000Z"),
    labelIds: ["INBOX"],
    isRead: false,
    hasAttachments: false,
    sizeEstimate: 512,
    ...overrides,
  };
}

function baseConnection(): EmailConnection {
  return {
    id: "connection-1",
    companyId: "company-1",
    provider: "gmail",
    type: "company",
    userId: null,
    email: "office@example-contractors.com",
    accessToken: "token",
    refreshToken: "refresh",
    expiresAt: new Date("2026-05-27T00:00:00.000Z"),
    historyId: "history-1",
    syncEnabled: true,
    lastSyncedAt: null,
    syncIntervalMinutes: 15,
    syncFilters: syncProfile,
    webhookSubscriptionId: null,
    webhookExpiresAt: null,
    opsLabelId: null,
    aiReviewEnabled: false,
    aiMemoryEnabled: false,
    status: "active",
    createdAt: new Date("2026-05-26T00:00:00.000Z"),
    updatedAt: new Date("2026-05-26T00:00:00.000Z"),
  };
}

const syncProfile: SyncProfile = {
  estimateSubjectPatterns: ["estimate"],
  companyDomains: ["example-contractors.com"],
  teamForwarders: ["office@example-contractors.com"],
  knownPlatformSenders: ["notifications@wix-forms.com"],
  formSubjectPatterns: ["got a new submission"],
  userEmailAddresses: ["office@example-contractors.com"],
  aiClassificationThreshold: 0.75,
};

describe("lead lifecycle enrichment decisions", () => {
  it("fills blank opportunity and client fields from contact-form facts", () => {
    const facts = leadEnrichmentFactsFromEmail({
      email: baseEmail(),
      direction: "inbound",
      connection: baseConnection(),
      profile: syncProfile,
      submitter: {
        name: "Marcel Mercier",
        email: "marcel.mercier@example.com",
        phone: "250 538 8340",
        message: "Replace two roof decks and inspect the guard rails.",
        address: "1220 Wharf Street, Victoria BC",
        company: "Mercier Holdings",
        estimatedValue: 18500,
      },
    });

    const updates = buildLeadEnrichmentUpdates({
      existingOpportunity: {
        contact_name: null,
        contact_email: null,
        contact_phone: null,
        address: null,
        estimated_value: null,
        detected_value: null,
        description: null,
        source: null,
        source_email_id: null,
      },
      existingClient: {
        name: "marcel.mercier@example.com",
        email: null,
        phone_number: null,
        address: null,
      },
      facts,
    });

    expect(updates.opportunity).toMatchObject({
      contact_name: "Marcel Mercier",
      contact_email: "marcel.mercier@example.com",
      contact_phone: "250 538 8340",
      address: "1220 Wharf Street, Victoria BC",
      estimated_value: 18500,
      detected_value: 18500,
      description: "Replace two roof decks and inspect the guard rails.",
      source: "email",
      source_email_id: "provider-thread-1",
    });
    expect(updates.client).toMatchObject({
      name: "Mercier Holdings",
      email: "marcel.mercier@example.com",
      phone_number: "250 538 8340",
      address: "1220 Wharf Street, Victoria BC",
    });
  });

  it("does not overwrite existing operator-entered opportunity or client values", () => {
    const facts = leadEnrichmentFactsFromEmail({
      email: baseEmail({
        from: "Kara Beach <kara.new@example.com>",
        fromName: "Kara Beach",
      }),
      direction: "inbound",
      connection: baseConnection(),
      profile: syncProfile,
    });

    const updates = buildLeadEnrichmentUpdates({
      existingOpportunity: {
        contact_name: "Kara Old",
        contact_email: "kara.old@example.com",
        contact_phone: "555-111-2222",
        address: "10 Existing Road",
        estimated_value: 42000,
        detected_value: 41000,
        description: "Operator-entered scope",
        source: "referral",
        source_email_id: "provider-thread-existing",
      },
      existingClient: {
        name: "Kara Beach Contracting",
        email: "kara.old@example.com",
        phone_number: "555-111-2222",
        address: "10 Existing Road",
      },
      facts,
    });

    expect(updates.opportunity).toEqual({});
    expect(updates.client).toEqual({});
  });

  it("does not treat platform sender identity as the customer email", () => {
    const facts = leadEnrichmentFactsFromEmail({
      email: baseEmail({
        from: "HomeStars <lead-notify@homestars.com>",
        fromName: "HomeStars",
        subject: "New lead from HomeStars",
      }),
      direction: "inbound",
      connection: baseConnection(),
      profile: syncProfile,
    });

    const updates = buildLeadEnrichmentUpdates({
      existingOpportunity: {
        contact_name: null,
        contact_email: null,
        contact_phone: null,
        address: null,
        estimated_value: null,
        detected_value: null,
        description: null,
        source: null,
        source_email_id: null,
      },
      existingClient: {
        name: null,
        email: null,
        phone_number: null,
        address: null,
      },
      facts,
    });

    expect(facts.contactEmail).toBeNull();
    expect(updates.opportunity.contact_email).toBeUndefined();
    expect(updates.client.email).toBeUndefined();
    expect(updates.opportunity.source_email_id).toBe("provider-thread-1");
  });

  it("keeps sent-folder safety-net enrichment on the external recipient", () => {
    const facts = leadEnrichmentFactsFromEmail({
      email: baseEmail({
        from: "Operator <office@example-contractors.com>",
        fromName: "Operator",
        to: ["Kara Beach <kara.beach@example.com>"],
        subject: "Deck estimate",
        labelIds: ["SENT"],
      }),
      direction: "outbound",
      connection: baseConnection(),
      profile: syncProfile,
    });

    expect(facts.contactName).toBe("Kara Beach");
    expect(facts.contactEmail).toBe("kara.beach@example.com");
    expect(facts.providerThreadId).toBe("provider-thread-1");
    expect(facts.providerMessageId).toBe("provider-message-1");
  });

  it("fills address and value from an ordinary inbound body (Tier A)", () => {
    const facts = leadEnrichmentFactsFromEmail({
      email: baseEmail({
        from: "Kara Beach <kara.beach@example.com>",
        fromName: "Kara Beach",
        subject: "Deck quote request",
        bodyText:
          "Hi, we'd like a quote on a new deck.\nProject Address: 1220 Wharf Street, Victoria BC V8W 1T8\nBudget: $18,500\nPhone: 250 538 8340",
        bodyTextClean:
          "Hi, we'd like a quote on a new deck.\nProject Address: 1220 Wharf Street, Victoria BC V8W 1T8\nBudget: $18,500\nPhone: 250 538 8340",
      }),
      direction: "inbound",
      connection: baseConnection(),
      profile: syncProfile,
    });

    expect(facts.address).toBe("1220 Wharf Street, Victoria BC V8W 1T8");
    expect(facts.estimatedValue).toBe(18500);
    expect(facts.contactPhone).toBe("250 538 8340");
    // Identity still comes from the safe header sender, not from_email.
    expect(facts.contactEmail).toBe("kara.beach@example.com");

    const updates = buildLeadEnrichmentUpdates({
      existingOpportunity: {
        contact_name: null,
        contact_email: null,
        contact_phone: null,
        address: null,
        estimated_value: null,
        detected_value: null,
        description: null,
        source: null,
        source_email_id: null,
      },
      facts,
    });
    expect(updates.opportunity).toMatchObject({
      address: "1220 Wharf Street, Victoria BC V8W 1T8",
      estimated_value: 18500,
      detected_value: 18500,
      contact_phone: "250 538 8340",
    });
  });

  it("does not extract facts when the inbound body has no clear signal", () => {
    const facts = leadEnrichmentFactsFromEmail({
      email: baseEmail({
        from: "Kara Beach <kara.beach@example.com>",
        fromName: "Kara Beach",
        bodyText:
          "Hi, I saw your work on a neighbour's place and would love a rough idea. Thanks!",
        bodyTextClean:
          "Hi, I saw your work on a neighbour's place and would love a rough idea. Thanks!",
      }),
      direction: "inbound",
      connection: baseConnection(),
      profile: syncProfile,
    });
    expect(facts.address).toBeNull();
    expect(facts.estimatedValue).toBeNull();
    expect(facts.contactPhone).toBeNull();
  });

  it("never overwrites an operator-set address with a body-extracted one", () => {
    const facts = leadEnrichmentFactsFromEmail({
      email: baseEmail({
        from: "Kara Beach <kara.beach@example.com>",
        fromName: "Kara Beach",
        bodyText: "New job at 99 Different Road, Sidney BC V8L 1A1 for $25,000.",
        bodyTextClean:
          "New job at 99 Different Road, Sidney BC V8L 1A1 for $25,000.",
      }),
      direction: "inbound",
      connection: baseConnection(),
      profile: syncProfile,
    });
    // The body did yield an address/value fact...
    expect(facts.address).toBeTruthy();
    expect(facts.estimatedValue).toBe(25000);

    // ...but the canonical gate discards it because the operator already set one.
    const updates = buildLeadEnrichmentUpdates({
      existingOpportunity: {
        contact_name: "Kara Beach",
        contact_email: "kara.beach@example.com",
        contact_phone: "555-111-2222",
        address: "10 Operator Entered Road",
        estimated_value: 42000,
        detected_value: 41000,
        description: "Operator scope",
        source: "referral",
        source_email_id: "existing-thread",
      },
      facts,
    });
    expect(updates.opportunity.address).toBeUndefined();
    expect(updates.opportunity.estimated_value).toBeUndefined();
  });

  it("ignores the company's own from_email even when the body carries facts", () => {
    // Inbound email whose header sender is the company's own connection address
    // (e.g. a forwarded form). safeCustomerEmail must reject it as identity, but
    // the body facts (address/value) must still be extracted.
    const facts = leadEnrichmentFactsFromEmail({
      email: baseEmail({
        from: "Operator <office@example-contractors.com>",
        fromName: "Operator",
        bodyText:
          "Forwarded inquiry.\nProject Address: 1220 Wharf Street, Victoria BC V8W 1T8\nBudget: $18,500",
        bodyTextClean:
          "Forwarded inquiry.\nProject Address: 1220 Wharf Street, Victoria BC V8W 1T8\nBudget: $18,500",
      }),
      direction: "inbound",
      connection: baseConnection(),
      profile: syncProfile,
    });
    // from_email is the company's own — never promoted to customer identity.
    expect(facts.contactEmail).toBeNull();
    expect(facts.contactName).toBeNull();
    // But non-identity body facts are still extracted.
    expect(facts.address).toBe("1220 Wharf Street, Victoria BC V8W 1T8");
    expect(facts.estimatedValue).toBe(18500);
  });

  it("documents schema gaps instead of inventing hidden provenance storage", () => {
    expect(getLeadEnrichmentSchemaGaps()).toEqual(
      expect.arrayContaining([
        expect.stringContaining("company_name"),
        expect.stringContaining("field-level provenance"),
        expect.stringContaining("source platform"),
        expect.stringContaining("provider message id"),
      ])
    );
  });
});
