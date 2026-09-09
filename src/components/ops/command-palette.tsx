"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { defaultFilter } from "cmdk";
import { toast } from "@/components/ui/toast";
import { Settings, LogOut, Keyboard, RefreshCw, Bug } from "lucide-react";
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
import { useWorkspaceSearch } from "@/lib/hooks/use-workspace-search";
import {
  ClientRow,
  DocumentRow,
  HIT_VALUE_PREFIX,
  LeadRow,
  ProjectRow,
  TaskRow,
  type PaletteTranslate,
} from "@/components/ops/command-palette-rows";
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

/**
 * Server-ranked rows keep the order `search_workspace` returned them in.
 *
 * cmdk re-sorts every item in a group by this score on each keystroke, and a
 * hit matched on a field the row does not display (a project's notes, an
 * invoice's subject) scores zero — so the rows the database ranked highest
 * would sink to the bottom of their group. A flat score for hit rows makes the
 * sort a no-op for them (Array#sort is stable) while commands keep the fuzzy
 * matching that makes them findable.
 */
const paletteFilter = (value: string, search: string, keywords?: string[]): number =>
  value.startsWith(HIT_VALUE_PREFIX) ? 1 : defaultFilter(value, search, keywords);

/** Fixed order. Predictable placement beats occasional cleverness. */
const ENTITY_KINDS = ["projects", "clients", "leads", "tasks", "documents"] as const;

