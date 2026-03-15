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
import { BugReportButton } from "@/components/ops/bug-report-button";
import { ActionPromptRenderer } from "@/components/ops/action-prompt-renderer";
import { NotificationModal } from "@/components/layouts/notification-modal";
import { useActionPrompts } from "@/hooks/useActionPrompts";
import { useWindowStore } from "@/stores/window-store";
import { CreateProjectForm } from "@/components/ops/create-project-modal";
import { CreateClientForm } from "@/components/ops/create-client-modal";
import { CreateTaskForm } from "@/components/ops/create-task-modal";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useGmailSyncNotifications } from "@/lib/hooks/use-gmail-sync-notifications";
import { useDashboardPreferencesSync } from "@/lib/hooks/use-dashboard-preferences-sync";
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

function DashboardPreferencesSync() {
  useDashboardPreferencesSync();
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
  const { needsWebSetup, needsEmployeeOnboarding } = useSetupGate();
  const router = useRouter();
  const pathname = usePathname();
  const needsOnboarding = needsEmployeeOnboarding || needsWebSetup;

  // Redirect to the appropriate onboarding flow if incomplete.
  // Employee check first — employees should never see employer setup.
  useEffect(() => {
    if (needsEmployeeOnboarding) {
      router.push("/employee-setup");
    } else if (needsWebSetup) {
      router.push("/setup");
    }
  }, [needsEmployeeOnboarding, needsWebSetup, router]);

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

  // Block all dashboard rendering while onboarding is needed.
  // Without this, the full layout (map, preferences sync, etc.) mounts
  // before the useEffect redirect fires, causing Leaflet and Supabase
  // errors from components that should never have initialized.
  if (needsOnboarding) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <span className="font-bebas text-[48px] tracking-[0.2em] text-ops-accent leading-none animate-pulse-live">
          OPS
        </span>
      </div>
    );
  }

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
      <DashboardPreferencesSync />
      <ActionPromptRenderer />
      <CommandPalette />
      <KeyboardShortcuts />
      <FloatingWindows />
      <FloatingActionButton />
      <BugReportButton />
      <NotificationModal />
      <WindowDock />
    </div>
  );
}
