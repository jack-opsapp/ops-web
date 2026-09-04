import type { SocialContent } from "./contract";
import type { SocialVoiceIssue } from "./types";

export const SOCIAL_VOICE_REFERENCE_VERSION = "ops-social-parr-2026-09-01" as const;

const BANNED_MARKETING_TERMS = [
  "leverage",
  "synergy",
  "paradigm",
  "ecosystem",
  "revolutionary",
  "disruptive",
  "cutting-edge",
  "state-of-the-art",
  "best-in-class",
  "world-class",
  "enterprise-grade",
  "seamless",
  "frictionless",
  "holistic",
  "empower",
  "solution",
  "platform",
  "stakeholders",
  "facilitate",
  "optimize",
  "maximize",
  "robust",
] as const;

const emojiPattern = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const hashtagPattern = /(^|\s)#[\p{L}\p{N}_]+/gu;

interface VoiceField {
  path: string;
  value: string | undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textFields(content: SocialContent): VoiceField[] {
  const fields: VoiceField[] = [
    { path: "content.title", value: content.title },
    { path: "content.subtitle", value: content.subtitle },
    { path: "content.hook", value: content.hook },
    { path: "content.angle", value: content.angle },
    { path: "content.caption", value: content.caption },
    { path: "content.cta", value: content.cta },
    { path: "content.alt_text", value: content.alt_text },
  ];

  content.slides.forEach((slide, index) => {
    fields.push(
      { path: `content.slides.${index}.eyebrow`, value: slide.eyebrow },
      { path: `content.slides.${index}.headline`, value: slide.headline },
      { path: `content.slides.${index}.body`, value: slide.body },
      { path: `content.slides.${index}.alt_text`, value: slide.alt_text }
    );
  });

  return fields;
}

export function validateSocialVoice(content: SocialContent): {
  ok: boolean;
  issues: SocialVoiceIssue[];
} {
  const issues: SocialVoiceIssue[] = [];

  for (const field of textFields(content)) {
    if (!field.value) continue;

    const bannedTerms = BANNED_MARKETING_TERMS.filter((term) =>
      new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").test(field.value!)
    );

    if (bannedTerms.length > 0) {
      issues.push({
        path: field.path,
        code: "banned_language",
        message: `Replace banned marketing language: ${bannedTerms.join(", ")}`,
      });
    }

    if (/\bcontractors?\b/i.test(field.value)) {
      issues.push({
        path: field.path,
        code: "audience_language",
        message: "Use subtrades, trades, crews, owner-operators, or business owners",
      });
    }

    if (emojiPattern.test(field.value)) {
      issues.push({
        path: field.path,
        code: "emoji",
        message: "OPS social copy does not use emoji",
      });
    }
  }

  const hashtags = content.caption.match(hashtagPattern) ?? [];
  if (hashtags.length > 5) {
    issues.push({
      path: "content.caption",
      code: "hashtag_limit",
      message: "Use no more than five Instagram hashtags",
    });
  }

  return { ok: issues.length === 0, issues };
}
