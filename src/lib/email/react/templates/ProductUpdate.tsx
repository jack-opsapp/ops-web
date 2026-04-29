import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer, Divider } from "../primitives";
import { DISPATCH } from "../../senders";

interface ProductUpdateItem {
  title: string;
  body: string;
}

interface ProductUpdateProps {
  /** First name or "Operator" fallback. Used in the opener. */
  firstName?: string | null;
  /** Headline copy. Defaults to "What shipped this week." */
  headline?: string;
  /** Eyebrow above the headline. */
  eyebrow?: string;
  /** Sentence that introduces the list. */
  intro: string;
  /** Up to ~5 short items. The list is rendered as a tactical bullet block. */
  items: ProductUpdateItem[];
  /** Optional closing paragraph rendered before the CTA. */
  closing?: string;
  /** CTA button label. Defaults to "Open OPS". */
  ctaLabel?: string;
  /** CTA destination — usually an in-app page that highlights the change. */
  ctaUrl: string;
  unsubscribeUrl: string;
  list?: string;
}

export function ProductUpdate({
  firstName,
  headline,
  eyebrow,
  intro,
  items,
  closing,
  ctaLabel,
  ctaUrl,
  unsubscribeUrl,
  list,
}: ProductUpdateProps) {
  const greeting = firstName ? `${firstName},` : "Operator,";
  return (
    <OpsEmailLayout
      preview={headline ?? "What shipped this week."}
      eyebrow={eyebrow ?? "Product update"}
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list ?? "product_updates"}
    >
      <Headline>{headline ?? "What shipped this week."}</Headline>
      <Paragraph>{greeting}</Paragraph>
      <Paragraph>{intro}</Paragraph>
      <Spacer size="sm" />
      {items.map((item, idx) => (
        <Paragraph key={idx}>
          <strong>{item.title}.</strong> {item.body}
        </Paragraph>
      ))}
      {closing ? (
        <>
          <Spacer size="sm" />
          <Paragraph>{closing}</Paragraph>
        </>
      ) : null}
      <Spacer size="md" />
      <Button href={ctaUrl}>{ctaLabel ?? "Open OPS"} &rarr;</Button>
      <Spacer size="lg" />
      <Divider spacing="sm" />
      <Paragraph small>
        &mdash; Jack
        <br />
        Founder, OPS
      </Paragraph>
    </OpsEmailLayout>
  );
}

ProductUpdate.PreviewProps = {
  firstName: "Mike",
  headline: "What shipped this week.",
  eyebrow: "Product update",
  intro:
    "Quick rundown of the changes that landed this week — every one came out of a job-site moment.",
  items: [
    {
      title: "Faster project search",
      body: "Open the project picker, start typing — results show up in two keystrokes flat.",
    },
    {
      title: "Sharper push notifications",
      body: "Crew-level pushes now route by trade so the framers don't get pinged for plumbing.",
    },
    {
      title: "Inbox calibration",
      body: "Rebuilt the inbox triage flow so leads stop slipping past your screen.",
    },
  ],
  closing:
    "If something's broken or missing, hit reply. Every email lands in my inbox.",
  ctaLabel: "See it in OPS",
  ctaUrl: "https://app.opsapp.co",
  unsubscribeUrl: "https://app.opsapp.co/unsubscribe?list=product_updates",
} satisfies ProductUpdateProps;

export default ProductUpdate;
