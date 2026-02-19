"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface PortalNavProps {
  unreadMessages: number;
}

const navItems = [
  { href: "/portal/home", label: "Home", icon: Home },
  { href: "/portal/messages", label: "Messages", icon: MessageSquare },
];

/**
 * Mobile bottom tab bar for the portal.
 */
export function PortalNav({ unreadMessages }: PortalNavProps) {
  const pathname = usePathname();

  return (
    <nav
      style={{
        backgroundColor: "var(--portal-card)",
        borderTop: "1px solid var(--portal-border)",
      }}
      className="sm:hidden fixed bottom-0 left-0 right-0 z-40"
    >
      <div className="flex items-center justify-around h-14">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center gap-0.5 px-4 py-1 relative",
                "transition-colors"
              )}
              style={{
                color: isActive ? "var(--portal-accent)" : "var(--portal-text-tertiary)",
              }}
            >
              <item.icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
              {item.href === "/portal/messages" && unreadMessages > 0 && (
                <span
                  className="absolute -top-0.5 right-2 w-4 h-4 rounded-full text-[10px] font-medium text-white flex items-center justify-center"
                  style={{ backgroundColor: "var(--portal-error)" }}
                >
                  {unreadMessages > 9 ? "9+" : unreadMessages}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
