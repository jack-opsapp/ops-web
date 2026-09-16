import {
  JOURNAL_INDUSTRY_SLUGS,
  type JournalPolicyContext,
} from "@/lib/journal/editorial/policy";
import type { JournalPitchContext } from "@/lib/journal/editorial/pitch";
import type { JournalTrendSignalRow } from "@/lib/journal/editorial/radar/signals";

export const SOURCE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const SOURCE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const SOURCE_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const TOPIC = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

export const policyContext: JournalPolicyContext = {
  sources: [
    {
      id: SOURCE_A,
      url: "https://www.example.gov/survey",
      final_url: "https://www.example.gov/survey/2024",
      title: "Homeowner survey 2024",
      site_name: "Example Agency",
      text: "In the 2024 survey, 81% of homeowners said they read reviews before calling a business. Response times mattered to 64% of them.",
    },
    {
      id: SOURCE_B,
      url: "https://research.example.org/report",
      final_url: "https://research.example.org/report",
      title: "Trades report",
      site_name: "Example Research",
      text: "Small crews lose an average of 7 hours a week to scheduling calls, according to the report published in 2025.",
    },
    {
      id: SOURCE_C,
      url: "https://unused.example.com/page",
      final_url: "https://unused.example.com/page",
      title: null,
      site_name: null,
      text: "A page that mentions 999 widgets and nothing else useful for this piece.",
    },
  ],
  livePosts: [
    "word-of-mouth-isnt-a-marketing-plan",
    "great-hands-dont-make-great-bosses",
    "build-comms-your-crew-actually-uses",
    "make-real-money-on-small-jobs",
    "ai-is-grading-your-bid",
  ].map((slug, index) => ({
    slug,
    title: `LIVE POST NUMBER ${index} ABOUT SOMETHING ELSE ENTIRELY`,
    published_at: "2026-08-20T12:00:00Z",
  })),
  takenSlugs: ["stop-bleeding-tools"],
  categories: [
    { id: "f59c4c44-4714-4f9e-8870-423e0225d313", slug: "money-and-margins" },
    { id: "a252cd74-6982-4827-9dda-71bf829dc707", slug: "operations" },
  ],
  backlogTopicIds: [TOPIC],
  industrySlugs: JOURNAL_INDUSTRY_SLUGS,
  productFacts:
    "The founder scaled a deck and railing business from $0 to $1.6M in four years. Eight stages.",
  now: new Date("2026-09-13T13:00:00Z"),
};

/** Plain prose with no digits, so word counts can be tuned freely. */
export const filler = (words: number) =>
  Array.from(
    { length: words },
    (_, index) =>
      ["crews", "plan", "the", "week", "before", "the", "first", "truck", "leaves", "the", "yard"][
        index % 11
      ]
  ).join(" ") + ".";

const links = [
  "[the referral leak](/journal/word-of-mouth-isnt-a-marketing-plan)",
  "[great hands](/journal/great-hands-dont-make-great-bosses)",
  "[crew comms](/journal/build-comms-your-crew-actually-uses)",
  "[small jobs](/journal/make-real-money-on-small-jobs)",
  "[HVAC shops](/industries/hvac)",
  "[plumbers](/industries/plumbing)",
  "[roofers](/industries/roofing)",
  "[painters](/industries/painting)",
];

/** A draft that passes every deterministic check against policyContext. */
export function validCandidate(overrides: Record<string, unknown> = {}) {
  const body = [
    { type: "p", text: `Monday morning, the phone rings before the coffee is poured. In the 2024 survey, **81% of homeowners** read reviews first. ${filler(60)}` },
    { type: "h2", text: "What the first call decides" },
    { type: "p", text: `${filler(170)} Start with ${links[0]} and ${links[1]}.` },
    { type: "p", text: `Small crews lose an average of 7 hours a week to scheduling calls, per [the report](https://research.example.org/report). ${filler(150)}` },
    { type: "h2", text: "Where the week leaks" },
    { type: "p", text: `${filler(160)} See ${links[2]} and ${links[3]}.` },
    { type: "ul", items: [`Answer inside the hour. ${filler(20)}`, `Log every call. ${filler(20)}`, `Close the loop by Friday. ${filler(20)}`] },
    { type: "blockquote", text: "The job starts when the phone rings, not when the truck rolls." },
    { type: "h2", text: "What this means for your crew" },
    { type: "p", text: `${filler(170)} It holds for ${links[4]}, ${links[5]}, ${links[6]} and ${links[7]}.` },
    { type: "p", text: `Say a missed call costs you a $4,000 job. ${filler(150)} Read the [survey](https://www.example.gov/survey/2024/) yourself.` },
    { type: "blockquote", text: "Who on your crew answers the phone before nine?" },
  ];
  return {
    title: "THE FIRST CALL DECIDES THE WHOLE WEEK",
    subtitle: "Most homeowners check you out before they ever call. The first hour decides the job.",
    slug: "the-first-call-decides-the-week",
    meta_title: "How fast crews answer calls decides who wins the job",
    summary: "Homeowners read reviews before they call, and small crews lose hours to scheduling calls. Answer inside the hour and log every call.",
    teaser: "The call you miss before coffee is the job your competitor books by lunch.",
    category: "operations",
    topic: { backlog_topic_id: TOPIC, angle: "Response time as the real sales edge for small crews." },
    image_prompt:
      "An owner-operator in a work truck cab at dawn answers a ringing phone, a clipboard of job tickets on the dash and a crew loading ladders in the soft background.",
    body,
    faqs: Array.from({ length: 6 }, (_, index) => ({
      question: `What should a crew do about missed calls, part ${["one", "two", "three", "four", "five", "six"][index]}?`,
      answer: filler(80),
    })),
    email_content: `${filler(90)}\n\n${filler(80)}`,
    citations: [
      { source_id: SOURCE_A, role: "primary" },
      { source_id: SOURCE_B, role: "supporting" },
    ],
    evidence: [
      { claim: "81% of homeowners read reviews before calling.", source_id: SOURCE_A, quote: "81% of homeowners said they read reviews before calling a business" },
      { claim: "Small crews lose 7 hours a week to scheduling calls.", source_id: SOURCE_B, quote: "Small crews lose an average of 7 hours a week to scheduling calls" },
    ],
    worked_examples: ["Say a missed call costs you a $4,000 job."],
    ...overrides,
  };
}

