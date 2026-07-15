/**
 * showUndoToast — the shared undo toast helper on the canonical Sonner wrapper.
 *
 * Contract: one call renders one wrapper toast with an UNDO action button,
 * the caller's duration, and dismiss/auto-close callbacks so callers can
 * release their undo-entry state when the toast leaves the screen.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/toast", () => ({
  toast: vi.fn(() => 1),
}));

import { toast } from "@/components/ui/toast";
import { showUndoToast } from "@/components/ui/toast-undo";

const toastMock = vi.mocked(toast);

describe("showUndoToast", () => {
  beforeEach(() => {
    toastMock.mockClear();
  });

  it("renders the title through the canonical toast with an undo action and duration", () => {
    const onUndo = vi.fn();
    const id = showUndoToast({
      title: "VALUE UPDATED",
      description: "Deal Alpha",
      undoLabel: "UNDO",
      onUndo,
      duration: 10_000,
    });

    expect(id).toBe(1);
    expect(toastMock).toHaveBeenCalledTimes(1);
    const [title, options] = toastMock.mock.calls[0];
    expect(title).toBe("VALUE UPDATED");
    expect(options).toMatchObject({
      description: "Deal Alpha",
      duration: 10_000,
    });
    const action = options?.action as { label: string; onClick: (e: unknown) => void };
    expect(action.label).toBe("UNDO");

    action.onClick(new MouseEvent("click"));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("defaults to a 10s duration", () => {
    showUndoToast({ title: "STATUS UPDATED", undoLabel: "UNDO", onUndo: () => {} });
    expect(toastMock.mock.calls[0][1]?.duration).toBe(10_000);
  });

  it("renders an explicit dismiss button when dismissLabel is given", () => {
    showUndoToast({
      title: "STATUS UPDATED",
      undoLabel: "UNDO",
      dismissLabel: "DISMISS",
      onUndo: () => {},
    });
    const options = toastMock.mock.calls[0][1] as {
      cancel?: { label: string };
    };
    expect(options.cancel?.label).toBe("DISMISS");
  });

  it("fires onDismiss for both manual dismissal and auto-close", () => {
    const onDismiss = vi.fn();
    showUndoToast({
      title: "STATUS UPDATED",
      undoLabel: "UNDO",
      onUndo: () => {},
      onDismiss,
    });
    const options = toastMock.mock.calls[0][1] as {
      onDismiss?: (t: unknown) => void;
      onAutoClose?: (t: unknown) => void;
    };
    options.onDismiss?.({});
    options.onAutoClose?.({});
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });
});
