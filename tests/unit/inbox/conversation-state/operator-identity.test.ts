import { describe, it, expect } from "vitest";

import { buildOperatorIdentity } from "@/lib/api/services/conversation-state/operator-identity";
import type { BuildOperatorIdentityInput } from "@/lib/api/services/conversation-state/operator-identity";

// ─────────────────────────────────────────────────────────────────────────────
// operator-identity — PURE CORE
//
// Keystone fix: a gmail/outlook-based operator must still be recognized. Their
// EXACT addresses live in `emails` (so their own mail classifies as operator),
// while PUBLIC provider domains (gmail.com / outlook.com / …) are deliberately
// EXCLUDED from `domains`. Putting a public domain in `domains` would make every
// downstream consumer (party-classifier → operator/outbound; contact-resolver →
// operator-excluded) treat any customer who merely uses the same provider as the
// operator, silently dropping gmail customers. The wizard's
// identifyCompanyDomains also drops public domains, but it ALSO drops the
// operator's public-domain emails, collapsing the set entirely; this module
// keeps the emails and excludes only the public DOMAIN.
//
// These tests exercise the deterministic pure core with inline fixtures only —
// no DB, no Supabase, no mocks.
// ─────────────────────────────────────────────────────────────────────────────

function baseInput(
  overrides: Partial<BuildOperatorIdentityInput> = {}
): BuildOperatorIdentityInput {
  return {
    connectionEmail: "owner@gmail.com",
    companyUsers: [],
    company: {
      name: "Canpro Fencing",
      emailDomains: [],
      phones: [],
      addresses: [],
    },
    syncProfile: null,
    ...overrides,
  };
}

describe("buildOperatorIdentity — public-domain keystone fix", () => {
  it("keeps a @gmail.com operator's exact email but EXCLUDES the public domain from `domains`", () => {
    const identity = buildOperatorIdentity(baseInput());

    // The connection email is in the operator set (exact-match identity) …
    expect(identity.emails.has("owner@gmail.com")).toBe(true);
    expect(identity.emails.size).toBeGreaterThan(0);

    // … but its PUBLIC provider domain must NOT enter `domains`: matching by
    // "also uses gmail" would misclassify every gmail customer as the operator.
    expect(identity.domains.has("gmail.com")).toBe(false);
    // A pure-gmail operator has no private domain → an empty domain set is the
    // correct outcome (the operator's identity lives entirely in `emails`).
    expect(identity.domains.size).toBe(0);
  });

  it("excludes public provider domains from users while retaining custom domains", () => {
    const identity = buildOperatorIdentity(
      baseInput({
        connectionEmail: "owner@gmail.com",
        companyUsers: [
          { email: "crewlead@outlook.com" },
          { email: "office@canprofencing.com" },
        ],
      })
    );

    // Public provider domains are excluded from the matching set …
    expect(identity.domains.has("gmail.com")).toBe(false); // public — from connection
    expect(identity.domains.has("outlook.com")).toBe(false); // public — from a user
    // … but the operator's exact public-domain addresses are still recognized …
    expect(identity.emails.has("owner@gmail.com")).toBe(true);
    expect(identity.emails.has("crewlead@outlook.com")).toBe(true);
    // … and a real custom/company domain IS retained for teammate matching.
    expect(identity.domains.has("canprofencing.com")).toBe(true); // custom — from a user
  });
});

describe("buildOperatorIdentity — full union across all sources", () => {
  it("includes a secondary team-member email and the company phone + address", () => {
    const identity = buildOperatorIdentity(
      baseInput({
        connectionEmail: "owner@gmail.com",
        companyUsers: [
          { email: "owner@gmail.com", phone: "(604) 555-0101" },
          { email: "secondtech@gmail.com", phone: "604-555-0202" },
        ],
        company: {
          name: "Canpro Fencing",
          emailDomains: [],
          phones: ["+1 (604) 555-9000"],
          addresses: ["123 Industrial Way, Vancouver BC V6A 1A1"],
        },
      })
    );

    // Secondary team-member email present.
    expect(identity.emails.has("secondtech@gmail.com")).toBe(true);

    // Company phone present (normalized to digits, 10-digit form).
    expect(identity.phones.has("6045559000")).toBe(true);
    // User phones present too.
    expect(identity.phones.has("6045550101")).toBe(true);
    expect(identity.phones.has("6045550202")).toBe(true);

    // Company address present (normalized).
    expect(identity.addresses.size).toBeGreaterThan(0);
    expect(
      [...identity.addresses].some((a) => a.includes("123 industrial way"))
    ).toBe(true);

    expect(identity.companyName).toBe("Canpro Fencing");
  });

  it("unions optional SyncProfile arrays (emails / domains / platform senders)", () => {
    const identity = buildOperatorIdentity(
      baseInput({
        syncProfile: {
          userEmailAddresses: ["Forwarder@Canpro.com", "owner@gmail.com"],
          companyDomains: ["canpro.com"],
          knownPlatformSenders: ["leads@HomeStars.com"],
        },
      })
    );

    expect(identity.emails.has("forwarder@canpro.com")).toBe(true);
    expect(identity.emails.has("leads@homestars.com")).toBe(true);
    expect(identity.domains.has("canpro.com")).toBe(true);
    // platform sender domain is captured too
    expect(identity.domains.has("homestars.com")).toBe(true);
  });
});

describe("buildOperatorIdentity — normalization & hygiene", () => {
  it("lowercases + trims emails and dedupes across sources", () => {
    const identity = buildOperatorIdentity(
      baseInput({
        connectionEmail: "  Owner@Gmail.com ",
        companyUsers: [{ email: "OWNER@gmail.com" }],
      })
    );

    expect(identity.emails.has("owner@gmail.com")).toBe(true);
    // One canonical email despite three differently-cased inputs.
    expect(identity.emails.size).toBe(1);
  });

  it("normalizes phones to digit-only and strips a leading country code", () => {
    const identity = buildOperatorIdentity(
      baseInput({
        company: {
          name: "X",
          emailDomains: [],
          phones: ["1 (604) 555-9000", "604.555.9000"],
          addresses: [],
        },
      })
    );

    // Both inputs collapse to the same 10-digit canonical form.
    expect(identity.phones.has("6045559000")).toBe(true);
    expect(identity.phones.size).toBe(1);
  });

  it("drops invalid / too-short phones (dates, order numbers)", () => {
    const identity = buildOperatorIdentity(
      baseInput({
        company: {
          name: "X",
          emailDomains: [],
          phones: ["2026", "123", ""],
          addresses: [],
        },
        companyUsers: [{ email: "a@gmail.com", phone: "n/a" }],
      })
    );

    expect(identity.phones.size).toBe(0);
  });

  it("ignores blank / malformed emails without throwing", () => {
    const identity = buildOperatorIdentity(
      baseInput({
        connectionEmail: "",
        companyUsers: [{ email: "" }, { email: "not-an-email" }],
      })
    );

    expect(identity.emails.size).toBe(0);
    expect(identity.domains.size).toBe(0);
  });

  it("returns null companyName when the company has no name", () => {
    const identity = buildOperatorIdentity(
      baseInput({
        company: { name: null, emailDomains: [], phones: [], addresses: [] },
      })
    );

    expect(identity.companyName).toBeNull();
  });

  it("includes explicit company emailDomains (e.g. operator's MX domain) verbatim", () => {
    const identity = buildOperatorIdentity(
      baseInput({
        company: {
          name: "X",
          emailDomains: ["Mail.Canpro.com"],
          phones: [],
          addresses: [],
        },
      })
    );

    expect(identity.domains.has("mail.canpro.com")).toBe(true);
  });
});
