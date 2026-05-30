// @template-version: 1.1.0
import * as React from "react";
import { PlainTextLayout } from "@/lib/email/react/primitives/PlainTextLayout";

/**
 * Behavior-triggered re-engagement send. Fires once per trial when the
 * operator has gone silent for 6+ consecutive calendar days, between
 * that age and Day 14. Sent from JACK. daysSinceSignup and
 * daysSinceLastActivity are both computed (never hardcoded) and run
 * through formatDays for pluralization.
 *
 * @template-version 1.1.0
 */
export interface LostYouProps {
  firstName: string | null;
  daysSinceSignup: number;
  daysSinceLastActivity: number;
  unsubscribeUrl: string;
}

function formatDays(n: number): string {
  if (n === 1) return "a day";
  return `${n} days`;
}

export function LostYou({
  firstName,
  daysSinceSignup,
  daysSinceLastActivity,
  unsubscribeUrl,
}: LostYouProps) {
  const greeting = firstName ? `Hey ${firstName},` : "Hey there,";
  const gapLine = `You signed up ${formatDays(
    daysSinceSignup,
  )} ago, then dropped off. It's been ${formatDays(daysSinceLastActivity)}.`;
  return (
    <PlainTextLayout unsubscribeUrl={unsubscribeUrl}>
      {greeting}
      {"\n\n"}
      Jack here — I built OPS.
      {"\n\n"}
      {gapLine}
      {"\n\n"}
      I'm not here to nag. I want the real reason: did something trip you up, or is the timing just off?
      {"\n\n"}
      If you got stuck, tell me where. I've seen most of the walls operators hit in the first two weeks, and there's usually one move that clears it.
      {"\n\n"}
      If OPS isn't the fit, no hard feelings — just tell me what you were hoping it'd do.
      {"\n\n"}
      You can reply here, this is my personal email.
      {"\n\n"}
      — Jack
    </PlainTextLayout>
  );
}

export const previewProps: LostYouProps = {
  firstName: "Jackson",
  daysSinceSignup: 8,
  daysSinceLastActivity: 6,
  unsubscribeUrl: "https://app.opsapp.co/api/email/unsubscribe?t=preview",
};
