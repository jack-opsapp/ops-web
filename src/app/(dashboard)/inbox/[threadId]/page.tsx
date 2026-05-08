import { InboxRoute } from "@/components/ops/inbox/inbox-route";

export default async function InboxThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId } = await params;
  return <InboxRoute threadId={threadId} />;
}
