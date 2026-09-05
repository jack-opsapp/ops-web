import { storeSocialAsset } from "@/lib/social/asset-store";
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
    const result = prepareSubmission(candidate, source, []);
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
      []
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
      []
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
        []
      )
    ).toThrow("EVIDENCE");
    expect(() =>
      prepareSubmission(
        { ...candidate, story_type: "field_dispatch" },
        source,
        []
      )
    ).toThrow("IMAGE");
  });
  it("rejects near-duplicate hooks and banned audience language", () => {
    expect(() =>
      prepareSubmission(candidate, source, ["The address belongs on the job"])
    ).toThrow("DUPLICATE");
    expect(() =>
      prepareSubmission(
        { ...candidate, title: "Tips for contractors" },
        source,
        []
      )
    ).toThrow("VOICE");
  });
  it("rejects external model links and unsupported quantified promises", () => {
    expect(() =>
      prepareSubmission(
        { ...candidate, caption: "Visit https://evil.example" },
        source,
        []
      )
    ).toThrow("LINK");
    expect(() =>
      prepareSubmission({ ...candidate, caption: "Save 40 hours." }, source, [])
    ).toThrow("NUMBER");
  });
});
