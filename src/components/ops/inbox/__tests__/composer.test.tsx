import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Composer } from "../composer/composer";

const noop = () => {};

describe("<Composer>", () => {
  it("renders an empty textarea with placeholder", () => {
    render(
      <Composer value="" onChange={noop} onSend={noop} placeholder="Type a message..." />,
    );
    expect(
      screen.getByPlaceholderText(/Type a message/i),
    ).toBeInTheDocument();
  });

  it("renders the four attach affordances by aria label", () => {
    render(<Composer value="" onChange={noop} onSend={noop} />);
    expect(screen.getByRole("button", { name: /attach file/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /attach image/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /draft with phase c/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /schedule/i })).toBeInTheDocument();
  });

  it("Cmd+Enter on textarea fires onSend with current value", () => {
    const onSend = vi.fn();
    render(<Composer value="hello" onChange={noop} onSend={onSend} />);
    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    expect(onSend).toHaveBeenCalledWith("hello");
  });

  it("Ctrl+Enter on textarea also fires onSend (Windows/Linux)", () => {
    const onSend = vi.fn();
    render(<Composer value="hi" onChange={noop} onSend={onSend} />);
    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    expect(onSend).toHaveBeenCalledWith("hi");
  });

  it("plain Enter inserts a newline (does not send)", () => {
    const onSend = vi.fn();
    render(<Composer value="hi" onChange={noop} onSend={onSend} />);
    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("clicking the Send button fires onSend with current value", () => {
    const onSend = vi.fn();
    render(<Composer value="ready" onChange={noop} onSend={onSend} />);
    fireEvent.click(screen.getByRole("button", { name: /^Send$/i }));
    expect(onSend).toHaveBeenCalledWith("ready");
  });

  it("disables the Send button when value is empty/whitespace", () => {
    render(<Composer value="   " onChange={noop} onSend={noop} />);
    expect(screen.getByRole("button", { name: /^Send$/i })).toBeDisabled();
  });

  it("shows the Edit button slot when onEditDraft is provided", () => {
    render(
      <Composer
        value=""
        onChange={noop}
        onSend={noop}
        onEditDraft={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: /^EDIT DRAFT$/i }),
    ).toBeInTheDocument();
  });

  it("agent variant labels the send button SEND PHASE C DRAFT", () => {
    render(
      <Composer
        value="ready"
        onChange={noop}
        onSend={noop}
        sendVariant="agent"
      />,
    );
    expect(
      screen.getByRole("button", { name: /SEND PHASE C DRAFT/i }),
    ).toBeInTheDocument();
  });

  it("renders the toolbar with Sparkles first followed by a vertical divider", () => {
    render(<Composer value="" onChange={noop} onSend={noop} />);
    const sparkles = screen.getByRole("button", { name: /draft with phase c/i });
    const paperclip = screen.getByRole("button", { name: /attach file/i });
    expect(
      sparkles.compareDocumentPosition(paperclip) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps composer utility icon controls compact for desktop", () => {
    render(<Composer value="" onChange={noop} onSend={noop} />);
    for (const name of [
      /draft with phase c/i,
      /attach file/i,
      /attach image/i,
      /schedule/i,
    ]) {
      const button = screen.getByRole("button", { name });
      expect(button.className).toContain("h-5");
      expect(button.className).toContain("w-5");
      expect(button.className).not.toContain("h-[26px]");
      expect(button.className).not.toContain("w-[26px]");
    }
  });

  it("uses the tactical bracket placeholder when none is passed", () => {
    render(<Composer value="" onChange={noop} onSend={noop} />);
    expect(
      screen.getByPlaceholderText("[type message — ⌘↵ to send]"),
    ).toBeInTheDocument();
  });

  it("send button includes a ⌘↵ shortcut hint inline", () => {
    render(<Composer value="ready" onChange={noop} onSend={noop} />);
    const sendBtn = screen.getByRole("button", { name: /^SEND$/i });
    // KeyHint renders as a <kbd> with [⌘↵]; the bracket text appears in textContent.
    expect(sendBtn.textContent).toMatch(/\[⌘↵\]/);
  });

  it("propagates typing via onChange", () => {
    const onChange = vi.fn();
    render(<Composer value="" onChange={onChange} onSend={noop} />);
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "draft" } });
    expect(onChange).toHaveBeenCalledWith("draft");
  });
});
