"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { CommandPalette } from "@/components/ops/command-palette";
import { KeyboardShortcuts } from "@/components/ops/keyboard-shortcuts";
import { FloatingWindow } from "@/components/ops/floating-window";
import { PreferencesApplier } from "@/components/ops/preferences-applier";
import { WindowDock } from "@/components/ops/window-dock";
import { FloatingActionButton } from "@/components/ops/floating-action-button";
import { BugReportButton } from "@/components/ops/bug-report-button";
import { NotificationModal } from "@/components/layouts/notification-modal";
import { DuplicateReviewSheet } from "@/components/ops/duplicate-review-sheet";
import { useActionPrompts } from "@/hooks/useActionPrompts";
import { useWindowStore } from "@/stores/window-store";
import { CreateProjectForm } from "@/components/ops/create-project-modal";
import { CreateClientForm } from "@/components/ops/create-client-modal";
import { CreateTaskForm } from "@/components/ops/create-task-modal";
import { CreateEstimateForm } from "@/components/ops/create-estimate-modal";
import { CreateLeadForm } from "@/components/ops/create-lead-modal";
import { ComposeEmailForm } from "@/components/ops/compose-email-form";
import type { ComposeEmailData } from "@/lib/types/email-template";
import { useGmailSyncNotifications } from "@/lib/hooks/use-gmail-sync-notifications";
import { useDashboardPreferencesSync } from "@/lib/hooks/use-dashboard-preferences-sync";
import { ClientDetailPopover } from "@/components/ops/client-detail-popover";
import { InvoiceDetailPopover } from "@/components/ops/invoice-detail-popover";
import { EstimateDetailPopover } from "@/components/ops/estimate-detail-popover";
import { MemberExpensesPopover } from "@/components/ops/member-expenses-popover";
import { ExpenseBatchPopover } from "@/components/ops/expense-batch-popover";
import { ExpenseReviewListPopover } from "@/components/ops/expense-review-list-popover";
import { UnassignedRoleBanner } from "@/components/ops/unassigned-role-banner";
import { useSetupGate } from "@/hooks/useSetupGate";
import { useRouter } from "next/navigation";

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
          {win.type === "create-estimate" && (
            <CreateEstimateForm
              onSuccess={() => closeWindow(win.id)}
              onCancel={() => closeWindow(win.id)}
            />
          )}
          {win.type === "create-lead" && (
            <CreateLeadForm
              onSuccess={() => closeWindow(win.id)}
              onCancel={() => closeWindow(win.id)}
            />
          )}
          {win.type === "compose-email" && (
            <ComposeEmailForm
              composeData={win.metadata as ComposeEmailData | undefined}
              onClose={() => closeWindow(win.id)}
            />
          )}
        </FloatingWindow>
      ))}
    </>
  );
}

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { needsWebSetup, needsEmployeeOnboarding } = useSetupGate();
  const router = useRouter();
  const needsOnboarding = needsEmployeeOnboarding || needsWebSetup;

  // Redirect to the appropriate onboarding flow if incomplete.
  useEffect(() => {
    if (needsEmployeeOnboarding) {
      router.push("/employee-setup");
    } else if (needsWebSetup) {
      router.push("/setup");
    }
  }, [needsEmployeeOnboarding, needsWebSetup, router]);

  // Block all dashboard rendering while onboarding is needed.
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
    <div className="relative h-screen overflow-hidden bg-background">
      {/* Page content — full bleed to all edges except left (sidebar width) */}
      <main className="relative z-[1] h-screen w-full overflow-y-auto overflow-x-auto pl-0 md:pl-[72px]">
        <UnassignedRoleBanner />
        <div className="pt-[68px] pb-32 px-3 space-y-3">
          {children}
        </div>
      </main>

      {/* Bottom gradient fade — signals more content below the fold */}
      <div
        className="fixed bottom-0 right-0 left-0 md:left-[72px] h-24 pointer-events-none z-[5]"
        style={{
          background:
            "linear-gradient(to bottom, transparent 0%, hsl(var(--background)) 100%)",
        }}
      />

      {/* ── HUD Overlays ── */}

      {/* TopBar — fixed glass overlay, starts after sidebar */}
      <div
        className="fixed top-0 right-0 z-10 h-[56px] left-0 md:left-[72px]"
        style={{
          background: "rgba(10, 10, 10, 0.70)",
          backdropFilter: "blur(20px) saturate(1.2)",
          WebkitBackdropFilter: "blur(20px) saturate(1.2)",
          borderBottom: "1px solid hsl(0 0% 100% / 0.2)",
        }}
      >
        <TopBar />
      </div>

      {/* Sidebar — fixed glass overlay (hover to expand) */}
      <Sidebar />

      {/* Map background layer (dashboard route only) */}
      <DashboardMapBackground />
      <MapFilterRail />

      {/* Global features */}
      <PreferencesApplier />
      <ActionPromptsInitializer />
      <GmailSyncNotifier />
      <DashboardPreferencesSync />
      <CommandPalette />
      <KeyboardShortcuts />
      <FloatingWindows />
      <FloatingActionButton />
      <BugReportButton />
      <NotificationModal />
      <DuplicateReviewSheet />
      <WindowDock />

      {/* Entity detail popovers — accessible from any page via widget clicks */}
      <ClientDetailPopover />
      <InvoiceDetailPopover />
      <EstimateDetailPopover />
      <MemberExpensesPopover />
      <ExpenseBatchPopover />
      <ExpenseReviewListPopover />
    </div>
  );
}
