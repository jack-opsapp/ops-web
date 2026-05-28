import * as React from "react";
import { PlainTextLayout } from "@/lib/email/react/primitives/PlainTextLayout";

/**
 * Day 0 founder welcome — sent real-time from /api/setup/progress after
 * the company INSERT. Copy is canonical per spec §6; do not edit without
 * a brand review (founder-voice email, written by the founder himself).
 *
 * @template-version 1.0.0
 */
export interface Day0WelcomeProps {
  firstName: string | null;
  unsubscribeUrl: string;
}

export function Day0Welcome({ firstName, unsubscribeUrl }: Day0WelcomeProps) {
  const greeting = firstName ? `Hey there ${firstName},` : "Hey there,";
  return (
    <PlainTextLayout unsubscribeUrl={unsubscribeUrl}>
      {greeting}
      {"\n\n"}
      My name is Jack, I built OPS.
      {"\n\n"}
      I'm glad you signed up, and I'm looking forward to hearing what you think of it as you grow.
      {"\n\n"}
      What led you to join? Are you just kicking tires? Are you considering moving from another platform? Just getting into digital tools for your business? Whatever the case, I'm happy to help you get rolling. I built this tool because there was nothing on the market that worked for my crew. I got the impression those were all tech companies built by guys who have never actually worked on a jobsite. So here we are.
      {"\n\n"}
      Again, if there's anything you need help with, you can reply to this email, it's my personal inbox.
      {"\n\n"}
      — Jack
    </PlainTextLayout>
  );
}

export const previewProps: Day0WelcomeProps = {
  firstName: "Jackson",
  unsubscribeUrl: "https://app.opsapp.co/api/email/unsubscribe?t=preview",
};
