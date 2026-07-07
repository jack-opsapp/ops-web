#!/usr/bin/env node
/**
 * migrate-supabase-storage-to-s3.mjs — one-off migration of the last images
 * still hosted on Supabase Storage over to S3, re-linked in place (bug 8d06d3a9).
 *
 * WHAT IT DOES
 *   For every DB column that can hold an image URL, finds values still on the
 *   Supabase Storage public host, copies the object into S3 under the PUBLIC
 *   `migrated/supabase-storage/<bucket>/<path>` prefix (same scheme as the
 *   earlier bulk migration), then rewrites the DB value in place to the new S3
 *   URL. Supabase objects are NOT deleted (rollback + cached-client safety).
 *
 * WHY IT'S iOS-SAFE
 *   iOS persists/loads the raw absolute URL (URL(string:)) with no host
 *   reconstruction, so a URL rewrite is picked up on the next sync. Additive
 *   only — no schema change.
 *
 * SAFETY
 *   - DEFAULT IS DRY-RUN. It reads the DB + HEADs each source and writes a
 *     manifest, but touches nothing.
 *   - Prod writes require BOTH flags: `--execute --i-understand-this-writes-to-prod`.
 *   - Idempotent: values already on S3 are skipped; objects already present in
 *     S3 (HeadObject) are not re-uploaded.
 *
 * USAGE
 *   node scripts/migrate-supabase-storage-to-s3.mjs                 # dry-run (default)
 *   node scripts/migrate-supabase-storage-to-s3.mjs --execute --i-understand-this-writes-to-prod
 *
 * ENV (from .env.local / Vercel): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_S3_BUCKET.
 */

import { createClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ─── env / flags ─────────────────────────────────────────────────────────────
function loadDotEnvLocal() {
  // Minimal .env.local loader so the script runs standalone (no dotenv dep).
  const here = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.join(here, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
loadDotEnvLocal();

const args = new Set(process.argv.slice(2));
const EXECUTE = args.has("--execute") && args.has("--i-understand-this-writes-to-prod");
const DRY = !EXECUTE;
const CONCURRENCY = 10;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const S3_BUCKET = process.env.AWS_S3_BUCKET ?? "ops-app-files-prod";
const S3_REGION = process.env.AWS_REGION ?? "us-west-2";
const MIGRATED_PREFIX = "migrated/supabase-storage";

function die(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}
if (!SUPABASE_URL || !SERVICE_ROLE) die("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
if (EXECUTE && (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY)) {
  die("Execute mode requires AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY");
}

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const s3 = EXECUTE
  ? new S3Client({
      region: S3_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    })
  : null;

// ─── url helpers ─────────────────────────────────────────────────────────────
const SUPA_PUBLIC_MARKER = "/storage/v1/object/public/";
const isSupabaseHosted = (u) =>
  typeof u === "string" && /supabase\.(co|in)/.test(u) && u.includes(SUPA_PUBLIC_MARKER);

function toS3Key(url) {
  const i = url.indexOf(SUPA_PUBLIC_MARKER);
  const rest = url.slice(i + SUPA_PUBLIC_MARKER.length).split("?")[0]; // <bucket>/<path>
  return `${MIGRATED_PREFIX}/${rest}`;
}
const toPublicS3Url = (key) => `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${key}`;

// ─── DB enumeration (paginated) ──────────────────────────────────────────────
async function pageAll(table, columns) {
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supa
      .from(table)
      .select(columns)
      .range(from, from + PAGE - 1);
    if (error) die(`Enumerate ${table} failed: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

/**
 * Collect every migration work-item across all columns.
 * Each item: { table, pk, column, isArray, oldUrl, newUrl, s3Key }
 */
async function collectWorkItems() {
  const items = [];
  const push = (table, pk, column, isArray, oldUrl) => {
    if (!isSupabaseHosted(oldUrl)) return;
    const s3Key = toS3Key(oldUrl);
    items.push({ table, pk, column, isArray, oldUrl, newUrl: toPublicS3Url(s3Key), s3Key });
  };

  // Array columns
  for (const r of await pageAll("opportunities", "id, images")) {
    for (const u of r.images ?? []) push("opportunities", r.id, "images", true, u);
  }
  // Scalar columns
  for (const r of await pageAll("project_photo_annotations", "id, annotation_url, photo_url")) {
    push("project_photo_annotations", r.id, "annotation_url", false, r.annotation_url);
    push("project_photo_annotations", r.id, "photo_url", false, r.photo_url);
  }
  for (const r of await pageAll("companies", "id, logo_url")) {
    push("companies", r.id, "logo_url", false, r.logo_url);
  }
  for (const r of await pageAll("users", "id, profile_image_url")) {
    push("users", r.id, "profile_image_url", false, r.profile_image_url);
  }
  return items;
}

// ─── concurrency helper ──────────────────────────────────────────────────────
async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        out[i] = await worker(items[i], i);
      }
    })
  );
  return out;
}

// ─── source validation (dry-run) ─────────────────────────────────────────────
async function headSource(url) {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return { ok: res.ok, status: res.status, contentType: res.headers.get("content-type"), bytes: Number(res.headers.get("content-length") || 0) };
  } catch (err) {
    return { ok: false, status: 0, error: String(err) };
  }
}

// ─── execute: copy one object + rewrite scalar (arrays handled per-row) ──────
async function s3ObjectExists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}
async function copyToS3(item) {
  if (!(await s3ObjectExists(item.s3Key))) {
    const res = await fetch(item.oldUrl);
    if (!res.ok) throw new Error(`source ${res.status}`);
    const body = Buffer.from(await res.arrayBuffer());
    await s3.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: item.s3Key,
        Body: body,
        ContentType: res.headers.get("content-type") || "application/octet-stream",
      })
    );
  }
}

// ─── main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nSupabase → S3 storage migration  [${DRY ? "DRY-RUN" : "EXECUTE"}]`);
  console.log(`bucket=${S3_BUCKET} region=${S3_REGION} prefix=${MIGRATED_PREFIX}/\n`);

  const items = await collectWorkItems();
  const byColumn = {};
  for (const it of items) byColumn[`${it.table}.${it.column}`] = (byColumn[`${it.table}.${it.column}`] ?? 0) + 1;
  console.log(`Found ${items.length} Supabase-hosted image URLs to migrate:`);
  for (const [k, v] of Object.entries(byColumn)) console.log(`  ${k}: ${v}`);
  console.log("");

  // Validate every source is fetchable (both modes — proves the copy will work).
  const heads = await mapLimit(items, CONCURRENCY, (it) => headSource(it.oldUrl));
  const reachable = heads.filter((h) => h.ok).length;
  const unreachable = items.filter((_, i) => !heads[i].ok);
  console.log(`Source reachability: ${reachable}/${items.length} return 200`);
  if (unreachable.length) {
    console.log(`  ${unreachable.length} unreachable (will be skipped on execute):`);
    for (const it of unreachable.slice(0, 10)) console.log(`   - ${it.table}.${it.column} ${it.pk}`);
  }

  // Write a manifest for the record.
  const manifest = {
    generatedAt: new Date().toISOString(),
    mode: DRY ? "dry-run" : "execute",
    bucket: S3_BUCKET,
    region: S3_REGION,
    total: items.length,
    byColumn,
    reachable,
    unreachable: unreachable.map((it) => ({ table: it.table, column: it.column, pk: it.pk, oldUrl: it.oldUrl })),
    mappings: items.map((it, i) => ({
      table: it.table, column: it.column, pk: it.pk, isArray: it.isArray,
      oldUrl: it.oldUrl, newUrl: it.newUrl, sourceStatus: heads[i].status,
    })),
  };
  const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docs", "artifacts");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "s3-migration-manifest.json");
  fs.writeFileSync(outFile, JSON.stringify(manifest, null, 2));
  console.log(`\nManifest → ${path.relative(process.cwd(), outFile)}`);

  if (DRY) {
    console.log(`\n✔ DRY-RUN complete. Nothing was written. Re-run with:`);
    console.log(`    node scripts/migrate-supabase-storage-to-s3.mjs --execute --i-understand-this-writes-to-prod\n`);
    return;
  }

  // ── EXECUTE ──────────────────────────────────────────────────────────────
  console.log(`\nCopying objects to S3…`);
  const copyResults = await mapLimit(items, CONCURRENCY, async (it, i) => {
    if (!heads[i].ok) return { skipped: true };
    try {
      await copyToS3(it);
      return { copied: true };
    } catch (err) {
      return { error: String(err) };
    }
  });
  const copied = copyResults.filter((r) => r.copied).length;
  console.log(`  copied/verified: ${copied}, skipped(unreachable): ${copyResults.filter((r) => r.skipped).length}, errors: ${copyResults.filter((r) => r.error).length}`);
  const errs = copyResults.filter((r) => r.error);
  if (errs.length) {
    const counts = {};
    for (const r of errs) counts[r.error] = (counts[r.error] ?? 0) + 1;
    console.log("  error breakdown:");
    for (const [msg, n] of Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      console.log(`   ${String(n).padStart(4)} × ${msg}`);
    }
  }

  // Rewrite DB. Scalars: one update per (table,pk,column). Arrays: one update
  // per (table,pk) replacing every migrated element in the current array.
  console.log(`\nRewriting DB URLs in place…`);
  const scalarItems = items.filter((it, i) => !it.isArray && copyResults[i].copied);
  for (const it of scalarItems) {
    const { error } = await supa.from(it.table).update({ [it.column]: it.newUrl }).eq("id", it.pk);
    if (error) console.error(`  ✖ ${it.table}.${it.column} ${it.pk}: ${error.message}`);
  }

  // Group array replacements per row.
  const arrayRows = new Map(); // `${table}:${pk}:${column}` -> Map(oldUrl->newUrl)
  items.forEach((it, i) => {
    if (!it.isArray || !copyResults[i].copied) return;
    const k = `${it.table}:${it.pk}:${it.column}`;
    if (!arrayRows.has(k)) arrayRows.set(k, new Map());
    arrayRows.get(k).set(it.oldUrl, it.newUrl);
  });
  for (const [k, repl] of arrayRows) {
    const [table, pk, column] = k.split(":");
    const { data, error } = await supa.from(table).select(column).eq("id", pk).single();
    if (error) { console.error(`  ✖ read ${k}: ${error.message}`); continue; }
    const current = data[column] ?? [];
    const next = current.map((u) => repl.get(u) ?? u);
    const { error: upErr } = await supa.from(table).update({ [column]: next }).eq("id", pk);
    if (upErr) console.error(`  ✖ update ${k}: ${upErr.message}`);
  }

  console.log(`\n✔ EXECUTE complete. Supabase objects were NOT deleted (rollback-safe).\n`);
}

main().catch((err) => die(err.stack || String(err)));
