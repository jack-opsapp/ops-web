"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useLocale, useDictionary } from "@/i18n/client";

interface PortalHeaderProps {
  companyName: string;
  logoUrl: string | null;
  unreadMessages: number;
}

export function PortalHeader({ companyName, logoUrl, unreadMessages }: PortalHeaderProps) {
  const pathname = usePathname();
  const { locale, setLocale } = useLocale();
  const { t } = useDictionary("portal");

  const navLinks = [
    { href: "/portal/home", label: t("nav.home"), icon: Home },
    { href: "/portal/messages", label: t("nav.messages"), icon: MessageSquare },
  ];

  return (
    <header
      style={{
        backgroundColor: "var(--portal-card)",
        borderBottom: "1px solid var(--portal-border)",
      }}
      className="sticky top-0 z-40"
    >
      <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
        {/* Logo / Company Name */}
        <Link href="/portal/home" className="flex items-center gap-3">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={companyName}
              className="h-8 max-w-[160px] object-contain"
            />
          ) : (
            <span
              style={{
                fontFamily: "var(--portal-heading-font)",
                fontWeight: "var(--portal-heading-weight)",
                textTransform: "var(--portal-heading-transform)" as React.CSSProperties["textTransform"],
              }}
              className="text-lg"
            >
              {companyName}
            </span>
          )}
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden sm:flex items-center gap-1">
          {navLinks.map((link) => {
            const isActive = pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
                  isActive
                    ? "bg-[var(--portal-accent)] text-white"
                    : "hover:bg-[var(--portal-bg-secondary)]"
                )}
                style={{
                  color: isActive ? "var(--portal-accent-text)" : "var(--portal-text-secondary)",
                }}
              >
                <link.icon className="w-4 h-4" />
                <span>{link.label}</span>
                {link.href === "/portal/messages" && unreadMessages > 0 && (
                  <span
                    className="ml-1 px-1.5 py-0.5 rounded-full text-xs font-medium text-white"
                    style={{ backgroundColor: "var(--portal-error)" }}
                  >
                    {unreadMessages}
                  </span>
                )}
              </Link>
            );
          })}
          <div
            className="ml-2 flex items-center rounded-lg text-xs"
            style={{ borderColor: "var(--portal-border)" }}
          >
            <button
              onClick={() => locale !== "en" && setLocale("en")}
              className={cn(
                "px-2 py-1 rounded-l-lg border transition-colors",
                locale === "en"
                  ? "bg-[var(--portal-accent)] text-white border-[var(--portal-accent)]"
                  : "border-[var(--portal-border)]"
              )}
              style={{ color: locale !== "en" ? "var(--portal-text-secondary)" : undefined }}
            >
              {t("toggle.en")}
            </button>
            <button
              onClick={() => locale !== "es" && setLocale("es")}
              className={cn(
                "px-2 py-1 rounded-r-lg border border-l-0 transition-colors",
                locale === "es"
                  ? "bg-[var(--portal-accent)] text-white border-[var(--portal-accent)]"
                  : "border-[var(--portal-border)]"
              )}
              style={{ color: locale !== "es" ? "var(--portal-text-secondary)" : undefined }}
            >
              {t("toggle.es")}
            </button>
          </div>
        </nav>
      </div>
    </header>
  );
}
