import type { SocialSubmission } from "../contract";
import {
  chooseSource,
  getEditorialSlot,
  type EditorialSource,
  type EditorialKind,
} from "./policy";
export class EditorialError extends Error {
  constructor(
    public code: string,
    public retryable: boolean,
    public detail?: Record<string, unknown>
  ) {
    super(code);
  }
}
export interface EditorialPackage {
  submission: SocialSubmission;
  evidence: unknown[];
  review: Record<string, unknown>;
  usage: unknown[];
  references?: Array<{ path: string; sha256: string }>;
  preview?: import("../types").RenderedSocialAsset[];
}
export interface EditorialRun {
  slot_date: string;
  kind: EditorialKind;
  mode: "prepare" | "publish";
  state: string;
  attempts: number;
  claim_token: string;
  package: EditorialPackage | null;
  source_snapshot: EditorialSource | null;
}
export interface EditorialRepository {
  claim(
    date: string,
    kind: EditorialKind,
    token: string
  ): Promise<EditorialRun | null>;
  context(): Promise<{
    sources: EditorialSource[];
    usedSourceIds: string[];
    recentHooks: string[];
  }>;
  checkpoint(
    run: EditorialRun,
    source: EditorialSource,
    pack: EditorialPackage | null
  ): Promise<boolean>;
  finish(
    run: EditorialRun,
    state: string,
    code: string | null,
    postId?: string
  ): Promise<string | null>;
  deliveryAllowed(run: EditorialRun): Promise<boolean>;
  sourceStillCurrent(source: EditorialSource): Promise<boolean>;
  recordAttempt(
    run: EditorialRun,
    detail: Record<string, unknown>
  ): Promise<void>;
  findPost(key: string): Promise<{ id: string; status: string } | null>;
}
export interface EditorialDependencies {
  now: () => Date;
  token: () => string;
  repository: EditorialRepository;
  generate: (
    source: EditorialSource,
    kind: EditorialKind,
    recentHooks: string[],
    now: Date
  ) => Promise<EditorialPackage>;
  preview: (
    pack: EditorialPackage,
    date: string
  ) => Promise<import("../types").RenderedSocialAsset[]>;
  submit: (input: {
    idempotencyKey: string;
    submission: SocialSubmission;
  }) => Promise<{ post: { id: string; status: string } }>;
}
export async function runEditorial(
  d: EditorialDependencies
): Promise<{ state: string; date?: string }> {
  const slot = getEditorialSlot(d.now());
  if (!slot) return { state: "outside_window" };
  const run = await d.repository.claim(slot.date, slot.kind, d.token());
  if (!run) return { state: "idle", date: slot.date };
  const finish = async (
    state: string,
    code: string | null = null,
    postId?: string
  ) => ({
    state:
      (await d.repository.finish(run, state, code, postId)) ?? "lease_lost",
    date: slot.date,
  });
  const key = `cloud-editorial-v1:${run.slot_date}`;
  try {
    const existing = await d.repository.findPost(key);
    if (existing) {
      if (["review", "publishing", "published"].includes(existing.status))
        return finish("submitted", null, existing.id);
      return finish(
        existing.status === "rendering" ? "retry" : "failed",
        "DELIVERY_NEEDS_REVIEW",
        existing.id
      );
    }
    let pack = run.package;
    let source = run.source_snapshot;
    if (!pack) {
      const context = await d.repository.context();
      source =
        source ??
        chooseSource(context.sources, context.usedSourceIds, d.now(), run.kind);
      if (!source) return finish("skipped", "NO_FRESH_SOURCE");
      if (!(await d.repository.sourceStillCurrent(source)))
        return finish("skipped", "SOURCE_CHANGED");
      if (!(await d.repository.checkpoint(run, source, null)))
        return { state: "lease_lost", date: slot.date };
      pack = await d.generate(source, run.kind, context.recentHooks, d.now());
      if (!(await d.repository.checkpoint(run, source, pack)))
        return { state: "lease_lost", date: slot.date };
    }
    if (!source || !(await d.repository.sourceStillCurrent(source)))
      return finish("skipped", "SOURCE_CHANGED");
    if (run.mode === "prepare") {
      if (!pack.preview) {
        pack = { ...pack, preview: await d.preview(pack, run.slot_date) };
        if (!(await d.repository.checkpoint(run, source, pack)))
          return { state: "lease_lost", date: slot.date };
      }
      return finish("prepared");
    }
    if (
      getEditorialSlot(d.now())?.date !== run.slot_date ||
      !(await d.repository.deliveryAllowed(run))
    )
      return finish("skipped", "DELIVERY_DISABLED");
    const { post } = await d.submit({
      idempotencyKey: key,
      submission: pack.submission,
    });
    if (!["review", "publishing", "published"].includes(post.status))
      return finish("failed", "DELIVERY_NEEDS_REVIEW", post.id);
    return finish("submitted", null, post.id);
  } catch (error) {
    const known = error instanceof EditorialError;
    if (known && error.detail)
      await d.repository.recordAttempt(run, error.detail);
    return finish(
      known && !error.retryable ? "skipped" : "retry",
      known ? error.code : "EDITORIAL_ATTEMPT_FAILED"
    );
  }
}
