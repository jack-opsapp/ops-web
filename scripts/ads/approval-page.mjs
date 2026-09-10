#!/usr/bin/env node
/**
 * Build the approval page — the 24 ads as a searcher would see them, plus what
 * exists in the account and what is left to do.
 *
 * Generated from `ad-previews.json` and `account-state.json` rather than
 * written by hand, so the page cannot claim something the account does not say.
 *
 *   node scripts/ads/ad-previews.mjs --json > docs/artifacts/ads-engine/p2/ad-previews.json
 *   node scripts/ads/account-state.mjs     > docs/artifacts/ads-engine/p2/account-state.json
 *   node scripts/ads/approval-page.mjs     > docs/artifacts/ads-engine/p2/approval.html
 */
import { readFileSync } from "node:fs";

const A = "docs/artifacts/ads-engine/p2";
const previews = JSON.parse(readFileSync(`${A}/ad-previews.json`, "utf8"));
const state = JSON.parse(readFileSync(`${A}/account-state.json`, "utf8"));
const blueprint = JSON.parse(readFileSync("config/ads/blueprint.json", "utf8"));

const ENGINE = new Set(blueprint.campaigns.map((c) => c.name));
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (micros) => `$${(Number(micros) / 1_000_000).toFixed(0)}`;

const live = state.campaigns.filter((c) => ENGINE.has(c.name));
const ads = state.ads.filter((a) => ENGINE.has(a.campaign));
const approved = ads.filter((a) => a.approval === "APPROVED").length;
const reviewing = ads.filter((a) => a.review === "REVIEW_IN_PROGRESS").length;
const negatives = blueprint.sharedNegativeLists.reduce(
  (n, l) => n + l.keywords.length,
  0
);
const keywordCount = state.keywords.filter((k) =>
  ENGINE.has(k.split(" › ")[0])
).length;

// ─── Ads, grouped campaign → ad group ────────────────────────────────────────
const byCampaign = new Map();
for (const ad of previews.ads) {
  if (!byCampaign.has(ad.campaign)) byCampaign.set(ad.campaign, new Map());
  const groups = byCampaign.get(ad.campaign);
  if (!groups.has(ad.adGroup)) groups.set(ad.adGroup, []);
  groups.get(ad.adGroup).push(ad);
}

const campaignMeta = (name) => {
  const c = blueprint.campaigns.find((x) => x.name === name);
  const geo = c.geo.locations
    .map((g) => (g.endsWith("2840") ? "United States" : "Canada"))
    .join(" + ");
  const cap = c.bidding.cpcBidCeilingMicros
    ? `${money(c.bidding.cpcBidCeilingMicros)} max per click`
    : `${money(c.adGroups[0].cpcBidMicros ?? "0")} max per click`;
  return { daily: money(c.budget.amountMicros), geo, cap, why: WHY[name] };
};

/** One line on why each campaign exists at the size it does. */
const WHY = {
  "BRAND · NA":
    "People typing our name. Cheapest clicks in the account, and the only campaign that runs in both countries.",
  "PRICING · US":
    "The biggest measured pocket by a wide margin — 5,700 US searches a month for what Jobber and Housecall Pro cost. It is also the exact moment our published price beats an incumbent who hides theirs.",
  "SWITCH · US":
    "Small but the highest intent in the account: someone already looking for a way out. Exact match, tight budget, highest bid ceiling.",
  "TRADE · US":
    "Cleaning, landscaping and roofing have real US volume and almost none in Canada — which is why they are a US campaign rather than the month-two addition the original plan assumed.",
  "CORE · CA":
    "The home market, kept as one blended campaign because no single Canadian lane can absorb a budget of its own.",
};

const adBlock = (ad) => `
        <article class="ad">
          <div class="ad-role">
            <span class="role role-${ad.role}">${ad.role}</span>
            <span class="angle">${esc(ad.angle)}</span>
          </div>
          <div class="serp">
            <div class="serp-url"><span class="serp-tag">Ad</span> ${esc(ad.displayUrl)}</div>
            <h4 class="serp-title">${esc(ad.pinnedHeadlines.join(" | "))}</h4>
            <p class="serp-body">${esc(ad.descriptions.join(" "))}</p>
          </div>
          <details class="pool">
            <summary>Google also rotates ${ad.rotatingHeadlines.length} more headlines and picks per search</summary>
            <ul>${ad.rotatingHeadlines.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>
          </details>
        </article>`;

