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
    expect(screen.getByRole("button", { name: /draft with claude/i })).toBeInTheDocument();
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

  it("clicking the SEND button fires onSend with current value", () => {
    const onSend = vi.fn();
    render(<Composer value="ready" onChange={noop} onSend={onSend} />);
    fireEvent.click(screen.getByRole("button", { name: /^SEND$/ }));
    expect(onSend).toHaveBeenCalledWith("ready");
  });

  it("disables the SEND button when value is empty/whitespace", () => {
    render(<Composer value="   " onChange={noop} onSend={noop} />);
    expect(screen.getByRole("button", { name: /^SEND$/ })).toBeDisabled();
  });

  it("propagates typing via onChange", () => {
    const onChange = vi.fn();
    render(<Composer value="" onChange={onChange} onSend={noop} />);
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "draft" } });
    expect(onChange).toHaveBeenCalledWith("draft");
  });
});
