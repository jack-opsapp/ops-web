#!/usr/bin/env node
/**
 * The review page for the asset drafts — every image shown before it is used,
 * the images turned down and why, and the text assets per campaign.
 *
 *   node scripts/ads/asset-drafts-page.mjs > docs/artifacts/ads-engine/p2/asset-drafts.html
 *
 * Images are embedded as data URIs (the artifact host blocks outside images),
 * from the review-size copies in legacy-analysis/images/thumbs.
 */
import { readFileSync } from "node:fs";

const drafts = JSON.parse(readFileSync("config/ads/drafts/2026-09-10-assets.json", "utf8"));
const THUMBS = "docs/artifacts/ads-engine/p2/legacy-analysis/images/thumbs";
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const uri = (key) => `data:image/jpeg;base64,${readFileSync(`${THUMBS}/${key}.jpg`).toString("base64")}`;

const LABEL = {
  A_glove_app_square: "Glove and app",
  B_autodetail_wide: "Owner at his van",
  B_autodetail_square: "Owner at his van — square",
  C_toolbelt_wide: "Tool belt on site",
  C_toolbelt_square: "Tool belt on site — square",
  D_hardhat_wide: "Worker carrying pipe",
  L_logo: "Business logo",
  X_slogan: "Slogan graphic",
  X_logo_plain: "Logo only",
  X_welder_early_access: "Early-access welder",
  X_truck_lowres: "App in the truck",
};

const figure = (key, meta, kind) => `
    <figure class="img img-${kind}">
      <img src="${uri(key)}" alt="${esc(LABEL[key])}" loading="lazy">
      <figcaption>
        <b>${esc(LABEL[key])}</b>
        ${meta.aspect ? `<span class="spec">${esc(meta.aspect)}${meta.size ? ` · ${esc(meta.size)}` : ""}</span>` : ""}
        <span class="why">${esc(meta.why ?? meta)}</span>
        ${meta.flag ? `<span class="flag">${esc(meta.flag)}</span>` : ""}
      </figcaption>
    </figure>`;

const campaignBlock = ([name, c]) => `
  <section class="camp">
    <h3>${esc(name)}</h3>
    <div class="cols">
      <div>
        <p class="sub">Sitelinks</p>
        <ul class="sitelinks">${c.sitelinks.map((s) => `<li><b>${esc(s.text)}</b><span>${esc(s.description1)} ${esc(s.description2)}</span><code>${esc(s.finalUrl.replace("https://", ""))}</code></li>`).join("")}</ul>
      </div>
      <div>
        <p class="sub">Callouts</p>
        <p class="chips">${c.callouts.map((x) => `<span>${esc(x.text)}</span>`).join("")}</p>
        <p class="sub">${esc(c.snippet.header)}</p>
        <p class="plain">${c.snippet.values.map(esc).join(" · ")}</p>
        ${c.price ? `<p class="sub">Prices in the ad</p><table class="price"><tbody>${c.price.items.map((i) => `<tr><td>${esc(i.header)}</td><td>${esc(i.description)}</td><td class="num">CA$${i.price}<small>/mo</small></td></tr>`).join("")}</tbody></table>` : `<p class="sub">Prices in the ad</p><p class="plain muted">None — this campaign is not answering a price search.</p>`}
      </div>
    </div>
  </section>`;

const keep = Object.entries(drafts.images);
const turned = Object.entries(drafts.rejectedImages);
const pause = drafts.accountLevel.pause;

