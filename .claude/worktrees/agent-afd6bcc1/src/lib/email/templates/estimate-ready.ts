import { emailLayout, emailButton } from "./layout";

export function estimateReadyTemplate(params: {
  companyName: string;
  estimateNumber: string;
  portalUrl: string;
  accentColor: string;
  logoUrl: string | null;
}): string {
  const body = `
    <h1 style="margin:0 0 8px 0;font-size:22px;font-weight:700;color:#e5e5e5;">
      Your estimate is ready
    </h1>
    <p style="margin:0 0 16px 0;font-size:15px;color:#a7a7a7;line-height:1.5;">
      ${params.companyName} has prepared estimate <strong style="color:#e5e5e5;">#${params.estimateNumber}</strong> for you.
    </p>
    <p style="margin:0 0 24px 0;font-size:15px;color:#a7a7a7;line-height:1.5;">
      View the details, approve, or request changes — all from your portal.
    </p>
    ${emailButton({ url: params.portalUrl, label: "View Estimate", accentColor: params.accentColor })}`;

  return emailLayout({
    companyName: params.companyName,
    accentColor: params.accentColor,
    logoUrl: params.logoUrl,
    body,
  });
}
