import { describe, it, expect } from "vitest";
import {
  derivePhaseC,
  type PhaseCDraftRow,
  type PhaseCThreadInput,
} from "@/lib/inbox/phase-c-derivation";

const inboundThread: PhaseCThreadInput = { latestDirection: "inbound" };
const outboundThread: PhaseCThreadInput = { latestDirection: "outbound" };
const unclassifiedThread: PhaseCThreadInput = { latestDirection: null };

const draftedRow: PhaseCDraftRow = {
  status: "drafted",
  sent_without_changes: false,
};
const autoSentRow: PhaseCDraftRow = {
  status: "sent",
  sent_without_changes: true,
};
const userEditedSentRow: PhaseCDraftRow = {
  status: "sent",
  sent_without_changes: false,
};
const discardedRow: PhaseCDraftRow = {
  status: "discarded",
  sent_without_changes: false,
};

describe("derivePhaseC", () => {
  it("returns 'none' when no draft row exists", () => {
    expect(derivePhaseC(inboundThread, null)).toBe("none");
    expect(derivePhaseC(outboundThread, null)).toBe("none");
  });

  it("returns 'ai_drafted' for status='drafted' regardless of direction", () => {
    expect(derivePhaseC(inboundThread, draftedRow)).toBe("ai_drafted");
    expect(derivePhaseC(outboundThread, draftedRow)).toBe("ai_drafted");
    expect(derivePhaseC(unclassifiedThread, draftedRow)).toBe("ai_drafted");
  });

  it("returns 'auto_sent' for status='sent' + sent_without_changes + outbound", () => {
    expect(derivePhaseC(outboundThread, autoSentRow)).toBe("auto_sent");
  });

  it("does NOT pin auto_sent once a new inbound reply has landed", () => {
    // Same draft row — the only difference is latestDirection flipped to
    // inbound. This is the precise case `grouping.ts` would otherwise hide.
    expect(derivePhaseC(inboundThread, autoSentRow)).toBe("none");
  });

  it("returns 'none' for user-edited sent drafts (not autonomous)", () => {
    expect(derivePhaseC(outboundThread, userEditedSentRow)).toBe("none");
    expect(derivePhaseC(inboundThread, userEditedSentRow)).toBe("none");
  });

  it("returns 'none' for discarded drafts", () => {
    expect(derivePhaseC(outboundThread, discardedRow)).toBe("none");
    expect(derivePhaseC(inboundThread, discardedRow)).toBe("none");
  });

  it("treats null sent_without_changes as not-autonomous", () => {
    // The column is nullable — a row with sent_without_changes=null is a
    // legacy / partial write. Treat it as "user-touched" (safer default —
    // we don't claim auto-send authority on ambiguous rows).
    expect(
      derivePhaseC(outboundThread, { status: "sent", sent_without_changes: null }),
    ).toBe("none");
  });

  it("returns 'none' for unknown status values", () => {
    // Defensive — a future status enum addition shouldn't cause auto_sent
    // or ai_drafted to fire spuriously.
    expect(
      derivePhaseC(outboundThread, {
        status: "scheduled",
        sent_without_changes: true,
      }),
    ).toBe("none");
  });
});
