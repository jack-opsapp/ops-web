import { SidebarNavItem } from "./sidebar-nav-item";

const NAV_ITEMS = [
  { href: "/admin", label: "OVERVIEW" },
  { href: "/admin/acquisition", label: "ACQUISITION" },
  { href: "/admin/companies", label: "COMPANIES" },
  { href: "/admin/engagement", label: "ENGAGEMENT" },
  { href: "/admin/revenue", label: "REVENUE" },
  { href: "/admin/platform-health", label: "PLATFORM HEALTH" },
  { href: "/admin/feedback", label: "FEEDBACK" },
  { href: "/admin/system", label: "SYSTEM" },
];

export function AdminSidebar() {
  return (
    <aside className="w-[220px] min-h-screen flex-shrink-0 border-r border-white/[0.08] flex flex-col">
      <div className="px-6 py-8">
        <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B]">
          OPS ADMIN
        </p>
      </div>
      <nav className="flex flex-col">
        {NAV_ITEMS.map((item) => (
          <SidebarNavItem key={item.href} href={item.href} label={item.label} />
        ))}
      </nav>
    </aside>
  );
}
