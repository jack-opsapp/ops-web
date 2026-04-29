// @template-version: 1.0.0
import * as React from "react";
import sanitizeHtml from "sanitize-html";
import parse from "html-react-parser";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import {
  Headline,
  Paragraph,
  Button,
  Spacer,
  Divider,
  emailTokens as T,
} from "../primitives";
import { Section, Row, Column, Text } from "@react-email/components";
import { FIELD_NOTES } from "../../senders";

/**
 * Field Notes Newsletter — periodic digest sent under the OPS Field Notes
 * banner. Contains two curated sections: company news (what's shipping at
 * OPS) and industry insights (what's happening in the trades world).
 *
 * Different from BlogNewsletter:
 *  - BlogNewsletter sends a single blog post to subscribers.
 *  - FieldNotesNewsletter sends a multi-item digest: company updates +
 *    industry observations in one email.
 *
 * Both use the FIELD_NOTES sender identity (field@opsapp.co).
 */

export interface NewsletterItem {
  title: string;
  /** Sanitized HTML body (paragraphs, lists, links allowed) */
  body: string;
  /** Optional click-through */
  linkUrl?: string;
  linkLabel?: string;
}

interface FieldNotesNewsletterProps {
  firstName: string | null;
  issueNumber: number;
  issueDate: string;
  intro: string;
  companyNews: NewsletterItem[];
  industryInsights: NewsletterItem[];
  fullIssueUrl: string;
  unsubscribeUrl: string;
  list?: string;
}

const SAFE_HTML_CONFIG: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "strong",
    "em",
    "ul",
    "ol",
    "li",
    "blockquote",
    "a",
    "span",
  ],
  allowedAttributes: {
    a: ["href", "name", "target", "rel"],
    span: ["style"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }),
  },
};

function ItemBlock({ item }: { item: NewsletterItem }) {
  const safeBody = sanitizeHtml(item.body, SAFE_HTML_CONFIG);
  const parsed = parse(safeBody);
  return (
    <Section style={{ margin: `0 0 ${T.spacing.lg} 0` }}>
      <Row>
        <Column>
          <Text
            style={{
              margin: `0 0 ${T.spacing.xs} 0`,
              fontFamily: T.font.sans,
              fontSize: "18px",
              lineHeight: "24px",
              fontWeight: T.weight.semibold,
              color: T.color.ink,
              letterSpacing: T.tracking.tight,
            }}
          >
            {item.title}
          </Text>
          <div
            style={{
              fontFamily: T.font.sans,
              fontSize: T.size.body,
              lineHeight: T.size.bodyLine,
              color: T.color.paperTextPrimary,
            }}
          >
            {parsed}
          </div>
          {item.linkUrl && item.linkLabel ? (
            <Text
              style={{
                margin: `${T.spacing.sm} 0 0 0`,
                fontFamily: T.font.label,
                fontSize: T.size.eyebrow,
                lineHeight: T.size.eyebrowLine,
                letterSpacing: T.tracking.eyebrow,
                textTransform: "uppercase",
                color: T.color.ink,
              }}
            >
              <a
                href={item.linkUrl}
                style={{
                  color: T.color.ink,
                  textDecoration: "underline",
                }}
              >
                {item.linkLabel} &rarr;
              </a>
            </Text>
          ) : null}
        </Column>
      </Row>
    </Section>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <Text
      style={{
        margin: `${T.spacing.lg} 0 ${T.spacing.md} 0`,
        fontFamily: T.font.label,
        fontSize: T.size.eyebrow,
        lineHeight: T.size.eyebrowLine,
        letterSpacing: T.tracking.eyebrow,
        textTransform: "uppercase",
        color: T.color.paperTextSecondary,
        borderBottom: `1px solid ${T.color.paperRule}`,
        paddingBottom: T.spacing.xs,
      }}
    >
      {label}
    </Text>
  );
}

