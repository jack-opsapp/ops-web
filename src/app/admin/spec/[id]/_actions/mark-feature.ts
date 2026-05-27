"use server";

import { revalidatePath } from "next/cache";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { denyNonOperator, requireSpecOperatorUserId } from "./_require-operator";

const VALID_TARGETS = new Set(["pending", "passing", "failing"]);

/**
 * Mark a `spec_feature_acceptance` row as passing / failing / pending. Operator
 * verification is on the user, not on the feature; the action also confirms the
 * feature belongs to the supplied project to prevent URL-guess writes against
 * another engagement's features. `verified_at` is stamped when the new status
 * is `passing` or `failing` (the verifying event) and cleared when reset to
 * pending.
 */
export async function markFeature(formData: FormData): Promise<void> {
  const operatorId = await requireSpecOperatorUserId();
  if (!operatorId) denyNonOperator();

  const projectId = formData.get("project_id");
  const featureId = formData.get("feature_id");
  const targetStatus = formData.get("target_status");
  if (typeof projectId !== "string" || typeof featureId !== "string") {
    throw new Error("SYS :: MISSING PROJECT OR FEATURE ID");
  }
  if (typeof targetStatus !== "string" || !VALID_TARGETS.has(targetStatus)) {
    throw new Error("SYS :: INVALID TARGET STATUS");
  }

  const supabase = getAdminSupabase();

  // Verify the feature belongs to this project — prevents cross-project writes.
  const { data: feature, error: lookupError } = await supabase
    .from("spec_feature_acceptance")
    .select("id, spec_project_id, feature_name, status")
    .eq("id", featureId)
    .maybeSingle();
  if (lookupError) {
    throw new Error(`SYS :: FEATURE LOOKUP FAILED · ${lookupError.message}`);
  }
  if (!feature || feature.spec_project_id !== projectId) {
    throw new Error("SYS :: FEATURE / PROJECT MISMATCH");
  }

  const nowIso = new Date().toISOString();
  const update: Record<string, unknown> = {
    status: targetStatus,
    verified_at: targetStatus === "pending" ? null : nowIso,
    verified_by_user_id: targetStatus === "pending" ? null : operatorId,
  };
  if (targetStatus !== "failing") {
    update.failure_notes = null;
  }

  const { error: updateError } = await supabase
    .from("spec_feature_acceptance")
    .update(update)
    .eq("id", featureId);
  if (updateError) {
    throw new Error(`SYS :: FEATURE UPDATE FAILED · ${updateError.message}`);
  }

  await supabase.from("spec_communications").insert({
    spec_project_id: projectId,
    direction: "outbound",
    channel: "system",
    summary: `Feature "${feature.feature_name as string}" marked ${targetStatus}`,
    logged_by_user_id: operatorId,
  });

  revalidatePath(`/admin/spec/${projectId}`);
}