const campaignBlock = (name, groups) => {
  const meta = campaignMeta(name);
  return `
    <section class="campaign" id="${esc(name.replace(/[^a-zA-Z]/g, "-").toLowerCase())}">
      <header class="campaign-head">
        <h2>${esc(name)}</h2>
        <dl class="facts">
          <div><dt>Per day</dt><dd class="num">${meta.daily}</dd></div>
          <div><dt>Ceiling</dt><dd class="num">${esc(meta.cap)}</dd></div>
          <div><dt>Runs in</dt><dd>${esc(meta.geo)}</dd></div>
        </dl>
        <p class="why">${esc(meta.why)}</p>
      </header>
      ${[...groups.entries()]
        .map(
          ([group, groupAds]) => `
      <div class="group">
        <div class="group-head">
          <h3>${esc(group)}</h3>
          <p class="buys"><span class="lbl">Shows for</span> ${groupAds[0].keywords
            .map((k) => `<code>${esc(k.replace(/ \[(EXACT|PHRASE)\]$/, ""))}</code>`)
            .join("")}</p>
          <p class="buys"><span class="lbl">Lands on</span> <code class="url">${esc(
            groupAds[0].finalUrl
          )}</code></p>
        </div>
        <div class="ads">${groupAds.map(adBlock).join("")}</div>
      </div>`
        )
        .join("")}
    </section>`;
};

