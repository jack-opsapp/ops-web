/**
 * OPS Web — Inbox Agent-Question Answer
 *
 * POST /api/inbox/threads/{id}/agent-question/answer
 *   Body: { answer: string, optionId?: string | null }
 *
 * The detail view's lavender NEEDS_INPUT band fires when a thread carries
 * an unresolved `email_threads.agent_blocking_question`. When the operator
 * picks a quick-pick option or types a free-form reply, this endpoint:
 *
 *   1. Records the (question, answer) pair to `agent_memories` so the
 *      next Phase C pass can pick it up as operator context — no
 *      information is lost when the column is cleared.
 *   2. Clears `email_threads.agent_blocking_question` to NULL so the
 *      band drops and the thread returns to its normal grouping.
 *
 * The redraft pipeline isn't wired here — Phase C reads the new memory on
 * its next pass. Until that wiring lands, the operator's answer still
 * lives in agent_memories as a durable record.
 *
 * Auth: Firebase JWT + `inbox.view` permission (same gate as reading the
 * inbox; answering is a per-user triage action, not an admin op).
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";

interface AnswerBody {
  answer: string;
  optionId?: string | null;
}

function isValidBody(v: unknown): v is AnswerBody {
  if (!v || typeof v !== "object") return false;
  const b = v as Record<string, unknown>;
  if (typeof b.answer !== "string" || b.answer.trim().length === 0) return false;
  if (
    "optionId" in b &&
    b.optionId !== null &&
    b.optionId !== undefined &&
    typeof b.optionId !== "string"
  ) {
    return false;
  }
  return true;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authUser = await verifyAdminAuth(request);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const user = await findUserByAuth(
    authUser.uid,
    authUser.email,
    "id, company_id",
  );
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const userId = user.id as string;
  const companyId = user.company_id as string;

  const canView = await checkPermissionById(userId, "inbox.view");
  if (!canView) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as unknown;
  if (!isValidBody(body)) {
    return NextResponse.json(
      {
        error: "Body must include `answer` (non-empty string); `optionId` is optional",
      },
      { status: 400 },
    );
  }

  const supabase = getServiceRoleClient();

  // Verify the thread belongs to the caller's company and read the current
  // question payload — we need it so the audit row in agent_memories
  // captures both sides of the exchange even after we clear the column.
  const { data: row, error: readError } = await supabase
    .from("email_threads")
    .select("id, agent_blocking_question")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();

  if (readError || !row) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  const existing = row.agent_blocking_question as Record<string, unknown> | null;
  if (!existing || typeof existing !== "object") {
    return NextResponse.json(
      { error: "No pending agent question on this thread" },
      { status: 400 },
    );
  }

  // Record the (question, answer) pair to agent_memories. Phase C reads
  // memories with `category='answered_question'` on its next pass to feed
  // the operator's answer into a fresh draft. We persist the optionId
  // when set so structured replies are queryable downstream.
  const memoryContent = JSON.stringify({
    question: existing.question ?? null,
    options: existing.options ?? null,
    asked_at: existing.asked_at ?? null,
    answer: body.answer.trim(),
    option_id: body.optionId ?? null,
    answered_at: new Date().toISOString(),
    answered_by_user_id: userId,
  });

  const { error: memoryError } = await supabase
    .from("agent_memories")
    .insert({
      company_id: companyId,
      user_id: userId,
      memory_type: "fact",
      category: "answered_question",
      content: memoryContent,
      confidence: 1.0,
      source: "inbox_ui",
      source_id: id,
    });

  if (memoryError) {
    console.error(
      "[/api/inbox/threads/:id/agent-question/answer] memory insert failed:",
      memoryError.message,
    );
    return NextResponse.json(
      { error: `Failed to record answer: ${memoryError.message}` },
      { status: 500 },
    );
  }

  // Clear the column. The band drops and the thread re-groups normally
  // on the next inbox refetch.
  const { error: updateError } = await supabase
    .from("email_threads")
    .update({ agent_blocking_question: null })
    .eq("id", id)
    .eq("company_id", companyId);

  if (updateError) {
    console.error(
      "[/api/inbox/threads/:id/agent-question/answer] clear failed:",
      updateError.message,
    );
    return NextResponse.json(
      { error: `Failed to clear question: ${updateError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
