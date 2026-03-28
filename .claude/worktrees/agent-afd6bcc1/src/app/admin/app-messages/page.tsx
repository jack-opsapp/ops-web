import { getAppMessages } from "@/lib/admin/admin-queries";
import { AdminPageHeader } from "../_components/admin-page-header";
import { AppMessagesContent } from "./_components/app-messages-content";

export default async function AppMessagesPage() {
  let messages;
  try {
    messages = await getAppMessages();
  } catch (err: unknown) {
    return (
      <div className="p-8">
        <h1 className="text-red-400 font-mohave text-lg mb-4">App Messages Fetch Failed</h1>
        <pre className="text-[13px] text-[#E5E5E5] bg-white/[0.05] rounded p-4 whitespace-pre-wrap">
          {err instanceof Error ? `${err.message}\n\n${err.stack}` : String(err)}
        </pre>
      </div>
    );
  }

  return (
    <div>
      <AdminPageHeader
        title="App Messages"
        caption={`${messages.length} messages · ${messages.filter((m) => m.active).length} active`}
      />
      <div className="p-8">
        <AppMessagesContent initialMessages={messages} />
      </div>
    </div>
  );
}
