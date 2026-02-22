import { getFeatureRequests, getAppMessages, getPromoCodes } from "@/lib/admin/admin-queries";
import { AdminPageHeader } from "../_components/admin-page-header";
import { FeedbackContent } from "./_components/feedback-content";

async function fetchFeedbackData() {
  const [featureRequests, appMessages, promoCodes] = await Promise.all([
    getFeatureRequests(),
    getAppMessages(),
    getPromoCodes(),
  ]);
  return { featureRequests, appMessages, promoCodes };
}

export default async function FeedbackPage() {
  let data;
  try {
    data = await fetchFeedbackData();
  } catch (err: unknown) {
    return (
      <div className="p-8">
        <h1 className="text-red-400 font-mohave text-lg mb-4">Feedback Data Fetch Failed</h1>
        <pre className="text-[13px] text-[#E5E5E5] bg-white/[0.05] rounded p-4 whitespace-pre-wrap">
          {err instanceof Error ? `${err.message}\n\n${err.stack}` : String(err)}
        </pre>
      </div>
    );
  }

  return (
    <div>
      <AdminPageHeader
        title="Feedback"
        caption={`${data.featureRequests.length} requests · ${data.appMessages.length} messages · ${data.promoCodes.length} promos`}
      />
      <div className="p-8">
        <FeedbackContent
          featureRequests={data.featureRequests}
          appMessages={data.appMessages}
          promoCodes={data.promoCodes}
        />
      </div>
    </div>
  );
}
