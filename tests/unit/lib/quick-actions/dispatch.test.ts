import { describe, it, expect, vi } from "vitest";
import {
  dispatchQuickAction,
  type QuickActionDispatchDeps,
} from "@/lib/quick-actions/dispatch";
import type { FABAction } from "@/lib/constants/fab-actions";

function makeDeps() {
  const deps = {
    router: { push: vi.fn() },
    openWindow: vi.fn(),
    openProjectWindow: vi.fn(),
    openClientWindow: vi.fn(),
    t: (k: string) => k,
  };
  return deps as QuickActionDispatchDeps & typeof deps;
}

const base = {
  hintCode: "X",
  icon: (() => null) as unknown as FABAction["icon"],
  triggerAction: "x",
} as const;

describe("dispatchQuickAction", () => {
  it("routes a generic window action through openWindow with the resolved title", () => {
    const deps = makeDeps();
    dispatchQuickAction(
      {
        ...base,
        id: "task",
        labelKey: "action.task",
        handler: "window",
        target: "create-task",
      } as FABAction,
      deps,
    );
    expect(deps.openWindow).toHaveBeenCalledWith({
      id: "create-task",
      title: "action.task",
      type: "create-task",
    });
    expect(deps.openProjectWindow).not.toHaveBeenCalled();
    expect(deps.router.push).not.toHaveBeenCalled();
  });

  it("routes project-workspace through openProjectWindow in the meta mode", () => {
    const deps = makeDeps();
    dispatchQuickAction(
      {
        ...base,
        id: "project",
        labelKey: "action.project",
        handler: "window",
        target: "project-workspace",
        meta: { initialMode: "creating" },
      } as FABAction,
      deps,
    );
    expect(deps.openProjectWindow).toHaveBeenCalledWith({
      projectId: null,
      mode: "creating",
    });
  });

  it("routes client-workspace through openClientWindow", () => {
    const deps = makeDeps();
    dispatchQuickAction(
      {
        ...base,
        id: "client",
        labelKey: "action.client",
        handler: "window",
        target: "client-workspace",
        meta: { initialMode: "creating" },
      } as FABAction,
      deps,
    );
    expect(deps.openClientWindow).toHaveBeenCalledWith({
      clientId: null,
      mode: "creating",
    });
  });

  it("routes a route action through router.push", () => {
    const deps = makeDeps();
    dispatchQuickAction(
      {
        ...base,
        id: "expense",
        labelKey: "action.expense",
        handler: "route",
        target: "/books?segment=expenses",
      } as FABAction,
      deps,
    );
    expect(deps.router.push).toHaveBeenCalledWith("/books?segment=expenses");
    expect(deps.openWindow).not.toHaveBeenCalled();
  });

  it("defaults workspace mode to creating when meta is absent", () => {
    const deps = makeDeps();
    dispatchQuickAction(
      {
        ...base,
        id: "project",
        labelKey: "action.project",
        handler: "window",
        target: "project-workspace",
      } as FABAction,
      deps,
    );
    expect(deps.openProjectWindow).toHaveBeenCalledWith({
      projectId: null,
      mode: "creating",
    });
  });
});
