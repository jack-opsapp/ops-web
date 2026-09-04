import { describe, expect, it } from "vitest";
import {
  SOCIAL_VOICE_REFERENCE_VERSION,
  validateSocialVoice,
} from "@/lib/social/voice-profile";

const baseContent = {
  title: "The two-hour leak in your week",
  hook: "Your crew is waiting on answers you already gave once.",
  angle: "Show the cost of repeated coordination in a growing trades business.",
  caption:
    "The leak is not the work. It is every answer trapped in a text thread. Put the plan where the crew can see it.",
  cta: "Read the full field note at the link in bio.",
  alt_text: "A field note about repeated crew coordination.",
  slides: [
    {
      headline: "The two-hour leak in your week",
      body: "Every repeated answer costs attention, time, and margin.",
    },
  ],
};

describe("OPS social voice guardrails", () => {
  it("exports a stable reference version for audit records", () => {
    expect(SOCIAL_VOICE_REFERENCE_VERSION).toBe("ops-social-parr-2026-09-01");
  });

  it("accepts concrete OPS copy without rewriting it", () => {
    expect(validateSocialVoice(baseContent)).toEqual({ ok: true, issues: [] });
  });

  it.each(["leverage", "seamless", "best-in-class", "optimize"])(
    "rejects banned marketing language: %s",
    (term) => {
      const result = validateSocialVoice({
        ...baseContent,
        caption: `Use OPS to ${term} your operational ecosystem.`,
      });

      expect(result.ok).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "content.caption",
            code: "banned_language",
          }),
        ])
      );
    }
  );

  it("rejects contractor in public-facing social copy", () => {
    const result = validateSocialVoice({
      ...baseContent,
      title: "The contractor operating system",
    });

    expect(result.ok).toBe(false);
    expect(result.issues[0]).toMatchObject({
      path: "content.title",
      code: "audience_language",
    });
  });

  it("rejects emoji and more than five hashtags", () => {
    const result = validateSocialVoice({
      ...baseContent,
      caption:
        "Get control back. 🚀 #trades #crew #jobs #field #operations #business",
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["emoji", "hashtag_limit"])
    );
  });

  it("names the exact nested slide field that failed", () => {
    const result = validateSocialVoice({
      ...baseContent,
      slides: [
        {
          ...baseContent.slides[0],
          body: "A revolutionary platform for crews.",
        },
      ],
    });

    expect(result.issues).toEqual([
      expect.objectContaining({
        path: "content.slides.0.body",
        code: "banned_language",
      }),
    ]);
  });
});
