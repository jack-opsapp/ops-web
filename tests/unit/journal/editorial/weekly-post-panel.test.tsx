import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  WEEKLY_QUERY_KEY,
  WeeklyPostPanel,
  weeklyTime,
  type WeeklyAssignment,
  type WeeklyData,
} from "@/app/admin/blog/_components/weekly-post-panel";

const params = vi.hoisted(() => ({ value: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => params.value }));
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

const SLOT = "2026-09-14T13:00:00.000Z";

function assignment(overrides: Partial<WeeklyAssignment> = {}): WeeklyAssignment {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    identity: "weekly:2026-09-14",
    state: "scheduled",
    mode: "publish",
    slot_at: SLOT,
    publish_at: SLOT,
    published_at: null,
    title: "THE FIRST CALL DECIDES THE WHOLE WEEK",
    slug: "the-first-call-decides-the-week",
    last_code: null,
    preview: {
      url: "https://ops-app-files-prod.s3.us-west-2.amazonaws.com/blog/journal/2026-09-14-0123456789abcdef.jpg",
      width: 1200,
      height: 630,
    },
    package: {
      article: {
        title: "THE FIRST CALL DECIDES THE WHOLE WEEK",
        subtitle: "Most homeowners check you out before they ever call.",
        category: "operations",
        faqs: [{ question: "What should a crew do first?", answer: "Answer inside the hour." }],
      },
      html: "<p>Monday morning, the phone rings.</p><h2>Sources</h2>",
      word_count: 1184,
      citations: [{ role: "primary", title: "Homeowner survey 2024", site_name: "Example Agency", final_url: "https://www.example.gov/survey/2024" }],
      internal_links: 9,
      evidence: 6,
      editor_notes: "Grounded and on voice.",
    },
    newsletter_state: null,
    ...overrides,
  };
}

function show(data: WeeklyData) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(WEEKLY_QUERY_KEY, data);
  return render(
    <QueryClientProvider client={client}>
      <WeeklyPostPanel />
    </QueryClientProvider>
  );
}

const data = (assignments: WeeklyAssignment[], mode: "off" | "prepare" | "publish" = "publish"): WeeklyData => ({
  settings: { mode },
  newsletter_enabled: false,
  assignments,
});

describe("weekly post panel", () => {
  beforeEach(() => {
    params.value = new URLSearchParams();
    vi.restoreAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("formats the launch in Vancouver time", () => {
    expect(weeklyTime(SLOT)).toBe("MON SEP 14 · 06:00");
  });

  it("reads as one status line until opened", () => {
    show(data([assignment()]));
    expect(screen.getByText("READY · GOES LIVE MON SEP 14 · 06:00")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "PUBLISH NOW" })).toBeNull();
    expect(screen.getByRole("button", { expanded: false })).toBeInTheDocument();
  });

  it("says a held draft waits for the operator", () => {
    show(data([assignment()], "prepare"));
    expect(screen.getByText("READY · WAITS FOR YOUR GO")).toBeInTheDocument();
  });

  it("opens straight to the draft the rail item links", () => {
    params.value = new URLSearchParams("journal=11111111-1111-4111-8111-111111111111");
    show(data([assignment({ id: "22222222-2222-4222-8222-222222222222", state: "published", published_at: SLOT }), assignment()]));
    expect(screen.getByText("READY · GOES LIVE MON SEP 14 · 06:00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "PUBLISH NOW" })).toBeInTheDocument();
    expect(screen.getByText("OPERATIONS · 1,184 WORDS · 1 FAQS · 1 SOURCES · 9 LINKS")).toBeInTheDocument();
    expect(screen.getByText("Newsletter off. Nothing mails until you turn it on.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Homeowner survey 2024" })).toHaveAttribute("href", "https://www.example.gov/survey/2024");
  });

  it("asks twice before stopping, then reports the outcome", async () => {
    params.value = new URLSearchParams("journal=11111111-1111-4111-8111-111111111111");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ state: "cancelled" }), { status: 200 })
    );
    show(data([assignment()]));
    fireEvent.click(screen.getByRole("button", { name: "STOP" }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "CONFIRM STOP" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("STOPPED. NOTHING GOES LIVE THIS WEEK."));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/journal/editorial/11111111-1111-4111-8111-111111111111",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "stop" }) })
    );
  });

  it("explains a refused manual publish in plain words", async () => {
    params.value = new URLSearchParams("journal=11111111-1111-4111-8111-111111111111");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "SLUG_TAKEN" }), { status: 409 }));
    show(data([assignment()]));
    fireEvent.click(screen.getByRole("button", { name: "PUBLISH NOW" }));
    fireEvent.click(screen.getByRole("button", { name: "CONFIRM PUBLISH" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Another post took this address first."));
  });

  it("offers a rewrite for a stopped slot and publish-anyway only for the weekly guard", () => {
    params.value = new URLSearchParams("journal=11111111-1111-4111-8111-111111111111");
    show(data([assignment({ state: "blocked", last_code: "WEEKLY_ALREADY_LIVE" })]));
    expect(screen.getByRole("button", { name: "PUBLISH NOW" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "WRITE ANOTHER" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "STOP" })).toBeNull();
  });

  it("links a live post to the public journal and offers no controls that no longer apply", () => {
    params.value = new URLSearchParams("journal=11111111-1111-4111-8111-111111111111");
    show(data([assignment({ state: "published", published_at: "2026-09-14T13:09:00.000Z" })]));
    expect(screen.getByText("LIVE · MON SEP 14 · 06:09")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "OPEN ON THE JOURNAL" })).toHaveAttribute(
      "href",
      "https://opsapp.co/journal/the-first-call-decides-the-week"
    );
    expect(screen.queryByRole("button", { name: "PUBLISH NOW" })).toBeNull();
    expect(screen.queryByRole("button", { name: "STOP" })).toBeNull();
  });

  it("says when the writer is off and nothing is in progress", () => {
    show(data([], "off"));
    expect(screen.getByText("WRITER OFF")).toBeInTheDocument();
  });
});
