import type { Metadata, Viewport } from "next";
import "@/styles/globals.css";
import { Providers } from "./providers";
import { Toaster } from "@/components/ui/toast";
import { SignOutOverlay } from "@/components/ops/sign-out-overlay";
import { UtmCaptureEffect } from "@/components/pmf/utm-capture-effect";
import { DevBypassBanner } from "@/components/providers/dev-bypass-banner";
import { getLocale } from "@/i18n/server";

export const metadata: Metadata = {
  title: {
    default: "OPS",
    template: "%s | OPS",
  },
  description:
    "OPS - The all-in-one command center for trade businesses. Scheduling, invoicing, CRM, and accounting in one platform.",
  keywords: [
    "field service management",
    "trade business software",
    "contractor management",
    "scheduling software",
    "invoicing",
    "CRM",
  ],
  authors: [{ name: "OPS" }],
  creator: "OPS",
  manifest: "/manifest.json",
  // Color-scheme-aware SVG favicons via the metadata API. Browsers pick the
  // variant matching the user's system color scheme; the raster app/icon.png
  // / app/apple-icon.png / app/favicon.ico auto-convention files remain as
  // fallbacks for clients that don't honor the media attribute.
  icons: {
    icon: [
      { url: "/brand/icon-light.svg", media: "(prefers-color-scheme: light)", type: "image/svg+xml" },
      { url: "/brand/icon-dark.svg", media: "(prefers-color-scheme: dark)", type: "image/svg+xml" },
    ],
  },
  openGraph: {
    type: "website",
    siteName: "OPS",
    title: { default: "OPS", template: "%s | OPS" },
    description: "Operations software for trades.",
  },
  twitter: {
    card: "summary_large_image",
    title: { default: "OPS", template: "%s | OPS" },
    description: "Operations software for trades.",
  },
  // Smart App Banner — iOS Safari shows an "OPEN" / "VIEW" banner at the top
  // of the page when a visitor has (or lacks) the OPS app installed. Critical
  // for shared project links received by users who don't yet have the app —
  // without this, they land on the web dashboard with no install affordance.
  // The app-argument passes the current URL to the app on launch, mirroring
  // the Universal Link payload.
  other: {
    "apple-itunes-app": "app-id=6746662078",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#000000",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();

  return (
    <html lang={locale} className="dark" suppressHydrationWarning>
      <head>
        <link rel="stylesheet" href="https://use.typekit.net/dbh0pet.css" />
      </head>
      <body className="min-h-screen bg-background text-text font-mohave antialiased">
        <Providers locale={locale}>
          {children}
          <Toaster />
          <SignOutOverlay />
          <UtmCaptureEffect />
          <DevBypassBanner />
        </Providers>
      </body>
    </html>
  );
}
