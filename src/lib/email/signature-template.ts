// src/lib/email/signature-template.ts
//
// The ONE signature the operator can author. Structured fields in, email HTML
// out — no freeform HTML editor, so there is exactly one shape of OPS-authored
// signature in the wild and exactly one thing to keep sanitizer-legal.
//
// This is EMAIL HTML, not product UI. Design-system tokens do not apply here:
// Outlook's Word renderer ignores flex, grid, and external CSS, so layout is a
// table and every style is an inline attribute. The values below are the email
// mirror of the OPS voice — monochrome, hairline, nothing decorative.
//
// Nothing here performs I/O.

/** Two arrangements, per the locked product decision. Logo off → text only. */
export type SignatureTemplateLayout = "logo-left" | "stacked";

export interface SignatureTemplateFields {
  name: string;
  title?: string;
  companyName: string;
  phone?: string;
  website?: string;
  logoUrl?: string | null;
  layout?: SignatureTemplateLayout;
}

export interface RenderedSignatureTemplate {
  html: string;
  text: string;
}

// ── Ink ────────────────────────────────────────────────────────────────────
// Two values, both neutral: near-black for the name, one muted gray for every
// secondary line AND the divider. A signature lands on someone else's white
// canvas, so it borrows no brand color — restraint reads as competence.
const INK_PRIMARY = "#1a1a1a";
const INK_SECONDARY = "#6b6b6b";

// System stack: each client renders in its own native UI face rather than
// falling back to Times when a webfont is unavailable.
const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const NAME_SIZE = "15px";
const BODY_SIZE = "13px";
const LINE_HEIGHT = "1.5";

/** Beside the text block the mark reads as a mark; beneath it, as a stamp. */
const LOGO_WIDTH_LOGO_LEFT = 96;
const LOGO_WIDTH_STACKED = 120;

const DIVIDER_GAP = "14px";
const STACKED_LOGO_GAP = "10px";

const SEPARATOR = " · ";

/**
 * Escaping is round-trip-critical, not merely safe: this output is stored
 * verbatim and re-sanitized on every send, and `sanitize-html` decodes
 * `&quot;`/`&#39;` in text nodes. Encoding only the three structural
 * characters keeps sanitize(render(x)) === render(x).
 */
function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Attribute values additionally need the delimiting double quote encoded. */
function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Only an absolute http(s) URL becomes an `<img>`. Anything else is dropped
 * rather than emitted-and-stripped, because a sanitizer-stripped tag would
 * leave the stored HTML and the sent HTML disagreeing.
 */
function safeImageUrl(value: string | null | undefined): string | null {
  const url = clean(value);
  if (!url) return null;
  return /^https?:\/\/\S+$/i.test(url) ? url : null;
}

interface ResolvedWebsite {
  href: string | null;
  label: string;
}

/**
 * Operators type `canprodeckandrail.com`, not `https://canprodeckandrail.com`.
 * The href gets the scheme it needs; the label shows the address the way a
 * business card would.
 */
function resolveWebsite(value: string): ResolvedWebsite {
  const raw = clean(value);
  if (!raw) return { href: null, label: "" };

  const label = raw.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!label) return { href: null, label: "" };

  const href = /^https?:\/\//i.test(raw) ? raw : `https://${label}`;
  return /^https?:\/\/\S+$/i.test(href) ? { href, label } : { href: null, label };
}

function textBlockHtml(fields: {
  name: string;
  title: string;
  companyName: string;
  phone: string;
  website: ResolvedWebsite;
}): string {
  const lines: string[] = [];

  if (fields.name) {
    lines.push(
      `<div style="font-size:${NAME_SIZE};font-weight:bold;color:${INK_PRIMARY}">${escapeText(fields.name)}</div>`
    );
  }

  const identity = [fields.title, fields.companyName].filter(Boolean);
  if (identity.length > 0) {
    lines.push(`<div>${identity.map(escapeText).join(SEPARATOR)}</div>`);
  }

  const websiteHtml = fields.website.label
    ? fields.website.href
      ? `<a href="${escapeAttribute(fields.website.href)}" rel="noopener noreferrer" style="color:${INK_SECONDARY};text-decoration:none">${escapeText(fields.website.label)}</a>`
      : escapeText(fields.website.label)
    : "";
  const contact = [fields.phone ? escapeText(fields.phone) : "", websiteHtml]
    .filter(Boolean)
    .join(SEPARATOR);
  if (contact) lines.push(`<div>${contact}</div>`);

  return (
    `<div style="font-family:${FONT_STACK};font-size:${BODY_SIZE};line-height:${LINE_HEIGHT};color:${INK_SECONDARY}">` +
    lines.join("") +
    `</div>`
  );
}

function logoHtml(url: string, width: number, alt: string): string {
  return `<img src="${escapeAttribute(url)}" alt="${escapeAttribute(alt)}" width="${width}" />`;
}

/**
 * Renders the operator's identity as a digital business card.
 *
 * `logo-left` is the default whenever a logo exists: the divider is the left
 * cell's right border, which is the one divider construct every mail client
 * — Outlook included — draws correctly.
 */
