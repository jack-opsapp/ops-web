/** Default auto_send_settings seeded on a newly connected mailbox.
 *  Auto-drafts routine client conversations into the mailbox; never auto-sends.
 *  Keys match the profile-type aliases consumed by the canonical Phase C
 *  category-autonomy service. Missing sensitive/non-client categories remain
 *  draft_on_request through that service's fail-closed fallback. */
export function defaultAutoSendSettings(): {
  auto_draft_enabled: boolean;
  auto_send_enabled: boolean;
  category_autonomy: Record<string, string>;
} {
  return {
    auto_draft_enabled: true,
    auto_send_enabled: false,
    category_autonomy: {
      general: "auto_draft",
      client_quoting: "auto_draft",
      client_followup: "auto_draft",
    },
  };
}

/** Lifecycle statuses for ai_draft_history rows in the mailbox-draft flow.
 *  Single source of truth — later tasks (push, reconciliation, notifications)
 *  import this rather than hardcoding status strings. */
export type AiDraftStatus =
  | "drafted"
  | "sent"
  | "auto_drafted"
  | "sent_from_mailbox"
  | "discarded_in_mailbox"
  | "superseded"
  | "pending";

export interface MailboxDraftRow {
  id: string;
  mailbox_draft_id: string | null;
  status: AiDraftStatus;
}

/** Return an unresolved mailbox draft for a thread so callers update it
 *  rather than creating a duplicate in the user's Drafts folder. Returns
 *  null when there is nothing reusable (no row, resolved row, or a row
 *  that was never placed in the mailbox). */
export function pickExistingMailboxDraft(
  rows: MailboxDraftRow[]
): MailboxDraftRow | null {
  return (
    rows.find(
      (r) => r.mailbox_draft_id != null && r.status === "auto_drafted"
    ) ?? null
  );
}
