"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  FolderKanban,
  Users,
  Settings,
  Search,
  LogOut,
  Keyboard,
  RefreshCw,
  ClipboardList,
  Target,
  Bug,
} from "lucide-react";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import {
  useFeatureFlagsStore,
  selectFlagsReady,
} from "@/lib/store/feature-flags-store";
import {
  getNavEntries,
  getNumberShortcutRoutes,
  entryPermissions,
} from "@/lib/navigation/route-registry";
import { useDictionary } from "@/i18n/client";
import { useSignOutStore } from "@/stores/signout-store";
import { useWindowStore } from "@/stores/window-store";
import { useEdgeTabStore } from "@/stores/edge-tab-store";
import { useBugReportStore } from "@/stores/bug-report-store";
import { useQuickActions } from "@/lib/hooks/use-quick-actions";
import { dispatchQuickAction } from "@/lib/quick-actions/dispatch";
import { useProjects } from "@/lib/hooks/use-projects";
import { useClients } from "@/lib/hooks/use-clients";
import { useTasks } from "@/lib/hooks/use-tasks";
import { useOpportunities } from "@/lib/hooks/use-opportunities";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
} from "@/components/ui/command";

interface CommandAction {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut?: string;
  onSelect: () => void;
  keywords?: string[];
  requiredPermission?: string;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const router = useRouter();
  const queryClient = useQueryClient();
  const beginSignOut = useSignOutStore((s) => s.begin);
  const openWindow = useWindowStore((s) => s.openWindow);
  const openProjectWindow = useWindowStore((s) => s.openProjectWindow);
  const openClientWindow = useWindowStore((s) => s.openClientWindow);
  const can = usePermissionStore((s) => s.can);
  const isPermissionUnlocked = useFeatureFlagsStore((s) => s.isPermissionUnlocked);
  const canAccessFeature = useFeatureFlagsStore((s) => s.canAccessFeature);
  const flagsReady = useFeatureFlagsStore(selectFlagsReady);
  const { t: tNav } = useDictionary("navigation");
  const { t: tQuickActions } = useDictionary("quick-actions");
  // The real, permission- + feature-filtered create catalog — the single
  // source the bottom-right Create menu also renders, so the palette's create
  // list can never drift to legacy routes again.
  const fabActions = useQuickActions();

  // Entity data for search — scope-AGNOSTIC across the whole company so
  // the palette acts as a universal lookup. Bug ab3ace6e — the legacy
  // useScopedProjects path silently dropped projects the operator wasn't
  // assigned to.
  const { data: projectsData } = useProjects(undefined, { enabled: open });
  const { data: clientsData } = useClients(undefined, { enabled: open });
  const { data: tasksData } = useTasks(undefined, { enabled: open });
  const { data: opportunitiesData } = useOpportunities(undefined, {
    enabled: open,
  });

  const entityResults = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (q.length < 2) {
      return { projects: [], clients: [], tasks: [], opportunities: [] };
    }

    const projects = (projectsData?.projects ?? [])
      .filter(
        (p) =>
          p.title?.toLowerCase().includes(q) ||
          p.address?.toLowerCase().includes(q),
      )
      .slice(0, 6);

    const clients = (clientsData?.clients ?? [])
      .filter(
        (c) =>
          c.name?.toLowerCase().includes(q) ||
          c.email?.toLowerCase().includes(q) ||
          c.phoneNumber?.toLowerCase().includes(q),
      )
      .slice(0, 6);

    const tasks = (tasksData?.tasks ?? [])
      .filter(
        (t) =>
          t.customTitle?.toLowerCase().includes(q) ||
          t.taskNotes?.toLowerCase().includes(q),
      )
      .slice(0, 6);

    const opportunities = (opportunitiesData ?? [])
      .filter(
        (o) =>
          o.title?.toLowerCase().includes(q) ||
          o.description?.toLowerCase().includes(q) ||
          o.contactName?.toLowerCase().includes(q) ||
          o.contactEmail?.toLowerCase().includes(q),
      )
      .slice(0, 6);

