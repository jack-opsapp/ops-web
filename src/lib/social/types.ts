import type { SocialContent } from "./contract";

export const SOCIAL_SOURCE_TYPES = [
  "blog",
  "feature",
  "insight",
  "field_dispatch",
  "performance_proof",
  "release_note",
  "roast",
  "custom",
] as const;

export const SOCIAL_STORY_TYPES = [
  "blog_signal",
  "field_dispatch",
  "operator_protocol",
  "performance_proof",
  "release_note",
  "roast_card",
] as const;

export const SOCIAL_VISUAL_TREATMENTS = [
  "editorial_cover",
  "split_signal",
  "operator_brief",
  "field_frame",
  "proof_board",
  "signal_grid",
  "roast_file",
] as const;

export const SOCIAL_POST_FORMATS = ["single", "carousel"] as const;

export const SOCIAL_POST_STATUSES = [
  "rendering",
  "review",
  "publishing",
  "published",
  "cancelled",
  "failed",
] as const;

export type SocialSourceType = (typeof SOCIAL_SOURCE_TYPES)[number];
export type SocialStoryType = (typeof SOCIAL_STORY_TYPES)[number];
export type SocialVisualTreatment = (typeof SOCIAL_VISUAL_TREATMENTS)[number];
export type SocialPostFormat = (typeof SOCIAL_POST_FORMATS)[number];
export type SocialPostStatus = (typeof SOCIAL_POST_STATUSES)[number];

export interface SocialVoiceIssue {
  path: string;
  code: "banned_language" | "audience_language" | "emoji" | "hashtag_limit";
  message: string;
}

export interface RenderedSocialAsset {
  order: number;
  url: string;
  alt_text: string;
  sha256: string;
  width: number;
  height: number;
  bytes: number;
  content_type: "image/jpeg";
  storage_key: string;
}

export interface SocialAuditEvent {
  at: string;
  actor: string;
  from?: SocialPostStatus | null;
  to?: SocialPostStatus;
  event: string;
  metadata?: Record<string, unknown>;
}

export interface SocialPostRecord {
  id: string;
  idempotency_key: string;
  contract_version: string;
  source_type: SocialSourceType;
  source_id: string | null;
  source_url: string | null;
  story_type: SocialStoryType;
  visual_treatment: SocialVisualTreatment;
  post_format: SocialPostFormat;
  content: SocialContent;
  caption: string;
  alt_text: string;
  agent_preferences: Record<string, unknown>;
  selection_metadata: Record<string, unknown>;
  rendered_assets: RenderedSocialAsset[];
  status: SocialPostStatus;
  publish_after: string;
  requested_publish_at: string | null;
  rendered_at: string | null;
  published_at: string | null;
  cancelled_at: string | null;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  claim_token: string | null;
  claim_expires_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  last_error_retryable: boolean | null;
  instagram_media_id: string | null;
  instagram_permalink: string | null;
  render_version: string;
  selector_version: string;
  voice_reference_version: string;
  created_by: string;
  updated_by: string;
  audit_log: SocialAuditEvent[];
  created_at: string;
  updated_at: string;
}
import type { SocialContent } from "./contract";
