import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
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

  it("renders submitted contact-form fields in the message stream", () => {
    render(
      <MessageList
        messages={[
          {
            ...messages[0],
            body: `Full Name:
Marcel Mercier

How can we help?:
We need someone to renovate and replace two existing roof decks.`,
          },
        ]}
      />,
    );

    expect(screen.getByText(/Full Name:/)).toBeInTheDocument();
    expect(screen.getByText(/Marcel Mercier/)).toBeInTheDocument();
    expect(
      screen.getByText(/renovate and replace two existing roof decks/),
    ).toBeInTheDocument();
  });

  it("scrolls to the most recent message when a thread opens", () => {
    const { rerender } = render(
      <MessageList threadId={null} messages={messages.slice(0, 1)} />,
    );
    const list = screen.getByTestId("message-list");
    defineScrollMetrics(list, {
      scrollHeight: 1200,
      clientHeight: 320,
      scrollTop: 0,
    });

    rerender(<MessageList threadId="thread-1" messages={messages} />);

    expect(list.scrollTop).toBe(1200);
  });

  it("scrolls after a successful send when the operator is already near the latest message", () => {
    const { rerender } = render(
      <MessageList threadId="thread-1" messages={messages.slice(0, 2)} />,
    );
    const list = screen.getByTestId("message-list");
    defineScrollMetrics(list, {
      scrollHeight: 900,
      clientHeight: 300,
      scrollTop: 590,
    });
    fireEvent.scroll(list);

    defineScrollMetrics(list, {
      scrollHeight: 1200,
      clientHeight: 300,
      scrollTop: 590,
    });
    rerender(
      <MessageList
        threadId="thread-1"
        messages={messages}
        sendCompletedAt={Date.now()}
      />,
    );

    expect(list.scrollTop).toBe(1200);
  });

  it("does not force-scroll after send when the operator has intentionally scrolled up", () => {
    const { rerender } = render(
      <MessageList threadId="thread-1" messages={messages.slice(0, 2)} />,
    );
    const list = screen.getByTestId("message-list");
    defineScrollMetrics(list, {
      scrollHeight: 900,
      clientHeight: 300,
      scrollTop: 120,
    });
    fireEvent.scroll(list);

    defineScrollMetrics(list, {
      scrollHeight: 1200,
      clientHeight: 300,
      scrollTop: 120,
    });
    rerender(
      <MessageList
        threadId="thread-1"
        messages={messages}
        sendCompletedAt={Date.now()}
      />,
    );

    expect(list.scrollTop).toBe(120);
  });

  it("keeps the newest C5 content visible when the floating composer inset changes", () => {
    const { rerender } = render(
      <MessageList threadId="thread-1" messages={messages} />,
    );
    const list = screen.getByTestId("message-list");
    defineScrollMetrics(list, {
      scrollHeight: 900,
      clientHeight: 300,
      scrollTop: 590,
    });
    fireEvent.scroll(list);

    defineScrollMetrics(list, {
      scrollHeight: 1120,
      clientHeight: 300,
      scrollTop: 590,
    });
    rerender(
      <MessageList
        threadId="thread-1"
        messages={messages}
        scrollAnchorSignal={120}
      />,
    );

    expect(list.scrollTop).toBe(1120);
  });

  it("renders drafts as one distinct draft bubble, not normal sent messages", () => {
    render(
      <MessageList
        messages={messages}
        drafts={[
          {
            id: "draft-1",
            source: "provider",
            body: "Provider draft body",
            fromEmail: "ops@example.com",
            updatedAt: "2026-05-07T14:00:00Z",
          },
        ]}
      />,
    );

    expect(screen.getAllByTestId("message-bubble")).toHaveLength(3);
    const draftBubble = screen.getByTestId("draft-bubble");
    expect(draftBubble).toBeInTheDocument();
    expect(draftBubble.className).toContain("bg-transparent");
    expect(draftBubble.className).not.toContain("bg" + "-inbox-panel");
    expect(screen.getByText("Provider draft body")).toBeInTheDocument();
  });

  it("collapses multiple drafts into one draft bubble with a segmented picker", () => {
    render(
      <MessageList
        messages={messages}
        drafts={[
          {
            id: "draft-1",
            source: "provider",
            body: "Provider draft body",
            fromEmail: "ops@example.com",
            updatedAt: "2026-05-07T14:00:00Z",
          },
          {
            id: "draft-2",
            source: "ai",
            body: "Phase C draft body",
            fromEmail: "ops@example.com",
            updatedAt: "2026-05-07T14:05:00Z",
          },
        ]}
      />,
    );

    expect(screen.getAllByTestId("draft-bubble")).toHaveLength(1);
    expect(screen.getByRole("tablist", { name: /draft/i })).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(2);

    fireEvent.click(screen.getByRole("tab", { name: /2/i }));

    expect(screen.getByText("Phase C draft body")).toBeInTheDocument();
    expect(screen.queryByText("Provider draft body")).not.toBeInTheDocument();
  });

  it("draft bubble edit and send actions target the selected draft", () => {
    const onEditDraft = vi.fn();
    const onSendDraft = vi.fn();
    const drafts = [
      {
        id: "draft-1",
        source: "provider" as const,
        body: "Provider draft body",
        fromEmail: "ops@example.com",
        updatedAt: "2026-05-07T14:00:00Z",
      },
      {
        id: "draft-2",
        source: "ai" as const,
        body: "Phase C draft body",
        fromEmail: "ops@example.com",
        updatedAt: "2026-05-07T14:05:00Z",
      },
    ];

    render(
      <MessageList
        messages={messages}
        drafts={drafts}
        onEditDraft={onEditDraft}
        onSendDraft={onSendDraft}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /2/i }));
    fireEvent.click(screen.getByRole("button", { name: /^EDIT$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^SEND$/i }));

    expect(onEditDraft).toHaveBeenCalledWith(drafts[1]);
    expect(onSendDraft).toHaveBeenCalledWith(drafts[1]);
  });

  it("disables draft send while an outbound send is pending", () => {
    const onSendDraft = vi.fn();

    render(
      <MessageList
        messages={messages}
        drafts={[
          {
            id: "draft-1",
            source: "provider",
            body: "Provider draft body",
            fromEmail: "ops@example.com",
            updatedAt: "2026-05-07T14:00:00Z",
          },
        ]}
        onSendDraft={onSendDraft}
        isDraftSending
      />,
    );

    const send = screen.getByRole("button", { name: /^SEND$/i });
    expect(send).toBeDisabled();

    fireEvent.click(send);

    expect(onSendDraft).not.toHaveBeenCalled();
  });

  it("opens clickable file attachments from the C5 message list", () => {
    const onOpen = vi.fn();
    render(
      <MessageList
        messages={[
          {
            ...messages[0],
            attachments: [
              {
                id: "att-1",
                filename: "field-measure.pdf",
                size: "842 KB",
                onClick: onOpen,
              },
            ],
          },
        ]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /field-measure\.pdf/i }),
    );

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("renders inline photos after the message they belong to", () => {
    render(
      <MessageList
        messages={messages}
        inlinePhotos={[
          {
            afterMessageIdx: 0,
            direction: "inbound",
            senderName: "Jeanne",
            timestamp: "10:00",
            photos: [
              {
                id: "photo-1",
                url: "/api/integrations/email/attachment?photo=1",
                alt: "bay-three-curb-photo.jpg",
              },
            ],
          },
        ]}
      />,
    );

    const image = screen.getByRole("img", {
      name: "bay-three-curb-photo.jpg",
    }) as HTMLImageElement;
    expect(image).toBeInTheDocument();
    expect(image.getAttribute("src")).toContain(
      "/api/integrations/email/attachment",
    );
  });
});

function defineScrollMetrics(
  element: HTMLElement,
  metrics: { scrollHeight: number; clientHeight: number; scrollTop: number },
) {
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value: metrics.scrollHeight,
  });
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: metrics.clientHeight,
  });
  element.scrollTop = metrics.scrollTop;
}
