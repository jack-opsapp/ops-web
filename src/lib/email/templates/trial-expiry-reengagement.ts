import { emailLayout, emailButton } from "./layout";

/**
 * Trial expiry reengagement template — used 7 days and 30 days after the
 * trial has expired. Presents two promo codes: 50% off for 2 months and
 * 30% off for 6 months. Tone shifts slightly for the 30-day "final" message.
 *
 * Copy is draft — final copy pass pending founder review.
 */
export function trialExpiryReengagementTemplate(params: {
  companyName: string;
  daysSinceExpiry: number;
  promoCode50: string;
  promoCode30: string;
  subscribeUrl: string;
  accentColor: string;
  logoUrl: string | null;
}): string {
  const {
    daysSinceExpiry,
    promoCode50,
    promoCode30,
    subscribeUrl,
    accentColor,
    logoUrl,
    companyName,
  } = params;

  const isFinal = daysSinceExpiry >= 30;

  const heading = isFinal
    ? "Last check-in before we stop"
    : "Still thinking about it?";

  const opener = isFinal
    ? `Your OPS trial ended a month ago. This is the last time I'll knock on the door.`
    : `Your OPS trial ended a week ago. Figured I'd check in once before I stopped.`;

  const middle = isFinal
    ? `I know what it's like to try new software while running a crew &mdash; something always catches fire and the new tool gets shelved. No hard feelings. But if you want to come back, I'm going to make it easy.`
    : `Whatever pulled you away &mdash; bad timing, crew pushback, a fire on another job &mdash; I get it. Running a trades business means everything else gets interrupted by the thing on fire right now.`;

  const body = `
    <h1 style="margin:0 0 12px 0;font-size:22px;font-weight:700;color:#ffffff;line-height:1.3;">
      ${heading}
    </h1>
    <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#d4d4d4;">
      ${opener}
    </p>
    <p style="margin:0 0 20px 0;font-size:15px;line-height:1.6;color:#d4d4d4;">
      ${middle}
    </p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:0 0 24px 0;border-collapse:separate;">
      <tr>
        <td style="background-color:#0f0f0f;border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:20px;">
          <p style="margin:0 0 6px 0;font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;">
            Option A &mdash; 50% off for 2 months
          </p>
          <p style="margin:0;font-size:20px;font-weight:700;font-family:Menlo,Monaco,'Courier New',monospace;color:#ffffff;letter-spacing:0.04em;">
            ${promoCode50}
          </p>
        </td>
      </tr>
      <tr><td style="height:12px;"></td></tr>
      <tr>
        <td style="background-color:#0f0f0f;border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:20px;">
          <p style="margin:0 0 6px 0;font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;">
            Option B &mdash; 30% off for 6 months
          </p>
          <p style="margin:0;font-size:20px;font-weight:700;font-family:Menlo,Monaco,'Courier New',monospace;color:#ffffff;letter-spacing:0.04em;">
            ${promoCode30}
          </p>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#d4d4d4;">
      Your data is still sitting there. Your crew is still one subscription away from opening the app tomorrow morning and knowing exactly where to be.
    </p>
    ${emailButton({ url: subscribeUrl, label: "Come back to OPS", accentColor })}
    <p style="margin:32px 0 0 0;font-size:13px;line-height:1.6;color:#9ca3af;">
      &mdash; Jack<br/>Founder, OPS
    </p>`;

  return emailLayout({
    companyName,
    accentColor,
    logoUrl,
    body,
  });
}
