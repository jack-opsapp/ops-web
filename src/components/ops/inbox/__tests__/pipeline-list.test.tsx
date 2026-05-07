import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PipelineList, type PipelineOpp } from "../context-rail/pipeline-list";

const opps: PipelineOpp[] = [
  {
    id: "o1",
    title: "Annual maintenance contract",
    value: 8500,
    stage: "Lead",
    estimateRef: null,
    confidence: "low",
    source: "Website",
    threadId: "th-other",
  },
  {
    id: "o2",
    title: "Roof replacement quote",
    value: 22000,
    stage: "Quoted",
    estimateRef: "EST-091",
    confidence: "high",
    source: "Inbound email",
    threadId: "th-current",
  },
  {
    id: "o3",
    title: "Heater swap",
    value: 4500,
    stage: "RFQ in",
    estimateRef: null,
    confidence: "warm",
    source: "Phone",
    threadId: null,
  },
];

describe("<PipelineList>", () => {
  it("renders one section per stage with at least one opp", () => {
    render(
      <PipelineList opps={opps} threadId="th-current" onNewOpportunity={() => {}} />,
    );
    expect(screen.getByText(/^Lead$/)).toBeInTheDocument();
    expect(screen.getByText(/^Quoted$/)).toBeInTheDocument();
    expect(screen.getByText(/^RFQ in$/)).toBeInTheDocument();
    expect(screen.queryByText(/Discovery/)).not.toBeInTheDocument();
  });

  it("orders stages: Lead → Discovery → RFQ in → Quoted → others", () => {
    const { container } = render(
      <PipelineList opps={opps} threadId="th-current" onNewOpportunity={() => {}} />,
    );
    const headers = container.querySelectorAll("h4");
    const labels = Array.from(headers).map((h) => h.textContent);
    expect(labels).toEqual(["Lead", "RFQ in", "Quoted"]);
  });

  it("shows 'This thread' tag on opps linked to current threadId", () => {
    render(
      <PipelineList opps={opps} threadId="th-current" onNewOpportunity={() => {}} />,
    );
    const tags = screen.getAllByText(/This thread/i);
    expect(tags.length).toBe(1);
  });

  it("applies the accent left-bar inset shadow to the linked opp card", () => {
    render(
      <PipelineList opps={opps} threadId="th-current" onNewOpportunity={() => {}} />,
    );
    const card = screen.getByTestId("pipeline-opp-o2");
    expect(card.getAttribute("data-current")).toBe("true");
  });

  it("renders the +New opportunity button at bottom", () => {
    const onNew = vi.fn();
    render(
      <PipelineList opps={opps} threadId="th-current" onNewOpportunity={onNew} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /New opportunity/i }));
    expect(onNew).toHaveBeenCalled();
  });

  it("renders confidence as a capitalized tier label", () => {
    render(
      <PipelineList opps={opps} threadId="th-current" onNewOpportunity={() => {}} />,
    );
    expect(screen.getByText("Low")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("Warm")).toBeInTheDocument();
  });

  it("renders empty state when no opps", () => {
    render(
      <PipelineList opps={[]} threadId="th" onNewOpportunity={() => {}} />,
    );
    expect(screen.getByText(/no open opportunities/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /New opportunity/i }),
    ).toBeInTheDocument();
  });
});
