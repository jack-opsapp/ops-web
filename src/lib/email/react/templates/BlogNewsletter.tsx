import * as React from "react";
import sanitizeHtml from "sanitize-html";
import parse from "html-react-parser";
import { OpsEmailLayout } from "../layouts/OpsEmailLayout";
import { Headline, Paragraph, Button, Spacer, Divider } from "../primitives";
import { FIELD_NOTES } from "../../senders";

interface BlogNewsletterProps {
  firstName: string | null;
  title: string;
  teaser: string | null;
  thumbnailUrl: string | null;
  emailContent: string;
  postUrl: string;
  unsubscribeUrl: string;
}

/**
 * Strict allowlist for author-authored blog content. Rejects every tag that
 * isn't on the list. Forces rel=noopener noreferrer on all anchors. Only
 * http/https/mailto link protocols accepted.
 */
const SAFE_HTML_CONFIG: sanitizeHtml.IOptions = {
  allowedTags: [
    "h1",
    "h2",
    "h3",
    "p",
    "br",
    "strong",
    "em",
    "ul",
    "ol",
    "li",
    "blockquote",
    "a",
    "img",
    "figure",
    "figcaption",
    "hr",
    "span",
  ],
  allowedAttributes: {
    a: ["href", "name", "target", "rel"],
    img: ["src", "alt", "width", "height"],
    span: ["style"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }),
  },
};

export function BlogNewsletter({
  firstName,
  title,
  teaser,
  emailContent,
  postUrl,
  unsubscribeUrl,
}: BlogNewsletterProps) {
  // Two-layer safety: sanitize-html enforces the tag/attr allowlist and link
  // schemes, then html-react-parser converts the validated string to real
  // React elements (no innerHTML escape hatch).
  const safeContent = sanitizeHtml(emailContent, SAFE_HTML_CONFIG);
  const parsed = parse(safeContent);
  return (
    <OpsEmailLayout
      preview={teaser ?? title}
      eyebrow="Field notes"
      senderAddress={FIELD_NOTES.email}
      mode="marketing"
      unsubscribeUrl={unsubscribeUrl}
    >
      <Headline>{title}</Headline>
      {firstName ? <Paragraph small>{firstName},</Paragraph> : null}
      {teaser ? <Paragraph>{teaser}</Paragraph> : null}
      <Divider spacing="md" />
      <div
        style={{
          fontFamily: "Mohave, 'Helvetica Neue', Arial, sans-serif",
          fontSize: "16px",
          lineHeight: "24px",
          color: "rgba(10,10,10,0.84)",
        }}
      >
        {parsed}
      </div>
      <Spacer size="lg" />
      <Button href={postUrl}>Read on opsapp.co &rarr;</Button>
    </OpsEmailLayout>
  );
}

BlogNewsletter.PreviewProps = {
  firstName: "Jackson",
  title: "Why your crew ignores your project management software",
  teaser: "Nobody reads a Gantt chart at 6am with coffee in their hand.",
  thumbnailUrl: null,
  emailContent:
    "<p>The first crew I ran on Jobber quit after two weeks.</p><p>Not the software's fault &mdash; but the friction killed them.</p>",
  postUrl: "https://opsapp.co/blog/preview",
  unsubscribeUrl: "https://opsapp.co/unsubscribe?email=preview@example.com",
} satisfies BlogNewsletterProps;

export default BlogNewsletter;
