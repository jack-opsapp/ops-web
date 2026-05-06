import { InboxShell } from "@/components/ops/inbox/inbox-shell";

export default function InboxPage() {
  return (
    <InboxShell
      threadList={
        <div className="p-4 font-mono text-text-3">
          {"// THREAD LIST :: PHASE 2"}
        </div>
      }
      detail={
        <div className="p-4 font-mono text-text-3">
          {"// DETAIL :: PHASE 3"}
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
