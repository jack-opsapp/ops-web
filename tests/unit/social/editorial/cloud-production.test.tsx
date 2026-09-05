import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CloudProduction } from "@/app/admin/social/_components/cloud-production";
import { socialPostFixture } from "../../../helpers/social-fixtures";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));
function show(mode: string, runs: unknown[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(["social-cloud-editorial"], { settings: { mode }, runs });
  return render(
    <QueryClientProvider client={client}>
      <CloudProduction />
    </QueryClientProvider>
  );
}
describe("cloud production inspection", () => {
  it("distinguishes held drafts from automatic publication and links the source", () => {
    const post = socialPostFixture();
    const fallback = {
      submission: {
        content: post.content,
        source: { url: "https://opsapp.co/journal/example" },
      },
      preview: post.rendered_assets,
    };
    const file = "docs/artifacts/social-editorial/canary-result.json";
    const canary = existsSync(file)
      ? JSON.parse(readFileSync(file, "utf8"))
      : null;
    const pack = canary?.approved ? canary.package : fallback;
    const view = show("prepare", [
      {
        slot_date: "2026-09-07",
        state: "prepared",
        mode: "prepare",
        package: pack,
        last_code: null,
        post_id: null,
      },
    ]);
    expect(
      screen.getByText(
        "Preview only. This draft will not publish automatically."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Read the source" })
    ).toHaveAttribute("href", pack.submission.source.url);
    expect(
      screen.queryByRole("button", { name: /publish/i })
    ).not.toBeInTheDocument();
    if (process.env.OPS_WRITE_EDITORIAL_SCREEN_PREVIEW === "1") {
      view.container
        .querySelectorAll("details")
        .forEach((node) => node.setAttribute("open", ""));
      writeFileSync(
        "docs/artifacts/social-editorial/preview.html",
        '<!doctype html><html><head><meta charset="utf-8"><title>OPS Instagram draft preview</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="preview.css"></head><body class="bg-black text-text"><main>' +
          view.container.innerHTML +
          "</main></body></html>"
      );
    }
  });
  it("shows a stopped run with a recovery direction", () => {
    show("publish", [
      {
        slot_date: "2026-09-08",
        state: "failed",
        mode: "publish",
        package: null,
        last_code: "BUDGET_EXHAUSTED",
        post_id: null,
      },
    ]);
    expect(
      screen.getByText(
        "Preparation stopped. Inspect the draft and source before trying again."
      )
    ).toBeInTheDocument();
  });
});