const html = `<title>Ad Assets for Approval</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Mohave:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap">
<style>
  /* OPS runs one visual world on purpose: pure black canvas, hairlines, one
     steel-blue accent. Single theme by design, every colour painted explicitly. */
  :root {
    --ground: #000; --panel: #0A0A0A; --raised: #141414;
    --ink: #EDEDED; --ink-2: #B5B5B5; --ink-3: #8A8A8A; --ink-4: #6A6A6A;
    --line: rgba(255,255,255,0.10); --line-soft: rgba(255,255,255,0.06);
    --accent: #6F94B0; --olive: #9DB582; --tan: #C4A868; --rose: #B58289;
    --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    --sans: "Mohave", "Helvetica Neue", Arial, sans-serif;
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--ground); color: var(--ink); font-family: var(--sans); font-size: 16px; line-height: 1.6; -webkit-font-smoothing: antialiased; }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 56px 24px 96px; }
  code, .sub, .spec, .eyebrow, .num, .chips span, .step { font-family: var(--mono); font-variant-numeric: tabular-nums slashed-zero; }
  .eyebrow { font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--ink-3); margin: 0 0 18px; }
  h1 { font-size: clamp(32px, 5.5vw, 52px); font-weight: 700; line-height: 1.05; letter-spacing: 0.03em; text-transform: uppercase; text-wrap: balance; margin: 0 0 20px; }
  h2 { font-size: 24px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; margin: 0 0 8px; }
  h3 { font-size: 15px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; margin: 0 0 14px; }
  .lede { font-size: 18px; color: var(--ink-2); max-width: 64ch; margin: 0 0 44px; }
  .lede strong { color: var(--ink); font-weight: 600; }
  section.part { border-top: 1px solid var(--line); padding-top: 24px; margin: 0 0 56px; }
  .part > p { color: var(--ink-2); max-width: 66ch; margin: 0 0 22px; }

  .gallery { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
  .img { margin: 0; background: var(--panel); border: 1px solid var(--line); display: flex; flex-direction: column; }
  .img img { width: 100%; height: 220px; object-fit: contain; background: #050505; display: block; border-bottom: 1px solid var(--line); }
  .img figcaption { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 4px; }
  .img b { font-weight: 600; font-size: 15px; }
  .spec { font-size: 11px; color: var(--ink-4); letter-spacing: 0.04em; }
  .why { font-size: 14px; color: var(--ink-2); line-height: 1.45; }
  .flag { font-size: 13px; color: var(--tan); line-height: 1.45; border-top: 1px solid var(--line-soft); padding-top: 6px; margin-top: 4px; }
  .img-no { opacity: 0.62; }
  .img-no img { filter: grayscale(0.4); }
  .img-no .why { color: var(--ink-3); }

  .camp { background: var(--panel); border: 1px solid var(--line); padding: 20px 22px; margin: 0 0 14px; }
  .cols { display: grid; gap: 24px; }
  @media (min-width: 820px) { .cols { grid-template-columns: 1fr 1fr; } }
  .sub { font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink-4); margin: 0 0 8px; }
  .sitelinks { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
  .sitelinks li { display: flex; flex-direction: column; gap: 1px; }
  .sitelinks b { color: var(--accent); font-weight: 500; font-size: 16px; }
  .sitelinks span { font-size: 14px; color: var(--ink-2); }
  code { font-size: 11px; color: var(--ink-3); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 16px; }
  .chips span { font-size: 12px; color: var(--ink-2); border: 1px solid var(--line); padding: 3px 8px; }
  .plain { font-size: 14px; color: var(--ink-2); margin: 0 0 16px; }
  .muted { color: var(--ink-3); }
  .price { border-collapse: collapse; font-size: 14px; }
  .price td { padding: 5px 16px 5px 0; border-bottom: 1px solid var(--line-soft); color: var(--ink-2); }
  .price td:first-child { color: var(--ink); }
  .num { font-size: 15px; color: var(--ink); }
  .num small { color: var(--ink-4); font-size: 11px; }

  .retire { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .retire li { display: grid; grid-template-columns: 170px 1fr; gap: 12px; font-size: 14px; color: var(--ink-2); border-bottom: 1px solid var(--line-soft); padding-bottom: 8px; }
  .retire b { color: var(--rose); font-weight: 500; font-family: var(--mono); font-size: 12px; }
  .steps { margin: 0; padding: 0; list-style: none; display: grid; gap: 10px; }
  .steps li { display: grid; grid-template-columns: 34px 1fr; color: var(--ink-2); }
  .step { font-size: 12px; color: var(--ink-4); padding-top: 3px; }
  footer { margin-top: 48px; padding-top: 18px; border-top: 1px solid var(--line-soft); font-family: var(--mono); font-size: 11px; color: var(--ink-4); }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
</style>

<div class="wrap">
  <p class="eyebrow">Google Ads · asset drafts · ${esc(drafts.version)} · not in the account</p>
  <h1>What shows up<br>around the ads</h1>
  <p class="lede">
    Assets are the extras under a search ad: links to other pages, short proof points, the prices,
    our name and logo, and sometimes a picture. None are on the new campaigns yet. <strong>Every image
    is shown here before it is used</strong>, and the account file refuses any image without your
    approval on record. One gap only you can close: Google can also pull pictures from our own pages,
    and on search campaigns that is switched off only in the account's settings — see the last section.
  </p>

  <section class="part">
    <h2>Images to use</h2>
    <p>Chosen on what the old ads proved: real work in real hands wins, logos and slogans lose. Search images may not carry text, so the best image in the account has been cropped to lose its words.</p>
    <div class="gallery">${keep.map(([k, m]) => figure(k, m, "yes")).join("")}${Object.entries(drafts.businessLogo).map(([k, m]) => figure(k, { ...m, aspect: "logo", size: m.size }, "yes")).join("")}</div>
  </section>

  <section class="part">
    <h2>Images turned down</h2>
    <p>From the same account, and the reason each one stays out.</p>
    <div class="gallery">${turned.map(([k, why]) => figure(k, { why }, "no")).join("")}</div>
  </section>

  <section class="part">
    <h2>Text assets, by campaign</h2>
    <p>Every line passes the same rules as the ads. Competitor names appear only in the two competitor campaigns and only in the forms Google's trademark rules allow. The prices are the published ones, in Canadian dollars.</p>
    ${Object.entries(drafts.campaigns).map(campaignBlock).join("")}
  </section>

  <section class="part">
    <h2>Retired, not deleted</h2>
    <p>The account carries four sitelinks at account level, which attach to every campaign — the new ones included. They would be paused, so their history stays readable.</p>
    <ul class="retire">${pause.map((p) => `<li><b>${esc(p.text)}</b><span>${esc(p.reason)} <code>${esc((p.finalUrl ?? "").replace("https://", ""))}</code></span></li>`).join("")}</ul>
  </section>

  <section class="part">
    <h2>One switch only you can flip</h2>
    <p>Google's "dynamic image assets" pull pictures from our landing pages into search ads without asking. The API refuses to turn it off per campaign on search (tried in the dry run, 2026-09-10), so it has to be switched off once for the whole account: in Google Ads, <b>Campaigns → Assets → Assets → the ⋮ menu → Account-level automated assets → Dynamic image assets → Off</b>. Until then, a picture you have not seen could appear under an ad.</p>
  </section>

  <section class="part">
    <h2>When you approve</h2>
    <ol class="steps">
      <li><span class="step">01</span><span>The eleven second ads you approved, and these assets, go into the account file together.</span></li>
      <li><span class="step">02</span><span>Google checks everything in a dry run first. Anything it would reject gets fixed before a single change is made.</span></li>
      <li><span class="step">03</span><span>The old second ads and the four account sitelinks are paused, the new ones submitted for review.</span></li>
      <li><span class="step">04</span><span>Every campaign stays paused. Nothing spends until you say launch.</span></li>
    </ol>
    <p style="margin-top:20px">Approve the lot, or name any image or line to drop or change — here in the comments or in the chat.</p>
  </section>

  <footer>Generated from config/ads/drafts/2026-09-10-assets.json · image results from the account's own history, 2025-01-01 to 2026-09-10</footer>
</div>
`;
process.stdout.write(html);
