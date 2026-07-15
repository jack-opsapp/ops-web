import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import {
  PipelineList,
  PipelineOppCard,
  type PipelineOpp,
} from "../context-rail/pipeline-list";

const opps: PipelineOpp[] = [
  {
    id: "o1",
    title: "Annual maintenance contract",
    value: 8500,
    stage: "Lead",
    estimateRef: null,
    priority: "medium",
    source: "Website",
    threadId: "th-other",
  },
  {
    id: "o2",
    title: "Roof replacement quote",
    value: 22000,
    stage: "Quoted",
    estimateRef: "EST-091",
    priority: "high",
    source: "Inbound email",
    threadId: "th-current",
  },
  {
    id: "o3",
    title: "Heater swap",
    value: 4500,
    stage: "RFQ in",
    estimateRef: null,
    priority: "low",
    source: "Phone",
    threadId: null,
  },
];

describe("<PipelineList>", () => {
  it("renders one section per stage with at least one opp", () => {
    render(
      <PipelineList
        opps={opps}
        threadId="th-current"
        onNewOpportunity={() => {}}
      />
    );
    const headers = Array.from(document.querySelectorAll("h4")).map(
      (h) => h.textContent
    );
    expect(headers).toEqual(["LEAD", "RFQ IN", "QUOTED"]);
    expect(screen.queryByText(/DISCOVERY/)).not.toBeInTheDocument();
  });

  it("orders stages: Lead → Discovery → RFQ in → Quoted → others", () => {
    const { container } = render(
      <PipelineList
        opps={opps}
        threadId="th-current"
        onNewOpportunity={() => {}}
      />
    );
    const headers = container.querySelectorAll("h4");
    const labels = Array.from(headers).map((h) => h.textContent);
    expect(labels).toEqual(["LEAD", "RFQ IN", "QUOTED"]);
  });

  it("shows a quiet linked-thread signal on opps linked to current threadId", () => {
    render(
      <PipelineList
        opps={opps}
        threadId="th-current"
        onNewOpportunity={() => {}}
      />
    );
    const tags = screen.getAllByText(/\[THIS THREAD\]/i);
    expect(tags.length).toBe(1);
    const card = screen.getByTestId("pipeline-opp-o2");
    expect(within(card).getByTestId("pipeline-opp-linked-o2")).toHaveClass(
      "text-text-2"
    );
  });

  it("marks the linked opp card without the old accent inset shadow", () => {
    render(
      <PipelineList
        opps={opps}
        threadId="th-current"
        onNewOpportunity={() => {}}
      />
    );
    const card = screen.getByTestId("pipeline-opp-o2");
    expect(card.getAttribute("data-current")).toBe("true");
    expect(card.className).not.toContain("shadow-");
    expect(card).toHaveClass("border-line-hi");
    expect(card.className).not.toContain("bg" + "-inbox");
    expect(card.className).toContain("bg-transparent");
  });

  it("renders active card hierarchy: title, stage, value, priority, and source", () => {
    render(
      <PipelineList
        opps={opps}
        threadId="th-current"
        onNewOpportunity={() => {}}
      />
    );
    const card = screen.getByTestId("pipeline-opp-o2");
    expect(within(card).getByTestId("pipeline-opp-title-o2")).toHaveTextContent(
      "Roof replacement quote"
    );
    expect(within(card).getByTestId("pipeline-opp-value-o2")).toHaveTextContent(
      "$22,000"
    );
    expect(within(card).getByTestId("pipeline-opp-stage-o2")).toHaveTextContent(
      "QUOTED"
    );
    expect(
      within(card).getByTestId("pipeline-opp-priority-o2")
    ).toHaveTextContent("HIGH");
    expect(
      within(card).getByTestId("pipeline-opp-source-o2")
    ).toHaveTextContent("INBOUND EMAIL");
  });

  it("renders the +New opportunity button at bottom", () => {
    const onNew = vi.fn();
    render(
      <PipelineList
        opps={opps}
        threadId="th-current"
        onNewOpportunity={onNew}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /New opportunity/i }));
    expect(onNew).toHaveBeenCalled();
  });

  it("ignores the legacy win-probability-derived intent label", () => {
    const legacyProbabilitySignal = [
      { ...opps[1], priority: null, confidence: "high" as const },
    ];
    render(
      <PipelineList
        opps={legacyProbabilitySignal}
        threadId="th-current"
        onNewOpportunity={() => {}}
      />
    );
    expect(screen.queryByText(/INTENT/)).not.toBeInTheDocument();
  });

  it("renders empty state when no opps", () => {
    render(
      <PipelineList opps={[]} threadId="th" onNewOpportunity={() => {}} />
    );
    expect(screen.getByText(/no open opportunities/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /New opportunity/i })
    ).toBeInTheDocument();
  });

  it("suppresses the empty body when suppressEmpty is set, but keeps the +New button", () => {
    render(
      <PipelineList
        opps={[]}
        threadId="th"
        onNewOpportunity={() => {}}
        suppressEmpty
      />
    );
    expect(
      screen.queryByText(/no open opportunities/i)
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /New opportunity/i })
    ).toBeInTheDocument();
  });
});

describe("<PipelineOppCard>", () => {
  const oppFixture: PipelineOpp = {
    id: "won-1",
    title: "Skylight install",
    value: 12000,
    stage: "won",
    estimateRef: null,
    priority: "high",
    source: "Referral",
    threadId: null,
  };

  it("renders a muted WON history row when variant='won'", () => {
    render(
      <ul>
        <PipelineOppCard opp={oppFixture} currentThreadId="" variant="won" />
      </ul>
    );
    const card = screen.getByTestId("pipeline-opp-won-1");
    expect(card.getAttribute("data-variant")).toBe("won");
    // Linked treatment is forbidden on WON cards even if the threadId
    // happens to match — closed business isn't "the current thread".
    expect(card.getAttribute("data-current")).toBe("false");
    expect(within(card).getByText(/^WON$/)).toBeInTheDocument();
    expect(card).toHaveClass("bg-transparent");
    expect(card).toHaveClass("border-line/60");
    expect(within(card).getByTestId("pipeline-opp-title-won-1")).toHaveClass(
      "text-text-3"
    );
    expect(within(card).getByTestId("pipeline-opp-value-won-1")).toHaveClass(
      "text-text-3"
    );
  });

  it("renders the standard open card when variant is omitted", () => {
    render(
      <ul>
        <PipelineOppCard
          opp={{ ...oppFixture, stage: "Lead" }}
          currentThreadId=""
        />
      </ul>
    );
    const card = screen.getByTestId("pipeline-opp-won-1");
    expect(card.getAttribute("data-variant")).toBe("open");
    expect(screen.queryByText(/^WON$/)).not.toBeInTheDocument();
  });

  it("never renders the linked-thread treatment on a WON card even when threadIds match", () => {
    const matched: PipelineOpp = { ...oppFixture, threadId: "th-current" };
    render(
      <ul>
        <PipelineOppCard
          opp={matched}
          currentThreadId="th-current"
          variant="won"
        />
      </ul>
    );
    expect(
      screen.getByTestId("pipeline-opp-won-1").getAttribute("data-current")
    ).toBe("false");
    expect(screen.queryByText(/THIS THREAD/i)).not.toBeInTheDocument();
  });
});
