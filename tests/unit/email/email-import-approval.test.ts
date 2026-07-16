import { describe, expect, it } from "vitest";

import {
  EmailImportApprovalError,
  approveEmailImportPayload,
  fingerprintEmailImportPayload,
} from "@/lib/email/email-import-approval";
import type {
  AnalysisResult,
  ImportPayload,
} from "@/lib/types/email-import";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const CONNECTION_ID = "22222222-2222-4222-8222-222222222222";

function sourceResult(): NonNullable<AnalysisResult["result"]> {
  return {
    estimatePattern: "estimate",
    estimatePatternConfidence: 0.9,
    estimateThreadCount: 1,
    detectedSources: [
      {
        type: "estimate_pattern",
        label: "Estimate requests",
        pattern: "estimate",
        count: 1,
        enabled: true,
        sampleEmails: [],
      },
      {
        type: "platform",
        label: "Website leads",
        pattern: "wix",
        count: 1,
        enabled: true,
        sampleEmails: [],
      },
    ],
    companyDomains: ["canpro.example"],
    teamForwarders: ["office@canpro.example"],
    leads: [
      {
        id: "lead-1",
        threadId: "thread-1",
        providerThreadId: "thread-1",
        emails: [
          {
            id: "message-1",
            providerThreadId: "thread-1",
            from: "Client <client@example.com>",
            subject: "Estimate request",
            date: "2026-07-10T10:00:00.000Z",
            direction: "inbound",
          },
          {
            id: "message-2",
            providerThreadId: "thread-1",
            from: "office@canpro.example",
            subject: "Re: Estimate request",
            date: "2026-07-10T11:00:00.000Z",
            direction: "outbound",
          },
        ],
        client: {
          name: "Client Name",
          email: "client@example.com",
          phone: "250-555-0100",
          description: "Deck estimate",
          address: "100 Main Street",
        },
        stage: "quoted",
        stageConfidence: 0.8,
        estimatedValue: 12_500,
        correspondenceCount: 2,
        outboundCount: 1,
        lastMessageDate: "2026-07-10T11:00:00.000Z",
        source: "ai",
        sourceLabel: "Email",
        duplicateGroupId: null,
        subContacts: [
          {
            name: "Site Contact",
            email: "site@example.com",
            phone: null,
          },
        ],
        matchResult: {
          existingClientId: null,
          existingClientName: null,
          action: "create_new",
          confidence: "high",
        },
        enabled: true,
      },
    ],
    totalScanned: 2,
  };
}

function submittedPayload(): ImportPayload {
  const source = sourceResult().leads[0];
  return {
    connectionId: CONNECTION_ID,
    companyId: COMPANY_ID,
    leads: [
      {
        id: source.id,
        threadId: source.threadId,
        providerThreadId: source.providerThreadId,
        emails: source.emails,
        clientName: "Client Name Edited",
        clientEmail: source.client.email,
        clientPhone: "attacker-controlled-phone",
        clientAddress: "attacker-controlled-address",
        description: "attacker-controlled-description",
        stage: "won",
        estimatedValue: 999_999,
        correspondenceCount: source.correspondenceCount,
        outboundCount: source.outboundCount,
        lastMessageDate: source.lastMessageDate,
        lastInboundAt: "2026-07-10T10:00:00.000Z",
        lastOutboundAt: "2026-07-10T11:00:00.000Z",
        lastMessageDirection: "outbound",
        existingClientId: null,
        action: "create_new",
        mergeWithLeadId: null,
        subContacts: [],
        title: "Rear deck",
        actualCloseDate: source.lastMessageDate,
      },
    ],
    syncProfile: {
      estimateSubjectPatterns: ["estimate"],
      companyDomains: ["evil.example"],
      teamForwarders: ["evil@example.com"],
      knownPlatformSenders: ["wix"],
      formSubjectPatterns: ["estimate"],
      userEmailAddresses: ["evil@example.com"],
      aiClassificationThreshold: 1,
    },
  };
}

