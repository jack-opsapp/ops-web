import { describe, expect, it } from "vitest";
import {
  normalizeReplySubject,
  chooseNewThreadSubject,
  isReplyLikeSubject,
  normalizeLearnedSubjectExamples,
  contextualNewThreadSubject,
  learnedNewThreadSubjectFromPreferences,
  subjectDraftRequestFields,
} from "@/lib/email/email-subject-policy";

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
