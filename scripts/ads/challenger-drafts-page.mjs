#!/usr/bin/env node
/**
 * The review page for the challenger drafts: each ad group's live control next
 * to the draft that would replace its challenger, every draft line tagged with
 * where it came from and what it did last time.
 *
 *   node scripts/ads/challenger-drafts-page.mjs > docs/artifacts/ads-engine/p2/challenger-drafts.html
 *
 * Generated from config/ads/drafts/2026-09-10-challengers.json and the
 * blueprint, so the page cannot show copy the files do not contain.
 */
import { readFileSync } from "node:fs";

const drafts = JSON.parse(readFileSync("config/ads/drafts/2026-09-10-challengers.json", "utf8"));
const blueprint = JSON.parse(readFileSync("config/ads/blueprint.json", "utf8"));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const displayUrl = (group) =>
  `${group.finalUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}${group.path1 ? `/${group.path1}` : ""}${group.path2 ? `/${group.path2}` : ""}`;

const kindOf = (source) =>
  source.startsWith("verbatim") ? "verbatim"
  : source.startsWith("adapted") ? "adapted"
  : source.startsWith("new") ? "new"
  : source.startsWith("pinned") ? "keyword"
  : "current";
const TAG = { verbatim: "Proven", adapted: "Proven, reworded", new: "New", keyword: "Keyword", current: "Current ads" };

const serp = (group, ad) => `
  <div class="serp">
    <div class="serp-url"><span class="serp-tag">Ad</span> ${esc(displayUrl(group))}</div>
    <h4 class="serp-title">${esc(ad.headlines.filter((h) => h.pinnedField).map((h) => h.text).join(" | "))}</h4>
    <p class="serp-body">${esc(ad.descriptions.slice(0, 2).map((d) => d.text).join(" "))}</p>
  </div>`;

const lineList = (items, evidence) => `
  <ul class="lines">${items
    .map((x) => {
      const source = evidence[x.text];
      const kind = kindOf(source);
      return `<li><span class="tag tag-${kind}">${TAG[kind]}</span><span class="line">${esc(x.text)}${x.pinnedField ? ' <em class="pin">first headline</em>' : ""}</span>${kind === "keyword" || kind === "current" ? "" : `<span class="src">${esc(source.replace(/^(verbatim|adapted|new) · /, ""))}</span>`}</li>`;
    })
    .join("")}</ul>`;

const block = (d) => {
  const campaign = blueprint.campaigns.find((c) => c.name === d.campaign);
  const group = campaign.adGroups.find((g) => g.name === d.adGroup);
  const control = group.ads.find((a) => a.role === "control");
  return `
  <section class="group">
    <header class="group-head">
      <p class="crumb">${esc(d.campaign)}</p>
      <h2>${esc(d.adGroup)}</h2>
      <p class="buys"><span class="lbl">Shows for</span> ${[...new Set(group.keywords.map((k) => k.text))].map((k) => `<code>${esc(k)}</code>`).join("")}</p>
    </header>
    <div class="pair">
      <article class="ad ad-live">
        <p class="role role-live">Stays — current ad · price angle</p>
        ${serp(group, control)}
      </article>
      <article class="ad ad-draft">
        <p class="role role-draft">Draft — replaces the second ad · proven lines</p>
        ${serp(group, d.ad)}
        <details class="pool" open>
          <summary>Every line Google can use, and where it came from</summary>
          <p class="sub">Headlines</p>
          ${lineList(d.ad.headlines, d.evidence)}
          <p class="sub">Descriptions</p>
          ${lineList(d.ad.descriptions, d.evidence)}
        </details>
      </article>
    </div>
  </section>`;
};

