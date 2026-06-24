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
import { BugReportDrawer } from "@/components/ops/bug-report-drawer";
import { CreateCluster } from "@/components/ops/create-menu/create-cluster";
import { NotificationsDrawer } from "@/components/layouts/notifications-drawer";
import { DuplicateReviewSheet } from "@/components/ops/duplicate-review-sheet";
import { useActionPrompts } from "@/hooks/useActionPrompts";
import { useWindowStore } from "@/stores/window-store";
import { CreateTaskForm } from "@/components/ops/create-task-modal";
import { CreateEstimateForm } from "@/components/ops/create-estimate-modal";
import { CreateLeadForm } from "@/components/ops/create-lead-modal";
import { ComposeEmailForm } from "@/components/ops/compose-email-form";
import { ProjectWorkspaceContainer } from "@/components/ops/projects/workspace/project-workspace-container";
import { ClientWorkspaceContainer } from "@/components/ops/clients/workspace/client-workspace-container";
import type { ComposeEmailData } from "@/lib/types/email-template";
import { useGmailSyncNotifications } from "@/lib/hooks/use-gmail-sync-notifications";
import { useDashboardPreferencesSync } from "@/lib/hooks/use-dashboard-preferences-sync";
import { InvoiceDetailPopover } from "@/components/ops/invoice-detail-popover";
import { EstimateDetailPopover } from "@/components/ops/estimate-detail-popover";
import { MemberExpensesPopover } from "@/components/ops/member-expenses-popover";
import { ExpenseBatchPopover } from "@/components/ops/expense-batch-popover";
import { ExpenseReviewListPopover } from "@/components/ops/expense-review-list-popover";
import { UnassignedRoleBanner } from "@/components/ops/unassigned-role-banner";
import { useSetupGate } from "@/hooks/useSetupGate";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { getFullHeightMode as resolveFullHeightMode } from "@/lib/navigation/route-registry";

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

// Modes are declared on each route's registry entry (fullHeight) with
// opt-outs in FULL_HEIGHT_EXCEPTIONS (/projects/new is a scrolling form).
// The retired /settings/integrations/ai-setup entry is gone — middleware
// 308s it to /calibration, so the page never renders.

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

// Phase 9.7 — notification deep-link handler. Notifications dispatch with
// `actionUrl: /dashboard?openProject=<id>&mode=view|edit` (P14-1: prefix
// changed from `/` because the root → /dashboard redirect strips query
// params). The handler is path-agnostic — when that URL lands on any
// dashboard route, this effect opens the project-workspace window for the
// requested project and strips the query params so a refresh doesn't
// re-open the window.
function ProjectWorkspaceDeepLinkHandler() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const openProjectWindow = useWindowStore((s) => s.openProjectWindow);

  useEffect(() => {
    const projectId = searchParams.get("openProject");
    if (!projectId) return;
    const modeParam = searchParams.get("mode");
    const mode = modeParam === "edit" ? "editing" : "viewing";
    openProjectWindow({ projectId, mode });

    // Strip the deep-link params while preserving anything else on the URL
    // (e.g. tab filters). Use `router.replace` so the back button doesn't
    // bounce the user back through the open transition.
    const next = new URLSearchParams(searchParams.toString());
    next.delete("openProject");
    next.delete("mode");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }, [searchParams, pathname, router, openProjectWindow]);

  return null;
}

// Client-workspace deep-link handler — mirror of the project one. Client
// notifications + cross-surface links dispatch `actionUrl:
// /dashboard?openClient=<id>&mode=view|edit`. When that URL lands on any
// dashboard route this opens the client-workspace window and strips the
// params so a refresh doesn't re-open it. Only one entity deep-link is ever
// present per URL (notifications target a single entity), so sharing the
// `mode` key with the project handler is safe — whichever trigger is absent
// returns early before touching the URL.
function ClientWorkspaceDeepLinkHandler() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const openClientWindow = useWindowStore((s) => s.openClientWindow);

  useEffect(() => {
    const raw = searchParams.get("openClient");
    if (!raw) return;
    if (raw === "new") {
      // `/clients/new` folds into the window's creating mode (P3.3 D2).
      openClientWindow({ clientId: null, mode: "creating" });
    } else {
      const modeParam = searchParams.get("mode");
      const mode = modeParam === "edit" ? "editing" : "viewing";
      openClientWindow({ clientId: raw, mode });
    }

    const next = new URLSearchParams(searchParams.toString());
    next.delete("openClient");
    next.delete("mode");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }, [searchParams, pathname, router, openClientWindow]);

  return null;
}

