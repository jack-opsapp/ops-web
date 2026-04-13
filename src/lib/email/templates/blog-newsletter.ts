/**
 * OPS Field Notes — Blog newsletter email template.
 * Dark theme, inline CSS for maximum email client compatibility.
 */

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(str: string): string {
  return escapeHtml(str);
}

function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return url;
  } catch {
    /* invalid URL */
  }
  return "#";
}

/** Convert plain-text body (with blank-line paragraphs) into HTML <p> blocks. */
function plainTextToHtml(text: string): string {
  const blocks = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return blocks
    .map(
      (p) =>
        `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.7;color:#c4c4c4;">${escapeHtml(p).replace(/\n/g, "<br />")}</p>`
    )
    .join("");
}

/** Detect whether content is already HTML (contains tags) vs plain text. */
function renderBody(content: string): string {
  if (/<(p|div|h[1-6]|ul|ol|br|strong|em|a)\b/i.test(content)) {
    return content;
  }
  return plainTextToHtml(content);
}

export function blogNewsletterTemplate(params: {
  firstName: string | null;
  title: string;
  teaser: string | null;
  thumbnailUrl: string | null;
  emailContent: string;
  postUrl: string;
  unsubscribeUrl: string;
}): string {
  const safeTitle = escapeHtml(params.title);
  const safeTeaser = params.teaser ? escapeHtml(params.teaser) : "";
  const safePostUrl = escapeAttr(sanitizeUrl(params.postUrl));
  const safeUnsubscribeUrl = escapeAttr(sanitizeUrl(params.unsubscribeUrl));
  const greeting = params.firstName
    ? `Hey ${escapeHtml(params.firstName)},`
    : "Hey,";

  const thumbnailHtml = params.thumbnailUrl
    ? `<tr>
            <td style="padding-bottom:24px;">
              <img src="${escapeAttr(sanitizeUrl(params.thumbnailUrl))}" alt="${escapeAttr(params.title)}" width="560" style="display:block;width:100%;max-width:560px;height:auto;border:0;outline:none;border-radius:4px;" />
            </td>
          </tr>`
    : "";

  const bodyHtml = renderBody(params.emailContent);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#c4c4c4;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#0a0a0a;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;width:100%;">
          <!-- Masthead -->
          <tr>
            <td style="padding-bottom:32px;border-bottom:1px solid rgba(255,255,255,0.08);">
              <div style="font-family:'Courier New',monospace;font-size:11px;letter-spacing:2px;color:#6b6b6b;text-transform:uppercase;margin-bottom:8px;">
                OPS — FIELD NOTES
              </div>
              <div style="font-size:11px;color:#6b6b6b;letter-spacing:1px;text-transform:uppercase;">
                Dispatch from the field
              </div>
            </td>
          </tr>
          ${thumbnailHtml ? `<tr><td style="height:28px;"></td></tr>${thumbnailHtml}` : `<tr><td style="height:28px;"></td></tr>`}
          <!-- Title -->
          <tr>
            <td style="padding-bottom:16px;">
              <h1 style="margin:0;font-size:26px;line-height:1.25;font-weight:700;color:#ffffff;letter-spacing:-0.01em;">
                ${safeTitle}
              </h1>
            </td>
          </tr>
          ${
            safeTeaser
              ? `<tr>
            <td style="padding-bottom:24px;">
              <p style="margin:0;font-size:15px;line-height:1.6;color:#8a8a8a;font-style:italic;">
                ${safeTeaser}
              </p>
            </td>
          </tr>`
              : ""
          }
          <!-- Greeting + body -->
          <tr>
            <td style="padding-bottom:8px;">
              <p style="margin:0 0 16px 0;font-size:15px;line-height:1.7;color:#c4c4c4;">
                ${greeting}
              </p>
              ${bodyHtml}
            </td>
          </tr>
          <!-- CTA -->
          <tr>
            <td align="left" style="padding:24px 0 8px 0;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="background-color:#597794;">
                    <a href="${safePostUrl}" target="_blank" style="display:inline-block;padding:14px 28px;font-size:13px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#ffffff;text-decoration:none;font-family:'Courier New',monospace;">
                      Read the full piece →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding-top:40px;border-top:1px solid rgba(255,255,255,0.08);margin-top:40px;">
              <p style="margin:24px 0 8px 0;font-size:11px;line-height:1.6;color:#6b6b6b;letter-spacing:0.5px;">
                OPS — Operational software for trades businesses.
              </p>
              <p style="margin:0;font-size:11px;line-height:1.6;color:#6b6b6b;">
                You're receiving this because you subscribed to OPS Field Notes.
                <a href="${safeUnsubscribeUrl}" style="color:#8a8a8a;text-decoration:underline;">Unsubscribe</a>.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
