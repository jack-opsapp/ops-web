"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  FolderKanban,
  CalendarDays,
  Users,
  UserCog,
  MapPin,
  Settings,
  Plus,
  Search,
  Columns3,
  LayoutDashboard,
  GitBranch,
  Receipt,
  Calculator,
  LogOut,
  Keyboard,
  RefreshCw,
  ClipboardList,
} from "lucide-react";
import { useAuthStore } from "@/lib/store/auth-store";
import { useSetupStore } from "@/stores/setup-store";
import { signOut } from "@/lib/firebase/auth";
import { useProjects } from "@/lib/hooks/use-projects";
import { useClients } from "@/lib/hooks/use-clients";
import { useTasks } from "@/lib/hooks/use-tasks";
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
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const router = useRouter();
  const queryClient = useQueryClient();

  // Entity data for search (uses cached data, no extra fetches)
  const { data: projectsData } = useProjects(undefined, { enabled: open });
  const { data: clientsData } = useClients(undefined, { enabled: open });
  const { data: tasksData } = useTasks(undefined, { enabled: open });

  const entityResults = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (q.length < 2) return { projects: [], clients: [], tasks: [] };

    const projects = (projectsData?.projects ?? [])
      .filter(
        (p) =>
          p.title?.toLowerCase().includes(q) ||
          p.address?.toLowerCase().includes(q)
      )
      .slice(0, 5);

    const clients = (clientsData?.clients ?? [])
      .filter(
        (c) =>
          c.name?.toLowerCase().includes(q) ||
          c.email?.toLowerCase().includes(q)
      )
      .slice(0, 5);

    const tasks = (tasksData?.tasks ?? [])
      .filter(
        (t) =>
          t.customTitle?.toLowerCase().includes(q) ||
          t.taskNotes?.toLowerCase().includes(q)
      )
      .slice(0, 5);

    return { projects, clients, tasks };
  }, [search, projectsData, clientsData, tasksData]);

  const hasEntityResults =
    entityResults.projects.length > 0 ||
    entityResults.clients.length > 0 ||
    entityResults.tasks.length > 0;

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

  const navigationActions: CommandAction[] = [
    {
      id: "nav-dashboard",
      label: "Dashboard",
      icon: LayoutDashboard,
      shortcut: "1",
      onSelect: () => navigate("/dashboard"),
      keywords: ["home", "overview", "stats"],
    },
    {
      id: "nav-projects",
      label: "Projects",
      icon: FolderKanban,
      shortcut: "2",
      onSelect: () => navigate("/projects"),
      keywords: ["jobs", "work"],
    },
    {
      id: "nav-calendar",
      label: "Calendar",
      icon: CalendarDays,
      shortcut: "3",
      onSelect: () => navigate("/calendar"),
      keywords: ["schedule", "events", "dates"],
    },
    {
      id: "nav-clients",
      label: "Clients",
      icon: Users,
      shortcut: "4",
      onSelect: () => navigate("/clients"),
      keywords: ["customers", "contacts"],
    },
    {
      id: "nav-job-board",
      label: "Job Board",
      icon: Columns3,
      shortcut: "5",
      onSelect: () => navigate("/job-board"),
      keywords: ["kanban", "board", "pipeline"],
    },
    {
      id: "nav-team",
      label: "Team",
      icon: UserCog,
      shortcut: "6",
      onSelect: () => navigate("/team"),
      keywords: ["crew", "members", "staff"],
    },
    {
      id: "nav-map",
      label: "Map",
      icon: MapPin,
      shortcut: "7",
      onSelect: () => navigate("/map"),
      keywords: ["locations", "tracking", "gps"],
    },
    {
      id: "nav-pipeline",
      label: "Pipeline",
      icon: GitBranch,
      shortcut: "8",
      onSelect: () => navigate("/pipeline"),
      keywords: ["leads", "sales", "crm"],
    },
    {
      id: "nav-invoices",
      label: "Invoices",
      icon: Receipt,
      shortcut: "9",
      onSelect: () => navigate("/invoices"),
      keywords: ["billing", "payments"],
    },
    {
      id: "nav-accounting",
      label: "Accounting",
      icon: Calculator,
      onSelect: () => navigate("/accounting"),
      keywords: ["finance", "money", "quickbooks"],
    },
    {
      id: "nav-settings",
      label: "Settings",
      icon: Settings,
      onSelect: () => navigate("/settings"),
      keywords: ["preferences", "profile", "account"],
    },
  ];

  const quickActions: CommandAction[] = [
    {
      id: "action-new-project",
      label: "New Project",
      icon: Plus,
      shortcut: "\u2318\u21E7P",
      onSelect: () => navigate("/projects/new"),
      keywords: ["create", "add", "project"],
    },
    {
      id: "action-new-client",
      label: "New Client",
      icon: Plus,
      shortcut: "\u2318\u21E7C",
      onSelect: () => navigate("/clients/new"),
      keywords: ["create", "add", "customer"],
    },
    {
      id: "action-sync",
      label: "Sync Data",
      icon: RefreshCw,
      onSelect: () => {
        setOpen(false);
        queryClient.invalidateQueries();
        toast.success("Syncing all data...");
      },
      keywords: ["refresh", "update", "fetch"],
    },
  ];

  const settingsActions: CommandAction[] = [
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
    },
    {
      id: "settings-team",
      label: "Team Members",
      icon: Settings,
      onSelect: () => navigate("/settings?tab=team"),
      keywords: ["settings", "crew", "staff", "employees", "invite", "members"],
    },
    {
      id: "settings-roles",
      label: "Roles & Permissions",
      icon: Settings,
      onSelect: () => navigate("/settings?tab=roles"),
      keywords: ["settings", "permissions", "access", "admin", "roles"],
    },
    {
      id: "settings-task-types",
      label: "Task Types",
      icon: Settings,
      onSelect: () => navigate("/settings?tab=task-types"),
      keywords: ["settings", "categories", "task", "types", "operations"],
    },
    {
      id: "settings-inventory",
      label: "Inventory",
      icon: Settings,
      onSelect: () => navigate("/settings?tab=inventory"),
      keywords: ["settings", "materials", "stock", "supplies", "equipment"],
    },
    {
      id: "settings-expenses",
      label: "Expenses",
      icon: Settings,
      onSelect: () => navigate("/settings?tab=expenses"),
      keywords: ["settings", "expense", "categories", "receipts", "costs"],
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
    },
    {
      id: "settings-billing",
      label: "Payment",
      icon: Settings,
      onSelect: () => navigate("/settings?tab=billing"),
      keywords: ["settings", "payment", "card", "invoice", "billing"],
    },
    {
      id: "settings-integrations",
      label: "Email Integration",
      icon: Settings,
      onSelect: () => navigate("/settings?tab=integrations"),
      keywords: ["settings", "email", "smtp", "integration", "connect"],
    },
    {
      id: "settings-portal",
      label: "Client Portal",
      icon: Settings,
      onSelect: () => navigate("/settings?tab=portal"),
      keywords: ["settings", "portal", "branding", "client", "customer"],
    },
    {
      id: "settings-templates",
      label: "Document Templates",
      icon: Settings,
      onSelect: () => navigate("/settings?tab=templates"),
      keywords: ["settings", "templates", "documents", "proposals", "contracts"],
    },
    {
      id: "settings-accounting",
      label: "Accounting Integration",
      icon: Settings,
      onSelect: () => navigate("/settings?tab=accounting"),
      keywords: ["settings", "quickbooks", "xero", "accounting", "finance"],
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
  ];

  const systemActions: CommandAction[] = [
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
        document.cookie = "ops-auth-token=; path=/; max-age=0";
        document.cookie = "__session=; path=/; max-age=0";
        useSetupStore.getState().reset();
        useAuthStore.getState().logout();
        signOut().catch(() => {});
        window.location.href = "/login";
      },
      keywords: ["logout", "exit"],
    },
  ];

  return (
    <CommandDialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setSearch(""); }}>
      <CommandInput
        placeholder="Search projects, clients, tasks, or commands..."
        onClear={() => setOpen(false)}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>
          <div className="flex flex-col items-center gap-1 py-2">
            <Search className="w-[24px] h-[24px] text-text-disabled" />
            <span>No results found</span>
            <span className="text-[11px] text-text-disabled">
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
                    value={`project ${p.title} ${p.address ?? ""}`}
                    onSelect={() => navigate(`/projects/${p.id}`)}
                  >
                    <FolderKanban className="w-[16px] h-[16px] text-text-tertiary" />
                    <span className="truncate">{p.title}</span>
                    {p.address && (
                      <span className="ml-auto text-[11px] text-text-disabled truncate max-w-[180px]">
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
                    onSelect={() => navigate(`/clients/${c.id}`)}
                  >
                    <Users className="w-[16px] h-[16px] text-text-tertiary" />
                    <span className="truncate">{c.name}</span>
                    {c.email && (
                      <span className="ml-auto text-[11px] text-text-disabled truncate max-w-[180px]">
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
                    onSelect={() => navigate(`/projects/${t.projectId}`)}
                  >
                    <ClipboardList className="w-[16px] h-[16px] text-text-tertiary" />
                    <span className="truncate">{t.customTitle || "Untitled Task"}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading="Quick Actions">
          {quickActions.map((action) => (
            <CommandItem
              key={action.id}
              value={[action.label, ...(action.keywords || [])].join(" ")}
              onSelect={action.onSelect}
            >
              <action.icon className="w-[16px] h-[16px] text-text-tertiary" />
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
              <action.icon className="w-[16px] h-[16px] text-text-tertiary" />
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
              <action.icon className="w-[16px] h-[16px] text-text-tertiary" />
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
              <action.icon className="w-[16px] h-[16px] text-text-tertiary" />
              <span>{action.label}</span>
              {action.shortcut && (
                <CommandShortcut>{action.shortcut}</CommandShortcut>
              )}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>

      {/* Footer */}
      <div className="flex items-center justify-between px-2 py-1 border-t border-border text-text-disabled">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-[4px]">
            <kbd className="font-mono text-[10px] px-[4px] py-[1px] rounded bg-background-elevated border border-border-subtle">
              &uarr;
            </kbd>
            <kbd className="font-mono text-[10px] px-[4px] py-[1px] rounded bg-background-elevated border border-border-subtle">
              &darr;
            </kbd>
            <span className="font-kosugi text-[10px]">Navigate</span>
          </div>
          <div className="flex items-center gap-[4px]">
            <kbd className="font-mono text-[10px] px-[4px] py-[1px] rounded bg-background-elevated border border-border-subtle">
              &crarr;
            </kbd>
            <span className="font-kosugi text-[10px]">Select</span>
          </div>
          <div className="flex items-center gap-[4px]">
            <kbd className="font-mono text-[10px] px-[6px] py-[1px] rounded bg-background-elevated border border-border-subtle">
              Esc
            </kbd>
            <span className="font-kosugi text-[10px]">Close</span>
          </div>
        </div>
        <span className="font-mono text-[10px] text-ops-accent">OPS v1.0</span>
      </div>
    </CommandDialog>
  );
}
