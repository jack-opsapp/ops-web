import { describe, expect, it } from "vitest";
import {
  buildContactFormRepairDecision,
  resolveSubmitterMatch,
  type ContactFormRepairClientRow,
  type ContactFormRepairOpportunityRow,
  type ContactFormRepairThreadRow,
  type SubmitterMatch,
} from "@/lib/inbox/contact-form-thread-repair";
import type { ContactFormSubmissionIdentity } from "@/lib/utils/email-parsing";

const companyId = "company-1";
const internalClient: ContactFormRepairClientRow = {
  id: "client-internal",
  company_id: companyId,
  name: "Office Victoria",
  email: "victoria@example-contractors.com",
};
const parsedClient: ContactFormRepairClientRow = {
  id: "client-marcel",
  company_id: companyId,
  name: "Marcel Mercier",
  email: "marcel@example.com",
};
const otherClient: ContactFormRepairClientRow = {
  id: "client-other",
  company_id: companyId,
  name: "Existing Customer",
  email: "customer@example.net",
};
const internalOpportunity: ContactFormRepairOpportunityRow = {
  id: "opp-internal",
  company_id: companyId,
  client_id: internalClient.id,
  title: "Office Victoria - Email Inquiry",
  stage: "new_lead",
};

function submitter(
  overrides: Partial<ContactFormSubmissionIdentity> = {}
): ContactFormSubmissionIdentity {
  return {
    name: "Marcel Mercier",
    email: "marcel@example.com",
    phone: "2505550100",
    message: "Deck quote request",
    ...overrides,
  };
}

function thread(
  overrides: Partial<ContactFormRepairThreadRow> = {}
): ContactFormRepairThreadRow {
  return {
    id: "thread-row-1",
    company_id: companyId,
    connection_id: "connection-1",
    provider_thread_id: "provider-thread-1",
    subject: "Fwd: Contact Us got a new submission",
    latest_sender_email: "notifications@wix-forms.com",
    latest_sender_name: "notifications@wix-forms.com",
    participants: [
      "notifications@wix-forms.com",
      "office@example-contractors.com",
    ],
    client_id: internalClient.id,
    opportunity_id: internalOpportunity.id,
    ...overrides,
  };
}

function exactClientMatch(): SubmitterMatch {
  return {
    action: "link_existing_client",
    confidence: "exact_client",
    clientId: parsedClient.id,
    clientName: parsedClient.name,
    reason: "Exact email match on client",
  };
}

