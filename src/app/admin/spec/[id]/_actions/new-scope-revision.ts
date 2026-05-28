"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { denyNonOperator, requireSpecOperatorUserId } from "./_require-operator";

/**
 * Creates a new `spec_scope_documents` row. If a prior version exists, it gets
 * stamped `superseded_at = now()` and the new row inherits the prior version's
 * content_json (operator edits via the bible / external doc, then ships a
 * follow-on revision through the same control). The new row carries
 * `version = max(version) + 1`. The first revision seeds `content_json = {}`
 * and version = 1; the operator must then add features either by editing the
 * scope JSON externally or via a future "edit scope" surface (out of scope for
 * F.2.a — the JSON is editable directly in Supabase Studio for now).
 *
 * Locks at the project level via a maybe-single read of the latest version
 * before insert — concurrent operator clicks may race; the unique
 * `(spec_project_id, version)` index in `spec_scope_documents` is the final
 * arbiter and will surface a conflict error to the slower writer.
 */
export async function newScopeRevision(formData: FormData): Promise<void> {
  const operatorId = await requireSpecOperatorUserId();
  if (!operatorId) denyNonOperator();

  const projectId = formData.get("project_id");
  if (typeof projectId !== "string" || projectId.length === 0) {
    throw new Error("SYS :: MISSING PROJECT ID");
  }

  const supabase = getAdminSupabase();

  // Validate project exists + read the test-mode flag so the new scope row
  // inherits it (admin queries default-filter `is_test = false`; a test
  // engagement's revisions must stay testy).
  const { data: project, error: projectError } = await supabase
    .from("spec_projects")
    .select("id, is_test")
    .eq("id", projectId)
    .maybeSingle();
  if (projectError) {
    throw new Error(`SYS :: PROJECT LOOKUP FAILED · ${projectError.message}`);
  }
  if (!project) throw new Error("SYS :: PROJECT NOT FOUND");

  // Find the current scope doc — the one with no `superseded_at`, or the
  // highest version if every row is somehow marked superseded.
  const { data: latest } = await supabase
    .from("spec_scope_documents")
    .select("id, version, content_json, external_url")
    .eq("spec_project_id", projectId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nowIso = new Date().toISOString();
  const nextVersion = latest ? (latest.version as number) + 1 : 1;
  const nextContent =
    (latest?.content_json as Record<string, unknown> | null) ?? {};
  const contentHash = sha256(JSON.stringify(nextContent));

  if (latest) {
    const { error: supersedeError } = await supabase
      .from("spec_scope_documents")
      .update({ superseded_at: nowIso })
      .eq("id", latest.id)
      .is("superseded_at", null);
    if (supersedeError) {
      throw new Error(`SYS :: SUPERSEDE FAILED · ${supersedeError.message}`);
    }
  }

  const { data: inserted, error: insertError } = await supabase
    .from("spec_scope_documents")
    .insert({
      spec_project_id: projectId,
      version: nextVersion,
      content_hash: contentHash,
      content_json: nextContent,
      external_url: (latest?.external_url as string | null) ?? null,
      drafted_at: nowIso,
      is_test: !!project.is_test,
    })
    .select("id")
    .maybeSingle();
  if (insertError) {
    throw new Error(`SYS :: SCOPE INSERT FAILED · ${insertError.message}`);
  }
  if (!inserted) throw new Error("SYS :: SCOPE INSERT RETURNED NO ROW");

  // Carry over the feature acceptance scaffold so the new version is
  // not empty — features are reset to `pending` (a revision implies a re-test).
  if (latest) {
    const { data: features } = await supabase
      .from("spec_feature_acceptance")
      .select("feature_name, acceptance_criteria")
      .eq("scope_document_id", latest.id);
    const rows = (features ?? []).map((f) => ({
      spec_project_id: projectId,
      scope_document_id: inserted.id as string,
      feature_name: f.feature_name as string,
      acceptance_criteria: f.acceptance_criteria as string,
      status: "pending",
      is_test: !!project.is_test,
    }));
    if (rows.length > 0) {
      const { error: copyError } = await supabase
        .from("spec_feature_acceptance")
        .insert(rows);
      if (copyError) {
        console.error("[newScopeRevision] feature copy failed:", copyError.message);
      }
    }
  }

  await supabase.from("spec_communications").insert({
    spec_project_id: projectId,
    direction: "outbound",
    channel: "system",
    summary: `Scope doc v${nextVersion} drafted (operator-initiated revision)`,
    logged_by_user_id: operatorId,
  });

  revalidatePath(`/admin/spec/${projectId}`);
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
