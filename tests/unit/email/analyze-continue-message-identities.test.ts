import { describe, expect, it } from "vitest";
import { replaceAnalyzedLeadEmailsFromFetch } from "@/lib/types/email-import";
import type { NormalizedEmail } from "@/lib/api/services/email-provider";
import type { AnalyzedLead } from "@/lib/types/email-import";

function fetchedMessage(
  id: string,
  date: string,
  direction: "inbound" | "outbound"
): NormalizedEmail {
  return {
    id,
    threadId: "provider-thread-1",
    from:
      direction === "inbound"
        ? "Kara Beach <kara@example.com>"
        : "Jackson Sweet <jackson@canprodeckandrail.com>",
    fromName: direction === "inbound" ? "Kara Beach" : "Jackson Sweet",
    to:
      direction === "inbound"
        ? ["jackson@canprodeckandrail.com"]
        : ["kara@example.com"],
    cc: [],
    subject:
      direction === "inbound" ? "Estimate request" : "Re: Estimate request",
    bodyText: "",
    snippet: "",
    date: new Date(date),
    isRead: true,
    hasAttachments: false,
    sizeEstimate: 0,
    labelIds: [],
  };
}

describe("analyze-continue exact provider identities", () => {
  it("replaces the initial scan subset with every successfully fetched message", () => {
    const lead = {
      emails: [
        {
          id: "message-2",
          providerThreadId: "provider-thread-1",
          from: "jackson@canprodeckandrail.com",
          subject: "Re: Estimate request",
          date: "2026-05-21T18:00:00.000Z",
          direction: "outbound",
        },
      ],
    } as Pick<AnalyzedLead, "emails">;
    const fetchedMessages = [
      fetchedMessage("message-1", "2026-05-20T17:00:00.000Z", "inbound"),
      fetchedMessage("message-2", "2026-05-21T18:00:00.000Z", "outbound"),
    ];

    replaceAnalyzedLeadEmailsFromFetch(lead, fetchedMessages, (message) =>
      message.id === "message-1" ? "inbound" : "outbound"
    );

    expect(lead.emails).toEqual([
      {
        id: "message-1",
        providerThreadId: "provider-thread-1",
        from: "Kara Beach <kara@example.com>",
        subject: "Estimate request",
        date: "2026-05-20T17:00:00.000Z",
        direction: "inbound",
      },
      {
        id: "message-2",
        providerThreadId: "provider-thread-1",
        from: "Jackson Sweet <jackson@canprodeckandrail.com>",
        subject: "Re: Estimate request",
        date: "2026-05-21T18:00:00.000Z",
        direction: "outbound",
      },
    ]);
  });
});
