// src/lib/api/services/conversation-state/persist-routing.ts
//
// Phase 3 — persist the deterministic router decision onto the thread so the
// inbox can SURFACE why a thread is held for review without rebuilding state.
//
// This is the ONLY side-effecting write of the router decision; buildConversation
// State stays pure (fetch + compute, no writes) so it remains unit-testable. The
// write is fully NON-FATAL — a failure here must never break sync or drafting.

import { requireSupabase } from "@/lib/supabase/helpers";
import type { ConversationState } from "./types";

/**
 * Persist a thread's routing decision (routing / reasons / confidence) to
 * `email_threads`, keyed by the INTERNAL thread id (email_threads.id). Called
 * right after buildConversationState at the points that already build state
 * (sync accept-evaluation + drafting). Non-fatal: logs and swallows any error.
 */
export async function persistRoutingDecision(
  internalThreadId: string,
  state: Pick<ConversationState, "routing" | "routingReasons" | "confidence">
): Promise<void> {
  try {
    const supabase = requireSupabase();
    const { error } = await supabase
      .from("email_threads")
      .update({
        routing: state.routing,
        routing_reasons: state.routingReasons,
        router_confidence: state.confidence,
        router_computed_at: new Date().toISOString(),
      })
      .eq("id", internalThreadId);
    if (error) {
      console.error("[persist-routing] update failed (non-fatal):", error.message);
    }
  } catch (err) {
    console.error("[persist-routing] failed (non-fatal):", err);
  }
}
