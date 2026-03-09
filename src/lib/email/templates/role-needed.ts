import { emailLayout, emailButton } from "./layout";

export function roleNeededTemplate(params: {
  userName: string;
  companyName: string;
  assignUrl: string;
  accentColor: string;
  logoUrl: string | null;
}): string {
  const body = `
    <h1 style="margin:0 0 8px 0;font-size:22px;font-weight:700;color:#e5e5e5;">
      New team member needs a role
    </h1>
    <p style="margin:0 0 24px 0;font-size:15px;color:#a7a7a7;line-height:1.5;">
      <strong style="color:#e5e5e5;">${params.userName}</strong> has joined
      ${params.companyName} and needs a role assigned.
      Until a role is assigned, they'll have limited access.
    </p>
    ${emailButton({ url: params.assignUrl, label: "Assign Role", accentColor: params.accentColor })}
    <p style="margin:24px 0 0 0;font-size:12px;color:#6b7280;line-height:1.5;">
      Go to Settings &rarr; Team to manage roles and permissions.
    </p>`;

  return emailLayout({
    companyName: params.companyName,
    accentColor: params.accentColor,
    logoUrl: params.logoUrl,
    body,
  });
}
