#!/usr/bin/env node
/**
 * Measure keyword demand — the pull that replaced the manual Keyword Planner
 * export (P2 plan Task 3R).
 *
 * `KeywordPlanIdeaService.GenerateKeywordIdeas` works on this developer token
 * (confirmed 2026-09-09). It returns monthly searches and the low/high
 * top-of-page bid for every seed and for the ideas Google associates with it,
 * per country. That is the evidence the blueprint's keyword list is pruned
 * against — no seed goes live without a number next to it.
 *
 * The API rejects more than ten seed keywords per request with
 * 400 INVALID_ARGUMENT, so seeds are chunked in tens.
 *
 *   node scripts/ads/keyword-demand.mjs                     # write the dated file
 *   node scripts/ads/keyword-demand.mjs --seeds a,b,c       # ad-hoc terms
 *   node scripts/ads/keyword-demand.mjs --out path.json
 *
 * Costs nothing: the Keyword Planner is a free read, it places no bid and
 * creates nothing in the account.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { GoogleAuth } from "google-auth-library";

const API = "https://googleads.googleapis.com/v25";
const GEOS = {
  US: "geoTargetConstants/2840",
  CA: "geoTargetConstants/2124",
};
const LANGUAGE = "languageConstants/1000";
const CHUNK = 10;

/** Every seed the blueprint bids on, plus the terms we deliberately hold back. */
const DEFAULT_SEEDS = [
  "jobber pricing",
  "how much does jobber cost",
  "jobber cost",
  "jobber plans",
  "housecall pro pricing",
  "housecall pro cost",
  "how much is housecall pro",
  "jobber alternative",
  "jobber alternatives",
  "jobber competitors",
  "software like jobber",
  "alternatives to jobber",
  "free jobber alternatives",
  "switch from jobber",
  "apps similar to jobber",
  "housecall pro alternative",
  "housecall pro alternatives",
  "housecall pro competitors",
  "servicetitan alternative",
  "servicetitan competitors",
  "servicetitan pricing",
  "cleaning business software",
  "cleaning company software",
  "janitorial software",
  "cleaning business app",
  "landscaping business software",
  "lawn care software",
  "landscaping software",
  "lawn care business app",
  "roofing contractor software",
  "roofing software",
  "roofing business software",
  "job management app",
  "crew scheduling app",
  "contractor scheduling app",
  "contractor invoicing app",
  "job management software for trades",
  // Held back, measured anyway so the decision stays reviewable.
  "field service management software",
  "plumbing business software",
  "hvac scheduling software",
  "electrician scheduling software",
];

function readEnv(path = ".env.local") {
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const at = line.indexOf("=");
        let value = line.slice(at + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        )
          value = value.slice(1, -1);
        return [line.slice(0, at).trim(), value];
      })
  );
}

function pem(raw) {
  const key = raw.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");
  if (key.includes("-----BEGIN")) return key;
  const body = key.replace(/\s/g, "");
  return `-----BEGIN PRIVATE KEY-----\n${(body.match(/.{1,64}/g) ?? [body]).join("\n")}\n-----END PRIVATE KEY-----\n`;
}

async function accessToken(env) {
  const credentials = env.FIREBASE_ADMIN_SERVICE_ACCOUNT
    ? JSON.parse(env.FIREBASE_ADMIN_SERVICE_ACCOUNT)
    : {
        client_email:
          env.FIREBASE_ADMIN_CLIENT_EMAIL ??
          `firebase-adminsdk-fbsvc@${env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.iam.gserviceaccount.com`,
        private_key: pem(env.FIREBASE_ADMIN_PRIVATE_KEY),
      };
  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/adwords"],
  });
  return (await (await auth.getClient()).getAccessToken()).token;
}

const chunk = (items, size) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, i * size + size)
  );

const dollars = (micros) =>
  micros == null ? null : Math.round(Number(micros) / 10_000) / 100;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The Keyword Planner rate-limits bursts with RESOURCE_EXHAUSTED and tells you
 * how long to wait ("Retry in 4 seconds"). Honour that, with a floor, rather
 * than failing a pull half way through.
 */
function retryDelayMs(body) {
  const seconds = /Retry in (\d+) seconds?/.exec(body)?.[1];
  return Math.max(5_000, Number(seconds ?? 0) * 1_000 + 1_000);
}

