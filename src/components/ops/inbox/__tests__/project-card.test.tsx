import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import {
  StatusPip,
  projectStatusTone,
  type ProjectStatus,
} from "../context-rail/status-pip";
import { AccountingBar } from "../context-rail/accounting-bar";
import { ProjectCard, type ProjectCardData } from "../context-rail/project-card";

describe("projectStatusTone", () => {
  it("maps statuses to expected tone tokens", () => {
    const cases: [ProjectStatus, string][] = [
      ["On site", "ops-accent"],
      ["Quoted", "muted"],
      ["Awaiting acceptance", "tan"],
      ["Done", "olive"],
      ["Paid", "olive"],
      ["Scheduled", "muted"],
    ];
    for (const [status, token] of cases) {
      expect(projectStatusTone(status)).toBe(token);
    }
  });
});

describe("<StatusPip>", () => {
  it("renders a tone-tinted dot + label by default", () => {
    render(<StatusPip status="Done" label="Done" />);
    const pip = screen.getByTestId("status-pip");
    expect(pip).toBeInTheDocument();
    expect(pip.querySelector("span[aria-hidden]")?.className).toMatch(/bg-olive/);
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("dotOnly variant skips the label", () => {
    render(<StatusPip status="On site" label="On site" dotOnly />);
    const pip = screen.getByTestId("status-pip");
    expect(pip.className).toMatch(/bg-ops-accent/);
    expect(screen.queryByText("On site")).not.toBeInTheDocument();
  });
});

describe("<AccountingBar>", () => {
  it("renders an empty track when total is zero", () => {
    render(<AccountingBar total={0} invoiced={0} paid={0} />);
    const track = screen.getByTestId("accounting-bar");
    expect(track).toBeInTheDocument();
  });

  it("paid segment width is paid/total of the track", () => {
    render(<AccountingBar total={1000} invoiced={800} paid={400} />);
    const paid = screen.getByTestId("accounting-bar-paid");
    expect(paid.style.width).toBe("40%");
  });

  it("invoiced (unpaid) segment fills (invoiced - paid)/total", () => {
    render(<AccountingBar total={1000} invoiced={800} paid={400} />);
    const invoiced = screen.getByTestId("accounting-bar-invoiced");
    expect(invoiced.style.width).toBe("40%");
  });
});

describe("<ProjectCard>", () => {
  const project: ProjectCardData = {
    id: "p1",
    title: "Roof replacement — Calloway",
    value: 12500,
    status: "On site",
    stage: "in-progress",
    startDate: "2026-04-15",
    endDate: "2026-05-12",
    leadName: "Mateo G.",
    tasks: [
      { id: "t1", label: "Order materials", status: "done" },
      { id: "t2", label: "Schedule crew", status: "done" },
      { id: "t3", label: "Walk site", status: "active" },
    ],
    accounting: { total: 12500, invoiced: 5000, paid: 5000 },
    invoices: [
      {
        id: "i1",
        number: "INV-118",
        label: "Deposit invoice",
        amount: 5000,
        status: "paid",
      },
    ],
    estimates: [
      {
        id: "e1",
        number: "EST-091",
        label: "Roof replacement estimate",
        amount: 12500,
        status: "accepted",
      },
    ],
  };

  it("renders the title and value in collapsed state by default", () => {
    render(<ProjectCard project={project} threadId="th1" />);
    expect(screen.getByText(/Roof replacement/)).toBeInTheDocument();
    expect(screen.getByText(/\$?12,500/)).toBeInTheDocument();
  });

  it("auto-opens when defaultOpen is true", () => {
    render(<ProjectCard project={project} threadId="th1" defaultOpen />);
    expect(screen.getByText(/Order materials/)).toBeInTheDocument();
    expect(screen.getByText(/Scope/i)).toBeInTheDocument();
    expect(screen.getByText(/Accounting/i)).toBeInTheDocument();
  });

  it("toggles expansion on click", () => {
    render(<ProjectCard project={project} threadId="th1" />);
    expect(screen.queryByText(/Order materials/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Roof replacement/i }));
    expect(screen.getByText(/Order materials/)).toBeInTheDocument();
  });

  it("renders the tasks-done counter as 'done/total'", () => {
    render(<ProjectCard project={project} threadId="th1" />);
    expect(screen.getByText(/2\/3/)).toBeInTheDocument();
  });

  it("renders the 'now' badge on active tasks", () => {
    render(<ProjectCard project={project} threadId="th1" defaultOpen />);
    expect(screen.getByText(/^now$/i)).toBeInTheDocument();
  });

  it("renders the Open project link with ?project=:id when expanded", () => {
    render(<ProjectCard project={project} threadId="th1" defaultOpen />);
    const link = screen.getByRole("link", { name: /Open project/i });
    expect(link).toHaveAttribute("href", expect.stringContaining("project=p1"));
  });
});
