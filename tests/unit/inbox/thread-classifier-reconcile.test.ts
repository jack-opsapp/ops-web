import { describe, it, expect } from "vitest";
import { reconcileLabelsToBallInCourt } from "@/lib/api/services/thread-classifier-service";
import type { EmailThreadLabel } from "@/lib/types/email-thread";

describe("reconcileLabelsToBallInCourt", () => {
  it("adds AWAITING_REPLY when ball_in_court is operator and label was missing", () => {
    const out = reconcileLabelsToBallInCourt(["URGENT"], "operator");
    expect(out).toContain("AWAITING_REPLY");
    expect(out).toContain("URGENT");
  });

  it("keeps AWAITING_REPLY when ball_in_court is operator and label was already there", () => {
    const out = reconcileLabelsToBallInCourt(
      ["AWAITING_REPLY", "URGENT"],
      "operator",
    );
    expect(out).toEqual(["AWAITING_REPLY", "URGENT"]);
  });

  it("strips AWAITING_REPLY when ball_in_court is counterparty", () => {
    const out = reconcileLabelsToBallInCourt(
      ["AWAITING_REPLY", "URGENT"],
      "counterparty",
    );
    expect(out).not.toContain("AWAITING_REPLY");
    expect(out).toContain("URGENT");
  });

  it("strips AWAITING_REPLY when ball_in_court is none (system/marketing/receipt)", () => {
    const out = reconcileLabelsToBallInCourt(
      ["AWAITING_REPLY", "HAS_INVOICE"],
      "none",
    );
    expect(out).not.toContain("AWAITING_REPLY");
    expect(out).toContain("HAS_INVOICE");
  });

  it("returns the same array shape when no rewrite is needed", () => {
    const labels: EmailThreadLabel[] = ["HAS_ATTACHMENT", "HAS_QUOTE"];
    expect(reconcileLabelsToBallInCourt(labels, "counterparty")).toEqual(
      labels,
    );
    expect(reconcileLabelsToBallInCourt(labels, "none")).toEqual(labels);
  });

  it("preserves unrelated labels through every transition", () => {
    const before: EmailThreadLabel[] = [
      "URGENT",
      "HAS_ATTACHMENT",
      "HAS_QUOTE",
      "HAS_INVOICE",
      "FROM_NEW_SENDER",
    ];
    const opOut = reconcileLabelsToBallInCourt(before, "operator");
    for (const l of before) expect(opOut).toContain(l);
    expect(opOut).toContain("AWAITING_REPLY");

    const cpOut = reconcileLabelsToBallInCourt(
      [...before, "AWAITING_REPLY"],
      "counterparty",
    );
    for (const l of before) expect(cpOut).toContain(l);
    expect(cpOut).not.toContain("AWAITING_REPLY");
  });
});
