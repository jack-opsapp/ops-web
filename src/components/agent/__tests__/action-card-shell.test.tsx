import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  AgentAction,
  AgentActionPriority,
  AgentActionStatus,
} from "@/lib/types/approval-queue";

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (k: string) => k }),
  useLocale: () => ({ locale: "en" }),
}));
vi.mock("framer-motion", async () => {
  const actual =
    await vi.importActual<typeof import("framer-motion")>("framer-motion");
  return { ...actual, useReducedMotion: () => true };
});

import { ActionCard } from "../action-card";

/**
 * Minimal `reassign_task` proposal. Every field of the real `AgentAction`
 * interface is present — the shell test must not weaken the contract with
 * `any`, because the shell reads `priority`, `status`, `confidence`, and
 * `createdAt` directly.
 */
function make(over: Partial<AgentAction> = {}): AgentAction {
  return {
    id: "action-1",
    companyId: "company-1",
    userId: "user-1",
    actionType: "reassign_task",
    actionData: {
      task_id: "task-1",
      task_title: "Rough-in inspection",
      from_user_id: "user-2",
      to_user_id: "user-3",
      reason: "overloaded",
    },
    contextSummary: "Crew is over capacity on Tuesday",
    contextSource: null,
    sourceId: null,
    confidence: 0.82,
    priority: "normal" as AgentActionPriority,
    status: "pending" as AgentActionStatus,
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: null,
    executedAt: null,
    executionResult: null,
    error: null,
    expiresAt: null,
    autoExecuteAt: null,
    createdAt: new Date("2026-09-01T12:00:00.000Z"),
    updatedAt: new Date("2026-09-01T12:00:00.000Z"),
    ...over,
  };
}

function renderCard(over: Partial<AgentAction> = {}) {
  return render(
    <ActionCard
      action={make(over)}
      selected={false}
      onSelect={() => {}}
      onApprove={() => {}}
      onReject={() => {}}
      t={(k: string) => k}
    />,
  );
}

describe("ActionCard shell", () => {
  it("renders urgent priority as a rose tag and no colored left border", () => {
    const { container } = renderCard({ priority: "urgent" });

    expect(screen.getByText("priority.urgent")).toBeInTheDocument();

    const shell = container.firstElementChild as HTMLElement;
    expect(shell.className).not.toMatch(/border-l-\[/);
    expect(shell.className).not.toMatch(/border-l-/);
    // Zero raw color literals on the shell — every value is a token class.
    expect(shell.className).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(shell.className).not.toMatch(/rgba\(/);
  });

  it("renders high priority as a tan tag", () => {
    renderCard({ priority: "high" });
    expect(screen.getByText("priority.high")).toBeInTheDocument();
  });

  it("does not render normal priority as a tag", () => {
    renderCard({ priority: "normal" });
    expect(screen.queryByText("priority.normal")).toBeNull();
  });

  it("does not render low priority as a tag", () => {
    renderCard({ priority: "low" });
    expect(screen.queryByText("priority.low")).toBeNull();
  });

  it("renders a dim tag for expired history rows and no approve button", () => {
    renderCard({ status: "expired" });

    const tag = screen.getByText("filter.expired");
    expect(tag).toBeInTheDocument();
    // No bracket decoration on tags — the Tag primitive carries the voice.
    expect(tag.textContent).toBe("filter.expired");
    expect(
      screen.queryByRole("button", { name: "action.approve" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "action.reject" })).toBeNull();
  });

  it("renders approve and reject as shared Button primitives when pending", () => {
    renderCard();

    const approve = screen.getByRole("button", { name: "action.approve" });
    const reject = screen.getByRole("button", { name: "action.reject" });

    // Shared Button primitive: Cake Mono label voice + the sm (32px) tier.
    expect(approve.className).toMatch(/font-cakemono/);
    expect(approve.className).toMatch(/\bh-8\b/);
    expect(reject.className).toMatch(/font-cakemono/);
    expect(reject.className).toMatch(/\bh-8\b/);
    // Web has no touch targets.
    expect(approve.className).not.toMatch(/min-h-11/);
    expect(reject.className).not.toMatch(/min-h-11/);
  });

  it("carries no 44px or 56px touch-target sizing in the card shell", () => {
    const { container } = renderCard({
      contextSource: "email_thread",
      sourceId: "thread-1",
    });

    const header = container.querySelector("[data-card-header]");
    expect(header).not.toBeNull();
    expect(header!.innerHTML).not.toMatch(/min-h-\[56px\]/);
    expect(header!.innerHTML).not.toMatch(/min-w-\[56px\]/);
    expect(header!.innerHTML).not.toMatch(/min-h-11/);
  });

  it("renders the source link without negative margins or touch sizing", () => {
    renderCard({ contextSource: "email_thread", sourceId: "thread-1" });

    const link = screen.getByRole("link", { name: /card.viewSource/ });
    expect(link).toHaveAttribute("href", "/inbox?thread=thread-1");
    expect(link.className).not.toMatch(/-my-4/);
    expect(link.className).not.toMatch(/min-h-\[56px\]/);
  });

  it("uses the selected surface tokens when selected", () => {
    const { container } = render(
      <ActionCard
        action={make()}
        selected
        onSelect={() => {}}
        onApprove={() => {}}
        onReject={() => {}}
        t={(k: string) => k}
      />,
    );

    const shell = container.firstElementChild as HTMLElement;
    expect(shell.className).toMatch(/border-border-medium/);
    expect(shell.className).toMatch(/bg-surface-active/);
    expect(shell.className).not.toMatch(/glass-surface/);
  });

  it("uses glass tokens when unselected", () => {
    const { container } = renderCard();
    const shell = container.firstElementChild as HTMLElement;
    expect(shell.className).toMatch(/glass-surface/);
    expect(shell.className).toMatch(/border-glass-border/);
    expect(shell.className).toMatch(/ease-smooth/);
    // `glass-surface` already carries blur + saturate.
    expect(shell.className).not.toMatch(/backdrop-blur-\[/);
    expect(shell.className).not.toMatch(/saturate-\[/);
  });

  it("maps every non-pending status onto a tag variant", () => {
    const cases: Array<[AgentActionStatus, RegExp]> = [
      ["approved", /text-olive/],
      ["executed", /text-olive/],
      ["rejected", /text-rose/],
      ["failed", /text-rose/],
      ["expired", /text-text-3/],
      ["cancelled", /text-text-3/],
    ];

    for (const [status, expected] of cases) {
      const { unmount } = renderCard({ status });
      const tag = screen.getByText(`filter.${status}`);
      expect(tag.className, status).toMatch(expected);
      expect(tag.className, status).not.toMatch(/#[0-9a-fA-F]{3,8}/);
      unmount();
    }
  });
});