/** Mirrors the hook's gate: below this, nothing was asked of the database. */
const MIN_SEARCH_LENGTH = 2;

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
  const { t } = useDictionary("command-palette");
  const tPalette = t as PaletteTranslate;
  // The real, permission- + feature-filtered create catalog — the single
  // source the bottom-right Create menu also renders, so the palette's create
  // list can never drift to legacy routes again.
  const fabActions = useQuickActions();

  // One ranked, permission-scoped round trip across every kind — the palette no
  // longer downloads the company to filter it in the browser (bug fa5a9ff2).
  // RLS inside `search_workspace` is the authority on what comes back, so the
  // palette stays a universal lookup without a scope-agnostic client fetch
  // (bug ab3ace6e).
  const workspaceSearch = useWorkspaceSearch(search, { enabled: open });
  const hits = workspaceSearch.result;

  // RLS already returns nothing from the books this operator cannot read; the
  // gate exists so the heading itself never appears above an empty group.
  const canSeeDocuments = can("invoices.view") || can("estimates.view");

  const visibleKinds = useMemo(
    () =>
      ENTITY_KINDS.filter((kind) => {
        if (kind === "documents" && !canSeeDocuments) return false;
        return (hits?.[kind].items.length ?? 0) > 0;
      }),
    [hits, canSeeDocuments],
  );

  const hasEntityResults = visibleKinds.length > 0;

  /**
   * A heading count is a claim about the query on screen. While the previous
   * envelope is held over a newer query (`isPlaceholderData`), the rows are
   * still worth showing — they were real answers a keystroke ago — but the
   * count belongs to the older question, so the label stands alone until the
   * number is true again. OPS numbers are never wrong.
   */
  const groupHeading = useCallback(
    (kind: (typeof ENTITY_KINDS)[number]) => {
      const label = t(`group.${kind}`);
      const group = hits?.[kind];
      if (!group || workspaceSearch.isPlaceholderData) return label;
      if (group.total <= group.items.length) return label;
      return `${label} ${t("group.countSeparator")} ${group.total}`;
    },
    [hits, t, workspaceSearch.isPlaceholderData],
  );

  const closeAnd = useCallback((run: () => void) => {
    setOpen(false);
    run();
  }, []);

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
      label: t("settings.profile"),
      icon: Settings,
      onSelect: () => navigate("/settings?tab=profile"),
      keywords: ["settings", "account", "name", "email", "avatar", "personal"],
    },
    {
      id: "settings-appearance",
      label: t("settings.appearance"),
      icon: Settings,
      onSelect: () => navigate("/settings?tab=appearance"),
      keywords: ["settings", "theme", "dark", "light", "accent", "color", "font", "compact"],
    },
    {
      id: "settings-notifications",
      label: t("settings.notifications"),
      icon: Settings,
      onSelect: () => navigate("/settings?tab=notifications"),
      keywords: ["settings", "alerts", "email", "push", "notify"],
    },
    {
      id: "settings-shortcuts",
      label: t("settings.shortcuts"),
      icon: Settings,
      onSelect: () => navigate("/settings?tab=shortcuts"),
      keywords: ["settings", "keys", "hotkeys", "bindings"],
    },
    {
      id: "settings-company",
      label: t("settings.company"),
      icon: Settings,
      onSelect: () => navigate("/settings?tab=company"),
      keywords: ["settings", "organization", "business", "logo", "address"],
      requiredPermission: "settings.company",
    },
    {
      id: "settings-team",
      label: t("settings.team"),
      icon: Settings,
      onSelect: () => navigate("/settings?tab=team"),
      keywords: ["settings", "crew", "staff", "employees", "invite", "members"],
      requiredPermission: "team.view",
    },
    {
      id: "settings-roles",
      label: t("settings.roles"),
      icon: Settings,
      onSelect: () => navigate("/settings?tab=roles"),
      keywords: ["settings", "permissions", "access", "admin", "roles"],
      requiredPermission: "team.assign_roles",
    },
    {
      id: "settings-task-types",
      label: t("settings.taskTypes"),
      icon: Settings,
      onSelect: () => navigate("/settings?tab=task-types"),
      keywords: ["settings", "categories", "task", "types", "operations"],
      requiredPermission: "settings.company",
    },
    {
      id: "settings-inventory",
      label: t("settings.inventory"),
      icon: Settings,
      onSelect: () => navigate("/settings?tab=inventory"),
      keywords: ["settings", "materials", "stock", "supplies", "equipment"],
      requiredPermission: "catalog.manage",
    },
    {
      id: "settings-expenses",
      label: t("settings.expenses"),
      icon: Settings,
      onSelect: () => navigate("/settings?tab=expenses"),
      keywords: ["settings", "expense", "categories", "receipts", "costs"],
      requiredPermission: "expenses.configure",
    },
    {
      id: "settings-quick-actions",
      label: t("settings.quickActions"),
      icon: Settings,
      onSelect: () => navigate("/settings?tab=quick-actions"),
      keywords: ["settings", "shortcuts", "actions", "automation"],
    },
    {
      id: "settings-subscription",
      label: t("settings.subscription"),
      icon: Settings,
      onSelect: () => navigate("/settings?tab=subscription"),
      keywords: ["settings", "plan", "billing", "upgrade", "pricing"],
      requiredPermission: "settings.billing",
    },
    {
      id: "settings-billing",
      label: t("settings.billing"),
      icon: Settings,
      onSelect: () => navigate("/settings?tab=billing"),
      keywords: ["settings", "payment", "card", "invoice", "billing"],
      requiredPermission: "settings.billing",
    },
    {
      id: "settings-integrations",
      label: t("settings.integrations"),
      icon: Settings,
      onSelect: () => navigate("/settings?tab=integrations"),
      keywords: ["settings", "email", "smtp", "integration", "connect"],
      requiredPermission: "settings.integrations",
    },
    {
      id: "settings-portal",
      label: t("settings.portal"),
      icon: Settings,
      onSelect: () => navigate("/settings?tab=portal"),
      keywords: ["settings", "portal", "branding", "client", "customer"],
      requiredPermission: "portal.manage_branding",
    },
    {
      id: "settings-templates",
      label: t("settings.templates"),
      icon: Settings,
      onSelect: () => navigate("/settings?tab=templates"),
      keywords: ["settings", "templates", "documents", "proposals", "contracts"],
      requiredPermission: "documents.manage_templates",
    },
    {
      id: "settings-accounting",
      label: t("settings.accounting"),
      icon: Settings,
      onSelect: () => navigate("/settings?tab=accounting"),
      keywords: ["settings", "quickbooks", "xero", "accounting", "finance"],
      requiredPermission: "accounting.manage_connections",
    },
    {
      id: "settings-preferences",
      label: t("settings.preferences"),
      icon: Settings,
      onSelect: () => navigate("/settings?tab=preferences"),
      keywords: ["settings", "preferences", "general", "defaults", "dashboard"],
    },
    {
      id: "settings-map",
      label: t("settings.map"),
      icon: Settings,
      onSelect: () => navigate("/settings?tab=map"),
      keywords: ["settings", "map", "zoom", "traffic", "location", "gps"],
    },
    {
      id: "settings-data-privacy",
      label: t("settings.dataPrivacy"),
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
      label: t("system.sync"),
      icon: RefreshCw,
      onSelect: () => {
        setOpen(false);
        queryClient.invalidateQueries();
        toast.success(t("system.sync.toast"));
      },
      keywords: ["refresh", "update", "fetch", "reload", "sync"],
    },
    {
      id: "system-report-bug",
      label: t("system.reportBug"),
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
      label: t("system.shortcuts"),
      icon: Keyboard,
      shortcut: "?",
      onSelect: () => {
        setOpen(false);
        toast.info(t("system.shortcuts"), {
          description: t("system.shortcuts.toast"),
          duration: 8000,
        });
      },
      keywords: ["help", "keys", "hotkeys"],
    },
    {
      id: "system-logout",
      label: t("system.signOut"),
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
    <CommandDialog
      open={open}
      onOpenChange={(v) => { setOpen(v); if (!v) setSearch(""); }}
      filter={paletteFilter}
    >
      <CommandInput
        placeholder={t("input.placeholder")}
        onClear={() => setOpen(false)}
        onValueChange={setSearch}
        searching={workspaceSearch.isFetching && workspaceSearch.enabled}
      />
      <CommandList>
        {/* The search itself failed. One quiet line and a way to try again —
            no toast, and the commands below stay usable through the outage. */}
        {workspaceSearch.isError && (
          <div className="flex items-center justify-between gap-1 px-1 py-1">
            <span className="font-mono text-micro uppercase tracking-widest text-text-3">
              {t("error.title")}
            </span>
            <button
              type="button"
              onClick={() => void workspaceSearch.refetch()}
              className="font-mono text-micro uppercase tracking-widest text-text-2 transition-colors hover:text-text"
            >
              {t("error.retry")}
            </button>
          </div>
        )}

        {/* cmdk counts only items REGISTERED with its filter store, and
            forceMount entity items never register — so Empty would claim
            "no matches" on top of a full result set. It is kept out of the
            tree entirely unless a real search settled on nothing: below two
            characters nothing was asked, mid-flight nothing is known yet, and
            an error already has its own line above. */}
        {!hasEntityResults &&
          workspaceSearch.activeQuery.length >= MIN_SEARCH_LENGTH &&
          !workspaceSearch.isFetching &&
          !workspaceSearch.isError && (
            <CommandEmpty>
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-micro uppercase tracking-widest text-text-3">
                  {t("empty.title")}
                </span>
                <span className="font-mohave text-body-sm text-text-3">
                  {t("empty.body")}
                </span>
              </div>
            </CommandEmpty>
          )}

        {/* forceMount on the GROUP too — cmdk hides any group missing from
            `filtered.groups`, and that set is built only from registered
            (non-forceMount) items, so these groups vanished the instant the
            operator typed. Bug fa5a9ff2. */}
        {hasEntityResults && (
          <>
            {visibleKinds.map((kind) => (
              <CommandGroup key={kind} heading={groupHeading(kind)} forceMount>
                {kind === "projects" &&
                  hits?.projects.items.map((hit) => (
                    <ProjectRow
                      key={hit.id}
                      hit={hit}
                      t={tPalette}
                      onSelect={() =>
                        closeAnd(() =>
                          openProjectWindow({ projectId: hit.id, mode: "viewing" }),
                        )
                      }
                    />
                  ))}
                {kind === "clients" &&
                  hits?.clients.items.map((hit) => (
                    <ClientRow
                      key={hit.id}
                      hit={hit}
                      t={tPalette}
                      onSelect={() =>
                        closeAnd(() =>
                          openClientWindow({ clientId: hit.id, mode: "viewing" }),
                        )
                      }
                    />
                  ))}
                {kind === "leads" &&
                  hits?.leads.items.map((hit) => (
                    <LeadRow
                      key={hit.id}
                      hit={hit}
                      t={tPalette}
                      onSelect={() => navigate(`/pipeline?opportunity=${hit.id}`)}
                    />
                  ))}
                {kind === "tasks" &&
                  hits?.tasks.items.map((hit) => (
                    <TaskRow
                      key={hit.id}
                      hit={hit}
                      t={tPalette}
                      // The project window has no task focus today, so a task
                      // opens the job it belongs to.
                      onSelect={() =>
                        closeAnd(() => {
                          if (hit.project_id) {
                            openProjectWindow({
                              projectId: hit.project_id,
                              mode: "viewing",
                            });
                          }
                        })
                      }
                    />
                  ))}
                {kind === "documents" &&
                  hits?.documents.items.map((hit) => (
                    <DocumentRow
                      key={`${hit.kind}-${hit.id}`}
                      hit={hit}
                      t={tPalette}
                      onSelect={() =>
                        navigate(
                          hit.kind === "invoice"
                            ? `/books?segment=invoices&invoice=${hit.id}`
                            : `/books?segment=estimates&estimate=${hit.id}`,
                        )
                      }
                    />
                  ))}
              </CommandGroup>
            ))}
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading={t("group.create")}>
          {quickActions.map((action) => (
            <CommandItem
              key={action.id}
              value={[action.label, ...(action.keywords || [])].join(" ")}
              onSelect={action.onSelect}
            >
              <action.icon className="h-icon-16 w-icon-16 text-text-3" />
              <span>{action.label}</span>
              {action.shortcut && (
                <CommandShortcut>{action.shortcut}</CommandShortcut>
              )}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={t("group.navigation")}>
          {navigationActions.map((action) => (
            <CommandItem
              key={action.id}
              value={[action.label, ...(action.keywords || [])].join(" ")}
              onSelect={action.onSelect}
            >
              <action.icon className="h-icon-16 w-icon-16 text-text-3" />
              <span>{action.label}</span>
              {action.shortcut && (
                <CommandShortcut>{action.shortcut}</CommandShortcut>
              )}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={t("group.settings")}>
          {settingsActions.map((action) => (
            <CommandItem
              key={action.id}
              value={[action.label, ...(action.keywords || [])].join(" ")}
              onSelect={action.onSelect}
            >
              <action.icon className="h-icon-16 w-icon-16 text-text-3" />
              <span>{action.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={t("group.system")}>
          {systemActions.map((action) => (
            <CommandItem
              key={action.id}
              value={[action.label, ...(action.keywords || [])].join(" ")}
              onSelect={action.onSelect}
            >
              <action.icon className="h-icon-16 w-icon-16 text-text-3" />
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
          <div className="flex items-center gap-0.5">
            <kbd className="font-mono text-micro px-0.5 py-[1px] rounded bg-fill-neutral-dim border border-border-subtle">
              &uarr;
            </kbd>
            <kbd className="font-mono text-micro px-0.5 py-[1px] rounded bg-fill-neutral-dim border border-border-subtle">
              &darr;
            </kbd>
            <span className="font-mono text-micro">{t("footer.navigate")}</span>
          </div>
          <div className="flex items-center gap-0.5">
            <kbd className="font-mono text-micro px-0.5 py-[1px] rounded bg-fill-neutral-dim border border-border-subtle">
              &crarr;
            </kbd>
            <span className="font-mono text-micro">{t("footer.select")}</span>
          </div>
          <div className="flex items-center gap-0.5">
            <kbd className="font-mono text-micro px-[6px] py-[1px] rounded bg-fill-neutral-dim border border-border-subtle">
              Esc
            </kbd>
            <span className="font-mono text-micro">{t("footer.close")}</span>
          </div>
        </div>
        <span className="font-mono text-micro text-text-mute">OPS v1.0</span>
      </div>
    </CommandDialog>
  );
}
