import "server-only";
import { randomUUID } from "node:crypto";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { createEditorialRepository } from "./repository";
import { editorialPreviewId } from "./policy";
import { generateEditorial } from "./generator";
import { runEditorial } from "./worker";
import { renderSocialPost } from "../render/render-social-post";
import { selectSocialTemplate } from "../template-selector";
import { createSubmissionSocialRepository } from "../repository";
import { submitSocialPost } from "../submission-service";
export async function runCloudEditorial() {
  const db = getServiceRoleClient();
  const recovery = await db.rpc("recover_social_editorial");
  if (recovery.error) throw recovery.error;
  const result = await runEditorial({
    now: () => new Date(),
    token: randomUUID,
    repository: createEditorialRepository(),
    generate: generateEditorial,
    submit: submitSocialPost,
    preview: async (pack, date) =>
      renderSocialPost({
        postId: editorialPreviewId(date),
        submission: pack.submission,
        selection: selectSocialTemplate({
          submission: pack.submission,
          idempotencyKey: `cloud-editorial-v1:${date}`,
          recentPosts:
            await createSubmissionSocialRepository().listRecentPosts(12),
        }),
      }),
  });
  const userId =
    process.env.SOCIAL_OPERATOR_USER_ID ?? process.env.PMF_OPERATOR_USER_ID;
  const companyId =
    process.env.SOCIAL_OPERATOR_COMPANY_ID ??
    process.env.PMF_OPERATOR_COMPANY_ID;
  if (userId && companyId) {
    const { error } = await db.rpc("notify_social_editorial", {
      p_user_id: userId,
      p_company_id: companyId,
    });
    if (error) throw error;
  }
  return result;
}
export async function readCloudEditorial() {
  const db = getServiceRoleClient();
  const results = await Promise.all([
    db
      .from("social_editorial_settings")
      .select("mode,monthly_budget_usd")
      .eq("id", true)
      .single(),
    db
      .from("social_editorial_runs")
      .select(
        "slot_date,kind,mode,state,attempts,package,source_snapshot,post_id,last_code,attempt_log,updated_at"
      )
      .order("slot_date", { ascending: false })
      .limit(20),
  ]);
  for (const r of results) if (r.error) throw r.error;
  return { settings: results[0].data, runs: results[1].data };
}
