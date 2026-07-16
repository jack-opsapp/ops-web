import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  completeEmailImportJob,
  createOrResumeEmailImportJob,
  EmailImportJobAccessError,
  loadAuthorizedEmailImportJob,
  loadEmailImportSourceForActor,
} from "@/lib/email/email-import-job-access";
import { fingerprintEmailImportPayload } from "@/lib/email/email-import-approval";
import type { ImportPayload } from "@/lib/types/email-import";

const payload: ImportPayload = {
  companyId: "company-1",
  connectionId: "connection-1",
  leads: [
    {
      id: "lead-1",
      threadId: "thread-1",
      providerThreadId: "thread-1",
      emails: [],
      clientName: "Customer",
      clientEmail: "customer@example.com",
      clientPhone: null,
      clientAddress: null,
      description: "Estimate request",
      stage: "new_lead",
      estimatedValue: null,
      correspondenceCount: 1,
      outboundCount: 0,
      lastMessageDate: "2026-07-15T00:00:00.000Z",
      lastInboundAt: "2026-07-15T00:00:00.000Z",
      lastOutboundAt: null,
      lastMessageDirection: "inbound",
      existingClientId: null,
      action: "create_new",
      mergeWithLeadId: null,
      title: null,
      actualCloseDate: null,
    },
  ],
  syncProfile: {
    estimateSubjectPatterns: [],
    companyDomains: [],
    teamForwarders: [],
    knownPlatformSenders: [],
    formSubjectPatterns: [],
    userEmailAddresses: [],
    aiClassificationThreshold: 0.7,
  },
};

function database(data: unknown, error: { message: string } | null = null) {
  const db = {
    rpc: vi.fn(async () => ({ data, error })),
  };
  return db as typeof db & SupabaseClient;
}

describe("durable email import job access", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads a completed source using only the canonical actor and mailbox ID", async () => {
    const db = database({
      sourceScanJobId: "scan-1",
      companyId: "company-1",
      connectionId: "connection-1",
      connectionEmail: "shared@example.com",
      connectionOwnerUserId: null,
      connectionType: "company",
      result: { leads: [] },
    });

    await expect(
      loadEmailImportSourceForActor({
        supabase: db,
        actorUserId: "user-1",
        connectionId: "connection-1",
      })
    ).resolves.toMatchObject({
      sourceScanJobId: "scan-1",
      connectionOwnerUserId: null,
      connectionType: "company",
    });
    expect(db.rpc).toHaveBeenCalledWith(
      "get_email_import_source_as_system",
      {
        p_actor_user_id: "user-1",
        p_connection_id: "connection-1",
      }
    );
  });

  it("persists the exact approved payload and returns the single dispatch winner", async () => {
    const db = database({
      jobId: "job-1",
      shouldDispatch: true,
      resumed: false,
    });
    const fingerprint = fingerprintEmailImportPayload(payload);

    await expect(
      createOrResumeEmailImportJob({
        supabase: db,
        actorUserId: "user-1",
        sourceScanJobId: "scan-1",
        approvedPayload: payload,
        approvalFingerprint: fingerprint,
      })
    ).resolves.toEqual({
      jobId: "job-1",
      shouldDispatch: true,
      resumed: false,
    });
    expect(db.rpc).toHaveBeenCalledWith(
      "create_email_import_job_as_system",
      expect.objectContaining({
        p_actor_user_id: "user-1",
        p_source_scan_job_id: "scan-1",
        p_approved_payload: payload,
        p_approval_fingerprint: fingerprint,
      })
    );
  });

  it("reloads the durable actor, mailbox snapshot, and payload for background work", async () => {
    const fingerprint = fingerprintEmailImportPayload(payload);
    const db = database({
      jobId: "job-1",
      sourceScanJobId: "scan-1",
      actorUserId: "user-1",
      companyId: "company-1",
      connectionId: "connection-1",
      connectionOwnerUserId: "user-1",
      connectionType: "individual",
      approvalFingerprint: fingerprint,
      approvedPayload: payload,
    });

    await expect(
      loadAuthorizedEmailImportJob({ supabase: db, jobId: "job-1" })
    ).resolves.toMatchObject({
      actorUserId: "user-1",
      connectionOwnerUserId: "user-1",
      approvedPayload: payload,
    });
  });

  it("commits the result and mailbox checkpoint through one service RPC", async () => {
    const db = database(true);
    const result = {
      clientsCreated: 1,
      leadsCreated: 1,
      activitiesLogged: 1,
      labelsApplied: 0,
      imagesExtracted: 0,
      errors: [],
    };
    const progress = { stage: "import_complete", percent: 100 };

    await expect(
      completeEmailImportJob({
        supabase: db,
        jobId: "job-1",
        result,
        progress,
      })
    ).resolves.toBeUndefined();
    expect(db.rpc).toHaveBeenCalledWith(
      "complete_email_import_job_as_system",
      {
        p_job_id: "job-1",
        p_result: result,
        p_progress: progress,
      }
    );
  });

  it("fails closed when durable JSON no longer matches its approval fingerprint", async () => {
    const db = database({
      jobId: "job-1",
      sourceScanJobId: "scan-1",
      actorUserId: "user-1",
      companyId: "company-1",
      connectionId: "connection-1",
      connectionOwnerUserId: null,
      connectionType: "company",
      approvalFingerprint: "0".repeat(64),
      approvedPayload: payload,
    });

    await expect(
      loadAuthorizedEmailImportJob({ supabase: db, jobId: "job-1" })
    ).rejects.toMatchObject({
      reason: "fingerprint_mismatch",
    } satisfies Partial<EmailImportJobAccessError>);
  });

  it("does not reinterpret malformed or failed service responses", async () => {
    await expect(
      loadEmailImportSourceForActor({
        supabase: database(null, { message: "forbidden" }),
        actorUserId: "user-1",
        connectionId: "connection-1",
      })
    ).rejects.toMatchObject({
      reason: "rpc_failed",
    } satisfies Partial<EmailImportJobAccessError>);

    await expect(
      createOrResumeEmailImportJob({
        supabase: database({ jobId: "job-1" }),
        actorUserId: "user-1",
        sourceScanJobId: "scan-1",
        approvedPayload: payload,
        approvalFingerprint: fingerprintEmailImportPayload(payload),
      })
    ).rejects.toMatchObject({
      reason: "invalid_response",
    } satisfies Partial<EmailImportJobAccessError>);
  });
});