function FloatingWindows() {
  const windows = useWindowStore((s) => s.windows);
  const closeWindow = useWindowStore((s) => s.closeWindow);

  // Project- and client-workspace windows render their own shell
  // (ProjectWorkspaceWindow) via their containers, so they bypass the legacy
  // FloatingWindow chrome.
  const legacyWindows = windows.filter(
    (w) =>
      w.type !== "project-workspace" &&
      w.type !== "client-workspace" &&
      w.type !== "pipeline-detail"
  );
  const workspaceWindows = windows.filter(
    (w) => w.type === "project-workspace"
  );
  const clientWorkspaceWindows = windows.filter(
    (w) => w.type === "client-workspace"
  );

  return (
    <>
      {legacyWindows.map((win) => (
        <FloatingWindow key={win.id} window={win}>
          {win.type === "create-task" && (
            <CreateTaskForm
              defaultProjectId={
                (win.metadata?.projectId as string | undefined) ?? undefined
              }
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
      {workspaceWindows.map((win) => (
        <ProjectWorkspaceContainer key={win.id} windowId={win.id} />
      ))}
      {clientWorkspaceWindows.map((win) => (
        <ClientWorkspaceContainer key={win.id} windowId={win.id} />
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
      <div className="flex h-screen items-center justify-center bg-background">
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
      <main className="relative z-[1] flex h-screen w-full flex-col overflow-hidden pl-0 md:pl-[72px]">
        <UnassignedRoleBanner />

        {fullHeightMode === "padded" ? (
          <div className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-[68px]">
            {children}
          </div>
        ) : fullHeightMode === "bleed" ? (
          <div className="flex min-h-0 flex-1 flex-col pt-[56px]">
            {children}
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-3 overflow-x-auto overflow-y-auto px-3 pb-32 pt-[68px]">
            {children}
          </div>
        )}
      </main>

      {/* Bottom gradient fade — signals more content below the fold.
          Hidden on full-height pages where there is no fold. */}
      {!isFullHeight && (
        <div
          className="pointer-events-none fixed bottom-0 left-0 right-0 z-[5] h-24 md:left-[72px]"
          style={{
            background:
              "linear-gradient(to bottom, transparent 0%, hsl(var(--background)) 100%)",
          }}
        />
      )}

      {/* ── HUD Overlays ── */}

      {/* TopBar — fixed overlay, starts after sidebar.
          Z: nav band 500 (scrim 502, sidebar 505 — see route-registry.ts).

          Surface (P5): a gradient SCRIM, not a glass panel. No fill, no blur,
          no hairline seam — the bar dissolves into the canvas. A black→
          transparent veil (60px) begins fading from the very top and falls
          off gradually — softest at the crown, no held-solid plateau — so it
          darkens the title/controls over the map without a hard edge and ends
          just past the 56px bar, never trailing far below the text into the
          content. Canvas color via the --background token (matches the
          bottom-fade above). pointer-events-none so it never blocks content. */}
      <div className="pointer-events-none fixed left-0 right-0 top-0 z-[500] md:left-[72px]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[60px]"
          style={{
            background:
              "linear-gradient(180deg, hsl(var(--background) / 0.85) 0%, hsl(var(--background) / 0.58) 32%, hsl(var(--background) / 0.3) 62%, hsl(var(--background) / 0.1) 84%, transparent 100%)",
          }}
        />
        <div className="pointer-events-auto relative h-[56px]">
          <TopBar />
        </div>
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
      <ProjectWorkspaceDeepLinkHandler />
      <ClientWorkspaceDeepLinkHandler />
      <NotificationsDrawer />
      {/* Bottom-right action cluster — Create (accent) + Bug (dim). Replaced
          the right-edge Quick Actions + Bug Report tabs (WEB OVERHAUL P5). */}
      <CreateCluster />
      <BugReportDrawer />
      <DuplicateReviewSheet />
      <WindowDock />

      {/* Entity detail popovers — accessible from any page via widget clicks.
          Clients retired to the floating client workspace window (P3.3). */}
      <InvoiceDetailPopover />
      <EstimateDetailPopover />
      <MemberExpensesPopover />
      <ExpenseBatchPopover />
      <ExpenseReviewListPopover />
    </div>
  );
}
