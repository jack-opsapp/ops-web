"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, FolderOpen, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";

interface PortalNavProps {
  hasUnread: boolean;
  projectHref: string;
}

/**
 * Mobile bottom tab bar for the portal. 3 tabs: Home, Project, Messages.
 * Only visible on mobile (hidden md:).
 */
export function PortalNav({ hasUnread, projectHref }: PortalNavProps) {
  const pathname = usePathname();
  const { t } = useDictionary("portal");

  const isProjectDisabled = projectHref === "/portal/home";

  const navItems = [
    { key: "home" as const, href: "/portal/home", label: t("nav.home"), icon: Home, disabled: false },
    { key: "project" as const, href: projectHref, label: t("nav.project"), icon: FolderOpen, disabled: isProjectDisabled },
    { key: "messages" as const, href: "/portal/messages", label: t("nav.messages"), icon: MessageSquare, disabled: false },
  ];

  const activeKey =
    pathname.startsWith("/portal/projects") ? "project"
    : pathname.startsWith("/portal/messages") ? "messages"
    : "home";

  return (
    <nav
      style={{
        backgroundColor: "var(--portal-card)",
        borderTop: "1px solid var(--portal-border)",
      }}
      className="md:hidden fixed bottom-0 left-0 right-0 z-40"
    >
      <div className="flex items-center justify-around h-14">
        {navItems.map((item) => {
          const isActive = item.key === activeKey;
          return (
            <Link
              key={item.key}
              href={item.disabled ? "#" : item.href}
              aria-disabled={item.disabled}
              className={cn(
                "flex flex-col items-center gap-0.5 px-4 py-1 relative",
                "transition-colors",
                item.disabled && "pointer-events-none"
              )}
              style={{
                color: item.disabled
                  ? "var(--portal-text-tertiary)"
                  : isActive
                    ? "var(--portal-accent)"
                    : "var(--portal-text-tertiary)",
                opacity: item.disabled ? 0.4 : 1,
              }}
            >
              <item.icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
              {item.key === "messages" && hasUnread && (
                <span
                  className="absolute top-0 right-2 w-2 h-2 rounded-full"
                  style={{ backgroundColor: "var(--portal-accent)" }}
                />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
