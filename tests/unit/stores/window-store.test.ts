import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  useWindowStore,
  consumeProjectCreatedCallback,
} from "@/stores/window-store";

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

  describe("onProjectCreated callback (Phase 10.1-fix)", () => {
    // Callback registry lets the in-task-modal "Create new project"
    // affordance auto-select the new project once the workspace finishes
    // its create. Stored module-side (not in Zustand) so persist() can't
    // drop it; consumed once by the container's handleSaved path.

    it("registers and consumes a callback for a creating-mode window", () => {
      const onProjectCreated = vi.fn();
      useWindowStore.getState().openProjectWindow({
        projectId: null,
        mode: "creating",
        onProjectCreated,
      });
      const id = useWindowStore.getState().windows[0].id;

      consumeProjectCreatedCallback(id, "p_new_42");

      expect(onProjectCreated).toHaveBeenCalledTimes(1);
      expect(onProjectCreated).toHaveBeenCalledWith("p_new_42");
    });

    it("is idempotent — second consume is a no-op", () => {
      const onProjectCreated = vi.fn();
      useWindowStore.getState().openProjectWindow({
        projectId: null,
        mode: "creating",
        onProjectCreated,
      });
      const id = useWindowStore.getState().windows[0].id;

      consumeProjectCreatedCallback(id, "p_new_42");
      // Second call must not throw and must not re-fire the callback.
      expect(() => consumeProjectCreatedCallback(id, "p_new_42")).not.toThrow();
      expect(onProjectCreated).toHaveBeenCalledTimes(1);
    });

    it("closeWindow clears any pending callback (no leak)", () => {
      const onProjectCreated = vi.fn();
      useWindowStore.getState().openProjectWindow({
        projectId: null,
        mode: "creating",
        onProjectCreated,
      });
      const id = useWindowStore.getState().windows[0].id;

      // User dismisses the workspace before saving.
      useWindowStore.getState().closeWindow(id);
      // Now the create completes (theoretically) — callback must NOT fire.
      consumeProjectCreatedCallback(id, "p_new_42");
      expect(onProjectCreated).not.toHaveBeenCalled();
    });

    it("does not register a callback when none is supplied (deep-link path)", () => {
      // Deep-link / FAB / spreadsheet open paths don't pass a callback.
      // Nothing to consume — call must be a no-op, never throw.
      useWindowStore.getState().openProjectWindow({
        projectId: "p_77",
        mode: "viewing",
      });
      const id = useWindowStore.getState().windows[0].id;
      expect(() => consumeProjectCreatedCallback(id, "p_77")).not.toThrow();
    });
  });

  describe("updateWindowMeta", () => {
    // After a successful create, the workspace container needs to swap the
    // window's meta from { projectId: null, initialMode: "creating" } to
    // { projectId: <newId>, initialMode: "viewing" } so subsequent re-opens
    // (FAB, deep-link, dock-restore) hit the correct window. Phase 9.3.

    it("merges a partial meta patch into the target window", () => {
      useWindowStore.getState().openProjectWindow({ mode: "creating" });
      const id = useWindowStore.getState().windows[0].id;

      useWindowStore.getState().updateWindowMeta(id, {
        projectId: "p_new",
        initialMode: "viewing",
      });

      const win = useWindowStore.getState().windows[0];
      expect(win.meta).toEqual({
        projectId: "p_new",
        initialMode: "viewing",
      });
    });

    it("is a no-op when the target window does not exist", () => {
      const before = useWindowStore.getState().windows;
      useWindowStore.getState().updateWindowMeta("nonexistent-window", {
        projectId: "p_x",
        initialMode: "viewing",
      });
      expect(useWindowStore.getState().windows).toBe(before);
    });
  });
});
