import type { Metadata, Viewport } from "next";
import "@/styles/globals.css";
import { Providers } from "./providers";
import { Toaster } from "@/components/ui/toast";

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
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-text-primary font-mohave antialiased">
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
