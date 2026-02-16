"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
  Moon,
  Keyboard,
  RefreshCw,
} from "lucide-react";
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
  const router = useRouter();

  // Toggle with Cmd+K / Ctrl+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
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
        // TODO: trigger manual sync
      },
      keywords: ["refresh", "update", "fetch"],
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
        // TODO: open shortcuts modal
      },
      keywords: ["help", "keys", "hotkeys"],
    },
    {
      id: "system-theme",
      label: "Toggle Theme",
      icon: Moon,
      onSelect: () => {
        setOpen(false);
        // TODO: toggle theme
      },
      keywords: ["dark", "light", "mode"],
    },
    {
      id: "system-logout",
      label: "Sign Out",
      icon: LogOut,
      onSelect: () => {
        setOpen(false);
        router.push("/login");
      },
      keywords: ["logout", "exit"],
    },
  ];

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Search commands, navigate, or take action..."
        onClear={() => setOpen(false)}
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
