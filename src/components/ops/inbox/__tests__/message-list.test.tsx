import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { MessageList, type RenderableMessage } from "../message-list";

const messages: RenderableMessage[] = [
  {
    id: "m1",
    authorId: "client",
    direction: "inbound",
    source: "human",
    ts: Date.parse("2026-05-06T10:00:00Z"),
    body: "Hello",
    senderName: "Jeanne",
    timestamp: "10:00",
  },
  {
    id: "m2",
    authorId: "client",
    direction: "inbound",
    source: "human",
    ts: Date.parse("2026-05-06T10:01:00Z"),
    body: "Quick follow-up",
    senderName: "Jeanne",
    timestamp: "10:01",
  },
  {
    id: "m3",
    authorId: "user",
    direction: "outbound",
    source: "ai",
    ts: Date.parse("2026-05-07T14:00:00Z"),
    body: "Thanks — got it.",
    senderName: "Phase C",
    timestamp: "14:00",
  },
];

describe("<MessageList>", () => {
  it("renders one bubble per message", () => {
    render(<MessageList messages={messages} />);
    const bubbles = screen.getAllByTestId("message-bubble");
    expect(bubbles).toHaveLength(3);
  });

  it("every bubble surfaces its own timestamp", () => {
    render(<MessageList messages={messages} />);
    expect(screen.getByText("10:00")).toBeInTheDocument();
    expect(screen.getByText("10:01")).toBeInTheDocument();
    expect(screen.getByText("14:00")).toBeInTheDocument();
  });
});
