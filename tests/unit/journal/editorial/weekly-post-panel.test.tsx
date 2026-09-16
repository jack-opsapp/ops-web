import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
      url: "https://ops-app-files-prod.s3.us-west-2.amazonaws.com/blog/weekly/2026-09-14-0123456789abcdef.jpg",
      width: 1600,
      height: 900,
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
    image_generations: 1,
    image_requested_at: null,
    pitch: null,
    ...overrides,
  };
}

const pitch: NonNullable<WeeklyAssignment["pitch"]> = {
  topic: "Why new hires quit in the first ninety days",
  reader: "An owner with four trucks.",
  why_now: "A Tommy Mello video on first-year turnover is running five times his typical views.",
  ethos: "Ownership.",
  angle: "Turnover is decided in the first week, by the owner.",
  hook: "He showed up at 6:40, carried lumber until noon, and never came back from lunch.",
  headline: "YOUR NEW GUY QUIT BEFORE LUNCH",
  signals: [
    { id: "s1", sphere: "trades", source: "Tommy Mello", kind: "video", title: "Why your best tech quits", url: "https://www.youtube.com/watch?v=abc", views: 48210, typical_views: 9400, momentum: 5.13, replies: null },
    { id: "s2", sphere: "trades", source: "Build Show Network", kind: "video", title: "Framing a wall", url: "https://www.youtube.com/watch?v=def", views: 12040, typical_views: 11000, momentum: 1.09, replies: null },
    { id: "s3", sphere: "forum", source: "ContractorTalk", kind: "thread", title: "New guy walked off the job at lunch", url: "https://www.contractortalk.com/threads/x.1/", views: null, typical_views: null, momentum: null, replies: 1041 },
    { id: "s4", sphere: "industry", source: "Construction Dive", kind: "article", title: "Builders report longer hiring times", url: "https://www.constructiondive.com/news/x/", views: null, typical_views: null, momentum: null, replies: null },
  ],
  chatter: [{ url: "https://www.reddit.com/r/Construction/comments/abc/", shows: "Owners trading stories about helpers who never came back." }],
  hooks_considered: [
    { headline: "YOUR NEW GUY QUIT BEFORE LUNCH", hook: "h", verdict: "Chosen.", clicks: 3 },
    { headline: "WHY NEW HIRES QUIT IN THE FIRST WEEK", hook: "h", verdict: "Clear, less gripping.", clicks: 0 },
    { headline: "HOW TO KEEP A NEW HELPER PAST DAY ONE", hook: "h", verdict: "Close second.", clicks: 2 },
  ],
  runners_up: [{ topic: "Pricing small repair jobs", why_not: "Covered in July." }],
};

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

  it("makes a new photo from the preview and says whether it is live", async () => {
    params.value = new URLSearchParams("journal=11111111-1111-4111-8111-111111111111");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ state: "published", url: "https://h/new.jpg" }), { status: 200 })
    );
    show(data([assignment({ state: "published", published_at: new Date(Date.now() - 86400000).toISOString() })]));
    fireEvent.click(screen.getByRole("button", { name: "NEW PHOTO" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("NEW PHOTO LIVE ON THE JOURNAL."));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/journal/editorial/11111111-1111-4111-8111-111111111111",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "new_image" }) })
    );
  });

  it("explains a failed or refused photo, and locks the button at the limit or after eight days", async () => {
    params.value = new URLSearchParams("journal=11111111-1111-4111-8111-111111111111");
    // The panel refetches itself after every action, so only POSTs take the queued answers.
    const answers = [{ code: "IMAGE_FAILED", retry: true }, { code: "IMAGE_REFUSED", retry: true }];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) =>
      init?.method === "POST"
        ? new Response(JSON.stringify(answers.shift()), { status: 502 })
        : new Response(JSON.stringify(data([assignment()])), { status: 200 })
    );
    const view = show(data([assignment()]));
    fireEvent.click(screen.getByRole("button", { name: "NEW PHOTO" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("PHOTO FAILED. OPS TRIES AGAIN WITHIN THE HOUR."));
    fireEvent.click(screen.getByRole("button", { name: "NEW PHOTO" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("OPENAI REFUSED THE PHOTO BRIEF."));
    view.unmount();

    const limited = show(data([assignment({ image_generations: 8 })]));
    expect(screen.getByRole("button", { name: "PHOTO LIMIT REACHED" })).toBeDisabled();
    limited.unmount();

    show(data([assignment({ state: "published", published_at: "2026-09-01T13:00:00.000Z" })]));
    expect(screen.queryByRole("button", { name: /PHOTO/ })).toBeNull();
  });

  it("shows why this topic and this hook before the controls, with the signals that made it hot", () => {
    params.value = new URLSearchParams("journal=11111111-1111-4111-8111-111111111111");
    const base = assignment();
    show(data([assignment({ pitch, package: { ...base.package!, article: { ...base.package!.article, title: pitch.headline } } })]));
    const why = screen.getByRole("region", { name: "// WHY THIS POST" });
    expect(why).toHaveTextContent("Why new hires quit in the first ninety days");
    expect(why).toHaveTextContent("ANGLE");
    expect(why).toHaveTextContent("FIRST LINE");
    // The draft's title already names the post, so the pitch headline stays out of the way.
    expect(within(why).queryByText("HEADLINE")).toBeNull();
    expect(why).toHaveTextContent("He showed up at 6:40, carried lumber until noon, and never came back from lunch.");
    expect(screen.getByText("Tommy Mello · 5.1× TYPICAL VIEWS")).toBeInTheDocument();
    expect(screen.getByText("Build Show Network · 12,040 VIEWS")).toBeInTheDocument();
    expect(screen.getByText("ContractorTalk · 1,041 REPLIES")).toBeInTheDocument();
    expect(screen.getByText("Construction Dive")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Why your best tech quits" })).toHaveAttribute("href", "https://www.youtube.com/watch?v=abc");
    expect(screen.getByRole("link", { name: "Owners trading stories about helpers who never came back." })).toHaveAttribute(
      "href",
      "https://www.reddit.com/r/Construction/comments/abc/"
    );
    expect(screen.getByText("SIGNALS · 4 · SEARCH · 1")).toBeInTheDocument();
    expect(screen.getByText("SEARCH · reddit.com")).toBeInTheDocument();
    expect(screen.getByText("HEADLINES WEIGHED · 3 · TOPICS PASSED OVER · 1")).toBeInTheDocument();
    // Losing headlines, most-clicked first, each with its reader count.
    const losing = within(why).getAllByText(/^(WHY NEW HIRES|HOW TO KEEP A NEW HELPER)/).map((node) => node.textContent);
    expect(losing).toEqual(["HOW TO KEEP A NEW HELPER PAST DAY ONE", "WHY NEW HIRES QUIT IN THE FIRST WEEK"]);
    expect(within(why).getByText("2 OF 3 READERS WOULD CLICK")).toBeInTheDocument();
    // The evidence and the alternatives wait one click deeper; the take and the hook do not.
    const [evidence, alternativesBox] = Array.from(why.querySelectorAll("details"));
    expect(evidence).not.toHaveAttribute("open");
    expect(alternativesBox).not.toHaveAttribute("open");
    expect(evidence.contains(screen.getByRole("link", { name: "Why your best tech quits" }))).toBe(true);
    expect(evidence.compareDocumentPosition(screen.getByText(pitch.hook)) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    // The alternatives name only the headlines that lost.

    expect(within(why).queryAllByText("YOUR NEW GUY QUIT BEFORE LUNCH")).toHaveLength(0);
    expect(screen.getByText("Pricing small repair jobs")).toBeInTheDocument();
    const order = [why, screen.getByRole("button", { name: "PUBLISH NOW" })];
    expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("names the pitch headline beside a draft whose title research changed", () => {
    params.value = new URLSearchParams("journal=11111111-1111-4111-8111-111111111111");
    show(data([assignment({ pitch })]));
    const why = screen.getByRole("region", { name: "// WHY THIS POST" });
    expect(within(why).getByText("HEADLINE")).toBeInTheDocument();
    expect(within(why).getByText("YOUR NEW GUY QUIT BEFORE LUNCH")).toBeInTheDocument();
  });

  it("shows the pitch while the post is still being written, and nothing for posts from before the funnel", () => {
    params.value = new URLSearchParams("journal=11111111-1111-4111-8111-111111111111");
    const view = show(data([assignment({ state: "authoring", preview: null, package: null, pitch })]));
    expect(screen.getByText("BEING WRITTEN", { exact: false })).toBeInTheDocument();
    const writing = screen.getByRole("region", { name: "// WHY THIS POST" });
    expect(writing).toHaveTextContent("Why new hires quit");
    // Nothing else names the post yet, so the chosen headline shows with its readers.
    expect(within(writing).getByText("YOUR NEW GUY QUIT BEFORE LUNCH")).toBeInTheDocument();
    expect(within(writing).getByText("3 OF 3 READERS WOULD CLICK")).toBeInTheDocument();
    view.unmount();
    show(data([assignment()]));
    expect(screen.queryByRole("region", { name: "// WHY THIS POST" })).toBeNull();
  });

  it("warns only when the radar is degraded", () => {
    params.value = new URLSearchParams("journal=11111111-1111-4111-8111-111111111111");
    const healthy = show({ ...data([assignment()]), radar: { scanned_at: SLOT, ok: 25, total: 26, degraded: false } });
    expect(screen.queryByText(/FEEDS ANSWERED/)).toBeNull();
    healthy.unmount();
    show({ ...data([assignment()]), radar: { scanned_at: SLOT, ok: 9, total: 26, degraded: true } });
    expect(screen.getByText("RADAR · 9 OF 26 FEEDS ANSWERED. THE WRITER FALLS BACK TO SEARCH.")).toBeInTheDocument();
  });

  it("says when the writer is off and nothing is in progress", () => {
    show(data([], "off"));
    expect(screen.getByText("WRITER OFF")).toBeInTheDocument();
  });
});
