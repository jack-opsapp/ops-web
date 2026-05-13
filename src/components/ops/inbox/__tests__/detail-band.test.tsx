import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DetailBand } from "../detail-band";
import type { BandThreadInput } from "@/lib/inbox/band-selection";

const base: BandThreadInput = {
  closed: false,
  agent: { needsInput: false },
  phaseC: "none",
  aiSummary: null,
};

describe("<DetailBand>", () => {
  it("renders nothing when no band applies", () => {
    const { container } = render(
      <DetailBand thread={base} onAction={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the summary band when aiSummary is present", () => {
    render(
      <DetailBand
        thread={{
          ...base,
          aiSummary: "Calloway accepted the revised quote, follow-up due Friday.",
        }}
        summaryUpdatedAt="2026-05-06T14:55:00Z"
        onAction={() => {}}
      />,
    );
    // The compact band drops the explicit `// SUMMARY` label — the
    // agent-tinted bg + sparkle icon carry the provenance. We identify the
    // band by its aria-label and confirm the body renders.
    expect(screen.getByLabelText(/Phase C summary/i)).toBeInTheDocument();
    expect(screen.getByText(/follow-up due Friday/)).toBeInTheDocument();
  });

  it("renders the needs-input band with PROVIDE ANSWER CTA when no options", () => {
    const onAction = vi.fn();
    render(
      <DetailBand
        thread={{ ...base, agent: { needsInput: true } }}
        agentQuestion="Should I follow up with the second-floor unit?"
        onAction={onAction}
      />,
    );
    expect(screen.getByText(/PHASE C NEEDS INPUT/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /PROVIDE ANSWER/i }));
    expect(onAction).toHaveBeenCalledWith("provide-answer");
  });

  it("renders the auto-sent band when phaseC === auto_sent", () => {
    render(
      <DetailBand
        thread={{ ...base, phaseC: "auto_sent" }}
        autoSentHoursAgo={3}
        onAction={() => {}}
      />,
    );
    expect(screen.getByText(/AUTO-SENT BY PHASE C/i)).toBeInTheDocument();
    expect(screen.getByText(/3H AGO/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /TAKE OVER/i })).toBeInTheDocument();
  });

  it("renders the closed band with a soft success indicator", () => {
    render(
      <DetailBand
        thread={{ ...base, closed: true }}
        closedAt="2026-04-23T15:00:00Z"
        onAction={() => {}}
      />,
    );
    expect(screen.getByText(/CLOSED :: APR 23/i)).toBeInTheDocument();
  });

  it("needs-input band renders provided options as ghost buttons", () => {
    const onAction = vi.fn();
    render(
      <DetailBand
        thread={{ ...base, agent: { needsInput: true } }}
        agentQuestion="Which option?"
        agentOptions={[
          { id: "yes", label: "Yes" },
          { id: "no", label: "No" },
        ]}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /YES/i }));
    expect(onAction).toHaveBeenCalledWith("answer:yes");
  });

  it("stacks summary band above the action band when both apply", () => {
    render(
      <DetailBand
        thread={{
          closed: false,
          agent: { needsInput: true },
          phaseC: "none",
          aiSummary: "Calloway accepted the revised quote, follow-up due Friday.",
        }}
        summaryUpdatedAt="2026-05-06T14:55:00Z"
        agentQuestion="Should I follow up with the second-floor unit?"
        onAction={() => {}}
      />,
    );

    const summary = screen.getByLabelText(/Phase C summary/i);
    const action = screen.getByLabelText(/Phase C needs your input/i);

    expect(
      summary.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("hides the summary band when the thread is closed", () => {
    render(
      <DetailBand
        thread={{
          closed: true,
          agent: { needsInput: false },
          phaseC: "none",
          aiSummary: "Should not render — closed wins.",
        }}
        closedAt="2026-04-23T15:00:00Z"
        onAction={() => {}}
      />,
    );

    expect(screen.queryByLabelText(/Phase C summary/i)).not.toBeInTheDocument();
    expect(screen.getByText(/CLOSED :: APR 23/i)).toBeInTheDocument();
  });

  it("renders olive resolved variant when closedVariant === 'resolved'", () => {
    render(
      <DetailBand
        thread={{
          closed: true,
          agent: { needsInput: false },
          phaseC: "none",
          aiSummary: null,
        }}
        closedAt="2026-04-30T15:00:00Z"
        closedVariant="resolved"
        onAction={() => {}}
      />,
    );
    expect(
      screen.getByText(/CLOSED :: APR 30 · RESOLVED BY PHASE C/i),
    ).toBeInTheDocument();
  });
});
