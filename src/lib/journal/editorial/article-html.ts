import sanitizeHtml from "sanitize-html";

/**
 * The writer never sends HTML. It sends blocks with three inline marks
 * (`**bold**`, `*italic*`, `[label](url)`), and OPS renders the article itself,
 * so markup, links and the Sources list are always produced by this file.
 */
export type JournalBlock =
  | { type: "p" | "h2" | "h3" | "blockquote"; text: string }
  | { type: "ul" | "ol"; items: string[] };

export interface InlineLink {
  label: string;
  url: string;
}

export interface ParsedInline {
  html: string;
  plain: string;
  links: InlineLink[];
}

export class JournalMarkupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JournalMarkupError";
  }
}

const HTML_TAG = /<\/?[a-z!][^>]*>/i;
const LINK = /^\[([^[\]\n]{1,200})\]\(([^()\s]{1,2048})\)/;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Plain-text fields (FAQs, email, metadata) carry no markup at all. */
export function assertPlainText(value: string): void {
  if (HTML_TAG.test(value)) throw new JournalMarkupError("HTML is not allowed");
  if (/\[[^\]]*\]\([^)]*\)/.test(value) || /\*\*|\*[^*\s]/.test(value))
    throw new JournalMarkupError("Markup is only allowed in the article body");
}

export function parseInline(text: string): ParsedInline {
  if (HTML_TAG.test(text)) throw new JournalMarkupError("HTML is not allowed");
  let html = "";
  let plain = "";
  const links: InlineLink[] = [];
  let index = 0;
  while (index < text.length) {
    if (text.startsWith("**", index)) {
      const end = text.indexOf("**", index + 2);
      const inner = end > index + 2 ? text.slice(index + 2, end) : "";
      if (!inner || /[*[\]]/.test(inner))
        throw new JournalMarkupError("Bold must be **text** with nothing inside it");
      html += `<strong>${escapeHtml(inner)}</strong>`;
      plain += inner;
      index = end + 2;
      continue;
    }
    if (text[index] === "*") {
      const end = text.indexOf("*", index + 1);
      const inner = end > index + 1 ? text.slice(index + 1, end) : "";
      if (!inner || /[*[\]]/.test(inner) || text[end + 1] === "*")
        throw new JournalMarkupError("Italic must be *text* with nothing inside it");
      html += `<em>${escapeHtml(inner)}</em>`;
      plain += inner;
      index = end + 1;
      continue;
    }
    if (text[index] === "[") {
      const match = LINK.exec(text.slice(index));
      if (!match) throw new JournalMarkupError("Links must be [label](url)");
      links.push({ label: match[1], url: match[2] });
      html += `<a href="${escapeHtml(match[2])}">${escapeHtml(match[1])}</a>`;
      plain += match[1];
      index += match[0].length;
      continue;
    }
    html += escapeHtml(text[index]);
    plain += text[index];
    index += 1;
  }
  return { html, plain, links };
}

export interface RenderedBody {
  html: string;
  /** One plain-text entry per block, list items joined by line breaks. */
  plain: string[];
  links: InlineLink[];
}

export function renderBlocks(blocks: JournalBlock[]): RenderedBody {
  const html: string[] = [];
  const plain: string[] = [];
  const links: InlineLink[] = [];
  for (const block of blocks) {
    if (block.type === "ul" || block.type === "ol") {
      const items = block.items.map(parseInline);
      items.forEach((item) => links.push(...item.links));
      html.push(
        `<${block.type}>\n${items.map((item) => `<li>${item.html}</li>`).join("\n")}\n</${block.type}>`
      );
      plain.push(items.map((item) => item.plain).join("\n"));
      continue;
    }
    const parsed = parseInline(block.text);
    links.push(...parsed.links);
    html.push(`<${block.type}>${parsed.html}</${block.type}>`);
    plain.push(parsed.plain);
  }
  return { html: html.join("\n\n"), plain, links };
}

export interface CitedSource {
  final_url: string;
  title: string | null;
  site_name: string | null;
}

function sourceLabel(source: CitedSource): string {
  if (source.title) return source.title;
  if (source.site_name) return source.site_name;
  return new URL(source.final_url).hostname.replace(/^www\./, "");
}

/** Server-owned: the writer can never add, reword or invent a source link. */
export function renderSourcesSection(sources: CitedSource[]): string {
  const items = sources.map((source) => {
    const label = escapeHtml(sourceLabel(source));
    const site =
      source.site_name && source.title
        ? ` · ${escapeHtml(source.site_name)}`
        : "";
    return `<li><a href="${escapeHtml(source.final_url)}">${label}</a>${site}</li>`;
  });
  return `<h2>Sources</h2>\n<ul>\n${items.join("\n")}\n</ul>`;
}

/** The newsletter body: the writer's paragraphs, escaped, nothing else. */
export function renderEmailContent(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("\n\n");
}

// The same allowlist ops-site's PostContent applies before rendering, so the
// stored article is exactly what the public page will show.
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["h2", "h3", "p", "a", "ul", "ol", "li", "blockquote", "strong", "em"],
  allowedAttributes: { a: ["href"] },
  allowedSchemes: ["https"],
  allowedSchemesAppliedToAttributes: ["href"],
  allowProtocolRelative: false,
};

export function sanitizeJournalHtml(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

/** Identical to the Blog admin's count, so the stored figure never drifts. */
export function countJournalWords(html: string): number {
  return html
    .replace(/<[^>]*>/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function countPlainWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
