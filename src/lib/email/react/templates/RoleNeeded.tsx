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
        {userName} just joined {companyName} on OPS. They can&apos;t see
        jobs until you set their role.
      </Paragraph>
      <Spacer size="md" />
      <Button href={assignUrl}>Assign role &rarr;</Button>
      <Spacer size="lg" />
      <InfoBlock label="New member">{userName}</InfoBlock>
    </OpsEmailLayout>
  );
}

RoleNeeded.PreviewProps = {
  userName: "Sam Harper",
  companyName: "CanPro Deck and Rail",
  assignUrl: "https://app.opsapp.co/team/preview",
} satisfies RoleNeededProps;

export default RoleNeeded;
