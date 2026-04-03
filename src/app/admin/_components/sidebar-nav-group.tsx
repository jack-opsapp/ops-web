"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";

interface NavGroupItem {
  href: string;
  label: string;
}

interface SidebarNavGroupProps {
  label: string;
  prefix: string;
  items: NavGroupItem[];
}

export function SidebarNavGroup({ label, prefix, items }: SidebarNavGroupProps) {
  const pathname = usePathname();
  const isGroupActive = pathname.startsWith(prefix);
  const [open, setOpen] = useState(isGroupActive);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className={[
          "flex items-center justify-between w-full h-14 px-6 relative",
          "font-mohave text-[13px] uppercase tracking-widest transition-colors",
          isGroupActive ? "text-[#E5E5E5]" : "text-[#6B6B6B] hover:text-[#A0A0A0]",
        ].join(" ")}
      >
        {isGroupActive && (
          <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-[#597794]" />
        )}
        {label}
        <ChevronDown
          size={12}
          className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="flex flex-col">
          {items.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href === prefix && pathname.startsWith(`${prefix}/products`));

            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "flex items-center h-10 pl-10 pr-6 relative",
                  "font-mohave text-[12px] uppercase tracking-widest transition-colors",
                  isActive ? "text-[#E5E5E5]" : "text-[#6B6B6B] hover:text-[#A0A0A0]",
                ].join(" ")}
              >
                {isActive && (
                  <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-[#597794]/50" />
                )}
                {item.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
