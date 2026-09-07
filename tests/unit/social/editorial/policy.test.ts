import { storeSocialAsset } from "@/lib/social/asset-store";
import { selectSocialTemplate } from "@/lib/social/template-selector";
import { describe, expect, it } from "vitest";
import {
  getEditorialSlot,
  chooseSource,
  prepareSubmission,
  candidateSchema,
  editorialPreviewId,
} from "@/lib/social/editorial/policy";
const source = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "A better handoff",
  slug: "better-handoff",
  published_at: "2026-09-01T12:00:00Z",
  is_live: true,
  text: "Write the delivery address and material list before the crew leaves the shop.",
  thumbnail_url: null,
};
const candidate = {
  title: "Before the truck leaves",
  hook: "The address belongs on the job.",
  angle: "A clear handoff before departure",
  caption:
    "Write the delivery address and material list before the crew leaves the shop. Save this for your next handoff.",
  cta: "Save this for your next handoff.",
  alt_text: "A field note about preparing a crew handoff.",
  story_type: "operator_protocol",
  slides: [
    {
      headline: "Before the truck leaves",
      body: "Write the delivery address and material list.",
    },
  ],
  evidence: [
    {
      claim: "Write the delivery address and material list.",
      quote: source.text,
    },
  ],
};
describe("cloud editorial policy", () => {
  it.each([
    ["2026-09-07T16:59:00Z", null],
    ["2026-09-07T17:00:00Z", "2026-09-07"],
    ["2026-09-08T02:59:00Z", "2026-09-07"],
    ["2026-09-08T03:00:00Z", null],
    ["2026-09-05T17:00:00Z", null],
    ["2026-11-02T16:59:00Z", null],
    ["2026-11-02T17:00:00Z", "2026-11-02"],
  ])("uses Vancouver weekday and DST for %s", (date, want) =>
    expect(getEditorialSlot(new Date(date))?.date ?? null).toBe(want)
  );
  it("never selects unpublished, future, stale or already used sources", () => {
    const now = new Date("2026-09-07T18:00:00Z");
    expect(
      chooseSource(
        [
          { ...source, is_live: false },
          { ...source, published_at: "2026-09-08T00:00:00Z" },
          { ...source, published_at: "2025-01-01T00:00:00Z" },
        ],
        [],
        now,
        "blog"
      )
    ).toBeNull();
    expect(chooseSource([source], [source.id], now, "blog")).toBeNull();
    expect(chooseSource([source], [], now, "blog")?.id).toBe(source.id);
  });
  it("owns source identity and all links outside model output", () => {
    const result = prepareSubmission(candidate, source, [], "protocol");
    expect(result.source).toEqual({
      type: "blog",
      id: source.id,
      url: "https://opsapp.co/journal/better-handoff",
      published_at: "2026-09-01T12:00:00.000Z",
    });
    expect(result.preferences?.story_type).toBe("operator_protocol");
    expect(result.content.caption).toContain(
      "https://opsapp.co/journal/better-handoff"
    );
    expect(
      candidateSchema.safeParse({
        ...candidate,
        source: { url: "https://evil.example" },
      }).success
    ).toBe(false);
  });
  it("stores previews through the real asset ID validation boundary", async () => {
    const asset = await storeSocialAsset(
      {
        postId: editorialPreviewId("2026-09-07"),
        renderVersion: "preview",
        order: 1,
        buffer: Buffer.from("jpeg"),
        altText: "A preview",
        width: 1080,
        height: 1350,
      },
      {
        backend: "s3",
        putS3: async () => {},
        putSupabase: async () => {},
        publicS3Url: (key) => "https://cdn.test/" + key,
        publicSupabaseUrl: (key) => key,
      }
    );
    expect(asset.url).toContain("/preview/slide-01.jpg");
  });
  it("provides the source image to every carousel slide", () => {
    const result = prepareSubmission(
      { ...candidate, slides: [...candidate.slides, ...candidate.slides] },
      { ...source, thumbnail_url: "https://cdn.opsapp.co/image.jpg" },
      [],
      "protocol"
    );
    expect(result.media?.[0].url).toBe("https://cdn.opsapp.co/image.jpg");
  });
  it("bounds descriptions to the shared image submission limit", () => {
    expect(
      candidateSchema.safeParse({ ...candidate, alt_text: "a".repeat(501) })
        .success
    ).toBe(false);
    const result = prepareSubmission(
      { ...candidate, alt_text: "a".repeat(500) },
      { ...source, thumbnail_url: "https://cdn.opsapp.co/image.jpg" },
      [],
      "protocol"
    );
    expect(result.media?.[0].alt_text).toHaveLength(500);
  });
  it("rejects fabricated evidence and unsupported field imagery", () => {
    expect(() =>
      prepareSubmission(
        {
          ...candidate,
          evidence: [
            {
              claim: "Big result",
              quote: "Saved 40 hours every week for the whole crew",
            },
          ],
        },
        source,
        [],
        "protocol"
      )
    ).toThrow("EVIDENCE");
    expect(() =>
      prepareSubmission(
        { ...candidate, story_type: "field_dispatch" },
        source,
        [],
        "protocol"
      )
    ).toThrow("IMAGE");
  });
  it("rejects near-duplicate hooks and banned audience language", () => {
    expect(() =>
      prepareSubmission(
        candidate,
        source,
        ["The address belongs on the job"],
        "protocol"
      )
    ).toThrow("DUPLICATE");
    expect(() =>
      prepareSubmission(
        { ...candidate, title: "Tips for contractors" },
        source,
        [],
        "protocol"
      )
    ).toThrow("VOICE");
  });
  it("rejects external model links and unsupported quantified promises", () => {
    expect(() =>
      prepareSubmission(
        { ...candidate, caption: "Visit https://evil.example" },
        source,
        [],
        "protocol"
      )
    ).toThrow("LINK");
    expect(() =>
      prepareSubmission(
        { ...candidate, caption: "Save 40 hours." },
        source,
        [],
        "protocol"
      )
    ).toThrow("NUMBER");
  });
});

