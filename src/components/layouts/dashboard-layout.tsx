"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { CommandPalette } from "@/components/ops/command-palette";
import { KeyboardShortcuts } from "@/components/ops/keyboard-shortcuts";
import { FloatingWindow } from "@/components/ops/floating-window";
import { PreferencesApplier } from "@/components/ops/preferences-applier";
import { LogoLoader } from "@/components/brand";
import { WindowDock } from "@/components/ops/window-dock";
import { BugReportTab } from "@/components/ops/bug-report-tab";
import { BugReportDrawer } from "@/components/ops/bug-report-drawer";
import { NotificationsDrawer } from "@/components/layouts/notifications-drawer";
import { NotificationsTab } from "@/components/layouts/notifications-tab";
import { QuickActionsDrawer } from "@/components/layouts/quick-actions-drawer";
import { QuickActionsTab } from "@/components/layouts/quick-actions-tab";
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

// ─── Full-height page support ────────────────────────────────────────────────
//
// Pages listed here opt out of the normal scrollable layout and instead fill
// the viewport below the topbar. Two modes:
//
//   - "padded" — 12px gutters on all sides, 12px gap below topbar. Used when
//                the page has its own bordered panel/card that should breathe.
//   - "bleed"  — edge-to-edge, clears only the topbar. Used when the page
//                renders a background surface (e.g. a map) that should run
//                into the viewport edges.
//
// The inner wrapper applies `flex-1 min-h-0 flex flex-col` so children can
// use `h-full` and `flex-1 min-h-0` without re-deriving viewport math.

type FullHeightMode = "padded" | "bleed";

const FULL_HEIGHT_ROUTES: Record<string, FullHeightMode> = {
  "/inbox": "padded",
  "/map": "bleed",
  "/calendar": "padded",
  "/settings/integrations/ai-setup": "padded",
};

function resolveFullHeightMode(pathname: string): FullHeightMode | null {
  for (const [route, mode] of Object.entries(FULL_HEIGHT_ROUTES)) {
    if (pathname === route || pathname.startsWith(route + "/")) return mode;
  }
  return null;
}

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
              defaultProjectId={(win.metadata?.projectId as string | undefined) ?? undefined}
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
  const pathname = usePathname();
  const needsOnboarding = needsEmployeeOnboarding || needsWebSetup;

  const fullHeightMode = resolveFullHeightMode(pathname);
  const isFullHeight = fullHeightMode !== null;

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
        <LogoLoader size={120} />
      </div>
    );
  }

  return (
    <div className="relative h-screen overflow-hidden bg-background">
      {/* Page content — full bleed to all edges except left (sidebar width).
          <main> is a flex column so scrollable and full-height pages can coexist:
          scrollable pages host their scroll on the inner wrapper; full-height
          pages use flex-1 min-h-0 to fill remaining space after the banner. */}
      <main className="relative z-[1] h-screen w-full pl-0 md:pl-[72px] flex flex-col overflow-hidden">
        <UnassignedRoleBanner />

        {fullHeightMode === "padded" ? (
          <div className="flex-1 min-h-0 pt-[68px] pb-3 px-3 flex flex-col">
            {children}
          </div>
        ) : fullHeightMode === "bleed" ? (
          <div className="flex-1 min-h-0 pt-[56px] flex flex-col">
            {children}
          </div>
        ) : (
          <div className="flex-1 min-h-0 pt-[68px] pb-32 px-3 space-y-3 overflow-y-auto overflow-x-auto">
            {children}
          </div>
        )}
      </main>

      {/* Bottom gradient fade — signals more content below the fold.
          Hidden on full-height pages where there is no fold. */}
      {!isFullHeight && (
        <div
          className="fixed bottom-0 right-0 left-0 md:left-[72px] h-24 pointer-events-none z-[5]"
          style={{
            background:
              "linear-gradient(to bottom, transparent 0%, hsl(var(--background)) 100%)",
          }}
        />
      )}

      {/* ── HUD Overlays ── */}

      {/* TopBar — fixed glass overlay, starts after sidebar */}
      <div
        className="fixed top-0 right-0 z-10 h-[56px] left-0 md:left-[72px]"
        style={{
          background: "var(--surface-glass)",
          backdropFilter: "blur(28px) saturate(1.3)",
          WebkitBackdropFilter: "blur(28px) saturate(1.3)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.09)",
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
      <NotificationsDrawer />
      <NotificationsTab />
      <QuickActionsDrawer />
      <QuickActionsTab />
      <BugReportDrawer />
      <BugReportTab />
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
