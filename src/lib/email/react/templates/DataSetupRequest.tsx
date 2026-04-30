import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer, InfoBlock } from "../primitives";
import { DISPATCH } from "../../senders";

export interface DataSetupRequestProps {
  companyName: string;
  contactEmail: string;
  contactPhone: string | null;
  sourceSoftware: string | null;
  stripePaymentIntentId: string;
  amountDisplay: string;
  purchasedAtDisplay: string;
  adminUrl: string;
}

export function DataSetupRequest(p: DataSetupRequestProps) {
  return (
    <OpsEmailLayout
      preview={`Data Setup purchased — ${p.companyName}`}
      eyebrow="Data setup // Pending"
      senderAddress={DISPATCH.email}
    >
      <Headline>{p.companyName} bought Data Setup.</Headline>
      <Paragraph>
        Reach out within 24 hours. Confirm what they&apos;re moving over, lock
        a date, then run the migration.
      </Paragraph>
      <Spacer size="md" />
      <InfoBlock label="Company">{p.companyName}</InfoBlock>
      <InfoBlock label="Contact">
        {p.contactEmail}
        {p.contactPhone ? <> &middot; {p.contactPhone}</> : null}
      </InfoBlock>
      <InfoBlock label="Source software">
        {p.sourceSoftware ?? "Not provided — ask on first call"}
      </InfoBlock>
      <InfoBlock label="Payment">
        {p.amountDisplay} &middot; {p.purchasedAtDisplay}
      </InfoBlock>
      <InfoBlock label="Stripe payment ID">{p.stripePaymentIntentId}</InfoBlock>
      <Spacer size="md" />
      <Button href={p.adminUrl}>Open in admin &rarr;</Button>
    </OpsEmailLayout>
  );
}

DataSetupRequest.PreviewProps = {
  companyName: "CanPro Deck and Rail",
  contactEmail: "owner@canprodeckandrail.com",
  contactPhone: "+1 250 555 0100",
  sourceSoftware: "Jobber",
  stripePaymentIntentId: "pi_3OxLpHEooJoYGoIw1abc2DEF",
  amountDisplay: "$499.00 USD",
  purchasedAtDisplay: "Apr 29, 2026 · 2:14 PM PT",
  adminUrl: "https://app.opsapp.co/admin/companies",
} satisfies DataSetupRequestProps;

export default DataSetupRequest;
