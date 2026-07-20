"use client";

import { create } from "zustand";

export type CommunicationDraftSurface =
  | "inbox-reply"
  | "floating-email"
  | "pipeline-follow-up";

export interface CommunicationDraftEntry {
  actorUserId: string;
  surface: CommunicationDraftSurface;
  threadId: string | null;
  opportunityId: string | null;
  instanceId: string | null;
  body: string;
  state: Record<string, unknown>;
  updatedAt: number;
}

interface CommunicationDraftStoreState {
  drafts: Record<string, CommunicationDraftEntry>;
  save: (key: string, draft: CommunicationDraftEntry) => void;
  remove: (key: string) => void;
  removeForOpportunity: (opportunityId: string) => void;
  removeForInstance: (instanceId: string) => void;
  clear: () => void;
}

export function communicationDraftKey(input: {
  actorUserId: string;
  surface: CommunicationDraftSurface;
  threadId?: string | null;
  opportunityId?: string | null;
  instanceId?: string | null;
}): string {
  return [
    input.actorUserId,
    input.surface,
    input.threadId ?? "",
    input.opportunityId ?? "",
    input.instanceId ?? "",
  ].join(":");
}

export const useCommunicationDraftStore =
  create<CommunicationDraftStoreState>()((set) => ({
    drafts: {},
    save: (key, draft) =>
      set((state) => ({ drafts: { ...state.drafts, [key]: draft } })),
    remove: (key) =>
      set((state) => {
        if (!(key in state.drafts)) return state;
        const drafts = { ...state.drafts };
        delete drafts[key];
        return { drafts };
      }),
    removeForOpportunity: (opportunityId) =>
      set((state) => ({
        drafts: Object.fromEntries(
          Object.entries(state.drafts).filter(
            ([, draft]) => draft.opportunityId !== opportunityId
          )
        ),
      })),
    removeForInstance: (instanceId) =>
      set((state) => ({
        drafts: Object.fromEntries(
          Object.entries(state.drafts).filter(
            ([, draft]) => draft.instanceId !== instanceId
          )
        ),
      })),
    clear: () => set({ drafts: {} }),
  }));
