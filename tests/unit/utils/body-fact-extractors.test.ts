import { describe, expect, it } from "vitest";
import {
  extractAddressFromBody,
  extractEstimatedValueFromBody,
  extractPhoneFromBody,
} from "@/lib/utils/body-fact-extractors";

describe("body-fact-extractors — address", () => {
  it("extracts a labelled address line", () => {
    const body = [
      "Hi there, we'd like a quote.",
      "Project Address: 1220 Wharf Street, Victoria BC V8W 1T8",
      "Thanks",
    ].join("\n");
    expect(extractAddressFromBody(body)).toBe(
      "1220 Wharf Street, Victoria BC V8W 1T8"
    );
  });

  it("extracts a bare street-number + street-suffix line", () => {
    const body = "Please come by\n47B Maple Avenue\nwhenever you can.";
    expect(extractAddressFromBody(body)).toBe("47B Maple Avenue");
  });

  it("extracts a line containing a Canadian postal code", () => {
    const body = "Site is at 88 Birch Cres, Nanaimo BC V9R 6N2.";
    expect(extractAddressFromBody(body)).toContain("V9R 6N2");
  });

  it("extracts only the address phrase from a conversational sentence", () => {
    const body =
      "I should be able to make Thursday work - if you are able to give an approximate time that would be great. We are at 541 Prince Robert Lane in View Royal.";
    expect(extractAddressFromBody(body)).toBe("541 Prince Robert Lane in View Royal");
  });

  it("stops a short accepted-reply address before thanks text and phone numbers", () => {
    const body = "Sounds Great! 4204 Springridge Cres. Thanks . 250 216 6119 Cell";
    expect(extractAddressFromBody(body)).toBe("4204 Springridge Cres");
  });

  it("does not treat project measurements as an address", () => {
    const body =
      "For a resurface on a deck your size (~16x14, about 224 sq ft):";
    expect(extractAddressFromBody(body)).toBeNull();
  });

  it("returns null when no address signal is present (no false positive)", () => {
    const body =
      "Hi, I saw your work on a neighbour's roof and would love a quote. Call me anytime.";
    expect(extractAddressFromBody(body)).toBeNull();
  });

  it("does not treat a bare 5-digit number as a US address", () => {
    const body = "Your invoice number is 48217 and is now overdue.";
    expect(extractAddressFromBody(body)).toBeNull();
  });

  it("ignores 'Location: remote' and URLs / emails on a label line", () => {
    expect(extractAddressFromBody("Location: remote")).toBeNull();
    expect(
      extractAddressFromBody("Address: https://maps.app/xyz")
    ).toBeNull();
    expect(extractAddressFromBody("Address: me@example.com")).toBeNull();
  });

  it("rejects a labelled value that is numeric but not address-shaped", () => {
    expect(
      extractAddressFromBody(
        "Address: For a resurface on a deck your size (~16x14, about 224 sq ft):"
      )
    ).toBeNull();
  });

  it("does not harvest an address from an unsubscribe footer", () => {
    const body = [
      "Hi, hope you're well.",
      "Unsubscribe | 100 King Street West, Toronto ON M5X 1A9",
    ].join("\n");
    expect(extractAddressFromBody(body)).toBeNull();
  });

  it("does not harvest the sender's own registered-office footer", () => {
    const body = [
      "Thanks for reaching out.",
      "Registered office: 450 Industrial Way, Calgary AB T2P 1J9",
      "All rights reserved.",
    ].join("\n");
    expect(extractAddressFromBody(body)).toBeNull();
  });

  it("still honors an explicit address label even on a busy line", () => {
    // An explicit "Site address:" is stated intent — we trust it over the
    // footer heuristic.
    const body = "Site address: 12 Birch Lane, Duncan BC V9L 2P3";
    expect(extractAddressFromBody(body)).toBe("12 Birch Lane, Duncan BC V9L 2P3");
  });

  it("returns null for empty input", () => {
    expect(extractAddressFromBody(null)).toBeNull();
    expect(extractAddressFromBody("")).toBeNull();
  });
});

describe("body-fact-extractors — estimated value", () => {
  it("extracts a currency-prefixed figure", () => {
    expect(extractEstimatedValueFromBody("Quote is $12,500 all in.")).toBe(
      12500
    );
  });

  it("extracts a k-suffixed labelled budget", () => {
    expect(extractEstimatedValueFromBody("Budget: 12k for the deck")).toBe(
      12000
    );
  });

  it("extracts a CAD-prefixed figure when job context is present", () => {
    expect(
      extractEstimatedValueFromBody("Quote for the job: CAD 9800 incl tax")
    ).toBe(9800);
  });

  it("returns null for a bare number with no currency or label (no false positive)", () => {
    expect(
      extractEstimatedValueFromBody("We have 3 decks and 2 rails to do.")
    ).toBeNull();
  });

  it("returns null for a date or phone-shaped number", () => {
    expect(extractEstimatedValueFromBody("Call me on 250 538 8340")).toBeNull();
    expect(extractEstimatedValueFromBody("Meeting on 2026-06-01")).toBeNull();
  });

  it("rejects a marketing dollar figure with no job/quote context", () => {
    expect(extractEstimatedValueFromBody("Save up to $5,000 this spring!")).toBeNull();
  });

  it("rejects a receipt-style 'order total' figure", () => {
    expect(
      extractEstimatedValueFromBody("Thanks for your purchase. Order total: $1,299.")
    ).toBeNull();
  });

  it("rejects a sub-$100 fee/line-item figure even with context", () => {
    expect(
      extractEstimatedValueFromBody("Your quote includes a $0.50 service fee.")
    ).toBeNull();
  });

  it("extracts a large but in-range job value", () => {
    expect(
      extractEstimatedValueFromBody("Project budget: $2,500,000 for the build.")
    ).toBe(2_500_000);
  });

  it("returns null for empty input", () => {
    expect(extractEstimatedValueFromBody(null)).toBeNull();
  });
});

describe("body-fact-extractors — phone", () => {
  it("extracts a labelled phone number", () => {
    expect(extractPhoneFromBody("Phone: 250 538 8340")).toBe("250 538 8340");
  });

  it("extracts a parenthesized phone token", () => {
    expect(extractPhoneFromBody("Reach me at (604) 555-1234.")).toBe(
      "(604) 555-1234"
    );
  });

  it("skips excluded internal phone numbers from signatures", () => {
    const body = "Thanks,\nJackson\n250 538 8994";
    expect(
      extractPhoneFromBody(body, { excludedPhones: ["(250) 538-8994"] })
    ).toBeNull();
  });

  it("keeps the client's labelled phone when an internal signature phone is also present", () => {
    const body = [
      "Sounds Great! 4204 Springridge Cres.",
      "250 216 6119 Cell",
      "",
      "Thanks,",
      "Jackson",
      "250 538 8994",
    ].join("\n");
    expect(
      extractPhoneFromBody(body, { excludedPhones: ["250-538-8994"] })
    ).toBe("250 216 6119");
  });

  it("returns null when no 10-15 digit token is present (no false positive)", () => {
    expect(extractPhoneFromBody("I have 3 dogs and 2 cats.")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(extractPhoneFromBody(null)).toBeNull();
  });
});
