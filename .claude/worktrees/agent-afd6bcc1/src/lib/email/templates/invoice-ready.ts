import { emailLayout, emailButton } from "./layout";

export function invoiceReadyTemplate(params: {
  companyName: string;
  invoiceNumber: string;
  amount: string;
  portalUrl: string;
  accentColor: string;
  logoUrl: string | null;
}): string {
  const body = `
    <h1 style="margin:0 0 8px 0;font-size:22px;font-weight:700;color:#e5e5e5;">
      Invoice ready for payment
    </h1>
    <p style="margin:0 0 16px 0;font-size:15px;color:#a7a7a7;line-height:1.5;">
      ${params.companyName} has sent you invoice <strong style="color:#e5e5e5;">#${params.invoiceNumber}</strong>.
    </p>
    <div style="background-color:rgba(255,255,255,0.04);border-radius:8px;padding:16px;text-align:center;margin-bottom:24px;">
      <p style="margin:0 0 4px 0;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;">Amount Due</p>
      <p style="margin:0;font-size:28px;font-weight:700;color:#e5e5e5;">${params.amount}</p>
    </div>
    ${emailButton({ url: params.portalUrl, label: "View & Pay", accentColor: params.accentColor })}`;

  return emailLayout({
    companyName: params.companyName,
    accentColor: params.accentColor,
    logoUrl: params.logoUrl,
    body,
  });
}
