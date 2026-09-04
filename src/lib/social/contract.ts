import { z } from "zod";
import {
  SOCIAL_POST_FORMATS,
  SOCIAL_SOURCE_TYPES,
  SOCIAL_STORY_TYPES,
  SOCIAL_VISUAL_TREATMENTS,
} from "./types";

export const SOCIAL_CONTRACT_VERSION = "2026-09-01" as const;

const requiredText = (label: string, max: number) =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be ${max} characters or fewer`);

const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();

const httpsUrl = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === "https:", "URL must use HTTPS");

export const socialSlideSchema = z
  .object({
    eyebrow: optionalText(40),
    headline: requiredText("Slide headline", 100),
    body: optionalText(350),
    image_url: httpsUrl.optional(),
    alt_text: optionalText(500),
  })
  .strict();

export const socialContentSchema = z
  .object({
    title: requiredText("Title", 100),
    subtitle: optionalText(160),
    date: optionalText(40),
    hook: requiredText("Hook", 90),
    angle: requiredText("Angle", 220),
    caption: requiredText("Caption", 2200),
    cta: optionalText(120),
    alt_text: requiredText("Alt text", 1000),
    slides: z.array(socialSlideSchema).min(1).max(10),
  })
  .strict();

export const socialSubmissionSchema = z
  .object({
    contract_version: z.literal(SOCIAL_CONTRACT_VERSION),
    source: z
      .object({
        type: z.enum(SOCIAL_SOURCE_TYPES),
        id: optionalText(200),
        url: httpsUrl.optional(),
        published_at: z.string().datetime({ offset: true }).optional(),
      })
      .strict()
      .superRefine((source, context) => {
        if (source.type === "blog" && !source.id) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["id"],
            message: "A live blog source ID is required",
          });
        }
      }),
    content: socialContentSchema,
    media: z
      .array(
        z
          .object({
            url: httpsUrl,
            alt_text: requiredText("Media alt text", 500),
          })
          .strict()
      )
      .max(10)
      .optional(),
    preferences: z
      .object({
        story_type: z.enum(SOCIAL_STORY_TYPES).optional(),
        visual_treatment: z.enum(SOCIAL_VISUAL_TREATMENTS).optional(),
        format: z.enum(SOCIAL_POST_FORMATS).optional(),
      })
      .strict()
      .optional(),
    publish_at: z
      .string()
      .datetime({ offset: true })
      .refine((value) => Date.parse(value) > Date.now(), "Publish time must be in the future")
      .optional(),
  })
  .strict()
  .superRefine((submission, context) => {
    const explicitFormat = submission.preferences?.format;
    const slideCount = submission.content.slides.length;

    if (explicitFormat === "carousel" && slideCount < 2) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["preferences", "format"],
        message: "Carousel format requires at least two slides",
      });
    }

    if (explicitFormat === "single" && slideCount !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["preferences", "format"],
        message: "Single format requires exactly one slide",
      });
    }
  });

export type SocialSubmission = z.infer<typeof socialSubmissionSchema>;
export type SocialContent = z.infer<typeof socialContentSchema>;
export type SocialSlide = z.infer<typeof socialSlideSchema>;
