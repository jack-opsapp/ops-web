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
 * Auth: canonical OPS actor + current `pipeline.edit` ∩ `inbox.view`
 * authority for the lead linked to this internal thread.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { resolveEmailRouteActor } from "@/lib/email/email-route-auth";

interface AnswerBody {
  answer: string;
  optionId?: string | null;
}

function isValidBody(v: unknown): v is AnswerBody {
  if (!v || typeof v !== "object") return false;
  const b = v as Record<string, unknown>;
  if (typeof b.answer !== "string" || b.answer.trim().length === 0)
    return false;
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
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const actorResolution = await resolveEmailRouteActor(request);
  if (!actorResolution.ok) return actorResolution.response;
  const { userId } = actorResolution.actor;

  const body = (await request.json().catch(() => null)) as unknown;
  if (!isValidBody(body)) {
    return NextResponse.json(
      {
        error:
          "Body must include `answer` (non-empty string); `optionId` is optional",
      },
      { status: 400 }
    );
  }

  const supabase = getServiceRoleClient();
  const { data, error: memoryError } = await supabase.rpc(
    "answer_email_agent_question_as_system",
    {
      p_actor_user_id: userId,
      p_thread_id: id,
      p_answer: body.answer.trim(),
      p_option_id: body.optionId?.trim() || null,
    }
  );
  if (memoryError) {
    console.error(
      "[/api/inbox/threads/:id/agent-question/answer] memory insert failed:",
      memoryError.message
    );
    return NextResponse.json(
      { error: `Failed to record answer: ${memoryError.message}` },
      { status: 500 }
    );
  }
  const result = data as { ok?: boolean; reason?: string } | null;
  if (!result?.ok) {
    if (
      result?.reason === "no_pending_question" ||
      result?.reason === "invalid_option" ||
      result?.reason === "invalid_input"
    ) {
      return NextResponse.json(
        { error: "No matching pending question" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Thread not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true });
}
