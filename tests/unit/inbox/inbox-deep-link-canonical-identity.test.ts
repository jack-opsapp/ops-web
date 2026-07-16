import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../../..");

function source(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

describe("inbox deep-link canonical thread identity", () => {
  it("carries the canonical mailbox and provider thread on authorized detail", () => {
    const hookSource = source("src/lib/hooks/use-inbox-threads.ts");

    expect(hookSource).toMatch(
      /interface InboxThreadDetail[\s\S]*?thread:\s*\{[\s\S]*?connectionId:\s*string[\s\S]*?providerThreadId:\s*string/
    );
  });

  it("uses detail identity for reply autosave even when the list row is absent", () => {
    const routeSource = source("src/components/ops/inbox/inbox-route.tsx");

    expect(routeSource).toMatch(
      /const providerThreadId\s*=\s*detail\?\.thread\.providerThreadId\s*\?\?\s*null/
    );
    expect(routeSource).toMatch(
      /const conn\s*=\s*detail\.thread\.connectionId/
    );
    expect(routeSource).not.toMatch(
      /threads\.find\(\(row\) => row\.id === selectedThreadId\)\?\.connectionId/
    );
  });

  it("derives the current lead marker from authorized detail without a browser junction-table read", () => {
    const routeSource = source("src/components/ops/inbox/inbox-route.tsx");
    const linkHookSource = source("src/lib/hooks/use-thread-opportunity-links.ts");

    expect(routeSource).not.toContain("useThreadOpportunityLinks");
    expect(routeSource).toMatch(
      /new Set\(\s*detail\?\.thread\.opportunityId\s*\?\s*\[detail\.thread\.opportunityId\]\s*:\s*\[\]\s*\)/
    );
    expect(linkHookSource).not.toContain('.from("opportunity_email_threads")');
  });

  it("keeps assigned-scope right-rail reads on the authorized thread and linked lead", () => {
    const hookSource = source("src/lib/hooks/use-inbox-threads.ts");
    const routeSource = source("src/components/ops/inbox/inbox-route.tsx");
    const apiSource = source("src/app/api/inbox/threads/[id]/route.ts");

    expect(hookSource).toMatch(
      /interface InboxThreadDetail[\s\S]*?pipelineScope:\s*"all"\s*\|\s*"assigned"\s*\|\s*null/
    );
    expect(hookSource).toMatch(
      /linkedOpportunity:\s*\{[\s\S]*?id:\s*string[\s\S]*?title:\s*string[\s\S]*?stage:\s*string[\s\S]*?\}\s*\|\s*null/
    );
    expect(hookSource).toMatch(
      /clientContext:\s*\{[\s\S]*?name:\s*string[\s\S]*?email:\s*string\s*\|\s*null[\s\S]*?phone:\s*string\s*\|\s*null[\s\S]*?address:\s*string\s*\|\s*null/
    );

    expect(routeSource).toMatch(
      /const contextClientId\s*=\s*detail\?\.thread\.pipelineScope === "all"\s*\?\s*clientId\s*:\s*null/
    );
    expect(routeSource).toContain("useClientOpportunities(contextClientId)");
    expect(routeSource).toContain("useClientProjects(contextClientId)");
    expect(routeSource).toContain("useClientTasks(contextClientId)");
    expect(routeSource).toContain(
      "useClientFiles(contextClientId, selectedThreadId)"
    );
    expect(routeSource).not.toContain("useClient(clientId");
    expect(routeSource).not.toContain("useSubClients(clientId");

    expect(apiSource).toMatch(
      /\.from\("opportunities"\)[\s\S]*?\.eq\("id", access\.opportunityId\)[\s\S]*?\.eq\("company_id", actor\.companyId\)/
    );
    expect(apiSource).toContain("linkedOpportunity");
    expect(apiSource).toContain("clientContext");
  });

  it("keeps fallback messages and contact context on the exact authorized lead and mailbox", () => {
    const hookSource = source("src/lib/hooks/use-inbox-threads.ts");
    const routeSource = source("src/components/ops/inbox/inbox-route.tsx");
    const apiSource = source("src/app/api/inbox/threads/[id]/route.ts");
    const getSource = apiSource.split("// ─── PATCH: action handler")[0];

    expect(getSource).toMatch(
      /\.from\("activities"\)[\s\S]*?\.eq\("company_id", thread\.companyId\)[\s\S]*?\.eq\("email_connection_id", thread\.connectionId\)[\s\S]*?\.eq\("email_thread_id", thread\.providerThreadId\)/
    );
    expect(getSource).not.toContain('.from("clients")');
    expect(getSource).not.toContain('.from("sub_clients")');
    expect(hookSource).not.toContain("subClientCount");
    expect(routeSource).not.toContain("subClientCount");
    expect(getSource).toContain("email_message_id");
    expect(getSource).toContain("providerMessageId:");
    expect(routeSource).toContain(
      "inReplyTo: lastInbound?.providerMessageId ?? null"
    );
  });
});
