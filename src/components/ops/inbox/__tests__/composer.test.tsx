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

  describe("floating mode", () => {
    function getOuterShell(textarea: HTMLElement): HTMLElement {
      // textarea → inner box → outer composer shell
      const innerBox = textarea.parentElement;
      const outer = innerBox?.parentElement;
      if (!outer) throw new Error("could not find outer shell");
      return outer;
    }

    it("renders the legacy band styling by default", () => {
      render(<Composer value="" onChange={noop} onSend={noop} />);
      const outer = getOuterShell(screen.getByRole("textbox"));
      expect(outer.className).toMatch(/border-t/);
      expect(outer.className).toMatch(/bg-inbox-panel/);
      expect(outer.getAttribute("data-floating")).toBeNull();
    });

    it("renders a glass-dense rounded panel with no border-top when floating", () => {
      render(<Composer value="" onChange={noop} onSend={noop} floating />);
      const outer = getOuterShell(screen.getByRole("textbox"));
      expect(outer.className).toMatch(/rounded-panel/);
      expect(outer.className).toMatch(/backdrop-blur-\[28px\]/);
      expect(outer.className).toMatch(/rgba\(18,18,20,0\.78\)/);
      expect(outer.className).not.toMatch(/border-t/);
      expect(outer.getAttribute("data-floating")).toBe("true");
    });

    it("preserves all interactive behavior when floating (send shortcut + button)", () => {
      const onSend = vi.fn();
      render(
        <Composer
          value="hi"
          onChange={noop}
          onSend={onSend}
          floating
        />,
      );
      const textarea = screen.getByRole("textbox");
      fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
      expect(onSend).toHaveBeenCalledWith("hi");

      fireEvent.click(screen.getByRole("button", { name: /^SEND$/i }));
      expect(onSend).toHaveBeenCalledTimes(2);
    });

    it("renders bottomAccessory inside the floating panel (e.g. error state)", () => {
      render(
        <Composer
          value=""
          onChange={noop}
          onSend={noop}
          floating
          bottomAccessory={
            <p role="alert" data-testid="composer-error">
              send failed
            </p>
          }
        />,
      );
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toMatch(/send failed/);
      // The bottomAccessory should be a descendant of the outer shell so it
      // floats with the composer rather than rendering as a sibling outside
      // the absolutely-positioned wrapper.
      const outer = getOuterShell(screen.getByRole("textbox"));
      expect(outer.contains(alert)).toBe(true);
    });
  });
});
