import { emailLayout, emailButton } from "./layout";

export function betaAccessRequestTemplate(params: {
  userName: string;
  userEmail: string;
  companyName: string;
  companyPhone: string;
  companyAddress: string;
  companySize: string;
  companyIndustries: string[];
  featureTitle: string;
  featureDescription: string;
  adminUrl: string;
}): string {
  const industries = params.companyIndustries.length > 0
    ? params.companyIndustries.join(", ")
    : "Not specified";

  const body = `
    <h1 style="margin:0 0 8px 0;font-size:22px;font-weight:700;color:#e5e5e5;">
      Beta Access Request
    </h1>
    <p style="margin:0 0 24px 0;font-size:15px;color:#a7a7a7;line-height:1.5;">
      A user has requested beta access to a feature.
    </p>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:24px;">
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
          <span style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;">Feature</span><br/>
          <span style="font-size:16px;font-weight:600;color:#e5e5e5;">${params.featureTitle}</span><br/>
          <span style="font-size:13px;color:#a7a7a7;">${params.featureDescription}</span>
        </td>
      </tr>
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
          <span style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;">User</span><br/>
          <span style="font-size:15px;color:#e5e5e5;">${params.userName}</span><br/>
          <span style="font-size:13px;color:#a7a7a7;">${params.userEmail}</span>
        </td>
      </tr>
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
          <span style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;">Company</span><br/>
          <span style="font-size:15px;color:#e5e5e5;">${params.companyName}</span><br/>
          <span style="font-size:13px;color:#a7a7a7;">Phone: ${params.companyPhone || "\u2014"}</span><br/>
          <span style="font-size:13px;color:#a7a7a7;">Address: ${params.companyAddress || "\u2014"}</span><br/>
          <span style="font-size:13px;color:#a7a7a7;">Size: ${params.companySize || "\u2014"}</span><br/>
          <span style="font-size:13px;color:#a7a7a7;">Industries: ${industries}</span>
        </td>
      </tr>
    </table>

    ${emailButton({ url: params.adminUrl, label: "Review in Admin Panel", accentColor: "#597794" })}
  `;

  return emailLayout({
    companyName: "OPS",
    accentColor: "#597794",
    logoUrl: null,
    body,
  });
}
