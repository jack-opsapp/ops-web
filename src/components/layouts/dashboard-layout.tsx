"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils/cn";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { CommandPalette } from "@/components/ops/command-palette";
import { KeyboardShortcuts } from "@/components/ops/keyboard-shortcuts";
import { useSidebarStore } from "@/stores/sidebar-store";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isCollapsed, toggle, setCollapsed } = useSidebarStore();

  // Keyboard shortcut: Cmd+B to toggle sidebar
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        toggle();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggle]);

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
        <div className="flex-1 overflow-y-auto p-3">
          {children}
        </div>
      </main>

      {/* Global features */}
      <CommandPalette />
      <KeyboardShortcuts />
    </div>
  );
}
