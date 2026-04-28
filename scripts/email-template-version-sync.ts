/**
 * Build-time sync of email_template_versions.
 *
 * For each template in TEMPLATE_REGISTRY:
 *   1. Read the source file from sourcePath.
 *   2. Parse the leading // @template-version: X.Y.Z comment.
 *   3. Compute sha256 of the source bytes.
 *   4. Look up email_template_versions for (templateId, version):
 *      - If row doesn't exist: insert new row with hash + rendered sample.
 *      - If row exists with same hash: no-op.
 *      - If row exists with DIFFERENT hash: console.error and exit code 1.
 *
 * SYNC_DRY_RUN=1 logs what it would do without writing.
 * SYNC_SKIP_DB=1 skips DB I/O entirely (used by the build sandbox when no
 *   service-role key is available; no enforcement happens).
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { TEMPLATE_REGISTRY, renderTemplate } from "../src/lib/email/template-registry";

const VERSION_COMMENT_RE = /^\s*\/\/\s*@template-version:\s*(\d+\.\d+\.\d+)\s*$/m;

function parseVersionFromSource(source: string): string | null {
  const m = VERSION_COMMENT_RE.exec(source);
  return m ? m[1] : null;
}

function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

const DRY_RUN = process.env.SYNC_DRY_RUN === "1";
const SKIP_DB = process.env.SYNC_SKIP_DB === "1";

async function run() {
  if (SKIP_DB) {
    console.log("[sync] SYNC_SKIP_DB=1 — verifying source comments only, no DB writes.");
    let missing = 0;
    for (const entry of TEMPLATE_REGISTRY) {
      const fullPath = resolve(process.cwd(), entry.sourcePath);
      const source = readFileSync(fullPath);
      const version = parseVersionFromSource(source.toString("utf8"));
      if (!version) {
        console.error(`[sync] ${entry.templateId} :: missing @template-version comment in ${entry.sourcePath}`);
        missing++;
        continue;
      }
      console.log(`[sync] ${entry.templateId} v${version} :: hash ${sha256(source).slice(0, 12)}`);
    }
    if (missing > 0) process.exit(1);
    return;
  }

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    if (process.env.SYNC_REQUIRE_DB === "1") {
      console.error(
        "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set when SYNC_REQUIRE_DB=1."
      );
      process.exit(1);
    }
    console.warn(
      "[sync] SUPABASE env not set — skipping registry sync. " +
        "Set SYNC_REQUIRE_DB=1 to fail builds when env is missing (CI)."
    );
    return;
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  let mismatches = 0;
  let inserts = 0;
  let unchanged = 0;

  for (const entry of TEMPLATE_REGISTRY) {
    const fullPath = resolve(process.cwd(), entry.sourcePath);
    const source = readFileSync(fullPath);
    const version = parseVersionFromSource(source.toString("utf8"));
    if (!version) {
      console.error(`[sync] ${entry.templateId} :: missing @template-version comment in ${entry.sourcePath}`);
      process.exit(1);
    }
    const hash = sha256(source);

    const { data: existing, error: readErr } = await supabase
      .from("email_template_versions")
      .select("id, content_hash")
      .eq("template_id", entry.templateId)
      .eq("version", version)
      .maybeSingle();
    if (readErr) {
      console.error(`[sync] ${entry.templateId} :: read failed: ${readErr.message}`);
      process.exit(1);
    }

    if (existing) {
      if (existing.content_hash === hash) {
        console.log(`[sync] ${entry.templateId} v${version} :: unchanged`);
        unchanged++;
      } else {
        console.error(
          `[sync] ${entry.templateId} v${version} :: HASH MISMATCH. ` +
            `Existing: ${existing.content_hash.slice(0, 12)}, current: ${hash.slice(0, 12)}. ` +
            `Bump the @template-version comment before changing the source.`
        );
        mismatches++;
      }
      continue;
    }

    let rendered: string | null = null;
    try {
      const r = await renderTemplate(entry.templateId, entry.previewProps);
      rendered = r?.html ?? null;
    } catch (err: any) {
      console.warn(
        `[sync] ${entry.templateId} v${version} :: render failed (continuing without sample): ${err?.message ?? err}`
      );
    }

    if (DRY_RUN) {
      console.log(`[sync DRY] ${entry.templateId} v${version} :: would insert (hash ${hash.slice(0, 12)})`);
      inserts++;
      continue;
    }

    const { error: insertErr } = await supabase.from("email_template_versions").insert({
      template_id: entry.templateId,
      version,
      content_hash: hash,
      rendered_sample_html: rendered,
      preview_props: entry.previewProps,
      notes: null,
    });
    if (insertErr) {
      console.error(`[sync] ${entry.templateId} v${version} :: insert failed: ${insertErr.message}`);
      process.exit(1);
    }
    console.log(`[sync] ${entry.templateId} v${version} :: inserted (hash ${hash.slice(0, 12)})`);
    inserts++;
  }

  console.log(`\n[sync] summary :: inserts=${inserts}, unchanged=${unchanged}, mismatches=${mismatches}`);

  if (mismatches > 0) {
    console.error(
      "\n[sync] FAILURE :: hash mismatches indicate templates were modified without bumping the version comment. " +
        "Bump the version, then re-run."
    );
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("[sync] unexpected error", err);
  process.exit(1);
});
