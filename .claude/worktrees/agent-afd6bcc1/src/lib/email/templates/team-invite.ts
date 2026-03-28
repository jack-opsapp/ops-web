import { emailLayout, emailButton } from "./layout";

export function teamInviteTemplate(params: {
  companyName: string;
  joinUrl: string;
  accentColor: string;
  logoUrl: string | null;
}): string {
  const body = `
    <h1 style="margin:0 0 8px 0;font-size:22px;font-weight:700;color:#e5e5e5;">
      You're invited to join ${params.companyName}
    </h1>
    <p style="margin:0 0 24px 0;font-size:15px;color:#a7a7a7;line-height:1.5;">
      Your team is using OPS to manage projects, schedules, and crews.
      Click below to join and get started.
    </p>
    ${emailButton({ url: params.joinUrl, label: `Join ${params.companyName}`, accentColor: params.accentColor })}
    <p style="margin:24px 0 0 0;font-size:12px;color:#6b7280;line-height:1.5;">
      If you didn't expect this invite, you can safely ignore this email.
    </p>`;

  return emailLayout({
    companyName: params.companyName,
    accentColor: params.accentColor,
    logoUrl: params.logoUrl,
    body,
  });
}
