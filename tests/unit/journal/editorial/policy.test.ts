import { describe, expect, it } from "vitest";
import {
  JournalDraftError,
  prepareJournalDraft,
} from "@/lib/journal/editorial/policy";
import {
  SOURCE_A,
  SOURCE_B,
  SOURCE_C,
  filler,
  policyContext as context,
  validCandidate as candidate,
} from "./fixtures";

function codeOf(raw: unknown, ctx = context) {
  try {
    prepareJournalDraft(raw, ctx);
    return "OK";
  } catch (error) {
    if (error instanceof JournalDraftError) return error.code;
    throw error;
  }
}

function withBody(mutate: (body: Array<Record<string, unknown>>) => void) {
  const base = candidate();
  const body = structuredClone(base.body) as Array<Record<string, unknown>>;
  mutate(body);
  return { ...base, body };
}

describe("prepareJournalDraft", () => {
  it("accepts a grounded, on-voice draft and renders the article itself", () => {
    const prepared = prepareJournalDraft(candidate(), context);
    expect(prepared.word_count).toBeGreaterThanOrEqual(1000);
    expect(prepared.word_count).toBeLessThanOrEqual(1400);
    expect(prepared.category_id).toBe("a252cd74-6982-4827-9dda-71bf829dc707");
    expect(prepared.internal_links).toHaveLength(8);
    expect(prepared.html).toContain("<strong>81% of homeowners</strong>");
    expect(prepared.html).toContain('<a href="/journal/word-of-mouth-isnt-a-marketing-plan">the referral leak</a>');
    expect(prepared.html).toMatch(/<h2>Sources<\/h2>\n<ul>\n<li><a href="https:\/\/www.example.gov\/survey\/2024">Homeowner survey 2024<\/a> · Example Agency<\/li>/);
    expect(prepared.html).not.toContain("unused.example.com");
    expect(prepared.citations.map((citation) => citation.role)).toEqual(["primary", "supporting"]);
    expect(prepared.article.email_content.startsWith("<p>")).toBe(true);
  });

  it("escapes anything that looks like markup and refuses raw HTML", () => {
    expect(codeOf(withBody((body) => (body[2].text = "<script>alert(1)</script> " + body[2].text)))).toBe("MARKUP_INVALID");
    expect(codeOf(withBody((body) => (body[2].text = "**unclosed bold " + body[2].text)))).toBe("MARKUP_INVALID");
    expect(codeOf({ ...candidate(), faqs: candidate().faqs.map((faq, index) => (index === 0 ? { ...faq, answer: `[a link](https://x.com) ${faq.answer}` } : faq)) })).toBe("MARKUP_INVALID");
  });

  it("enforces the title, meta title, category and topic rules", () => {
    expect(codeOf(candidate({ title: "The first call decides the whole week" }))).toBe("TITLE_FORMAT");
    expect(codeOf(candidate({ title: "FIRST CALL WINS" }))).toBe("TITLE_FORMAT");
    expect(codeOf(candidate({ meta_title: "Too short" }))).toBe("META_TITLE_LENGTH");
    expect(codeOf(candidate({ category: "gossip" }))).toBe("CATEGORY_INVALID");
    expect(codeOf(candidate({ topic: { backlog_topic_id: SOURCE_C, angle: "x" } }))).toBe("TOPIC_INVALID");
  });

  it("enforces the article structure", () => {
    expect(codeOf(withBody((body) => (body[0] = { type: "h2", text: "A heading first" })))).toBe("STRUCTURE");
    expect(codeOf(withBody((body) => body.pop()))).toBe("STRUCTURE");
    expect(codeOf(withBody((body) => (body[1].text = "WHAT THE FIRST CALL DECIDES")))).toBe("STRUCTURE");
    expect(codeOf(withBody((body) => (body[1].text = "What The First Call Decides")))).toBe("STRUCTURE");
    expect(codeOf(withBody((body) => (body[11].text = "Answer the phone.")))).toBe("STRUCTURE");
  });

  it("enforces length rules for the body, FAQs and email", () => {
    expect(codeOf(withBody((body) => body.splice(2, 1)))).toBe("WORD_COUNT");
    expect(codeOf(candidate({ faqs: candidate().faqs.slice(0, 5) }))).toBe("FAQ_COUNT");
    expect(codeOf(candidate({ faqs: candidate().faqs.map((faq) => ({ ...faq, answer: filler(20) })) }))).toBe("FAQ_LENGTH");
    expect(codeOf(candidate({ email_content: filler(40) }))).toBe("EMAIL_LENGTH");
  });

  it("rejects banned words, the audience word, shouting punctuation, emoji, hedges and an AI lead", () => {
    expect(codeOf(candidate({ subtitle: "A seamless way to answer every call." }))).toBe("VOICE_REJECTED");
    expect(codeOf(candidate({ subtitle: "Every contractor misses calls." }))).toBe("VOICE_REJECTED");
    expect(codeOf(candidate({ meta_title: "Contractor call response: who answers first wins the job" }))).toBe("VOICE_REJECTED");
    expect(codeOf(candidate({ teaser: "Answer the phone!" }))).toBe("VOICE_REJECTED");
    expect(codeOf(candidate({ teaser: "Answer the phone 📞" }))).toBe("VOICE_REJECTED");
    expect(codeOf(candidate({ teaser: "We believe speed wins." }))).toBe("VOICE_REJECTED");
    expect(codeOf(candidate({ title: "AI WILL ANSWER YOUR PHONE FOR YOU NOW" }))).toBe("VOICE_REJECTED");
    expect(codeOf(candidate({ subtitle: "Subcontractors know the drill." }))).toBe("OK");
  });

  it("rejects framing that goes stale", () => {
    expect(codeOf(candidate({ teaser: "Here is what changed this week for crews." }))).toBe("STALE_FRAMING");
    expect(codeOf(withBody((body) => (body[3].text = "Today the phone rings. " + body[3].text)))).toBe("STALE_FRAMING");
    expect(codeOf(withBody((body) => (body[3].text = "Spreadsheets start breaking down. " + body[3].text)))).toBe("OK");
  });

  it("refuses a taken slug and a near-duplicate of a recent title", () => {
    expect(codeOf(candidate({ slug: "word-of-mouth-isnt-a-marketing-plan" }))).toBe("SLUG_TAKEN");
    expect(codeOf(candidate({ slug: "stop-bleeding-tools" }))).toBe("SLUG_TAKEN");
    expect(codeOf(candidate({ title: "LIVE POST NUMBER 0 ABOUT SOMETHING ELSE ENTIRELY" }))).toBe("DUPLICATE_TOPIC");
  });

  it("requires citations OPS fetched, each backing evidence", () => {
    expect(codeOf(candidate({ citations: [{ source_id: SOURCE_A, role: "primary" }] }))).toBe("CITATION_INVALID");
    expect(codeOf(candidate({ citations: [...candidate().citations, { source_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", role: "supporting" }] }))).toBe("CITATION_INVALID");
    expect(codeOf(candidate({ citations: [...candidate().citations, { source_id: SOURCE_C, role: "supporting" }] }))).toBe("CITATION_INVALID");
  });

  it("verifies every evidence quote against the page OPS fetched", () => {
    const evidence = candidate().evidence;
    expect(codeOf(candidate({ evidence: [{ ...evidence[0], quote: "82% of homeowners said they read reviews before calling a business" }, evidence[1]] }))).toBe("EVIDENCE_INVALID");
    expect(codeOf(candidate({ evidence: [{ ...evidence[0], quote: "81%   of HOMEOWNERS said they read reviews before calling a business" }, evidence[1]] }))).toBe("OK");
    expect(codeOf(candidate({ evidence: [evidence[0], { ...evidence[1], source_id: SOURCE_A }] }))).toBe("CITATION_INVALID");
  });

  it("allows only live posts, industry pages and cited sources as links", () => {
    expect(codeOf(withBody((body) => (body[2].text += " [draft](/journal/stop-bleeding-tools)")))).toBe("LINK_REJECTED");
    expect(codeOf(withBody((body) => (body[2].text += " [nope](/industries/space-mining)")))).toBe("LINK_REJECTED");
    expect(codeOf(withBody((body) => (body[2].text += " [elsewhere](https://unused.example.com/page)")))).toBe("LINK_REJECTED");
    expect(codeOf(withBody((body) => (body[2].text += " [plain](http://www.example.gov/survey)")))).toBe("LINK_REJECTED");
    expect(codeOf(withBody((body) => (body[9].text = body[9].text.replace(/\[roofers\]\(\/industries\/roofing\)/, "roofers"))))).toBe("INTERNAL_LINKS");
  });

  it("requires every number to come from a cited source, the product facts or a worked example", () => {
    expect(codeOf(withBody((body) => (body[3].text = "Crews lose 12 hours a week. " + body[3].text)))).toBe("UNSUPPORTED_NUMBER");
    expect(codeOf(candidate({ worked_examples: [] }))).toBe("UNSUPPORTED_NUMBER");
    expect(codeOf(withBody((body) => (body[3].text = "We grew to $1.6M in four years. " + body[3].text)))).toBe("OK");
    expect(codeOf(candidate({ teaser: "999 widgets later, the phone still rings." }))).toBe("UNSUPPORTED_NUMBER");
    expect(codeOf(candidate({ worked_examples: ["A missed call costs you a job worth money."] }))).toBe("WORKED_EXAMPLE_INVALID");
    expect(codeOf(candidate({ worked_examples: ["A missed call costs you $4,000."] }))).toBe("WORKED_EXAMPLE_INVALID");
  });

  it("reports the exact paths to fix", () => {
    try {
      prepareJournalDraft(withBody((body) => (body[3].text = "Crews lose 12 hours. " + body[3].text)), context);
      throw new Error("expected a rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(JournalDraftError);
      expect((error as JournalDraftError).issues[0]).toEqual({
        path: "body.3",
        message: "12 is not in any cited source; cite it, mark a worked example, or cut it",
      });
    }
  });

  it("keeps SOURCE_B's unused sibling out of the rendered article", () => {
    const prepared = prepareJournalDraft(candidate(), context);
    expect(prepared.citations.map((citation) => citation.source_id)).toEqual([SOURCE_A, SOURCE_B]);
  });
});