export function renderSignatureTemplate(
  fields: SignatureTemplateFields
): RenderedSignatureTemplate {
  const name = clean(fields.name);
  const title = clean(fields.title);
  const companyName = clean(fields.companyName);
  const phone = clean(fields.phone);
  const website = resolveWebsite(fields.website ?? "");
  const logoUrl = safeImageUrl(fields.logoUrl);

  const block = textBlockHtml({ name, title, companyName, phone, website });
  const alt = companyName || name;

  // No logo → no arrangement to choose, so the layout input is ignored rather
  // than honored into an empty left cell.
  const layout: SignatureTemplateLayout = !logoUrl
    ? "stacked"
    : (fields.layout ?? "logo-left");

  let html: string;
  if (logoUrl && layout === "logo-left") {
    html =
      `<table style="border-collapse:collapse">` +
      `<tbody><tr>` +
      `<td style="vertical-align:middle;padding-right:${DIVIDER_GAP};border-right:1px solid ${INK_SECONDARY}">` +
      logoHtml(logoUrl, LOGO_WIDTH_LOGO_LEFT, alt) +
      `</td>` +
      `<td style="vertical-align:middle;padding-left:${DIVIDER_GAP}">` +
      block +
      `</td>` +
      `</tr></tbody></table>`;
  } else if (logoUrl) {
    html =
      block +
      `<div style="padding-top:${STACKED_LOGO_GAP}">` +
      logoHtml(logoUrl, LOGO_WIDTH_STACKED, alt) +
      `</div>`;
  } else {
    html = block;
  }

  // The plain-text mirror is arrangement-independent and gives every fact its
  // own line — a flattened table would run them together.
  const textLines = [
    name,
    [title, companyName].filter(Boolean).join(", "),
    phone,
    website.label,
  ].filter(Boolean);

  return { html, text: textLines.join("\n") };
}

/** The inverse of the render, for reopening the builder on a saved signature. */
export interface DescribedSignatureTemplate {
  name: string;
  title: string;
  phone: string;
  website: string;
  includeLogo: boolean;
  layout: SignatureTemplateLayout;
}

/** Reverses `escapeText` and `escapeAttribute`; `&amp;` last, or it re-decodes
 *  what the earlier passes just produced. */
function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Reads a stored signature back into the fields that produced it.
 *
 * Only the operator's job title has no home on the `users` row, so without
 * this the builder would reopen prefilled from the profile and quietly drop
 * the title — and the phone and website — on the next save. Returns null when
 * the stored content was not rendered by this template (a legacy pasted
 * signature, or a provider import), which is the signal to fall back to the
 * profile defaults.
 *
 * Contract: what this returns must render back to the very bytes it was read
 * from. The settings card draws a confirmed signature as a card only when a
 * re-render matches the stored markup exactly — anything this hands back
 * approximately costs the operator their card.
 */
export function describeSignatureTemplate(input: {
  html: string;
  text: string;
  companyName: string;
}): DescribedSignatureTemplate | null {
  const lines = input.text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const companyName = input.companyName.trim();
  if (lines.length === 0 || !companyName) return null;

  const [name, identity, ...rest] = lines;
  if (rest.length > 2) return null;

  let title = "";
  if (identity !== undefined) {
    const suffix = `, ${companyName}`;
    if (identity === companyName) {
      title = "";
    } else if (identity.endsWith(suffix)) {
      title = identity.slice(0, -suffix.length);
    } else {
      // Some other signature's shape. Guessing would put a company name in the
      // title field, so report nothing rather than something wrong.
      return null;
    }
  }

  // The address comes off the link, not off the label. The label is the
  // business-card form — scheme dropped, trailing slash dropped — and a render
  // rebuilt from it can point somewhere slightly else (`.../` becomes ``, and
  // an `http://` site gets silently upgraded). The settings card decides
  // whether to draw the stored signature by re-rendering what it read back and
  // comparing byte for byte, so "somewhere slightly else" costs the operator
  // the whole card.
  const anchor = input.html.match(
    /<a\b[^>]*?\shref="([^"]*)"[^>]*>([^<]*)<\/a>/i
  );
  const href = anchor ? decodeEntities(anchor[1]).trim() : "";
  const label = anchor ? decodeEntities(anchor[2]).trim() : "";
  // Hand back the shortest input that reproduces this exact link: the address
  // as a business card writes it, unless only the full URL renders back to the
  // same place. Asking the renderer itself keeps the two from drifting apart.
  const website = resolveWebsite(label).href === href ? label : href;
  // The website's own line is the label, so that is the line the phone is not.
  const phone = rest.find((line) => line !== label) ?? "";

  const includeLogo = /<img\b/i.test(input.html);
  const layout: SignatureTemplateLayout =
    includeLogo && !/<table\b/i.test(input.html) ? "stacked" : "logo-left";

  return { name, title, phone, website, includeLogo, layout };
}
