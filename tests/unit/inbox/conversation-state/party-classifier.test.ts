import { describe, it, expect } from "vitest";

import { classifyParty } from "@/lib/api/services/conversation-state/party-classifier";
import type { OperatorIdentity } from "@/lib/api/services/conversation-state/types";

/**
 * Build an OperatorIdentity fixture. The pure classifier only reads `emails`
 * and `domains`; the other fields exist for the wider ConversationState.
 */
function operator(
  overrides: Partial<{
    emails: string[];
    domains: string[];
    companyName: string | null;
  }> = {}
): OperatorIdentity {
  return {
    emails: new Set((overrides.emails ?? ["jack@canpro.ca"]).map((e) => e.toLowerCase())),
    domains: new Set((overrides.domains ?? ["canpro.ca"]).map((d) => d.toLowerCase())),
    phones: new Set<string>(),
    addresses: new Set<string>(),
    companyName: overrides.companyName ?? "Canpro",
  };
}

describe("classifyParty", () => {
  describe("automated / no-reply senders (regression: Google Business review notification)", () => {
    // Real senders from the Canpro mailbox that the legacy exact-match
    // SYSTEM_LOCAL_PARTS missed because "noreply" was only a SUFFIX of the local
    // part — so they were treated as customers and got auto-drafted replies to a
    // robot. The fix must classify them as NOT a meaningful customer message, so
    // they never reach the drafter.
    it.each([
      "businessprofile-noreply@google.com",
      "ads-account-noreply@google.com",
      "calendar-noreply@google.com",
      "googleone-noreply@google.com",
      "no-reply@notifications.example.com",
      "do-not-reply@stripe.com",
    ])("treats %s as automated — not a meaningful customer message", (fromEmail) => {
      const result = classifyParty(
        {
          fromEmail,
          toEmails: ["jack@canpro.ca"],
          subject: "Your listing",
          body: "Go to reviews and respond to customers today.",
        },
        operator()
      );
      expect(result.direction).toBe("inbound");
      expect(result.partyRole).not.toBe("customer");
      expect(result.isMeaningful).toBe(false);
    });

    it("does NOT over-match a real customer on a public domain (no 'noreply' in the local part)", () => {
      const result = classifyParty(
        {
          fromEmail: "homeowner@gmail.com",
          toEmails: ["jack@canpro.ca"],
          subject: "Deck quote?",
          body: "Hi, can you quote a cedar deck?",
        },
        operator()
      );
      expect(result.direction).toBe("inbound");
      expect(result.partyRole).toBe("customer");
      expect(result.isMeaningful).toBe(true);
    });
  });

  describe("operator's own outbound mail", () => {
    it("classifies a message FROM the operator's own email as operator/outbound", () => {
      const result = classifyParty(
        {
          fromEmail: "jack@canpro.ca",
          toEmails: ["homeowner@gmail.com"],
          subject: "Re: fence quote",
          body: "Here is your quote for the cedar fence.",
        },
        operator()
      );

      expect(result.direction).toBe("outbound");
      expect(result.partyRole).toBe("operator");
      expect(result.isMeaningful).toBe(true);
    });

    it("classifies a message from an address on the operator DOMAIN as operator/outbound", () => {
      // A teammate (not the connection owner) on the company domain.
      const result = classifyParty(
        {
          fromEmail: "estimator@canpro.ca",
          toEmails: ["homeowner@gmail.com"],
          subject: "Re: fence quote",
          body: "Following up on the quote.",
        },
        operator({ emails: ["jack@canpro.ca"], domains: ["canpro.ca"] })
      );

      expect(result.direction).toBe("outbound");
      expect(result.partyRole).toBe("operator");
    });

    it("matches the operator email case-insensitively and with display-name wrappers", () => {
      const result = classifyParty(
        {
          fromEmail: "Jack Canpro <JACK@Canpro.CA>",
          toEmails: ["homeowner@gmail.com"],
          subject: "quote",
          body: "Here you go.",
        },
        operator()
      );

      expect(result.direction).toBe("outbound");
      expect(result.partyRole).toBe("operator");
    });
  });

  describe("customer inbound mail", () => {
    it("classifies a gmail sender as customer/inbound and meaningful", () => {
      const result = classifyParty(
        {
          fromEmail: "homeowner@gmail.com",
          toEmails: ["jack@canpro.ca"],
          subject: "Need a fence quote",
          body: "Hi, I'd like a quote for a 40ft cedar fence.",
        },
        operator()
      );

      expect(result.direction).toBe("inbound");
      expect(result.partyRole).toBe("customer");
      expect(result.isMeaningful).toBe(true);
    });

    it("does NOT treat a public-domain customer as operator even when the operator also uses gmail", () => {
      // Operator's connected mailbox is a gmail address; the customer is a
      // DIFFERENT gmail address. The substring/domain heuristic would have
      // mislabeled the customer as operator. Identity-set matching must not.
      const op = operator({
        emails: ["jacksfences@gmail.com"],
        domains: [], // public domain intentionally NOT added to operator domains
      });

      const result = classifyParty(
        {
          fromEmail: "homeowner@gmail.com",
          toEmails: ["jacksfences@gmail.com"],
          subject: "fence",
          body: "Looking for a quote.",
        },
        op
      );

      expect(result.direction).toBe("inbound");
      expect(result.partyRole).toBe("customer");
    });
  });

  describe("all-employees internal thread", () => {
    it("classifies a message where every participant resolves to the operator as internal", () => {
      const op = operator({
        emails: ["jack@canpro.ca", "estimator@canpro.ca", "office@canpro.ca"],
        domains: ["canpro.ca"],
      });

      const result = classifyParty(
        {
          fromEmail: "estimator@canpro.ca",
          toEmails: ["jack@canpro.ca", "office@canpro.ca"],
          ccEmails: [],
          subject: "Schedule for Tuesday",
          body: "Can we move the Smith job to the afternoon?",
        },
        op
      );

      expect(result.partyRole).toBe("internal");
      expect(result.isMeaningful).toBe(false);
    });

    it("treats a domain-only internal thread (no explicit emails) as internal", () => {
      const op = operator({ emails: [], domains: ["canpro.ca"] });

      const result = classifyParty(
        {
          fromEmail: "estimator@canpro.ca",
          toEmails: ["jack@canpro.ca"],
          subject: "lunch",
          body: "grabbing lunch, back at 1",
        },
        op
      );

      expect(result.partyRole).toBe("internal");
    });
  });

  describe("platform / system senders", () => {
    it("classifies a known platform sender (Wix form) as system, not customer", () => {
      const result = classifyParty(
        {
          fromEmail: "no-reply@wix.com",
          toEmails: ["jack@canpro.ca"],
          subject: "You got a new submission",
          body: "Name: Bob\nEmail: bob@gmail.com",
        },
        operator()
      );

      expect(result.partyRole).toBe("system");
      expect(result.isMeaningful).toBe(false);
    });

    it("classifies a mailer-daemon bounce as system / not meaningful", () => {
      const result = classifyParty(
        {
          fromEmail: "mailer-daemon@googlemail.com",
          toEmails: ["jack@canpro.ca"],
          subject: "Delivery Status Notification (Failure)",
          body: "Your message could not be delivered.",
        },
        operator()
      );

      expect(result.partyRole).toBe("system");
      expect(result.isMeaningful).toBe(false);
    });
  });

  describe("noise filtering on customer inbound", () => {
    it("flags a marketing/promotional inbound as not meaningful", () => {
      const result = classifyParty(
        {
          fromEmail: "deals@somestore.com",
          toEmails: ["jack@canpro.ca"],
          subject: "Limited time offer — 50% discount, unsubscribe anytime",
          body: "Our biggest sale of the year.",
        },
        operator()
      );

      expect(result.isMeaningful).toBe(false);
    });
  });

  describe("degenerate input", () => {
    it("returns unknown / inbound / not-meaningful when fromEmail is blank", () => {
      const result = classifyParty(
        {
          fromEmail: "",
          toEmails: ["jack@canpro.ca"],
          subject: "",
          body: "",
        },
        operator()
      );

      expect(result.partyRole).toBe("unknown");
      expect(result.isMeaningful).toBe(false);
    });
  });
});
