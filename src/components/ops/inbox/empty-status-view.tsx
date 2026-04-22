"use client";

/**
 * OPS Web — Inbox Empty-Status View
 *
 * Center-pane content shown when no thread is selected. Three stacked
 * sections: header → velocity → reply-debt → drafts. Each section
 * fetches its own data and owns its loading/error/zero states.
 */

import { motion, useReducedMotion } from "framer-motion";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { EmptyStatusHeader } from "./empty-status-header";
import { EmptyStatusVelocity } from "./empty-status-velocity";
import { EmptyStatusReplyDebt } from "./empty-status-reply-debt";
import { EmptyStatusDrafts } from "./empty-status-drafts";
import type {
  InboxDraftRow,
  InboxThreadRow,
} from "@/lib/hooks/use-inbox-threads";
import type { InboxRail, InboxScope } from "@/lib/types/email-thread";

export interface EmptyStatusViewProps {
  scope: InboxScope;
  unreadCount: number;
  onSelectThread: (row: InboxThreadRow) => void;
  onContinueDraft: (draft: InboxDraftRow) => void;
  onSwitchRail: (rail: InboxRail) => void;
}

export function EmptyStatusView({
  scope,
  unreadCount,
  onSelectThread,
  onContinueDraft,
  onSwitchRail,
}: EmptyStatusViewProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className="h-full overflow-y-auto scrollbar-hide"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: EASE_SMOOTH }}
    >
      <EmptyStatusHeader unreadCount={unreadCount} />
      <EmptyStatusVelocity scope={scope} />
      <EmptyStatusReplyDebt
        scope={scope}
        onSelectThread={onSelectThread}
        onOpenRail={() => onSwitchRail("needs_reply")}
      />
      <EmptyStatusDrafts
        scope={scope}
        onContinueDraft={onContinueDraft}
        onOpenRail={() => onSwitchRail("drafts")}
      />
    </motion.div>
  );
}
