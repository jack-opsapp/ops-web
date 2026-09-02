import sharp from "sharp";
import type { SocialSubmission } from "@/lib/social/contract";
import type { SocialTemplateSelection } from "@/lib/social/template-selector";
import type { RenderedSocialAsset, SocialVisualTreatment } from "@/lib/social/types";
import {
  SOCIAL_RENDER_VERSION,
  renderSocialPost,
  type RenderSocialDependencies,
} from "@/lib/social/render/render-social-post";

const POST_ID = "9d5fd8b8-83bc-44bf-b846-63c5a1bb9c30";
const TREATMENTS: SocialVisualTreatment[] = [
  "editorial_cover",
  "split_signal",
  "operator_brief",
  "field_frame",
  "proof_board",
  "signal_grid",
  "roast_file",
];

function submission(slideCount = 1): SocialSubmission {
  return {
    contract_version: "2026-09-01",
    source: { type: "blog", id: "blog-1", url: "https://opsapp.ca/blog/blog-1" },
    content: {
      title: "The operating habit that gives the owner two hours back",
      subtitle: "One plan. Fewer repeat calls.",
      date: "SEP 01 · 2026",
      hook: "Your crew is waiting on an answer you already gave once.",
      angle: "Show the cost of repeated coordination and the practical fix.",
      caption: "Every repeated answer costs attention. Put the plan where the crew works.",
      cta: "Read the full field note at the link in bio.",
      alt_text: "An OPS field note about repeated crew coordination.",
      slides: Array.from({ length: slideCount }, (_, index) => ({
        eyebrow: `FIELD NOTE ${String(index + 1).padStart(2, "0")}`,
        headline:
          index === 0
            ? "The operating habit that gives the owner two hours back"
            : `Move ${index + 1}: close the loop before the trucks leave`,
        body:
          "Every repeated answer costs attention, time, and margin. One shared plan keeps the decision where the crew can find it.",
        image_url: "https://images.opsapp.ca/job-site.jpg",
        alt_text: `Slide ${index + 1} about a shared crew plan.`,
      })),
    },
  };
}

function selection(
  treatment: SocialVisualTreatment,
  format: "single" | "carousel" = "single"
): SocialTemplateSelection {
  return {
    selectorVersion: "feed-cycle-2026-09-01",
    storyType: treatment === "roast_file" ? "roast_card" : "blog_signal",
    visualTreatment: treatment,
    postFormat: format,
    preferenceDisposition: "not_provided",
    preferenceReasons: [],
    scoreBreakdown: { story: 100, fit: 50, cadence: 0, preference: 0, tieBreak: 0.1 },
    considered: [],
  };
}

async function dependencies(): Promise<{
  value: RenderSocialDependencies;
  captured: Buffer[];
}> {
  const source = await sharp({
    create: { width: 1600, height: 1200, channels: 3, background: "#3f4346" },
  })
    .jpeg()
    .toBuffer();
  const captured: Buffer[] = [];

  return {
    captured,
    value: {
      downloadImage: vi.fn().mockResolvedValue({
        buffer: source,
        contentType: "image/jpeg",
        width: 1600,
        height: 1200,
      }),
      storeAsset: vi.fn(async (input) => {
        captured.push(input.buffer);
        return {
          order: input.order,
          url: `https://cdn.opsapp.ca/${input.renderVersion}/slide-${input.order}.jpg`,
          alt_text: input.altText,
          sha256: "captured-in-storage-test",
          width: input.width,
          height: input.height,
          bytes: input.buffer.byteLength,
          content_type: "image/jpeg",
          storage_key: `social-media/${input.postId}/${input.renderVersion}/slide-${input.order}.jpg`,
        } satisfies RenderedSocialAsset;
      }),
    },
  };
}

describe("OPS social renderer", () => {
  it("fades editorial artwork smoothly into the headline area", async () => {
    const deps = await dependencies();
    await renderSocialPost(
      {
        postId: POST_ID,
        submission: submission(),
        selection: selection("editorial_cover"),
      },
      deps.value
    );

    const { data, info } = await sharp(deps.captured[0])
      .raw()
      .toBuffer({ resolveWithObject: true });
    const averageLuminance = (y: number) => {
      let total = 0;
      let samples = 0;
      for (let x = 970; x < 990; x += 1) {
        const offset = (y * info.width + x) * info.channels;
        total += (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
        samples += 1;
      }
      return total / samples;
    };
    const gradientReadings = Array.from(
      { length: 81 },
      (_, index) => averageLuminance(300 + index * 10)
    );
    const largestStep = Math.max(
      ...gradientReadings.slice(1).map((value, index) =>
        Math.abs(value - gradientReadings[index])
      )
    );

    expect(largestStep).toBeLessThan(18);
    expect(gradientReadings[0] - gradientReadings.at(-1)!).toBeGreaterThan(35);
  }, 30_000);

  it.each(TREATMENTS)("renders %s as a 1080 by 1350 JPEG", async (treatment) => {
    const deps = await dependencies();
    const assets = await renderSocialPost(
      { postId: POST_ID, submission: submission(), selection: selection(treatment) },
      deps.value
    );
    const metadata = await sharp(deps.captured[0]).metadata();

    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({ width: 1080, height: 1350, content_type: "image/jpeg" });
    expect(metadata).toMatchObject({ format: "jpeg", width: 1080, height: 1350 });
  }, 20_000);

  it("renders and stores carousel slides in narrative order", async () => {
    const deps = await dependencies();
    const assets = await renderSocialPost(
      {
        postId: POST_ID,
        submission: submission(3),
        selection: selection("split_signal", "carousel"),
      },
      deps.value
    );

    expect(assets.map((asset) => asset.order)).toEqual([1, 2, 3]);
    expect(assets.map((asset) => asset.alt_text)).toEqual([
      "Slide 1 about a shared crew plan.",
      "Slide 2 about a shared crew plan.",
      "Slide 3 about a shared crew plan.",
    ]);
  }, 30_000);

  it("produces deterministic bytes for the same input and render version", async () => {
    const first = await dependencies();
    const second = await dependencies();
    const input = {
      postId: POST_ID,
      submission: submission(),
      selection: selection("operator_brief"),
      renderVersion: SOCIAL_RENDER_VERSION,
    };

    await renderSocialPost(input, first.value);
    await renderSocialPost(input, second.value);

    expect(first.captured[0].equals(second.captured[0])).toBe(true);
  }, 30_000);

  it("renders the maximum contract lengths without failing or changing dimensions", async () => {
    const deps = await dependencies();
    const max = submission();
    max.content.title = "T".repeat(100);
    max.content.subtitle = "S".repeat(160);
    max.content.hook = "H".repeat(90);
    max.content.slides[0].headline = "L".repeat(100);
    max.content.slides[0].body = "B".repeat(350);

    await renderSocialPost(
      { postId: POST_ID, submission: max, selection: selection("operator_brief") },
      deps.value
    );
    const metadata = await sharp(deps.captured[0]).metadata();

    expect(metadata).toMatchObject({ width: 1080, height: 1350 });
  }, 30_000);
});
