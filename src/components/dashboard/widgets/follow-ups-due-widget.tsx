"use client";

import { CalendarCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FollowUpsDueWidgetProps {
  size: WidgetSize;
}

// ---------------------------------------------------------------------------
// Component (placeholder — useFollowUps not available as standalone hook)
// ---------------------------------------------------------------------------

export function FollowUpsDueWidget({ size }: FollowUpsDueWidgetProps) {
  // ── SM: Placeholder count ─────────────────────────────────────────────
  if (size === "sm") {
    return (
      <Card className="p-2 h-full flex flex-col">
        <CardHeader className="pb-1 shrink-0">
          <CardTitle className="text-card-subtitle">Follow-ups</CardTitle>
        </CardHeader>
        <CardContent className="py-0 flex-1 overflow-hidden min-h-0">
          <div className="flex flex-col gap-0.5">
            <span className="font-mohave text-[24px] leading-none text-text-disabled font-medium">
              0
            </span>
            <span className="font-mono text-[11px] text-text-disabled">
              follow-ups due
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── MD: Placeholder message ───────────────────────────────────────────
  return (
    <Card className="p-2 h-full flex flex-col">
      <CardHeader className="pb-1.5 shrink-0">
        <CardTitle className="text-card-subtitle">Follow-ups Due</CardTitle>
      </CardHeader>
      <CardContent className="py-0 flex-1 overflow-hidden min-h-0">
        <div className="flex flex-col items-center justify-center py-8 gap-2">
          <CalendarCheck className="w-[20px] h-[20px] text-text-disabled" />
          <p className="font-mohave text-body-sm text-text-disabled text-center">
            Follow-up tracking coming soon
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
