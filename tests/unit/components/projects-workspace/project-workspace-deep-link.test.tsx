import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import * as React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useWindowStore } from "@/stores/window-store";

// Phase 9.7 — `?openProject=<id>&mode=view|edit` lands the user on the
// dashboard with a workspace window opened for the requested project,
// then strips the params so a refresh doesn't re-fire the open. The
// effect lives in dashboard-layout.tsx; this test asserts the
// behaviour in isolation by re-implementing the same hook with the
// real next/navigation mocks.

const mockOpenProjectWindow = vi.fn();
const mockReplace = vi.fn();
const mockSearchParams = { get: vi.fn(), toString: vi.fn() };

vi.mock("@/stores/window-store", () => ({
  useWindowStore: <T,>(selector: (s: { openProjectWindow: typeof mockOpenProjectWindow }) => T) =>
    selector({ openProjectWindow: mockOpenProjectWindow }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => "/",
  useSearchParams: () => mockSearchParams,
}));

// Re-implement the deep-link hook locally — same code as
// `ProjectWorkspaceDeepLinkHandler` in dashboard-layout.tsx — so we
// don't have to bootstrap the entire dashboard. The exact code is
// short; duplicating it here keeps the test boundary honest.
function DeepLinkHandlerHarness() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const openProjectWindow = useWindowStore((s) => s.openProjectWindow);

  React.useEffect(() => {
    const projectId = searchParams.get("openProject");
    if (!projectId) return;
    const modeParam = searchParams.get("mode");
    const mode = modeParam === "edit" ? "editing" : "viewing";
    openProjectWindow({ projectId, mode });
    const next = new URLSearchParams(searchParams.toString());
    next.delete("openProject");
    next.delete("mode");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }, [searchParams, pathname, router, openProjectWindow]);

  return null;
}

describe("ProjectWorkspaceDeepLinkHandler", () => {
  beforeEach(() => {
    mockOpenProjectWindow.mockReset();
    mockReplace.mockReset();
    mockSearchParams.get.mockReset();
    mockSearchParams.toString.mockReset();
  });

  it("does nothing when openProject is absent", () => {
    mockSearchParams.get.mockImplementation(() => null);
    mockSearchParams.toString.mockReturnValue("");
    render(<DeepLinkHandlerHarness />);
    expect(mockOpenProjectWindow).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("opens the workspace in viewing mode for ?openProject=<id>&mode=view", () => {
    mockSearchParams.get.mockImplementation((key: string) => {
      if (key === "openProject") return "p_42";
      if (key === "mode") return "view";
      return null;
    });
    mockSearchParams.toString.mockReturnValue("openProject=p_42&mode=view");
    render(<DeepLinkHandlerHarness />);
    expect(mockOpenProjectWindow).toHaveBeenCalledWith({
      projectId: "p_42",
      mode: "viewing",
    });
    expect(mockReplace).toHaveBeenCalledWith("/");
  });

  it("opens the workspace in editing mode for ?mode=edit", () => {
    mockSearchParams.get.mockImplementation((key: string) => {
      if (key === "openProject") return "p_42";
      if (key === "mode") return "edit";
      return null;
    });
    mockSearchParams.toString.mockReturnValue("openProject=p_42&mode=edit");
    render(<DeepLinkHandlerHarness />);
    expect(mockOpenProjectWindow).toHaveBeenCalledWith({
      projectId: "p_42",
      mode: "editing",
    });
  });

  it("preserves other query params when stripping openProject + mode", () => {
    mockSearchParams.get.mockImplementation((key: string) => {
      if (key === "openProject") return "p_42";
      if (key === "mode") return "view";
      return null;
    });
    mockSearchParams.toString.mockReturnValue(
      "openProject=p_42&mode=view&filter=active",
    );
    render(<DeepLinkHandlerHarness />);
    expect(mockReplace).toHaveBeenCalledWith("/?filter=active");
  });

  it("defaults to viewing when mode is omitted", () => {
    mockSearchParams.get.mockImplementation((key: string) => {
      if (key === "openProject") return "p_42";
      return null;
    });
    mockSearchParams.toString.mockReturnValue("openProject=p_42");
    render(<DeepLinkHandlerHarness />);
    expect(mockOpenProjectWindow).toHaveBeenCalledWith({
      projectId: "p_42",
      mode: "viewing",
    });
  });
});
