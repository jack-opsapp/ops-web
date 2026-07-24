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
 * Production Vercel builds compare against the last successful deployment and
 * skip remote synchronization only when no registered template input changed.
 * All source comments are still validated locally. Relevant or uncertain
 * production diffs remain fail-closed and require the database.
 *
 * SYNC_SKIP_DB=1 is retained for non-production build sandboxes.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  TEMPLATE_REGISTRY,
  renderTemplate,
} from "../src/lib/email/template-registry";
import {
  runTemplateVersionSync,
  type TemplateVersionStore,
} from "./email-template-version-sync-core";

runTemplateVersionSync({
  entries: TEMPLATE_REGISTRY,
  cwd: process.cwd(),
  env: process.env,
  readFile: readFileSync,
  renderTemplate,
  runGitDiff: (previousSha, currentSha, inputPaths) => {
    const result = spawnSync(
      "git",
      [
        "diff",
        "--quiet",
        "--no-ext-diff",
        previousSha,
        currentSha,
        "--",
        ...inputPaths,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      }
    );

    return {
      status: result.status,
      error: result.error?.message ?? (result.stderr?.trim() || undefined),
    };
  },
  createStore: ({ url, serviceRoleKey }): TemplateVersionStore => {
    const supabase = createClient(url, serviceRoleKey, {
      auth: { persistSession: false },
    });

    return {
      async findVersion(templateId, version) {
        const { data, error } = await supabase
          .from("email_template_versions")
          .select("id, content_hash")
          .eq("template_id", templateId)
          .eq("version", version)
          .maybeSingle();
        if (error) {
          throw error;
        }
        return data
          ? { id: data.id as string, contentHash: data.content_hash as string }
          : null;
      },
      async insertVersion(input) {
        const { error } = await supabase
          .from("email_template_versions")
          .insert({
            template_id: input.templateId,
            version: input.version,
            content_hash: input.contentHash,
            rendered_sample_html: input.renderedSampleHtml,
            preview_props: input.previewProps,
            notes: input.notes,
          });
        if (error) {
          throw error;
        }
      },
    };
  },
  logger: {
    info: (message) => console.log(message),
    warn: (message) => console.warn(message),
    error: (message) => console.error(message),
  },
}).catch((error) => {
  console.error(
    "[sync] unexpected error",
    error instanceof Error ? error.message : error
  );
  process.exitCode = 1;
});