async function generateIdeas({ token, env, customerId, geo, keywords, attempt = 0 }) {
  const response = await fetch(
    `${API}/customers/${customerId}:generateKeywordIdeas`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "developer-token": env.GOOGLE_ADS_DEVELOPER_TOKEN,
        "Content-Type": "application/json",
        ...(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
          ? { "login-customer-id": env.GOOGLE_ADS_LOGIN_CUSTOMER_ID }
          : { "login-customer-id": "5448339076" }),
      },
      body: JSON.stringify({
        language: LANGUAGE,
        geoTargetConstants: [geo],
        keywordPlanNetwork: "GOOGLE_SEARCH",
        keywordSeed: { keywords },
      }),
    }
  );
  const text = await response.text();
  if (!response.ok) {
    if ((response.status === 429 || text.includes("RESOURCE_EXHAUSTED")) && attempt < 5) {
      const wait = retryDelayMs(text) * (attempt + 1);
      process.stderr.write(`  rate limited; waiting ${wait / 1000}s\n`);
      await sleep(wait);
      return generateIdeas({ token, env, customerId, geo, keywords, attempt: attempt + 1 });
    }
    throw new Error(
      `generateKeywordIdeas ${response.status} (request-id ${response.headers.get("request-id")}): ${text.slice(0, 500)}`
    );
  }
  return JSON.parse(text).results ?? [];
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const at = args.indexOf(`--${name}`);
    return at >= 0 ? args[at + 1] : null;
  };
  const seeds = flag("seeds")
    ? flag("seeds").split(",").map((s) => s.trim()).filter(Boolean)
    : DEFAULT_SEEDS;
  // Dated in the account's own reporting timezone (America/Vancouver), so the
  // filename lines up with every Google Ads report and with the research notes.
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const out = flag("out") ?? `config/ads/keyword-demand-${today}.json`;

  const env = readEnv();
  const customerId = (env.GOOGLE_ADS_CUSTOMER_ID ?? "4454506598").replace(/-/g, "");
  const token = await accessToken(env);

  /** term → { US: {...}, CA: {...} } for the seeds we asked about. */
  const wanted = new Set(seeds.map((s) => s.toLowerCase()));
  const measured = new Map();
  const counts = {};

  for (const [country, geo] of Object.entries(GEOS)) {
    let ideas = 0;
    for (const batch of chunk(seeds, CHUNK)) {
      const results = await generateIdeas({
        token,
        env,
        customerId,
        geo,
        keywords: batch,
      });
      ideas += results.length;
      for (const result of results) {
        const text = String(result.text ?? "").toLowerCase();
        if (!wanted.has(text)) continue;
        const metrics = result.keywordIdeaMetrics ?? {};
        const entry = measured.get(text) ?? { term: text };
        entry[country] = {
          monthlySearches: Number(metrics.avgMonthlySearches ?? 0),
          competition: metrics.competition ?? null,
          lowTopOfPageBid: dollars(metrics.lowTopOfPageBidMicros),
          highTopOfPageBid: dollars(metrics.highTopOfPageBidMicros),
        };
        measured.set(text, entry);
      }
      process.stderr.write(`${country}: ${batch.length} seeds → ${results.length} ideas so far ${ideas}\n`);
      await sleep(2_000);
    }
    counts[country] = ideas;
  }

  const terms = [...measured.values()].sort(
    (a, b) => (b.US?.monthlySearches ?? 0) - (a.US?.monthlySearches ?? 0)
  );
  const zero = terms
    .filter(
      (t) => (t.US?.monthlySearches ?? 0) === 0 && (t.CA?.monthlySearches ?? 0) === 0
    )
    .map((t) => t.term);
  const missing = seeds.filter((s) => !measured.has(s.toLowerCase()));

  const payload = {
    pulledAt: new Date().toISOString(),
    accountDate: today,
    timezone: "America/Vancouver",
    source: "KeywordPlanIdeaService.GenerateKeywordIdeas (v25)",
    customerId,
    language: LANGUAGE,
    geoTargetConstants: GEOS,
    network: "GOOGLE_SEARCH",
    currency: "CAD",
    seedCount: seeds.length,
    ideasReturned: counts,
    /** Seeds Google returned no idea for at all — treat as unmeasurable, not as zero. */
    unreturnedSeeds: missing,
    /** Seeds with no searches in either country: never bid on these. */
    zeroVolumeSeeds: zero,
    terms,
  };

  writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
  process.stderr.write(
    `\nWrote ${out}: ${terms.length} measured seeds, ${zero.length} at zero volume, ${missing.length} unreturned.\n`
  );
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
