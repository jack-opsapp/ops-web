/**
 * Shared email layout wrapper for portal emails.
 * Inline CSS for maximum email client compatibility.
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

/** Validate and sanitize a CSS color value (hex, rgb, named colors only). */
function sanitizeColor(color: string): string {
  // Allow hex colors, rgb/rgba, and simple named colors
  if (/^#[0-9a-fA-F]{3,8}$/.test(color)) return color;
  if (/^rgba?\(\s*[\d.,\s%]+\)$/.test(color)) return color;
  if (/^[a-zA-Z]{1,20}$/.test(color)) return color;
  return "#417394"; // fallback to OPS accent
}

/** Validate a URL (must be https or http). */
function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return url;
  } catch { /* invalid URL */ }
  return "#";
}

export function emailLayout(params: {
  companyName: string;
  accentColor: string;
  logoUrl: string | null;
  body: string;
}): string {
  const safeName = escapeHtml(params.companyName);
  const logoHtml = params.logoUrl
    ? `<img src="${escapeAttr(sanitizeUrl(params.logoUrl))}" alt="${escapeAttr(params.companyName)}" style="max-height:48px;max-width:200px;margin-bottom:16px;" />`
    : `<h2 style="margin:0 0 16px 0;font-size:24px;font-weight:700;color:#ffffff;">${safeName}</h2>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeName}</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#0a0a0a;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;width:100%;">
          <!-- Header -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              ${logoHtml}
            </td>
          </tr>
          <!-- Content Card -->
          <tr>
            <td style="background-color:#191919;border-radius:12px;padding:32px;border:1px solid rgba(255,255,255,0.06);">
              ${params.body}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:24px;">
              <p style="margin:0;font-size:12px;color:#6b7280;">
                Sent by ${safeName} via OPS
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

export function emailButton(params: {
  url: string;
  label: string;
  accentColor: string;
}): string {
  const safeColor = sanitizeColor(params.accentColor);
  const safeUrl = escapeAttr(sanitizeUrl(params.url));
  const safeLabel = escapeHtml(params.label);

  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px auto 0;">
  <tr>
    <td align="center" style="background-color:${safeColor};border-radius:8px;">
      <a href="${safeUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">
        ${safeLabel}
      </a>
    </td>
  </tr>
</table>`;
}