describe("contact-form thread repair decisions", () => {
  it("relinks a stale internal client/opportunity to an exact parsed client", () => {
    const decision = buildContactFormRepairDecision({
      thread: thread(),
      submitter: submitter(),
      currentClient: internalClient,
      currentOpportunity: internalOpportunity,
      match: exactClientMatch(),
      internalEmails: new Set(["office@example-contractors.com"]),
      internalDomains: new Set(["example-contractors.com"]),
      existingOpenOpportunityForTarget: {
        id: "opp-marcel",
        company_id: companyId,
        client_id: parsedClient.id,
        title: "Marcel Mercier - Email Inquiry",
        stage: "new_lead",
      },
    });

    expect(decision.status).toBe("safe");
    expect(decision.proposed.clientAction).toBe("link_existing_client");
    expect(decision.proposed.targetClientId).toBe(parsedClient.id);
    expect(decision.proposed.opportunityAction).toBe("relink");
    expect(decision.proposed.targetOpportunityId).toBe("opp-marcel");
    expect(decision.proposed.latestSenderEmail).toBe("marcel@example.com");
    expect(decision.proposed.participants).toContain("marcel@example.com");
  });

  it("creates a new client only when there is no existing parsed match", () => {
    const match = resolveSubmitterMatch({
      submitter: submitter({ email: "new.customer@gmail.com" }),
      clients: [internalClient],
      subClients: [],
    });
    const decision = buildContactFormRepairDecision({
      thread: thread(),
      submitter: submitter({ email: "new.customer@gmail.com" }),
      currentClient: internalClient,
      currentOpportunity: internalOpportunity,
      match,
      internalEmails: new Set(["office@example-contractors.com"]),
      internalDomains: new Set(["example-contractors.com"]),
      existingOpenOpportunityForTarget: null,
    });

    expect(match.action).toBe("create_new_client");
    expect(decision.status).toBe("safe");
    expect(decision.proposed.clientAction).toBe("create_client");
    expect(decision.proposed.targetClientId).toBeNull();
    expect(decision.proposed.opportunityAction).toBe("relink");
  });

  it("sanitizes polluted parsed phone fields before proposed writes and warns", () => {
    const pollutedSubmitter = submitter({
      email: "new.customer@gmail.com",
      phone:
        "7786773812\nCity Location:\nsooke bc\nRailing / Vinyl or Full D:\nglass rail",
    });
    const match = resolveSubmitterMatch({
      submitter: pollutedSubmitter,
      clients: [internalClient],
      subClients: [],
    });
    const decision = buildContactFormRepairDecision({
      thread: thread(),
      submitter: pollutedSubmitter,
      currentClient: internalClient,
      currentOpportunity: internalOpportunity,
      match,
      internalEmails: new Set(["office@example-contractors.com"]),
      internalDomains: new Set(["example-contractors.com"]),
      existingOpenOpportunityForTarget: null,
    });

    expect(decision.status).toBe("safe");
    expect(decision.parsed.phone).toBe("7786773812");
    expect(decision.dataQualityWarnings).toContain(
      "Phone field sanitized before proposed write"
    );
  });

  it("does not create a duplicate when the parsed submitter already exists", () => {
    const match = resolveSubmitterMatch({
      submitter: submitter(),
      clients: [parsedClient],
      subClients: [],
    });

    expect(match).toMatchObject({
      action: "link_existing_client",
      confidence: "exact_client",
      clientId: parsedClient.id,
    });
  });

  it("leaves non-internal conflicting client links for manual review", () => {
    const decision = buildContactFormRepairDecision({
      thread: thread({
        latest_sender_email: "customer@example.net",
        client_id: otherClient.id,
        opportunity_id: null,
      }),
      submitter: submitter(),
      currentClient: otherClient,
      currentOpportunity: null,
      match: exactClientMatch(),
      internalEmails: new Set(["victoria@example-contractors.com"]),
      existingOpenOpportunityForTarget: null,
    });

    expect(decision.status).toBe("manual_review");
    expect(decision.reason).toContain("Existing non-internal client link");
    expect(decision.proposed.clientAction).toBe("manual_review");
  });

  it("refuses to turn internal parsed mailboxes into clients", () => {
    const internalSubmitter = submitter({
      email: "office@example-contractors.com",
      name: "Office",
    });
    const decision = buildContactFormRepairDecision({
      thread: thread({ client_id: null, opportunity_id: null }),
      submitter: internalSubmitter,
      currentClient: null,
      currentOpportunity: null,
      match: {
        action: "create_new_client",
        confidence: "unmatched",
        clientId: null,
        reason: "No existing client match",
      },
      internalEmails: new Set(["office@example-contractors.com"]),
      existingOpenOpportunityForTarget: null,
    });

    expect(decision.status).toBe("manual_review");
    expect(decision.reason).toContain("internal or platform mailbox");
    expect(decision.proposed.clientAction).toBe("manual_review");
  });

  it("flags multi-client domain matches for manual review", () => {
    const match = resolveSubmitterMatch({
      submitter: submitter({
        name: "Site Contact",
        email: "contact@builder.example",
      }),
      clients: [
        {
          id: "client-a",
          company_id: companyId,
          name: "Builder A",
          email: "lead@builder.example",
        },
        {
          id: "client-b",
          company_id: companyId,
          name: "Builder B",
          email: "admin@builder.example",
        },
      ],
      subClients: [],
    });

    expect(match).toMatchObject({
      action: "manual_review",
      confidence: "domain",
    });
  });
});
