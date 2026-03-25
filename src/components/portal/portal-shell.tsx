"use client";

import { useEffect, useState } from "react";
import type { PortalBranding } from "@/lib/types/portal";
import { generatePortalTheme, themeVarsToStyle, getTemplateFontImports } from "@/lib/portal/theme";

interface PortalShellProps {
  branding: PortalBranding | null;
  children: React.ReactNode;
}

/**
 * Wraps portal content with theme CSS custom properties and font imports.
 * Applies all expanded skin vars from the new theme generator.
 */
export function PortalShell({ branding, children }: PortalShellProps) {
  const [fontLinks, setFontLinks] = useState<string[]>([]);

  const defaultBranding: PortalBranding = {
    id: "",
    companyId: "",
    logoUrl: null,
    accentColor: "#417394",
    template: "modern",
    themeMode: "dark",
    fontCombo: "modern",
    welcomeMessage: null,
    showQuantities: null,
    showUnitPrices: null,
    showLineTotals: null,
    showDescriptions: null,
    showTax: null,
    showDiscount: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const activeBranding = branding ?? defaultBranding;
  const themeVars = generatePortalTheme(activeBranding);
  const styleVars = themeVarsToStyle(themeVars);

  useEffect(() => {
    setFontLinks(getTemplateFontImports(activeBranding.template));
  }, [activeBranding.template]);

  return (
    <>
      {/* Font preloading for faster rendering */}
      {fontLinks.map((url) => (
        <link key={url} rel="preload" href={url} as="style" onLoad={(e) => {
          (e.target as HTMLLinkElement).rel = "stylesheet";
        }} />
      ))}
      {/* Fallback noscript stylesheet links */}
      <noscript>
        {fontLinks.map((url) => (
          <link key={url} rel="stylesheet" href={url} />
        ))}
      </noscript>
      <div
        style={styleVars}
        className="min-h-screen"
        data-portal-theme={activeBranding.themeMode}
      >
        <div
          style={{
            backgroundColor: "var(--portal-bg)",
            color: "var(--portal-text)",
            fontFamily: "var(--portal-body-font)",
          }}
          className="min-h-screen"
        >
          {children}
        </div>
      </div>
    </>
  );
}
