"use server";

import { revalidatePath } from "next/cache";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { denyNonOperator, requireSpecOperatorUserId } from "./_require-operator";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Updates `spec_projects.estimated_completion_date` for the given project. Empty
 * string clears the field. Date strings are validated against an ISO date regex
 * before hitting Supabase so a malformed payload can't poison the column.
 */
export async function updateEta(formData: FormData): Promise<void> {
  const operatorId = await requireSpecOperatorUserId();
  if (!operatorId) denyNonOperator();

  const projectId = formData.get("project_id");
  if (typeof projectId !== "string" || projectId.length === 0) {
    throw new Error("SYS :: MISSING PROJECT ID");
  }

  const raw = formData.get("estimated_completion_date");
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value !== "" && !ISO_DATE_RE.test(value)) {
    throw new Error("SYS :: INVALID DATE");
  }

  const supabase = getAdminSupabase();
  const { error } = await supabase
    .from("spec_projects")
    .update({
      estimated_completion_date: value === "" ? null : value,
      updated_at: new Date().toISOString(),
    })
    .eq("id", projectId);
  if (error) {
    console.error("[updateEta] failed:", error.message);
    throw new Error(`SYS :: ETA UPDATE FAILED · ${error.message}`);
  }

  await supabase.from("spec_communications").insert({
    spec_project_id: projectId,
    direction: "outbound",
    channel: "system",
    summary:
      value === ""
        ? "Estimated completion cleared by operator"
        : `Estimated completion set to ${value}`,
    logged_by_user_id: operatorId,
  });

  revalidatePath(`/admin/spec/${projectId}`);
  revalidatePath("/admin/spec");
}
