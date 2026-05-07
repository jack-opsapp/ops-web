import { InboxRoute } from "@/components/ops/inbox/inbox-route";

interface InboxThreadPageProps {
  params: { threadId: string };
}

export default function InboxThreadPage({ params }: InboxThreadPageProps) {
  return <InboxRoute threadId={params.threadId} />;
}
