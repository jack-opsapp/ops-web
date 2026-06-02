import { redirect } from "next/navigation";
import { isInboxUiEnabled } from "@/lib/feature-flags/inbox-ui-gate";
import { InboxRoute } from "@/components/ops/inbox/inbox-route";

export default async function InboxPage() {
  const enabled = await isInboxUiEnabled();
  if (!enabled) redirect("/pipeline");
  return <InboxRoute />;
}
