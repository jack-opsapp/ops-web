import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DetailBand } from "../detail-band";
import type { BandThreadInput } from "@/lib/inbox/band-selection";

const base: BandThreadInput = {
  closed: false,
  agent: { needsInput: false },
  phaseC: "none",
  aiSummary: null,
  ballInCourt: null,
};

describe("<DetailBand>", () => {
  it("renders nothing when no band applies", () => {
    const { container } = render(
      <DetailBand thread={base} clientName="Calloway" onAction={() => {}} />,
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
        clientName="Calloway"
        summaryUpdatedAt="2026-05-06T14:55:00Z"
        onAction={() => {}}
      />,
    );
    expect(screen.getByText(/Your move/i)).toBeInTheDocument();
    expect(screen.getByText(/follow-up due Friday/)).toBeInTheDocument();
  });

  it("renders the needs-input band with PROVIDE ANSWER CTA when no options", () => {
    const onAction = vi.fn();
    render(
      <DetailBand
        thread={{ ...base, agent: { needsInput: true } }}
        clientName="Calloway"
        agentQuestion="Should I follow up with the second-floor unit?"
        onAction={onAction}
      />,
    );
    expect(screen.getByText(/Claude needs your input/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Provide answer/i }));
    expect(onAction).toHaveBeenCalledWith("provide-answer");
  });

  it("renders the ball-yours band when ballInCourt === user", () => {
    render(
      <DetailBand
        thread={{ ...base, ballInCourt: "user" }}
        clientName="Calloway"
        onAction={() => {}}
      />,
    );
    expect(screen.getByText(/Your turn/i)).toBeInTheDocument();
    expect(screen.getByText(/Calloway is waiting/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reply/i })).toBeInTheDocument();
  });

  it("renders the auto-sent band when phaseC === auto_sent", () => {
    render(
      <DetailBand
        thread={{ ...base, phaseC: "auto_sent" }}
        clientName="Calloway"
        autoSentHoursAgo={3}
        onAction={() => {}}
      />,
    );
    expect(screen.getByText(/Claude replied for you/i)).toBeInTheDocument();
    expect(screen.getByText(/3h ago/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Take over/i })).toBeInTheDocument();
  });

  it("renders the closed band with a soft success indicator", () => {
    render(
      <DetailBand
        thread={{ ...base, closed: true }}
        clientName="Calloway"
        closedAt="2026-04-23T15:00:00Z"
        onAction={() => {}}
      />,
    );
    expect(screen.getByText(/Closed Apr 23/)).toBeInTheDocument();
  });

  it("needs-input band renders provided options as ghost buttons", () => {
    const onAction = vi.fn();
    render(
      <DetailBand
        thread={{ ...base, agent: { needsInput: true } }}
        clientName="Calloway"
        agentQuestion="Which option?"
        agentOptions={[
          { id: "yes", label: "Yes" },
          { id: "no", label: "No" },
        ]}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(onAction).toHaveBeenCalledWith("answer:yes");
  });

  it("stacks summary band above the action band when both apply", () => {
    render(
      <DetailBand
        thread={{
          closed: false,
          agent: { needsInput: false },
          phaseC: "none",
          aiSummary: "Calloway accepted the revised quote, follow-up due Friday.",
          ballInCourt: "user",
        }}
        clientName="Calloway"
        summaryUpdatedAt="2026-05-06T14:55:00Z"
        onAction={() => {}}
      />,
    );

    const summary = screen.getByLabelText(/Claude summary/i);
    const action = screen.getByLabelText(/Your turn/i);

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
          ballInCourt: null,
        }}
        clientName="Calloway"
        closedAt="2026-04-23T15:00:00Z"
        onAction={() => {}}
      />,
    );

    expect(screen.queryByLabelText(/Claude summary/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Closed Apr 23/)).toBeInTheDocument();
  });
});
