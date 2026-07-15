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
        subject: "Free Quote form got a new submission",
        bodyText:
          "Name: Sandra Dunford\nEmail: sandra@example.com\nMessage: Quote",
      }),
      { provider: "gmail", connectionId: "connection-1" }
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
        bodyText:
          "Name: Sandra Dunford\nEmail: sandra@example.com\nMessage: Quote",
        subject: "Free Quote form got a new submission",
      })
    );
    const second = buildLeadRoutingIdentity(
      email({
        id: "message-brad",
        bodyText: "Name: Brad King\nEmail: brad@example.com\nMessage: Quote",
        subject: "Free Quote form got a new submission",
      })
    );

    expect(first.isContactFormSubmission).toBe(true);
    expect(second.isContactFormSubmission).toBe(true);
    expect(first.sourceKey).not.toBe(second.sourceKey);
    expect(first.providerThreadId).toBe("thread-shared");
    expect(second.providerThreadId).toBe("thread-shared");
    expect(first.mayInheritProviderThread).toBe(false);
    expect(second.mayInheritProviderThread).toBe(false);
  });

  it("keeps ordinary correspondence keyed and inherited by the raw provider thread", () => {
    expect(buildLeadRoutingIdentity(email())).toMatchObject({
      sourceKey: "thread-shared",
      providerThreadId: "thread-shared",
      providerMessageId: "message-1",
      isContactFormSubmission: false,
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
      mayInheritProviderThread: true,
    });
  });
});
