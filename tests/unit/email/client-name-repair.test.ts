import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  decideClientNameRepair,
  type ClientNameRepairInput,
} from "@/lib/email/client-name-repair";

const threadServiceSource = readFileSync(
  path.join(process.cwd(), "src/lib/api/services/email-thread-service.ts"),
  "utf8"
);

function input(
  overrides: Partial<ClientNameRepairInput> = {}
): ClientNameRepairInput {
  return {
    currentName: "canprojack",
    clientEmail: "canprojack@gmail.com",
    senderEmail: "canprojack@gmail.com",
    candidateName: "Cecilia Reyes",
    direction: "inbound",
    senderIsSelf: false,
    provenance: null,
    ...overrides,
  };
}

describe("decideClientNameRepair", () => {
  it("repairs a handle-derived name that carries no @", () => {
    expect(decideClientNameRepair(input())).toEqual({
      repair: true,
      name: "Cecilia Reyes",
    });
  });

  it("still repairs the legacy bare-email name", () => {
    expect(
      decideClientNameRepair(input({ currentName: "canprojack@gmail.com" }))
    ).toEqual({ repair: true, name: "Cecilia Reyes" });
  });

  it("repairs a generic mailbox label", () => {
    expect(
      decideClientNameRepair(
        input({
          currentName: "Office",
          clientEmail: "office@marigoldcoop.ca",
          senderEmail: "office@marigoldcoop.ca",
          candidateName: "Patrick Chan",
        })
      )
    ).toEqual({ repair: true, name: "Patrick Chan" });
  });

  it("leaves a real customer name alone", () => {
    expect(
      decideClientNameRepair(
        input({ currentName: "Cecilia Reyes", candidateName: "C. Reyes" })
      )
    ).toEqual({ repair: false, reason: "name_is_real" });
  });

  it("refuses a replacement that is itself a placeholder", () => {
    expect(
      decideClientNameRepair(input({ candidateName: "canprojack" }))
    ).toEqual({ repair: false, reason: "candidate_unusable" });
    expect(
      decideClientNameRepair(input({ candidateName: "canprojack@gmail.com" }))
    ).toEqual({ repair: false, reason: "candidate_unusable" });
    expect(decideClientNameRepair(input({ candidateName: "Sales" }))).toEqual({
      repair: false,
      reason: "candidate_unusable",
    });
    expect(decideClientNameRepair(input({ candidateName: null }))).toEqual({
      repair: false,
      reason: "candidate_unusable",
    });
  });

  it("never writes the current name back onto itself", () => {
    expect(
      decideClientNameRepair(
        input({ currentName: "Office", candidateName: "office" })
      )
    ).toEqual({ repair: false, reason: "candidate_unusable" });
  });

  it("only repairs on inbound messages from someone other than the operator", () => {
    expect(decideClientNameRepair(input({ direction: "outbound" }))).toEqual({
      repair: false,
      reason: "not_inbound_customer_message",
    });
    expect(decideClientNameRepair(input({ senderIsSelf: true }))).toEqual({
      repair: false,
      reason: "not_inbound_customer_message",
    });
  });

  it("refuses to overwrite an operator-set name", () => {
    expect(
      decideClientNameRepair(
        input({ provenance: { source: "operator", confirmedAt: null } })
      )
    ).toEqual({ repair: false, reason: "operator_owned" });
  });

  it("refuses to overwrite a confirmed name", () => {
    expect(
      decideClientNameRepair(
        input({ provenance: { source: "ai", confirmedAt: "2026-07-01" } })
      )
    ).toEqual({ repair: false, reason: "operator_owned" });
  });

  it("repairs over machine-sourced provenance", () => {
    expect(
      decideClientNameRepair(
        input({ provenance: { source: "inbound", confirmedAt: null } })
      )
    ).toEqual({ repair: true, name: "Cecilia Reyes" });
  });

  it("falls back to the sender email when the client row has none", () => {
    expect(
      decideClientNameRepair(input({ clientEmail: null }))
    ).toEqual({ repair: true, name: "Cecilia Reyes" });
  });
});

describe("email-thread-service client-name repair wiring", () => {
  it("uses the shared decision in both the update and insert branches", () => {
    const occurrences = threadServiceSource.match(
      /repairPlaceholderClientName\(/g
    );
    expect(occurrences?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("no longer gates the repair on an @ in the stored name", () => {
    expect(threadServiceSource).not.toMatch(/clientRow\.name\?\.includes\("@"\)/);
  });

  it("sources the replacement outside the directory tier", () => {
    expect(threadServiceSource).toContain("clientNameRepairCandidate");
    const composeBody = threadServiceSource.slice(
      threadServiceSource.indexOf("async function composeSenderName("),
      threadServiceSource.indexOf("// ─── Client-id resolution")
    );
    expect(composeBody).toContain("resolveSenderNameFromDirectory(");
    expect(composeBody).not.toContain("isPlaceholderClientName");
  });

  it("invalidates the memoized sender name after a client-name write", () => {
    expect(threadServiceSource).toContain("function invalidateCachedSenderName");
    expect(threadServiceSource).toMatch(
      /invalidateCachedSenderName\([\s\S]{0,200}\)/
    );
  });
});
