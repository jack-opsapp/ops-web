import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

import { ProjectWorkspaceWindow } from "@/components/ops/projects/workspace/shell/project-workspace-window";
import { useWindowStore } from "@/stores/window-store";

// `ProjectWorkspaceWindow` — composes WindowTitleBar, optional
// ModalTabs, body content, optional right rail, ModeFooter, and the 8
// ResizeHandles. Manages live position+size in local state (initialised
// from the store + localStorage), forwards mutations through the drag
// + resize hooks, and persists via useWindowPersistence. Click anywhere
// inside the window calls focusWindow(id) to bump z-index.
//
// Vitest jsdom mock for matchMedia is already set up in tests/setup.ts.

vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>("framer-motion");
  return {
    ...actual,
    useReducedMotion: vi.fn(() => false),
  };
});

import { useReducedMotion } from "framer-motion";

const BASE_PROPS = {
  id: "project-workspace:p_42",
  title: "Acme HQ Roof Replacement",
  subtitle: "1234 Industry Way · Stockton CA",
  crumbLabel: "PROJECT",
  projectIdLabel: "JX-4821",
  statusLabel: "ACCEPTED",
  statusTone: "olive" as const,
  mode: "viewing" as const,
  position: { x: 200, y: 100 },
  size: { width: 1080, height: 760 },
  zIndex: 2000,
  footerConfig: {
    secondary: [],
    primary: { label: "EDIT", onClick: () => {} },
  },
};

