import "server-only";

import type { TaskAutomationPersistenceGuard } from "@/lib/types/approval-queue";
import { requireSupabase } from "@/lib/supabase/helpers";

export const TaskAutomationPersistenceService = {
  async persistNotification(
    guard: TaskAutomationPersistenceGuard,
    copy: {
      title: string;
      body: string;
      actionUrl?: string | null;
      actionLabel?: string | null;
    }
  ): Promise<{ created: boolean }> {
    const supabase = requireSupabase();
    const { data, error } = await supabase.rpc(
      "persist_task_automation_notification",
      {
        p_event_id: guard.eventId,
        p_lease_token: guard.leaseToken,
        p_task_id: guard.taskId,
        p_task_schedule_version: guard.scheduleVersion,
        p_title: copy.title,
        p_body: copy.body,
        p_action_url: copy.actionUrl ?? "/schedule",
        p_action_label: copy.actionLabel ?? null,
      }
    );
    if (error) {
      throw new Error(
        `Failed to persist task automation notification: ${error.message}`
      );
    }
    const result = data as Record<string, unknown> | null;
    if (!result || typeof result.created !== "boolean") {
      throw new Error(
        "Task automation notification returned an invalid result"
      );
    }
    return { created: result.created };
  },
};
