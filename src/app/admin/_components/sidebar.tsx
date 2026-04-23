import { SidebarNavItem } from "./sidebar-nav-item";

type NavEntry =
  | { type: "item"; href: string; label: string }
  | { type: "section"; label: string };

const NAV_ITEMS: NavEntry[] = [
  { type: "item", href: "/admin/pmf", label: "PMF" },
  { type: "item", href: "/admin", label: "OVERVIEW" },

  { type: "section", label: "GROWTH" },
  { type: "item", href: "/admin/acquisition", label: "ACQUISITION" },
  { type: "item", href: "/admin/google-ads", label: "GOOGLE ADS" },
  { type: "item", href: "/admin/ab-testing", label: "A/B TESTING" },
  { type: "item", href: "/admin/onboarding", label: "ONBOARDING" },

  { type: "section", label: "USERS" },
  { type: "item", href: "/admin/companies", label: "COMPANIES" },
  { type: "item", href: "/admin/engagement", label: "ENGAGEMENT" },
  { type: "item", href: "/admin/feedback", label: "FEEDBACK" },

  { type: "section", label: "ANALYTICS" },
  { type: "item", href: "/admin/app-analytics", label: "APP ANALYTICS" },
  { type: "item", href: "/admin/analytics", label: "ANALYTICS" },
  { type: "item", href: "/admin/revenue", label: "REVENUE" },
  { type: "item", href: "/admin/platform-health", label: "PLATFORM HEALTH" },

  { type: "section", label: "CONTENT" },
  { type: "item", href: "/admin/blog", label: "BLOG" },
  { type: "item", href: "/admin/email", label: "EMAIL" },
  { type: "item", href: "/admin/app-messages", label: "APP MESSAGES" },
  { type: "item", href: "/admin/feature-releases", label: "FEATURE RELEASES" },

  { type: "section", label: "PRODUCTS" },
  { type: "item", href: "/admin/learn", label: "OPS LEARN" },
  { type: "item", href: "/admin/shop", label: "SHOP" },

  { type: "section", label: "SYSTEM" },
  { type: "item", href: "/admin/system", label: "SYSTEM" },
];

export function AdminSidebar() {
  return (
    <aside className="w-[220px] min-h-screen flex-shrink-0 border-r border-white/[0.08] flex flex-col">
      <div className="px-6 py-8">
        <p className="font-mohave text-[13px] uppercase tracking-widest text-text-3">
          OPS ADMIN
        </p>
      </div>
      <nav className="flex flex-col">
        {NAV_ITEMS.map((entry, i) =>
          entry.type === "section" ? (
            <div
              key={`section-${i}`}
              className="px-6 pt-5 pb-1 font-mohave text-micro uppercase tracking-[0.18em] text-text-mute"
            >
              {entry.label}
            </div>
          ) : (
            <SidebarNavItem key={entry.href} href={entry.href} label={entry.label} />
          )
        )}
      </nav>
    </aside>
  );
}
