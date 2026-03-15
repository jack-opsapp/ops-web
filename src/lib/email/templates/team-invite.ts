/**
 * Team Invite Email Template
 *
 * Self-contained email following OPS design system:
 * - Near-black background (#0A0A0A)
 * - Sharp corners (2px border-radius)
 * - Left-aligned text (never center)
 * - Monospace font (closest email-safe match to OPS brand)
 * - Accent #597794 used sparingly
 * - Text hierarchy: #FFFFFF → #999999 → #666666
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
}): string {
  const name = esc(params.companyName);
  const inviter = esc(params.inviterName);
  const inviterEmail = esc(params.inviterEmail);
  const code = esc(params.companyCode);
  const joinUrl = esc(params.joinUrl);

  const logoHtml = params.logoUrl
    ? `<img src="${esc(params.logoUrl)}" alt="${name}" style="max-height:36px;max-width:160px;" />`
    : "";

  // Monospace stack for email clients
  const mono = "'Courier New', Monaco, 'Lucida Console', 'Liberation Mono', monospace";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Join ${name} on OPS</title>
</head>
<body style="margin:0;padding:0;background-color:#0A0A0A;font-family:${mono};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">

<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#0A0A0A;">
<tr><td style="padding:40px 16px;">

<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;width:100%;">

  <!-- OPS wordmark -->
  <tr>
    <td style="padding:0 0 32px 0;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0">
        <tr>
          <td style="font-family:${mono};font-size:14px;font-weight:bold;letter-spacing:4px;color:#597794;text-transform:uppercase;">
            OPS
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Main card -->
  <tr>
    <td style="background-color:#141414;border:1px solid #1f1f1f;border-radius:2px;padding:0;">

      <!-- Accent top edge -->
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
        <tr><td style="height:2px;background-color:#597794;font-size:1px;line-height:1px;">&nbsp;</td></tr>
      </table>

      <!-- Card content -->
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="padding:28px 28px 24px 28px;">

        <!-- Company logo or name -->
        <tr>
          <td style="padding:0 0 20px 0;">
            ${logoHtml ? logoHtml : `<span style="font-family:${mono};font-size:18px;font-weight:bold;color:#ffffff;">${name}</span>`}
          </td>
        </tr>

        <!-- Headline -->
        <tr>
          <td style="padding:0 0 8px 0;">
            <span style="font-family:${mono};font-size:20px;font-weight:bold;color:#ffffff;line-height:1.3;">
              You're invited to join the team.
            </span>
          </td>
        </tr>

        <!-- Inviter info -->
        <tr>
          <td style="padding:0 0 24px 0;">
            <span style="font-family:${mono};font-size:13px;color:#999999;line-height:1.6;">
              ${inviter} (${inviterEmail}) invited you to <span style="color:#ffffff;">${name}</span> on OPS.
            </span>
          </td>
        </tr>

        <!-- Divider -->
        <tr><td style="padding:0 0 24px 0;"><table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"><tr><td style="height:1px;background-color:#1f1f1f;font-size:1px;line-height:1px;">&nbsp;</td></tr></table></td></tr>

        <!-- Section: Join on Web -->
        <tr>
          <td style="padding:0 0 6px 0;">
            <span style="font-family:${mono};font-size:10px;letter-spacing:2px;color:#666666;text-transform:uppercase;">
              JOIN ON WEB
            </span>
          </td>
        </tr>
        <tr>
          <td style="padding:0 0 20px 0;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td style="background-color:#597794;border-radius:2px;">
                  <a href="${joinUrl}" target="_blank" style="display:inline-block;padding:10px 24px;font-family:${mono};font-size:12px;font-weight:bold;letter-spacing:1px;color:#ffffff;text-decoration:none;text-transform:uppercase;">
                    JOIN ${name}
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Section: Join on iOS -->
        <tr>
          <td style="padding:0 0 6px 0;">
            <span style="font-family:${mono};font-size:10px;letter-spacing:2px;color:#666666;text-transform:uppercase;">
              JOIN ON THE APP
            </span>
          </td>
        </tr>
        <tr>
          <td style="padding:0 0 8px 0;">
            <span style="font-family:${mono};font-size:13px;color:#999999;line-height:1.6;">
              1. Download OPS from the <a href="${esc(APP_STORE_URL)}" target="_blank" style="color:#597794;text-decoration:underline;">App Store</a><br/>
              2. Create your account<br/>
              3. Enter the company code below when prompted
            </span>
          </td>
        </tr>

        <!-- Company code box -->
        <tr>
          <td style="padding:8px 0 24px 0;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td style="background-color:#0A0A0A;border:1px solid #1f1f1f;border-radius:2px;padding:10px 20px;">
                  <span style="font-family:${mono};font-size:18px;font-weight:bold;letter-spacing:3px;color:#ffffff;">
                    ${code}
                  </span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Divider -->
        <tr><td style="padding:0 0 24px 0;"><table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"><tr><td style="height:1px;background-color:#1f1f1f;font-size:1px;line-height:1px;">&nbsp;</td></tr></table></td></tr>

        <!-- FAQ Section -->
        <tr>
          <td style="padding:0 0 16px 0;">
            <span style="font-family:${mono};font-size:10px;letter-spacing:2px;color:#666666;text-transform:uppercase;">
              FAQ
            </span>
          </td>
        </tr>

        <!-- FAQ 1 -->
        <tr>
          <td style="padding:0 0 4px 0;">
            <span style="font-family:${mono};font-size:12px;font-weight:bold;color:#ffffff;">
              What is OPS?
            </span>
          </td>
        </tr>
        <tr>
          <td style="padding:0 0 16px 0;">
            <span style="font-family:${mono};font-size:12px;color:#999999;line-height:1.6;">
              OPS is a job and crew management app built for the trades. Your team uses it to see schedules, track projects, and stay coordinated. No training needed.
            </span>
          </td>
        </tr>

        <!-- FAQ 2 -->
        <tr>
          <td style="padding:0 0 4px 0;">
            <span style="font-family:${mono};font-size:12px;font-weight:bold;color:#ffffff;">
              Is it free?
            </span>
          </td>
        </tr>
        <tr>
          <td style="padding:0 0 16px 0;">
            <span style="font-family:${mono};font-size:12px;color:#999999;line-height:1.6;">
              Yes. Team members join for free. Your company admin manages the account.
            </span>
          </td>
        </tr>

        <!-- FAQ 3 -->
        <tr>
          <td style="padding:0 0 4px 0;">
            <span style="font-family:${mono};font-size:12px;font-weight:bold;color:#ffffff;">
              Do I need both the app and the web?
            </span>
          </td>
        </tr>
        <tr>
          <td style="padding:0 0 16px 0;">
            <span style="font-family:${mono};font-size:12px;color:#999999;line-height:1.6;">
              No. The iOS app is built for field crews. The web dashboard is built for the office. Use whichever fits your role, or both.
            </span>
          </td>
        </tr>

        <!-- FAQ 4 -->
        <tr>
          <td style="padding:0 0 4px 0;">
            <span style="font-family:${mono};font-size:12px;font-weight:bold;color:#ffffff;">
              What if I didn't expect this?
            </span>
          </td>
        </tr>
        <tr>
          <td style="padding:0 0 0 0;">
            <span style="font-family:${mono};font-size:12px;color:#999999;line-height:1.6;">
              If you don't recognize the sender, ignore this email. No account is created until you take action.
            </span>
          </td>
        </tr>

      </table>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="padding:20px 0 0 0;">
      <span style="font-family:${mono};font-size:11px;color:#444444;line-height:1.6;">
        Sent via OPS &mdash; Built by trades, for trades.<br/>
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
