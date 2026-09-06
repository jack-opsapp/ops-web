import "server-only";
import { randomUUID } from "node:crypto";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { createEditorialRepository } from "./repository";
import { editorialPreviewId } from "./policy";
import { generateEditorial } from "./generator";
import { loadCopywritingReference } from "./copywriting-reference";
import { getEditorialOperator } from "./operator";
import { runEditorial } from "./worker";
import { renderSocialPost } from "../render/render-social-post";
import { selectSocialTemplate } from "../template-selector";
import { createSubmissionSocialRepository } from "../repository";
import { submitSocialPost } from "../submission-service";
export async function runCloudEditorial(
  options: { prepareDate?: string } = {}
) {
  const { path, sha256 } = loadCopywritingReference();
  const db = getServiceRoleClient();
  if (options.prepareDate) {
    const { data, error } = await db
      .from("social_editorial_settings")
      .select("mode")
      .eq("id", true)
      .single();
    if (error) throw error;
    if (data.mode !== "prepare") return { state: "preparation_disabled" };
  }
  const recovery = await db.rpc("recover_social_editorial");
  if (recovery.error) throw recovery.error;
  const result = await runEditorial(
    {
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
    },
    options
  );
  const operator = getEditorialOperator(process.env);
  if (operator) {
    const { error } = await db.rpc("notify_social_editorial", {
      p_user_id: operator.userId,
      p_company_id: operator.companyId,
    });
    if (error) throw error;
  }
  return { ...result, copywriting_reference: { path, sha256 } };
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
