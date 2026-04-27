import type { Metadata } from "next";

/**
 * Per-project Smart App Banner metadata.
 *
 * iOS Safari inspects `apple-itunes-app` on every page load. When a visitor
 * has the OPS app installed, the banner shows an "OPEN" button that, when
 * tapped, launches the app with the `app-argument` value passed through as
 * the URL context. When the app isn't installed, the banner shows "VIEW"
 * which sends the user to the App Store; after install + reopen, Safari
 * re-evaluates the banner and the next tap carries the app-argument.
 *
 * Without a per-page `app-argument`, a Safari-intercepted link (AASA not
 * cached yet, long-pressed "Open in Safari", or the user tapped the
 * Smart App Banner rather than the Universal Link proper) drops the
 * project context and launches the app with no navigation intent.
 *
 * The root layout provides a generic `apple-itunes-app` tag without an
 * argument as a fallback for routes that don't need one; this file
 * overrides it for `/projects/[id]` so tapped links always carry the
 * project ID across the Safari -> App Store -> app boundary.
 */

const IOS_APP_ID = "6746662078";
const APP_UNIVERSAL_LINK_BASE = "https://app.opsapp.co";

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> }
): Promise<Metadata> {
  const { id } = await params;
  const appArgument = `${APP_UNIVERSAL_LINK_BASE}/projects/${encodeURIComponent(id)}`;

  return {
    other: {
      "apple-itunes-app": `app-id=${IOS_APP_ID}, app-argument=${appArgument}`,
    },
  };
}

export default function ProjectDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
