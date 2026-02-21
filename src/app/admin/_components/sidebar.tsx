import { SidebarNavItem } from "./sidebar-nav-item";

const NAV_ITEMS = [
  { href: "/admin", label: "OVERVIEW" },
  { href: "/admin/companies", label: "COMPANIES" },
  { href: "/admin/analytics", label: "ANALYTICS" },
  { href: "/admin/subscriptions", label: "SUBSCRIPTIONS" },
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
