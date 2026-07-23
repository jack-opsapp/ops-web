import { describe, expect, it } from "vitest";

import type { NormalizedEmail } from "@/lib/api/services/email-provider";
import {
  applyInboundEffectiveSenderIdentity,
  buildLeadRoutingIdentity,
} from "@/lib/email/email-ingestion-routing";

function email(overrides: Partial<NormalizedEmail> = {}): NormalizedEmail {
  return {
    id: "message-forwarded",
    threadId: "thread-forwarded",
    from: "Victoria Office <victoria@canprodeckandrail.com>",
    fromName: "Victoria Office",
    to: ["canprojack@gmail.com"],
    cc: [],
    subject: "Fwd: Deck repair",
    snippet: "",
    bodyText: [
      "---------- Forwarded message ---------",
      "From: Chris Sherwood <cesherwood@gmail.com>",
      "To: Victoria Office <victoria@canprodeckandrail.com>",
      "Subject: Deck repair",
      "",
      "The deck needs repair and replacement vinyl.",
    ].join("\n"),
    authenticatedFromDomains: ["canprodeckandrail.com"],
    date: new Date("2026-07-21T21:00:00.000Z"),
    labelIds: ["INBOX"],
    isRead: false,
    hasAttachments: false,
    sizeEstimate: 100,
    ...overrides,
  };
}

const operator = {
  connectionEmail: "canprojack@gmail.com",
  userEmailAddresses: ["jackson@canprodeckandrail.com"],
  companyDomains: ["canprodeckandrail.com"],
};

