import { describe, it, expect, beforeEach } from "vitest";
import { useEdgeTabStore } from "@/stores/edge-tab-store";

describe("useEdgeTabStore", () => {
  beforeEach(() => {
    useEdgeTabStore.setState({ activeTab: null });
  });

  it("starts with no active tab", () => {
    expect(useEdgeTabStore.getState().activeTab).toBeNull();
  });

  it("setActive sets the active tab", () => {
    useEdgeTabStore.getState().setActive("notifications");
    expect(useEdgeTabStore.getState().activeTab).toBe("notifications");
  });

  it("setActive replaces the active tab (mutual exclusion)", () => {
    useEdgeTabStore.getState().setActive("notifications");
    useEdgeTabStore.getState().setActive("fab");
    expect(useEdgeTabStore.getState().activeTab).toBe("fab");
  });

  it("toggle opens a closed tab", () => {
    useEdgeTabStore.getState().toggle("notifications");
    expect(useEdgeTabStore.getState().activeTab).toBe("notifications");
  });

  it("toggle closes the tab when it is already active", () => {
    useEdgeTabStore.setState({ activeTab: "notifications" });
    useEdgeTabStore.getState().toggle("notifications");
    expect(useEdgeTabStore.getState().activeTab).toBeNull();
  });

  it("toggle switches between tabs", () => {
    useEdgeTabStore.setState({ activeTab: "fab" });
    useEdgeTabStore.getState().toggle("notifications");
    expect(useEdgeTabStore.getState().activeTab).toBe("notifications");
  });

  it("close clears the active tab if it matches", () => {
    useEdgeTabStore.setState({ activeTab: "notifications" });
    useEdgeTabStore.getState().close("notifications");
    expect(useEdgeTabStore.getState().activeTab).toBeNull();
  });

  it("close is a no-op if the tab isn't active", () => {
    useEdgeTabStore.setState({ activeTab: "fab" });
    useEdgeTabStore.getState().close("notifications");
    expect(useEdgeTabStore.getState().activeTab).toBe("fab");
  });

  it("closeAll clears any active tab", () => {
    useEdgeTabStore.setState({ activeTab: "notifications" });
    useEdgeTabStore.getState().closeAll();
    expect(useEdgeTabStore.getState().activeTab).toBeNull();
  });
});
