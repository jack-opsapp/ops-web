#!/usr/bin/env node
/**
 * Second look at the ad images, after Jackson's notes (2026-09-10): the glove
 * crop he did not like, the truck shot he rated, and the outdated logo.
 * Shows every image before it is used — his rule — and the full set that
 * would run.
 *
 *   node scripts/ads/image-picks-page.mjs > docs/artifacts/ads-engine/p2/image-picks.html
 */
import { readFileSync } from "node:fs";

const THUMBS = "docs/artifacts/ads-engine/p2/legacy-analysis/images/thumbs";
const uri = (key) => `data:image/jpeg;base64,${readFileSync(`${THUMBS}/${key}.jpg`).toString("base64")}`;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const card = (key, title, note, kind = "yes") => `
      <figure class="img img-${kind}">
        <img src="${uri(key)}" alt="${esc(title)}">
        <figcaption><span class="tag tag-${kind}">${kind === "yes" ? "Use" : kind === "alt" ? "Alternative" : "Drop"}</span><b>${esc(title)}</b><span class="why">${esc(note)}</span></figcaption>
      </figure>`;

const html = `<title>Ad Images, Second Look</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Mohave:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap">
<style>
  /* OPS runs one visual world on purpose: pure black canvas, hairlines, one
     steel-blue accent. Single theme by design, every colour painted explicitly. */
  :root {
    --ground: #000; --panel: #0A0A0A;
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
  .eyebrow, .tag, .spec { font-family: var(--mono); }
  .eyebrow { font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--ink-3); margin: 0 0 18px; }
  h1 { font-size: clamp(32px, 5.5vw, 52px); font-weight: 700; line-height: 1.05; letter-spacing: 0.03em; text-transform: uppercase; text-wrap: balance; margin: 0 0 20px; }
  h2 { font-size: 24px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; margin: 0 0 8px; }
  .lede { font-size: 18px; color: var(--ink-2); max-width: 64ch; margin: 0 0 44px; }
  section { border-top: 1px solid var(--line); padding-top: 24px; margin: 0 0 52px; }
  section > p { color: var(--ink-2); max-width: 66ch; margin: 0 0 22px; }
  .gallery { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
  .img { margin: 0; background: var(--panel); border: 1px solid var(--line); display: flex; flex-direction: column; }
  .img img { width: 100%; height: 230px; object-fit: contain; background: #050505; display: block; border-bottom: 1px solid var(--line); }
  .img figcaption { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 5px; }
  .img b { font-weight: 600; font-size: 15px; }
  .why { font-size: 14px; color: var(--ink-2); line-height: 1.45; }
  .tag { font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase; padding: 2px 6px; border: 1px solid; width: fit-content; }
  .tag-yes { color: var(--olive); border-color: rgba(157,181,130,0.45); }
  .tag-alt { color: var(--tan); border-color: rgba(196,168,104,0.45); }
  .tag-no { color: var(--rose); border-color: rgba(181,130,137,0.45); }
  .img-no { opacity: 0.55; }
  .note { border: 1px solid rgba(196,168,104,0.35); padding: 14px 18px; font-size: 14px; color: var(--ink-2); max-width: 70ch; }
  .note b { color: var(--tan); }
  ol { color: var(--ink-2); padding-left: 20px; }
  footer { margin-top: 48px; padding-top: 18px; border-top: 1px solid var(--line-soft); font-family: var(--mono); font-size: 11px; color: var(--ink-4); }
</style>

<div class="wrap">
  <p class="eyebrow">Google Ads · images · second look · nothing used until you say so</p>
  <h1>The images,<br>after your notes</h1>
  <p class="lede">Three changes: a better crop of the glove shot, the truck shot back in, and the current OPS mark as the business logo. Search images may carry no added text or logos, so the originals cannot run as they were.</p>

  <section>
    <h2>Glove and app</h2>
    <p>The whole gloved hand and the whole phone do not fit in a square without the old headline creeping in, so the glove shot runs wide only. This is the original composition with the words cut away.</p>
    <div class="gallery">
      ${card("A2_glove_app_wide", "Wide crop — the whole hand", "1470 × 770. The best image the old account ran (7.8% clicked, 20 downloads), minus its text. The screen still reads TEST COMPANY.")}
      ${card("A_glove_app_square", "The square crop you did not like", "Cut the phone and zoomed the glove. Dropped.", "no")}
    </div>
  </section>

  <section>
    <h2>App in the truck</h2>
    <p>You were right, and I was wrong to turn it down. It is exactly the pattern that won — the real app, in real hands, where the work happens — with no added text. I had marked it down on file size and on a result from a campaign whose tracking was broken. The files are 704 pixels wide: under Google's recommended size, over its minimum, so it runs, slightly softer than the rest. If a larger original exists, it is worth swapping in.</p>
    <div class="gallery">
      ${card("E_truck_wide", "Wide", "704 × 368, already in the account. The tumbler is cut off in this version.")}
      ${card("E_truck_square", "Square", "704 × 707, already in the account. The YETI name on the tumbler is part of the photo, not added text, so Google's rule does not touch it.")}
    </div>
  </section>

  <section>
    <h2>Business logo</h2>
    <p>The logo the account carried is the 2025 mark. The current one — the two interlocking brackets, adopted in April — is the same file on the site, the web app and the design system. Google shows it small, sometimes cropped to a circle, on light and dark pages alike.</p>
    <div class="gallery">
      ${card("L1_logo_mark", "Current mark, off-white on black", "Rendered from the vector at Google's recommended 1200 × 1200. Matches the icon on opsapp.co and try.opsapp.co — where every ad click lands.")}
      ${card("L2_logo_appicon", "The app icon", "The same mark with the gradient, as it sits on a phone. The one people see in the App Store rather than on the page the ad opens.", "alt")}
      ${card("L0_logo_old", "The logo the account had", "The 2025 mark. Retired.", "no")}
    </div>
  </section>

  <section>
    <h2>The full set that would run</h2>
    <ol>
      <li>Wide: glove and app, app in the truck, owner at his van, tool belt, worker carrying pipe.</li>
      <li>Square: app in the truck, owner at his van, tool belt.</li>
      <li>Business logo: the current mark.</li>
    </ol>
    <p class="note"><b>When they will show:</b> Google only shows images on search ads once an account has had search spend in the last 30 days. They will be attached from day one and start appearing about a month after launch.</p>
  </section>

  <footer>Source files in config/ads/images and legacy-analysis/images · every image shown here before it reaches the account</footer>
</div>
`;
process.stdout.write(html);
