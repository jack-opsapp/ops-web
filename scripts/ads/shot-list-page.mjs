#!/usr/bin/env node
/**
 * The ad shot list — the photos Jackson should go and get for the search ads,
 * in the order worth getting them, each written the way the old account proved
 * works (real work in real hands, the app on screen, nothing added on top) and
 * to Google's verified image rules (2026-09-11).
 *
 *   node scripts/ads/shot-list-page.mjs > docs/artifacts/ads-engine/p2/shot-list.html
 */
import { readFileSync } from "node:fs";

const THUMBS = "docs/artifacts/ads-engine/p2/legacy-analysis/images/thumbs";
const uri = (key) => `data:image/jpeg;base64,${readFileSync(`${THUMBS}/${key}.jpg`).toString("base64")}`;

/** Priority is real order here: the first three close the only gap that costs relevance. */
const TIERS = [
  {
    name: "Get these first",
    note: "The three trade ad groups show generic crew photos today. Someone searching “cleaning business software” should see a cleaning crew. These attach to their own ad group only.",
    shots: [
      {
        id: "CLN",
        title: "Cleaning crew at the door",
        scene: "Crew lead on a client’s front step or at the van’s side door. Cleaning caddy in one hand, phone in the other, checking where the next stop is.",
        screen: "Today’s stops, in order.",
        runs: ["TRADE · US › Cleaning"],
        why: "“No more calls asking which stop is next” — the status-call line that won in the old ads, made visible.",
      },
      {
        id: "LND",
        title: "Lawn crew at the trailer",
        scene: "Gloved hand holding the phone up, trailer gate or mower behind, early light. Dirt on the glove is a feature.",
        screen: "The day’s properties on the map.",
        runs: ["TRADE · US › Landscaping"],
        why: "The glove-and-app shot was the best image the old account ran. This is the same idea, in the trade.",
      },
      {
        id: "RFG",
        title: "Roofer logging the tear-off",
        scene: "On the roof or at the ladder, harness on, feet planted, taking a photo of the tear-off with the phone.",
        screen: "The camera, attaching the photo to the job.",
        runs: ["TRADE · US › Roofing"],
        why: "“Photos stay with the job” is what a roofing owner is buying. Keep the harness in frame — the people we sell to will notice an unsafe roof before they notice the phone.",
      },
    ],
  },
  {
    name: "Then these",
    note: "They run in every campaign, beside every ad.",
    shots: [
      {
        id: "GLV",
        title: "Glove and app, re-shot",
        scene: "The winner again: dusty work glove, phone held up, sky or dirt behind. Frame it so the whole hand and the whole phone fit inside a square.",
        screen: "The home screen with a real-looking company name and a job card. Not TEST COMPANY.",
        runs: ["All five campaigns"],
        why: "7.8% clicked and 20 downloads last time. This fixes the only two things wrong with it: the test name on screen, and no square version.",
      },
      {
        id: "TRK",
        title: "Owner in the truck before the crew rolls",
        scene: "Driver’s seat, coffee in the cup holder, first light through the windshield, phone in both hands.",
        screen: "The schedule — who is where today.",
        runs: ["All five campaigns"],
        why: "The truck shot you picked, at full resolution this time. It shows the buyer at the moment the status calls usually start.",
      },
    ],
  },
  {
    name: "If there’s time",
    note: "Each one sharpens a single campaign’s argument.",
    shots: [
      {
        id: "HND",
        title: "Handoff on site",
        scene: "Crew lead shows a crew member the job on one phone. Two people, one screen, standing at the work.",
        screen: "The job: scope, notes and photos.",
        runs: ["SWITCH · US"],
        why: "“Everyone sees the same job” — the reason people leave the software they already pay for.",
      },
      {
        id: "TLG",
        title: "Invoice at the tailgate",
        scene: "Owner on the dropped tailgate at the end of the job, finishing the invoice before driving off.",
        screen: "The invoice, ready to send.",
        runs: ["PRICING · US", "CORE · CA"],
        why: "“Invoice before you drive off” — the moment the price searcher is picturing.",
      },
    ],
  },
];

const RULES = [
  ["do", "Shoot horizontal, with the hands and phone in the middle. One photo then gives both the square and the wide version."],
  ["do", "Real crews, real gear, real dirt: gloves, boots, the truck, the site."],
  ["do", "Screen brightness all the way up and the screen wiped clean. The phone is the subject."],
  ["do", "A demo company on screen with a believable name — never a real customer’s name or address."],
  ["do", "Natural light, sharp focus, no filters. Any recent phone is plenty: Google asks for 1200 pixels, a phone shoots about 4000."],
  ["do", "A signed OK from anyone whose face is in the shot."],
  ["never", "Anything added on top — text, logos, arrows, frames. Google disapproves those on sight."],
  ["never", "An office, a laptop, or a posed smile. The old account proved those lose."],
  ["never", "Big brand logos on shirts or hats, or someone else’s software on screen."],
];

