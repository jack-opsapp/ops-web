import {
  getEmailOverviewStats,
  getEmailEngagementStats,
  getEmailFunnelData,
  getEmailLog,
  getNewsletters,
} from "@/lib/admin/email-queries";
import { AdminPageHeader } from "../_components/admin-page-header";
import { EmailContent } from "./_components/email-content";

async function fetchEmailData() {
  const [overview, engagement, funnels, emailLog, newsletters] = await Promise.all([
    getEmailOverviewStats(),
    getEmailEngagementStats(),
    getEmailFunnelData(),
    getEmailLog(200),
    getNewsletters(),
  ]);

  return { overview, engagement, funnels, emailLog, newsletters };
}

export default async function EmailPage() {
  let data;
  try {
    data = await fetchEmailData();
  } catch (err: unknown) {
    return (
      <div className="p-8">
        <h1 className="text-red-400 font-mohave text-lg mb-4">Email Data Fetch Failed</h1>
        <pre className="text-[13px] text-[#E5E5E5] bg-white/[0.05] rounded p-4 whitespace-pre-wrap">
          {err instanceof Error ? `${err.message}\n\n${err.stack}` : String(err)}
        </pre>
      </div>
    );
  }

  return (
    <div>
      <AdminPageHeader title="Email" caption="trickle system monitoring" />
      <div className="p-8">
        <EmailContent
          overview={data.overview}
          engagement={data.engagement}
          funnels={data.funnels}
          emailLog={data.emailLog}
          newsletters={data.newsletters}
        />
      </div>
    </div>
  );
}
