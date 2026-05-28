// @template-version: 1.0.0
import * as React from "react";
import { PlainTextLayout } from "@/lib/email/react/primitives/PlainTextLayout";

/**
 * Day 14 Branch A — fires when the operator has had zero activity in
 * the last 7 days. Sent from JACK (changed v3 from Dispatch).
 * Body copy is canonical per spec §6.
 *
 * @template-version 1.0.0
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
      Day 14. You're halfway through your trial and it's been quiet on your account.
      {"\n\n"}
      Could be a lot of things — you've been busy on actual work, something tripped you up during setup, OPS didn't fit how you run things, the timing's wrong, you forgot about it. No judgment either way.
      {"\n\n"}
      But I want to know which one it is. Hit reply on this email — goes to my inbox. One sentence is enough.
      {"\n\n"}
      If something specifically didn't work, tell me. If you forgot about it, tell me that too. The product gets better when operators tell me what's grinding their gears.
      {"\n\n"}
      — Jack
    </PlainTextLayout>
  );
}

export const previewProps: Day14QuietProps = {
  firstName: "Jackson",
  unsubscribeUrl: "https://app.opsapp.co/api/email/unsubscribe?t=preview",
};
