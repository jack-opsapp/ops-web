import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  resolveActor: vi.fn(),
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ rpc: state.rpc }),
}));
vi.mock("@/lib/email/email-route-auth", () => ({
  resolveEmailRouteActor: state.resolveActor,
}));

import { PATCH as resolveCommitment } from "@/app/api/inbox/commitments/[id]/route";
import { POST as answerAgentQuestion } from "@/app/api/inbox/threads/[id]/agent-question/answer/route";

const actor = { userId: "user-1", companyId: "company-1" } as const;

beforeEach(() => {
  vi.clearAllMocks();
  state.resolveActor.mockResolvedValue({ ok: true, actor });
  state.rpc.mockImplementation(async (name: string) => ({
    data:
      name === "answer_email_agent_question_as_system"
        ? { ok: true, memory_id: "memory-1" }
        : true,
    error: null,
  }));
});

describe("lead learning mutations", () => {
  it("answers an agent question only after a current lead-edit intersection", async () => {
    const request = new NextRequest(
      "https://ops.test/api/inbox/threads/thread-1/agent-question/answer",
      {
        method: "POST",
        body: JSON.stringify({ answer: "Steel" }),
        headers: { "content-type": "application/json" },
      }
    );

    const response = await answerAgentQuestion(request, {
      params: Promise.resolve({ id: "thread-1" }),
    });

    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith(
      "answer_email_agent_question_as_system",
      {
        p_actor_user_id: "user-1",
        p_thread_id: "thread-1",
        p_answer: "Steel",
        p_option_id: null,
      }
    );
  });

  it("passes a selected option as a locked payload assertion", async () => {
    const request = new NextRequest(
      "https://ops.test/api/inbox/threads/thread-1/agent-question/answer",
      {
        method: "POST",
        body: JSON.stringify({ answer: "Steel", optionId: "steel" }),
        headers: { "content-type": "application/json" },
      }
    );

    const response = await answerAgentQuestion(request, {
      params: Promise.resolve({ id: "thread-1" }),
    });

    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith(
      "answer_email_agent_question_as_system",
      expect.objectContaining({
        p_option_id: "steel",
      })
    );
  });

  it("keeps question persistence and clearing inside one RPC", async () => {
    const request = new NextRequest(
      "https://ops.test/api/inbox/threads/thread-1/agent-question/answer",
      {
        method: "POST",
        body: JSON.stringify({ answer: "Steel" }),
        headers: { "content-type": "application/json" },
      }
    );

    await answerAgentQuestion(request, {
      params: Promise.resolve({ id: "thread-1" }),
    });

    expect(state.rpc).toHaveBeenCalledTimes(1);
  });

  it("does not record an answer after reassignment revokes access", async () => {
    state.rpc.mockResolvedValue({
      data: { ok: false, reason: "not_found" },
      error: null,
    });
    const request = new NextRequest(
      "https://ops.test/api/inbox/threads/thread-1/agent-question/answer",
      {
        method: "POST",
        body: JSON.stringify({ answer: "Steel" }),
        headers: { "content-type": "application/json" },
      }
    );

    const response = await answerAgentQuestion(request, {
      params: Promise.resolve({ id: "thread-1" }),
    });

    expect(response.status).toBe(404);
    expect(state.rpc).toHaveBeenCalledTimes(1);
  });

  it("resolves a commitment through its source thread before mutating it", async () => {
    const request = new NextRequest(
      "https://ops.test/api/inbox/commitments/commitment-1",
      {
        method: "PATCH",
        body: JSON.stringify({ resolvedAt: "2026-07-15T18:00:00.000Z" }),
        headers: { "content-type": "application/json" },
      }
    );

    const response = await resolveCommitment(request, {
      params: Promise.resolve({ id: "commitment-1" }),
    });

    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith(
      "resolve_email_commitment_as_system",
      {
        p_actor_user_id: "user-1",
        p_memory_id: "commitment-1",
        p_resolved_at: "2026-07-15T18:00:00.000Z",
      }
    );
  });

  it("does not resolve a commitment after reassignment revokes access", async () => {
    state.rpc.mockResolvedValue({ data: false, error: null });
    const request = new NextRequest(
      "https://ops.test/api/inbox/commitments/commitment-1",
      {
        method: "PATCH",
        body: JSON.stringify({ resolvedAt: null }),
        headers: { "content-type": "application/json" },
      }
    );

    const response = await resolveCommitment(request, {
      params: Promise.resolve({ id: "commitment-1" }),
    });

    expect(response.status).toBe(404);
    expect(state.rpc).toHaveBeenCalledTimes(1);
  });
});
