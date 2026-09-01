"use client";

import { create } from "zustand";

/**
 * Lead-won prompt queue — bug 9a89b951, the web half of D3 in the 2026-08-18
 * lead-project-identity design (ops-software-bible/specs/plans/).
 *
 * A lead-linked project entering an active status used to win its lead as a
 * silent DB side effect. The trigger surgery shipped with the 2026-08-28 iOS
 * wave (migration `project_opportunity_link_stop_stage_side_effect`) stopped
 * that: winning now always has a human actor. This store holds the proposals
 * raised after each qualifying human status write; the root-mounted
 * `LeadWonPromptHost` presents them one at a time through the house
 * ConfirmDialog.
 *
 * Zustand rather than component state because proposals originate inside the
 * data services (LifecycleMutationService / ProjectTableService), which are
 * plain modules — `useLeadWonPromptStore.getState().enqueue(...)` works
 * outside React, mirroring how iOS hooks its DataController write path.
 */

export interface LeadWonProposal {
  /** opportunities.id — lowercase uuid, straight from the DB row. */
  opportunityId: string;
  /** projects.id the lead is linked to. The RPC re-verifies this link. */
  projectId: string;
  /**
   * Lead title, else contact name (both trimmed) — null when neither has
   * content. The host substitutes the dictionary fallback so this module
   * stays translation-free.
   */
  leadLabel: string | null;
  /** users.id of the operator who moved the status — the RPC's actor. */
  userId: string;
}

interface LeadWonPromptState {
  /** Proposal currently on screen (null = no dialog). */
  pending: LeadWonProposal | null;
  /** FIFO behind `pending` — bulk status moves can propose several at once. */
  queue: LeadWonProposal[];
  /**
   * Opportunity ids answered this session (won or declined). Suppresses a
   * re-ask during the window where the server round-trip that would make the
   * next evaluation refuse (stage=won / won_prompt_declined_at) is still in
   * flight. The durable cross-session record is the database, not this set.
   */
  answered: ReadonlySet<string>;
  /** Add a proposal. Drops duplicates and already-answered leads. */
  enqueue: (proposal: LeadWonProposal) => void;
  /** The pending proposal was ANSWERED (won or declined). Advance the queue. */
  resolvePending: () => void;
  /**
   * The pending proposal was dismissed WITHOUT an answer (Escape). Advances
   * the queue; the same lead may legitimately be proposed again by a later
   * qualifying status change — dismissal records nothing anywhere.
   */
  dismissPending: () => void;
}

export const useLeadWonPromptStore = create<LeadWonPromptState>((set, get) => ({
  pending: null,
  queue: [],
  answered: new Set<string>(),

  enqueue: (proposal) => {
    const { pending, queue, answered } = get();
    if (answered.has(proposal.opportunityId)) return;
    if (pending?.opportunityId === proposal.opportunityId) return;
    if (queue.some((queued) => queued.opportunityId === proposal.opportunityId)) {
      return;
    }
    if (pending) {
      set({ queue: [...queue, proposal] });
    } else {
      set({ pending: proposal });
    }
  },

  resolvePending: () => {
    const { pending, queue, answered } = get();
    if (!pending) return;
    const nextAnswered = new Set(answered);
    nextAnswered.add(pending.opportunityId);
    set({
      pending: queue[0] ?? null,
      queue: queue.slice(1),
      answered: nextAnswered,
    });
  },

  dismissPending: () => {
    const { pending, queue } = get();
    if (!pending) return;
    set({ pending: queue[0] ?? null, queue: queue.slice(1) });
  },
}));
