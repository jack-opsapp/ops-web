import * as React from "react";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer, InfoBlock } from "../primitives";
import { DISPATCH } from "../../senders";

interface RoleNeededProps {
  userName: string;
  companyName: string;
  assignUrl: string;
}

export function RoleNeeded({
  userName,
  companyName,
  assignUrl,
}: RoleNeededProps) {
  return (
    <OpsEmailLayout
      preview={`${userName} joined ${companyName} and needs a role`}
      eyebrow="New crew member"
      senderAddress={DISPATCH.email}
    >
      <Headline>{userName}&apos;s in. Give them a role.</Headline>
      <Paragraph>
        <strong>{userName}</strong> just joined {companyName} on OPS. Until
        you assign a role, they&apos;ll have limited access and won&apos;t
        see jobs.
      </Paragraph>
      <Spacer size="md" />
      <Button href={assignUrl}>Assign role &rarr;</Button>
      <Spacer size="lg" />
      <InfoBlock label="New member">{userName}</InfoBlock>
      <Paragraph small>
        Head to Settings &rarr; Team anytime to manage roles and permissions.
      </Paragraph>
    </OpsEmailLayout>
  );
}

RoleNeeded.PreviewProps = {
  userName: "Sam Harper",
  companyName: "CanPro Deck and Rail",
  assignUrl: "https://app.opsapp.co/team/preview",
} satisfies RoleNeededProps;

export default RoleNeeded;
