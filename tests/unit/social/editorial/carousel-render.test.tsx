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

it("renders a full blog adaptation through actual asset validation", async () => {
  const source = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "THE HANDOFF THAT KEEPS THE CREW FROM CALLING YOU BACK",
    slug: "handoff",
    text: "Write the address before the crew leaves the shop. Put the material list beside it. Then read it back once.",
    is_live: true,
    published_at: "2026-09-01T12:00:00Z",
    thumbnail_url: "https://cdn.test/handoff.jpg",
  };
  const candidate = {
    title: "Before departure",
    hook: "Before the crew leaves",
    angle: "A better handoff",
    caption: "Write the address before the crew leaves the shop.",
    cta: "Save this.",
    alt_text: "A crew handoff note.",
    story_type: "blog_signal" as const,
    slides: [
      { headline: "Before departure", body: "Write the address." },
      {
        headline: "Give the crew the plan",
        body: "Put the material list beside the address.",
      },
      {
        headline: "Read it back once",
        body: "Then read it back once before the truck moves.",
      },
      {
        headline: "Make the handoff",
        body: "Check the address before departure.",
      },
    ],
    evidence: [
      {
        claim: "Write the address.",
        quote: "Write the address before the crew leaves the shop.",
      },
    ],
  };
  const submission = prepareSubmission(candidate, source, [], "blog");
  expect(submission.content.slides).toHaveLength(5);
  expect(submission.content.slides.at(-1)?.body).toBe(
    "opsapp.co/journal/handoff"
  );

  const selection = selectSocialTemplate({
    submission,
    recentPosts: [],
    idempotencyKey: "cloud-editorial-v2:blog:handoff",
  });
  const buffer = await sharp({
    create: { width: 1080, height: 1350, channels: 3, background: "#808080" },
  })
    .jpeg()
    .toBuffer();
  const output = await renderSocialPost(
    { postId: editorialPreviewId("blog:handoff"), submission, selection },
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

  expect(output).toHaveLength(5);
  expect(
    output.every(
      (a) => a.width === 1080 && a.height === 1350 && a.bytes > 10000
    )
  ).toBe(true);
  // Every slide is a distinct picture. The cover must not be repeated.
  expect(new Set(output.map((a) => a.sha256)).size).toBe(5);
}, 30000);
