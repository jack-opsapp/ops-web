import { emailLayout, emailButton } from "./layout";

export function magicLinkTemplate(params: {
  companyName: string;
  portalUrl: string;
  accentColor: string;
  logoUrl: string | null;
}): string {
  const body = `
    <h1 style="margin:0 0 8px 0;font-size:22px;font-weight:700;color:#e5e5e5;">
      Welcome to your portal
    </h1>
    <p style="margin:0 0 24px 0;font-size:15px;color:#a7a7a7;line-height:1.5;">
      ${params.companyName} has shared project information with you.
      Click the button below to access your portal — you'll need to verify your email address.
    </p>
    ${emailButton({ url: params.portalUrl, label: "Access Portal", accentColor: params.accentColor })}
    <p style="margin:24px 0 0 0;font-size:12px;color:#6b7280;line-height:1.5;">
      This link expires in 7 days. If you didn't expect this email, you can safely ignore it.
    </p>`;

  return emailLayout({
    companyName: params.companyName,
    accentColor: params.accentColor,
    logoUrl: params.logoUrl,
    body,
  });
}
