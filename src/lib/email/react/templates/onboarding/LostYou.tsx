// @template-version: 1.0.0
import * as React from "react";
import { PlainTextLayout } from "@/lib/email/react/primitives/PlainTextLayout";

/**
 * Behavior-triggered re-engagement send. Fires once per trial when
 * the operator has had zero activity for 6+ consecutive calendar days
 * between Day 1 and Day 14. Sent from JACK. Body copy is canonical
 * per spec §7.
 *
 * @template-version 1.0.0
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
  const gapLine = `You signed up for OPS ${daysSinceSignup} days ago and haven't been back in ${formatDays(
    daysSinceLastActivity,
  )}.`;
  return (
    <PlainTextLayout unsubscribeUrl={unsubscribeUrl}>
      {greeting}
      {"\n\n"}
      Jack here.
      {"\n\n"}
      {gapLine}
      {"\n\n"}
      That's a long enough gap that I want to ask straight: is something stopping you, or is the timing just wrong?
      {"\n\n"}
      If setup tripped you up, I can usually point you at the move that gets you unstuck. If OPS isn't the right fit, no hard feelings — I'd just want to know what you were looking for.
      {"\n\n"}
      Hit reply with one sentence. Goes to my inbox.
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
