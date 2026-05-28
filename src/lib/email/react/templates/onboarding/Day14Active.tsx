import * as React from "react";
import { PlainTextLayout } from "@/lib/email/react/primitives/PlainTextLayout";

/**
 * Day 14 Branch B — fires when the operator has had activity in the
 * last 7 days. Sent from JACK. Body has TWO variants depending on
 * whether stats sum >= 5:
 *   - High-activity variant: shows live counts
 *   - Low-activity variant: drops the surveillance-y tiny numbers
 *     and uses qualitative copy instead
 *
 * Threshold logic per spec decision log #23.
 *
 * @template-version 1.0.0
 */
export interface Day14ActiveProps {
  firstName: string | null;
  projectCount: number;
  taskCount: number;
  notificationCount: number;
  unsubscribeUrl: string;
}

const STATS_THRESHOLD = 5;

function pluralize(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

export function Day14Active({
  firstName,
  projectCount,
  taskCount,
  notificationCount,
  unsubscribeUrl,
}: Day14ActiveProps) {
  const greeting = firstName ? `Hey there ${firstName},` : "Hey there,";
  const sum = projectCount + taskCount + notificationCount;
  const showStats = sum >= STATS_THRESHOLD;

  const statsLine = showStats
    ? `Day 14. You're running OPS — ${projectCount} ${pluralize(
        projectCount, "project", "projects",
      )}, ${taskCount} ${pluralize(
        taskCount, "task", "tasks",
      )} assigned, ${notificationCount} completion ${pluralize(
        notificationCount, "notification", "notifications",
      )} that have landed on your phone.`
    : `Day 14. You're moving in OPS.`;

  return (
    <PlainTextLayout unsubscribeUrl={unsubscribeUrl}>
      {greeting}
      {"\n\n"}
      Jack here.
      {"\n\n"}
      {statsLine}
      {"\n\n"}
      I want to know two things:
      {"\n\n"}
      &nbsp;&nbsp;1. What's working that you didn't expect?
      {"\n"}
      &nbsp;&nbsp;2. What's broken, missing, or in the way?
      {"\n\n"}
      Hit reply — goes to my inbox. One sentence per question is enough.
      {"\n\n"}
      The product gets better when operators tell me what's grinding their gears.
      {"\n\n"}
      — Jack
    </PlainTextLayout>
  );
}

export const previewProps: Day14ActiveProps = {
  firstName: "Jackson",
  projectCount: 4,
  taskCount: 12,
  notificationCount: 6,
  unsubscribeUrl: "https://app.opsapp.co/api/email/unsubscribe?t=preview",
};
