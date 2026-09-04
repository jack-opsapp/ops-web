import { createHash } from "node:crypto";
import type { SocialSubmission } from "./contract";
import {
  SOCIAL_TEMPLATE_CATALOG,
  type SocialTemplateDefinition,
} from "./template-catalog";
import type {
  SocialPostFormat,
  SocialSourceType,
  SocialStoryType,
  SocialVisualTreatment,
} from "./types";

export const SOCIAL_SELECTOR_VERSION = "feed-cycle-2026-09-01" as const;

export interface RecentSocialPost {
  visualTreatment: SocialVisualTreatment;
  postFormat: SocialPostFormat;
}

interface CandidateScore {
  treatment: SocialVisualTreatment;
  compatible: boolean;
  reasons: string[];
  score: number;
  scoreBreakdown: {
    story: number;
    fit: number;
    cadence: number;
    preference: number;
    tieBreak: number;
  };
}

export interface SocialTemplateSelection {
  selectorVersion: typeof SOCIAL_SELECTOR_VERSION;
  storyType: SocialStoryType;
  visualTreatment: SocialVisualTreatment;
  postFormat: SocialPostFormat;
  preferenceDisposition: "honored" | "overridden" | "not_provided";
  preferenceReasons: string[];
  scoreBreakdown: CandidateScore["scoreBreakdown"];
  considered: CandidateScore[];
}

const SOURCE_STORY_MAP: Record<SocialSourceType, SocialStoryType> = {
  blog: "blog_signal",
  feature: "release_note",
  insight: "operator_protocol",
  field_dispatch: "field_dispatch",
  performance_proof: "performance_proof",
  release_note: "release_note",
  roast: "roast_card",
  custom: "operator_protocol",
};

function stableFraction(seed: string): number {
  const digest = createHash("sha256").update(seed).digest();
  return digest.readUInt32BE(0) / 0xffffffff;
}

function hasImage(submission: SocialSubmission): boolean {
  return Boolean(
    submission.media?.some((media) => media.url) ||
      submission.content.slides.some((slide) => slide.image_url)
  );
}

function compatibility(
  template: SocialTemplateDefinition,
  storyType: SocialStoryType,
  titleLength: number,
  imageAvailable: boolean
): string[] {
  const reasons: string[] = [];
  if (!template.storyTypes.includes(storyType)) reasons.push(`not available for ${storyType}`);
  if (template.requiresImage && !imageAvailable) reasons.push("requires an image");
  if (template.maximumTitleLength && titleLength > template.maximumTitleLength) {
    reasons.push(`title exceeds ${template.maximumTitleLength} characters`);
  }
  return reasons;
}

function fitScore(
  treatment: SocialVisualTreatment,
  storyType: SocialStoryType,
  titleLength: number,
  imageAvailable: boolean
): number {
  switch (treatment) {
    case "editorial_cover":
      return titleLength <= 32 ? 50 : 34;
    case "split_signal":
      return titleLength >= 48 ? 52 : 34;
    case "operator_brief":
      return (titleLength >= 88 ? 62 : titleLength >= 64 ? 42 : 8) + (!imageAvailable ? 10 : 0);
    case "field_frame":
      return storyType === "field_dispatch" ? 64 : 46;
    case "proof_board":
      return storyType === "performance_proof" ? 64 : 32;
    case "signal_grid":
      return (storyType === "operator_protocol" ? 62 : 14) + (!imageAvailable ? 12 : 0);
    case "roast_file":
      return 90;
  }
}

function cadenceScore(
  template: SocialTemplateDefinition,
  recentPosts: readonly RecentSocialPost[]
): number {
  let score = 0;
  if (recentPosts[0]?.visualTreatment === template.treatment) score -= 90;
  if (recentPosts[1]?.visualTreatment === template.treatment) score -= 55;

  const recentWindow = recentPosts.slice(0, 6);
  if (recentWindow.length >= 3) {
    const imageLedCount = recentWindow.filter((post) => {
      const match = SOCIAL_TEMPLATE_CATALOG.find(
        (candidate) => candidate.treatment === post.visualTreatment
      );
      return match?.imageLed;
    }).length;
    const imageRatio = imageLedCount / recentWindow.length;

    if (imageRatio > 0.6) score += template.imageLed ? -18 : 26;
    if (imageRatio < 0.4) score += template.imageLed ? 18 : -8;
  }

  return score;
}

export function selectSocialTemplate({
  submission,
  recentPosts,
  idempotencyKey,
}: {
  submission: SocialSubmission;
  recentPosts: readonly RecentSocialPost[];
  idempotencyKey: string;
}): SocialTemplateSelection {
  const storyType = submission.preferences?.story_type ?? SOURCE_STORY_MAP[submission.source.type];
  const postFormat: SocialPostFormat =
    submission.content.slides.length === 1 ? "single" : "carousel";
  const titleLength = submission.content.title.length;
  const imageAvailable = hasImage(submission);
  const preferredTreatment = submission.preferences?.visual_treatment;

  const considered: CandidateScore[] = SOCIAL_TEMPLATE_CATALOG.map((template) => {
    const reasons = compatibility(template, storyType, titleLength, imageAvailable);
    const story = reasons.length === 0 ? 100 : 0;
    const fit = reasons.length === 0
      ? fitScore(template.treatment, storyType, titleLength, imageAvailable)
      : 0;
    const cadence = reasons.length === 0 ? cadenceScore(template, recentPosts) : 0;
    const preference = preferredTreatment === template.treatment && reasons.length === 0 ? 35 : 0;
    const tieBreak = stableFraction(`${idempotencyKey}:${template.treatment}`);

    return {
      treatment: template.treatment,
      compatible: reasons.length === 0,
      reasons,
      score: story + fit + cadence + preference + tieBreak,
      scoreBreakdown: { story, fit, cadence, preference, tieBreak },
    };
  });

  const selected = considered
    .filter((candidate) => candidate.compatible)
    .sort((left, right) => right.score - left.score)[0];

  if (!selected) {
    throw new Error(`No compatible social treatment for ${storyType}`);
  }

  let preferenceDisposition: SocialTemplateSelection["preferenceDisposition"] = "not_provided";
  let preferenceReasons: string[] = [];

  if (preferredTreatment) {
    if (preferredTreatment === selected.treatment) {
      preferenceDisposition = "honored";
    } else {
      preferenceDisposition = "overridden";
      const preferredCandidate = considered.find(
        (candidate) => candidate.treatment === preferredTreatment
      );
      preferenceReasons = preferredCandidate?.reasons.length
        ? preferredCandidate.reasons
        : ["a stronger content-fit or feed-cadence treatment was selected"];
    }
  }

  return {
    selectorVersion: SOCIAL_SELECTOR_VERSION,
    storyType,
    visualTreatment: selected.treatment,
    postFormat,
    preferenceDisposition,
    preferenceReasons,
    scoreBreakdown: selected.scoreBreakdown,
    considered,
  };
}
