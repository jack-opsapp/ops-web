/**
 * Password Reset Email Template
 *
 * Matches the team-invite design language:
 * - Near-black background (#0A0A0A), card surface #141414
 * - Sharp corners (2px border-radius)
 * - Left-aligned text throughout
 * - Monospace body font, sans-serif for OPS wordmark
 * - Accent #597794 on CTA button
 */

function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function passwordResetTemplate(params: {
  resetLink: string;
}): string {
  const resetLink = esc(params.resetLink);
  const mono = "'Courier New', Monaco, 'Lucida Console', 'Liberation Mono', monospace";
  const sans = "Helvetica, Arial, sans-serif";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reset Your Password — OPS</title>
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

      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="padding:36px 32px 32px 32px;">

        <!-- Headline -->
        <tr>
          <td style="padding:0 0 12px 0;">
            <span style="font-family:${mono};font-size:22px;font-weight:bold;color:#ffffff;line-height:1.3;">
              Reset your password.
            </span>
          </td>
        </tr>

        <!-- Body text -->
        <tr>
          <td style="padding:0 0 32px 0;">
            <span style="font-family:${mono};font-size:13px;color:#999999;line-height:1.7;">
              We received a request to reset the password for your OPS account. Click the button below to choose a new password.
            </span>
          </td>
        </tr>

        <!-- CTA button -->
        <tr>
          <td style="padding:0 0 12px 0;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td style="background-color:#597794;border-radius:2px;">
                  <a href="${resetLink}" target="_blank" style="display:inline-block;padding:12px 28px;font-family:${mono};font-size:13px;font-weight:bold;letter-spacing:1px;color:#ffffff;text-decoration:none;text-transform:uppercase;">
                    RESET PASSWORD
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Subtext -->
        <tr>
          <td style="padding:0 0 40px 0;">
            <span style="font-family:${mono};font-size:11px;color:#666666;line-height:1.6;">
              This link expires in 1 hour.
            </span>
          </td>
        </tr>

        <!-- Divider -->
        <tr><td style="padding:0 0 36px 0;"><table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"><tr><td style="height:1px;background-color:#1f1f1f;font-size:1px;line-height:1px;">&nbsp;</td></tr></table></td></tr>

        <!-- Didn't request this -->
        <tr>
          <td style="padding:0;">
            <span style="font-family:${mono};font-size:12px;color:#999999;line-height:1.7;">
              If you didn't request a password reset, you can safely ignore this email. Your password will not be changed.
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
