import { InboxShell } from "@/components/ops/inbox/inbox-shell";

interface InboxThreadPageProps {
  params: { threadId: string };
}

export default function InboxThreadPage({ params }: InboxThreadPageProps) {
  return (
    <InboxShell
      threadList={
        <div className="p-4 font-mono text-text-3">
          {"// THREAD LIST :: PHASE 2"}
        </div>
      }
      detail={
        <div className="p-4 font-mono text-text-3">
          {`// THREAD :: ${params.threadId}`}
        </div>
      }
      contextRail={
        <div className="p-4 font-mono text-text-3">
          {"// CONTEXT :: PHASE 5"}
        </div>
      }
    />
  );
}
