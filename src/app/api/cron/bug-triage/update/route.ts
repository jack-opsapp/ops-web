/**
 * POST /api/cron/bug-triage/update
 *
 * Batch-updates bug rows. Used by the nightly triage agents for:
 *   - Claiming a bug (sets claimed_at, status='in_progress')
 *   - Recording a fix (fix_branch, fix_commit, fix_notes, fix_pr_url, fixed_at)
 *   - Escalating (requires_human_review=true, human_review_reason)
 *   - Appending review notes (fix_notes)
 *
 * Body shape:
 *   {
 *     items: [
 *       {
 *         id: UUID,
 *         source: "bug_reports" | "qa_bugs",
 *         updates: {
 *           status?: string,
 *           claimed_at?: ISO8601 | "now",
 *           fixed_at?: ISO8601 | "now",
 *           fix_branch?: string,
 *           fix_commit?: string,
 *           fix_notes?: string,        // REPLACES existing notes
 *           fix_notes_append?: string, // APPENDS (prefixed with blank line)
 *           fix_pr_url?: string,
 *           requires_human_review?: boolean,
 *           human_review_reason?: string,
 *         }
 *       },
 *       ...
 *     ]
 *   }
 *
 * Returns: { updated: N, errors: [{ id, source, error }] }
 *
 * Only the fields above are whitelisted. Attempts to mutate description,
 * category, platform, reporter_*, or any other column are silently ignored.
 * Each item is updated in its own query — no cross-item transaction — so
 * partial success is expected on mixed failures.
 *
 * Auth: Bearer BUG_TRIAGE_AGENT_TOKEN.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { assertTriageAuth, isValidSource, type BugSource } from "../_lib/auth";

export const maxDuration = 60;

// Columns the agent is allowed to write. Any other key in `updates` is dropped.
const WRITABLE_COLUMNS = new Set([
  "status",
  "claimed_at",
  "fixed_at",
  "fix_branch",
  "fix_commit",
  "fix_notes",
  "fix_pr_url",
  "requires_human_review",
  "human_review_reason",
]);

const VALID_STATUSES = new Set([
  "new",
  "triaged",
  "in_progress",
  "resolved",
  "closed",
  "duplicate",
]);

type UpdateItem = {
  id: string;
  source: BugSource;
  updates: Record<string, unknown> & { fix_notes_append?: string };
};

export async function POST(request: NextRequest) {
  const authFailure = assertTriageAuth(request);
  if (authFailure) return authFailure;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const items = extractItems(body);
  if (!items) {
    return NextResponse.json(
      { error: "Body must be { items: [{ id, source, updates }, ...] }" },
      { status: 400 }
    );
  }
  if (items.length === 0) {
    return NextResponse.json({ updated: 0, errors: [] });
  }
  if (items.length > 50) {
    return NextResponse.json(
      { error: "Max 50 items per request" },
      { status: 400 }
    );
  }

  const supabase = getServiceRoleClient();
  const errors: { id: string; source: string; error: string }[] = [];
  let updated = 0;

  for (const item of items) {
    const validationError = validateItem(item);
    if (validationError) {
      errors.push({ id: item.id, source: item.source, error: validationError });
      continue;
    }

    const { sanitized, appendNotes } = sanitizeUpdates(item.updates);

    // Handle fix_notes_append: read-merge-write, since Supabase-js doesn't
    // expose SQL-level concat. Per-row extra query, but agent volumes are low
    // (tens per run) so the cost is negligible vs. the safety of not clobbering.
    if (appendNotes !== undefined) {
      const { data: existing, error: readErr } = await supabase
        .from(item.source)
        .select("fix_notes")
        .eq("id", item.id)
        .single();

      if (readErr) {
        errors.push({
          id: item.id,
          source: item.source,
          error: `read for append failed: ${readErr.message}`,
        });
        continue;
      }

      const currentNotes = (existing?.fix_notes as string | null) ?? "";
      sanitized.fix_notes = currentNotes
        ? `${currentNotes}\n\n${appendNotes}`
        : appendNotes;
    }

    sanitized.updated_at = new Date().toISOString();

    const { error } = await supabase
      .from(item.source)
      .update(sanitized)
      .eq("id", item.id);

    if (error) {
      errors.push({ id: item.id, source: item.source, error: error.message });
    } else {
      updated++;
    }
  }

  return NextResponse.json({ updated, errors });
}

function extractItems(body: unknown): UpdateItem[] | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = (body as { items?: unknown }).items;
  if (!Array.isArray(raw)) return null;

  const result: UpdateItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return null;
    const { id, source, updates } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !isValidSource(source)) return null;
    if (typeof updates !== "object" || updates === null || Array.isArray(updates)) {
      return null;
    }
    result.push({ id, source, updates: updates as Record<string, unknown> });
  }
  return result;
}

function validateItem(item: UpdateItem): string | null {
  if (!item.id) return "id required";

  const status = item.updates.status;
  if (status !== undefined && (typeof status !== "string" || !VALID_STATUSES.has(status))) {
    return `invalid status: ${String(status)}`;
  }

  // Disallow the agent from flipping status to resolved/closed directly.
  // Per the shared triage contract, only human merges do that.
  if (status === "resolved" || status === "closed") {
    return "agent cannot set status to resolved or closed — human merge required";
  }

  const rhr = item.updates.requires_human_review;
  if (rhr !== undefined && typeof rhr !== "boolean") {
    return "requires_human_review must be boolean";
  }

  return null;
}

function sanitizeUpdates(updates: Record<string, unknown>): {
  sanitized: Record<string, unknown>;
  appendNotes: string | undefined;
} {
  const sanitized: Record<string, unknown> = {};
  let appendNotes: string | undefined;

  for (const [key, value] of Object.entries(updates)) {
    if (key === "fix_notes_append") {
      if (typeof value === "string" && value.length > 0) {
        appendNotes = value;
      }
      continue;
    }
    if (!WRITABLE_COLUMNS.has(key)) continue;

    // "now" sentinel for timestamps
    if ((key === "claimed_at" || key === "fixed_at") && value === "now") {
      sanitized[key] = new Date().toISOString();
    } else {
      sanitized[key] = value;
    }
  }

  return { sanitized, appendNotes };
}
