import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ContextRail } from "../context-rail/context-rail";

const baseProps = {
  client: {
    name: "Calloway HVAC",
    subtitle: "Property mgmt · 4 buildings",
    phone: "(604) 555-0184",
    email: "jeanne@callowayroof.co",
    address: "5421 Ash St, Vancouver BC",
  },
  threadId: "t1",
  onOpenClient: () => {},
  counts: { work: 3, accounting: 2, files: 9 },
  work: <div data-testid="work">W</div>,
  accounting: <div data-testid="accounting">A</div>,
  files: <div data-testid="files">F</div>,
};

describe("<ContextRail>", () => {
  it("renders the client mini-header (name + subtitle)", () => {
    render(<ContextRail {...baseProps} />);
    expect(screen.getByText("Calloway HVAC")).toBeInTheDocument();
    expect(screen.getByText(/Property mgmt/)).toBeInTheDocument();
  });

  it("renders the // CLIENT label above the avatar row", () => {
    render(<ContextRail {...baseProps} />);
    expect(screen.getByText("// CLIENT")).toBeInTheDocument();
  });

  it("renders a compact open-client icon action", () => {
    const onOpenClient = vi.fn();
    render(<ContextRail {...baseProps} onOpenClient={onOpenClient} />);
    const openButton = screen.getByRole("button", { name: /open client/i });
    // Lucide icons are rendered as inline SVGs with aria-hidden — assert one
    // is nested inside the button rather than checking textual label.
    expect(openButton.querySelector("svg")).not.toBeNull();
    fireEvent.click(openButton);
    expect(onOpenClient).toHaveBeenCalledTimes(1);
  });

  it("keeps the linked header readable without truncating contact values", () => {
    render(
      <ContextRail
        {...baseProps}
        client={{
          ...baseProps.client,
          name: "Calloway Roofing Co. North Shore Emergency Service Division",
          email: "dispatch.north-shore-emergency@callowayroof.example",
          address: "5421 Ash Street, Unit 1400, Vancouver BC V6M 3K2",
        }}
      />,
    );

    const heading = screen.getByRole("heading", {
      name: /Calloway Roofing Co. North Shore/i,
    });
    expect(heading.className).toContain("line-clamp-2");

    const email = screen.getByText(
      "dispatch.north-shore-emergency@callowayroof.example",
    );
    expect(email.className).toContain("break-all");
    expect(email.className).not.toContain("truncate");

    const address = screen.getByText(/5421 Ash Street/);
    expect(address.className).toContain("break-words");
    expect(address.className).not.toContain("truncate");
  });

  it("renders contact lines (phone / email / address) with bracket labels", () => {
    render(<ContextRail {...baseProps} />);
    // bracket labels
    expect(screen.getByText("[PHONE]")).toBeInTheDocument();
    expect(screen.getByText("[EMAIL]")).toBeInTheDocument();
    expect(screen.getByText("[ADDR]")).toBeInTheDocument();
    // values
    expect(screen.getByText("(604) 555-0184")).toBeInTheDocument();
    expect(screen.getByText("jeanne@callowayroof.co")).toBeInTheDocument();
    expect(screen.getByText(/5421 Ash St/)).toBeInTheDocument();
  });

  it("defaults to the WORK tab on mount", () => {
    render(<ContextRail {...baseProps} />);
    expect(screen.getByTestId("work")).toBeInTheDocument();
    expect(screen.queryByTestId("accounting")).not.toBeInTheDocument();
    expect(screen.queryByTestId("files")).not.toBeInTheDocument();
  });

  it("switches to the ACCOUNTING tab on click", () => {
    render(<ContextRail {...baseProps} />);
    fireEvent.click(screen.getByRole("tab", { name: /accounting/i }));
    expect(screen.getByTestId("accounting")).toBeInTheDocument();
    expect(screen.queryByTestId("work")).not.toBeInTheDocument();
  });

  it("renders the count next to each non-zero tab label", () => {
    render(<ContextRail {...baseProps} />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
  });

  it("re-mounts to WORK when threadId changes (no cross-thread persistence)", () => {
    const { rerender } = render(<ContextRail {...baseProps} threadId="t1" />);
    fireEvent.click(screen.getByRole("tab", { name: /files/i }));
    expect(screen.getByTestId("files")).toBeInTheDocument();
    rerender(<ContextRail {...baseProps} threadId="t2" />);
    expect(screen.getByTestId("work")).toBeInTheDocument();
    expect(screen.queryByTestId("files")).not.toBeInTheDocument();
  });

  // ─── Unlinked state ──────────────────────────────────────────────────────

  describe("unlinked state (no client linked)", () => {
    const unlinkedProps = {
      threadId: "t1",
      counts: { work: 0, accounting: 0, files: 0 },
      work: <div data-testid="work">W</div>,
      accounting: <div data-testid="accounting">A</div>,
      files: <div data-testid="files">F</div>,
    };

    it("renders // CLIENT :: UNLINKED in the header", () => {
      render(<ContextRail {...unlinkedProps} />);
      expect(screen.getByText("// CLIENT :: UNLINKED")).toBeInTheDocument();
    });

    it("renders the unlinked body marker", () => {
      render(<ContextRail {...unlinkedProps} />);
      expect(
        screen.getByText("[—] thread has no client attached"),
      ).toBeInTheDocument();
    });

    it("dims the tab strip wrapper to 40% opacity", () => {
      render(<ContextRail {...unlinkedProps} />);
      const wrap = screen.getByTestId("rail-tabstrip-wrap");
      expect(wrap.className).toContain("opacity-40");
      expect(wrap.className).toContain("pointer-events-none");
    });

    it("renders the unlinked empty body in the tabpanel (not the linked tab content)", () => {
      render(<ContextRail {...unlinkedProps} />);
      expect(
        screen.getByText("[—] link a client to see context"),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("work")).not.toBeInTheDocument();
      expect(screen.queryByTestId("accounting")).not.toBeInTheDocument();
      expect(screen.queryByTestId("files")).not.toBeInTheDocument();
    });

    it("does not render contact lines, OPEN, or inert LINK CLIENT controls when unlinked", () => {
      render(<ContextRail {...unlinkedProps} />);
      expect(screen.queryByText("[PHONE]")).not.toBeInTheDocument();
      expect(screen.queryByText("[EMAIL]")).not.toBeInTheDocument();
      expect(screen.queryByText("[ADDR]")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /open client/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /link client/i }),
      ).not.toBeInTheDocument();
    });

    it("keeps FILES available on unlinked threads when attachments exist", () => {
      render(
        <ContextRail
          {...unlinkedProps}
          counts={{ work: 0, accounting: 0, files: 2 }}
          files={<div data-testid="files">Thread files</div>}
        />,
      );

      expect(screen.getByTestId("files")).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /work/i })).toBeDisabled();
      expect(screen.getByRole("tab", { name: /accounting/i })).toBeDisabled();
      expect(screen.getByRole("tab", { name: /files\s+2/i })).not.toBeDisabled();
      expect(screen.getByTestId("rail-tabstrip-wrap").className).not.toContain(
        "pointer-events-none",
      );
    });
  });
});