describe("<ProjectWorkspaceWindow>", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useWindowStore.setState({ windows: [], nextZIndex: 2000 });
    // Add the workspace window to the store so focusWindow + closeWindow
    // can resolve it.
    useWindowStore.setState((s) => ({
      windows: [
        ...s.windows,
        {
          id: BASE_PROPS.id,
          title: BASE_PROPS.title,
          type: "project-workspace",
          isMinimized: false,
          position: BASE_PROPS.position,
          size: BASE_PROPS.size,
          zIndex: BASE_PROPS.zIndex,
          meta: { projectId: "p_42", initialMode: "viewing" },
        },
      ],
    }));
  });

  it("renders the title bar, body content, and footer", () => {
    render(
      <ProjectWorkspaceWindow {...BASE_PROPS}>
        <div data-testid="body">BODY</div>
      </ProjectWorkspaceWindow>,
    );
    expect(screen.getByText("Acme HQ Roof Replacement")).toBeInTheDocument();
    expect(screen.getByTestId("body")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "EDIT" })).toBeInTheDocument();
  });

  it("applies the dense glass surface and modal radius", () => {
    render(
      <ProjectWorkspaceWindow {...BASE_PROPS}>
        <div />
      </ProjectWorkspaceWindow>,
    );
    const win = screen.getByTestId("project-workspace-window");
    expect(win).toHaveClass("glass-dense");
    expect(win).toHaveClass("rounded-modal");
  });

  it("applies the position + size + zIndex from props", () => {
    render(
      <ProjectWorkspaceWindow {...BASE_PROPS}>
        <div />
      </ProjectWorkspaceWindow>,
    );
    const win = screen.getByTestId("project-workspace-window") as HTMLElement;
    expect(win.style.left).toBe("200px");
    expect(win.style.top).toBe("100px");
    expect(win.style.width).toBe("1080px");
    expect(win.style.height).toBe("760px");
    expect(win.style.zIndex).toBe("2000");
  });

  it("clicking the close traffic-light removes the window from the store", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    render(
      <ProjectWorkspaceWindow {...BASE_PROPS}>
        <div />
      </ProjectWorkspaceWindow>,
    );
    expect(useWindowStore.getState().windows).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(useWindowStore.getState().windows).toHaveLength(0);
  });

  it("clicking the minimize traffic-light marks the window minimized", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    render(
      <ProjectWorkspaceWindow {...BASE_PROPS}>
        <div />
      </ProjectWorkspaceWindow>,
    );
    await userEvent.click(screen.getByRole("button", { name: /minimize/i }));
    expect(useWindowStore.getState().windows[0].isMinimized).toBe(true);
  });

  it("pointer-down anywhere inside the window calls focusWindow (z-index bump)", () => {
    render(
      <ProjectWorkspaceWindow {...BASE_PROPS}>
        <div data-testid="body">BODY</div>
      </ProjectWorkspaceWindow>,
    );
    const startZ = useWindowStore.getState().nextZIndex;
    fireEvent.pointerDown(screen.getByTestId("body"));
    expect(useWindowStore.getState().nextZIndex).toBe(startZ + 1);
  });

  it("renders all 8 resize handles", () => {
    render(
      <ProjectWorkspaceWindow {...BASE_PROPS}>
        <div />
      </ProjectWorkspaceWindow>,
    );
    for (const dir of ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const) {
      expect(screen.getByTestId(`resize-handle-${dir}`)).toBeInTheDocument();
    }
  });

  it("renders ModalTabs when tabs prop is provided and active body when activeTabId set", () => {
    const tabs = [
      { id: "activity", label: "Activity" },
      { id: "details", label: "Details" },
    ] as const;
    render(
      <ProjectWorkspaceWindow
        {...BASE_PROPS}
        tabs={tabs}
        activeTabId="activity"
        onTabChange={() => {}}
      >
        <div data-testid="body">BODY</div>
      </ProjectWorkspaceWindow>,
    );
    expect(screen.getByRole("tab", { name: /activity/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /details/i })).toBeInTheDocument();
  });

  it("omits ModalTabs when tabs prop is missing", () => {
    render(
      <ProjectWorkspaceWindow {...BASE_PROPS}>
        <div />
      </ProjectWorkspaceWindow>,
    );
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("hydrates from localStorage on mount when a snapshot exists", () => {
    window.localStorage.setItem(
      `opsWin:${BASE_PROPS.id}`,
      JSON.stringify({ position: { x: 50, y: 30 }, size: { width: 900, height: 700 } }),
    );
    render(
      <ProjectWorkspaceWindow {...BASE_PROPS}>
        <div />
      </ProjectWorkspaceWindow>,
    );
    const win = screen.getByTestId("project-workspace-window") as HTMLElement;
    expect(win.style.left).toBe("50px");
    expect(win.style.top).toBe("30px");
    expect(win.style.width).toBe("900px");
    expect(win.style.height).toBe("700px");
  });

  // Dispatch a fully-formed DOM event with clientX/Y on the target. We
  // can't trust @testing-library/react's `fireEvent.pointerDown` to
  // forward clientX/Y through React 19's synthetic event in jsdom 25
  // — the shape varies and we've seen NaN propagate through the
  // resize math when the values weren't picked up. Vanilla DOM
  // dispatch is what the hook tests use too.
  function fireRealPointer(
    type: "pointerdown" | "pointermove" | "pointerup",
    target: EventTarget,
    clientX: number,
    clientY: number,
  ) {
    const ev = new MouseEvent(type, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "clientX", { value: clientX });
    Object.defineProperty(ev, "clientY", { value: clientY });
    target.dispatchEvent(ev);
  }

  it("resizing via south handle grows height and updates the live style", () => {
    render(
      <ProjectWorkspaceWindow {...BASE_PROPS}>
        <div />
      </ProjectWorkspaceWindow>,
    );
    const handle = screen.getByTestId("resize-handle-s");
    act(() => fireRealPointer("pointerdown", handle, 600, 850));
    act(() => fireRealPointer("pointermove", window, 600, 950));
    const win = screen.getByTestId("project-workspace-window") as HTMLElement;
    expect(win.style.height).toBe("860px");
    act(() => fireRealPointer("pointerup", window, 600, 950));
  });

  it("respects the workspace min size (780x600) on extreme shrink", () => {
    render(
      <ProjectWorkspaceWindow {...BASE_PROPS}>
        <div />
      </ProjectWorkspaceWindow>,
    );
    const handle = screen.getByTestId("resize-handle-e");
    act(() => fireRealPointer("pointerdown", handle, 1280, 400));
    act(() => fireRealPointer("pointermove", window, 100, 400));
    const win = screen.getByTestId("project-workspace-window") as HTMLElement;
    expect(parseInt(win.style.width, 10)).toBeGreaterThanOrEqual(780);
    act(() => fireRealPointer("pointerup", window, 100, 400));
  });

  it("calls onTabChange when a non-active tab is clicked", async () => {
    const onTabChange = vi.fn();
    const tabs = [
      { id: "activity", label: "Activity" },
      { id: "details", label: "Details" },
    ] as const;
    const { default: userEvent } = await import("@testing-library/user-event");
    render(
      <ProjectWorkspaceWindow
        {...BASE_PROPS}
        tabs={tabs}
        activeTabId="activity"
        onTabChange={onTabChange}
      >
        <div />
      </ProjectWorkspaceWindow>,
    );
    await userEvent.click(screen.getByRole("tab", { name: /details/i }));
    expect(onTabChange).toHaveBeenCalledWith("details");
  });

  it("renders the optional rightRail slot", () => {
    render(
      <ProjectWorkspaceWindow
        {...BASE_PROPS}
        rightRail={<aside data-testid="rail">RAIL</aside>}
      >
        <div data-testid="body">BODY</div>
      </ProjectWorkspaceWindow>,
    );
    expect(screen.getByTestId("rail")).toBeInTheDocument();
    expect(screen.getByTestId("body")).toBeInTheDocument();
  });

  // Phase 12.3 — mode transition cross-fade.
  //
  // The body slot is keyed on `mode` so AnimatePresence with mode="wait"
  // unmounts the outgoing body before the incoming body mounts. We can't
  // easily assert the 200ms fade timing in jsdom, so we assert the keying
  // contract: the wrapper carries `data-mode={mode}` and the new body is
  // present with the new mode after a re-render.
  describe("mode transition cross-fade (Phase 12.3)", () => {
    it("body slot wrapper exposes data-mode for the active mode (initial)", () => {
      render(
        <ProjectWorkspaceWindow {...BASE_PROPS} mode="viewing">
          <div data-testid="body-viewing">VIEW</div>
        </ProjectWorkspaceWindow>,
      );
      expect(screen.getByTestId("workspace-body-slot")).toHaveAttribute(
        "data-mode",
        "viewing",
      );
    });

    it("body slot wrapper updates data-mode on mode swap (after exit settles)", async () => {
      const { rerender } = render(
        <ProjectWorkspaceWindow {...BASE_PROPS} mode="viewing">
          <div data-testid="body-viewing">VIEW</div>
        </ProjectWorkspaceWindow>,
      );
      rerender(
        <ProjectWorkspaceWindow {...BASE_PROPS} mode="editing">
          <div data-testid="body-editing">EDIT</div>
        </ProjectWorkspaceWindow>,
      );
      // AnimatePresence mode="wait" runs the outgoing exit before the
      // new wrapper mounts; waitFor lets the async exit settle in jsdom.
      await waitFor(() => {
        const slots = screen.getAllByTestId("workspace-body-slot");
        const editing = slots.find(
          (n) => n.getAttribute("data-mode") === "editing",
        );
        expect(editing).toBeDefined();
      });
    });

    it("ModalTabs wrapper mounts only when tabs are provided", () => {
      const { rerender } = render(
        <ProjectWorkspaceWindow {...BASE_PROPS} mode="viewing">
          <div />
        </ProjectWorkspaceWindow>,
      );
      expect(
        screen.queryByTestId("modal-tabs-wrapper"),
      ).not.toBeInTheDocument();

      const tabs = [
        { id: "identity", label: "Identity" },
        { id: "schedule", label: "Schedule" },
      ] as const;
      rerender(
        <ProjectWorkspaceWindow
          {...BASE_PROPS}
          mode="editing"
          tabs={tabs}
          activeTabId="identity"
          onTabChange={() => {}}
        >
          <div />
        </ProjectWorkspaceWindow>,
      );
      expect(screen.getByTestId("modal-tabs-wrapper")).toBeInTheDocument();
    });

    it("right rail wrapper renders only when rightRail prop is supplied", () => {
      render(
        <ProjectWorkspaceWindow
          {...BASE_PROPS}
          rightRail={<aside data-testid="rail">RAIL</aside>}
        >
          <div />
        </ProjectWorkspaceWindow>,
      );
      expect(
        screen.getByTestId("workspace-right-rail-wrapper"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("rail")).toBeInTheDocument();
    });

    it("right rail wrapper omitted when no rightRail prop", () => {
      render(
        <ProjectWorkspaceWindow {...BASE_PROPS}>
          <div />
        </ProjectWorkspaceWindow>,
      );
      expect(
        screen.queryByTestId("workspace-right-rail-wrapper"),
      ).not.toBeInTheDocument();
    });
  });
});

// ─── Reduced-motion path (Phase 12.3) ───────────────────────────────────────
// Separate describe block with its own framer-motion mock so the path
// where useReducedMotion → true is verified deterministically.
describe("<ProjectWorkspaceWindow> reduced-motion path", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useWindowStore.setState({ windows: [], nextZIndex: 2000 });
    useWindowStore.setState((s) => ({
      windows: [
        ...s.windows,
        {
          id: BASE_PROPS.id,
          title: BASE_PROPS.title,
          type: "project-workspace",
          isMinimized: false,
          position: BASE_PROPS.position,
          size: BASE_PROPS.size,
          zIndex: BASE_PROPS.zIndex,
          meta: { projectId: "p_42", initialMode: "viewing" },
        },
      ],
    }));
  });

  it("with reduced motion the body slot wrapper omits opacity initial frames", () => {
    vi.mocked(useReducedMotion).mockReturnValue(true);
    render(
      <ProjectWorkspaceWindow {...BASE_PROPS} mode="viewing">
        <div data-testid="body-viewing">VIEW</div>
      </ProjectWorkspaceWindow>,
    );
    const slot = screen.getByTestId("workspace-body-slot");
    // Reduced motion → `initial={false}` so framer-motion skips writing
    // the opacity:0 starting style. The element renders at full opacity
    // immediately (no fade-in animation).
    expect(slot.getAttribute("style") ?? "").not.toMatch(/opacity:\s*0/);
    vi.mocked(useReducedMotion).mockReturnValue(false);
  });

  it("with reduced motion the mode swap completes without queued exit animation", async () => {
    vi.mocked(useReducedMotion).mockReturnValue(true);
    const { rerender } = render(
      <ProjectWorkspaceWindow {...BASE_PROPS} mode="viewing">
        <div data-testid="body-viewing">VIEW</div>
      </ProjectWorkspaceWindow>,
    );
    rerender(
      <ProjectWorkspaceWindow {...BASE_PROPS} mode="editing">
        <div data-testid="body-editing">EDIT</div>
      </ProjectWorkspaceWindow>,
    );
    await waitFor(() => {
      const slots = screen.getAllByTestId("workspace-body-slot");
      const editing = slots.find(
        (n) => n.getAttribute("data-mode") === "editing",
      );
      expect(editing).toBeDefined();
    });
    vi.mocked(useReducedMotion).mockReturnValue(false);
  });
});
