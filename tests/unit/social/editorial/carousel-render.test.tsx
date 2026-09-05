// @vitest-environment node
import { it, expect } from "vitest";
import sharp from "sharp";
import { renderSocialPost } from "@/lib/social/render/render-social-post";
import { storeSocialAsset } from "@/lib/social/asset-store";
import { selectSocialTemplate } from "@/lib/social/template-selector";
import {
  prepareSubmission,
  editorialPreviewId,
} from "@/lib/social/editorial/policy";
it("renders every image-led carousel slide through actual asset validation", async () => {
  const source = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Handoff",
    slug: "handoff",
    text: "Write the address before the crew leaves the shop.",
    is_live: true,
    published_at: "2026-09-01T12:00:00Z",
    thumbnail_url: "https://cdn.test/handoff.jpg",
  };
  const content = {
    title: "Before departure",
    hook: "Before the crew leaves",
    angle: "A better handoff",
    caption: "Write the address before the crew leaves the shop.",
    cta: "Save this.",
    alt_text: "A crew handoff note.",
    story_type: "blog_signal",
    slides: [
      { headline: "Before departure", body: "Write the address." },
      {
        headline: "Give the crew the plan",
        body: "Put the plan where the crew works.",
      },
      {
        headline: "Make the handoff",
        body: "Check the address before departure.",
      },
    ],
    evidence: [{ claim: "Write the address.", quote: source.text }],
  };
  const submission = prepareSubmission(content, source, []);
  const selection = selectSocialTemplate({
    submission,
    recentPosts: [],
    idempotencyKey: "test-carousel-1",
  });
  expect(selection.visualTreatment).toBe("editorial_cover");
  const buffer = await sharp({
    create: { width: 1080, height: 1350, channels: 3, background: "#808080" },
  })
    .jpeg()
    .toBuffer();
  const output = await renderSocialPost(
    { postId: editorialPreviewId("2026-09-07"), submission, selection },
    {
      downloadImage: async () => ({
        buffer,
        contentType: "image/jpeg",
        width: 1080,
        height: 1350,
      }),
      storeAsset: (input) =>
        storeSocialAsset(input, {
          backend: "s3",
          putS3: async () => {},
          putSupabase: async () => {},
          publicS3Url: (key) => "https://cdn.test/" + key,
          publicSupabaseUrl: (key) => key,
        }),
    }
  );
  expect(output).toHaveLength(3);
  expect(
    output.every(
      (a) => a.width === 1080 && a.height === 1350 && a.bytes > 10000
    )
  ).toBe(true);
}, 20000);
