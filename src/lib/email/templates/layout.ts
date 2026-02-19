/**
 * Shared email layout wrapper for portal emails.
 * Inline CSS for maximum email client compatibility.
 */

export function emailLayout(params: {
  companyName: string;
  accentColor: string;
  logoUrl: string | null;
  body: string;
}): string {
  const logoHtml = params.logoUrl
    ? `<img src="${params.logoUrl}" alt="${params.companyName}" style="max-height:48px;max-width:200px;margin-bottom:16px;" />`
    : `<h2 style="margin:0 0 16px 0;font-size:24px;font-weight:700;color:#ffffff;">${params.companyName}</h2>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${params.companyName}</title>
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
                Sent by ${params.companyName} via OPS
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
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px auto 0;">
  <tr>
    <td align="center" style="background-color:${params.accentColor};border-radius:8px;">
      <a href="${params.url}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">
        ${params.label}
      </a>
    </td>
  </tr>
</table>`;
}
