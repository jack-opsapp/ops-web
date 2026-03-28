/**
 * Root layout for the portal route group.
 * No sidebar, no dashboard chrome — standalone branded experience.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Client Portal | OPS",
  description: "View your projects, estimates, and invoices",
};

export default function PortalGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
