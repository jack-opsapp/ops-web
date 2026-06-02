import { redirect } from "next/navigation";
import { isInboxUiEnabled } from "@/lib/feature-flags/inbox-ui-gate";
import { InboxRoute } from "@/components/ops/inbox/inbox-route";

export default async function InboxThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const [{ threadId }, enabled] = await Promise.all([
    params,
    isInboxUiEnabled(),
  ]);
  if (!enabled) redirect("/pipeline");
  return <InboxRoute threadId={threadId} />;
}
