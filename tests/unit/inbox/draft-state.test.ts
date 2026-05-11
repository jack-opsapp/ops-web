import { describe, it, expect } from "vitest";
import { nextDraftState, type DraftEvent } from "@/lib/inbox/draft-state";

describe("nextDraftState", () => {
  it("empty + RECEIVE_DRAFTS(>0) → drafts-available", () => {
    expect(nextDraftState("empty", { type: "RECEIVE_DRAFTS", count: 2 })).toBe(
      "drafts-available",
    );
  });

  it("empty + RECEIVE_DRAFTS(0) stays empty", () => {
    expect(nextDraftState("empty", { type: "RECEIVE_DRAFTS", count: 0 })).toBe(
      "empty",
    );
  });

  it("drafts-available + LOAD_DRAFT(claude) → ai-loaded", () => {
    expect(
      nextDraftState("drafts-available", {
        type: "LOAD_DRAFT",
        source: "claude",
      }),
    ).toBe("ai-loaded");
  });

  it("drafts-available + LOAD_DRAFT(yours) → user-typed", () => {
    expect(
      nextDraftState("drafts-available", {
        type: "LOAD_DRAFT",
        source: "yours",
      }),
    ).toBe("user-typed");
  });

  it("ai-loaded + EDIT_BODY → edited-from-claude", () => {
    expect(nextDraftState("ai-loaded", { type: "EDIT_BODY" })).toBe(
      "edited-from-claude",
    );
  });

  it("edited-from-claude + REVERT → ai-loaded", () => {
    expect(nextDraftState("edited-from-claude", { type: "REVERT" })).toBe(
      "ai-loaded",
    );
  });

  it("edited-from-claude + LOAD_DRAFT(other, confirm=true) → that state", () => {
    expect(
      nextDraftState("edited-from-claude", {
        type: "LOAD_DRAFT",
        source: "yours",
        confirmDiscard: true,
      }),
    ).toBe("user-typed");
  });

  it("edited-from-claude + LOAD_DRAFT(other, confirm=false) stays edited", () => {
    expect(
      nextDraftState("edited-from-claude", {
        type: "LOAD_DRAFT",
        source: "yours",
        confirmDiscard: false,
      }),
    ).toBe("edited-from-claude");
  });

  it("any state + SEND → empty", () => {
    const states: ("empty" | "drafts-available" | "ai-loaded" | "edited-from-claude" | "user-typed")[] = [
      "empty",
      "drafts-available",
      "ai-loaded",
      "edited-from-claude",
      "user-typed",
    ];
    for (const s of states) {
      expect(nextDraftState(s, { type: "SEND" } as DraftEvent)).toBe("empty");
    }
  });

  it("any state + CLEAR → empty", () => {
    expect(nextDraftState("ai-loaded", { type: "CLEAR" })).toBe("empty");
    expect(nextDraftState("edited-from-claude", { type: "CLEAR" })).toBe(
      "empty",
    );
  });

  it("user-typed + EDIT_BODY stays user-typed", () => {
    expect(nextDraftState("user-typed", { type: "EDIT_BODY" })).toBe(
      "user-typed",
    );
  });
});
