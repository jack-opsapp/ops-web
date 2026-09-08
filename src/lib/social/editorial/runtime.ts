import "server-only";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { createEditorialRepository } from "./repository";
import { editorialPreviewId } from "./policy";
import { loadCopywritingReference } from "./copywriting-reference";
import { getEditorialOperator } from "./operator";
import { EDITORIAL_IDEMPOTENCY_PREFIX, runEditorialTick } from "./worker";
import { renderSocialPost } from "../render/render-social-post";
import { selectSocialTemplate } from "../template-selector";
import { createSubmissionSocialRepository } from "../repository";
import { submitSocialPost } from "../submission-service";

export async function runCloudEditorial() {
  const { path, sha256 } = loadCopywritingReference();
  const result = await runEditorialTick({
    now: () => new Date(),
    operator: getEditorialOperator(process.env),
    repository: createEditorialRepository(),
    preview: async (pack, identity) =>
      renderSocialPost({
        postId: editorialPreviewId(identity),
        submission: pack.submission,
        selection: selectSocialTemplate({
          submission: pack.submission,
          idempotencyKey: `${EDITORIAL_IDEMPOTENCY_PREFIX}${identity}`,
          recentPosts:
            await createSubmissionSocialRepository().listRecentPosts(12),
        }),
      }),
    submit: submitSocialPost,
  });
  return { ...result, copywriting_reference: { path, sha256 } };
}

const settingsFields =
  "mode,monthly_budget_usd,discovery_since,delivery_gap_minutes,authoring_lease_minutes,authoring_heartbeat_at,authoring_stall_notified_on";
const assignmentFields =
  "id,identity,kind,mode,state,attempts,submissions,last_code,post_id,brief_version,source_snapshot,package,preview,attempt_log,drafted_at,prepared_at,submitted_at,blocked_at,created_at,updated_at";
const legacyFields =
  "slot_date,kind,mode,state,attempts,package,source_snapshot,post_id,last_code,attempt_log,updated_at";

// The admin surface reads assignments, not slots. Legacy runs stay visible so a
// draft held under the retired model is never silently orphaned.
export async function readCloudEditorial() {
  const db = getServiceRoleClient();
  const results = await Promise.all([
    db
      .from("social_editorial_settings")
      .select(settingsFields)
      .eq("id", true)
      .single(),
    db
      .from("social_editorial_assignments")
      .select(assignmentFields)
      .order("created_at", { ascending: false })
      .limit(30),
    db
      .from("social_editorial_runs")
      .select(legacyFields)
      .order("slot_date", { ascending: false })
      .limit(5),
  ]);
  for (const result of results) if (result.error) throw result.error;
  const [settings, assignments, legacyRuns] = results;

  const postIds = (assignments.data ?? [])
    .map((row) => row.post_id)
    .filter((id): id is string => typeof id === "string");
  const posts = postIds.length
    ? await db
        .from("social_posts")
        .select("id,status,instagram_permalink,publish_after")
        .in("id", postIds)
    : { data: [], error: null };
  if (posts.error) throw posts.error;
  const byId = new Map((posts.data ?? []).map((post) => [post.id, post]));

  return {
    settings: settings.data,
    assignments: (assignments.data ?? []).map((row) => ({
      ...row,
      post: row.post_id ? (byId.get(row.post_id) ?? null) : null,
    })),
    legacy_runs: legacyRuns.data ?? [],
  };
}
