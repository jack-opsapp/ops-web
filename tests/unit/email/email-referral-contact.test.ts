import { describe, expect, it } from "vitest";
import { resolveInboundReferralContact } from "@/lib/email/email-referral-contact";

const operator = { connectionEmail: "office@example.com" };
const intro =
  "Alex, I will leave Casey with you. They are looking to have the vinyl replaced on a small deck, with new railings.";
const source = {
  from: "Robin Builder <robin@example.net>",
  to: ["Casey Taylor <casey@example.net>", "Alex Morgan <office@example.com>"],
  cc: [],
  bodyText: `${intro}\n\nRobin Builder\n555-0100\n\nOn Monday Casey Taylor <casey@example.net> wrote:\n> Could you quote my deck?`,
};

describe("source-backed referral customer", () => {
  it("identifies the named referral recipient while preserving the actual author", () => {
    expect(resolveInboundReferralContact(source, operator)).toEqual({
      name: "Casey Taylor",
      email: "casey@example.net",
    });
    expect(source.from).toBe("Robin Builder <robin@example.net>");
  });
  it("supports a named introduction in the current body", () => {
    expect(
      resolveInboundReferralContact(
        {
          ...source,
          bodyText:
            "I'd like to introduce Casey to you. They need a quote for a new railing.",
        },
        operator
      )?.email
    ).toBe("casey@example.net");
  });
  it.each([
    [
      "ordinary copied customer",
      { bodyText: "Casey and I will send the photos on Monday." },
    ],
    [
      "quoted introduction",
      {
        bodyText: `Thanks for the update.\n\nOn Monday Robin wrote:\n> ${intro}`,
      },
    ],
    ["different named person", { bodyText: intro.replace("Casey", "Jordan") }],
    [
      "multiple named customers",
      { to: [...source.to, "Casey Stone <stone@example.net>"] },
    ],
    ["body-only address", { to: ["office@example.com"] }],
    [
      "negated introduction",
      { bodyText: "I will not introduce Casey to you. Please quote my deck." },
    ],
    [
      "conditional introduction",
      {
        bodyText:
          "If Casey approves, I will introduce Casey to you. Please quote my deck.",
      },
    ],
    [
      "conditional handoff",
      {
        bodyText:
          "If Casey approves, I will leave Casey with you. Please quote my deck.",
      },
    ],
    [
      "multiple people in a handoff",
      { bodyText: "I will leave Casey and Jordan with you." },
    ],
  ])("does not infer a referral from %s", (_label, override) => {
    expect(
      resolveInboundReferralContact({ ...source, ...override }, operator)
    ).toBeNull();
  });
});
