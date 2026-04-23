import { emailLayout, emailButton } from "./layout";

/**
 * Trial expiry discount template — used at the 3-day-before mark.
 * Presents two promo codes: 50% off for 2 months, and 30% off for 6 months.
 * User enters whichever code they prefer at checkout.
 *
 * Copy is draft — final copy pass pending founder review.
 */
export function trialExpiryDiscountTemplate(params: {
  companyName: string;
  daysRemaining: number;
  trialEndDisplay: string;
  promoCode50: string;
  promoCode30: string;
  subscribeUrl: string;
  accentColor: string;
  logoUrl: string | null;
}): string {
  const {
    daysRemaining,
    trialEndDisplay,
    promoCode50,
    promoCode30,
    subscribeUrl,
    accentColor,
    logoUrl,
    companyName,
  } = params;

  const body = `
    <h1 style="margin:0 0 12px 0;font-size:22px;font-weight:700;color:#EDEDED;line-height:1.3;">
      ${daysRemaining} days left &mdash; 50% off or 30% off, your call
    </h1>
    <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#d4d4d4;">
      Your OPS trial ends <strong style="color:#EDEDED;">${trialEndDisplay}</strong>.
    </p>
    <p style="margin:0 0 20px 0;font-size:15px;line-height:1.6;color:#d4d4d4;">
      Before that happens, I want to put something on the table. Two codes. Your choice at checkout.
    </p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:0 0 24px 0;border-collapse:separate;">
      <tr>
        <td style="background-color:#0f0f0f;border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:20px;">
          <p style="margin:0 0 6px 0;font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;">
            Option A &mdash; 50% off for 2 months
          </p>
          <p style="margin:0;font-size:20px;font-weight:700;font-family:Menlo,Monaco,'Courier New',monospace;color:#EDEDED;letter-spacing:0.04em;">
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
          <p style="margin:0;font-size:20px;font-weight:700;font-family:Menlo,Monaco,'Courier New',monospace;color:#EDEDED;letter-spacing:0.04em;">
            ${promoCode30}
          </p>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#d4d4d4;">
      If you're still getting the feel for it and want to save the most up front, use Option A. If you want a longer runway at a discount, use Option B. Same app either way &mdash; every tier gets every feature.
    </p>
    ${emailButton({ url: subscribeUrl, label: "Subscribe with your code", accentColor })}
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
