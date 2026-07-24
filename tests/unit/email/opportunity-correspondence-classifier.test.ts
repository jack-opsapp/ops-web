import { describe, expect, it } from "vitest";
import { classifyOpportunityCorrespondence } from "@/lib/email/opportunity-correspondence-classifier";

const baseInput = {
  direction: "inbound" as const,
  providerThreadId: "thread-1",
  providerMessageId: "msg-1",
  fromEmail: "kara.beach@example.com",
  fromName: "Kara Beach",
  toEmails: ["jackson@canprodeckandrail.com"],
  ccEmails: [],
  subject: "Deck quote",
  bodyText: "Can you quote the deck repair?",
  connectionEmail: "jackson@canprodeckandrail.com",
  companyDomains: ["canprodeckandrail.com"],
  userEmailAddresses: ["jackson@canprodeckandrail.com"],
  knownPlatformSenders: ["notifications@wix-forms.com"],
  existingProviderMessageIds: [],
};

describe("opportunity correspondence classifier", () => {
  it("classifies customer inbound as meaningful correspondence", () => {
    expect(classifyOpportunityCorrespondence(baseInput)).toMatchObject({
      direction: "inbound",
      partyRole: "customer",
      isMeaningful: true,
      noiseReason: null,
    });
  });

  it("classifies OPS outbound to a customer as meaningful correspondence", () => {
    expect(
      classifyOpportunityCorrespondence({
        ...baseInput,
        direction: "outbound",
        fromEmail: "jackson@canprodeckandrail.com",
        toEmails: ["Kara Beach <kara.beach@example.com>"],
      })
    ).toMatchObject({
      direction: "outbound",
      partyRole: "ops",
      isMeaningful: true,
      noiseReason: null,
    });
  });

  it("preserves contact-form submitter identity instead of platform sender identity", () => {
    expect(
      classifyOpportunityCorrespondence({
        ...baseInput,
        fromEmail: "notifications@wix-forms.com",
        fromName: "Wix Forms",
        submitterEmail: "marcel.mercier@example.com",
        subject: "Contact Us 3 got a new submission",
        bodyText: [
          "Submission summary",
          "Name: Marcel Mercier",
          "Email: marcel.mercier@example.com",
          "Message: Can you quote my deck repair?",
        ].join("\n"),
      })
    ).toMatchObject({
      partyRole: "customer",
      isMeaningful: true,
      customerEmail: "marcel.mercier@example.com",
      noiseReason: null,
    });
  });

  it("does not promote provider platform inbound to customer because the opportunity has a contact email", () => {
    expect(
      classifyOpportunityCorrespondence({
        ...baseInput,
        fromEmail: "notifications@wix-forms.com",
        fromName: "Wix Forms",
        subject: "Contact Us 3 got a new submission",
        contactEmail: "real.customer@example.net",
      })
    ).toMatchObject({
      partyRole: "provider",
      isMeaningful: false,
      noiseReason: "provider_noise",
      customerEmail: null,
    });
  });

  it("excludes provider platform noise when there is no parsed submitter", () => {
    expect(
      classifyOpportunityCorrespondence({
        ...baseInput,
        fromEmail: "notifications@wix-forms.com",
        fromName: "Wix Forms",
        subject: "Contact Us 3 got a new submission",
      })
    ).toMatchObject({
      partyRole: "provider",
      isMeaningful: false,
      noiseReason: "provider_noise",
    });
  });

  it("classifies recruiting relay traffic as non-sales provider noise", () => {
    expect(
      classifyOpportunityCorrespondence({
        ...baseInput,
        fromEmail: "candidate-7f42@indeedemail.com",
        subject: "New application for Deck Installer",
        bodyText:
          "A candidate applied to your job. View the application in your employer dashboard.",
      })
    ).toMatchObject({
      partyRole: "provider",
      isMeaningful: false,
      noiseReason: "provider_noise",
      customerEmail: null,
    });
  });

  it("classifies exact Indeed application-updates traffic as provider noise", () => {
    expect(
      classifyOpportunityCorrespondence({
        ...baseInput,
        fromEmail: "conversation-candidate-7f42@indeedemail.com",
        subject: "Application update",
        bodyText:
          "Ask the person who posted the job or your account admin to remove you from these application updates.",
      })
    ).toMatchObject({
      partyRole: "provider",
      isMeaningful: false,
      noiseReason: "provider_noise",
      customerEmail: null,
    });
  });

  it("classifies an OPS reply to an Indeed relay as provider noise", () => {
    expect(
      classifyOpportunityCorrespondence({
        ...baseInput,
        direction: "outbound",
        fromEmail: "jackson@canprodeckandrail.com",
        toEmails: ["conversation-candidate-7f42@indeedemail.com"],
        subject: "Re: Vinyl installer application",
        bodyText: "Feel free to call if anything changes.",
      })
    ).toMatchObject({
      direction: "outbound",
      partyRole: "provider",
      isMeaningful: false,
      noiseReason: "provider_noise",
      customerEmail: null,
    });
  });

  it("does not suppress a genuine project inquiry merely because it uses the word application", () => {
    expect(
      classifyOpportunityCorrespondence({
        ...baseInput,
        fromEmail: "owner@example.net",
        subject: "Waterproofing question",
        bodyText:
          "Can you quote the application of a new waterproof deck coating?",
      })
    ).toMatchObject({
      partyRole: "customer",
      isMeaningful: true,
      noiseReason: null,
      customerEmail: "owner@example.net",
    });
  });

  it("excludes bounce messages", () => {
    expect(
      classifyOpportunityCorrespondence({
        ...baseInput,
        fromEmail: "mailer-daemon@googlemail.com",
        subject: "Delivery Status Notification (Failure)",
        bodyText: "Message not delivered.",
      })
    ).toMatchObject({
      partyRole: "system",
      isMeaningful: false,
      noiseReason: "bounce",
    });
  });

  it("excludes internal or system messages", () => {
    expect(
      classifyOpportunityCorrespondence({
        ...baseInput,
        fromEmail: "ops@canprodeckandrail.com",
        subject: "Internal note",
      })
    ).toMatchObject({
      partyRole: "internal",
      isMeaningful: false,
      noiseReason: "internal_system",
    });
  });

  it("excludes duplicate provider message ids", () => {
    expect(
      classifyOpportunityCorrespondence({
        ...baseInput,
        existingProviderMessageIds: ["msg-1"],
      })
    ).toMatchObject({
      partyRole: "unknown",
      isMeaningful: false,
      noiseReason: "duplicate_provider_message_id",
    });
  });

  it("excludes marketing and low-signal noise", () => {
    expect(
      classifyOpportunityCorrespondence({
        ...baseInput,
        fromEmail: "newsletter@vendor.example",
        subject: "May newsletter and promotions",
        threadCategory: "MARKETING",
        labels: ["CATEGORY_PROMOTIONS"],
      })
    ).toMatchObject({
      partyRole: "marketing",
      isMeaningful: false,
      noiseReason: "marketing_noise",
    });
  });
});
