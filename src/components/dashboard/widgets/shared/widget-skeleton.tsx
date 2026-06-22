"use client";

import { cn } from "@/lib/utils/cn";

type SkeletonVariant = "stat" | "bar-chart" | "horizontal-bars" | "list" | "ring" | "funnel" | "timeline";

interface WidgetSkeletonProps {
  variant: SkeletonVariant;
  className?: string;
}

const shimmerClass = "animate-pulse bg-fill-neutral-dim";

export function WidgetSkeleton({ variant, className }: WidgetSkeletonProps) {
  return (
    <div className={cn("w-full h-full flex flex-col", className)}>
      {variant === "stat" && <StatSkeleton />}
      {variant === "bar-chart" && <BarChartSkeleton />}
      {variant === "horizontal-bars" && <HorizontalBarsSkeleton />}
      {variant === "list" && <ListSkeleton />}
      {variant === "ring" && <RingSkeleton />}
      {variant === "funnel" && <FunnelSkeleton />}
      {variant === "timeline" && <TimelineSkeleton />}
    </div>
  );
}

function StatSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-2">
      <div className={cn(shimmerClass, "h-[10px] w-[60px] rounded-sm")} />
      <div className={cn(shimmerClass, "h-[28px] w-[100px] rounded-sm")} />
      <div className={cn(shimmerClass, "h-[10px] w-[80px] rounded-sm")} />
    </div>
  );
}

function BarChartSkeleton() {
  return (
    <div className="flex items-end gap-[6px] h-[80px] px-2 pt-6">
      {[40, 65, 55, 80, 45, 70, 30, 60, 50, 75, 35, 55].map((h, i) => (
        <div key={i} className={cn(shimmerClass, "flex-1 rounded-t-sm")} style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}

function HorizontalBarsSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-2 pt-6">
      {[85, 65, 45, 30, 20].map((w, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className={cn(shimmerClass, "h-[8px] rounded-full")} style={{ width: `${w}%` }} />
          <div className={cn(shimmerClass, "h-[10px] w-[40px] rounded-sm shrink-0")} />
        </div>
      ))}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-[6px] p-2 pt-6">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-2">
          <div className={cn(shimmerClass, "w-[24px] h-[24px] rounded-full shrink-0")} />
          <div className="flex-1 flex flex-col gap-1">
            <div className={cn(shimmerClass, "h-[12px] w-[70%] rounded-sm")} />
            <div className={cn(shimmerClass, "h-[10px] w-[40%] rounded-sm")} />
          </div>
          <div className={cn(shimmerClass, "h-[12px] w-[50px] rounded-sm shrink-0")} />
        </div>
      ))}
    </div>
  );
}

function RingSkeleton() {
  return (
    <div className="flex items-center justify-center p-4">
      <div className={cn(shimmerClass, "w-[60px] h-[60px] rounded-full border-[6px] border-[rgba(255,255,255,0.06)]")} style={{ background: "transparent" }} />
    </div>
  );
}

function FunnelSkeleton() {
  return (
    <div className="flex flex-col items-center gap-[3px] p-2 pt-6">
      {[100, 80, 60, 45].map((w, i) => (
        <div key={i} className={cn(shimmerClass, "h-[16px] rounded-sm")} style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div className="flex gap-2 p-2 pt-6 h-full">
      <div className="flex flex-col gap-3 shrink-0">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className={cn(shimmerClass, "h-[10px] w-[32px] rounded-sm")} />
        ))}
      </div>
      <div className={cn(shimmerClass, "w-[1px] shrink-0")} />
      <div className="flex-1 flex flex-col gap-2">
        {[60, 40, 30].map((h, i) => (
          <div key={i} className={cn(shimmerClass, "w-full rounded-sm")} style={{ height: `${h}px` }} />
        ))}
      </div>
    </div>
  );
}
