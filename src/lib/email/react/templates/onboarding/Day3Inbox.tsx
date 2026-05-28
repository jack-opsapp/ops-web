import * as React from "react";
import { PlainTextLayout } from "@/lib/email/react/primitives/PlainTextLayout";

/**
 * Day 3 — Inbox → lead, founder voice. Sent from JACK. Body copy is
 * canonical per spec §6.
 *
 * @template-version 1.0.0
 */
export interface Day3InboxProps {
  firstName: string | null;
  unsubscribeUrl: string;
}

export function Day3Inbox({ firstName, unsubscribeUrl }: Day3InboxProps) {
  const greeting = firstName ? `Hey there ${firstName},` : "Hey there,";
  return (
    <PlainTextLayout unsubscribeUrl={unsubscribeUrl}>
      {greeting}
      {"\n\n"}
      Jack again.
      {"\n\n"}
      When I was running my deck and rail crew, the thing that killed me wasn't a single big problem. It was wearing every hat at once.
      {"\n\n"}
      One inbox. Lead emails, supplier emails, sub-trade emails, accounting questions, customer photos — all of it landing in the same spot at the same time. No office. Nobody triaging anything. Nobody nudging me when I'd missed replying to a lead from three days back.
      {"\n\n"}
      And I had no idea if my ads were working. I'd spend money on Google and Facebook and Yelp, and at the end of the month I couldn't tell you which inquiries had turned into jobs, or what those jobs were actually worth.
      {"\n\n"}
      Data is power.
      {"\n\n"}
      That's the part of OPS I'm most proud of.
      {"\n\n"}
      You connect your work inbox. OPS reads your inbox and separates the leads from the noise — the customer asking for a quote on a new install lands in your pipeline, tagged, with the address pulled out and the scope extracted. The supplier confirming an order goes somewhere else.
      {"\n\n"}
      Then OPS tracks every lead from "first email" to "job won" to "invoice paid." You see what your cost per won job is, by source. You see which ads are paying back. You make decisions on numbers instead of gut.
      {"\n\n"}
      Connecting your inbox takes about two minutes. Hit reply if you want to tell me what your inbox chaos looks like right now —<br />I read every reply.
      {"\n\n"}
      — Jack
    </PlainTextLayout>
  );
}

export const previewProps: Day3InboxProps = {
  firstName: "Jackson",
  unsubscribeUrl: "https://app.opsapp.co/api/email/unsubscribe?t=preview",
};
