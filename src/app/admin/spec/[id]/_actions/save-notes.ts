"use server";

import { revalidatePath } from "next/cache";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { loadSpecProjectMinimal } from "@/lib/admin/spec-queries";
import { denyNonOperator, requireSpecOperatorUserId } from "./_require-operator";

const MAX_BODY_LENGTH = 50_000; // 50KB markdown — plenty for internal notes.

/**
 * Operator-only autosave for the project's internal notes.
 *
 * Storage model is append-only — each save inserts a new row in
 * `spec_internal_notes`. The UI renders the latest row as the editable
 * body and exposes prior revisions on demand. This trades disk for
 * traceability (we want to know what Jackson knew when).
 *
 * Skip the insert when the body is identical to the latest revision —
 * keeps the autosave debounce idempotent across no-op blurs.
 */
export async function saveNotes(formData: FormData): Promise<void> {
  const operatorId = await requireSpecOperatorUserId();
  if (!operatorId) denyNonOperator();

  const projectId = strField(formData, "project_id");
  const body = strFieldRaw(formData, "body");

  if (!projectId) throw new Error("SYS :: MISSING PROJECT ID");
  if (body.length > MAX_BODY_LENGTH) {
    throw new Error(`SYS :: NOTE TOO LONG · max ${MAX_BODY_LENGTH} chars`);
  }

  const project = await loadSpecProjectMinimal(projectId);
  if (!project) throw new Error("SYS :: PROJECT NOT FOUND");

  const db = getAdminSupabase();

  // Idempotency: if the latest revision body matches verbatim, do nothing.
  const { data: latest } = await db
    .from("spec_internal_notes")
    .select("id, body")
    .eq("spec_project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const latestBody = (latest as { body: string } | null)?.body ?? "";
  if (latestBody === body) {
    // No-op save — autosave fires on blur regardless of edit; skip writing
    // an empty revision.
    return;
  }

  const { error } = await db.from("spec_internal_notes").insert({
    spec_project_id: projectId,
    body,
    created_by_user_id: operatorId,
    is_test: !!project.is_test,
  });
  if (error) throw new Error(`SYS :: NOTE INSERT FAILED · ${error.message}`);

  revalidatePath(`/admin/spec/${projectId}`);
}

function strField(form: FormData, key: string): string {
  const v = form.get(key);
  if (typeof v !== "string") return "";
  return v.trim();
}

function strFieldRaw(form: FormData, key: string): string {
  const v = form.get(key);
  if (typeof v !== "string") return "";
  // Preserve leading/trailing whitespace in the body — the operator may have
  // intentional formatting at the start of the note.
  return v;
}
