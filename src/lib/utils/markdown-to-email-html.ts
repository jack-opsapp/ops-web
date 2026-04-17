/**
 * Lightweight markdown → email-safe HTML converter.
 *
 * Handles: **bold**, *italic*, [text](url), line breaks, paragraph breaks.
 * Does NOT handle headings, lists, code blocks, images, or tables —
 * this is for email body text from the compose modal, not documentation.
 *
 * All input is HTML-escaped before processing to prevent injection.
 * Output uses inline styles for email client compatibility.
 */

/**
 * Convert a markdown string to email-safe HTML.
 * Returns an HTML string wrapped in a styled <div>.
 */
export function markdownToEmailHtml(markdown: string): string {
  // 1. Escape HTML special characters (prevents injection via email body)
  let html = markdown
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  // 2. Links: [text](url) — process before bold/italic to avoid conflicts
  // Validate URL scheme to prevent javascript: XSS
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_, text, url) => {
      const safe = /^https?:\/\//i.test(url) ? url : "#";
      return `<a href="${safe}" style="color:#6F94B0;text-decoration:underline;">${text}</a>`;
    }
  );

  // 3. Bold: **text** and __text__ (process before italic)
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");

  // 4. Italic: *text* and _text_ (safe now — ** and __ already consumed)
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(
    /(?<=\s|^)_(.+?)_(?=\s|$|[.,!?;:])/gm,
    "<em>$1</em>"
  );

  // 5. Paragraphs: split on double newlines, single newlines become <br>
  const paragraphs = html.split(/\n{2,}/);
  const body = paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px 0;">${p.trim().replace(/\n/g, "<br>")}</p>`
    )
    .join("");

  // 6. Wrap in email-safe container with system font stack
  return [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;',
    'font-size:14px;line-height:1.6;color:#1a1a1a;">',
    body,
    "</div>",
  ].join("");
}