    return { projects, clients, tasks, opportunities };
  }, [search, projectsData, clientsData, tasksData, opportunitiesData]);

  const hasEntityResults =
    entityResults.projects.length > 0 ||
    entityResults.clients.length > 0 ||
    entityResults.tasks.length > 0 ||
    entityResults.opportunities.length > 0;

  // Toggle with Cmd+K / Ctrl+K or backslash
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      // Backslash shortcut (only when not typing in an input/textarea)
      if (
        e.key === "\\" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target as HTMLElement)?.isContentEditable
      ) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const navigate = useCallback(
    (path: string) => {
      setOpen(false);
      router.push(path);
    },
    [router]
  );

  // Nav section derives from the route registry — labels through the
  // navigation dictionary, displayed number shortcuts from the same map
  // the keyboard handler uses (they had drifted apart), Phase C entries
  // only for flagged companies, flag-locked entries hidden (the palette
  // has no dimmed request-access state).
  const numberShortcuts = getNumberShortcutRoutes();
  const shortcutByHref: Record<string, string> = Object.fromEntries(
    Object.entries(numberShortcuts).map(([num, href]) => [href, num])
  );
  const navigationActions: CommandAction[] = getNavEntries()
    .filter((entry) => !entry.phaseCOnly || (flagsReady && canAccessFeature("phase_c")))
    // Any-of entries (BOOKS) surface when at least one constituent
    // permission is both flag-unlocked and RBAC-granted.
    .filter((entry) => {
      const perms = entryPermissions(entry);
      return (
        perms.length === 0 ||
        perms.some((p) => isPermissionUnlocked(p) && can(p))
      );
    })
    .map((entry) => ({
      id: `nav-${entry.key}`,
      label: tNav(entry.labelKey),
      icon: entry.icon,
      shortcut: shortcutByHref[entry.href],
      onSelect: () => navigate(entry.href),
      keywords: entry.paletteKeywords,
    }));

  // Create group = the real window-based catalog, dispatched through the
  // shared `dispatchQuickAction` (same path as the bottom-right Create menu).
  // Already permission- + feature-filtered by `useQuickActions`.
  const quickActions: CommandAction[] = fabActions.map((action) => ({
    id: `qa-${action.id}`,
    label: tQuickActions(action.labelKey),
    icon: action.icon,
    onSelect: () => {
      setOpen(false);
      dispatchQuickAction(action, {
        router,
        openWindow,
        openProjectWindow,
        openClientWindow,
        t: tQuickActions,
      });
    },
    keywords: ["create", "new", "add"],
  }));

  const settingsActions: CommandAction[] = ([
    {
      id: "settings-profile",
      label: "Profile",
      icon: Settings,
      onSelect: () => navigate("/settings?tab=profile"),
      keywords: ["settings", "account", "name", "email", "avatar", "personal"],
    },
    {
      id: "settings-appearance",
      label: "Appearance",
      icon: Settings,
      onSelect: () => navigate("/settings?tab=appearance"),
      keywords: ["settings", "theme", "dark", "light", "accent", "color", "font", "compact"],
    },
    {
      id: "settings-notifications",
      label: "Notifications",
      icon: Settings,
      onSelect: () => navigate("/settings?tab=notifications"),
      keywords: ["settings", "alerts", "email", "push", "notify"],
    },
    {
      id: "settings-shortcuts",
      label: "Keyboard Shortcuts",
      icon: Settings,
      onSelect: () => navigate("/settings?tab=shortcuts"),
      keywords: ["settings", "keys", "hotkeys", "bindings"],
    },
    {
      id: "settings-company",
      label: "Company Details",
      icon: Settings,
      onSelect: () => navigate("/settings?tab=company"),
      keywords: ["settings", "organization", "business", "logo", "address"],
      requiredPermission: "settings.company",
    },
    {
      id: "settings-team",
      label: "Team Members",
      icon: Settings,
      onSelect: () => navigate("/settings?tab=team"),
      keywords: ["settings", "crew", "staff", "employees", "invite", "members"],
      requiredPermission: "team.view",
    },
    {
      id: "settings-roles",
      label: "Roles & Permissions",
      icon: Settings,
      onSelect: () => navigate("/settings?tab=roles"),
      keywords: ["settings", "permissions", "access", "admin", "roles"],
      requiredPermission: "team.assign_roles",
    },
    {
      id: "settings-task-types",
      label: "Task Types",
      icon: Settings,
      onSelect: () => navigate("/settings?tab=task-types"),
      keywords: ["settings", "categories", "task", "types", "operations"],
      requiredPermission: "settings.company",
    },
    {
      id: "settings-inventory",
      label: "Inventory",
      icon: Settings,
      onSelect: () => navigate("/settings?tab=inventory"),
      keywords: ["settings", "materials", "stock", "supplies", "equipment"],
      requiredPermission: "inventory.manage",
    },
    {
      id: "settings-expenses",
      label: "Expenses",
      icon: Settings,
      onSelect: () => navigate("/settings?tab=expenses"),
      keywords: ["settings", "expense", "categories", "receipts", "costs"],
      requiredPermission: "expenses.configure",
    },
    {
      id: "settings-quick-actions",
      label: "Quick Actions",
      icon: Settings,
      onSelect: () => navigate("/settings?tab=quick-actions"),
      keywords: ["settings", "shortcuts", "actions", "automation"],
    },
    {
      id: "settings-subscription",
      label: "Subscription",
      icon: Settings,
      onSelect: () => navigate("/settings?tab=subscription"),
      keywords: ["settings", "plan", "billing", "upgrade", "pricing"],
      requiredPermission: "settings.billing",
    },
    {
      id: "settings-billing",
      label: "Payment",
      icon: Settings,
      onSelect: () => navigate("/settings?tab=billing"),
      keywords: ["settings", "payment", "card", "invoice", "billing"],
      requiredPermission: "settings.billing",
    },
    {
      id: "settings-integrations",
      label: "Email Integration",
      icon: Settings,
      onSelect: () => navigate("/settings?tab=integrations"),
      keywords: ["settings", "email", "smtp", "integration", "connect"],
      requiredPermission: "settings.integrations",
    },
    {
      id: "settings-portal",
      label: "Client Portal",
      icon: Settings,
      onSelect: () => navigate("/settings?tab=portal"),
      keywords: ["settings", "portal", "branding", "client", "customer"],
      requiredPermission: "portal.manage_branding",
    },
    {
      id: "settings-templates",
      label: "Document Templates",
      icon: Settings,
      onSelect: () => navigate("/settings?tab=templates"),
      keywords: ["settings", "templates", "documents", "proposals", "contracts"],
      requiredPermission: "documents.manage_templates",
    },
    {
      id: "settings-accounting",
      label: "Accounting Integration",
      icon: Settings,
      onSelect: () => navigate("/settings?tab=accounting"),
      keywords: ["settings", "quickbooks", "xero", "accounting", "finance"],
      requiredPermission: "accounting.manage_connections",
    },
    {
      id: "settings-preferences",
      label: "General Preferences",
      icon: Settings,
      onSelect: () => navigate("/settings?tab=preferences"),
      keywords: ["settings", "preferences", "general", "defaults", "dashboard"],
    },
    {
      id: "settings-map",
      label: "Map Preferences",
      icon: Settings,
      onSelect: () => navigate("/settings?tab=map"),
      keywords: ["settings", "map", "zoom", "traffic", "location", "gps"],
    },
    {
      id: "settings-data-privacy",
      label: "Data & Privacy",
      icon: Settings,
      onSelect: () => navigate("/settings?tab=data-privacy"),
      keywords: ["settings", "data", "privacy", "export", "delete", "gdpr"],
    },
  ] as CommandAction[]).filter(
    (a) => !a.requiredPermission || can(a.requiredPermission)
  );

  const systemActions: CommandAction[] = [
    {
      id: "system-sync",
      label: "Sync Data",
      icon: RefreshCw,
      onSelect: () => {
        setOpen(false);
        queryClient.invalidateQueries();
        toast.success("Syncing all data...");
      },
      keywords: ["refresh", "update", "fetch", "reload", "sync"],
    },
    {
      id: "system-report-bug",
      label: "Report a bug",
      icon: Bug,
      shortcut: "`",
      onSelect: () => {
        // Mirror the cluster's bug glyph: capture the screen first, then open
        // the drawer. The CommandDialog is data-bug-report-ignore, so the
        // closing palette never lands in the screenshot.
        setOpen(false);
        useBugReportStore.getState().requestScreenshot();
        useEdgeTabStore.getState().setActive("bug-report");
      },
      keywords: ["bug", "issue", "feedback", "problem", "report"],
    },
    {
      id: "system-shortcuts",
      label: "Keyboard Shortcuts",
      icon: Keyboard,
      shortcut: "?",
      onSelect: () => {
        setOpen(false);
        toast.info("Keyboard Shortcuts", {
          description: "1-9: Navigate pages \u2022 \u2318K: Search \u2022 \u2318\u21E7P: New Project \u2022 \u2318\u21E7C: New Client \u2022 Esc: Close",
          duration: 8000,
        });
      },
      keywords: ["help", "keys", "hotkeys"],
    },
    {
      id: "system-logout",
      label: "Sign Out",
      icon: LogOut,
      onSelect: () => {
        setOpen(false);
        const user = useAuthStore.getState().currentUser;
        beginSignOut(user?.firstName || "", user?.lastName || "");
      },
      keywords: ["logout", "exit"],
    },
  ];

  return (
    <CommandDialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setSearch(""); }}>
      <CommandInput
        placeholder="Search projects, clients, tasks, opportunities, or commands..."
        onClear={() => setOpen(false)}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>
          <div className="flex flex-col items-center gap-1 py-2">
            <Search className="w-[24px] h-[24px] text-text-mute" />
            <span>No results found</span>
            <span className="text-[11px] text-text-mute">
              Try a different search term
            </span>
          </div>
        </CommandEmpty>

        {/* Entity search results */}
        {hasEntityResults && (
          <>
            {entityResults.projects.length > 0 && (
              <CommandGroup heading="Projects">
                {entityResults.projects.map((p) => (
                  <CommandItem
                    key={`project-${p.id}`}
                    // cmdk scores on `value`. Including the UUID prefix
                    // collapsed scores to 0 for matches mid-string, so the
                    // item rendered hidden even with forceMount. Use only the
                    // user-meaningful searchable text; cmdk dedupes by ref so
                    // duplicate titles still render distinctly via React key.
                    value={`project ${p.title} ${p.address ?? ""}`}
                    onSelect={() => { setOpen(false); openProjectWindow({ projectId: p.id, mode: "viewing" }); }}
                    forceMount
                  >
                    <FolderKanban className="w-[16px] h-[16px] text-text-3" />
                    <span className="truncate">{p.title}</span>
                    {p.address && (
                      <span className="ml-auto text-[11px] text-text-mute truncate max-w-[180px]">
                        {p.address}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {entityResults.clients.length > 0 && (
              <CommandGroup heading="Clients">
                {entityResults.clients.map((c) => (
                  <CommandItem
                    key={`client-${c.id}`}
                    value={`client ${c.name} ${c.email ?? ""}`}
                    onSelect={() => { setOpen(false); openClientWindow({ clientId: c.id, mode: "viewing" }); }}
                    forceMount
                  >
                    <Users className="w-[16px] h-[16px] text-text-3" />
                    <span className="truncate">{c.name}</span>
                    {c.email && (
                      <span className="ml-auto text-[11px] text-text-mute truncate max-w-[180px]">
                        {c.email}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {entityResults.tasks.length > 0 && (
              <CommandGroup heading="Tasks">
                {entityResults.tasks.map((t) => (
                  <CommandItem
                    key={`task-${t.id}`}
                    value={`task ${t.customTitle ?? ""} ${t.taskNotes ?? ""}`}
                    onSelect={() => { setOpen(false); if (t.projectId) openProjectWindow({ projectId: t.projectId, mode: "viewing" }); }}
                    forceMount
                  >
                    <ClipboardList className="w-[16px] h-[16px] text-text-3" />
                    <span className="truncate">{t.customTitle || "Untitled Task"}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {entityResults.opportunities.length > 0 && (
              <CommandGroup heading="Opportunities">
                {entityResults.opportunities.map((o) => (
                  <CommandItem
                    key={`opp-${o.id}`}
                    value={`opp-${o.id} ${o.title}`}
                    onSelect={() => navigate(`/pipeline?opportunity=${o.id}`)}
                    forceMount
                  >
                    <Target className="w-[16px] h-[16px] text-text-3" />
                    <span className="truncate">{o.title}</span>
                    {o.contactName && (
                      <span className="ml-auto text-[11px] text-text-mute truncate max-w-[180px]">
                        {o.contactName}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading="Create">
          {quickActions.map((action) => (
            <CommandItem
              key={action.id}
              value={[action.label, ...(action.keywords || [])].join(" ")}
              onSelect={action.onSelect}
            >
              <action.icon className="w-[16px] h-[16px] text-text-3" />
              <span>{action.label}</span>
              {action.shortcut && (
                <CommandShortcut>{action.shortcut}</CommandShortcut>
              )}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Navigation">
          {navigationActions.map((action) => (
            <CommandItem
              key={action.id}
              value={[action.label, ...(action.keywords || [])].join(" ")}
              onSelect={action.onSelect}
            >
              <action.icon className="w-[16px] h-[16px] text-text-3" />
              <span>{action.label}</span>
              {action.shortcut && (
                <CommandShortcut>{action.shortcut}</CommandShortcut>
              )}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Settings">
          {settingsActions.map((action) => (
            <CommandItem
              key={action.id}
              value={[action.label, ...(action.keywords || [])].join(" ")}
              onSelect={action.onSelect}
            >
              <action.icon className="w-[16px] h-[16px] text-text-3" />
              <span>{action.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="System">
          {systemActions.map((action) => (
            <CommandItem
              key={action.id}
              value={[action.label, ...(action.keywords || [])].join(" ")}
              onSelect={action.onSelect}
            >
              <action.icon className="w-[16px] h-[16px] text-text-3" />
              <span>{action.label}</span>
              {action.shortcut && (
                <CommandShortcut>{action.shortcut}</CommandShortcut>
              )}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>

      {/* Footer */}
      <div className="flex items-center justify-between px-2 py-1 border-t border-border text-text-mute">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-[4px]">
            <kbd className="font-mono text-micro px-[4px] py-[1px] rounded bg-fill-neutral-dim border border-border-subtle">
              &uarr;
            </kbd>
            <kbd className="font-mono text-micro px-[4px] py-[1px] rounded bg-fill-neutral-dim border border-border-subtle">
              &darr;
            </kbd>
            <span className="font-mono text-micro">Navigate</span>
          </div>
          <div className="flex items-center gap-[4px]">
            <kbd className="font-mono text-micro px-[4px] py-[1px] rounded bg-fill-neutral-dim border border-border-subtle">
              &crarr;
            </kbd>
            <span className="font-mono text-micro">Select</span>
          </div>
          <div className="flex items-center gap-[4px]">
            <kbd className="font-mono text-micro px-[6px] py-[1px] rounded bg-fill-neutral-dim border border-border-subtle">
              Esc
            </kbd>
            <span className="font-mono text-micro">Close</span>
          </div>
        </div>
        <span className="font-mono text-micro text-text-mute">OPS v1.0</span>
      </div>
    </CommandDialog>
  );
}
