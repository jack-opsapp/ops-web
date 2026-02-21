"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface SidebarNavItemProps {
  href: string;
  label: string;
}

export function SidebarNavItem({ href, label }: SidebarNavItemProps) {
  const pathname = usePathname();
  const isActive = pathname === href || (href !== "/admin" && pathname.startsWith(href));

  return (
    <Link
      href={href}
      className={[
        "flex items-center h-14 px-6 relative",
        "font-mohave text-[13px] uppercase tracking-widest transition-colors",
        isActive
          ? "text-[#E5E5E5]"
          : "text-[#6B6B6B] hover:text-[#A0A0A0]",
      ].join(" ")}
    >
      {isActive && (
        <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-[#597794]" />
      )}
      {label}
    </Link>
  );
}
