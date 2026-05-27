"use server";

import { revalidatePath } from "next/cache";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { loadSpecProjectMinimal } from "@/lib/admin/spec-queries";
import type {
  SpecCommunicationChannel,
  SpecCommunicationDirection,
} from "@/lib/admin/spec-types";
import { denyNonOperator, requireSpecOperatorUserId } from "./_require-operator";

const MANUAL_CHANNELS: readonly SpecCommunicationChannel[] = ["call_log", "video_message", "admin_note"];
const VALID_DIRECTIONS: readonly SpecCommunicationDirection[] = ["outbound", "inbound"];

/**
 * Manual call / video / admin-note logging. The non-email, non-system channels
 * — they get logged by Jackson after the fact (post-call write-up, video
 * message summary, internal note tied to a customer interaction).
 *
 * `email` and `system` are not allowed via this action — emails go through the
 * outbox (`send-template-email`) and system entries are written by other
 * actions (status changes, milestone fires, etc.).
 */
export async function logCommunication(formData: FormData): Promise<void> {
  const operatorId = await requireSpecOperatorUserId();
  if (!operatorId) denyNonOperator();

  const projectId = strField(formData, "project_id");
  const channelRaw = strField(formData, "channel");
  const directionRaw = strField(formData, "direction");
  const summary = strField(formData, "summary");
  const body = strField(formData, "body");

  if (!projectId) throw new Error("SYS :: MISSING PROJECT ID");
  if (!MANUAL_CHANNELS.includes(channelRaw as SpecCommunicationChannel)) {
    throw new Error("SYS :: INVALID CHANNEL — USE call_log / video_message / admin_note");
  }
  if (!VALID_DIRECTIONS.includes(directionRaw as SpecCommunicationDirection)) {
    throw new Error("SYS :: INVALID DIRECTION");
  }
  if (!summary) throw new Error("SYS :: SUMMARY REQUIRED");

  const project = await loadSpecProjectMinimal(projectId);
  if (!project) throw new Error("SYS :: PROJECT NOT FOUND");

  const db = getAdminSupabase();
  const { error } = await db.from("spec_communications").insert({
    spec_project_id: projectId,
    direction: directionRaw,
    channel: channelRaw,
    summary,
    body: body || null,
    logged_by_user_id: operatorId,
    is_test: !!project.is_test,
  });
  if (error) throw new Error(`SYS :: COMMUNICATION LOG FAILED · ${error.message}`);

  revalidatePath(`/admin/spec/${projectId}`);
}

function strField(form: FormData, key: string): string {
  const v = form.get(key);
  if (typeof v !== "string") return "";
  return v.trim();
}
