import { describe, it, expect } from "vitest";
import {
  pickExistingMailboxDraft,
  type MailboxDraftRow,
} from "@/lib/api/services/mailbox-draft-helpers";

describe("pickExistingMailboxDraft", () => {
  it("returns null when no prior mailbox draft exists for the thread", () => {
    expect(pickExistingMailboxDraft([])).toBeNull();
  });
  it("returns the existing pending mailbox draft to update instead of creating a duplicate", () => {
    const rows: MailboxDraftRow[] = [
      { id: "d1", mailbox_draft_id: "gm_1", status: "auto_drafted" },
    ];
    expect(pickExistingMailboxDraft(rows)).toEqual(rows[0]);
  });
  it("returns the first unresolved mailbox draft when multiple rows exist", () => {
    const rows: MailboxDraftRow[] = [
      { id: "d1", mailbox_draft_id: "gm_1", status: "sent_from_mailbox" },
      { id: "d2", mailbox_draft_id: "gm_2", status: "auto_drafted" },
    ];
    expect(pickExistingMailboxDraft(rows)?.id).toBe("d2");
  });
  it("ignores resolved drafts (sent/discarded/superseded)", () => {
    const rows: MailboxDraftRow[] = [
      { id: "d1", mailbox_draft_id: "gm_1", status: "sent_from_mailbox" },
    ];
    expect(pickExistingMailboxDraft(rows)).toBeNull();
  });
  it("ignores rows with a null mailbox_draft_id (DB-only drafts)", () => {
    const rows: MailboxDraftRow[] = [
      { id: "d1", mailbox_draft_id: null, status: "auto_drafted" },
    ];
    expect(pickExistingMailboxDraft(rows)).toBeNull();
  });
});
