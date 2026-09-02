/**
 * Capture-overlay tests for the bug-report element picker (bug 1f2bf7e9).
 *
 * The overlay never touches page elements — it hit-tests through itself with
 * `document.elementsFromPoint`, which jsdom does not implement, so every test
 * stubs it with the stack it wants resolved. Rects are stubbed too (jsdom has
 * no layout).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import { BugReportElementPicker } from "../bug-report-element-picker";
import en from "@/i18n/dictionaries/en/common.json";

// ─── Harness ────────────────────────────────────────────────────────────────

// jsdom implements no `PointerEvent`, so Testing Library's `fireEvent.
// pointerMove` degrades to a bare `Event` and silently drops clientX/clientY —
// the overlay would then hit-test at no coordinates at all. Provide the real
// shape (PointerEvent extends MouseEvent, which carries the coordinates) so
// the assertions test the component rather than the gap.
if (typeof (globalThis as { PointerEvent?: unknown }).PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {}
  (globalThis as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventPolyfill;
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventPolyfill;
}

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, params?: string | Record<string, unknown>) => {
      const dict = en as Record<string, string>;
      const value = dict[key];
      if (typeof value !== "string") {
        return typeof params === "string" ? params : key;
      }
      if (params && typeof params === "object") {
        return value.replace(/\{(\w+)\}/g, (m, token) =>
          token in params ? String(params[token as string]) : m
        );
      }
      return value;
    },
  }),
}));

interface RectInit {
  x: number;
  y: number;
  width: number;
  height: number;
}

function stubRect(el: Element, r: RectInit): void {
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      top: r.y,
      left: r.x,
      right: r.x + r.width,
      bottom: r.y + r.height,
      toJSON: () => r,
    }),
  });
}

/** The stack `document.elementsFromPoint` should report for every hit-test. */
function stubHitStack(stack: Element[]): void {
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    writable: true,
    value: () => stack,
  });
}

function mountPage(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

function overlayRoot(): HTMLElement {
  const root = document.querySelector<HTMLElement>("[data-element-picker-root]");
  if (!root) throw new Error("Picker overlay is not mounted");
  return root;
}

function highlight(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-element-picker-highlight]");
}

let pageHost: HTMLElement | null = null;

function renderPicker(
  overrides: Partial<{
    open: boolean;
    onSelect: ReturnType<typeof vi.fn>;
    onCancel: ReturnType<typeof vi.fn>;
    captureCrop: ReturnType<typeof vi.fn>;
  }> = {}
) {
  const onSelect = overrides.onSelect ?? vi.fn();
  const onCancel = overrides.onCancel ?? vi.fn();
  const captureCrop =
    overrides.captureCrop ?? vi.fn(async () => new Blob(["crop"], { type: "image/png" }));

  const utils = render(
    <BugReportElementPicker
      open={overrides.open ?? true}
      onSelect={onSelect}
      onCancel={onCancel}
      captureCrop={captureCrop}
    />
  );

  return { ...utils, onSelect, onCancel, captureCrop };
}

beforeEach(() => {
  pageHost = null;
});

