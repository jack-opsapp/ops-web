/**
 * Drawer ↔ element-picker integration (bug 1f2bf7e9).
 *
 * Drives the REAL picker overlay through the REAL drawer — the only mocked
 * surfaces are the network/auth/capture boundaries and the jsdom gaps
 * (`PointerEvent`, `elementsFromPoint`, canvas, layout rects).
 *
 * The drawer had no test harness before this file; the mocks below are
 * modelled on the repo's other component harnesses (dictionary mock from
 * `tests/unit/settings/*`, route/FormData assertions from
 * `tests/integration/bug-reports-screenshot-s3.test.ts`).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import en from "@/i18n/dictionaries/en/common.json";

// ─── jsdom gaps ─────────────────────────────────────────────────────────────

// No `PointerEvent` in jsdom → Testing Library degrades pointer events to a
// bare `Event` and drops clientX/clientY, which the overlay hit-tests with.
if (typeof (globalThis as { PointerEvent?: unknown }).PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {}
  (globalThis as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventPolyfill;
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventPolyfill;
}

// ─── Mocks ──────────────────────────────────────────────────────────────────

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

const COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";

let currentUserEmail = "operator@example.com";

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({
    currentUser: {
      id: USER_ID,
      companyId: COMPANY_ID,
      email: currentUserEmail,
      firstName: "Jackson",
      lastName: "Sweet",
      role: "admin",
      isCompanyAdmin: true,
    },
    company: { name: "Canpro" },
  }),
}));

const createReport = vi.fn<(input: unknown) => Promise<string>>(
  async () => "report-row-id"
);
vi.mock("@/lib/api/services/bug-report-service", () => ({
  BugReportService: {
    createReport: (input: unknown) => createReport(input),
  },
}));

const domToBlob = vi.fn<(root: unknown, options: unknown) => Promise<Blob>>(
  async () => new Blob(["page"], { type: "image/png" })
);
vi.mock("modern-screenshot", () => ({
  domToBlob: (root: unknown, opts: unknown) => domToBlob(root, opts),
}));

const getIdToken = vi.fn(async () => "firebase-id-token");
vi.mock("@/lib/firebase/config", () => ({
  getFirebaseAuth: () => ({ currentUser: { getIdToken } }),
}));

import { BugReportDrawer } from "@/components/ops/bug-report-drawer";
import { useEdgeTabStore } from "@/stores/edge-tab-store";

// ─── DOM harness ────────────────────────────────────────────────────────────

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

function stubHitStack(stack: Element[]): void {
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    writable: true,
    value: () => stack,
  });
}

let pageHost: HTMLElement;
let fetchMock: ReturnType<typeof vi.fn>;

const originalGetContext = HTMLCanvasElement.prototype.getContext;
const originalToBlob = HTMLCanvasElement.prototype.toBlob;
const originalCreateImageBitmap = (globalThis as { createImageBitmap?: unknown })
  .createImageBitmap;
const originalFetch = globalThis.fetch;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

/** Page content the operator can point at. */
function mountPage(): Record<string, HTMLElement> {
  pageHost = document.createElement("div");
  pageHost.innerHTML = `
    <button id="save">Save</button>
    <button id="send">Send</button>
    <button id="print">Print</button>
  `;
  document.body.appendChild(pageHost);
  const targets: Record<string, HTMLElement> = {};
  for (const id of ["save", "send", "print"]) {
    const el = pageHost.querySelector<HTMLElement>(`#${id}`)!;
    stubRect(el, { x: 10, y: 40, width: 80, height: 28 });
    targets[id] = el;
  }
  return targets;
}

function drawerAside(): HTMLElement {
  const aside = document.querySelector<HTMLElement>('aside[data-bug-report-ignore="true"]');
  if (!aside) throw new Error("Drawer aside is not mounted");
  return aside;
}

function selectAction(): HTMLElement {
  return screen.getByRole("button", { name: `[ ${en["bugReport.picker.select"]} ]` });
}

async function openPicker(): Promise<void> {
  fireEvent.click(selectAction());
  await waitFor(() =>
    expect(document.querySelector("[data-element-picker-root]")).not.toBeNull()
  );
}

/** Full pick cycle through the real overlay. */
async function pick(target: HTMLElement): Promise<void> {
  stubHitStack([target, document.body, document.documentElement]);
  await openPicker();
  const root = document.querySelector<HTMLElement>("[data-element-picker-root]")!;
  fireEvent.pointerMove(root, { clientX: 20, clientY: 50 });
  await waitFor(() =>
    expect(document.querySelector("[data-element-picker-highlight]")).not.toBeNull()
  );
  fireEvent.click(root, { clientX: 20, clientY: 50 });
}

// A successful submission schedules a 1200ms close on the shared edge-tab
// store. RTL unmounts the drawer between tests but cannot cancel that timer,
// so without this guard it fires mid-way through a later test and closes the
// drawer out from under it. Track and cancel every timer a test leaves behind.
const pendingTimers = new Set<number>();
const realSetTimeout = window.setTimeout;

