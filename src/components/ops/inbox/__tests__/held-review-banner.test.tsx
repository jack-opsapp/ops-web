import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { HeldReviewBanner } from "../held-review-banner";
import type { HeldReviewView } from "../held-review";

describe("<HeldReviewBanner>", () => {
  it("renders the held title, primary reason, paused chip, confidence, and directive", () => {
    const view: HeldReviewView = {
      held: true,
      reasons: ["No confirmed name or number for this sender.", "A photo here couldn't be read."],
      confidenceLabel: "48%",
    };
    render(<HeldReviewBanner view={view} />);
    expect(screen.getByText(/HELD FOR REVIEW/)).toBeInTheDocument();
    expect(screen.getByText(/No confirmed name or number/)).toBeInTheDocument();
    expect(screen.getByText(/couldn't be read/)).toBeInTheDocument();
    expect(screen.getByText(/auto-reply paused/)).toBeInTheDocument();
    expect(screen.getByText(/confidence 48%/)).toBeInTheDocument();
    expect(screen.getByText(/won't send on its own/)).toBeInTheDocument();
  });

  it("omits the confidence chip when no confidence is known", () => {
    render(
      <HeldReviewBanner view={{ held: true, reasons: ["weak identity"], confidenceLabel: null }} />,
    );
    expect(screen.queryByText(/confidence/)).not.toBeInTheDocument();
  });

  it("renders nothing when the thread is not held", () => {
    const { container } = render(
      <HeldReviewBanner view={{ held: false, reasons: [], confidenceLabel: null }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
