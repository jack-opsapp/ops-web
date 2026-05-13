import { describe, expect, it } from "vitest";
import {
  shouldHandlePipelineModeShortcut,
  type PipelineModeShortcutEvent,
} from "@/app/(dashboard)/pipeline/_components/pipeline-mode-shortcuts";

function shortcutEvent(
  overrides: Partial<PipelineModeShortcutEvent> = {}
): PipelineModeShortcutEvent {
  return {
    key: "v",
    target: document.body,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    isComposing: false,
    ...overrides,
  };
}

describe("pipeline mode shortcuts", () => {
  it("handles bare V outside scoped or typing targets", () => {
    expect(shouldHandlePipelineModeShortcut(shortcutEvent(), false)).toBe(true);
    expect(
      shouldHandlePipelineModeShortcut(shortcutEvent({ key: "V" }), false)
    ).toBe(true);
  });

  it("ignores shortcut while typing", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);

    expect(
      shouldHandlePipelineModeShortcut(shortcutEvent({ target: input }), false)
    ).toBe(false);

    input.remove();
  });

  it("ignores shortcut inside modal or menu keyboard scopes", () => {
    const scope = document.createElement("div");
    scope.setAttribute("data-keyboard-scope", "modal-or-menu");
    const button = document.createElement("button");
    scope.appendChild(button);
    document.body.appendChild(scope);

    expect(
      shouldHandlePipelineModeShortcut(shortcutEvent({ target: button }), false)
    ).toBe(false);

    scope.remove();
  });

  it("ignores shortcut while dragging or using modifier keys", () => {
    expect(shouldHandlePipelineModeShortcut(shortcutEvent(), true)).toBe(false);
    expect(
      shouldHandlePipelineModeShortcut(shortcutEvent({ metaKey: true }), false)
    ).toBe(false);
    expect(
      shouldHandlePipelineModeShortcut(shortcutEvent({ ctrlKey: true }), false)
    ).toBe(false);
  });
});
