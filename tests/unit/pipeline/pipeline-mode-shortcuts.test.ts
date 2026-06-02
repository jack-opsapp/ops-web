import React from "react";
import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  shouldHandlePipelineModeShortcut,
  type PipelineModeShortcutEvent,
  usePipelineModeShortcut,
} from "@/app/(dashboard)/pipeline/_components/pipeline-mode-shortcuts";
import { usePipelineModeStore } from "@/app/(dashboard)/pipeline/_components/pipeline-mode-store";
import { OpportunityStage } from "@/lib/types/pipeline";

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

function ShortcutHarness({
  enabled = true,
  isDragging = false,
}: {
  enabled?: boolean;
  isDragging?: boolean;
}) {
  usePipelineModeShortcut(isDragging, enabled);
  return null;
}

describe("pipeline mode shortcuts", () => {
  beforeEach(() => {
    localStorage.clear();
    usePipelineModeStore.setState({
      mode: "table",
      focusedStage: OpportunityStage.NewLead,
      detailPanelOpportunityId: null,
      detailPanelActiveTab: "correspondence",
      sortBy: "value",
      stageSortOverrides: new Map(),
    });
  });

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

  it("toggles mode from a window keydown when the hook is enabled", () => {
    render(React.createElement(ShortcutHarness));

    fireEvent.keyDown(window, { key: "v" });

    expect(usePipelineModeStore.getState().mode).toBe("focused");
  });

  it("does not install the hook shortcut when disabled", () => {
    render(React.createElement(ShortcutHarness, { enabled: false }));

    fireEvent.keyDown(window, { key: "v" });

    expect(usePipelineModeStore.getState().mode).toBe("table");
  });
});
