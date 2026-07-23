import { describe, expect, it } from "vitest";

import {
  buildLeadRoutingIdentity,
  canonicalizeProviderThreadId,
  resolvePersistedEmailDirection,
} from "@/lib/email/email-ingestion-routing";
import type { NormalizedEmail } from "@/lib/api/services/email-provider";

function email(overrides: Partial<NormalizedEmail> = {}): NormalizedEmail {
  return {
    id: "message-1",
    threadId: "thread-shared",
    from: "Customer Person <customer@example.com>",
    fromName: "Customer Person",
    to: ["canprojack@gmail.com"],
    cc: [],
    subject: "Deck estimate",
    snippet: "Can you quote this deck?",
    bodyText: "Can you quote this deck?",
    authenticatedFromDomains: ["canprodeckandrail.com"],
    date: new Date("2026-07-13T12:00:00.000Z"),
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

describe("resolvePersistedEmailDirection", () => {
  it("classifies the connected mailbox's own message as outbound even in the inbox bucket", () => {
    expect(
      resolvePersistedEmailDirection(
        email({
          from: "Canpro <canprojack@gmail.com>",
          fromName: "Canpro",
          labelIds: ["INBOX"],
        }),
        operator
      )
    ).toBe("outbound");
  });

  it("keeps a sent reply outbound when it quotes an earlier contact-form body", () => {
    expect(
      resolvePersistedEmailDirection(
        email({
          from: "Canpro <canprojack@gmail.com>",
          fromName: "Canpro",
          to: ["sandra@example.com"],
          subject: "Re: Free Quote form got a new submission",
          bodyText:
            "Thanks Sandra.\n\nName: Sandra Dunford\nEmail: sandra@example.com\nMessage: New deck quote please",
          labelIds: ["SENT"],
        }),
        operator
      )
    ).toBe("outbound");
  });

  it("classifies a company alias as outbound/internal", () => {
    expect(
      resolvePersistedEmailDirection(
        email({
          from: "Victoria <victoria@canprodeckandrail.com>",
          fromName: "Victoria",
        }),
        operator
      )
    ).toBe("outbound");
  });

  it("keeps a forwarded Wix form inbound after resolving the external submitter", () => {
    expect(
      resolvePersistedEmailDirection(
        email({
          from: "Jared <jared@canprodeckandrail.com>",
          fromName: "Jared",
          subject: "Fwd: Free Quote form got a new submission",
          bodyText: [
            "Name: Sandra Dunford",
            "Email: sandra@example.com",
            "Phone: 250-555-0199",
            "Message: New deck quote please",
          ].join("\n"),
        }),
        operator
      )
    ).toBe("inbound");
  });

  it("keeps a nested Victoria-to-Nanaimo-to-Jared Wix submission inbound", () => {
    expect(
      resolvePersistedEmailDirection(
        email({
          from: "Victoria Office <victoria@canprodeckandrail.com>",
          fromName: "Victoria Office",
          subject: "Fwd: Fwd: Free Quote form got a new submission",
          bodyText: [
            "---------- Forwarded message ---------",
            "From: Nanaimo Office <nanaimo@canprodeckandrail.com>",
            "To: Victoria Office <victoria@canprodeckandrail.com>",
            "Subject: Fwd: Free Quote form got a new submission",
            "",
            "Begin forwarded message:",
            "From: Jared Jerome <jared@canprodeckandrail.com>",
            "To: Nanaimo Office <nanaimo@canprodeckandrail.com>",
            "Subject: Free Quote form got a new submission",
            "",
            "Begin forwarded message:",
            "From: Canpro Deck and Rail <notifications@wix-forms.com>",
            'Reply-To: "Lauri Humeniuk" <lhumeniuk@sd61.bc.ca>',
            "Subject: Free Quote form got a new submission",
            "",
            "Submission summary:",
            "Full Name:",
            "Lauri Humeniuk",
            "Email:",
            "lhumeniuk@sd61.bc.ca",
            "Address:",
            "4019 Grange Road",
            "How can we help?:",
            "Complete deck teardown and replacement.",
          ].join("\n"),
          labelIds: ["INBOX"],
        }),
        operator
      )
    ).toBe("inbound");
  });

  it("uses a strict forwarded external sender before the internal office wrapper", () => {
    expect(
      resolvePersistedEmailDirection(
        email({
          from: "Victoria Office <victoria@canprodeckandrail.com>",
          fromName: "Victoria Office",
          subject: "Fwd: Deck repair at 10295 Sparling Place",
          bodyText: [
            "---------- Forwarded message ---------",
            "From: Chris Sherwood <cesherwood@gmail.com>",
            "Date: Mon, Jul 20, 2026 at 2:54 PM",
            "To: Victoria Office <victoria@canprodeckandrail.com>",
            "Subject: Deck repair at 10295 Sparling Place",
            "",
            "The deck needs repair and replacement vinyl.",
          ].join("\n"),
          labelIds: ["INBOX"],
        }),
        operator
      )
    ).toBe("inbound");
  });

  it("keeps a distinct external Gmail customer inbound", () => {
    expect(
      resolvePersistedEmailDirection(
        email({ from: "Leah <leah.customer@gmail.com>" }),
        operator
      )
    ).toBe("inbound");
  });
});

describe("buildLeadRoutingIdentity", () => {
  it("keeps a raw provider thread raw and scopes its routing key exactly once", () => {
    const scope = { provider: "gmail", connectionId: "connection-1" };

    expect(canonicalizeProviderThreadId(" thread-shared ", scope)).toBe(
      "thread-shared"
    );
    expect(buildLeadRoutingIdentity(email(), scope)).toMatchObject({
      sourceKey: "email:gmail:connection-1:thread:thread-shared",
      providerThreadId: "thread-shared",
    });
  });

  it("unwraps legacy already-scoped provider threads without nesting the routing key", () => {
    const scope = { provider: "gmail", connectionId: "connection-1" };
    const legacyScoped =
      "email:gmail:connection-1:thread:email:gmail:connection-1:thread:thread-shared";

    expect(canonicalizeProviderThreadId(legacyScoped, scope)).toBe(
      "thread-shared"
    );
    expect(
      buildLeadRoutingIdentity(email({ threadId: legacyScoped }), scope)
    ).toMatchObject({
      sourceKey: "email:gmail:connection-1:thread:thread-shared",
      providerThreadId: "thread-shared",
    });
  });

  it("namespaces provider identities by mailbox connection and routing kind", () => {
    const direct = buildLeadRoutingIdentity(email(), {
      provider: "gmail",
      connectionId: "connection-1",
    });
    const form = buildLeadRoutingIdentity(
      email({
        id: "message-sandra",
        from: "Wix Forms <notifications@wix-forms.com>",
        authenticatedFromDomains: ["wix-forms.com"],
        subject: "Free Quote form got a new submission",
        bodyText:
          "Name: Sandra Dunford\nEmail: sandra@example.com\nMessage: Quote",
      }),
      { provider: "gmail", connectionId: "connection-1" },
      operator
    );
    const otherMailbox = buildLeadRoutingIdentity(email(), {
      provider: "gmail",
      connectionId: "connection-2",
    });

    expect(direct.sourceKey).toBe(
      "email:gmail:connection-1:thread:thread-shared"
    );
    expect(form.sourceKey).toBe(
      "email:gmail:connection-1:message:message-sandra"
    );
    expect(otherMailbox.sourceKey).not.toBe(direct.sourceKey);
  });

  it("gives two Wix submitters in the same Gmail thread distinct message-scoped keys", () => {
    const first = buildLeadRoutingIdentity(
      email({
        id: "message-sandra",
        from: "Wix Forms <notifications@wix-forms.com>",
        authenticatedFromDomains: ["wix-forms.com"],
        bodyText:
          "Name: Sandra Dunford\nEmail: sandra@example.com\nMessage: Quote",
        subject: "Free Quote form got a new submission",
      }),
      undefined,
      operator
    );
    const second = buildLeadRoutingIdentity(
      email({
        id: "message-brad",
        from: "Wix Forms <notifications@wix-forms.com>",
        authenticatedFromDomains: ["wix-forms.com"],
        bodyText: "Name: Brad King\nEmail: brad@example.com\nMessage: Quote",
        subject: "Free Quote form got a new submission",
      }),
      undefined,
      operator
    );

    expect(first.isContactFormSubmission).toBe(true);
    expect(second.isContactFormSubmission).toBe(true);
    expect(first.sourceKey).not.toBe(second.sourceKey);
    expect(first.providerThreadId).toBe("thread-shared");
    expect(second.providerThreadId).toBe("thread-shared");
    expect(first.mayInheritProviderThread).toBe(false);
    expect(second.mayInheritProviderThread).toBe(false);
  });

  it("gives two trusted generic forwards in one provider thread distinct message-scoped keys", () => {
    const first = buildLeadRoutingIdentity(
      email({
        id: "message-chris",
        from: "Victoria Office <victoria@canprodeckandrail.com>",
        subject: "Fwd: Deck repair",
        bodyText: [
          "---------- Forwarded message ---------",
          "From: Chris Sherwood <chris@example.com>",
          "Subject: Deck repair",
          "",
          "Please quote the deck repair.",
        ].join("\n"),
      }),
      { provider: "gmail", connectionId: "connection-1" },
      operator
    );
    const second = buildLeadRoutingIdentity(
      email({
        id: "message-eleanor",
        from: "Victoria Office <victoria@canprodeckandrail.com>",
        subject: "Fwd: Railing quote",
        bodyText: [
          "---------- Forwarded message ---------",
          "From: Eleanor Smith <eleanor@example.com>",
          "Subject: Railing quote",
          "",
          "Please quote the new railing.",
        ].join("\n"),
      }),
      { provider: "gmail", connectionId: "connection-1" },
      operator
    );

    expect(first).toMatchObject({
      sourceKey: "email:gmail:connection-1:message:message-chris",
      isContactFormSubmission: false,
      isMessageScopedTransport: true,
      mayInheritProviderThread: false,
    });
    expect(second).toMatchObject({
      sourceKey: "email:gmail:connection-1:message:message-eleanor",
      isContactFormSubmission: false,
      isMessageScopedTransport: true,
      mayInheritProviderThread: false,
    });
    expect(first.sourceKey).not.toBe(second.sourceKey);
    expect(first.providerThreadId).toBe("thread-shared");
    expect(second.providerThreadId).toBe("thread-shared");
  });

  it("keeps ordinary correspondence keyed and inherited by the raw provider thread", () => {
    expect(buildLeadRoutingIdentity(email())).toMatchObject({
      sourceKey: "thread-shared",
      providerThreadId: "thread-shared",
      providerMessageId: "message-1",
      isContactFormSubmission: false,
      isMessageScopedTransport: false,
      mayInheritProviderThread: true,
    });
  });

  it("fails closed to ordinary thread routing when no operator trust context is supplied", () => {
    const routing = buildLeadRoutingIdentity(
      email({
        id: "message-untrusted-form",
        from: "Attacker <attacker@example.net>",
        subject: "Free Quote form got a new submission",
        bodyText:
          "Name: Victim Customer\nEmail: victim@example.com\nMessage: Quote",
      })
    );

    expect(routing).toMatchObject({
      sourceKey: "thread-shared",
      isContactFormSubmission: false,
      isMessageScopedTransport: false,
      mayInheritProviderThread: true,
    });
  });

  it("keeps a sent reply on raw-thread continuity even when it quotes a form", () => {
    expect(
      buildLeadRoutingIdentity(
        email({
          id: "message-reply",
          from: "Canpro <canprojack@gmail.com>",
          to: ["sandra@example.com"],
          subject: "Re: Free Quote form got a new submission",
          bodyText:
            "Thanks Sandra.\n\nName: Sandra Dunford\nEmail: sandra@example.com\nMessage: Quote",
          labelIds: ["SENT"],
        })
      )
    ).toMatchObject({
      sourceKey: "thread-shared",
      isContactFormSubmission: false,
      isMessageScopedTransport: false,
      mayInheritProviderThread: true,
    });
  });
});