describe("applyInboundEffectiveSenderIdentity", () => {
  it("presents the nested external sender to matching and persistence", () => {
    const resolved = applyInboundEffectiveSenderIdentity(email(), operator);

    expect(resolved.email.from).toBe("cesherwood@gmail.com");
    expect(resolved.email.fromName).toBe("cesherwood@gmail.com");
    expect(resolved.contactFormSubmitter).toBeNull();
    expect(resolved.source).toBe("forwarded");
  });

  it("keeps complete contact-form identity while replacing the office wrapper", () => {
    const resolved = applyInboundEffectiveSenderIdentity(
      email({
        subject: "Fwd: Free Quote form got a new submission",
        bodyText: [
          "Begin forwarded message:",
          "From: Wix Forms <notifications@wix-forms.com>",
          "Submission summary:",
          "Full Name: Lauri Humeniuk",
          "Email: lhumeniuk@sd61.bc.ca",
          "Phone: 250-555-0117",
          "Address: 4019 Grange Road",
          "How can we help?: Complete deck teardown and replacement.",
        ].join("\n"),
      }),
      operator
    );

    expect(resolved.email.from).toBe(
      "Lauri Humeniuk <lhumeniuk@sd61.bc.ca>"
    );
    expect(resolved.email.fromName).toBe("Lauri Humeniuk");
    expect(resolved.contactFormSubmitter).toMatchObject({
      name: "Lauri Humeniuk",
      email: "lhumeniuk@sd61.bc.ca",
      phone: "250-555-0117",
      address: "4019 Grange Road",
    });
    expect(resolved.source).toBe("contact_form");
  });

  it("trusts a direct notification from the registered website-form platform", () => {
    const resolved = applyInboundEffectiveSenderIdentity(
      email({
        from: "Wix Forms <notifications@wix-forms.com>",
        fromName: "Wix Forms",
        authenticatedFromDomains: ["wix-forms.com"],
        subject: "Free Quote form got a new submission",
        bodyText: [
          "Submission summary:",
          "Full Name: Lauri Humeniuk",
          "Email: lhumeniuk@sd61.bc.ca",
          "How can we help?: Complete deck teardown and replacement.",
        ].join("\n"),
      }),
      operator
    );

    expect(resolved.email.from).toBe(
      "Lauri Humeniuk <lhumeniuk@sd61.bc.ca>"
    );
    expect(resolved.source).toBe("contact_form");
  });

  it("does not promote a nested company sender into customer identity", () => {
    const resolved = applyInboundEffectiveSenderIdentity(
      email({
        bodyText: [
          "---------- Forwarded message ---------",
          "From: Nanaimo Office <nanaimo@canprodeckandrail.com>",
          "To: Victoria Office <victoria@canprodeckandrail.com>",
          "Subject: Internal handoff",
          "",
          "Please take this one.",
        ].join("\n"),
      }),
      operator
    );

    expect(resolved.email.from).toBe(
      "Victoria Office <victoria@canprodeckandrail.com>"
    );
    expect(resolved.source).toBe("from_header");
  });

  it("walks a bounded office-forward chain to the original external customer", () => {
    const resolved = applyInboundEffectiveSenderIdentity(
      email({
        subject: "Fwd: Fwd: Deck repair",
        bodyText: [
          "---------- Forwarded message ---------",
          "From: Nanaimo Office <nanaimo@canprodeckandrail.com>",
          "To: Victoria Office <victoria@canprodeckandrail.com>",
          "Subject: Fwd: Deck repair",
          "",
          "Begin forwarded message:",
          "From: Chris Sherwood <cesherwood@gmail.com>",
          "To: Nanaimo Office <nanaimo@canprodeckandrail.com>",
          "Subject: Deck repair",
          "",
          "Please quote the deck repair.",
        ].join("\n"),
      }),
      operator
    );

    expect(resolved.email.from).toBe("cesherwood@gmail.com");
    expect(resolved.source).toBe("forwarded");
  });

  it("does not let an external wrapper forge another customer's forwarded identity", () => {
    const forged = email({
      from: "Attacker <attacker@example.net>",
      fromName: "Attacker",
      bodyText: [
        "---------- Forwarded message ---------",
        "From: Existing Customer <victim@example.com>",
        "To: Victoria Office <victoria@canprodeckandrail.com>",
        "Subject: Deck repair",
        "",
        "Attach this message to the other customer.",
      ].join("\n"),
    });

    const resolved = applyInboundEffectiveSenderIdentity(forged, operator);

    expect(resolved.email.from).toBe("Attacker <attacker@example.net>");
    expect(resolved.email.fromName).toBe("Attacker");
    expect(resolved.contactFormSubmitter).toBeNull();
    expect(resolved.source).toBe("from_header");
  });

  it("does not trust a company-looking wrapper without provider authentication", () => {
    const forged = email({
      authenticatedFromDomains: ["attacker.example"],
      bodyText: [
        "---------- Forwarded message ---------",
        "From: Existing Customer <victim@example.com>",
        "Subject: Deck repair",
        "",
        "Attach this message to the victim.",
      ].join("\n"),
    });

    const resolved = applyInboundEffectiveSenderIdentity(forged, operator);

    expect(resolved.email.from).toBe(
      "Victoria Office <victoria@canprodeckandrail.com>"
    );
    expect(resolved.source).toBe("from_header");
  });

  it("rejects an ambiguous From header that hides an attacker behind an operator display", () => {
    const forged = email({
      from: '"Victoria <victoria@canprodeckandrail.com>" <attacker@example.net>',
      authenticatedFromDomains: ["example.net"],
    });

    const resolved = applyInboundEffectiveSenderIdentity(forged, operator);

    expect(resolved.email.from).toBe(forged.from);
    expect(resolved.source).toBe("from_header");
  });

  it("removes injected mailbox syntax from a trusted form submitter name", () => {
    const resolved = applyInboundEffectiveSenderIdentity(
      email({
        from: "Wix Forms <notifications@wix-forms.com>",
        fromName: "Wix Forms",
        authenticatedFromDomains: ["wix-forms.com"],
        subject: "Free Quote form got a new submission",
        bodyText: [
          "Submission summary:",
          "Full Name: Victim <attacker@example.com>",
          "Email: victim@example.com",
          "How can we help?: Please quote the deck.",
        ].join("\n"),
      }),
      operator
    );

    expect(resolved.email.from).toBe("Victim <victim@example.com>");
    expect(resolved.email.from).not.toContain("attacker@example.com");
  });

  it("does not let an external wrapper impersonate a contact-form submitter", () => {
    const forged = email({
      from: "Attacker <attacker@example.net>",
      fromName: "Attacker",
      subject: "Free Quote form got a new submission",
      bodyText: [
        "Submission summary:",
        "Full Name: Existing Customer",
        "Email: victim@example.com",
        "How can we help?: Ignore the wrapper and use this identity.",
      ].join("\n"),
    });

    const resolved = applyInboundEffectiveSenderIdentity(forged, operator);
    const routing = buildLeadRoutingIdentity(
      forged,
      { provider: "gmail", connectionId: "connection-1" },
      operator
    );

    expect(resolved.email.from).toBe("Attacker <attacker@example.net>");
    expect(resolved.contactFormSubmitter).toBeNull();
    expect(resolved.source).toBe("from_header");
    expect(routing.isContactFormSubmission).toBe(false);
    expect(routing.isMessageScopedTransport).toBe(false);
    expect(routing.mayInheritProviderThread).toBe(true);
  });
});