export const validEditor = {
  approved: true,
  grounded: true,
  current: true,
  original: true,
  useful: true,
  on_voice: true,
  structured: true,
  hooked: true,
  reason: "approved",
  notes: "Grounded and on voice.",
};

export const SIGNAL_VIDEO = "5a5a5a5a-5a5a-45a5-85a5-5a5a5a5a5a5a";
export const SIGNAL_THREAD = "6b6b6b6b-6b6b-46b6-86b6-6b6b6b6b6b6b";
export const SIGNAL_NEWS = "7c7c7c7c-7c7c-47c7-87c7-7c7c7c7c7c7c";

/** One radar row the way the repository hands it over. */
export function signalRow(overrides: Partial<JournalTrendSignalRow> = {}): JournalTrendSignalRow {
  return {
    id: SIGNAL_VIDEO,
    source_key: "tommy-mello",
    sphere: "trades",
    kind: "video",
    url: "https://www.youtube.com/watch?v=abc123",
    title: "Why your best tech quits in the first year",
    summary: "Retention starts on day one.",
    published_at: "2026-09-10T15:00:00.000Z",
    views: 48210,
    baseline_views: 9400,
    momentum: 5.13,
    comments: null,
    ...overrides,
  };
}

export const radarRows: JournalTrendSignalRow[] = [
  signalRow(),
  signalRow({
    id: SIGNAL_THREAD,
    source_key: "contractortalk",
    sphere: "forum",
    kind: "thread",
    url: "https://www.contractortalk.com/threads/new-guy-walked-off.464700/",
    title: "New guy walked off the job at lunch",
    summary: null,
    published_at: "2026-09-12T18:00:00.000Z",
    views: null,
    baseline_views: null,
    momentum: null,
    comments: 41,
  }),
  signalRow({
    id: SIGNAL_NEWS,
    source_key: "construction-dive",
    sphere: "industry",
    kind: "article",
    url: "https://www.constructiondive.com/news/labor-shortage-2026/",
    title: "Residential builders report longer hiring times",
    summary: "Survey of builders.",
    published_at: "2026-09-11T12:00:00.000Z",
    views: null,
    baseline_views: null,
    momentum: null,
    comments: null,
  }),
];

export function pitchContext(overrides: Partial<Omit<JournalPitchContext, "now">> = {}): Omit<JournalPitchContext, "now"> {
  return {
    signals: new Map(radarRows.map((row) => [row.id, row])),
    radarSignalsAvailable: 120,
    radarScannedAt: "2026-09-13T12:09:00.000Z",
    livePosts: policyContext.livePosts,
    ...overrides,
  };
}

/** A pitch that passes every deterministic check against pitchContext. */
export function validPitch(overrides: Record<string, unknown> = {}) {
  return {
    topic: "Why new hires quit in the first ninety days",
    reader: "An owner with four trucks who hired two helpers in the spring and lost both by August.",
    why_now:
      "A Tommy Mello video on first-year turnover is running five times his typical views, a ContractorTalk thread about a new guy walking off drew 41 replies, and builders report longer hiring times.",
    signals: [SIGNAL_VIDEO, SIGNAL_THREAD, SIGNAL_NEWS],
    chatter: [
      { url: "https://www.reddit.com/r/Construction/comments/abc/first_week/", shows: "Owners trading stories about helpers who never came back after day three." },
    ],
    ethos: "Ownership: the crew you keep is a leadership result, not luck.",
    angle: "Turnover is decided in the first week, by the owner, before the new hire ever touches a tool.",
    hook: "He showed up at 6:40, carried lumber until noon, and never came back from lunch.",
    headline: "YOUR NEW GUY QUIT BEFORE LUNCH",
    hooks_considered: [
      ["YOUR NEW GUY QUIT BEFORE LUNCH", "Chosen: a moment every owner has lived."],
      ["THE FIRST WEEK DECIDES WHO STAYS", "Clear, but it tells the ending."],
      ["STOP HIRING HELPERS YOU WILL LOSE", "Too scolding."],
      ["NINETY DAYS TO KEEP A GOOD HAND", "Flat."],
      ["NOBODY QUITS THE WORK. THEY QUIT THE WEEK", "Clever, not concrete."],
      ["WHY YOUR BEST HIRE WALKS BY FRIDAY", "Close second."],
    ].map(([headline, verdict]) => ({ headline, hook: "A new hire leaves on day one.", verdict })),
    runners_up: [
      { topic: "Pricing small repair jobs", why_not: "Covered in July." },
      { topic: "Rates and the spring backlog", why_not: "News peg, thin on owner moves." },
    ],
    ...overrides,
  };
}
