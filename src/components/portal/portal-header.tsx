"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, FolderOpen, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useLocale, useDictionary } from "@/i18n/client";

interface PortalHeaderProps {
  companyName: string;
  logoUrl: string | null;
  hasUnread: boolean;
  activeTab: "home" | "project" | "messages";
  projectHref: string;
}

export function PortalHeader({
  companyName,
  logoUrl,
  hasUnread,
  activeTab,
  projectHref,
}: PortalHeaderProps) {
  const pathname = usePathname();
  const { locale, setLocale } = useLocale();
  const { t } = useDictionary("portal");

  const navLinks = [
    { key: "home" as const, href: "/portal/home", label: t("nav.home"), icon: Home },
    { key: "project" as const, href: projectHref, label: t("nav.project"), icon: FolderOpen },
    { key: "messages" as const, href: "/portal/messages", label: t("nav.messages"), icon: MessageSquare },
  ];

  // Determine active tab from pathname if not explicitly set
  const resolvedActive =
    pathname.startsWith("/portal/projects") ? "project"
    : pathname.startsWith("/portal/messages") ? "messages"
    : activeTab;

  // Determine header background based on --portal-header-style
  const headerBg =
    "var(--portal-header-style)" === "accent"
      ? "var(--portal-accent)"
      : "var(--portal-header-style)" === "solid"
        ? "var(--portal-card)"
        : "transparent";

  return (
    <header
      style={{
        borderBottom: "var(--portal-header-border)",
      }}
      className={cn(
        "sticky top-0 z-40",
        // Use portal-card for solid/transparent, accent for accent header
        // We use a data attribute to style conditionally
      )}
      data-header-style="true"
    >
      {/* Background layer - uses CSS var for the actual style */}
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: "var(--portal-card)",
        }}
      />
      <div className="relative max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Logo / Company Name */}
        <Link href="/portal/home" className="flex items-center gap-3">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={companyName}
              className="h-8 max-w-[140px] object-contain"
            />
          ) : null}
          <span
            style={{
              fontFamily: "var(--portal-heading-font)",
              fontWeight: "var(--portal-heading-weight)",
              textTransform: "var(--portal-heading-transform)" as React.CSSProperties["textTransform"],
              letterSpacing: "var(--portal-letter-spacing)",
              color: "var(--portal-text)",
            }}
            className="text-base"
          >
            {companyName}
          </span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-1">
          {navLinks.map((link) => {
            const isActive = link.key === resolvedActive;
            return (
              <Link
                key={link.key}
                href={link.href}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 text-sm transition-colors relative",
                )}
                style={{
                  color: isActive ? "var(--portal-accent)" : "var(--portal-text-secondary)",
                }}
              >
                <link.icon className="w-4 h-4" />
                <span>{link.label}</span>
                {link.key === "messages" && hasUnread && (
                  <span
                    className="w-2 h-2 rounded-full ml-1"
                    style={{ backgroundColor: "var(--portal-accent)" }}
                  />
                )}
                {/* Active underline */}
                {isActive && (
                  <span
                    className="absolute bottom-0 left-3 right-3 h-0.5"
                    style={{ backgroundColor: "var(--portal-accent)" }}
                  />
                )}
              </Link>
            );
          })}

          {/* Language toggle */}
          <div
            className="ml-3 flex items-center rounded text-xs"
            style={{ borderColor: "var(--portal-border)" }}
          >
            <button
              onClick={() => locale !== "en" && setLocale("en")}
              className={cn(
                "px-2 py-1 rounded-l border transition-colors",
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
                "px-2 py-1 rounded-r border border-l-0 transition-colors",
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

        {/* Mobile: unread dot */}
        <div className="md:hidden flex items-center">
          {hasUnread && (
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: "var(--portal-accent)" }}
            />
          )}
        </div>
      </div>
    </header>
  );
}
