import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import {
  Headline,
  Paragraph,
  InfoBlock,
  Button,
  Spacer,
} from "../primitives";
import { DISPATCH } from "../../senders";

export interface PmfThresholdAlertProps {
  trigger: string;
  messageBody: string;
  context?: Record<string, string | number>;
  dashboardUrl?: string;
}

export function PmfThresholdAlert({
  trigger,
  messageBody,
  context,
  dashboardUrl,
}: PmfThresholdAlertProps) {
  const safeUrl =
    dashboardUrl && /^https?:\/\//.test(dashboardUrl) ? dashboardUrl : null;

  return (
    <OpsEmailLayout
      preview={messageBody}
      eyebrow={`// PMF ALERT · ${trigger.toUpperCase()}`}
      senderAddress={DISPATCH.email}
    >
      <Headline as="h1">{messageBody}</Headline>

      {context && Object.keys(context).length > 0 ? (
        <>
          <Spacer size="sm" />
          {Object.entries(context).map(([k, v]) => (
            <InfoBlock key={k} label={k.replace(/_/g, " ")}>
              {String(v)}
            </InfoBlock>
          ))}
        </>
      ) : null}

      {safeUrl ? (
        <>
          <Spacer size="md" />
          <Paragraph small>
            Open the deck to investigate the trigger and adjust thresholds.
          </Paragraph>
          <Spacer size="sm" />
          <Button href={safeUrl}>VIEW DECK</Button>
        </>
      ) : null}
    </OpsEmailLayout>
  );
}
