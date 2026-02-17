"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils/cn";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { ContentHeader } from "./content-header";
import { CommandPalette } from "@/components/ops/command-palette";
import { KeyboardShortcuts } from "@/components/ops/keyboard-shortcuts";
import { FloatingWindow } from "@/components/ops/floating-window";
import { WindowDock } from "@/components/ops/window-dock";
import { useWindowStore } from "@/stores/window-store";
import { CreateProjectForm } from "@/components/ops/create-project-modal";
import { CreateClientForm } from "@/components/ops/create-client-modal";
import { useSidebarStore } from "@/stores/sidebar-store";

function FloatingWindows() {
  const windows = useWindowStore((s) => s.windows);
  const closeWindow = useWindowStore((s) => s.closeWindow);

  return (
    <>
      {windows.map((win) => (
        <FloatingWindow key={win.id} window={win}>
          {win.type === "create-project" && (
            <CreateProjectForm
              onSuccess={() => closeWindow(win.id)}
              onCancel={() => closeWindow(win.id)}
            />
          )}
          {win.type === "create-client" && (
            <CreateClientForm
              onSuccess={() => closeWindow(win.id)}
              onCancel={() => closeWindow(win.id)}
            />
          )}
        </FloatingWindow>
      ))}
    </>
  );
}

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isCollapsed, setCollapsed } = useSidebarStore();

  // Auto-collapse on small screens
  useEffect(() => {
    function handleResize() {
      if (window.innerWidth < 1024) {
        setCollapsed(true);
      }
    }
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [setCollapsed]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <main
        className={cn(
          "flex-1 flex flex-col min-h-screen transition-all duration-200 ease-out",
          isCollapsed ? "ml-[72px]" : "ml-[256px]"
        )}
      >
        <TopBar />
        <ContentHeader />
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-3">
          {children}
        </div>
      </main>

      {/* Global features */}
      <CommandPalette />
      <KeyboardShortcuts />
      <FloatingWindows />
      <WindowDock />
    </div>
  );
}
