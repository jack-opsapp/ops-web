/**
 * Coverage for `stripMarkdownFences` — the boundary defense that removes
 * stray ```markdown ... ``` wrappers from LLM-generated draft output. The
 * old system prompt asked the model to "write in markdown format", which
 * the model interpreted as "wrap the entire body in a fenced code block".
 * Even though the prompt has been corrected, we strip defensively at the
 * boundary so a model regression cannot leak fences into the database,
 * the composer, or outbound email.
 */

import { describe, expect, it } from "vitest";

import { stripMarkdownFences } from "@/lib/api/services/ai-draft-service";

describe("stripMarkdownFences", () => {
  it("returns empty input unchanged", () => {
    expect(stripMarkdownFences("")).toBe("");
  });

  it("passes plain text through unchanged", () => {
    const draft = "Hi Barry,\n\nBooked. Thanks!\n\nWe'll see you Friday.";
    expect(stripMarkdownFences(draft)).toBe(draft);
  });

  it("strips a ```markdown fence wrapping the whole body — the bhyde4858 case", () => {
    const wrapped = "```markdown\nHi Barry,\n\nBooked. Thanks!\n\nWe'll see you Friday at 2:00 pm.\n\nThanks\n```";
    expect(stripMarkdownFences(wrapped)).toBe(
      "Hi Barry,\n\nBooked. Thanks!\n\nWe'll see you Friday at 2:00 pm.\n\nThanks",
    );
  });

  it("strips a bare ``` fence with no language tag", () => {
    const wrapped = "```\nHello there\n```";
    expect(stripMarkdownFences(wrapped)).toBe("Hello there");
  });

  it("strips fences with various language tags", () => {
    expect(stripMarkdownFences("```text\nHello\n```")).toBe("Hello");
    expect(stripMarkdownFences("```plain\nHello\n```")).toBe("Hello");
    expect(stripMarkdownFences("```email\nHello\n```")).toBe("Hello");
  });

  it("trims surrounding whitespace before and after stripping", () => {
    const wrapped = "  \n```markdown\nHello\n```\n  ";
    expect(stripMarkdownFences(wrapped)).toBe("Hello");
  });

  it("strips when only the leading fence is present", () => {
    expect(stripMarkdownFences("```markdown\nHello there")).toBe("Hello there");
  });

  it("strips when only the trailing fence is present", () => {
    expect(stripMarkdownFences("Hello there\n```")).toBe("Hello there");
  });

  it("preserves inline code blocks inside the body", () => {
    // Fences that aren't at the very start/end should survive — they're
    // legitimate inline code content the user may want to keep.
    const draft = "Hi,\n\nRun `npm test` or:\n```\nbun run dev\n```\nLet me know.";
    // Note: trailing fence anchor will match `\n```\nLet me know.`? No —
    // anchor is end-of-string after optional whitespace, so "Let me know."
    // after the trailing fence keeps the fence in place.
    expect(stripMarkdownFences(draft)).toBe(draft);
  });

  it("idempotent: stripping twice produces the same result", () => {
    const wrapped = "```markdown\nHi Barry,\n\nBooked.\n```";
    const once = stripMarkdownFences(wrapped);
    const twice = stripMarkdownFences(once);
    expect(once).toBe("Hi Barry,\n\nBooked.");
    expect(twice).toBe(once);
  });

  it("handles fences without a trailing newline before the closing tick", () => {
    expect(stripMarkdownFences("```markdown\nHello```")).toBe("Hello");
  });
});
