import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer, Divider } from "../primitives";
import { DISPATCH } from "../../senders";

interface ReengagementProps {
  /** First name or "Operator" fallback. */
  firstName?: string | null;
  /** Headline copy. Defaults to "Still running things from texts and Post-its?". */
  headline?: string;
  /** Eyebrow. Defaults to "Come back". */
  eyebrow?: string;
  /** Days since last active — used to pick a tone. Optional. */
  daysSinceActive?: number;
  /** Lead paragraph (the "I noticed" sentence). */
  opener?: string;
  /** Body — the why-we-built-it paragraph. */
  body?: string;
  /** Closing — the come-back-it's-still-here line. */
  closing?: string;
  /** Primary CTA. Defaults to "Pick up where you left off". */
  ctaLabel?: string;
  /** CTA URL — usually the dashboard. */
  ctaUrl: string;
  unsubscribeUrl: string;
  list?: string;
}

export function Reengagement({
  firstName,
  headline,
  eyebrow,
  daysSinceActive,
  opener,
  body,
  closing,
  ctaLabel,
  ctaUrl,
  unsubscribeUrl,
  list,
}: ReengagementProps) {
  const greeting = firstName ? `${firstName},` : "Operator,";

  const defaultOpener = daysSinceActive
    ? `Noticed it's been ${daysSinceActive} days since you last opened OPS. No problem. The app, your data, your crews — all still sitting there.`
    : "Noticed you haven't opened OPS in a while. No problem. The app, your data, your crews — all still sitting there.";

  const defaultBody =
    "I built OPS because every other app on the market was built by people who never swung a hammer. If something pulled you off the platform — bad timing, a crew that pushed back, a job that ate your week — that tracks. Running a trades business means the thing on fire today is the only thing that matters.";

  const defaultClosing =
    "If you've got a minute, log back in. The dashboard remembers what you were doing.";

  return (
    <OpsEmailLayout
      preview={headline ?? "Still running things from texts and Post-its?"}
      eyebrow={eyebrow ?? "Come back"}
      senderAddress={DISPATCH.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list ?? "reengagement"}
    >
      <Headline>{headline ?? "Still running things from texts and Post-its?"}</Headline>
      <Paragraph>{greeting}</Paragraph>
      <Paragraph>{opener ?? defaultOpener}</Paragraph>
      <Paragraph>{body ?? defaultBody}</Paragraph>
      <Paragraph>{closing ?? defaultClosing}</Paragraph>
      <Spacer size="md" />
      <Button href={ctaUrl}>{ctaLabel ?? "Pick up where you left off"} &rarr;</Button>
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

Reengagement.PreviewProps = {
  firstName: "Mike",
  daysSinceActive: 21,
  ctaUrl: "https://app.opsapp.co",
  unsubscribeUrl: "https://app.opsapp.co/unsubscribe?list=reengagement",
} satisfies ReengagementProps;

export default Reengagement;