beforeEach(() => {
  window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const id = realSetTimeout(handler as never, timeout, ...(args as []));
    pendingTimers.add(id as unknown as number);
    return id;
  }) as typeof window.setTimeout;

  currentUserEmail = "operator@example.com";
  createReport.mockReset();
  createReport.mockResolvedValue("report-row-id");
  domToBlob.mockReset();
  domToBlob.mockResolvedValue(new Blob(["page"], { type: "image/png" }));
  getIdToken.mockReset();
  getIdToken.mockResolvedValue("firebase-id-token");

  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true, path: "s3:key" }),
  }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  let urlSeq = 0;
  URL.createObjectURL = vi.fn(() => `blob:thumb-${urlSeq++}`) as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;

  HTMLCanvasElement.prototype.getContext = function () {
    return { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
    cb(new Blob(["crop"], { type: "image/png" }));
  } as unknown as typeof HTMLCanvasElement.prototype.toBlob;
  (globalThis as unknown as { createImageBitmap: unknown }).createImageBitmap = vi.fn(
    async () => ({ width: 2048, height: 1536, close: vi.fn() })
  );

  act(() => {
    useEdgeTabStore.setState({ activeTab: "bug-report" });
  });
});

afterEach(() => {
  for (const id of pendingTimers) window.clearTimeout(id);
  pendingTimers.clear();
  window.setTimeout = realSetTimeout;

  act(() => {
    useEdgeTabStore.setState({ activeTab: null });
  });
  pageHost?.remove();
  Reflect.deleteProperty(document, "elementsFromPoint");
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  HTMLCanvasElement.prototype.toBlob = originalToBlob;
  (globalThis as { createImageBitmap?: unknown }).createImageBitmap =
    originalCreateImageBitmap;
  globalThis.fetch = originalFetch;
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  vi.restoreAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("bug-report drawer — the SELECT ELEMENT action", () => {
  it("offers the action to a minimal-form operator", () => {
    mountPage();
    render(<BugReportDrawer />);
    expect(selectAction()).toBeInTheDocument();
  });

  it("offers the action to the power user too", () => {
    currentUserEmail = "canprojack@gmail.com";
    mountPage();
    render(<BugReportDrawer />);
    expect(selectAction()).toBeInTheDocument();
  });

  it("sits in the auto-capture block", () => {
    mountPage();
    render(<BugReportDrawer />);
    const block = screen.getByText(en["bugReport.autoCapture"], { exact: false })
      .parentElement;
    expect(block).toContainElement(selectAction());
  });
});

describe("bug-report drawer — picking mode", () => {
  it("hides the drawer and raises the overlay without unmounting the form", async () => {
    mountPage();
    render(<BugReportDrawer />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "typed words" } });
    await openPicker();

    const aside = drawerAside();
    await waitFor(() => expect(aside.dataset.picking).toBe("true"));
    await waitFor(() => expect(aside.style.opacity).toBe("0"));
    expect(aside.style.pointerEvents).toBe("none");
    // The form is still mounted with the operator's text intact.
    expect(screen.getByRole("textbox")).toHaveValue("typed words");
  });

  it("suspends outside-click dismiss and Escape while picking", async () => {
    mountPage();
    render(<BugReportDrawer />);
    await openPicker();

    fireEvent.mouseDown(document.body);
    expect(useEdgeTabStore.getState().activeTab).toBe("bug-report");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(useEdgeTabStore.getState().activeTab).toBe("bug-report");
  });
});

describe("bug-report drawer — element chips", () => {
  it("adds a chip with a thumbnail, leaves picking mode and returns focus", async () => {
    const targets = mountPage();
    render(<BugReportDrawer />);

    await pick(targets.save);

    await waitFor(() => expect(screen.getByText("ELEMENT :: Save")).toBeInTheDocument());
    await waitFor(() => expect(drawerAside().dataset.picking).toBeUndefined());

    const thumb = document.querySelector<HTMLImageElement>("[data-element-chip-thumb]");
    expect(thumb).not.toBeNull();
    expect(thumb!.getAttribute("src")).toMatch(/^blob:thumb-/);

    await waitFor(() => expect(document.activeElement).toBe(selectAction()));
  });

  it("caps at three references and re-enables after a removal", async () => {
    const targets = mountPage();
    render(<BugReportDrawer />);

    await pick(targets.save);
    await waitFor(() => expect(screen.getByText("ELEMENT :: Save")).toBeInTheDocument());
    await pick(targets.send);
    await waitFor(() => expect(screen.getByText("ELEMENT :: Send")).toBeInTheDocument());
    await pick(targets.print);
    await waitFor(() => expect(screen.getByText("ELEMENT :: Print")).toBeInTheDocument());

    const maxed = screen.getByRole("button", { name: en["bugReport.picker.max"] });
    expect(maxed).toBeDisabled();

    const removes = screen.getAllByRole("button", {
      name: en["bugReport.picker.remove"],
    });
    expect(removes).toHaveLength(3);
    fireEvent.click(removes[0]);

    await waitFor(() => expect(screen.queryByText("ELEMENT :: Save")).toBeNull());
    expect(selectAction()).not.toBeDisabled();
  });

  it("drops every reference when the drawer closes", async () => {
    const targets = mountPage();
    render(<BugReportDrawer />);

    await pick(targets.save);
    await waitFor(() => expect(screen.getByText("ELEMENT :: Save")).toBeInTheDocument());

    act(() => {
      useEdgeTabStore.setState({ activeTab: null });
    });
    await waitFor(() => expect(screen.queryByText("ELEMENT :: Save")).toBeNull());

    act(() => {
      useEdgeTabStore.setState({ activeTab: "bug-report" });
    });
    await waitFor(() => expect(selectAction()).toBeInTheDocument());
    expect(screen.queryByText("ELEMENT :: Save")).toBeNull();
  });
});

