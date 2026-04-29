import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer, Divider } from "../primitives";
import { DISPATCH } from "../../senders";

interface FeatureAnnouncementProps {
  /** First name or "Operator" fallback. */
  firstName?: string | null;
  /** Short, punchy feature name. Renders inside the eyebrow + opening line. */
  featureName: string;
  /** Headline. Tactical, declarative — "We just shipped X." style. */
  headline: string;
  /** Lead paragraph: what it does. */
  whatItDoes: string;
  /** Body paragraph: why it matters / which problem it kills. */
  whyItMatters: string;
  /** Optional how-to-find-it micro paragraph. */
  howToFindIt?: string;
  /** Primary CTA — usually links straight into the feature in-app. */
  ctaUrl: string;
  ctaLabel?: string;
  unsubscribeUrl: string;
  list?: string;
}

export function FeatureAnnouncement({
  firstName,
  featureName,
  headline,
  whatItDoes,
  whyItMatters,
  howToFindIt,
  ctaUrl,
  ctaLabel,
  unsubscribeUrl,
  list,
}: FeatureAnnouncementProps) {
  const greeting = firstName ? `${firstName},` : "Operator,";
  return (
    <OpsEmailLayout
      preview={`${featureName} just shipped.`}
      eyebrow={`Feature ship — ${featureName}`}
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list ?? "product_updates"}
    >
      <Headline>{headline}</Headline>
      <Paragraph>{greeting}</Paragraph>
      <Paragraph>{whatItDoes}</Paragraph>
      <Paragraph>{whyItMatters}</Paragraph>
      {howToFindIt ? (
        <>
          <Spacer size="sm" />
          <Paragraph>
            <strong>Where to find it.</strong> {howToFindIt}
          </Paragraph>
        </>
      ) : null}
      <Spacer size="md" />
      <Button href={ctaUrl}>{ctaLabel ?? `Try ${featureName}`} &rarr;</Button>
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

FeatureAnnouncement.PreviewProps = {
  firstName: "Mike",
  featureName: "Inbox calibration",
  headline: "Inbox calibration just shipped.",
  whatItDoes:
    "Inbox now learns which threads matter to you and which don't. Lead, customer, supplier, noise — every email gets a tag in under a second.",
  whyItMatters:
    "Before this, leads slipped past you when you were on the wall. Now the inbox sorts itself while you're working, and the leads land in the pipeline without you lifting a finger.",
  howToFindIt:
    "Open the inbox tab. The triage panel appears the first time you scroll an unsorted thread.",
  ctaUrl: "https://app.opsapp.co/inbox",
  ctaLabel: "Open the inbox",
  unsubscribeUrl: "https://app.opsapp.co/unsubscribe?list=product_updates",
} satisfies FeatureAnnouncementProps;

export default FeatureAnnouncement;
