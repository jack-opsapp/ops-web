import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const EMAIL_MIGRATIONS = [
  "20260715162000_email_send_intents.sql",
  "20260715163000_phase_c_auto_send_queue.sql",
  "20260715164000_personal_mailbox_disable_lifecycle.sql",
  "20260715170000_email_autonomy_milestones.sql",
  "20260715171000_approved_action_email_transport.sql",
  "20260715173000_email_conversion_photo_materialization.sql",
  "20260715174000_email_analysis_requester_fence.sql",
  "20260715175000_email_interaction_atomic_writes.sql",
  "20260715176000_email_import_approval_lifecycle.sql",
  "20260715177000_email_opportunity_notification_delivery.sql",
  "20260715177500_email_attachment_notification_identity.sql",
  "20260715178000_email_assignment_contact_form_drafts.sql",
  "20260715179000_email_outbound_learning_assignment_hardening.sql",
] as const;

describe("email actor active-state authorization", () => {
  it("never treats a NULL active flag as an active OPS user", () => {
    for (const name of EMAIL_MIGRATIONS) {
      const sql = readFileSync(
        resolve(process.cwd(), "supabase/migrations", name),
        "utf8"
      ).toLowerCase();

      expect(sql, name).not.toMatch(/coalesce\([^)]*\.is_active,\s*true\)/);
      expect(sql, name).not.toMatch(
        /\.is_active\s+is\s+distinct\s+from\s+false/
      );
    }
  });
});
