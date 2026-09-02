import type { SocialPostRecord } from "./types";

export const RECONCILIATION_ERROR_CODES = new Set([
  "PUBLISH_OUTCOME_UNKNOWN",
  "PUBLISHED_ACK_NOT_PERSISTED",
  "STALE_PUBLISH_OUTCOME_UNKNOWN",
]);

export function requiresInstagramReconciliation(
  post: Pick<SocialPostRecord, "publish_stage" | "last_error_code">
): boolean {
  return (
    post.publish_stage === "publish_requested" ||
    post.publish_stage === "publish_succeeded" ||
    post.publish_stage === "reconciliation_required" ||
    (post.last_error_code !== null && RECONCILIATION_ERROR_CODES.has(post.last_error_code))
  );
}

export function canManuallyRetrySocialPost(
  post: Pick<
    SocialPostRecord,
    "status" | "last_error_code" | "publish_stage" | "rendered_assets"
  >
): boolean {
  return (
    post.status === "failed" &&
    post.rendered_assets.length > 0 &&
    post.last_error_code !== "RENDER_FAILED" &&
    post.last_error_code !== "SOCIAL_EDIT_RENDER_FAILED" &&
    post.last_error_code !== "STALE_RENDERING" &&
    !requiresInstagramReconciliation(post)
  );
}
