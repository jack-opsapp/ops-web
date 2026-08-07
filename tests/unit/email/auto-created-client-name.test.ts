import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAutoCreatedClientName } from "@/lib/email/lead-enrichment";

const syncEngineSource = readFileSync(
  path.join(process.cwd(), "src/lib/api/services/sync-engine.ts"),
  "utf8"
);

function functionBody(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe("resolveAutoCreatedClientName", () => {
  it("never mints a name from the sender's email local part", () => {
    expect(
      resolveAutoCreatedClientName({
        preferredNames: [],
        fromMailbox: "canprojack@gmail.com",
        fromName: "canprojack",
        allowSenderDisplayName: true,
      })
    ).toBe("New Lead");
  });

  it("keeps a real From display name", () => {
    expect(
      resolveAutoCreatedClientName({
        preferredNames: [],
        fromMailbox: "Cecilia Reyes <canprojack@gmail.com>",
        fromName: "Cecilia Reyes",
        allowSenderDisplayName: true,
      })
    ).toBe("Cecilia Reyes");
  });

  it("recovers the display name from the From header when fromName is the local part", () => {
    expect(
      resolveAutoCreatedClientName({
        preferredNames: [],
        fromMailbox: "Cecilia Reyes <canprojack@gmail.com>",
        fromName: "canprojack",
        allowSenderDisplayName: true,
      })
    ).toBe("Cecilia Reyes");
  });

  it("never mints a name from a bare email address", () => {
    expect(
      resolveAutoCreatedClientName({
        preferredNames: [],
        fromMailbox: "canprojack@gmail.com",
        fromName: "canprojack@gmail.com",
        allowSenderDisplayName: true,
      })
    ).toBe("New Lead");
  });

  it("prefers the first non-blank supplied name over the sender display name", () => {
    expect(
      resolveAutoCreatedClientName({
        preferredNames: [null, "  ", "Canpro Deck and Rail", "Jack Reyes"],
        fromMailbox: "Cecilia Reyes <canprojack@gmail.com>",
        fromName: "Cecilia Reyes",
        allowSenderDisplayName: true,
      })
    ).toBe("Canpro Deck and Rail");
  });

  it("ignores the sender display name for known-platform senders", () => {
    expect(
      resolveAutoCreatedClientName({
        preferredNames: [],
        fromMailbox: "Wix Forms <notifications@wix-forms.com>",
        fromName: "Wix Forms",
        allowSenderDisplayName: false,
      })
    ).toBe("New Lead");
  });

  it("falls back to New Lead when nothing usable exists", () => {
    expect(
      resolveAutoCreatedClientName({
        preferredNames: [null, undefined, ""],
        fromMailbox: null,
        fromName: null,
        allowSenderDisplayName: true,
      })
    ).toBe("New Lead");
  });
});

describe("sync-engine auto-create name wiring", () => {
  const createClientBody = functionBody(
    syncEngineSource,
    "async function createClient(",
    "function subClientIdentityFromFacts("
  );
  const createSubClientBody = functionBody(
    syncEngineSource,
    "async function createSubClient(",
    "async function getClientOpportunityTitleCandidate("
  );

  it("routes the new-client name through the local-part guard", () => {
    expect(createClientBody).toContain("resolveAutoCreatedClientName({");
    expect(createClientBody).toMatch(/fromMailbox:\s*email\.from,/);
  });

  it("never uses the raw From display name as a new-client name", () => {
    expect(createClientBody).not.toMatch(/\?\s*null\s*:\s*email\.fromName/);
    expect(createClientBody).not.toMatch(/\?\?\s*\n?\s*email\.fromName/);
  });

  it("routes the new sub-client name through the local-part guard", () => {
    expect(createSubClientBody).toContain("resolveAutoCreatedClientName({");
    expect(createSubClientBody).not.toMatch(/\|\|\s*email\.fromName/);
  });
});
