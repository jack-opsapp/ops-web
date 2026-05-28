import * as React from "react";
import { PlainTextLayout } from "@/lib/email/react/primitives/PlainTextLayout";

/**
 * Day 8 — Estimates + portal, founder voice. Sent from JACK.
 * Body copy is canonical per spec §6 (founder-provided deck-builder
 * anecdote; do not edit).
 *
 * @template-version 1.0.0
 */
export interface Day8EstimatesProps {
  firstName: string | null;
  unsubscribeUrl: string;
}

export function Day8Estimates({ firstName, unsubscribeUrl }: Day8EstimatesProps) {
  const greeting = firstName ? `Hey there ${firstName},` : "Hey there,";
  return (
    <PlainTextLayout unsubscribeUrl={unsubscribeUrl}>
      {greeting}
      {"\n\n"}
      Jack again, last one of these you'll get from me for a while.
      {"\n\n"}
      A deck builder I know ran his estimates out of a Word doc template. Every new customer, he'd open the last one he sent, save-as, update the fields. Or try to.
      {"\n\n"}
      I was constantly on his back about it. He'd send estimates with the wrong customer name at the top. With the previous customer's address still in there. With totals that didn't match the line items because he'd updated the materials but forgot the bottom number.
      {"\n\n"}
      If he caught it, he'd send a follow-up: "sorry, mixed up the name." "Sorry, clerical error on the address." "Apologies for the confusion."
      {"\n\n"}
      The one I'll never forget: he started a job on a Monday, realized halfway through the week that the estimate he'd sent was for the previous customer's project, and the price was 20% below what the new job actually cost him. He had to beg the customer mid-job to accept the higher number because he'd forgotten to update one field in a template.
      {"\n\n"}
      You can imagine how that went over.
      {"\n\n"}
      That's the kind of thing that kills small businesses. Not because the work is bad. Because the back-office is held together with copy-paste and good intentions.
      {"\n\n"}
      When you send an estimate from OPS, your customer gets a link to a branded portal — your logo, your business name, the line items pulled from your real pricing. They read it, ask questions on individual items, approve or decline, and pay through the portal directly. You don't copy-paste anything. You can't forget to update a field that doesn't exist.
      {"\n\n"}
      If you want to see what your customers see, send a test estimate to your own email. Takes about three minutes from inside OPS.
      {"\n\n"}
      — Jack
    </PlainTextLayout>
  );
}

export const previewProps: Day8EstimatesProps = {
  firstName: "Jackson",
  unsubscribeUrl: "https://app.opsapp.co/api/email/unsubscribe?t=preview",
};
