import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AiDraftBanner } from "../composer/ai-draft-banner";

describe("<AiDraftBanner>", () => {
  it("renders the PHASE C DRAFTED THIS · review label", () => {
    render(<AiDraftBanner draftedAt="2026-05-06T14:55:00Z" />);
    expect(screen.getByText(/PHASE C DRAFTED THIS/)).toBeInTheDocument();
    expect(screen.getByText(/review/i)).toBeInTheDocument();
  });

  it("renders the relative timestamp", () => {
    render(
      <AiDraftBanner
        draftedAt="2026-05-06T14:55:00Z"
        renderedAt={new Date("2026-05-06T15:00:00Z").getTime()}
      />,
    );
    expect(screen.getByText(/5m/i)).toBeInTheDocument();
  });
});
