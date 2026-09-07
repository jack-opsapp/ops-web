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

function show(
  mode: string,
  assignments: unknown[],
  legacyRuns: unknown[] = []
) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(["social-cloud-editorial"], {
    settings: { mode },
    assignments,
    legacy_runs: legacyRuns,
  });
  return render(
    <QueryClientProvider client={client}>
      <CloudProduction />
    </QueryClientProvider>
  );
}

function assignmentPackage() {
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
  return canary?.approved ? canary.package : fallback;
}

describe("cloud production inspection", () => {
  it("distinguishes held drafts from automatic publication and links the source", () => {
    const pack = assignmentPackage();
    const view = show("prepare", [
      {
        id: "a1",
        identity: "blog:e0d5ff01-97cd-4168-bcc3-70b2cd094d2b",
        kind: "blog",
        mode: "prepare",
        state: "prepared",
        attempts: 1,
        last_code: null,
        source_snapshot: {
          id: "e0d5ff01-97cd-4168-bcc3-70b2cd094d2b",
          title: "FABLE 5.1 IS OUT",
          slug: "fable-5-1-is-out",
          published_at: "2026-09-01T18:32:46.742Z",
        },
        package: pack,
        preview: pack.preview ?? null,
        post_id: null,
        post: null,
        created_at: "2026-09-07T10:00:00Z",
        updated_at: "2026-09-07T10:05:00Z",
      },
    ]);

    expect(screen.getByText("FABLE 5.1 IS OUT")).toBeInTheDocument();
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

  it("names a blocked assignment and what stopped it", () => {
    show("publish", [
      {
        id: "a2",
        identity: "protocol:2026-09-08",
        kind: "protocol",
        mode: "publish",
        state: "blocked",
        attempts: 3,
        last_code: "SOURCE_WITHDRAWN",
        source_snapshot: null,
        package: null,
        preview: null,
        post_id: null,
        post: null,
        created_at: "2026-09-08T10:00:00Z",
        updated_at: "2026-09-08T10:05:00Z",
      },
    ]);

    expect(screen.getByText("PROTOCOL · TUE SEP 08")).toBeInTheDocument();
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    expect(
      screen.getByText("The article was unpublished before this post went out.")
    ).toBeInTheDocument();
  });

  it("reports the live post behind a submitted assignment", () => {
    show("publish", [
      {
        id: "a3",
        identity: "blog:22222222-2222-4222-8222-222222222222",
        kind: "blog",
        mode: "publish",
        state: "submitted",
        attempts: 1,
        last_code: null,
        source_snapshot: { title: "A BETTER HANDOFF", slug: "handoff" },
        package: null,
        preview: null,
        post_id: "8f0d5d6c-1111-4111-8111-111111111111",
        post: {
          status: "published",
          publish_after: "2026-09-08T17:00:00Z",
          instagram_permalink: "https://www.instagram.com/p/ABC123/",
        },
        created_at: "2026-09-08T10:00:00Z",
        updated_at: "2026-09-08T17:02:00Z",
      },
    ]);

    expect(screen.getByText("In publishing queue")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open on Instagram" })
    ).toHaveAttribute("href", "https://www.instagram.com/p/ABC123/");
  });

  it("keeps the retired slot drafts labelled as legacy", () => {
    show(
      "prepare",
      [],
      [
        {
          slot_date: "2026-09-05",
          state: "prepared",
          mode: "prepare",
          last_code: null,
          post_id: null,
          package: assignmentPackage(),
        },
      ]
    );

    expect(screen.getByText("HELD LEGACY DRAFT")).toBeInTheDocument();
    expect(screen.getByText(/2026-09-05/)).toBeInTheDocument();
  });

  it("states the production schedule in the operator's terms", () => {
    show("prepare", []);
    expect(
      screen.getByText(
        "Blogs are adapted as they publish. Tuesday protocol, Wednesday product, Friday rotation. Posts are paced one per day inside 10:00–20:00."
      )
    ).toBeInTheDocument();
  });
});
