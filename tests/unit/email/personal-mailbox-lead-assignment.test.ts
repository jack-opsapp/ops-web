import { describe, expect, it, vi } from "vitest";

import { assignPersonalMailboxLead } from "@/lib/email/personal-mailbox-lead-assignment";

function client(result: { data: unknown; error: unknown }) {
  return {
    rpc: vi.fn().mockResolvedValue(result),
  };
}

const base = {
  connectionType: "individual" as const,
  connectionId: "connection-1",
  connectionOwnerId: "user-1",
  opportunityId: "opportunity-1",
  expectedAssignmentVersion: 0,
  expectedAssignedTo: null,
  providerThreadId: "provider-thread-1",
};

describe("assignPersonalMailboxLead", () => {
  it("keeps company-mailbox leads out of the split personal assignment path", async () => {
    const db = client({ data: null, error: null });

    await expect(
      assignPersonalMailboxLead(
        { ...base, connectionType: "company" },
        db as never
      )
    ).resolves.toEqual({ assigned: false, reason: "company_mailbox" });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("uses the guarded system RPC with the canonical owner UUID", async () => {
    const db = client({
      data: {
        ok: true,
        conflict: false,
        assigned_to: "user-1",
        assignment_version: 1,
        event_id: "event-1",
      },
      error: null,
    });

    await expect(assignPersonalMailboxLead(base, db as never)).resolves.toEqual(
      {
        assigned: true,
        assignmentVersion: 1,
        eventId: "event-1",
      }
    );
    expect(db.rpc).toHaveBeenCalledWith(
      "change_opportunity_assignment_as_system",
      {
        p_opportunity_id: "opportunity-1",
        p_expected_assignment_version: 0,
        p_expected_assigned_to: null,
        p_new_assigned_to: "user-1",
        p_system_source: "personal_mailbox",
        p_actor_user_id: null,
        p_suggestion_id: null,
        p_metadata: {
          connection_id: "connection-1",
          provider_thread_id: "provider-thread-1",
          ingestion_source: "email_sync",
        },
      }
    );
  });

  it("records historical import provenance without changing assignment authority", async () => {
    const db = client({
      data: {
        ok: true,
        conflict: false,
        assigned_to: "user-1",
        assignment_version: 1,
        event_id: "event-1",
      },
      error: null,
    });

    await assignPersonalMailboxLead(
      { ...base, ingestionSource: "email_import" },
      db as never
    );

    expect(db.rpc).toHaveBeenCalledWith(
      "change_opportunity_assignment_as_system",
      expect.objectContaining({
        p_new_assigned_to: "user-1",
        p_actor_user_id: null,
        p_metadata: expect.objectContaining({
          ingestion_source: "email_import",
        }),
      })
    );
  });

  it("marks exact recovery assignments so provider-draft triggers stay suppressed", async () => {
    const db = client({
      data: {
        ok: true,
        conflict: false,
        assigned_to: "user-1",
        assignment_version: 1,
        event_id: "event-1",
      },
      error: null,
    });

    await assignPersonalMailboxLead(
      {
        ...base,
        ingestionSource: "email_recovery",
        providerMutationsDisabled: true,
      },
      db as never
    );

    expect(db.rpc).toHaveBeenCalledWith(
      "change_opportunity_assignment_as_system",
      expect.objectContaining({
        p_metadata: expect.objectContaining({
          ingestion_source: "email_recovery",
          provider_mutations_disabled: true,
        }),
      })
    );
  });

  it("leaves an ineligible personal owner unassigned", async () => {
    const db = client({
      data: null,
      error: { message: "assignment_target_ineligible" },
    });

    await expect(assignPersonalMailboxLead(base, db as never)).resolves.toEqual(
      {
        assigned: false,
        reason: "owner_ineligible",
      }
    );
  });

  it("fails semantic ingestion on an unexpected assignment error", async () => {
    const db = client({
      data: null,
      error: { message: "database unavailable" },
    });

    await expect(assignPersonalMailboxLead(base, db as never)).rejects.toThrow(
      "Personal mailbox lead assignment failed: database unavailable"
    );
  });

  it("does not overwrite a lead already assigned by a competing operation", async () => {
    const db = client({ data: null, error: null });

    await expect(
      assignPersonalMailboxLead(
        {
          ...base,
          expectedAssignmentVersion: 2,
          expectedAssignedTo: "user-2",
        },
        db as never
      )
    ).resolves.toEqual({ assigned: false, reason: "already_assigned" });
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
