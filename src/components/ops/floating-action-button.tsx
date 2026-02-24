"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  X,
  FolderKanban,
  Users,
  Receipt,
  Calculator,
  ClipboardList,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useWindowStore } from "@/stores/window-store";

interface FABAction {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
}

export function FloatingActionButton() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const openWindow = useWindowStore((s) => s.openWindow);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open]);

  const actions: FABAction[] = [
    {
      id: "project",
      label: "New Project",
      icon: FolderKanban,
      onClick: () => {
        openWindow({ id: "create-project", title: "New Project", type: "create-project" });
        setOpen(false);
      },
    },
    {
      id: "client",
      label: "New Client",
      icon: Users,
      onClick: () => {
        openWindow({ id: "create-client", title: "New Client", type: "create-client" });
        setOpen(false);
      },
    },
    {
      id: "task",
      label: "New Task",
      icon: ClipboardList,
      onClick: () => {
        openWindow({ id: "create-task", title: "New Task", type: "create-task" });
        setOpen(false);
      },
    },
    {
      id: "estimate",
      label: "New Estimate",
      icon: Calculator,
      onClick: () => {
        router.push("/estimates?action=new");
        setOpen(false);
      },
    },
    {
      id: "invoice",
      label: "New Invoice",
      icon: Receipt,
      onClick: () => {
        router.push("/invoices?action=new");
        setOpen(false);
      },
    },
  ];

  return (
    <div ref={containerRef} className="fixed bottom-3 right-14 z-[95]">
      {/* Action items — slide up from FAB */}
      <div
        className={cn(
          "absolute bottom-[52px] right-0 flex flex-col gap-[6px] transition-all duration-200",
          open
            ? "opacity-100 translate-y-0 pointer-events-auto"
            : "opacity-0 translate-y-2 pointer-events-none"
        )}
      >
        {actions.map((action, i) => (
          <button
            key={action.id}
            onClick={action.onClick}
            className={cn(
              "flex items-center gap-1.5 pl-1.5 pr-2 py-[8px] rounded-lg",
              "bg-background-elevated border border-border",
              "hover:bg-[rgba(255,255,255,0.08)] hover:border-border-medium",
              "transition-all duration-150 whitespace-nowrap",
              "shadow-[0_2px_8px_rgba(0,0,0,0.3)]"
            )}
            style={{
              transitionDelay: open ? `${i * 30}ms` : "0ms",
            }}
          >
            <action.icon className="w-[16px] h-[16px] text-ops-accent shrink-0" />
            <span className="font-mohave text-body-sm text-text-primary">{action.label}</span>
          </button>
        ))}
      </div>

      {/* FAB button */}
      <button
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "w-[44px] h-[44px] rounded-full flex items-center justify-center",
          "bg-ops-accent hover:bg-ops-accent-hover",
          "shadow-[0_2px_12px_rgba(65,115,148,0.4)]",
          "transition-all duration-200",
          open && "rotate-45"
        )}
        title="Quick actions"
      >
        {open ? (
          <X className="w-[20px] h-[20px] text-white" />
        ) : (
          <Plus className="w-[20px] h-[20px] text-white" />
        )}
      </button>
    </div>
  );
}
