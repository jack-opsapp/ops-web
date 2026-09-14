import {
  JOURNAL_INDUSTRY_SLUGS,
  type JournalPolicyContext,
} from "@/lib/journal/editorial/policy";

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
    hero_line: "The job starts when the phone rings",
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
  reason: "approved",
  notes: "Grounded and on voice.",
};
