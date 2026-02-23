"use client";

import { AlertTriangle, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface AlertsWidgetProps {
  activeProjectCount: number;
  weekEventCount: number;
  teamMemberCount: number;
  isDataLoading: boolean;
  onNavigate: (path: string) => void;
}

export function AlertsWidget({
  activeProjectCount,
  weekEventCount,
  teamMemberCount,
  isDataLoading,
  onNavigate,
}: AlertsWidgetProps) {
  return (
    <Card variant="accent">
      <CardContent className="p-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="w-[20px] h-[20px] text-text-secondary shrink-0" />
            <div>
              <p className="font-mohave text-body text-text-primary">System alerts</p>
              <p className="font-kosugi text-[11px] text-text-tertiary">
                {isDataLoading
                  ? "Loading your data..."
                  : `${activeProjectCount} active projects, ${weekEventCount} events this week, ${teamMemberCount} team members`}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 gap-[4px]"
            onClick={() => onNavigate("/projects")}
          >
            View All
            <ArrowRight className="w-[14px] h-[14px]" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
