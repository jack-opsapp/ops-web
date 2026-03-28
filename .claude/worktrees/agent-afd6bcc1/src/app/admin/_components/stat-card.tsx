"use client";

import Link from "next/link";
import { Sparkline } from "./sparkline";
import type { ChartDataPoint } from "@/lib/admin/types";

interface StatCardProps {
  label: string;
  value: string | number;
  caption?: string;
  accent?: boolean;
  danger?: boolean;
  trend?: { direction: "up" | "down" | "flat"; value: string };
  onClick?: () => void;
  href?: string;
  sparklineData?: ChartDataPoint[];
}

export function StatCard({
  label,
  value,
  caption,
  accent,
  danger,
  trend,
  onClick,
  href,
  sparklineData,
}: StatCardProps) {
  const valueColor = danger
    ? "text-[#93321A]"
    : accent
    ? "text-[#C4A868]"
    : "text-[#E5E5E5]";

  const isClickable = !!onClick || !!href;

  const content = (
    <div
      className={`border border-white/[0.08] rounded-lg p-6 bg-white/[0.02] transition-colors ${
        isClickable
          ? "hover:border-white/[0.12] hover:bg-white/[0.04] cursor-pointer"
          : ""
      }`}
      onClick={onClick}
    >
      <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-3">
        {label}
      </p>
      <div className="flex items-end gap-3">
        <p className={`font-mohave text-4xl font-semibold ${valueColor}`}>
          {value}
        </p>
        {trend && (
          <span
            className={`font-kosugi text-[12px] mb-1 ${
              trend.direction === "up"
                ? "text-[#9DB582]"
                : trend.direction === "down"
                ? "text-[#93321A]"
                : "text-[#6B6B6B]"
            }`}
          >
            {trend.direction === "up" ? "\u2191" : trend.direction === "down" ? "\u2193" : "\u2192"}{" "}
            {trend.value}
          </span>
        )}
      </div>
      {caption && (
        <p className="font-kosugi text-[12px] text-[#6B6B6B] mt-2">
          [{caption}]
        </p>
      )}
      {sparklineData && sparklineData.length > 0 && (
        <div className="mt-3">
          <Sparkline data={sparklineData} height={32} />
        </div>
      )}
    </div>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }

  return content;
}
