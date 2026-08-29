import { beforeEach, describe, expect, it } from "vitest";

import {
  useLeadWonPromptStore,
  type LeadWonProposal,
} from "@/stores/lead-won-prompt-store";

function proposal(id: string): LeadWonProposal {
  return {
    opportunityId: id,
    projectId: `project-${id}`,
    leadLabel: `Lead ${id}`,
    userId: "user-1",
  };
}

function state() {
  return useLeadWonPromptStore.getState();
}

beforeEach(() => {
  useLeadWonPromptStore.setState({
    pending: null,
    queue: [],
    answered: new Set<string>(),
  });
});

describe("useLeadWonPromptStore", () => {
  it("presents the first proposal immediately and queues the rest FIFO", () => {
    state().enqueue(proposal("a"));
    state().enqueue(proposal("b"));
    state().enqueue(proposal("c"));
    expect(state().pending?.opportunityId).toBe("a");
    expect(state().queue.map((item) => item.opportunityId)).toEqual(["b", "c"]);
  });

  it("drops duplicates of the pending proposal and of queued proposals", () => {
    state().enqueue(proposal("a"));
    state().enqueue(proposal("a"));
    state().enqueue(proposal("b"));
    state().enqueue(proposal("b"));
    expect(state().pending?.opportunityId).toBe("a");
    expect(state().queue.map((item) => item.opportunityId)).toEqual(["b"]);
  });

  it("resolve marks the lead answered, advances, and suppresses re-asks", () => {
    state().enqueue(proposal("a"));
    state().enqueue(proposal("b"));
    state().resolvePending();
    expect(state().pending?.opportunityId).toBe("b");
    expect(state().queue).toEqual([]);
    expect(state().answered.has("a")).toBe(true);

    state().enqueue(proposal("a"));
    expect(state().pending?.opportunityId).toBe("b");
    expect(state().queue).toEqual([]);
  });

  it("dismiss advances WITHOUT recording an answer — the lead may ask again", () => {
    state().enqueue(proposal("a"));
    state().dismissPending();
    expect(state().pending).toBeNull();
    expect(state().answered.has("a")).toBe(false);

    state().enqueue(proposal("a"));
    expect(state().pending?.opportunityId).toBe("a");
  });

  it("resolve and dismiss are no-ops with nothing pending", () => {
    state().resolvePending();
    state().dismissPending();
    expect(state().pending).toBeNull();
    expect(state().queue).toEqual([]);
    expect(state().answered.size).toBe(0);
  });
});
