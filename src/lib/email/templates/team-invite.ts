/**
 * Team Invite Email Template
 *
 * OPS brand email:
 * - Near-black background (#0A0A0A), card surface #141414
 * - Sharp corners (2px border-radius)
 * - Left-aligned text throughout
 * - Monospace body font, sans-serif for OPS wordmark
 * - Accent #597794 used only on the CTA button
 * - Generous spacing between sections
 * - FAQs sourced from ops-site homepage
 */

const APP_STORE_URL =
  "https://apps.apple.com/us/app/ops-job-crew-management/id6746662078";

function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function teamInviteTemplate(params: {
  companyName: string;
  joinUrl: string;
  accentColor: string;
  logoUrl: string | null;
  inviterName: string;
  inviterEmail: string;
  companyCode: string;
  roleName: string | null;
}): string {
  const name = esc(params.companyName);
  const inviter = esc(params.inviterName);
  const inviterEmail = esc(params.inviterEmail);
  const code = esc(params.companyCode);
  const joinUrl = esc(params.joinUrl);
  const roleName = params.roleName ? esc(params.roleName) : null;

  const logoHtml = params.logoUrl
    ? `<img src="${esc(params.logoUrl)}" alt="${name}" style="max-height:40px;max-width:180px;" />`
    : "";

  const mono = "'Courier New', Monaco, 'Lucida Console', 'Liberation Mono', monospace";
  const sans = "Helvetica, Arial, sans-serif";

  // Role section: assigned role vs unassigned
  const roleHtml = roleName
    ? `<tr>
        <td style="padding:0 0 32px 0;">
          <span style="font-family:${mono};font-size:12px;color:#999999;line-height:1.7;">
            You've been assigned the role of <span style="color:#ffffff;font-weight:bold;">${roleName}</span>.
          </span>
        </td>
      </tr>`
    : `<tr>
        <td style="padding:0 0 32px 0;">
          <span style="font-family:${mono};font-size:12px;color:#999999;line-height:1.7;">
            When you join, your admin will assign you a role. Until then, you'll be able to explore a bit in the app.
          </span>
        </td>
      </tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Join ${name} on OPS</title>
</head>
<body style="margin:0;padding:0;background-color:#0A0A0A;font-family:${mono};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">

<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#0A0A0A;">
<tr><td style="padding:48px 20px;">

<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;width:100%;">

  <!-- OPS wordmark -->
  <tr>
    <td style="padding:0 0 40px 0;">
      <span style="font-family:${sans};font-size:15px;font-weight:700;letter-spacing:5px;color:#ffffff;text-transform:uppercase;">
        OPS
      </span>
    </td>
  </tr>

  <!-- Main card -->
  <tr>
    <td style="background-color:#141414;border:1px solid #1f1f1f;border-radius:2px;padding:0;">

      <!-- Card content -->
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="padding:36px 32px 32px 32px;">

        <!-- Company logo or name -->
        ${logoHtml ? `<tr><td style="padding:0 0 28px 0;">${logoHtml}</td></tr>` : ""}

        <!-- Headline -->
        <tr>
          <td style="padding:0 0 12px 0;">
            <span style="font-family:${mono};font-size:22px;font-weight:bold;color:#ffffff;line-height:1.3;">
              You're invited to join ${name}.
            </span>
          </td>
        </tr>

        <!-- Inviter info -->
        <tr>
          <td style="padding:0 0 32px 0;">
            <span style="font-family:${mono};font-size:13px;color:#999999;line-height:1.7;">
              ${inviter} (${inviterEmail}) invited you to their team on OPS.
            </span>
          </td>
        </tr>

        <!-- Role info -->
        ${roleHtml}

        <!-- Primary CTA: Join link -->
        <tr>
          <td style="padding:0 0 12px 0;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td style="background-color:#597794;border-radius:2px;">
                  <a href="${joinUrl}" target="_blank" style="display:inline-block;padding:12px 28px;font-family:${mono};font-size:13px;font-weight:bold;letter-spacing:1px;color:#ffffff;text-decoration:none;text-transform:uppercase;">
                    JOIN ${name}
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 0 40px 0;">
            <span style="font-family:${mono};font-size:11px;color:#666666;line-height:1.6;">
              Click above to join instantly on the web. No code needed.
            </span>
          </td>
        </tr>

        <!-- Divider -->
        <tr><td style="padding:0 0 36px 0;"><table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"><tr><td style="height:1px;background-color:#1f1f1f;font-size:1px;line-height:1px;">&nbsp;</td></tr></table></td></tr>

        <!-- Section: Join on iOS -->
        <tr>
          <td style="padding:0 0 12px 0;">
            <span style="font-family:${mono};font-size:10px;letter-spacing:2px;color:#666666;text-transform:uppercase;">
              OR JOIN ON THE iOS APP
            </span>
          </td>
        </tr>
        <tr>
          <td style="padding:0 0 20px 0;">
            <span style="font-family:${mono};font-size:12px;color:#999999;line-height:1.8;">
              1. Download OPS from the <a href="${esc(APP_STORE_URL)}" target="_blank" style="color:#597794;text-decoration:underline;">App Store</a><br/>
              2. Create your account<br/>
              3. Enter the company code below when prompted
            </span>
          </td>
        </tr>

        <!-- Company code box -->
        <tr>
          <td style="padding:0 0 44px 0;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td style="background-color:#0A0A0A;border:1px solid #1f1f1f;border-radius:2px;padding:12px 24px;">
                  <span style="font-family:${mono};font-size:20px;font-weight:bold;letter-spacing:4px;color:#ffffff;">
                    ${code}
                  </span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Divider -->
        <tr><td style="padding:0 0 36px 0;"><table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"><tr><td style="height:1px;background-color:#1f1f1f;font-size:1px;line-height:1px;">&nbsp;</td></tr></table></td></tr>

        <!-- FAQ Section -->
        <tr>
          <td style="padding:0 0 20px 0;">
            <span style="font-family:${mono};font-size:10px;letter-spacing:2px;color:#666666;text-transform:uppercase;">
              COMMON QUESTIONS
            </span>
          </td>
        </tr>

        <!-- FAQ 1 -->
        <tr>
          <td style="padding:0 0 6px 0;">
            <span style="font-family:${mono};font-size:12px;font-weight:bold;color:#ffffff;">
              Does OPS work offline?
            </span>
          </td>
        </tr>
        <tr>
          <td style="padding:0 0 24px 0;">
            <span style="font-family:${mono};font-size:12px;color:#999999;line-height:1.7;">
              Yes. Your crew can view schedules, update projects, and take photos without cell service. Everything syncs automatically when connectivity returns.
            </span>
          </td>
        </tr>

        <!-- FAQ 2 -->
        <tr>
          <td style="padding:0 0 6px 0;">
            <span style="font-family:${mono};font-size:12px;font-weight:bold;color:#ffffff;">
              What devices does OPS support?
            </span>
          </td>
        </tr>
        <tr>
          <td style="padding:0 0 24px 0;">
            <span style="font-family:${mono};font-size:12px;color:#999999;line-height:1.7;">
              OPS is available on iPhone and iPad via the App Store, and on any device through the web app at app.opsapp.co.
            </span>
          </td>
        </tr>

        <!-- FAQ 3 -->
        <tr>
          <td style="padding:0 0 6px 0;">
            <span style="font-family:${mono};font-size:12px;font-weight:bold;color:#ffffff;">
              Is my data secure?
            </span>
          </td>
        </tr>
        <tr>
          <td style="padding:0 0 24px 0;">
            <span style="font-family:${mono};font-size:12px;color:#999999;line-height:1.7;">
              Your data is encrypted in transit and at rest. We use industry-standard security practices and never share your information with third parties.
            </span>
          </td>
        </tr>

        <!-- FAQ 4 -->
        <tr>
          <td style="padding:0 0 6px 0;">
            <span style="font-family:${mono};font-size:12px;font-weight:bold;color:#ffffff;">
              How do I get help?
            </span>
          </td>
        </tr>
        <tr>
          <td style="padding:0 0 0 0;">
            <span style="font-family:${mono};font-size:12px;color:#999999;line-height:1.7;">
              Email hello@opsapp.co or use the in-app feedback button. We respond within 24 hours &mdash; usually much faster.
            </span>
          </td>
        </tr>

      </table>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="padding:28px 0 0 0;">
      <span style="font-family:${mono};font-size:11px;color:#444444;line-height:1.7;">
        Built by trades, for trades.<br/>
        <a href="https://opsapp.co" target="_blank" style="color:#444444;text-decoration:none;">opsapp.co</a>
      </span>
    </td>
  </tr>

</table>

</td></tr>
</table>

</body>
</html>`;
}
