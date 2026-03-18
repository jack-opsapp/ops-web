"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";
import { useSidebarStore } from "@/stores/sidebar-store";

// GalaxyScene is lazy-loaded — Three.js (~150KB) must not be in the critical path
const GalaxyScene = dynamic(
  () => import("@/components/intel/galaxy-scene").then((m) => m.GalaxyScene),
  { ssr: false }
);

export default function IntelPage() {
  const isCollapsed = useSidebarStore((s) => s.isCollapsed);
  // Mirror the exact widths used by the Sidebar and DashboardLayout
  const sidebarWidth = isCollapsed ? 72 : 256;

  return (
    <div
      className="fixed top-0 bottom-0 right-0 bg-[#0A0A0A]"
      style={{ left: sidebarWidth }}
    >
      <Suspense fallback={<div className="w-full h-full bg-[#0A0A0A]" />}>
        <GalaxyScene />
      </Suspense>
    </div>
  );
}
