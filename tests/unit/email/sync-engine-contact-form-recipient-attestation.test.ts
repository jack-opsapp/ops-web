import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "src/lib/api/services/sync-engine.ts"),
  "utf8"
);
const compact = source.replace(/\s+/g, " ");

function sourceFunction(name: string, nextName: string): string {
  const start = source.indexOf(name);
  const end = source.indexOf(nextName, start + name.length);
  if (start < 0 || end < 0) return "";
  return source.slice(start, end);
}

const attestationHelper = sourceFunction(
  "async function attestContactFormRecipient",
  "async function createOrAdoptInboundActivity"
);
const createOrAdopt = sourceFunction(
  "async function createOrAdoptInboundActivity",
  "async function updateCorrespondenceCounts"
);

describe("sync-engine contact-form recipient attestation", () => {
  it("calls only the service-only exact-source attestation RPC", () => {
    expect(attestationHelper).toContain(
      '.rpc("attest_email_contact_form_recipient_as_system"'
    );
    for (const binding of [
      "p_source_activity_id: input.activityId",
      "p_company_id: input.connection.companyId",
      "p_opportunity_id: input.opportunityId",
      "p_connection_id: input.connection.id",
      "p_provider_message_id: input.email.id",
      "p_provider_thread_id: input.email.threadId",
      "p_parsed_recipient: input.parsedRecipient",
    ]) {
      expect(attestationHelper).toContain(binding);
    }
    expect(attestationHelper).toContain(
      "[sync-engine] contact-form recipient attestation failed"
    );
  });

  it("does not attest repeated modern forms whose persisted sender is already canonical", () => {
    expect(attestationHelper).toContain("sourceSender: string | null");
    expect(attestationHelper).toMatch(
      /if \(\s*!normalizedSourceSender \|\|\s*normalizedSourceSender === normalizedParsedRecipient\s*\)\s*return/
    );
    expect(attestationHelper.indexOf("normalizedSourceSender")).toBeLessThan(
      attestationHelper.indexOf(
        '.rpc("attest_email_contact_form_recipient_as_system"'
      )
    );
  });

  it("treats permanent identity ambiguity as no-draft while retrying database failures", () => {
    const errorGuard = attestationHelper.indexOf("if (error)");
    const semanticSkip = attestationHelper.indexOf(
      "if (data === false) return"
    );
    const invalidResult = attestationHelper.indexOf("if (data !== true)");

    expect(errorGuard).toBeGreaterThanOrEqual(0);
    expect(semanticSkip).toBeGreaterThan(errorGuard);
    expect(invalidResult).toBeGreaterThan(semanticSkip);
  });

  it("attests retained wrappers for both new activity creation and guarded orphan adoption before returning", () => {
    expect(createOrAdopt).toContain("contactFormRecipient?: string | null");
    expect(
      createOrAdopt.match(/await attestContactFormRecipient\(/g) ?? []
    ).toHaveLength(2);
    expect(createOrAdopt).toContain("activityId: activity?.id ?? null");
    expect(createOrAdopt).toContain(
      "sourceSender: activity?.from_email ?? null"
    );
    expect(createOrAdopt).toContain(
      "activityId: input.existingOrphanActivity.id"
    );
    expect(createOrAdopt).toContain(
      "sourceSender: input.existingOrphanActivity.from_email ?? null"
    );
  });

  it("passes only deterministic parsed contact-form identity into persistence", () => {
    expect(compact).toContain(
      "contactFormRecipient: contactFormSubmitter?.email ?? null"
    );
    expect(compact).not.toContain(
      "contactFormRecipient: resolvedInboundContact.email"
    );
    expect(compact).not.toContain(
      "contactFormRecipient: deterministicFacts.contactEmail"
    );
  });

  it("repairs an existing exact activity only after canonical provenance refresh", () => {
    const existingActivityBranch = sourceFunction(
      "if (existingActivity?.opportunity_id)",
      "const { email: effectiveEmail, contactFormSubmitter }"
    );
    const enrichmentIndex = existingActivityBranch.indexOf(
      "await applyCanonicalLeadEnrichment"
    );
    const attestationIndex = existingActivityBranch.indexOf(
      "await attestContactFormRecipient"
    );

    expect(enrichmentIndex).toBeGreaterThanOrEqual(0);
    expect(attestationIndex).toBeGreaterThan(enrichmentIndex);
    expect(existingActivityBranch).toContain(
      "parsedRecipient: existingSubmitter?.email ?? null"
    );
    expect(existingActivityBranch).toContain(
      "sourceSender: existingActivity.from_email ?? null"
    );
  });
});