function approve(payload = submittedPayload(), result = sourceResult()) {
  return approveEmailImportPayload({
    submitted: payload,
    sourceResult: result,
    expectedCompanyId: COMPANY_ID,
    expectedConnectionId: CONNECTION_ID,
    expectedConnectionEmail: "office@canpro.example",
  });
}

describe("email import approval", () => {
  it("keeps only bounded review edits and derives all provider evidence from the durable scan", () => {
    const approved = approve();
    const lead = approved.leads[0];

    expect(lead).toMatchObject({
      id: "lead-1",
      threadId: "thread-1",
      providerThreadId: "thread-1",
      clientName: "Client Name Edited",
      clientEmail: "client@example.com",
      clientPhone: "250-555-0100",
      clientAddress: "100 Main Street",
      description: "Deck estimate",
      stage: "won",
      estimatedValue: 12_500,
      correspondenceCount: 2,
      outboundCount: 1,
      lastInboundAt: "2026-07-10T10:00:00.000Z",
      lastOutboundAt: "2026-07-10T11:00:00.000Z",
      lastMessageDirection: "outbound",
      actualCloseDate: "2026-07-10T11:00:00.000Z",
      title: "Rear deck",
    });
    expect(lead.emails).toEqual(sourceResult().leads[0].emails);
    expect(lead.subContacts).toEqual(sourceResult().leads[0].subContacts);
    expect(approved.syncProfile).toEqual({
      estimateSubjectPatterns: ["estimate"],
      companyDomains: ["canpro.example"],
      teamForwarders: ["office@canpro.example"],
      knownPlatformSenders: ["wix"],
      formSubjectPatterns: ["estimate"],
      userEmailAddresses: ["office@canpro.example"],
      aiClassificationThreshold: 0.7,
    });
  });

  it.each([
    ["logical thread", (payload: ImportPayload) => (payload.leads[0].threadId = "thread-forged")],
    [
      "provider thread",
      (payload: ImportPayload) => (payload.leads[0].providerThreadId = "thread-forged"),
    ],
    [
      "provider message",
      (payload: ImportPayload) => (payload.leads[0].emails![0].id = "message-forged"),
    ],
    [
      "customer email",
      (payload: ImportPayload) => (payload.leads[0].clientEmail = "victim@example.com"),
    ],
  ])("rejects a spoofed %s identity", (_label, mutate) => {
    const payload = submittedPayload();
    mutate(payload);
    expect(() => approve(payload)).toThrowError(EmailImportApprovalError);
  });

  it("rejects unknown and duplicate lead IDs instead of importing caller-created rows", () => {
    const unknown = submittedPayload();
    unknown.leads[0].id = "lead-forged";
    expect(() => approve(unknown)).toThrowError(/not in the approved scan/i);

    const duplicate = submittedPayload();
    duplicate.leads.push(structuredClone(duplicate.leads[0]));
    expect(() => approve(duplicate)).toThrowError(/duplicate lead/i);
  });

  it("normalizes a review-only source action without trusting the cast client value", () => {
    const result = sourceResult();
    result.leads[0].matchResult.action = "review";
    const payload = submittedPayload();
    (payload.leads[0] as { action: string }).action = "review";

    expect(approve(payload, result).leads[0].action).toBe("create_new");
  });

  it("rejects source scans whose aggregate counts do not match exact messages", () => {
    const result = sourceResult();
    result.leads[0].correspondenceCount = 99;
    expect(() => approve(submittedPayload(), result)).toThrowError(
      /reanalyze/i
    );
  });

  it("rejects unapproved sync-profile patterns", () => {
    const payload = submittedPayload();
    payload.syncProfile.knownPlatformSenders.push("attacker-pattern");
    expect(() => approve(payload)).toThrowError(/sync profile/i);
  });

  it("produces a deterministic fingerprint that changes with a real review decision", () => {
    const first = approve();
    const second = approve();
    expect(fingerprintEmailImportPayload(first)).toBe(
      fingerprintEmailImportPayload(second)
    );

    second.leads[0].stage = "lost";
    expect(fingerprintEmailImportPayload(first)).not.toBe(
      fingerprintEmailImportPayload(second)
    );
  });
});
