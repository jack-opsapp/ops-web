/**
 * Handcrafted HTML for Firebase Auth's stock email templates.
 *
 * These are rendered directly by Firebase's default mailer for flows
 * we cannot intercept (primarily `changeEmailTemplate`, which fires
 * automatically when a user updates their email). They use ONLY
 * Firebase's supported substitution tokens: %LINK%, %EMAIL%, %NEW_EMAIL%,
 * %DISPLAY_NAME%, %APP_NAME%.
 *
 * They intentionally use system-font fallbacks only — no web fonts,
 * no external images — because Firebase's default SMTP may rewrite or
 * strip unexpected content. Keep these minimal and bulletproof.
 */

const SHELL = (
  eyebrow: string,
  headline: string,
  body: string,
  cta: string,
) => `<!doctype html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0A0A0A;font-family:'Helvetica Neue',Arial,sans-serif;-webkit-text-size-adjust:100%">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#0A0A0A">
<tr><td align="center" style="padding:40px 16px">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;width:100%">

<tr><td style="background:#0A0A0A;padding:40px 32px">
<span style="font:700 18px/1 'Helvetica Neue',Arial,sans-serif;color:#FFFFFF;letter-spacing:4px;text-transform:uppercase">OPS</span>
<div style="padding-top:24px;font:400 11px/14px 'Helvetica Neue',Arial,sans-serif;color:rgba(255,255,255,.64);letter-spacing:2px;text-transform:uppercase">${eyebrow}</div>
</td></tr>

<tr><td style="background:#F6F4EF;padding:40px 32px">
<h1 style="margin:0 0 16px 0;font:600 28px/34px 'Helvetica Neue',Arial,sans-serif;color:#0A0A0A;letter-spacing:0.02em">${headline}</h1>
<p style="margin:0 0 24px 0;font:400 16px/24px 'Helvetica Neue',Arial,sans-serif;color:rgba(10,10,10,.84)">${body}</p>
<a href="%LINK%" style="display:inline-block;background:#0A0A0A;color:#FFFFFF;padding:16px 32px;font:400 13px/1 'Helvetica Neue',Arial,sans-serif;text-decoration:none;letter-spacing:1.8px;text-transform:uppercase;border-radius:2px;border:1px solid #0A0A0A">${cta} &rarr;</a>
</td></tr>

<tr><td style="background:#0A0A0A;padding:32px">
<p style="margin:0 0 8px 0;font:400 12px/18px 'Helvetica Neue',Arial,sans-serif;color:rgba(255,255,255,.72)">OPS Ltd. &mdash; Built by trades, for trades.<br><a href="https://app.opsapp.co" style="color:rgba(255,255,255,.72);text-decoration:none">app.opsapp.co</a></p>
<p style="margin:8px 0 0 0;font:400 11px/16px 'Helvetica Neue',Arial,sans-serif;color:rgba(255,255,255,.44);letter-spacing:1.5px;text-transform:uppercase">Sent from gate@opsapp.co</p>
<p style="margin:16px 0 0 0;font:400 11px/16px 'Helvetica Neue',Arial,sans-serif;color:rgba(255,255,255,.44)">OPS Ltd. &middot; 1515 Douglas St, Victoria, BC V8W 2G4, Canada</p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

export const RESET_PASSWORD_BODY = SHELL(
  "Secure password reset",
  "Reset your OPS password.",
  "Tap below to set a new one. This link is good for 60 minutes. Didn&apos;t ask? Ignore this email &mdash; your password stays put.",
  "Reset password",
);

export const VERIFY_EMAIL_BODY = SHELL(
  "Email verification",
  "Confirm it&apos;s you.",
  "Tap below to verify %EMAIL% on your OPS account. One tap and you&apos;re done.",
  "Verify email",
);

export const CHANGE_EMAIL_BODY = SHELL(
  "Email changed",
  "Your sign-in email changed.",
  "Your OPS sign-in is now %NEW_EMAIL%. If that wasn&apos;t you, tap below to revert.",
  "Revert email",
);

export const REVERT_2FA_BODY = SHELL(
  "Two-step verification",
  "Two-step verification added.",
  "Two-step verification was added to your OPS account. If that wasn&apos;t you, tap below to remove it.",
  "Remove 2FA",
);
