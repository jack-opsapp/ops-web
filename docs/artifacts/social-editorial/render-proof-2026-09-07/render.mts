/**
 * Visual proof for the Instagram carousel renderer.
 *
 *   cd <worktree> && npx tsx \
 *     --tsconfig docs/artifacts/social-editorial/render-proof-2026-09-07/tsconfig.json \
 *     docs/artifacts/social-editorial/render-proof-2026-09-07/render.mts
 *
 * Renders five packages through the real renderer, writes each slide as a
 * 1080x1350 JPEG and a 390px-wide phone-size downscale beside it. The local
 * tsconfig maps `server-only` to an empty shim so the server renderer loads
 * outside Next; nothing else is stubbed except asset storage, which writes to
 * this folder instead of S3.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../../../..");
const PHONE_WIDTH = 390;

const { renderSocialPost } =
  await import("@/lib/social/render/render-social-post");
const { prepareSubmission } = await import("@/lib/social/editorial/policy");
const { selectSocialTemplate } = await import("@/lib/social/template-selector");
type Submission = import("@/lib/social/contract").SocialSubmission;
type Selection =
  import("@/lib/social/template-selector").SocialTemplateSelection;
type Treatment = import("@/lib/social/types").SocialVisualTreatment;
type Asset = import("@/lib/social/types").RenderedSocialAsset;

function fixedSelection(
  treatment: Treatment,
  storyType: Selection["storyType"],
  slideCount: number
): Selection {
  return {
    selectorVersion: "feed-cycle-2026-09-01",
    storyType,
    visualTreatment: treatment,
    postFormat: slideCount === 1 ? "single" : "carousel",
    preferenceDisposition: "honored",
    preferenceReasons: [],
    scoreBreakdown: {
      story: 100,
      fit: 50,
      cadence: 0,
      preference: 35,
      tieBreak: 0,
    },
    considered: [],
  };
}

/** A neutral tactical ground, used only when the live cover image is unreachable. */
async function placeholderImage(): Promise<Buffer> {
  return sharp({
    create: {
      width: 1600,
      height: 1200,
      channels: 3,
      background: { r: 30, g: 34, b: 38 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function liveImage(
  url: string | null
): Promise<{ buffer: Buffer; live: boolean }> {
  if (!url) return { buffer: await placeholderImage(), live: false };
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(String(response.status));
    return { buffer: Buffer.from(await response.arrayBuffer()), live: true };
  } catch (error) {
    console.warn(
      `  cover image unreachable (${String(error)}); using placeholder`
    );
    return { buffer: await placeholderImage(), live: false };
  }
}

async function renderCase(
  name: string,
  submission: Submission,
  selection: Selection,
  cover: Buffer
): Promise<void> {
  const written: string[] = [];
  await renderSocialPost(
    { postId: "00000000-0000-4000-8000-000000000000", submission, selection },
    {
      downloadImage: async () => ({
        buffer: cover,
        contentType: "image/jpeg",
        width: 1600,
        height: 1200,
      }),
      storeAsset: async (input): Promise<Asset> => {
        const file = `${name}-${String(input.order).padStart(2, "0")}.jpg`;
        writeFileSync(join(HERE, file), input.buffer);
        await sharp(input.buffer)
          .resize({ width: PHONE_WIDTH })
          .jpeg({ quality: 92 })
          .toFile(join(HERE, file.replace(/\.jpg$/, `@${PHONE_WIDTH}.jpg`)));
        written.push(file);
        return {
          order: input.order,
          url: `file://${join(HERE, file)}`,
          alt_text: input.altText,
          sha256: createHash("sha256").update(input.buffer).digest("hex"),
          width: input.width,
          height: input.height,
          bytes: input.buffer.byteLength,
          content_type: "image/jpeg",
          storage_key: file,
        };
      },
    }
  );
  console.log(`  ${selection.visualTreatment}: ${written.join(", ")}`);
}

// ---------------------------------------------------------------------------
// (a) The saved 2026-09-05 Fable package, re-run through the blog policy.
// ---------------------------------------------------------------------------
const saved = JSON.parse(
  readFileSync(
    join(
      ROOT,
      "docs/artifacts/social-editorial/manual-run-2026-09-05/result.json"
    ),
    "utf8"
  )
);
const savedContent = saved.package.submission.content;
const fableSource = {
  id: saved.source_snapshot.id,
  title: saved.source_snapshot.title,
  slug: saved.source_snapshot.slug,
  text: saved.source_snapshot.text,
  published_at: saved.source_snapshot.published_at,
  is_live: true,
  thumbnail_url: saved.source_snapshot.thumbnail_url,
};
const fableCandidate = {
  title: savedContent.title,
  hook: savedContent.hook,
  angle: savedContent.angle,
  // The saved caption already carries the server-appended source line; the
  // writer's own caption is everything before it.
  caption: savedContent.caption.split("\n\nSource: ")[0],
  cta: savedContent.cta,
  alt_text: savedContent.alt_text,
  story_type: "blog_signal",
  slides: savedContent.slides.map(
    (slide: { headline: string; body: string }) => ({
      headline: slide.headline,
      body: slide.body,
    })
  ),
  evidence: saved.package.evidence,
};

console.log("(a) saved Fable blog package");
const fableCover = await liveImage(fableSource.thumbnail_url);
console.log(
  `  cover image: ${fableCover.live ? "live source image" : "placeholder"}`
);
const fableSubmission = prepareSubmission(
  fableCandidate,
  fableSource,
  [],
  "blog"
);
await renderCase(
  "a-fable-blog",
  fableSubmission,
  selectSocialTemplate({
    submission: fableSubmission,
    recentPosts: [],
    idempotencyKey: `cloud-editorial-v2:blog:${fableSource.id}`,
  }),
  fableCover.buffer
);

// ---------------------------------------------------------------------------
// (b) Synthetic five-slide operator protocol on signal_grid.
// ---------------------------------------------------------------------------
const protocolSource = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "THE MORNING HANDOFF THAT STOPS THE CALLBACKS",
  slug: "morning-handoff",
  text: "Write the address, the access notes and the material list before the crew leaves the shop. Read it back once. Then send the same note to the customer so nobody guesses. A crew that leaves with the plan does not call the office from the driveway.",
  published_at: "2026-09-02T15:00:00Z",
  is_live: true,
  thumbnail_url: null,
};
const protocolSubmission = prepareSubmission(
  {
    title: "The morning handoff",
    hook: "Your crew calls from the driveway because the note stayed in your head.",
    angle:
      "A five-step morning handoff that leaves nothing for the crew to guess.",
    caption:
      "A crew that leaves with the plan does not call the office from the driveway. Write it down once, read it back, send it out.",
    cta: "Run this tomorrow morning.",
    alt_text: "A five-slide protocol for running a morning crew handoff.",
    story_type: "operator_protocol",
    slides: [
      {
        headline: "Write the address down",
        body: "Not the street name. The full address, the way the truck needs it.",
      },
      {
        headline: "Add the access notes",
        body: "Gate code, parking, which door, who opens it. Every note the crew would otherwise call you for.",
      },
      {
        headline: "List the material",
        body: "What is on the truck and what is already on site. Missing material is a half-day, not a phone call.",
      },
      {
        headline: "Read it back once",
        body: "Out loud, to the lead. A note nobody reads is a note nobody has.",
      },
      {
        headline: "Send the same note out",
        body: "The customer gets the version the crew got. Nobody guesses, nobody gets surprised.",
      },
    ],
    evidence: [
      {
        claim: "The handoff is written before departure.",
        quote:
          "Write the address, the access notes and the material list before the crew leaves the shop.",
      },
    ],
  },
  protocolSource,
  [],
  "protocol"
);
console.log("(b) synthetic operator protocol");
await renderCase(
  "b-protocol-signal-grid",
  protocolSubmission,
  fixedSelection(
    "signal_grid",
    "operator_protocol",
    protocolSubmission.content.slides.length
  ),
  await placeholderImage()
);

// ---------------------------------------------------------------------------
// (c) Roast card on roast_file.
// ---------------------------------------------------------------------------
const roastSource = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "THE OWNER WHO IS ALSO THE DISPATCHER",
  slug: "owner-dispatcher",
  text: "You are the estimator, the dispatcher and the guy who answers the phone at supper. Every answer lives in your head, so every question comes back to you. That is not a busy season. That is a design.",
  published_at: "2026-09-03T15:00:00Z",
  is_live: true,
  thumbnail_url: null,
};
const roastSubmission = prepareSubmission(
  {
    title: "The owner who is also the dispatcher",
    hook: "Every question comes back to you because every answer lives in your head.",
    angle: "The owner-dispatcher pattern, and why the phone never stops.",
    caption:
      "That is not a busy season. That is a design. Put the answer somewhere the crew can reach without reaching you.",
    cta: "Write one answer down today.",
    alt_text: "A roast card about the owner who is also the dispatcher.",
    story_type: "roast_card",
    slides: [
      {
        headline: "You are the dispatcher",
        body: "You are the estimator, the dispatcher and the guy who answers the phone at supper.",
      },
      {
        headline: "Every answer lives in your head",
        body: "So every question comes back to you. Every single one.",
      },
      {
        headline: "That is not a busy season",
        body: "That is a design. And you drew it.",
      },
    ],
    evidence: [
      {
        claim: "The owner holds every answer.",
        quote:
          "Every answer lives in your head, so every question comes back to you.",
      },
    ],
  },
  roastSource,
  [],
  "rotation"
);
console.log("(c) roast card");
await renderCase(
  "c-roast-file",
  roastSubmission,
  fixedSelection(
    "roast_file",
    "roast_card",
    roastSubmission.content.slides.length
  ),
  await placeholderImage()
);

// ---------------------------------------------------------------------------
// (d) Blog package with an 88-character title on split_signal.
// ---------------------------------------------------------------------------
const longTitleSource = {
  id: "33333333-3333-4333-8333-333333333333",
  title:
    "WHY THE SCHEDULE ON THE WHITEBOARD AND THE SCHEDULE IN YOUR PHONE NEVER MATCH BY FRIDAY",
  slug: "whiteboard-versus-phone-schedule",
  text: "The whiteboard is right on Monday and wrong by Wednesday. The phone is right for you and invisible to the crew. Pick the one the crew already opens and put every change there first. One schedule, one place, one version anybody can read at seven in the morning.",
  published_at: "2026-09-04T15:00:00Z",
  is_live: true,
  thumbnail_url: "https://cdn.example.invalid/whiteboard.jpg",
};
const longTitleSubmission = prepareSubmission(
  {
    // 88 characters, the split_signal ceiling.
    title:
      "Why the whiteboard and the phone stop agreeing about the job schedule by Wednesday night",
    hook: "The whiteboard is right on Monday and wrong by Wednesday.",
    angle:
      "Two schedules means no schedule. Pick the one the crew already opens.",
    caption:
      "One schedule, one place, one version anybody can read at seven in the morning. The rest is guessing dressed up as planning.",
    cta: "Pick one place this week.",
    alt_text: "A carousel about keeping one schedule instead of two.",
    story_type: "blog_signal",
    slides: [
      {
        headline: "Two schedules means no schedule",
        body: "The whiteboard is right on Monday and wrong by Wednesday.",
      },
      {
        headline: "The phone is invisible to the crew",
        body: "The phone is right for you and invisible to the crew. That is not a schedule, that is a private note.",
      },
      {
        headline: "Pick the one they already open",
        body: "Pick the one the crew already opens and put every change there first.",
      },
      {
        headline: "One version, seven in the morning",
        body: "One schedule, one place, one version anybody can read at seven in the morning.",
      },
    ],
    evidence: [
      {
        claim: "Changes belong in the place the crew already opens.",
        quote:
          "Pick the one the crew already opens and put every change there first.",
      },
    ],
  },
  longTitleSource,
  [],
  "blog"
);
console.log(
  `(d) blog with an ${longTitleSubmission.content.title.length}-character title`
);
await renderCase(
  "d-long-title-split-signal",
  longTitleSubmission,
  fixedSelection(
    "split_signal",
    "blog_signal",
    longTitleSubmission.content.slides.length
  ),
  await placeholderImage()
);

// ---------------------------------------------------------------------------
// (e) Worst case: 100-character headlines and 350-character bodies.
// ---------------------------------------------------------------------------
const worstHeadline =
  "The whole job record has to be rebuilt before anybody scores the answer against what really happened";
const worstBody =
  "Load the original estimate, the drawings, every revision, the supplier messages, the site photos, the inspection notes, the change orders, the schedule record and the closeout file. Then build a change log that cites a source and a date for every material change, states the effect on scope or schedule, and lists plainly what this file cannot prove.";
const worstSource = {
  id: "44444444-4444-4444-8444-444444444444",
  title:
    "REBUILD THE RECORD BEFORE YOU SCORE THE ANSWER AGAINST WHAT ACTUALLY HAPPENED ON THE JOB",
  slug: "rebuild-the-record-before-you-score-the-answer-against-the-finished-job",
  text: `${worstHeadline} ${worstBody}`,
  published_at: "2026-09-05T15:00:00Z",
  is_live: true,
  thumbnail_url: null,
};
const worstSlide = { headline: worstHeadline, body: worstBody };
// The contract ceilings are 100 and 350; the proof has to sit exactly on them.
if (worstSlide.headline.length !== 100 || worstSlide.body.length !== 350)
  throw new Error(
    `worst-case fixture off the ceiling: ${worstSlide.headline.length}/${worstSlide.body.length}`
  );
const worstSubmission = prepareSubmission(
  {
    title: "Rebuild the record before you score it against the finished job",
    hook: "A clean answer means nothing until you score it against a job you already know",
    angle:
      "Rebuild the record, cite every change, and name what the file cannot prove.",
    caption:
      "A clean answer means nothing until you score it against a job you already know cold. Rebuild the record first.",
    cta: "Pick one closed job.",
    alt_text:
      "A carousel about rebuilding a job record before scoring a review process.",
    story_type: "blog_signal",
    slides: [worstSlide, worstSlide, worstSlide, worstSlide],
    evidence: [
      { claim: "Rebuild the record first.", quote: worstBody.slice(0, 176) },
    ],
  },
  worstSource,
  [],
  "blog"
);
console.log(
  `(e) worst case: headline ${worstSlide.headline.length} chars, body ${worstSlide.body.length} chars, URL ${
    worstSubmission.content.slides.at(-1)?.body?.length
  } chars`
);
await renderCase(
  "e-worst-case-operator-brief",
  worstSubmission,
  fixedSelection(
    "operator_brief",
    "blog_signal",
    worstSubmission.content.slides.length
  ),
  await placeholderImage()
);

console.log("done");
