import { emailLayout, emailButton } from "./layout";

/**
 * Trial expiry warning template — used at 7-day, 5-day, and 1-day marks.
 * No discount offered. Tone escalates as daysRemaining shrinks.
 *
 * Copy is draft — final copy pass pending founder review.
 */
export function trialExpiryWarningTemplate(params: {
  companyName: string;
  daysRemaining: number;
  trialEndDisplay: string;
  subscribeUrl: string;
  accentColor: string;
  logoUrl: string | null;
}): string {
  const { daysRemaining, trialEndDisplay, subscribeUrl, accentColor, logoUrl, companyName } =
    params;

  const heading =
    daysRemaining === 1
      ? "Tomorrow — your OPS trial ends"
      : `${daysRemaining} days left on your OPS trial`;

  const urgencyLine =
    daysRemaining === 1
      ? "This is the last notice before the app locks your crew out."
      : daysRemaining <= 5
        ? "Don't let your team get caught out. Lock in a plan before the trial ends."
        : "Plenty of time to lock it in. Every plan includes every feature.";

  const body = `
    <h1 style="margin:0 0 12px 0;font-size:22px;font-weight:700;color:#EDEDED;line-height:1.3;">
      ${heading}
    </h1>
    <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#d4d4d4;">
      Your trial ends <strong style="color:#EDEDED;">${trialEndDisplay}</strong>. After that, the app locks &mdash; your crew opens it the next morning and sees nothing.
    </p>
    <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#d4d4d4;">
      I built OPS because every other app on the market was built by people who never swung a hammer. If you've made it this far, you've seen the difference. Your crew opens it, knows where to go, and work starts on time. That's the whole point.
    </p>
    <p style="margin:0 0 8px 0;font-size:15px;line-height:1.6;color:#d4d4d4;">
      ${urgencyLine}
    </p>
    ${emailButton({ url: subscribeUrl, label: "Pick your plan", accentColor })}
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
