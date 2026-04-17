import type { Metadata, Viewport } from "next";
import "@/styles/globals.css";
import { Providers } from "./providers";
import { Toaster } from "@/components/ui/toast";
import { SignOutOverlay } from "@/components/ops/sign-out-overlay";
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
        </Providers>
      </body>
    </html>
  );
}