const blogSource = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "FABLE 5.1 IS OUT. HERE'S WHAT IT MEANS FOR YOUR SHOP.",
  slug: "fable-5-1-is-out",
  published_at: "2026-09-01T18:32:46.742Z",
  is_live: true,
  text: "Pick one completed job where you already know what changed. Load the original estimate, drawings and closeout file. Build a change log and state what the file cannot prove. Then compare the answer with what really happened on that job.",
  thumbnail_url: "https://cdn.opsapp.co/fable.jpg",
};
const blogCandidate = {
  title: "Run the closed-job test",
  hook: "A clean report can still be wrong.",
  angle:
    "Test any review process against a finished job before trusting it live.",
  caption:
    "The dangerous answer is not always messy. Pick a closed job you know cold and compare the answer with what really happened.",
  cta: "Save one closed job as your repeat test.",
  alt_text:
    "A carousel about testing a job-file review process on a finished job.",
  story_type: "blog_signal" as const,
  slides: [
    {
      headline: "A clean report can still be wrong",
      body: "Test the process on a job you already finished.",
    },
    {
      headline: "Pick a job you know cold",
      body: "Use a completed job where something changed and you know how it ended.",
    },
    {
      headline: "Rebuild the original record",
      body: "Load the original estimate, drawings and closeout file.",
    },
    {
      headline: "Score it against reality",
      body: "Compare the answer with what really happened on that job.",
    },
  ],
  evidence: [
    {
      claim: "Use a finished job.",
      quote: "Pick one completed job where you already know what changed.",
    },
  ],
};

describe("blog adaptation policy", () => {
  it("identifies the article on the cover and dates the carousel", () => {
    const result = prepareSubmission(blogCandidate, blogSource, [], "blog");
    expect(result.content.subtitle).toBe(blogSource.title);
    expect(result.content.date).toBe("SEP 01 · 2026");
  });

  it("asks for the cover-plus-text treatment whatever the title length", () => {
    const longTitle =
      "The new model still only sees the job file you actually keep";
    expect(longTitle.length).toBeGreaterThan(52);
    const result = prepareSubmission(
      { ...blogCandidate, title: longTitle },
      blogSource,
      [],
      "blog"
    );
    expect(result.preferences?.visual_treatment).toBe("editorial_cover");
    const selection = selectSocialTemplate({
      submission: result,
      recentPosts: [],
      idempotencyKey: "cloud-editorial-v2:blog:test",
    });
    expect(selection.visualTreatment).toBe("editorial_cover");
    expect(selection.preferenceDisposition).toBe("honored");
  });

  it("closes the carousel with a server-owned bare article URL", () => {
    const result = prepareSubmission(blogCandidate, blogSource, [], "blog");
    const closing = result.content.slides.at(-1)!;
    expect(result.content.slides).toHaveLength(blogCandidate.slides.length + 1);
    expect(closing.eyebrow).toBe("FULL ARTICLE");
    expect(closing.headline).toBe("KEEP READING");
    expect(closing.body).toBe("opsapp.co/journal/fable-5-1-is-out");
    expect(closing.image_url).toBeUndefined();
  });

  it("ends the caption with the full article link", () => {
    const result = prepareSubmission(blogCandidate, blogSource, [], "blog");
    expect(
      result.content.caption.endsWith(
        "Full article: https://opsapp.co/journal/fable-5-1-is-out"
      )
    ).toBe(true);
  });

  it("numbers takeaway slides the writer left unlabelled", () => {
    const result = prepareSubmission(blogCandidate, blogSource, [], "blog");
    expect(result.content.slides.map((slide) => slide.eyebrow)).toEqual([
      undefined,
      "TAKEAWAY 01",
      "TAKEAWAY 02",
      "TAKEAWAY 03",
      "FULL ARTICLE",
    ]);
  });

  it("keeps slide labels out of the writer's hands", () => {
    expect(
      candidateSchema.safeParse({
        ...blogCandidate,
        slides: blogCandidate.slides.map((slide) => ({
          ...slide,
          eyebrow: "THE SETUP",
        })),
      }).success
    ).toBe(false);
  });

  it("requires a cover plus at least three takeaways", () => {
    expect(() =>
      prepareSubmission(
        { ...blogCandidate, slides: blogCandidate.slides.slice(0, 3) },
        blogSource,
        [],
        "blog"
      )
    ).toThrow("SLIDE_COUNT");
  });

  it("leaves recurring formats without a closing slide or subtitle", () => {
    const result = prepareSubmission(blogCandidate, blogSource, [], "protocol");
    expect(result.content.slides).toHaveLength(blogCandidate.slides.length);
    expect(result.content.subtitle).toBeUndefined();
    expect(result.content.caption).toContain(
      "Source: https://opsapp.co/journal/fable-5-1-is-out"
    );
  });
});
