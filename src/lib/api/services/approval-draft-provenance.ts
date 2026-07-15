import { requireSupabase } from "@/lib/supabase/helpers";
import type { NewThreadSubjectSource } from "@/lib/email/email-subject-policy";

export interface EnsureApprovalDraftHistoryInput {
  draftHistoryId?: string | null;
  companyId: string;
  userId: string;
  connectionId: string;
  originalDraft: string;
  subject: string;
  profileType: string;
  opportunityId?: string | null;
  threadId?: string | null;
  origin?: "operator" | "template_follow_up" | "phase_c" | "system_handoff";
  subjectSource?: NewThreadSubjectSource | "thread";
  /** True only while constructing the proposal, before an operator can edit it. */
  atProposal?: boolean;
}

export async function ensureApprovalDraftHistory(
  input: EnsureApprovalDraftHistoryInput
): Promise<string> {
  const supabase = requireSupabase();
  const subject = input.subject.trim();

  if (input.draftHistoryId) {
    if (subject) {
      const update = supabase
        .from("ai_draft_history")
        .update({
          subject,
          ...(input.atProposal ? { profile_type: input.profileType } : {}),
        })
        .eq("id", input.draftHistoryId)
        .eq("company_id", input.companyId)
        .eq("user_id", input.userId);
      const { error } = input.atProposal
        ? await update
        : await update.is("subject", null);
      if (error) {
        throw new Error(
          `Failed to preserve approval draft subject: ${error.message}`
        );
      }
    }
    return input.draftHistoryId;
  }

  if (!input.connectionId.trim()) {
    throw new Error(
      "Cannot persist approval draft without an email connection"
    );
  }
  if (!input.profileType.trim()) {
    throw new Error("Cannot persist approval draft without a profile type");
  }

  const origin = input.origin ?? "system_handoff";
  const subjectSource = subject
    ? (input.subjectSource ??
      (origin === "operator"
        ? "operator"
        : origin === "phase_c"
          ? "generated"
          : input.threadId
            ? "thread"
            : "configured"))
    : null;

  const { data, error } = await supabase
    .from("ai_draft_history")
    .insert({
      company_id: input.companyId,
      user_id: input.userId,
      connection_id: input.connectionId,
      opportunity_id: input.opportunityId ?? null,
      thread_id: input.threadId ?? null,
      original_draft: input.originalDraft,
      subject: subject || null,
      subject_source: subjectSource,
      profile_type: input.profileType,
      status: "drafted",
      origin,
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new Error(
      `Failed to persist approval draft history: ${error?.message ?? "missing inserted row"}`
    );
  }

  return String(data.id);
}
