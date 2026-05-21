import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Composer } from "../composer/composer";

const noop = () => {};

describe("<Composer>", () => {
  it("renders an empty textarea with placeholder", () => {
    render(
      <Composer
        value=""
        onChange={noop}
        onSend={noop}
        placeholder="Type a message..."
      />
    );
    expect(screen.getByPlaceholderText(/Type a message/i)).toBeInTheDocument();
  });

  it("does not render utility controls when no handler is wired", () => {
    render(<Composer value="" onChange={noop} onSend={noop} />);
    expect(
      screen.queryByRole("button", { name: /attach file/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /attach image/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /draft with phase c/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /schedule/i })
    ).not.toBeInTheDocument();
  });

  it("renders wired utility controls and fires their handlers", () => {
    const onDraftWithClaude = vi.fn();
    const onAttachFile = vi.fn();
    const onAttachImage = vi.fn();
    const onSchedule = vi.fn();
    render(
      <Composer
        value=""
        onChange={noop}
        onSend={noop}
        onDraftWithClaude={onDraftWithClaude}
        onAttachFile={onAttachFile}
        onAttachImage={onAttachImage}
        onSchedule={onSchedule}
      />
    );
    fireEvent.click(
      screen.getByRole("button", { name: /draft with phase c/i })
    );
    fireEvent.click(screen.getByRole("button", { name: /attach file/i }));
    fireEvent.click(screen.getByRole("button", { name: /attach image/i }));
    fireEvent.click(screen.getByRole("button", { name: /schedule/i }));
    expect(onDraftWithClaude).toHaveBeenCalledTimes(1);
    expect(onAttachFile).toHaveBeenCalledTimes(1);
    expect(onAttachImage).toHaveBeenCalledTimes(1);
    expect(onSchedule).toHaveBeenCalledTimes(1);
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
      <Composer value="" onChange={noop} onSend={noop} onEditDraft={() => {}} />
    );
    expect(
      screen.getByRole("button", { name: /^EDIT DRAFT$/i })
    ).toBeInTheDocument();
  });

  it("agent variant labels the send button SEND PHASE C DRAFT", () => {
    render(
      <Composer
        value="ready"
        onChange={noop}
        onSend={noop}
        sendVariant="agent"
      />
    );
    expect(
      screen.getByRole("button", { name: /SEND PHASE C DRAFT/i })
    ).toBeInTheDocument();
  });

  it("renders the toolbar with Sparkles first followed by a vertical divider", () => {
    render(
      <Composer
        value=""
        onChange={noop}
        onSend={noop}
        onDraftWithClaude={noop}
        onAttachFile={noop}
      />
    );
    const sparkles = screen.getByRole("button", {
      name: /draft with phase c/i,
    });
    const paperclip = screen.getByRole("button", { name: /attach file/i });
    expect(
      sparkles.compareDocumentPosition(paperclip) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("keeps composer utility icon controls compact for desktop", () => {
    render(
      <Composer
        value=""
        onChange={noop}
        onSend={noop}
        onDraftWithClaude={noop}
        onAttachFile={noop}
        onAttachImage={noop}
        onSchedule={noop}
      />
    );
    for (const name of [
      /draft with phase c/i,
      /attach file/i,
      /attach image/i,
      /schedule/i,
    ]) {
      const button = screen.getByRole("button", { name });
      expect(button.className).toContain("h-5");
      expect(button.className).toContain("w-5");
    }
  });

  it("can render as a floating transparent command surface with only hairline structure", () => {
    const { container } = render(
      <Composer value="" onChange={noop} onSend={noop} surface="floating" />
    );
    const shell = container.firstElementChild;
    expect(shell?.className).not.toContain("gl" + "ass-dense");
    expect(shell?.className).not.toContain("bg" + "-inbox");
    expect(shell?.className).not.toContain("rounded-modal");
    expect(shell?.className).toContain("border-line");
    expect(shell?.className).not.toContain("border-t");
  });

  it("keeps the floating composer as one command surface without a nested input panel", () => {
    const { container } = render(
      <Composer value="" onChange={noop} onSend={noop} surface="floating" />
    );
    const shell = container.firstElementChild as HTMLElement;
    const nestedPanel = Array.from(shell.querySelectorAll("div")).find((el) =>
      el.className.includes("bg" + "-inbox-bg-deep")
    );

    expect(nestedPanel).toBeUndefined();
  });

  it("formats the selected composer text with real markdown controls", () => {
    const onChange = vi.fn();
    render(
      <Composer
        value="tight reply"
        onChange={onChange}
        onSend={noop}
        surface="floating"
      />
    );
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    textarea.setSelectionRange(0, 5);

    fireEvent.click(screen.getByRole("button", { name: /bold/i }));

    expect(onChange).toHaveBeenCalledWith("**tight** reply");
  });

  it("places floating markdown controls in a compact toolbar below the input", () => {
    render(
      <Composer
        value=""
        onChange={noop}
        onSend={noop}
        surface="floating"
      />
    );

    const textarea = screen.getByRole("textbox");
    const toolbar = screen.getByTestId("floating-composer-toolbar");
    const bold = screen.getByRole("button", { name: /bold/i });
    const italic = screen.getByRole("button", { name: /italic/i });

    expect(
      textarea.compareDocumentPosition(toolbar) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(toolbar).toContainElement(bold);
    expect(toolbar).toContainElement(italic);
    expect(bold.className).toContain("h-4");
    expect(bold.className).toContain("w-4");
  });

  it("keeps the empty composer compact and scrolls internally at expanded height", () => {
    const { rerender } = render(
      <Composer value="" onChange={noop} onSend={noop} surface="floating" />
    );
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;

    expect(textarea.className).toContain("min-h-[20px]");
    expect(textarea.style.height).toBe("20px");

    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      value: 180,
    });

    rerender(
      <Composer
        value={"line one\nline two\nline three\nline four\nline five"}
        onChange={noop}
        onSend={noop}
        surface="floating"
      />
    );

    expect(textarea.style.height).toBe("144px");
    expect(textarea.style.overflowY).toBe("auto");
  });

  it("uses the tactical bracket placeholder when none is passed", () => {
    render(<Composer value="" onChange={noop} onSend={noop} />);
    expect(
      screen.getByPlaceholderText("[type message — ⌘↵ to send]")
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
