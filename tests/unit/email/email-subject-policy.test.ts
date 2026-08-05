import { describe, expect, it } from "vitest";
import {
  normalizeReplySubject,
  chooseNewThreadSubject,
  fillSubjectTemplate,
  isReplyLikeSubject,
  normalizeLearnedSubjectExamples,
  contextualNewThreadSubject,
  learnedNewThreadSubjectFromPreferences,
  subjectDraftRequestFields,
} from "@/lib/email/email-subject-policy";
import type { LearnedSubjectContext } from "@/lib/email/email-subject-policy";

describe("email subject policy", () => {
  it("preserves reply threading while collapsing repeated case-insensitive prefixes", () => {
    expect(normalizeReplySubject("Deck estimate")).toBe("Re: Deck estimate");
    expect(normalizeReplySubject("re: Deck estimate")).toBe(
      "Re: Deck estimate"
    );
    expect(normalizeReplySubject("RE: re: Deck estimate")).toBe(
      "Re: Deck estimate"
    );
  });

  it("does not treat a forwarded or new-thread subject as a reply", () => {
    expect(isReplyLikeSubject("Re: Deck estimate")).toBe(true);
    expect(isReplyLikeSubject("RE[2]: Deck estimate")).toBe(true);
    expect(isReplyLikeSubject("Fwd: Deck estimate")).toBe(false);
    expect(isReplyLikeSubject("Deck estimate")).toBe(false);
  });

  it("keeps operator input ahead of configured, generated, learned, and fallback subjects", () => {
    expect(
      chooseNewThreadSubject({
        operatorSubject: "  Site visit for 18 Cedar  ",
        configuredSubject: "Following up",
        generatedSubject: "Deck project next steps",
        learnedSubject: "Your deck project",
        fallback: "Your inquiry",
      })
    ).toEqual({ subject: "Site visit for 18 Cedar", source: "operator" });
  });

  it("uses a safely materialized learned pattern before generic contextual generation", () => {
    expect(
      chooseNewThreadSubject({
        learnedSubject: "Jordan Lee deck quote",
        generatedSubject: "Re: Deck project next steps",
        fallback: "Your inquiry",
      })
    ).toEqual({
      subject: "Jordan Lee deck quote",
      source: "learned",
    });
  });

  it("never reuses another lead's learned exact subject as a new lead's subject", () => {
    expect(
      chooseNewThreadSubject({
        fallback: "Your inquiry",
      })
    ).toEqual({ subject: "Your inquiry", source: "fallback" });
  });

  it("accepts only bounded non-reply sent examples for new-thread learning", () => {
    expect(
      normalizeLearnedSubjectExamples([
        "  Deck project next steps ",
        "deck project next steps",
        "Re: Existing thread",
        "Fwd: Existing thread",
        "",
        "A".repeat(201),
        "Site visit availability",
      ])
    ).toEqual(["Deck project next steps", "Site visit availability"]);
  });

  it("derives a bounded contextual subject from the opportunity before the instruction", () => {
    expect(
      contextualNewThreadSubject({
        opportunityTitle: "18 Cedar deck replacement",
        userInstruction: "Ask when they are available for a site visit",
      })
    ).toBe("18 Cedar deck replacement");

    expect(
      contextualNewThreadSubject({
        userInstruction: "ask when they are available for a site visit.",
      })
    ).toBe("Ask when they are available for a site visit");
  });

  it("instantiates the first qualifying preferred pattern from current lead context", () => {
    expect(
      learnedNewThreadSubjectFromPreferences(
        {
          preferred_patterns: [
            {
              pattern: "{contact} deck quote",
              count: 5,
              examples: ["{contact} deck quote"],
              last_promoted_at: "2026-07-14T00:00:00.000Z",
            },
          ],
        },
        { contact: "Jordan Lee" }
      )
    ).toBe("Jordan Lee deck quote");
  });

  it("fails closed on weak, reply, forward, unknown, and unresolved learned patterns", () => {
    expect(
      learnedNewThreadSubjectFromPreferences(
        {
          preferred_patterns: [
            { pattern: "{contact} estimate", count: 2 },
            { pattern: "Re: {contact} estimate", count: 10 },
            { pattern: "Fwd: {contact} estimate", count: 10 },
            { pattern: "{client} estimate", count: 10 },
            { pattern: "{company} estimate", count: 10 },
          ],
        },
        { contact: "Jordan Lee" }
      )
    ).toBeNull();
  });

  it("supports every recognized token only when backed by current lead context", () => {
    expect(
      learnedNewThreadSubjectFromPreferences(
        {
          preferred_patterns: [
            {
              pattern:
                "{contact} | {company} | {address} | {project} | {email} | {number}",
              count: 3,
            },
          ],
        },
        {
          contact: "Jordan Lee",
          company: "North Shore Decks",
          address: "18 Cedar Road",
          project: "Deck replacement",
          email: "jordan@example.com",
          number: "OPP-1042",
        }
      )
    ).toBe(
      "Jordan Lee | North Shore Decks | 18 Cedar Road | Deck replacement | jordan@example.com | OPP-1042"
    );
  });

  it("fills the operator's own subject template from this lead", () => {
    expect(
      fillSubjectTemplate("Canpro Deck and Rail Estimate - {address}", {
        address: "2394 Tanner Ridge Place",
      })
    ).toBe("Canpro Deck and Rail Estimate - 2394 Tanner Ridge Place");
  });

  it("takes the dangling separator with an unfillable token", () => {
    expect(
      fillSubjectTemplate("Canpro Deck and Rail Estimate - {address}", {
        address: null,
      })
    ).toBe("Canpro Deck and Rail Estimate");
  });

  it("removes the separator after a token when there is none before it", () => {
    expect(
      fillSubjectTemplate("{address} — Canpro Deck and Rail Estimate", {})
    ).toBe("Canpro Deck and Rail Estimate");
    expect(
      fillSubjectTemplate("{address} — Canpro Deck and Rail Estimate", {
        address: "2394 Tanner Ridge Place",
      })
    ).toBe("2394 Tanner Ridge Place — Canpro Deck and Rail Estimate");
  });

  it("maps the operator-facing name token onto the lead's contact", () => {
    expect(
      fillSubjectTemplate("{name}, your deck quote", { contact: "Sam Carter" })
    ).toBe("Sam Carter, your deck quote");
    expect(
      fillSubjectTemplate("{NAME}, your deck quote", { contact: "Sam Carter" })
    ).toBe("Sam Carter, your deck quote");
  });

  it("fills every exposed token and drops the ones this lead cannot answer", () => {
    expect(
      fillSubjectTemplate("{name} | {address} | {project} | {email}", {
        contact: "Sam Carter",
        address: "2210 Cedar Hill Rd",
        project: "Rear deck rebuild",
        email: "sam@example.com",
      })
    ).toBe(
      "Sam Carter | 2210 Cedar Hill Rd | Rear deck rebuild | sam@example.com"
    );

    expect(
      fillSubjectTemplate("{name} | {address} | {project} | {email}", {
        project: "Rear deck rebuild",
      })
    ).toBe("Rear deck rebuild");
  });

  it("treats an unrecognized token as unfillable rather than leaving it literal", () => {
    expect(
      fillSubjectTemplate("Estimate for {foo} - {address}", {
        address: "2210 Cedar Hill Rd",
      })
    ).toBe("Estimate for 2210 Cedar Hill Rd");
    expect(
      fillSubjectTemplate("Estimate - {company} - {number}", {
        company: "North Shore Decks",
        number: "OPP-1042",
      })
    ).toBe("Estimate");
  });

  it("returns a template with no tokens byte for byte", () => {
    const plain = "Thanks for  reaching out - Canpro Deck and Rail";
    expect(fillSubjectTemplate(plain, { contact: "Sam Carter" })).toBe(plain);
  });

  it("returns empty for a template this lead cannot fill at all", () => {
    expect(fillSubjectTemplate("{address}", {})).toBe("");
    expect(fillSubjectTemplate("{name} - {address}", {})).toBe("");
  });

  it("never lets a brace reach the subject line", () => {
    const templates = [
      "Canpro Deck and Rail Estimate - {address}",
      "{name} — {project} estimate",
      "{}",
      "{{name}}",
      "Estimate {address",
      "Estimate} {name} {",
      "{name}{address}{project}{email}",
      "{unknown} · {address} : {name}",
      "Estimate for {name}, {address}, {project}",
    ];
    const contexts: LearnedSubjectContext[] = [
      {},
      { contact: "Sam Carter" },
      { address: "2210 Cedar Hill Rd", project: "Rear deck rebuild" },
      {
        contact: "Sam Carter",
        company: "North Shore Decks",
        address: "2210 Cedar Hill Rd",
        project: "Rear deck rebuild",
        email: "sam@example.com",
        number: "OPP-1042",
      },
      { contact: "  ", address: null, project: undefined, email: "" },
      { address: "Suite {4} — 2210 Cedar Hill Rd" },
    ];

    for (const template of templates) {
      for (const context of contexts) {
        const filled = fillSubjectTemplate(template, context);
        expect(filled, `${template} :: ${JSON.stringify(context)}`).not.toMatch(
          /[{}]/
        );
      }
    }
  });

  it("keeps configured template subjects distinct from explicit operator typing", () => {
    expect(
      subjectDraftRequestFields("Appointment confirmation", "configured")
    ).toEqual({ configuredSubject: "Appointment confirmation" });
    expect(subjectDraftRequestFields("Move it to Tuesday", "operator")).toEqual(
      { subject: "Move it to Tuesday" }
    );
    expect(subjectDraftRequestFields("Generated subject", "generated")).toEqual(
      {}
    );
  });
});
