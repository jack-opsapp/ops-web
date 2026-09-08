import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import dictionary from "@/i18n/dictionaries/en/agent-queue.json";
import { resultFixture } from "@/lib/agent-control-plane/services/schedule-change/__tests__/fixtures";
vi.mock("@/i18n/client", () => ({ useLocale: () => ({ locale: "en" }), useDictionary: () => ({ t: (key: string) => (dictionary as Record<string, string>)[key] ?? key }) }));
import { ScheduleChangePreview } from "../schedule-change-preview";

describe("readable exact schedule approval", () => {
  it("shows both schedules, all included work and the actual effect limits", () => {
    render(<ScheduleChangePreview proposal={resultFixture().proposal} />);
    expect(screen.getByText("America/Vancouver")).toBeInTheDocument();
    expect(screen.getByText("Oct 30, 2026")).toBeInTheDocument();
    expect(screen.getByText("Nov 2, 2026")).toBeInTheDocument();
    expect(screen.queryByText("Nov 3, 2026")).not.toBeInTheDocument();
    expect(screen.getByText("Roofing")).toBeInTheDocument();
    expect(screen.getByText("Preserve the existing flashing.")).toBeInTheDocument();
    expect(screen.getByText(dictionary["scheduleChange.communicationLimit"])).toBeInTheDocument();
    expect(screen.getByText(dictionary["scheduleChange.capacityProtection"])).toBeInTheDocument();
  });
  it("renders business text as inert text", () => {
    const proposal = resultFixture().proposal;
    proposal.reason = '<img src=x onerror="sendCustomerMessage()">';
    const { container } = render(<ScheduleChangePreview proposal={proposal} />);
    expect(screen.getByText(proposal.reason)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });
  it("does not render a malformed or substituted-effect preview", () => {
    const proposal = resultFixture().proposal;
    render(<ScheduleChangePreview proposal={{ ...proposal, effects: { ...proposal.effects, customer_messages_sent: 1 } }} />);
    expect(screen.getByText(dictionary["scheduleChange.unavailable"])).toBeInTheDocument();
    expect(screen.queryByText("West roof")).not.toBeInTheDocument();
  });
});