export function FieldNotesNewsletter({
  firstName,
  issueNumber,
  issueDate,
  intro,
  companyNews,
  industryInsights,
  fullIssueUrl,
  unsubscribeUrl,
  list,
}: FieldNotesNewsletterProps) {
  return (
    <OpsEmailLayout
      preview={intro}
      eyebrow={`Field notes — issue #${issueNumber} — ${issueDate}`}
      senderAddress={FIELD_NOTES.email}
      unsubscribeUrl={unsubscribeUrl}
      list={list}
    >
      <Headline>Field Notes — Issue #{issueNumber}</Headline>
      {firstName ? <Paragraph small>{firstName},</Paragraph> : null}
      <Paragraph>{intro}</Paragraph>

      {companyNews.length > 0 ? (
        <>
          <SectionHeader label="From the shop — what's new at OPS" />
          {companyNews.map((item, i) => (
            <ItemBlock key={`cn-${i}`} item={item} />
          ))}
        </>
      ) : null}

      {industryInsights.length > 0 ? (
        <>
          <SectionHeader label="From the field — industry insights" />
          {industryInsights.map((item, i) => (
            <ItemBlock key={`ii-${i}`} item={item} />
          ))}
        </>
      ) : null}

      <Divider spacing="md" />
      <Paragraph small>
        That&apos;s it for this issue. Got something worth pinning to the
        crew truck? Reply to this email &mdash; we read everything.
      </Paragraph>
      <Spacer size="md" />
      <Button href={fullIssueUrl}>Read the full issue &rarr;</Button>
    </OpsEmailLayout>
  );
}

FieldNotesNewsletter.PreviewProps = {
  firstName: "Jackson",
  issueNumber: 12,
  issueDate: "April 2026",
  intro:
    "Spring's here and every crew on our customer list is booked solid. This issue: what we shipped this month, plus a closer look at why the trades are pulling away from enterprise PM tools.",
  companyNews: [
    {
      title: "Deck Builder is live for beta testers",
      body: "<p>The in-app deck drawing tool shipped to our first 20 beta contractors last week. Early feedback: the laser measurement integration is the killer feature. We're pushing to open it wider in May.</p>",
      linkUrl: "https://opsapp.co/blog/deck-builder-beta",
      linkLabel: "Read the announcement",
    },
    {
      title: "New: weekly ads intelligence briefings",
      body: "<p>If you're running Google Ads, you're now getting a Monday morning briefing with insights, recommended keyword moves, and a prioritized action list. Nobody else in the trades-software space ships anything close to this.</p>",
    },
    {
      title: "Notification rail on the web app",
      body: "<p>Everything that matters — task completions, scan results, payment confirmations — now surfaces in a left-rail feed on the web dashboard. No more hunting through email to see what happened overnight.</p>",
    },
  ],
  industryInsights: [
    {
      title: "ServiceTitan IPO'd at $9B and its customers are revolting",
      body: "<p>ServiceTitan has doubled its prices in the last 18 months. Watching the Reddit threads is like watching a slow-motion crew mutiny. The takeaway: trades businesses remember when the software worked <em>for</em> them, not the other way around.</p>",
      linkUrl: "https://opsapp.co/blog/servicetitan-revolt",
      linkLabel: "Our full take",
    },
    {
      title: "Why your crew still uses group texts for schedules",
      body: "<p>A survey of 200 operators in Q1 showed 78% still rely on group SMS as the primary daily-schedule communication channel. The software market has been trying to kill text messages for a decade and it hasn't worked. We dug into why.</p>",
    },
  ],
  fullIssueUrl: "https://opsapp.co/field-notes/issue-12",
  unsubscribeUrl: "https://opsapp.co/unsubscribe?email=preview@example.com",
} satisfies FieldNotesNewsletterProps;

export default FieldNotesNewsletter;

export const previewProps = FieldNotesNewsletter.PreviewProps;