const html = `<title>Proven-Line Challengers</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Mohave:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap">
<style>
  /* OPS runs one visual world on purpose: pure black canvas, hairlines, no
     shadows, one steel-blue accent. Single theme by design — every colour is
     painted explicitly so the page holds on any host ground. */
  :root {
    --ground: #000000; --panel: #0A0A0A; --raised: #141414;
    --ink: #EDEDED; --ink-2: #B5B5B5; --ink-3: #8A8A8A; --ink-4: #6A6A6A;
    --line: rgba(255,255,255,0.10); --line-soft: rgba(255,255,255,0.06);
    --accent: #6F94B0; --olive: #9DB582; --tan: #C4A868;
    --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    --sans: "Mohave", "Helvetica Neue", Arial, sans-serif;
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--ground); color: var(--ink); font-family: var(--sans); font-size: 16px; line-height: 1.6; -webkit-font-smoothing: antialiased; }
  .wrap { max-width: 1040px; margin: 0 auto; padding: 56px 24px 96px; }
  code, .lbl, .role, .serp-url, .tag, .src, .crumb, .sub, .pool summary, .num { font-family: var(--mono); font-variant-numeric: tabular-nums slashed-zero; }

  .eyebrow { font-family: var(--mono); font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--ink-3); margin: 0 0 18px; }
  h1 { font-size: clamp(32px, 5.5vw, 52px); font-weight: 700; line-height: 1.05; letter-spacing: 0.03em; text-transform: uppercase; text-wrap: balance; margin: 0 0 20px; }
  .standfirst { font-size: 18px; color: var(--ink-2); max-width: 64ch; margin: 0 0 30px; }
  .standfirst strong { color: var(--ink); font-weight: 600; }

  .brief { display: grid; gap: 1px; background: var(--line-soft); border: 1px solid var(--line); margin: 0 0 14px; }
  @media (min-width: 760px) { .brief { grid-template-columns: repeat(3, 1fr); } }
  .brief div { background: var(--panel); padding: 18px 20px; }
  .brief h3 { font-family: var(--mono); font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink-3); font-weight: 500; margin: 0 0 8px; }
  .brief p { margin: 0; font-size: 15px; color: var(--ink-2); line-height: 1.5; }
  .brief b { color: var(--ink); font-weight: 600; }
  .confirm { border: 1px solid rgba(196,168,104,0.35); padding: 14px 18px; margin: 0 0 52px; font-size: 14px; color: var(--ink-2); }
  .confirm b { color: var(--tan); }

  .group { border-top: 1px solid var(--line); padding-top: 22px; margin: 0 0 52px; }
  .crumb { font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-4); margin: 0 0 4px; }
  h2 { font-size: 24px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; margin: 0 0 10px; }
  .buys { margin: 0 0 18px; font-size: 13px; color: var(--ink-3); }
  .lbl { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-4); margin-right: 8px; }
  code { font-size: 12px; color: var(--ink-2); background: var(--raised); border: 1px solid var(--line-soft); padding: 2px 7px; margin: 0 4px 4px 0; display: inline-block; border-radius: 3px; }

  .pair { display: grid; gap: 14px; align-items: start; }
  @media (min-width: 820px) { .pair { grid-template-columns: 5fr 7fr; } }
  .ad { background: var(--panel); border: 1px solid var(--line); padding: 18px 20px; display: flex; flex-direction: column; gap: 12px; }
  .ad-live { opacity: 0.78; }
  .ad-draft { border-color: rgba(111,148,176,0.45); }
  .role { font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; margin: 0; }
  .role-live { color: var(--ink-3); }
  .role-draft { color: var(--accent); }

  .serp { border-left: 2px solid var(--line); padding-left: 14px; display: flex; flex-direction: column; gap: 5px; }
  .serp-url { font-size: 12px; color: var(--ink-3); }
  .serp-tag { color: var(--ink); font-weight: 700; letter-spacing: 0.06em; margin-right: 6px; }
  .serp-title { margin: 0; font-size: 17px; font-weight: 500; line-height: 1.3; color: var(--accent); }
  .serp-body { margin: 0; font-size: 14px; color: var(--ink-2); line-height: 1.5; }

  .pool summary { font-size: 11px; color: var(--ink-3); cursor: pointer; letter-spacing: 0.03em; }
  .pool summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  .sub { font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink-4); margin: 14px 0 6px; }
  .lines { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .lines li { display: grid; grid-template-columns: 120px 1fr; column-gap: 12px; row-gap: 2px; align-items: baseline; }
  .tag { font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; padding: 2px 6px; border: 1px solid; width: fit-content; }
  .tag-verbatim { color: var(--olive); border-color: rgba(157,181,130,0.45); }
  .tag-adapted { color: var(--olive); border-color: rgba(157,181,130,0.25); }
  .tag-new { color: var(--tan); border-color: rgba(196,168,104,0.45); }
  .tag-keyword, .tag-current { color: var(--ink-3); border-color: var(--line); }
  .line { font-size: 15px; color: var(--ink); }
  .pin { font-style: normal; font-family: var(--mono); font-size: 10px; color: var(--ink-4); letter-spacing: 0.06em; margin-left: 6px; }
  .src { grid-column: 2; font-size: 11px; color: var(--ink-3); line-height: 1.45; }

  .next { border-top: 1px solid var(--line); padding-top: 26px; }
  .next p { color: var(--ink-2); max-width: 66ch; }
  footer { margin-top: 48px; padding-top: 18px; border-top: 1px solid var(--line-soft); font-family: var(--mono); font-size: 11px; color: var(--ink-4); }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
</style>

<div class="wrap">
  <p class="eyebrow">Google Ads · challenger drafts · ${esc(drafts.version)} · not in the account</p>
  <h1>Eleven second ads,<br>built from what worked</h1>
  <p class="standfirst">
    Each ad group keeps its current ad, which leads with our price. The <strong>second ad</strong> in
    each group is rewritten with the lines that earned the most attention in the old account —
    the owner's pain in his own words and the maker's credibility, <strong>with no price at all</strong>.
    Google shows both and we learn which angle wins. Nothing here reaches Google until you approve it.
  </p>

  <div class="brief">
    <div><h3>What the old ads proved</h3><p><b>Concrete pain won everywhere.</b> "Eliminate status check calls" drew 12.2% of viewers; the maker-credibility ad bought the cheapest downloads at $2.63.</p></div>
    <div><h3>What they disproved</h3><p><b>The military swagger.</b> Fourteen bracketed headlines — "[ Dominate Jobs. ]" and the rest — drew zero clicks in about 5,000 views. None of it is here.</p></div>
    <div><h3>What is left out on purpose</h3><p><b>The money claims.</b> "$400 a month", "122% ROI" drew clicks but cannot be proven. Our rules block them, and so would Google if challenged.</p></div>
  </div>
  <p class="confirm"><b>One fact to confirm:</b> the draft says "10 years in deck and rail". That comes from the copywriter brief — the old ads said 10 in one place and 12 in another. Tell me if it is wrong.</p>

  ${drafts.drafts.map(block).join("")}

  <section class="next">
    <h2>When you approve</h2>
    <p>Each draft replaces the second ad in its group in the account file. The current second ad is paused, not deleted, so its history stays readable. The new one goes to Google for review against the live pages — which are up now, so it should not hit the "destination not working" rejection the current ads did. Nothing turns on: every campaign stays paused until you say launch.</p>
    <p>Approve them all, reject any, or tell me what to change in any line — here in the comments or in the chat.</p>
  </section>

  <footer>Generated from config/ads/drafts/2026-09-10-challengers.json · every line passes the same copy rules as the live ads · legacy results from the account's own history</footer>
</div>
`;
process.stdout.write(html);
