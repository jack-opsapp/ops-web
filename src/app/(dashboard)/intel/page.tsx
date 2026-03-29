"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";
// GalaxyScene is lazy-loaded — Three.js (~150KB) must not be in the critical path
const GalaxyScene = dynamic(
  () => import("@/components/intel/galaxy-scene").then((m) => m.GalaxyScene),
  { ssr: false }
);

export default function IntelPage() {
  const sidebarWidth = 72;

  return (
    <div
      className="fixed top-0 bottom-0 right-0 bg-[#0A0A0A] z-[96]"
      style={{ left: sidebarWidth }}
    >
      <Suspense fallback={<div className="w-full h-full bg-[#0A0A0A]" />}>
        <GalaxyScene />
      </Suspense>
    </div>
  );
}
