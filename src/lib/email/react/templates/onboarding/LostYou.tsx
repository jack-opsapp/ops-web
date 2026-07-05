// @template-version: 2.0.0
import * as React from "react";
import { PlainTextLayout } from "@/lib/email/react/primitives/PlainTextLayout";

/**
 * Behavior-triggered re-engagement send. Fires once per trial when the
 * operator has gone quiet for a full week — real inactivity gap >= 7 days,
 * computed in OnboardingDripService.processLostYouCandidate. Sent from JACK.
 *
 * The copy surfaces the real gap verbatim, so daysSinceLastActivity is the
 * one number the operator sees. It is always >= 7 and never larger than the
 * account age, which is what keeps the "you last opened OPS N days ago" line
 * true (bug a4882017 was the old two-number sentence going self-contradictory
 * — "signed up 1 day ago and haven't been back in 6 days").
 *
 * @template-version 2.0.0
 */
export interface LostYouProps {
  firstName: string | null;
  daysSinceLastActivity: number;
  unsubscribeUrl: string;
}

function formatDays(n: number): string {
  if (n === 1) return "a day";
  return `${n} days`;
}

export function LostYou({
  firstName,
  daysSinceLastActivity,
  unsubscribeUrl,
}: LostYouProps) {
  const greeting = firstName ? `Hey ${firstName},` : "Hey there,";
  const gapLine = `It's been ${formatDays(daysSinceLastActivity)} since you last opened OPS.`;
  return (
    <PlainTextLayout unsubscribeUrl={unsubscribeUrl}>
      {greeting}
      {"\n\n"}
      Jack here.
      {"\n\n"}
      {gapLine} Long enough that I want to ask straight: is something stopping
      you, or is the timing just off?
      {"\n\n"}
      If setup tripped you up, tell me where &mdash; I can usually point you at
      the one move that gets you unstuck. If OPS isn&apos;t the right fit, no
      hard feelings. I&apos;d just want to know what you came looking for.
      {"\n\n"}
      Hit reply with one sentence. It comes straight to me.
      {"\n\n"}
      — Jack
    </PlainTextLayout>
  );
}

export const previewProps: LostYouProps = {
  firstName: "Jackson",
  daysSinceLastActivity: 8,
  unsubscribeUrl: "https://app.opsapp.co/api/email/unsubscribe?t=preview",
};
