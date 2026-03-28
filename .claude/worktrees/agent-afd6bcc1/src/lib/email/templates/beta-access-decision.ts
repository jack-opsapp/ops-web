import { emailLayout } from "./layout";

export function betaAccessDecisionTemplate(params: {
  userName: string;
  featureTitle: string;
  approved: boolean;
  adminNotes: string | null;
}): string {
  const approvedBody = `
    <h1 style="margin:0 0 8px 0;font-size:22px;font-weight:700;color:#e5e5e5;">
      You're In!
    </h1>
    <p style="margin:0 0 16px 0;font-size:15px;color:#a7a7a7;line-height:1.5;">
      Hey ${params.userName}, your request to test <strong style="color:#e5e5e5;">${params.featureTitle}</strong> has been approved.
    </p>
    <p style="margin:0 0 24px 0;font-size:15px;color:#a7a7a7;line-height:1.5;">
      Open OPS to try it out. We'd love to hear your feedback.
    </p>
    ${params.adminNotes ? `<p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5;border-left:2px solid #597794;padding-left:12px;">${params.adminNotes}</p>` : ""}
  `;

  const rejectedBody = `
    <h1 style="margin:0 0 8px 0;font-size:22px;font-weight:700;color:#e5e5e5;">
      Thanks for Your Interest
    </h1>
    <p style="margin:0 0 16px 0;font-size:15px;color:#a7a7a7;line-height:1.5;">
      Hey ${params.userName}, thanks for requesting access to <strong style="color:#e5e5e5;">${params.featureTitle}</strong>.
    </p>
    <p style="margin:0 0 24px 0;font-size:15px;color:#a7a7a7;line-height:1.5;">
      We're not ready to add more testers at this time, but we'll notify you when it becomes available.
    </p>
    ${params.adminNotes ? `<p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5;border-left:2px solid #597794;padding-left:12px;">${params.adminNotes}</p>` : ""}
  `;

  return emailLayout({
    companyName: "OPS",
    accentColor: "#597794",
    logoUrl: null,
    body: params.approved ? approvedBody : rejectedBody,
  });
}
