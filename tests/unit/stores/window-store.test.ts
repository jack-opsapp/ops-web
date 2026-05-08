import { describe, it, expect, beforeEach } from "vitest";
import { useWindowStore } from "@/stores/window-store";

// Phase 6.1 — useWindowStore extended with the `project-workspace` window
// type and an `openProjectWindow` helper. The helper centralises window-id
// derivation (one window per project, plus a sentinel for create mode) and
// passes initialMode through `meta` so the body composer can route to
// viewing/editing/creating without re-reading the metadata bag.

describe("useWindowStore", () => {
  beforeEach(() => {
    // Reset the store between tests — Zustand persists across the module
    // so leaving state in place would leak into the next test's assertions.
    useWindowStore.setState({ windows: [], nextZIndex: 2000 });
  });

  describe("openProjectWindow", () => {
    it("opens a project-workspace window for an existing project (viewing mode)", () => {
      useWindowStore.getState().openProjectWindow({
        projectId: "p_42",
        mode: "viewing",
      });
      const win = useWindowStore.getState().windows[0];
      expect(win).toBeDefined();
      expect(win.type).toBe("project-workspace");
      expect(win.id).toBe("project-workspace:p_42");
      expect(win.meta).toEqual({ projectId: "p_42", initialMode: "viewing" });
    });

    it("opens a project-workspace window in editing mode", () => {
      useWindowStore.getState().openProjectWindow({
        projectId: "p_42",
        mode: "editing",
      });
      const win = useWindowStore.getState().windows[0];
      expect(win.meta).toEqual({ projectId: "p_42", initialMode: "editing" });
    });

    it("opens a creating-mode workspace with a null projectId (create-new sentinel)", () => {
      useWindowStore.getState().openProjectWindow({ mode: "creating" });
      const win = useWindowStore.getState().windows[0];
      expect(win.id).toBe("project-workspace:new");
      expect(win.meta).toEqual({ projectId: null, initialMode: "creating" });
    });

    it("defaults mode to 'viewing' when projectId is provided and mode omitted", () => {
      useWindowStore.getState().openProjectWindow({ projectId: "p_99" });
      const win = useWindowStore.getState().windows[0];
      expect(win.meta?.initialMode).toBe("viewing");
    });

    it("defaults mode to 'creating' when no projectId is provided and mode omitted", () => {
      useWindowStore.getState().openProjectWindow({});
      const win = useWindowStore.getState().windows[0];
      expect(win.meta?.initialMode).toBe("creating");
    });

    it("uses 1080x760 default size for project-workspace windows", () => {
      useWindowStore.getState().openProjectWindow({ projectId: "p_42" });
      const win = useWindowStore.getState().windows[0];
      expect(win.size).toEqual({ width: 1080, height: 760 });
    });

    it("focuses the existing window if one is already open for the same project", () => {
      const { openProjectWindow } = useWindowStore.getState();
      openProjectWindow({ projectId: "p_42" });
      const firstZ = useWindowStore.getState().windows[0].zIndex;
      openProjectWindow({ projectId: "p_42", mode: "editing" });
      const wins = useWindowStore.getState().windows;
      // Still only one window for that project — same id wins.
      expect(wins.length).toBe(1);
      expect(wins[0].zIndex).toBeGreaterThan(firstZ);
      // And meta updates to the new mode so the body composer re-routes.
      expect(wins[0].meta?.initialMode).toBe("editing");
    });

    it("type is part of the WindowType union (compiles)", () => {
      // Compile-time assertion that the union accepts 'project-workspace'.
      const t: import("@/stores/window-store").FloatingWindowType = "project-workspace";
      expect(t).toBe("project-workspace");
    });
  });
});
