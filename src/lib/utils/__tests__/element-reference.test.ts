/**
 * Pure-helper tests for the bug-report element picker (bug 1f2bf7e9).
 *
 * Every helper under test is side-effect free: it reads the DOM and
 * returns data. jsdom gaps that matter here:
 *   - `getBoundingClientRect` always returns zeros → stubbed per element.
 *   - `HTMLElement.innerText` does not exist → the helper must fall back
 *     to `textContent`, and these tests pin that fallback.
 *   - `document.elementsFromPoint` does not exist → stubbed per test.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  describeElement,
  buildStableSelector,
  isPickable,
  resolvePickTarget,
  readComponentChain,
  pickFromPoint,
  computeCropRect,
  buildElementReference,
  captureElementCrop,
} from "../element-reference";

// ─── Fixtures ───────────────────────────────────────────────────────────────

interface RectInit {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** jsdom has no layout — give one element a rect the helpers can read. */
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

function mount(html: string): void {
  document.body.innerHTML = html;
}

function q<T extends Element = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Fixture missing: ${selector}`);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  document.body.innerHTML = "";
});

// ─── describeElement ────────────────────────────────────────────────────────

describe("describeElement — label precedence", () => {
  it("prefers aria-label over visible text", () => {
    mount(`<button aria-label="Save draft" data-testid="b">Save</button>`);
    expect(describeElement(q("button")).label).toBe("Save draft");
  });

  it("falls back to visible text, trimmed and whitespace-collapsed", () => {
    mount(`<button>  Save\n   now  </button>`);
    expect(describeElement(q("button")).label).toBe("Save now");
  });

  it("caps the label at 60 characters", () => {
    const long = "x".repeat(90);
    mount(`<button>${long}</button>`);
    expect(describeElement(q("button")).label).toHaveLength(60);
  });

  it("falls back to placeholder when there is no text", () => {
    mount(`<input type="text" placeholder="Email address" />`);
    expect(describeElement(q("input")).label).toBe("Email address");
  });

  it("falls back to alt", () => {
    mount(`<img alt="Site logo" />`);
    expect(describeElement(q("img")).label).toBe("Site logo");
  });

  it("falls back to title", () => {
    mount(`<span title="Tooltip text"></span>`);
    expect(describeElement(q("span")).label).toBe("Tooltip text");
  });

  it("falls back to the tag name last", () => {
    mount(`<div></div>`);
    expect(describeElement(q("div")).label).toBe("div");
  });
});

describe("describeElement — role", () => {
  it("uses an explicit role attribute", () => {
    mount(`<div role="tab">Overview</div>`);
    expect(describeElement(q("div")).role).toBe("tab");
  });

  it("maps implicit roles", () => {
    mount(`
      <button>b</button>
      <a href="/x">link</a>
      <a>no href</a>
      <input type="text" />
      <input type="email" />
      <input type="search" />
      <input type="url" />
      <input type="tel" />
      <input type="checkbox" />
      <input type="radio" />
      <select><option>a</option></select>
      <textarea></textarea>
      <div></div>
    `);
    expect(describeElement(q("button")).role).toBe("button");
    expect(describeElement(q('a[href="/x"]')).role).toBe("link");
    expect(describeElement(q("a:not([href])")).role).toBe("generic");
    expect(describeElement(q('input[type="text"]')).role).toBe("textbox");
    expect(describeElement(q('input[type="email"]')).role).toBe("textbox");
    expect(describeElement(q('input[type="search"]')).role).toBe("textbox");
    expect(describeElement(q('input[type="url"]')).role).toBe("textbox");
    expect(describeElement(q('input[type="tel"]')).role).toBe("textbox");
    expect(describeElement(q('input[type="checkbox"]')).role).toBe("checkbox");
    expect(describeElement(q('input[type="radio"]')).role).toBe("radio");
    expect(describeElement(q("select")).role).toBe("combobox");
    expect(describeElement(q("textarea")).role).toBe("textbox");
    expect(describeElement(q("div")).role).toBe("generic");
  });
});

describe("describeElement — tag, text, classes, testId", () => {
  it("reads the lowercase tag, class attribute and data-testid", () => {
    mount(`<button class="px-2 py-1 rounded-chip" data-testid="save-btn">Save</button>`);
    const d = describeElement(q("button"));
    expect(d.tag).toBe("button");
    expect(d.classes).toBe("px-2 py-1 rounded-chip");
    expect(d.testId).toBe("save-btn");
  });

  it("reports a null testId and empty classes when absent", () => {
    mount(`<div>x</div>`);
    const d = describeElement(q("div"));
    expect(d.testId).toBeNull();
    expect(d.classes).toBe("");
  });

  it("falls back to textContent when innerText is unavailable (jsdom)", () => {
    mount(`<div><span>Alpha</span> <span>Beta</span></div>`);
    const el = q("div");
    expect((el as HTMLElement).innerText).toBeUndefined();
    expect(describeElement(el).text).toBe("Alpha Beta");
  });

  it("caps the text snippet at 120 characters", () => {
    mount(`<div>${"y".repeat(400)}</div>`);
    expect(describeElement(q("div")).text).toHaveLength(120);
  });
});

// ─── buildStableSelector ────────────────────────────────────────────────────

describe("buildStableSelector", () => {
  it("anchors on data-testid and resolves back to the element", () => {
    mount(`<div><section><button data-testid="save-btn">Save</button></section></div>`);
    const el = q("button");
    const sel = buildStableSelector(el);
    expect(sel).toContain('[data-testid="save-btn"]');
    expect(document.querySelector(sel)).toBe(el);
  });

  it("anchors on a usable id", () => {
    mount(`<div id="settings-panel"><span>x</span></div>`);
    const el = q("#settings-panel span");
    const sel = buildStableSelector(el);
    expect(sel).toContain("#settings-panel");
    expect(document.querySelector(sel)).toBe(el);
  });

  it("ignores a digits-only id", () => {
    mount(`<div id="12345"><b>t</b></div>`);
    const el = q("div");
    const sel = buildStableSelector(el);
    expect(sel).not.toContain("#12345");
    expect(document.querySelector(sel)).toBe(el);
  });

  it("ignores an id longer than 40 characters", () => {
    const id = "a".repeat(41);
    mount(`<div id="${id}">t</div>`);
    const el = q("div");
    const sel = buildStableSelector(el);
    expect(sel).not.toContain(id);
    expect(document.querySelector(sel)).toBe(el);
  });

  it("uses aria-label when there is no testid or id", () => {
    mount(`<nav><div aria-label="Main nav"><i>x</i></div></nav>`);
    const el = q('[aria-label="Main nav"]');
    const sel = buildStableSelector(el);
    expect(sel).toContain('[aria-label="Main nav"]');
    expect(document.querySelector(sel)).toBe(el);
  });

  it("never emits utility classes", () => {
    mount(`<main><div class="px-2 py-1 flex items-center"><p>copy</p></div></main>`);
    const el = q("p");
    const sel = buildStableSelector(el);
    expect(sel).not.toContain(".");
    expect(sel).toContain("nth-of-type");
    expect(document.querySelector(sel)).toBe(el);
  });

  it("disambiguates siblings with nth-of-type", () => {
    mount(`<ul><li>one</li><li>two</li><li>three</li></ul>`);
    const el = document.querySelectorAll("li")[1] as HTMLElement;
    const sel = buildStableSelector(el);
    expect(document.querySelector(sel)).toBe(el);
  });

  it("climbs at most 6 levels", () => {
    mount(
      `<div><section><article><aside><nav><ul><li><p><span><b>deep</b></span></p></li></ul></nav></aside></article></section></div>`
    );
    const el = q("b");
    const sel = buildStableSelector(el);
    expect(sel.split(" > ")).toHaveLength(6);
    expect(document.querySelector(sel)).toBe(el);
  });
});

// ─── isPickable / resolvePickTarget ─────────────────────────────────────────

describe("isPickable", () => {
  it("rejects html and body", () => {
    stubRect(document.documentElement, { x: 0, y: 0, width: 1000, height: 800 });
    stubRect(document.body, { x: 0, y: 0, width: 1000, height: 800 });
    expect(isPickable(document.documentElement)).toBe(false);
    expect(isPickable(document.body)).toBe(false);
  });

  it("rejects zero-size elements", () => {
    mount(`<div>hidden</div>`);
    const el = q("div");
    stubRect(el, { x: 0, y: 0, width: 0, height: 0 });
    expect(isPickable(el)).toBe(false);
  });

  it("accepts a laid-out element", () => {
    mount(`<div>visible</div>`);
    const el = q("div");
    stubRect(el, { x: 10, y: 20, width: 100, height: 40 });
    expect(isPickable(el)).toBe(true);
  });

  it("rejects anything under a data-bug-report-ignore ancestor", () => {
    mount(`<div data-bug-report-ignore="true"><button>Report</button></div>`);
    const el = q("button");
    stubRect(el, { x: 0, y: 0, width: 80, height: 24 });
    expect(isPickable(el)).toBe(false);
  });

  it("rejects the picker overlay root and its subtree", () => {
    mount(`<div data-element-picker-root=""><span>hint</span></div>`);
    const root = q("[data-element-picker-root]");
    const child = q("[data-element-picker-root] span");
    stubRect(root, { x: 0, y: 0, width: 1000, height: 800 });
    stubRect(child, { x: 0, y: 0, width: 100, height: 20 });
    expect(isPickable(root)).toBe(false);
    expect(isPickable(child)).toBe(false);
  });

  it("accepts an iframe as itself", () => {
    mount(`<iframe title="map"></iframe>`);
    const el = q("iframe");
    stubRect(el, { x: 0, y: 0, width: 300, height: 200 });
    expect(isPickable(el)).toBe(true);
  });
});

describe("resolvePickTarget", () => {
  it("resolves an SVG descendant to its nearest HTML ancestor", () => {
    mount(`<button data-testid="icon-btn"><svg><path d="M0 0"></path></svg></button>`);
    const path = document.querySelector("path");
    expect(path).not.toBeNull();
    expect(resolvePickTarget(path as Element)).toBe(q("button"));
  });

  it("returns an HTML element unchanged", () => {
    mount(`<div>x</div>`);
    const el = q("div");
    expect(resolvePickTarget(el)).toBe(el);
  });

  it("returns null for a detached non-HTML node", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    expect(resolvePickTarget(svg)).toBeNull();
  });
});

// ─── readComponentChain ─────────────────────────────────────────────────────

describe("readComponentChain", () => {
  it("returns an empty chain when no react fiber key exists", () => {
    mount(`<div>x</div>`);
    expect(readComponentChain(q("div"))).toEqual([]);
  });

  it("returns the nearest 3 named components, skipping hosts and anonymous types", () => {
    mount(`<div>x</div>`);
    const el = q("div");

    function Card() {}
    function Panel() {}
    function Fourth() {}
    class Drawer {}
    const anon = function () {};
    Object.defineProperty(anon, "name", { value: "" });

    const chain = [
      { type: "div" },
      { type: Card },
      { type: "span" },
      { type: anon },
      { type: Drawer },
      { type: Panel },
      { type: Fourth },
    ];
    let next: unknown = null;
    for (let i = chain.length - 1; i >= 0; i--) {
      next = { ...chain[i], return: next };
    }
    (el as unknown as Record<string, unknown>)["__reactFiber$testkey"] = next;

    expect(readComponentChain(el)).toEqual(["Card", "Drawer", "Panel"]);
  });

  it("prefers displayName", () => {
    mount(`<div>x</div>`);
    const el = q("div");
    function Inner() {}
    (Inner as unknown as { displayName: string }).displayName = "BugReportDrawer";
    (el as unknown as Record<string, unknown>)["__reactFiber$abc"] = {
      type: Inner,
      return: null,
    };
    expect(readComponentChain(el)).toEqual(["BugReportDrawer"]);
  });
});

// ─── pickFromPoint ──────────────────────────────────────────────────────────

describe("pickFromPoint", () => {
  it("skips the overlay subtree and returns the first pickable element", () => {
    mount(`
      <div data-element-picker-root=""><span id="overlay-child">hint</span></div>
      <button id="target">Save</button>
    `);
    const overlayChild = q("#overlay-child");
    const target = q("#target");
    stubRect(overlayChild, { x: 0, y: 0, width: 100, height: 20 });
    stubRect(target, { x: 10, y: 10, width: 80, height: 24 });
    stubRect(document.body, { x: 0, y: 0, width: 1000, height: 800 });
    stubRect(document.documentElement, { x: 0, y: 0, width: 1000, height: 800 });

    const doc = {
      elementsFromPoint: () => [overlayChild, target, document.body, document.documentElement],
    } as unknown as Document;

    expect(pickFromPoint(50, 50, doc)).toBe(target);
  });

  it("returns null when every candidate is ignored", () => {
    mount(`<div data-bug-report-ignore="true"><button id="drawer-btn">Send</button></div>`);
    const btn = q("#drawer-btn");
    stubRect(btn, { x: 0, y: 0, width: 80, height: 24 });
    stubRect(document.body, { x: 0, y: 0, width: 1000, height: 800 });
    stubRect(document.documentElement, { x: 0, y: 0, width: 1000, height: 800 });

    const doc = {
      elementsFromPoint: () => [btn, document.body, document.documentElement],
    } as unknown as Document;

    expect(pickFromPoint(5, 5, doc)).toBeNull();
  });
});

// ─── computeCropRect ────────────────────────────────────────────────────────

describe("computeCropRect", () => {
  it("pads, clamps at the top-left corner and scales", () => {
    const out = computeCropRect(
      { x: 0, y: 0, width: 100, height: 50 },
      { width: 1000, height: 800 },
      24,
      2
    );
    // left/top clamp to 0; right = 100 + 24 = 124; bottom = 50 + 24 = 74.
    expect(out).toEqual({ x: 0, y: 0, width: 248, height: 148 });
  });

  it("clamps an overflowing bottom-right to the viewport", () => {
    const out = computeCropRect(
      { x: 900, y: 700, width: 200, height: 200 },
      { width: 1000, height: 800 },
      24,
      1
    );
    // left = 876, top = 676, right clamps to 1000, bottom clamps to 800.
    expect(out).toEqual({ x: 876, y: 676, width: 124, height: 124 });
  });

  it("rounds to integers", () => {
    const out = computeCropRect(
      { x: 10.4, y: 20.6, width: 33.3, height: 17.7 },
      { width: 1000, height: 800 },
      24,
      1.5
    );
    expect(Number.isInteger(out.x)).toBe(true);
    expect(Number.isInteger(out.y)).toBe(true);
    expect(Number.isInteger(out.width)).toBe(true);
    expect(Number.isInteger(out.height)).toBe(true);
  });
});

// ─── buildElementReference ──────────────────────────────────────────────────

describe("buildElementReference", () => {
  const originalScrollX = Object.getOwnPropertyDescriptor(window, "scrollX");
  const originalScrollY = Object.getOwnPropertyDescriptor(window, "scrollY");

  afterEach(() => {
    if (originalScrollX) Object.defineProperty(window, "scrollX", originalScrollX);
    if (originalScrollY) Object.defineProperty(window, "scrollY", originalScrollY);
  });

  it("composes description, selector, geometry and metadata", () => {
    mount(
      `<section><button data-testid="save-btn" class="px-2 py-1" aria-label="Save draft">Save</button></section>`
    );
    const el = q("button");
    stubRect(el, { x: 120, y: 240, width: 96, height: 32 });
    Object.defineProperty(window, "scrollX", { configurable: true, value: 40 });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 300 });

    const ref = buildElementReference(el, {
      id: "ref-1",
      now: "2026-08-31T12:00:00.000Z",
    });

    expect(ref.id).toBe("ref-1");
    expect(ref.capturedAt).toBe("2026-08-31T12:00:00.000Z");
    expect(ref.label).toBe("Save draft");
    expect(ref.role).toBe("button");
    expect(ref.tag).toBe("button");
    expect(ref.testId).toBe("save-btn");
    expect(ref.classes).toBe("px-2 py-1");
    expect(ref.selector).toContain('[data-testid="save-btn"]');
    expect(ref.rect).toEqual({ x: 120, y: 240, width: 96, height: 32 });
    expect(ref.page).toEqual({ x: 160, y: 540 });
    expect(ref.viewport).toEqual({ width: window.innerWidth, height: window.innerHeight });
    expect(ref.componentChain).toEqual([]);
    expect(ref.attachmentIndex).toBeNull();
  });

  it("generates an id and timestamp when none are supplied", () => {
    mount(`<div>x</div>`);
    const el = q("div");
    stubRect(el, { x: 0, y: 0, width: 10, height: 10 });
    const ref = buildElementReference(el);
    expect(ref.id).toMatch(/\S/);
    expect(() => new Date(ref.capturedAt).toISOString()).not.toThrow();
  });
});

// ─── captureElementCrop ─────────────────────────────────────────────────────
//
// jsdom ships no canvas implementation and no `createImageBitmap`, so the
// decode + draw surface is stubbed. The assertions still pin real behavior:
// which region is read out of the full-page capture, how the canvas is
// sized, and that a capture failure is surfaced rather than swallowed.

describe("captureElementCrop", () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const originalToBlob = HTMLCanvasElement.prototype.toBlob;
  const originalCreateImageBitmap = (
    globalThis as unknown as { createImageBitmap?: unknown }
  ).createImageBitmap;
  const originalImage = globalThis.Image;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  let drawImage: ReturnType<typeof vi.fn>;
  let lastCanvas: HTMLCanvasElement | null = null;
  let croppedBlob: Blob;

  beforeEach(() => {
    drawImage = vi.fn();
    lastCanvas = null;
    croppedBlob = new Blob(["cropped"], { type: "image/png" });
    const rememberCanvas = (canvas: HTMLCanvasElement) => {
      lastCanvas = canvas;
    };

    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement
    ) {
      rememberCanvas(this);
      return { drawImage } as unknown as CanvasRenderingContext2D;
    } as unknown as typeof HTMLCanvasElement.prototype.getContext;

    HTMLCanvasElement.prototype.toBlob = function (
      cb: BlobCallback
    ) {
      cb(croppedBlob);
    } as unknown as typeof HTMLCanvasElement.prototype.toBlob;

    (globalThis as unknown as { createImageBitmap: unknown }).createImageBitmap =
      vi.fn(async () => ({ width: 2048, height: 1536, close: vi.fn() }));
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    HTMLCanvasElement.prototype.toBlob = originalToBlob;
    (globalThis as unknown as { createImageBitmap?: unknown }).createImageBitmap =
      originalCreateImageBitmap;
    globalThis.Image = originalImage;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  function mountTarget(): HTMLElement {
    mount(`<button data-testid="target">Save</button>`);
    const el = q("button");
    stubRect(el, { x: 100, y: 200, width: 50, height: 25 });
    return el;
  }

  it("captures the whole page once and resolves with the crop blob and rect", async () => {
    const el = mountTarget();
    const fullPage = new Blob(["full"], { type: "image/png" });
    const capture = vi.fn<
      (root: HTMLElement, options: { scale: number }) => Promise<Blob>
    >(async () => fullPage);

    const result = await captureElementCrop(el, { capture, scale: 2 });

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][0]).toBe(document.body);
    expect(result.blob).toBe(croppedBlob);
    expect(result.cropRect).toEqual(
      computeCropRect(
        { x: 100, y: 200, width: 50, height: 25 },
        { width: window.innerWidth, height: window.innerHeight },
        24,
        2
      )
    );
  });

  it("sizes the canvas to the crop rect and draws only that region", async () => {
    const el = mountTarget();
    const capture = vi.fn<
      (root: HTMLElement, options: { scale: number }) => Promise<Blob>
    >(async () => new Blob(["full"], { type: "image/png" }));

    const { cropRect } = await captureElementCrop(el, { capture, scale: 2 });

    expect(lastCanvas).not.toBeNull();
    expect(lastCanvas?.width).toBe(cropRect.width);
    expect(lastCanvas?.height).toBe(cropRect.height);
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(drawImage.mock.calls[0].slice(1)).toEqual([
      cropRect.x,
      cropRect.y,
      cropRect.width,
      cropRect.height,
      0,
      0,
      cropRect.width,
      cropRect.height,
    ]);
  });

  it("surfaces a capture failure instead of swallowing it", async () => {
    const el = mountTarget();
    const capture = vi.fn<
      (root: HTMLElement, options: { scale: number }) => Promise<Blob>
    >(async () => {
      throw new Error("dom-to-blob exploded");
    });

    await expect(captureElementCrop(el, { capture, scale: 1 })).rejects.toThrow(
      "dom-to-blob exploded"
    );
    expect(drawImage).not.toHaveBeenCalled();
  });

  it("falls back to an Image element when createImageBitmap is unavailable", async () => {
    const el = mountTarget();
    delete (globalThis as unknown as { createImageBitmap?: unknown }).createImageBitmap;

    const revoke = vi.fn();
    URL.createObjectURL = vi.fn(() => "blob:element-crop") as typeof URL.createObjectURL;
    URL.revokeObjectURL = revoke as typeof URL.revokeObjectURL;

    class FakeImage {
      onload: (() => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      width = 2048;
      height = 1536;
      private _src = "";
      set src(value: string) {
        this._src = value;
        queueMicrotask(() => this.onload?.());
      }
      get src(): string {
        return this._src;
      }
    }
    globalThis.Image = FakeImage as unknown as typeof Image;

    const capture = vi.fn<
      (root: HTMLElement, options: { scale: number }) => Promise<Blob>
    >(async () => new Blob(["full"], { type: "image/png" }));
    const result = await captureElementCrop(el, { capture, scale: 1 });

    expect(result.blob).toBe(croppedBlob);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith("blob:element-crop");
    expect(drawImage).toHaveBeenCalledTimes(1);
  });
});
