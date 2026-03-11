"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils/cn";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { ContentHeader } from "./content-header";
import { CommandPalette } from "@/components/ops/command-palette";
import { KeyboardShortcuts } from "@/components/ops/keyboard-shortcuts";
import { FloatingWindow } from "@/components/ops/floating-window";
import { PreferencesApplier } from "@/components/ops/preferences-applier";
import { WindowDock } from "@/components/ops/window-dock";
import { FloatingActionButton } from "@/components/ops/floating-action-button";
import { ActionPromptRenderer } from "@/components/ops/action-prompt-renderer";
import { NotificationModal } from "@/components/layouts/notification-modal";
import { useActionPrompts } from "@/hooks/useActionPrompts";
import { useWindowStore } from "@/stores/window-store";
import { CreateProjectForm } from "@/components/ops/create-project-modal";
import { CreateClientForm } from "@/components/ops/create-client-modal";
import { CreateTaskForm } from "@/components/ops/create-task-modal";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useGmailSyncNotifications } from "@/lib/hooks/use-gmail-sync-notifications";
import { UnassignedRoleBanner } from "@/components/ops/unassigned-role-banner";
import { useSetupGate } from "@/hooks/useSetupGate";
import { useRouter, usePathname } from "next/navigation";

// Leaflet map background + filter rail — client-only (no SSR)
const DashboardMapBackground = dynamic(
  () =>
    import("@/components/dashboard/map/dashboard-map-background").then(
      (m) => m.DashboardMapBackground
    ),
  { ssr: false }
);
const MapFilterRail = dynamic(
  () =>
    import("@/components/dashboard/map/map-filter-rail").then(
      (m) => m.MapFilterRail
    ),
  { ssr: false }
);

function ActionPromptsInitializer() {
  useActionPrompts();
  return null;
}

function GmailSyncNotifier() {
  useGmailSyncNotifications();
  return null;
}

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
          {win.type === "create-task" && (
            <CreateTaskForm
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
  const { needsEmployeeOnboarding } = useSetupGate();
  const router = useRouter();
  const pathname = usePathname();

  // Redirect to employee onboarding if incomplete
  useEffect(() => {
    if (needsEmployeeOnboarding) {
      router.push("/employee-setup");
    }
  }, [needsEmployeeOnboarding, router]);

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
        <UnassignedRoleBanner />
        <div className={cn(
          "flex-1 overflow-y-auto overflow-x-auto p-3 relative z-[1]",
          pathname === "/dashboard" && "pointer-events-none"
        )}>
          {children}
        </div>
      </main>

      {/* Map background layer (dashboard route only, z-0 behind content) */}
      <DashboardMapBackground />
      <MapFilterRail />

      {/* Global features */}
      <PreferencesApplier />
      <ActionPromptsInitializer />
      <GmailSyncNotifier />
      <ActionPromptRenderer />
      <CommandPalette />
      <KeyboardShortcuts />
      <FloatingWindows />
      <FloatingActionButton />
      <NotificationModal />
      <WindowDock />
    </div>
  );
}
