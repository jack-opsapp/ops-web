// @template-version: 1.1.0
import * as React from "react";
import { PlainTextLayout } from "@/lib/email/react/primitives/PlainTextLayout";

/**
 * Day 14 Branch B — fires when the operator has had activity in the
 * last 7 days. Sent from JACK. Single variant: an ambiguous "you've
 * been putting OPS to work" opener (no per-account counts — the old
 * stats line read as surveillance) plus a two-question reply prompt.
 *
 * @template-version 1.1.0
 */
export interface Day14ActiveProps {
  firstName: string | null;
  unsubscribeUrl: string;
}

export function Day14Active({ firstName, unsubscribeUrl }: Day14ActiveProps) {
  const greeting = firstName ? `Hey there ${firstName},` : "Hey there,";
  return (
    <PlainTextLayout unsubscribeUrl={unsubscribeUrl}>
      {greeting}
      {"\n\n"}
      Jack here.
      {"\n\n"}
      Two weeks in, and you've been putting OPS to work. Good.
      {"\n\n"}
      Now I want to hear from you. Two things:
      {"\n\n"}
      &nbsp;&nbsp;1. What's working better than you figured it would?
      {"\n"}
      &nbsp;&nbsp;2. What's getting in your way?
      {"\n\n"}
      Reply here — comes straight to me. A sentence each is plenty.
      {"\n\n"}
      — Jack
    </PlainTextLayout>
  );
}

export const previewProps: Day14ActiveProps = {
  firstName: "Jackson",
  unsubscribeUrl: "https://app.opsapp.co/api/email/unsubscribe?t=preview",
};
