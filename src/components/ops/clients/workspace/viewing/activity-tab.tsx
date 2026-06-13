"use client";

import { useDictionary } from "@/i18n/client";
import { useClientActivity, type ClientActivityKind } from "@/lib/hooks";
import { formatCurrency } from "@/lib/utils/format";
import { formatDate } from "@/lib/utils/date";
import { Stack } from "@/components/ops/projects/workspace/atoms/stack";
import { Inline } from "@/components/ops/projects/workspace/atoms/inline";
import { Mono } from "@/components/ops/projects/workspace/atoms/mono";
import { Body } from "@/components/ops/projects/workspace/atoms/body";

const KIND_KEY: Record<ClientActivityKind, string> = {
  project_created: "activity.projectCreated",
  invoice_sent: "activity.invoiceSent",
  payment: "activity.payment",
  past_due: "activity.pastDue",
  won: "activity.won",
};

export function ActivityTab({ clientId }: { clientId: string }) {
  const { t } = useDictionary("clients");
  const { events, isLoading } = useClientActivity(clientId);

  if (!isLoading && events.length === 0) {
    return (
      <div className="p-5">
        <Mono size={11} color="mute">
          {t("activity.empty")}
        </Mono>
      </div>
    );
  }

  return (
    <Stack gap={0} className="divide-y divide-glass-border p-5">
      {events.map((e) => (
        <Inline key={e.id} gap={2} align="baseline" className="py-2">
          <Mono size={11} color="mute" className="w-[52px] shrink-0 tabular-nums">
            {formatDate(e.date, "MMM d")}
          </Mono>
          <Body size={14} color="text-2" className="min-w-0 flex-1">
            {t(KIND_KEY[e.kind], { ref: e.ref })}
          </Body>
          {e.amount != null && (
            <span className="shrink-0 font-mono text-[12px] tabular-nums text-text-3">
              {formatCurrency(e.amount)}
            </span>
          )}
        </Inline>
      ))}
    </Stack>
  );
}