describe("bug-report drawer — submission", () => {
  async function submitWith(targets: Record<string, HTMLElement>, ids: string[]) {
    for (const id of ids) {
      await pick(targets[id]);
      await waitFor(() =>
        expect(
          screen.getByText(
            `ELEMENT :: ${targets[id].textContent?.trim()}`
          )
        ).toBeInTheDocument()
      );
    }
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "The save button is misaligned" },
    });
    fireEvent.click(screen.getByRole("button", { name: en["bugReport.submit"] }));
    await waitFor(() => expect(createReport).toHaveBeenCalledTimes(1));
  }

  it("sends the references in custom_metadata with sequential attachment indices", async () => {
    const targets = mountPage();
    render(<BugReportDrawer />);
    await submitWith(targets, ["save", "send"]);

    const input = createReport.mock.calls[0][0] as {
      customMetadata: Record<string, unknown>;
    };
    const refs = input.customMetadata.elementReferences as Array<{
      label: string;
      attachmentIndex: number | null;
    }>;

    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.label)).toEqual(["Save", "Send"]);
    expect(refs.map((r) => r.attachmentIndex)).toEqual([0, 1]);

    // Existing metadata keys are untouched.
    for (const key of [
      "submittedFrom",
      "userAgent",
      "referrer",
      "language",
      "timezone",
      "online",
      "devicePixelRatio",
      "screenWidth",
      "screenHeight",
      "userTitle",
      "userSeverity",
    ]) {
      expect(input.customMetadata).toHaveProperty(key);
    }
  });

  it("gives a reference with no crop a null index and does not consume a slot", async () => {
    // Every crop capture fails → no blobs, so no reference claims an index.
    domToBlob.mockRejectedValue(new Error("capture unavailable"));

    const targets = mountPage();
    render(<BugReportDrawer />);
    await submitWith(targets, ["save"]);

    const input = createReport.mock.calls[0][0] as {
      customMetadata: Record<string, unknown>;
    };
    const refs = input.customMetadata.elementReferences as Array<{
      attachmentIndex: number | null;
    }>;
    expect(refs).toHaveLength(1);
    expect(refs[0].attachmentIndex).toBeNull();

    const elementUploads = fetchMock.mock.calls.filter(([, init]) =>
      (init as { body: FormData }).body.get("kind") === "element"
    );
    expect(elementUploads).toHaveLength(0);
  });

  it("uploads each crop in index order with kind=element", async () => {
    const targets = mountPage();
    render(<BugReportDrawer />);
    await submitWith(targets, ["save", "send"]);

    await waitFor(() => {
      const uploads = fetchMock.mock.calls.filter(([, init]) =>
        (init as { body: FormData }).body.get("kind") === "element"
      );
      expect(uploads).toHaveLength(2);
    });

    const uploads = fetchMock.mock.calls.filter(([, init]) =>
      (init as { body: FormData }).body.get("kind") === "element"
    );
    uploads.forEach(([url, init], i) => {
      expect(url).toBe("/api/bug-reports/screenshot");
      const body = (init as { body: FormData }).body;
      expect(body.get("reportId")).toBe("report-row-id");
      expect(body.get("companyId")).toBe(COMPANY_ID);
      expect(body.get("index")).toBe(String(i));
      expect(body.get("file")).toBeInstanceOf(Blob);
    });
  });

  it("logs a rejected crop upload and still reports success", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockImplementation(async (_url: unknown, init: unknown) => {
      const body = (init as { body: FormData }).body;
      if (body.get("kind") === "element") {
        return { ok: false, status: 500, json: async () => ({ error: "boom" }) };
      }
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    });

    const targets = mountPage();
    render(<BugReportDrawer />);
    await submitWith(targets, ["save"]);

    await waitFor(() =>
      expect(screen.getByText(en["bugReport.submitted"])).toBeInTheDocument()
    );
    expect(
      warn.mock.calls.some((c) =>
        String(c[0]).includes("element crop upload failed")
      )
    ).toBe(true);
  });
});
