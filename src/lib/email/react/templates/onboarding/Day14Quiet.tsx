// @template-version: 1.1.0
import * as React from "react";
import { PlainTextLayout } from "@/lib/email/react/primitives/PlainTextLayout";

/**
 * Day 14 Branch A — fires when the operator has had zero activity in
 * the last 7 days. Sent from JACK (changed v3 from Dispatch).
 *
 * @template-version 1.1.0
 */
export interface Day14QuietProps {
  firstName: string | null;
  unsubscribeUrl: string;
}

export function Day14Quiet({ firstName, unsubscribeUrl }: Day14QuietProps) {
  const greeting = firstName ? `Hey there ${firstName},` : "Hey there,";
  return (
    <PlainTextLayout unsubscribeUrl={unsubscribeUrl}>
      {greeting}
      {"\n\n"}
      Jack here.
      {"\n\n"}
      Two weeks in, and it's gone quiet on your end.
      {"\n\n"}
      Could be anything — you've been buried in actual work, setup tripped you up, OPS isn't the fit, or it just slipped your mind. I'm not going to bug you about it.
      {"\n\n"}
      But I'd like to know which one. Reply here — comes straight to me. One sentence does it.
      {"\n\n"}
      If something didn't work, tell me what. If you forgot it existed, tell me that. I built OPS for guys actually on the job, and it only gets better when they tell me where it's short.
      {"\n\n"}
      — Jack
    </PlainTextLayout>
  );
}

export const previewProps: Day14QuietProps = {
  firstName: "Jackson",
  unsubscribeUrl: "https://app.opsapp.co/api/email/unsubscribe?t=preview",
};