afterEach(() => {
  pageHost?.remove();
  pageHost = null;
  Reflect.deleteProperty(document, "elementsFromPoint");
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("BugReportElementPicker — mounting", () => {
  it("portals a labelled dialog into the body that the capture filter skips", () => {
    renderPicker();
    const root = overlayRoot();

    expect(root.parentElement).toBe(document.body);
    expect(root.dataset.bugReportIgnore).toBe("true");
    expect(root.getAttribute("role")).toBe("dialog");
    expect(root.getAttribute("aria-modal")).toBe("true");
    expect(root.getAttribute("aria-label")).toBe(en["bugReport.picker.dialogLabel"]);
  });

  it("renders nothing while closed", () => {
    renderPicker({ open: false });
    expect(document.querySelector("[data-element-picker-root]")).toBeNull();
  });

  it("shows the hint and the key legend", () => {
    renderPicker();
    expect(screen.getByText(en["bugReport.picker.hint"])).toBeInTheDocument();
    expect(screen.getByText(en["bugReport.picker.keys"])).toBeInTheDocument();
  });
});

describe("BugReportElementPicker — pointer", () => {
  function setupTarget(): HTMLElement {
    pageHost = mountPage(`<button id="save">Save</button>`);
    const target = pageHost.querySelector<HTMLElement>("#save")!;
    stubRect(target, { x: 120, y: 240, width: 96, height: 32 });
    stubHitStack([target, document.body, document.documentElement]);
    return target;
  }

  it("highlights the hovered element and labels it role · name", async () => {
    setupTarget();
    renderPicker();

    fireEvent.pointerMove(overlayRoot(), { clientX: 150, clientY: 250 });

    await waitFor(() => expect(highlight()).not.toBeNull());
    const box = highlight()!;
    expect(box.style.width).toBe("96px");
    expect(box.style.height).toBe("32px");
    expect(box.style.transform).toContain("120px");
    expect(box.style.transform).toContain("240px");
    expect(screen.getByText("button · Save")).toBeInTheDocument();
  });

  it("selects on click, capturing a crop for the picked element", async () => {
    const target = setupTarget();
    const crop = new Blob(["crop"], { type: "image/png" });
    const captureCrop = vi.fn(async () => crop);
    const { onSelect } = renderPicker({ captureCrop });

    fireEvent.pointerMove(overlayRoot(), { clientX: 150, clientY: 250 });
    await waitFor(() => expect(highlight()).not.toBeNull());

    fireEvent.click(overlayRoot(), { clientX: 150, clientY: 250 });

    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(captureCrop).toHaveBeenCalledTimes(1);
    expect(captureCrop.mock.calls[0][0]).toBe(target);

    const result = onSelect.mock.calls[0][0];
    expect(result.element).toBe(target);
    expect(result.crop).toBe(crop);
    expect(result.reference.label).toBe("Save");
    expect(result.reference.role).toBe("button");
    expect(result.reference.attachmentIndex).toBeNull();
  });

  it("announces the capture and ignores further pointer input while it runs", async () => {
    setupTarget();
    let release: (b: Blob | null) => void = () => {};
    const captureCrop = vi.fn(
      () =>
        new Promise<Blob | null>((resolve) => {
          release = resolve;
        })
    );
    const { onSelect } = renderPicker({ captureCrop });

    fireEvent.pointerMove(overlayRoot(), { clientX: 150, clientY: 250 });
    await waitFor(() => expect(highlight()).not.toBeNull());
    fireEvent.click(overlayRoot(), { clientX: 150, clientY: 250 });

    await waitFor(() =>
      expect(screen.getByText(en["bugReport.picker.capturing"])).toBeInTheDocument()
    );

    // A second click mid-capture must not queue a second selection.
    fireEvent.click(overlayRoot(), { clientX: 150, clientY: 250 });
    expect(captureCrop).toHaveBeenCalledTimes(1);

    await act(async () => {
      release(null);
    });
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(onSelect.mock.calls[0][0].crop).toBeNull();
  });

  it("still selects when the crop capture fails", async () => {
    setupTarget();
    const captureCrop = vi.fn(async () => {
      throw new Error("capture exploded");
    });
    const { onSelect } = renderPicker({ captureCrop });

    fireEvent.pointerMove(overlayRoot(), { clientX: 150, clientY: 250 });
    await waitFor(() => expect(highlight()).not.toBeNull());
    fireEvent.click(overlayRoot(), { clientX: 150, clientY: 250 });

    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(onSelect.mock.calls[0][0].crop).toBeNull();
  });
});

describe("BugReportElementPicker — cancel", () => {
  it("cancels on Escape without selecting", async () => {
    pageHost = mountPage(`<button id="save">Save</button>`);
    const target = pageHost.querySelector<HTMLElement>("#save")!;
    stubRect(target, { x: 0, y: 0, width: 50, height: 20 });
    stubHitStack([target, document.body, document.documentElement]);

    const { onSelect, onCancel } = renderPicker();
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("cancels from the hint's cancel control", () => {
    const { onCancel } = renderPicker();
    fireEvent.click(screen.getByText(en["bugReport.picker.cancel"]));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("BugReportElementPicker — keyboard", () => {
  it("follows focus and selects the focused element on Enter", async () => {
    pageHost = mountPage(`<button id="focus-me">Send</button>`);
    const target = pageHost.querySelector<HTMLElement>("#focus-me")!;
    stubRect(target, { x: 10, y: 20, width: 60, height: 24 });
    stubHitStack([]);

    const { onSelect } = renderPicker();

    act(() => {
      target.focus();
    });

    await waitFor(() => expect(highlight()).not.toBeNull());
    expect(screen.getByText("button · Send")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Enter" });

    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(onSelect.mock.calls[0][0].element).toBe(target);
  });
});

describe("BugReportElementPicker — touch", () => {
  it("highlights on touchstart and selects on touchend", async () => {
    pageHost = mountPage(`<button id="tap">Tap</button>`);
    const target = pageHost.querySelector<HTMLElement>("#tap")!;
    stubRect(target, { x: 5, y: 6, width: 40, height: 40 });
    stubHitStack([target, document.body, document.documentElement]);

    const { onSelect } = renderPicker();
    const root = overlayRoot();

    fireEvent.touchStart(root, { touches: [{ clientX: 20, clientY: 20 }] });
    await waitFor(() => expect(highlight()).not.toBeNull());

    fireEvent.touchEnd(root, { changedTouches: [{ clientX: 20, clientY: 20 }] });
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(onSelect.mock.calls[0][0].element).toBe(target);
  });
});

describe("BugReportElementPicker — exclusions", () => {
  it("never highlights or selects anything the reporter opts out of", async () => {
    pageHost = mountPage(
      `<div data-bug-report-ignore="true"><button id="drawer-send">Send</button></div>`
    );
    const ignored = pageHost.querySelector<HTMLElement>("#drawer-send")!;
    stubRect(ignored, { x: 0, y: 0, width: 80, height: 24 });
    stubRect(document.body, { x: 0, y: 0, width: 1024, height: 768 });
    stubHitStack([ignored, document.body, document.documentElement]);

    const { onSelect } = renderPicker();
    const root = overlayRoot();

    fireEvent.pointerMove(root, { clientX: 10, clientY: 10 });
    await new Promise((r) => setTimeout(r, 40));
    expect(highlight()).toBeNull();

    fireEvent.click(root, { clientX: 10, clientY: 10 });
    await new Promise((r) => setTimeout(r, 40));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