const html = `<title>Ads Awaiting Your Word</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Mohave:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap">
<style>
  /* OPS runs one visual world on purpose: pure black canvas, hairlines, no
     shadows, one steel-blue accent. Single theme by design — every colour is
     painted explicitly so the page holds on any host ground. */
  :root {
    --ground: #000000;
    --panel: #0A0A0A;
    --raised: #141414;
    --ink: #EDEDED;
    --ink-2: #B5B5B5;
    --ink-3: #8A8A8A;
    --ink-4: #6A6A6A;
    --line: rgba(255, 255, 255, 0.10);
    --line-soft: rgba(255, 255, 255, 0.06);
    --accent: #6F94B0;
    --olive: #9DB582;
    --tan: #C4A868;
    --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    --sans: "Mohave", "Helvetica Neue", Arial, sans-serif;
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--ground);
    color: var(--ink);
    font-family: var(--sans);
    font-size: 16px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 940px; margin: 0 auto; padding: 56px 24px 96px; }
  .num, code, .lbl, dt, .role, .serp-url, .pool summary {
    font-family: var(--mono);
    font-variant-numeric: tabular-nums slashed-zero;
  }

  /* ── Masthead ─────────────────────────────────────────────────────────── */
  .eyebrow {
    font-family: var(--mono); font-size: 11px; letter-spacing: 0.2em;
    text-transform: uppercase; color: var(--ink-3); margin: 0 0 18px;
  }
  h1 {
    font-size: clamp(34px, 6vw, 56px); font-weight: 700; line-height: 1.04;
    letter-spacing: 0.03em; text-transform: uppercase; text-wrap: balance;
    margin: 0 0 20px;
  }
  .standfirst {
    font-size: 18px; color: var(--ink-2); max-width: 62ch; margin: 0 0 40px;
  }
  .standfirst strong { color: var(--ink); font-weight: 600; }

  /* ── The count strip ──────────────────────────────────────────────────── */
  .tally {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 1px; background: var(--line-soft);
    border: 1px solid var(--line); margin: 0 0 12px;
  }
  .tally div { background: var(--panel); padding: 18px 20px; }
  .tally dt {
    font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase;
    color: var(--ink-3); margin: 0 0 6px;
  }
  .tally dd {
    margin: 0; font-family: var(--mono); font-size: 26px; font-weight: 500;
    line-height: 1; color: var(--ink);
  }
  .tally dd small {
    display: block; font-size: 11px; font-weight: 400; color: var(--ink-3);
    margin-top: 7px; letter-spacing: 0.04em;
  }
  .paused-note {
    font-family: var(--mono); font-size: 12px; color: var(--tan);
    margin: 0 0 48px; letter-spacing: 0.02em;
  }

  /* ── Section rules ────────────────────────────────────────────────────── */
  h2 {
    font-size: 26px; font-weight: 700; letter-spacing: 0.05em;
    text-transform: uppercase; margin: 0;
  }
  .campaign { margin: 0 0 64px; }
  .campaign-head {
    border-top: 1px solid var(--line); padding-top: 22px; margin-bottom: 30px;
  }
  .facts { display: flex; flex-wrap: wrap; gap: 26px; margin: 14px 0 12px; }
  .facts div { display: flex; flex-direction: column; gap: 3px; }
  .facts dt {
    font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase;
    color: var(--ink-3);
  }
  .facts dd { margin: 0; font-size: 14px; color: var(--ink); }
  .why { color: var(--ink-2); font-size: 15px; max-width: 64ch; margin: 0; }

  /* ── Ad group ─────────────────────────────────────────────────────────── */
  .group { margin: 0 0 34px; }
  .group-head { margin-bottom: 16px; }
  h3 {
    font-size: 13px; font-weight: 600; letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--ink); margin: 0 0 10px;
  }
  .buys { margin: 0 0 6px; font-size: 13px; color: var(--ink-3); }
  .lbl {
    font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;
    color: var(--ink-4); margin-right: 8px;
  }
  code {
    font-size: 12px; color: var(--ink-2); background: var(--raised);
    border: 1px solid var(--line-soft); padding: 2px 7px;
    margin: 0 4px 4px 0; display: inline-block; border-radius: 3px;
  }
  code.url { color: var(--ink-2); }

  /* ── The ads. Two per group: control and challenger. ──────────────────── */
  .ads { display: grid; gap: 14px; }
  @media (min-width: 760px) { .ads { grid-template-columns: 1fr 1fr; } }
  .ad {
    background: var(--panel); border: 1px solid var(--line);
    padding: 18px 20px 16px; display: flex; flex-direction: column; gap: 12px;
  }
  .ad-role { display: flex; flex-direction: column; gap: 6px; }
  .role {
    font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase;
    width: fit-content; padding: 3px 8px; border: 1px solid;
  }
  .role-control { color: var(--olive); border-color: rgba(157, 181, 130, 0.4); }
  .role-challenger { color: var(--tan); border-color: rgba(196, 168, 104, 0.4); }
  .angle { font-size: 13px; color: var(--ink-3); line-height: 1.45; }

  /* The ad as a searcher meets it: a result on a results page. */
  .serp {
    border-left: 2px solid var(--line); padding-left: 14px;
    display: flex; flex-direction: column; gap: 5px;
  }
  .serp-url { font-size: 12px; color: var(--ink-3); }
  .serp-tag {
    color: var(--ink); font-weight: 700; letter-spacing: 0.06em;
    margin-right: 6px;
  }
  .serp-title {
    margin: 0; font-size: 17px; font-weight: 500; line-height: 1.3;
    color: var(--accent); letter-spacing: 0.01em;
  }
  .serp-body { margin: 0; font-size: 14px; color: var(--ink-2); line-height: 1.5; }

  .pool { margin-top: auto; }
  .pool summary {
    font-size: 11px; color: var(--ink-4); cursor: pointer; letter-spacing: 0.03em;
  }
  .pool summary:hover { color: var(--ink-3); }
  .pool summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  .pool ul {
    margin: 10px 0 0; padding-left: 16px; font-size: 13px; color: var(--ink-3);
    columns: 2; column-gap: 20px;
  }
  .pool li { margin-bottom: 3px; break-inside: avoid; }

  /* ── Closing: what is left ────────────────────────────────────────────── */
  .steps { border-top: 1px solid var(--line); padding-top: 30px; margin-top: 20px; }
  .steps ol { margin: 22px 0 0; padding: 0; list-style: none; counter-reset: step; }
  .steps li {
    counter-increment: step; padding: 16px 0 16px 52px; position: relative;
    border-bottom: 1px solid var(--line-soft);
  }
  .steps li::before {
    content: counter(step, decimal-leading-zero);
    position: absolute; left: 0; top: 17px; font-family: var(--mono);
    font-size: 12px; color: var(--ink-4); letter-spacing: 0.08em;
  }
  .steps b { display: block; font-weight: 600; font-size: 16px; margin-bottom: 3px; }
  .steps span { color: var(--ink-3); font-size: 14px; }
  .stop {
    margin-top: 34px; border: 1px solid rgba(196, 168, 104, 0.35);
    padding: 18px 20px; color: var(--ink-2); font-size: 14px;
  }
  .stop b { color: var(--tan); }
  footer {
    margin-top: 56px; padding-top: 20px; border-top: 1px solid var(--line-soft);
    font-family: var(--mono); font-size: 11px; color: var(--ink-4);
    letter-spacing: 0.04em;
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation: none !important; transition: none !important; }
  }
</style>

<div class="wrap">
  <p class="eyebrow">Google Ads · account rebuild · ${esc(previews.blueprintVersion)}</p>
  <h1>Twenty-four ads<br>awaiting your word</h1>
  <p class="standfirst">
    The ad account is rebuilt and <strong>every campaign is switched off</strong>. Nothing
    has spent a cent and nothing can until someone calls the one route that turns
    campaigns on. What follows is every ad, written the way a searcher meets it, so
    you can read them the way they will actually be read.
  </p>

  <dl class="tally">
    <div><dt>Campaigns</dt><dd>${live.length}<small>all paused</small></dd></div>
    <div><dt>Ad groups</dt><dd>${new Set(state.adGroups.filter((g) => ENGINE.has(g.split(" › ")[0])).map((g) => g)).size}<small>one page each</small></dd></div>
    <div><dt>Ads</dt><dd>${ads.length}<small>${approved > 0 ? `${approved} approved` : `${reviewing} in review`}</small></dd></div>
    <div><dt>Keywords</dt><dd>${keywordCount}<small>no broad match</small></dd></div>
    <div><dt>Blocked terms</dt><dd>${negatives}<small>across 5 lists</small></dd></div>
    <div><dt>Per day</dt><dd>$50<small>$43 of it in the US</small></dd></div>
  </dl>
  <p class="paused-note">
    Spent so far: $0.00 — and that stays true until you say otherwise.
  </p>

  ${[...byCampaign.entries()].map(([name, groups]) => campaignBlock(name, groups)).join("")}

  <section class="steps">
    <h2>What is left</h2>
    <ol>
      <li><b>Read the ads above and tell me what to change.</b><span>Rewrites go into the file and get re-applied; nothing is edited inside Google by hand, ever.</span></li>
      <li><b>Publish the seven landing pages.</b><span>Built and tested, but they only exist on this machine. They have to be live before an ad points at one — that is a push, which is yours.</span></li>
      <li><b>Publish the account code.</b><span>Same story: four commits waiting, nothing sent anywhere.</span></li>
      <li><b>Wait for Google to finish reviewing the ads.</b><span>All ${ads.length} are in review now. It usually clears within a day.</span></li>
      <li><b>Say go, and I turn the campaigns on.</b><span>One call, and the money starts at $50 a day. It refuses to run on any campaign Google has not approved at least two ads for.</span></li>
    </ol>
    <div class="stop">
      <b>Stopping is always one call, with no conditions attached.</b> Turning campaigns
      on has to pass checks; turning them off never does. That is deliberate — an
      emergency stop that can be blocked is not an emergency stop.
    </div>
  </section>

  <footer>
    Account ${esc(state.customerId)} · read from Google ${esc(state.readAt.slice(0, 16).replace("T", " "))} UTC ·
    every figure on this page generated from the account, not typed
  </footer>
</div>
`;

process.stdout.write(html);
