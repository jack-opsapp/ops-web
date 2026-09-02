import "server-only";

import { getServiceRoleClient } from "@/lib/supabase/server-client";
import type { SocialPostRecord } from "./types";

function recipients(): { userId: string; companyId: string } | null {
  const userId = process.env.SOCIAL_OPERATOR_USER_ID ?? process.env.PMF_OPERATOR_USER_ID;
  const companyId = process.env.SOCIAL_OPERATOR_COMPANY_ID ?? process.env.PMF_OPERATOR_COMPANY_ID;
  return userId && companyId ? { userId, companyId } : null;
}

export async function createSocialReviewNotification(post: SocialPostRecord): Promise<void> {
  const recipient = recipients();
  if (!recipient) {
    console.warn("[social] Review notification skipped: operator recipient is not configured");
    return;
  }

  const { error } = await getServiceRoleClient().from("notifications").insert({
    user_id: recipient.userId,
    company_id: recipient.companyId,
    type: "social_post_review",
    title: `SOCIAL POST READY · ${post.id.slice(0, 8).toUpperCase()}`,
    body: "Instagram post enters the publishing queue in 10 minutes unless stopped.",
    is_read: false,
    persistent: true,
    action_url: `/admin/social?post=${post.id}`,
    action_label: "REVIEW POST",
  });
  if (error) throw new Error(`Review notification failed: ${error.message}`);
}

export async function resolveSocialReviewNotification(postId: string): Promise<void> {
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
  if (error) throw new Error(`Review notification resolution failed: ${error.message}`);
}

export async function createSocialPublishedNotification(
  post: SocialPostRecord,
  _permalink: string | null
): Promise<void> {
  const recipient = recipients();
  if (!recipient) return;
  const { error } = await getServiceRoleClient().from("notifications").insert({
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
  if (data !== true) throw new Error("Recovery notification claim is no longer owned");
}
