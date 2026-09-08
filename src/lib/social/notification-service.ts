import "server-only";

import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { getEditorialOperator } from "./editorial/operator";
import type { SocialPostRecord } from "./types";

// One resolver for every Instagram rail item. The production operator values
// carry trailing whitespace; an untrimmed company id fails the notifications
// canonical-id check, which is why the first queued post raised no alert.
function recipients(): { userId: string; companyId: string } | null {
  return getEditorialOperator(process.env);
}

const launchTimeFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "Etc/GMT+7",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** `Sep 08 · 10:00` — Vancouver local, the only clock the operator reads. */
export function formatSocialLaunchTime(publishAfter: string): string {
  const parts = Object.fromEntries(
    launchTimeFormat
      .formatToParts(new Date(publishAfter))
      .map((part) => [part.type, part.value])
  );
  return `${parts.month} ${parts.day} · ${parts.hour}:${parts.minute}`;
}

/**
 * The operator is told when the post goes out and where to stop it. A queued
 * post with no launch time falls back to the fixed ten-minute veto window.
 */
export function socialReviewNotification(post: SocialPostRecord): {
  title: string;
  body: string;
} {
  const launchAt =
    post.publish_after && !Number.isNaN(Date.parse(post.publish_after))
      ? formatSocialLaunchTime(post.publish_after)
      : null;
  return {
    title: `INSTAGRAM POST QUEUED · ${post.id.slice(0, 8).toUpperCase()}`,
    body: launchAt
      ? `Publishes ${launchAt} unless stopped. Edit or stop from Social.`
      : "Publishing starts in 10 minutes unless stopped. Edit or stop from Social.",
  };
}

export async function createSocialReviewNotification(
  post: SocialPostRecord
): Promise<void> {
  const recipient = recipients();
  if (!recipient) {
    console.warn(
      "[social] Review notification skipped: operator recipient is not configured"
    );
    return;
  }

  const { title, body } = socialReviewNotification(post);
  const { error } = await getServiceRoleClient()
    .from("notifications")
    .insert({
      user_id: recipient.userId,
      company_id: recipient.companyId,
      type: "social_post_review",
      title,
      body,
      is_read: false,
      persistent: true,
      action_url: `/admin/social?post=${post.id}`,
      action_label: "REVIEW POST",
    });
  if (error) throw new Error(`Review notification failed: ${error.message}`);
}

export async function resolveSocialReviewNotification(
  postId: string
): Promise<void> {
  const recipient = recipients();
  if (!recipient) return;
  const { error } = await getServiceRoleClient()
    .from("notifications")
    .update({ is_read: true, resolved_at: new Date().toISOString() })
    .eq("user_id", recipient.userId)
    .eq("company_id", recipient.companyId)
    .eq("type", "social_post_review")
    .eq("action_url", `/admin/social?post=${postId}`)
    .eq("is_read", false);
  if (error)
    throw new Error(`Review notification resolution failed: ${error.message}`);
}

export async function createSocialPublishedNotification(
  post: SocialPostRecord,
  _permalink: string | null
): Promise<void> {
  const recipient = recipients();
  if (!recipient) return;
  const { error } = await getServiceRoleClient()
    .from("notifications")
    .insert({
      user_id: recipient.userId,
      company_id: recipient.companyId,
      type: "social_post_published",
      title: `INSTAGRAM POST LIVE · ${post.id.slice(0, 8).toUpperCase()}`,
      body: "The queued Instagram post is published.",
      is_read: false,
      persistent: false,
      action_url: `/admin/social?post=${post.id}`,
      action_label: "VIEW POST",
    });
  if (error) throw new Error(`Published notification failed: ${error.message}`);
}

/**
 * The database RPC inserts the persistent rail item and acknowledges its
 * leased outbox row in one transaction. A failed call leaves the lease to
 * expire so a later publisher run can replay it without losing the alert.
 */
export async function createSocialRecoveryNotification(
  post: SocialPostRecord,
  recoveryClaimToken: string | null
): Promise<void> {
  const recipient = recipients();
  if (!recipient) {
    throw new Error("Social recovery notification recipient is not configured");
  }
  if (!recoveryClaimToken) {
    throw new Error("Social recovery notification claim is missing");
  }

  const { data, error } = await getServiceRoleClient().rpc(
    "deliver_social_recovery_notification",
    {
      p_post_id: post.id,
      p_claim_token: recoveryClaimToken,
      p_user_id: recipient.userId,
      p_company_id: recipient.companyId,
    }
  );
  if (error) throw new Error(`Recovery notification failed: ${error.message}`);
  if (data !== true)
    throw new Error("Recovery notification claim is no longer owned");
}
