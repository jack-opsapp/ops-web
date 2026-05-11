import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import {
  ArchiveConfirmModal,
  type ArchiveConfirmContext,
} from "../archive-confirm-modal";

const noop = () => {};

const baseContext: ArchiveConfirmContext = {
  currentThread: {
    id: "t-current",
    subject: "Roof RFQ — revised quote",
    latestSenderName: "Calloway",
    latestSenderEmail: "ops@calloway.com",
  },
  linkedOpportunity: {
    id: "opp-1",
    title: "Calloway · Re-roof",
  } as ArchiveConfirmContext["linkedOpportunity"],
  siblingThreads: [],
  leadPreference: "ask",
  connectionId: "conn-1",
};

describe("<ArchiveConfirmModal>", () => {
  it("renders the // ARCHIVE slash title and instructional body", () => {
    render(
      <ArchiveConfirmModal
        open={true}
        onOpenChange={noop}
        context={baseContext}
        onConfirm={noop}
      />,
    );
    // Slash title
    expect(screen.getByText("// ARCHIVE")).toBeInTheDocument();
    // Body
    expect(
      screen.getByText(
        /this thread will move to archive\. nothing is deleted\./i,
      ),
    ).toBeInTheDocument();
  });

  it("renders the // THIS THREAD section label and locked current-thread row", () => {
    render(
      <ArchiveConfirmModal
        open={true}
        onOpenChange={noop}
        context={baseContext}
        onConfirm={noop}
      />,
    );
    // Match the bracketed-section label, distinct from the body sentence
    // which contains lowercase "this thread" prose. The section is rendered
    // as `// THIS THREAD` (ALL CAPS).
    expect(screen.getByText(/^\/\/ THIS THREAD$/)).toBeInTheDocument();
    expect(screen.getByText("Roof RFQ — revised quote")).toBeInTheDocument();
  });

  it("renders the // OTHER THREADS ON THIS LEAD section when siblings exist", () => {
    const ctx: ArchiveConfirmContext = {
      ...baseContext,
      siblingThreads: [
        {
          id: "sib-1",
          subject: "Initial site walk · Calloway",
          latestSenderName: "Calloway",
          latestSenderEmail: "ops@calloway.com",
          latestSnippet: "We agreed on Friday",
          lastMessageAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        },
      ] as ArchiveConfirmContext["siblingThreads"],
    };
    render(
      <ArchiveConfirmModal
        open={true}
        onOpenChange={noop}
        context={ctx}
        onConfirm={noop}
      />,
    );
    expect(screen.getByText(/OTHER THREADS ON THIS LEAD/i)).toBeInTheDocument();
    expect(screen.getByText("Initial site walk · Calloway")).toBeInTheDocument();
  });

  it("renders the // PIPELINE LEAD section + linked opp title and item count footer", () => {
    render(
      <ArchiveConfirmModal
        open={true}
        onOpenChange={noop}
        context={baseContext}
        onConfirm={noop}
      />,
    );
    expect(screen.getByText(/PIPELINE LEAD/i)).toBeInTheDocument();
    expect(screen.getByText("Calloway · Re-roof")).toBeInTheDocument();
    // Default count: current thread + lead = 2 items
    expect(screen.getByText(/\[2 items to archive\]/i)).toBeInTheDocument();
  });

  it("renders the CANCEL and ARCHIVE buttons with the inline ⌘↵ key hint on confirm", () => {
    render(
      <ArchiveConfirmModal
        open={true}
        onOpenChange={noop}
        context={baseContext}
        onConfirm={noop}
      />,
    );
    expect(screen.getByRole("button", { name: /CANCEL/i })).toBeInTheDocument();
    // Find the ARCHIVE button via its bare text — distinct from the inner
    // "Archive lead" toggle which uses different casing/wording.
    const archiveBtn = screen.getByText("ARCHIVE").closest("button");
    expect(archiveBtn).toBeTruthy();
    // The inline KeyHint emits a <kbd> with [⌘↵]
    expect(archiveBtn!.querySelector("kbd")?.textContent).toBe("[⌘↵]");
  });

  it("preserves sibling-toggle behavior — clicking a sibling row updates the count", () => {
    const ctx: ArchiveConfirmContext = {
      ...baseContext,
      leadPreference: "leave", // disables lead checkbox by default
      siblingThreads: [
        {
          id: "sib-1",
          subject: "Initial site walk",
          latestSenderName: "Calloway",
          latestSenderEmail: "ops@calloway.com",
          latestSnippet: null,
          lastMessageAt: new Date().toISOString(),
        },
      ] as ArchiveConfirmContext["siblingThreads"],
    };
    render(
      <ArchiveConfirmModal
        open={true}
        onOpenChange={noop}
        context={ctx}
        onConfirm={noop}
      />,
    );
    // current + sibling = 2 items by default (lead off because leadPreference='leave')
    expect(screen.getByText(/\[2 items to archive\]/i)).toBeInTheDocument();
    const sibButton = screen.getByText("Initial site walk").closest("button");
    expect(sibButton).toBeTruthy();
    fireEvent.click(sibButton!);
    // After deselecting, current only = 1 item
    expect(screen.getByText(/\[1 item to archive\]/i)).toBeInTheDocument();
  });

  it("calls onConfirm with the right thread + opp args when ARCHIVE clicked", async () => {
    const onConfirm = vi.fn();
    render(
      <ArchiveConfirmModal
        open={true}
        onOpenChange={noop}
        context={baseContext}
        onConfirm={onConfirm}
      />,
    );
    const archiveBtn = screen.getByText("ARCHIVE").closest("button");
    fireEvent.click(archiveBtn!);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toEqual({
      threadIds: ["t-current"],
      archiveOpportunityId: "opp-1",
      saveLeadPreference: "archive",
    });
  });
});
