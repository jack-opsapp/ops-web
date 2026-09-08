import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProjectHeader } from "../ProjectHeader";
import type { SpecProjectHeader } from "@/lib/admin/spec-types";

const header: SpecProjectHeader = {
  id: "5c0b1d2e-3f4a-4b5c-8d6e-7f8091a2b3c4",
  tier: "spec02",
  originalTier: "spec01",
  status: "discovery",
  isTest: false,
  customerLabel: "Cascade Deck & Rail",
};

describe("ProjectHeader", () => {
  it("renders the tier as its SPEC-0N designation", () => {
    render(<ProjectHeader header={header} />);
    expect(screen.getByText("SPEC-02")).toBeTruthy();
    expect(screen.queryByText("SPEC02")).toBeNull();
  });

  it("renders the upgraded-from tier as a designation too", () => {
    render(<ProjectHeader header={header} />);
    expect(screen.getByText("WAS SPEC-01")).toBeTruthy();
  });

  it("omits the upgraded-from badge when the tier never changed", () => {
    render(<ProjectHeader header={{ ...header, originalTier: "spec02" }} />);
    expect(screen.queryByText(/^WAS /)).toBeNull();
  });
});
