"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils/cn";

interface DebugRegion {
  id: string;
  label: string;
  left: number;
  top: number;
  width: number;
  height: number;
  kind?: "manual" | "component";
}

const DEBUG_SELECTOR = "[data-inbox-debug-id][data-inbox-debug-label]";

function isDebugEnabled() {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return (
    params.get("debugInbox") === "1" ||
    window.localStorage.getItem("opsInboxDebugLabels") === "1"
  );
}

function pushVisible(regions: DebugRegion[], region: DebugRegion) {
  if (region.width < 8 || region.height < 8) return;
  regions.push(region);
}

function getManualRegions(): DebugRegion[] {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const sidebarWidth = width >= 768 ? 72 : 0;
  const topbarHeight = 56;
  const edgeRailWidth = 48;
  const regions: DebugRegion[] = [];

  if (sidebarWidth > 0) {
    pushVisible(regions, {
      id: "A0",
      label: "APP NAV",
      left: 0,
      top: 0,
      width: sidebarWidth,
      height,
      kind: "manual",
    });
  }

  pushVisible(regions, {
    id: "A1",
    label: "GLOBAL TOP BAR",
    left: sidebarWidth,
    top: 0,
    width: Math.max(0, width - sidebarWidth),
    height: topbarHeight,
    kind: "manual",
  });

  if (width >= 1024) {
    pushVisible(regions, {
      id: "E0",
      label: "RIGHT EDGE TABS",
      left: Math.max(0, width - edgeRailWidth),
      top: 252,
      width: edgeRailWidth,
      height: Math.max(0, height - 276),
      kind: "manual",
    });
  }

  return regions;
}

function collectRegions(): DebugRegion[] {
  const regions = getManualRegions();
  const elements = Array.from(
    document.querySelectorAll<HTMLElement>(DEBUG_SELECTOR)
  );

  for (const element of elements) {
    const rect = element.getBoundingClientRect();
    pushVisible(regions, {
      id: element.dataset.inboxDebugId ?? "",
      label: element.dataset.inboxDebugLabel ?? "",
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      kind: "component",
    });
  }

  return regions.sort((a, b) => a.top - b.top || a.left - b.left);
}

export function InboxDebugLabels() {
  const [enabled, setEnabled] = useState(false);
  const [regions, setRegions] = useState<DebugRegion[]>([]);

  useEffect(() => {
    setEnabled(isDebugEnabled());
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let frame = 0;
    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        setRegions(collectRegions());
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const interval = window.setInterval(measure, 500);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      window.clearInterval(interval);
    };
  }, [enabled]);

  if (!enabled || process.env.NODE_ENV === "production") return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-emergency"
    >
      {regions.map((region) => {
        const isManual = region.kind === "manual";
        return (
          <div
            key={`${region.id}-${region.left}-${region.top}`}
            className={cn(
              "absolute border bg-transparent",
              isManual ? "border-tan/70" : "border-ops-accent/80"
            )}
            style={{
              left: region.left,
              top: region.top,
              width: region.width,
              height: region.height,
            }}
          >
            <div
              className={cn(
                "absolute left-0 top-0 max-w-[260px] border bg-background px-1.5 py-0.5",
                "font-mono text-micro uppercase leading-none tracking-[0.14em]",
                isManual
                  ? "border-tan/70 text-tan"
                  : "border-ops-accent/80 text-ops-accent"
              )}
            >
              {region.id} · {region.label}
            </div>
          </div>
        );
      })}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 border border-line bg-background px-2 py-1 font-mono text-micro uppercase tracking-[0.14em] text-text-2">
        INBOX DEBUG LABELS · ?debugInbox=1
      </div>
    </div>
  );
}
