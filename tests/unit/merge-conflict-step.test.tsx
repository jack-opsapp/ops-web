/**
 * MergeConflictStep (Surface 1, RESOLVE step) component behavior.
 *
 * Asserts: one ConflictRow per FieldConflict; the // CONFIRM MERGE CTA is
 * disabled until EVERY conflict has an explicit pick (architect: force explicit
 * choice); selecting USE ABSORBED then confirming submits the correct
 * confirmedOverrides; // BACK returns to COMPARE; loading + error states render.
 */

import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MergeConflictStep } from "@/components/ops/merge-conflict-step";
import type { DuplicateCluster, MergeConflictsResult } from "@/lib/hooks/use-duplicate-reviews";

// t() returns the key (or the provided fallback) — assertions key off these.
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, fallback?: string) =>
      ({
        "conflict.step": "RESOLVE · STEP 2 / 2",
        "conflict.count": "{count} CONFLICTS",
        "conflict.keeping": "KEEPING",
        "conflict.winnerTag": "WINNER",
        "conflict.keepWinner": "KEEP WINNER",
        "conflict.useAbsorbed": "USE ABSORBED",
        "conflict.fromWinner": "[winner]",
        "conflict.fromAbsorbed": "[absorbed · {name}]",
        "conflict.tag": "CONFLICT",
        "conflict.confirm": "// CONFIRM MERGE",
        "conflict.back": "// BACK",
        "conflict.gateHint": "[resolve all conflicts to continue]",
        "conflict.reversible": "absorbed record is folded into {winner}",
        "conflict.scanning": "SYS :: SCANNING FIELDS",
        "conflict.error": "// ERROR — MERGE FAILED",
        "merging": "Merging...",
        "fields.contact_email": "Contact Email",
        "fields.contact_phone": "Contact Phone",
      })[key] ?? fallback ?? key,
  }),
}));

const cluster = {
  id: "cluster-1",
  entityType: "opportunity",
  reviewIds: ["r-1"],
  confidence: "high",
  signals: [],
  entities: [
    { id: "winner-1", data: { title: "CanPro Roofing" } },
    { id: "loser-1", data: { title: "Canpro Inc." } },
  ],
} as unknown as DuplicateCluster;

const conflicts: MergeConflictsResult = {
  entityType: "opportunity",
  perLoser: [
    {
      loserId: "loser-1",
      reconciliation: {
        fieldFill: {},
        conflicts: [
          { field: "contact_email", winnerValue: "a@canpro.ca", loserValue: "b@gmail.com" },
          { field: "contact_phone", winnerValue: "5551111", loserValue: "5552222" },
        ],
      },
    },
  ],
};

function setup(overrides?: Partial<React.ComponentProps<typeof MergeConflictStep>>) {
  const onConfirm = vi.fn();
  const onBack = vi.fn();
  render(
    <MergeConflictStep
      cluster={cluster}
      winnerId="winner-1"
      conflicts={conflicts}
      isLoadingConflicts={false}
      conflictsError={null}
      isMerging={false}
      mergeError={null}
      onConfirm={onConfirm}
      onBack={onBack}
      {...overrides}
    />
  );
  return { onConfirm, onBack };
}

describe("MergeConflictStep", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders one radiogroup per FieldConflict", () => {
    setup();
    expect(screen.getAllByRole("radiogroup")).toHaveLength(2);
    expect(screen.getByText(/Contact Email/)).toBeTruthy();
    expect(screen.getByText(/Contact Phone/)).toBeTruthy();
    // winner + absorbed values surfaced
    expect(screen.getByText("a@canpro.ca")).toBeTruthy();
    expect(screen.getByText("b@gmail.com")).toBeTruthy();
  });

  it("shows the conflict count and a rose CONFLICT tag per row", () => {
    setup();
    expect(screen.getByText("[2 CONFLICTS]")).toBeTruthy();
    expect(screen.getAllByText("CONFLICT")).toHaveLength(2);
  });

  it("disables // CONFIRM MERGE until every conflict is resolved", () => {
    const { onConfirm } = setup();
    const confirm = screen.getByRole("button", { name: "// CONFIRM MERGE" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    // Resolve only the first row — still gated.
    const [emailGroup] = screen.getAllByRole("radiogroup");
    fireEvent.click(within(emailGroup).getByRole("radio", { name: /KEEP WINNER/ }));
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("[resolve all conflicts to continue]")).toBeTruthy();

    // Resolve the second row — now enabled.
    const phoneGroup = screen.getAllByRole("radiogroup")[1];
    fireEvent.click(within(phoneGroup).getByRole("radio", { name: /KEEP WINNER/ }));
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("submits only USE-ABSORBED fields as confirmedOverrides", () => {
    const { onConfirm } = setup();
    const [emailGroup, phoneGroup] = screen.getAllByRole("radiogroup");
    // email → USE ABSORBED, phone → KEEP WINNER
    fireEvent.click(within(emailGroup).getByRole("radio", { name: /USE ABSORBED/ }));
    fireEvent.click(within(phoneGroup).getByRole("radio", { name: /KEEP WINNER/ }));

    fireEvent.click(screen.getByRole("button", { name: "// CONFIRM MERGE" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({
      // single loser → flat map; only the absorbed field present
      confirmedOverrides: { contact_email: "b@gmail.com" },
      resolvedCount: 2,
    });
  });

  it("// BACK returns to COMPARE", () => {
    const { onBack } = setup();
    fireEvent.click(screen.getByRole("button", { name: "// BACK" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("renders the scanning state while conflicts load", () => {
    setup({ isLoadingConflicts: true, conflicts: undefined });
    expect(screen.getByText("SYS :: SCANNING FIELDS")).toBeTruthy();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("renders the error state with the reason appended", () => {
    setup({ conflictsError: new Error("winner not found") });
    expect(screen.getByText(/\/\/ ERROR — MERGE FAILED · winner not found/)).toBeTruthy();
  });

  it("disables the CTA and shows merging copy while merging", () => {
    setup({ isMerging: true });
    const confirm = screen.getByRole("button", { name: "Merging..." });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
  });
});
