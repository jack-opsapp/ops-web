import { emailLayout, emailButton } from "./layout";

export function questionsReminderTemplate(params: {
  companyName: string;
  portalUrl: string;
  accentColor: string;
  logoUrl: string | null;
}): string {
  const body = `
    <h1 style="margin:0 0 8px 0;font-size:22px;font-weight:700;color:#e5e5e5;">
      A few quick questions
    </h1>
    <p style="margin:0 0 24px 0;font-size:15px;color:#a7a7a7;line-height:1.5;">
      ${params.companyName} has a few questions about your project to help get things started.
      It only takes a minute to answer.
    </p>
    ${emailButton({ url: params.portalUrl, label: "Answer Questions", accentColor: params.accentColor })}`;

  return emailLayout({
    companyName: params.companyName,
    accentColor: params.accentColor,
    logoUrl: params.logoUrl,
    body,
  });
}
