import { describe, expect, it } from "vitest";
import {
  sanitizeClientExtractionFacts,
  sanitizeExtractedClientName,
} from "@/lib/email/import-extraction-sanitizer";

describe("import-extraction-sanitizer", () => {
  it("repairs polluted AI contact facts from inbound message content", () => {
    const facts = sanitizeClientExtractionFacts(
      {
        name: "Canprojack",
        email: "canprojack@gmail.com",
        phone: "(250) 538-8994",
        address:
          "For a resurface on a deck your size (~16x14, about 224 sq ft):",
      },
      {
        clientEmail: "canprojack@gmail.com",
        internalPhones: ["250 538 8994"],
        messages: [
          {
            direction: "inbound",
            body: "Sounds Great! 4204 Springridge Cres. Thanks . 250 216 6119 Cell",
          },
        ],
      }
    );

    expect(facts.name).toBeNull();
    expect(facts.phone).toBe("250 216 6119");
    expect(facts.address).toBe("4204 Springridge Cres");
  });

  it("extracts an address phrase from a whole conversational AI address sentence", () => {
    const facts = sanitizeClientExtractionFacts(
      {
        name: "Erin Young",
        email: "erin@example.com",
        phone: null,
        address:
          "I should be able to make Thursday work - if you are able to give an approximate time that would be great. We are at 541 Prince Robert Lane in View Royal.",
      },
      {
        clientEmail: "erin@example.com",
        internalPhones: [],
        messages: [],
      }
    );

    expect(facts.address).toBe("541 Prince Robert Lane in View Royal");
  });

  it("does not use outbound/internal signature phones as customer phones", () => {
    const facts = sanitizeClientExtractionFacts(
      {
        name: "Liane Kern",
        email: "liane@example.com",
        phone: null,
        address: null,
      },
      {
        clientEmail: "liane@example.com",
        internalPhones: ["250 538 8994"],
        messages: [
          {
            direction: "outbound",
            body: "Thanks,\nJackson\n250 538 8994",
          },
        ],
      }
    );

    expect(facts.phone).toBeNull();
  });

  it("uses the newest inbound customer fact instead of an older signature phone in the thread", () => {
    const facts = sanitizeClientExtractionFacts(
      {
        name: "Erin Young",
        email: "erinky_1@hotmail.com",
        phone: null,
        address: null,
      },
      {
        clientEmail: "erinky_1@hotmail.com",
        internalPhones: [],
        messages: [
          {
            direction: "inbound",
            body: [
              "Thanks,",
              "Jared Jerome",
              "778-268-3324",
              "Canpro Deck and Rail",
              "",
              "Begin forwarded message:",
              "Phone Number:",
              "2502160516",
            ].join("\n"),
          },
          {
            direction: "inbound",
            body: "I should be able to make Thursday work. We are at 541 Prince Robert Lane in View Royal. 250.516.3282",
          },
        ],
      }
    );

    expect(facts.phone).toBe("250.516.3282");
    expect(facts.address).toBe("541 Prince Robert Lane in View Royal");
  });

  it("rejects internal names, emails, phones, and company addresses from AI facts", () => {
    const facts = sanitizeClientExtractionFacts(
      {
        name: "Jackson Sweet",
        email: "jackson@canpro.test",
        phone: "250 538 8994",
        address: "123 Canpro Yard Road, Victoria BC V8V 1A1",
      },
      {
        clientEmail: "liane@example.com",
        internalNames: ["Jackson Sweet"],
        internalEmails: ["jackson@canpro.test"],
        internalPhones: ["250 538 8994"],
        companyAddresses: ["123 Canpro Yard Road, Victoria BC V8V 1A1"],
        messages: [
          {
            direction: "inbound",
            body: "Sounds Great! 4204 Springridge Cres. Thanks . 250 216 6119 Cell",
          },
        ],
      }
    );

    expect(facts.name).toBeNull();
    expect(facts.phone).toBe("250 216 6119");
    expect(facts.address).toBe("4204 Springridge Cres");
  });

  it("rejects names copied from the email local part", () => {
    expect(
      sanitizeExtractedClientName("Canprojack", "canprojack@gmail.com")
    ).toBeNull();
    expect(sanitizeExtractedClientName("Liane Kern", "liane@example.com")).toBe(
      "Liane Kern"
    );
  });
});
