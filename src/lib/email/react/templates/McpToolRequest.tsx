// @template-version: 1.0.0
import * as React from "react";

import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Button, Headline, InfoBlock, Paragraph, Spacer } from "../primitives";
import { DISPATCH } from "../../senders";

export interface McpToolRequestProps {
  requesterEmail: string;
  details: string;
  submissionId: string;
  adminUrl: string;
  unsubscribeUrl?: string;
  list?: string;
}

export function McpToolRequest(props: McpToolRequestProps) {
  return (
    <OpsEmailLayout
      preview={`MCP tool request from ${props.requesterEmail}`}
      eyebrow="MCP // Tool request"
      senderAddress={DISPATCH.email}
      unsubscribeUrl={props.unsubscribeUrl}
      list={props.list}
    >
      <Headline>New MCP tool request.</Headline>
      <InfoBlock label="Requester">{props.requesterEmail}</InfoBlock>
      <InfoBlock label="Submission">{props.submissionId}</InfoBlock>
      <Spacer size="md" />
      <Paragraph>{props.details}</Paragraph>
      <Spacer size="md" />
      <Button href={props.adminUrl}>Open feedback queue &rarr;</Button>
    </OpsEmailLayout>
  );
}

McpToolRequest.PreviewProps = {
  requesterEmail: "builder@example.com",
  details:
    "Compare an active estimate with the last similar job and keep the result read-only.",
  submissionId: "mcp-tool:11111111-1111-4111-8111-111111111111",
  adminUrl: "https://app.opsapp.co/admin/feedback",
} satisfies McpToolRequestProps;

export default McpToolRequest;

export const previewProps = McpToolRequest.PreviewProps;
