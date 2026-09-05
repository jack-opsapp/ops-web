import { createHash } from "node:crypto";
import { z } from "zod";
import { socialSubmissionSchema, type SocialSubmission } from "../contract";
import { SOCIAL_STORY_TYPES } from "../types";
import { validateSocialVoice } from "../voice-profile";

export type EditorialKind = "blog" | "protocol" | "product" | "rotation";
export interface EditorialSource {
  id: string;
  title: string;
  slug: string;
  text: string;
  published_at: string;
  is_live: boolean;
  thumbnail_url: string | null;
}
export interface EditorialSlot {
  date: string;
  kind: EditorialKind;
}
// Vancouver adopted permanent UTC-7 in March 2026. Explicit zone avoids stale runtime tzdata.
// https://news.gov.bc.ca/releases/2026AG0013-000209
const localDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Etc/GMT+7",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});
export function getEditorialSlot(now: Date): EditorialSlot | null {
  const p = Object.fromEntries(
    localDate.formatToParts(now).map((x) => [x.type, x.value])
  );
  if (
    Number(p.hour) < 10 ||
    Number(p.hour) >= 20 ||
    ["Sat", "Sun"].includes(p.weekday)
  )
    return null;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    kind: (
      {
        Mon: "blog",
        Tue: "protocol",
        Wed: "product",
        Thu: "blog",
        Fri: "rotation",
      } as const
    )[p.weekday as "Mon"],
  };
}
export function chooseSource(
  sources: EditorialSource[],
  used: string[],
  now: Date,
  kind: EditorialKind
): EditorialSource | null {
  const age = (kind === "blog" ? 30 : 180) * 86400000;
  return (
    sources
      .filter(
        (s) =>
          s.is_live &&
          /^[a-z0-9][a-z0-9-]*$/.test(s.slug) &&
          s.text.trim().length >= 60 &&
          !used.includes(s.id) &&
          Date.parse(s.published_at) <= now.getTime() &&
          Date.parse(s.published_at) >= now.getTime() - age
      )
      .sort(
        (a, b) => Date.parse(b.published_at) - Date.parse(a.published_at)
      )[0] ?? null
  );
}
export const candidateSchema = z
  .object({
    title: z.string().min(1).max(100),
    hook: z.string().min(1).max(90),
    angle: z.string().min(1).max(220),
    caption: z.string().min(1).max(1800),
    cta: z.string().min(1).max(120),
    alt_text: z.string().min(1).max(500),
    story_type: z.enum(SOCIAL_STORY_TYPES),
    slides: z
      .array(
        z
          .object({
            headline: z.string().min(1).max(100),
            body: z.string().min(1).max(350),
          })
          .strict()
      )
      .min(1)
      .max(6),
    evidence: z
      .array(
        z
          .object({
            claim: z.string().min(1).max(400),
            quote: z.string().min(20).max(700),
          })
          .strict()
      )
      .min(1)
      .max(12),
  })
  .strict();
export type EditorialCandidate = z.infer<typeof candidateSchema>;
const normalized = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export function isDuplicate(hook: string, recent: string[]): boolean {
  const words = new Set(normalized(hook).split(" "));
  return recent.some((previous) => {
    const other = new Set(normalized(previous).split(" "));
    const intersection = [...words].filter((x) => other.has(x)).length;
    return intersection / Math.max(words.size, other.size) >= 0.8;
  });
}
export function prepareSubmission(
  raw: unknown,
  source: EditorialSource,
  recentHooks: string[]
): SocialSubmission {
  const c = candidateSchema.parse(raw);
  const normalizeQuote = (s: string) => s.replace(/\s+/g, " ").trim();
  if (
    c.evidence.some(
      (e) => !normalizeQuote(source.text).includes(normalizeQuote(e.quote))
    )
  )
    throw new Error("EVIDENCE_INVALID");
  if (c.story_type === "field_dispatch" && !source.thumbnail_url)
    throw new Error("IMAGE_REQUIRED");
  if (isDuplicate(c.hook, recentHooks)) throw new Error("DUPLICATE_HOOK");
  const { story_type, evidence, ...content } = c;
  const text = JSON.stringify(content);
  if (/https?:|www\.|\b[a-z0-9-]+\.(?:com|co|net|org)\b/i.test(text))
    throw new Error("MODEL_LINK_REJECTED");
  for (const number of text.match(/\d+(?:[.,]\d+)*(?:%|\b)/g) ?? []) {
    if (!source.text.includes(number)) throw new Error("UNSUPPORTED_NUMBER");
  }
  if (
    !validateSocialVoice(content).ok ||
    /!/.test(text) ||
    /^ai\b/i.test(c.hook)
  )
    throw new Error("VOICE_REJECTED");
  const url = `https://opsapp.co/journal/${source.slug}`;
  return socialSubmissionSchema.parse({
    contract_version: "2026-09-01",
    source: {
      type: "blog",
      id: source.id,
      url,
      published_at: new Date(source.published_at).toISOString(),
    },
    content: {
      ...content,
      caption: `${c.caption}\n\nSource: ${url}`,
      slides: c.slides.map((s, i) => ({
        ...s,
        ...(i === 0 && source.thumbnail_url
          ? { image_url: source.thumbnail_url }
          : {}),
        alt_text: s.headline,
      })),
    },
    ...(source.thumbnail_url
      ? { media: [{ url: source.thumbnail_url, alt_text: c.alt_text }] }
      : {}),
    preferences: {
      story_type,
      format: c.slides.length === 1 ? "single" : "carousel",
    },
  });
}

export function editorialPreviewId(date: string): string {
  const hex = createHash("sha256")
    .update("ops-social-editorial-preview:" + date)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