const shot = (s) => `
      <article class="shot" aria-labelledby="shot-${s.id}">
        <header class="shot-head">
          <span class="shot-id">${s.id}</span>
          <h3 id="shot-${s.id}">${s.title}</h3>
        </header>
        <dl class="call">
          <dt>Scene</dt><dd>${s.scene}</dd>
          <dt>On screen</dt><dd>${s.screen}</dd>
          <dt>Runs in</dt><dd class="runs">${s.runs.map((r) => `<span>${r}</span>`).join("")}</dd>
          <dt>Why</dt><dd class="why">${s.why}</dd>
        </dl>
      </article>`;

const html = `<title>OPS Ad Shot List</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Mohave:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap">
<style>
  /* One visual world on purpose: the OPS canvas is black, hairlines carry the
     structure, and the steel-blue accent appears once — the square cut in the
     framing diagram, the one instruction that decides whether a photo works. */
  :root {
    --ground: #000000;
    --surface: #0A0B0C;
    --ink: #EDEDED;
    --ink-2: #B5B5B5;
    --ink-3: #8A8A8A;
    --ink-4: #6A6A6A;
    --line: rgba(237, 237, 237, 0.10);
    --line-soft: rgba(237, 237, 237, 0.06);
    --accent: #6F94B0;
    --olive: #9DB582;
    --rose: #B58289;
    --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    --sans: "Mohave", "Helvetica Neue", Arial, sans-serif;
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--ground); color: var(--ink); font-family: var(--sans); font-size: 17px; line-height: 1.55; -webkit-font-smoothing: antialiased; }
  .wrap { max-width: 780px; margin: 0 auto; padding: 48px 22px 96px; display: flex; flex-direction: column; gap: 48px; }
  .mono, .eyebrow, .shot-id, dt, .runs span, .spec, .rule-mark, figcaption { font-family: var(--mono); font-variant-numeric: tabular-nums slashed-zero; }

  .eyebrow { font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--ink-3); margin: 0 0 16px; }
  h1 { font-size: clamp(34px, 7vw, 54px); font-weight: 700; line-height: 1.02; letter-spacing: 0.03em; text-transform: uppercase; text-wrap: balance; margin: 0 0 18px; }
  .lede { font-size: 19px; color: var(--ink-2); max-width: 60ch; margin: 0; }
  .lede strong { color: var(--ink); font-weight: 600; }
  h2 { font-size: 22px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; margin: 0; }
  section { display: flex; flex-direction: column; gap: 18px; border-top: 1px solid var(--line); padding-top: 22px; }
  section > p { color: var(--ink-2); max-width: 64ch; margin: 0; }

  .specs { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1px; background: var(--line-soft); border: 1px solid var(--line); }
  .specs div { background: var(--surface); padding: 14px 16px; display: flex; flex-direction: column; gap: 4px; }
  .spec { font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink-4); }
  .specs b { font-family: var(--mono); font-weight: 500; font-size: 15px; color: var(--ink); }
  .specs span:last-child { font-size: 13px; color: var(--ink-3); line-height: 1.4; }

  .look { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
  .look figure { margin: 0; display: flex; flex-direction: column; gap: 8px; }
  .look img { width: 100%; aspect-ratio: 1.91 / 1; object-fit: cover; display: block; border: 1px solid var(--line); }
  figcaption { font-size: 12px; color: var(--ink-3); line-height: 1.5; }

  .frame { display: grid; gap: 18px; align-items: center; }
  @media (min-width: 640px) { .frame { grid-template-columns: 300px 1fr; } }
  .frame svg { width: 100%; height: auto; display: block; }
  .frame p { margin: 0; color: var(--ink-2); }

  .tier { display: flex; flex-direction: column; gap: 0; }
  .tier-note { color: var(--ink-3); font-size: 15px; margin: 0 0 6px; max-width: 64ch; }
  .shot { border-top: 1px solid var(--line-soft); padding: 18px 0 20px; display: flex; flex-direction: column; gap: 12px; }
  .shot:first-of-type { border-top-color: var(--line); }
  .shot-head { display: flex; align-items: baseline; gap: 14px; }
  .shot-id { font-size: 12px; letter-spacing: 0.12em; color: var(--ink-3); border: 1px solid var(--line); padding: 2px 7px; flex: none; }
  h3 { font-size: 21px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; margin: 0; text-wrap: balance; }
  .call { display: grid; grid-template-columns: 96px 1fr; column-gap: 16px; row-gap: 9px; margin: 0; }
  dt { font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink-4); padding-top: 5px; }
  dd { margin: 0; color: var(--ink); }
  dd.why { color: var(--ink-2); }
  .runs { display: flex; flex-wrap: wrap; gap: 6px; }
  .runs span { font-size: 12px; color: var(--ink-2); border: 1px solid var(--line); padding: 2px 8px; }
  @media (max-width: 480px) { .call { grid-template-columns: 1fr; row-gap: 3px; } dd { margin-bottom: 8px; } }

  .rules { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .rules li { display: grid; grid-template-columns: 58px 1fr; gap: 12px; align-items: baseline; color: var(--ink-2); }
  .rule-mark { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; }
  .rule-mark.do { color: var(--olive); }
  .rule-mark.never { color: var(--rose); }

  .send { border: 1px solid var(--line); background: var(--surface); padding: 20px 22px; display: flex; flex-direction: column; gap: 8px; }
  .send h2 { font-size: 18px; }
  .send p { margin: 0; color: var(--ink-2); }
  footer { font-family: var(--mono); font-size: 11px; color: var(--ink-4); border-top: 1px solid var(--line-soft); padding-top: 16px; }
</style>

<main class="wrap">
  <header>
    <p class="eyebrow">Google Ads · photos to shoot · for Jackson</p>
    <h1>Seven shots<br>for the ads</h1>
    <p class="lede">What the old ads proved: <strong>real work in real hands, with the app on screen, beats every logo and slogan.</strong> These seven photos put that in front of each campaign. One photo gives both shapes Google needs, so seven shots make fourteen images — inside the limit of twenty.</p>
  </header>

  <div class="specs" role="list" aria-label="Google's rules for search images">
    <div role="listitem"><span class="spec">Square 1:1</span><b>1200 × 1200</b><span>Required. 300 px minimum.</span></div>
    <div role="listitem"><span class="spec">Wide 1.91:1</span><b>1200 × 628</b><span>Recommended. 600 × 314 minimum.</span></div>
    <div role="listitem"><span class="spec">Per campaign</span><b>4 to 20</b><span>Google wants at least 4.</span></div>
    <div role="listitem"><span class="spec">Starts showing</span><b>~30 days in</b><span>After a month of search spend.</span></div>
  </div>

  <section>
    <h2>The look</h2>
    <p>The two images you already backed. Every shot below is a variation on them.</p>
    <div class="look">
      <figure><img src="${uri("A2_glove_app_wide")}" alt="A dusty work glove holding a phone that shows the OPS app"><figcaption>Glove and app — 7.8% clicked, 20 downloads</figcaption></figure>
      <figure><img src="${uri("E_truck_wide")}" alt="Hands holding a phone showing an OPS job, inside a work truck"><figcaption>App in the truck — real hands, real cab</figcaption></figure>
    </div>
  </section>

  <section>
    <h2>How to frame every shot</h2>
    <div class="frame">
      <svg viewBox="0 0 300 172" role="img" aria-labelledby="frame-title">
        <title id="frame-title">A wide frame with a square cut in the middle; the hands and phone sit inside the square</title>
        <rect x="1" y="12" width="298" height="156" fill="#0A0B0C" stroke="rgba(237,237,237,0.35)" stroke-width="1.5"></rect>
        <rect x="72" y="12" width="156" height="156" fill="none" stroke="#6F94B0" stroke-width="2" stroke-dasharray="6 5"></rect>
        <rect x="126" y="44" width="48" height="92" rx="7" fill="#1A1C1E" stroke="#EDEDED" stroke-width="1.5"></rect>
        <rect x="132" y="56" width="36" height="66" rx="2" fill="#6F94B0" opacity="0.35"></rect>
        <path d="M104 150 C112 118 122 110 128 112 L128 136 C120 144 114 152 104 150 Z" fill="#8A8A8A"></path>
        <path d="M196 150 C188 118 178 110 172 112 L172 136 C180 144 186 152 196 150 Z" fill="#8A8A8A"></path>
        <text x="4" y="8" fill="#8A8A8A" font-family="JetBrains Mono, monospace" font-size="8" letter-spacing="1">WIDE 1.91:1</text>
        <text x="228" y="8" fill="#6F94B0" font-family="JetBrains Mono, monospace" font-size="8" letter-spacing="1" text-anchor="end">SQUARE CUT</text>
      </svg>
      <p>Hold the phone horizontal and keep the hands and phone inside the middle square. Then I can cut the wide version and the square version from the same photo without losing anything that matters. Leave room around the edges — Google trims images to fit.</p>
    </div>
  </section>

  ${TIERS.map((t) => `
  <section class="tier">
    <h2>${t.name}</h2>
    <p class="tier-note">${t.note}</p>
    ${t.shots.map(shot).join("")}
  </section>`).join("")}

  <section>
    <h2>Every shot</h2>
    <ul class="rules">
      ${RULES.map(([kind, text]) => `<li><span class="rule-mark ${kind}">${kind === "do" ? "Do" : "Never"}</span><span>${text}</span></li>`).join("")}
    </ul>
  </section>

  <div class="send">
    <h2>Where the crews come from</h2>
    <p>Your own deck and rail crew covers the glove, truck, handoff and tailgate shots — and the demo data on screen is already glass railings, so it all matches. The cleaning, landscaping and roofing shots need a crew in that trade: an OPS customer, or someone you know.</p>
  </div>

  <div class="send">
    <h2>When you have them</h2>
    <p>Drop them into the chat. I check each against Google’s rules, cut the square and wide versions, and show you every one before it goes into the account. There is no rush on the last four; the three trade shots are the ones worth getting first.</p>
  </div>

  <footer>Specs from Google Ads Help, “About image assets for Search campaigns” and “Image assets format requirements”, read 2026-09-11 · results from the account’s own history</footer>
</main>
`;
process.stdout.write(html);
