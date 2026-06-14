"use client";

/**
 * Calls the Setup Agent (POST /api/catalog/setup/agent) to turn the owner's
 * description into validated staging cards. The route never writes — the cards
 * land on the canvas as accept/edit/reject proposals; the owner approves and the
 * Phase-3 commit persists them.
 *
 * A 503 (no OPENAI_API_KEY) throws AgentUnavailableError so the caller falls back
 * to the deterministic source picker with zero data loss (spec §16 "agent off").
 */

import { useMutation } from "@tanstack/react-query";
import type { StagingCard } from "../catalog-setup/staging-card";

export interface AgentGenerateArgs {
  description: string;
  /** Prior owner turns this session, oldest first (for follow-up answers). */
  priorTurns?: string[];
}

export interface AgentRejected {
  index: number;
  errors: { field: string; message: string }[];
}

export interface AgentResult {
  cards: StagingCard[];
  rejected: AgentRejected[];
}

export class AgentUnavailableError extends Error {
  readonly fallback: string;
  constructor(fallback: string) {
    super("Guided setup is unavailable");
    this.name = "AgentUnavailableError";
    this.fallback = fallback;
  }
}

export function useSetupAgent() {
  return useMutation<AgentResult, Error, AgentGenerateArgs>({
    mutationFn: async ({ description, priorTurns }) => {
      const { getIdToken } = await import("@/lib/firebase/auth");
      const token = await getIdToken();
      const res = await fetch("/api/catalog/setup/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, description, priorTurns }),
      });
      if (res.status === 503) {
        const j = (await res.json().catch(() => null)) as { fallback?: string } | null;
        throw new AgentUnavailableError(j?.fallback ?? "guided");
      }
      const json = (await res.json().catch(() => null)) as
        | (AgentResult & { error?: string })
        | { error?: string }
        | null;
      if (!res.ok || !json || !("cards" in json)) {
        throw new Error((json as { error?: string })?.error ?? "Generation failed");
      }
      return json as AgentResult;
    },
  });
}
