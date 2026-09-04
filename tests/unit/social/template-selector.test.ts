import type { SocialSubmission } from "@/lib/social/contract";
import {
  SOCIAL_SELECTOR_VERSION,
  selectSocialTemplate,
  type RecentSocialPost,
} from "@/lib/social/template-selector";

function submission(overrides: Partial<SocialSubmission> = {}): SocialSubmission {
  const base: SocialSubmission = {
    contract_version: "2026-09-01",
    source: { type: "blog", id: "blog-1", url: "https://opsapp.ca/blog/blog-1" },
    content: {
      title: "Stop answering the same crew question",
      hook: "The answer already exists. Your crew just cannot find it.",
      angle: "Turn repeated coordination into one shared operating plan.",
      caption: "Every repeated answer costs attention. Put the plan where the crew works.",
      alt_text: "A field note about repeated crew questions.",
      slides: [
        {
          headline: "Stop answering the same crew question",
          body: "Put the plan where the crew works.",
          image_url: "https://cdn.opsapp.ca/job-site.jpg",
        },
      ],
    },
  };

  return {
    ...base,
    ...overrides,
    source: { ...base.source, ...overrides.source },
    content: { ...base.content, ...overrides.content },
    preferences: overrides.preferences,
  };
}

describe("programmed social template cycle", () => {
  it("uses editorial cover for a short image-backed blog title", () => {
    const result = selectSocialTemplate({
      submission: submission({ content: { title: "The margin leak", slides: [submission().content.slides[0]], hook: submission().content.hook, angle: submission().content.angle, caption: submission().content.caption, alt_text: submission().content.alt_text } }),
      recentPosts: [],
      idempotencyKey: "blog-margin-leak",
    });

    expect(result.visualTreatment).toBe("editorial_cover");
    expect(result.storyType).toBe("blog_signal");
    expect(result.postFormat).toBe("single");
  });

  it("uses split signal for a medium image-backed blog title", () => {
    const result = selectSocialTemplate({
      submission: submission({
        content: {
          ...submission().content,
          title: "Why good crews still lose two hours every week to repeated coordination",
        },
      }),
      recentPosts: [],
      idempotencyKey: "medium-title",
    });

    expect(result.visualTreatment).toBe("split_signal");
  });

  it("uses operator brief for a long blog title without requiring an image", () => {
    const longTitle = "The operating habit that keeps a growing crew from turning every job-site decision into another call to the owner";
    const result = selectSocialTemplate({
      submission: submission({
        content: {
          ...submission().content,
          title: longTitle,
          slides: [{ headline: longTitle, body: "One shared plan removes the repeat call." }],
        },
      }),
      recentPosts: [],
      idempotencyKey: "long-title",
    });

    expect(result.visualTreatment).toBe("operator_brief");
    expect(result.scoreBreakdown.fit).toBeGreaterThan(0);
  });

  it("excludes every image-required treatment when no image exists", () => {
    const result = selectSocialTemplate({
      submission: submission({
        content: {
          ...submission().content,
          slides: [{ headline: "One plan. Fewer calls.", body: "Give the crew one source of truth." }],
        },
      }),
      recentPosts: [],
      idempotencyKey: "text-only",
    });

    expect(["operator_brief", "signal_grid"]).toContain(result.visualTreatment);
    expect(result.considered.find((item) => item.treatment === "editorial_cover")?.compatible).toBe(false);
  });

  it("uses pure graphic treatments for text-led protocols and roast cards", () => {
    const protocol = selectSocialTemplate({
      submission: submission({
        source: { type: "insight", id: "protocol-1" },
        content: {
          ...submission().content,
          slides: [{ headline: "The Friday close", body: "Three moves before the trucks leave." }],
        },
      }),
      recentPosts: [],
      idempotencyKey: "protocol",
    });
    const roast = selectSocialTemplate({
      submission: submission({
        source: { type: "roast", id: "roast-1" },
        content: {
          ...submission().content,
          slides: [{ headline: "The human group chat", body: "Knows every update. Writes down none." }],
        },
      }),
      recentPosts: [],
      idempotencyKey: "roast",
    });

    expect(protocol.visualTreatment).toBe("signal_grid");
    expect(roast.visualTreatment).toBe("roast_file");
  });

  it("derives carousel format from two-to-ten slides", () => {
    const first = submission().content.slides[0];
    const result = selectSocialTemplate({
      submission: submission({
        content: { ...submission().content, slides: [first, { ...first, headline: "The fix" }] },
      }),
      recentPosts: [],
      idempotencyKey: "carousel",
    });

    expect(result.postFormat).toBe("carousel");
  });

  it("penalizes the last two treatments and rebalances an image-heavy run", () => {
    const recentPosts: RecentSocialPost[] = [
      { visualTreatment: "editorial_cover", postFormat: "single" },
      { visualTreatment: "split_signal", postFormat: "single" },
      { visualTreatment: "field_frame", postFormat: "single" },
      { visualTreatment: "editorial_cover", postFormat: "carousel" },
    ];
    const result = selectSocialTemplate({
      submission: submission({
        content: {
          ...submission().content,
          title: "A crew plan that survives the job site",
        },
      }),
      recentPosts,
      idempotencyKey: "rebalance",
    });

    expect(["operator_brief", "signal_grid"]).toContain(result.visualTreatment);
    expect(result.scoreBreakdown.cadence).toBeGreaterThan(0);
  });

  it("records why an incompatible agent treatment preference was overridden", () => {
    const result = selectSocialTemplate({
      submission: submission({
        content: {
          ...submission().content,
          slides: [{ headline: "The protocol", body: "Close the loop before Friday." }],
        },
        preferences: { visual_treatment: "editorial_cover" },
      }),
      recentPosts: [],
      idempotencyKey: "incompatible-preference",
    });

    expect(result.preferenceDisposition).toBe("overridden");
    expect(result.preferenceReasons.join(" ")).toMatch(/image/i);
  });

  it("is stable for the same payload, history, and idempotency key", () => {
    const input = {
      submission: submission(),
      recentPosts: [] as RecentSocialPost[],
      idempotencyKey: "stable-seed",
    };

    expect(selectSocialTemplate(input)).toEqual(selectSocialTemplate(input));
    expect(selectSocialTemplate(input).selectorVersion).toBe(SOCIAL_SELECTOR_VERSION);
  });
});
