import { createHash } from "node:crypto";
import { z } from "zod-v4";
import {
  ChecklistFieldsSchema,
  SiteVisitAnswerPatchSchema,
  SiteVisitAnswerSnapshotSchema,
  SiteVisitValueSchema,
  type SiteVisitAnswerSnapshot,
  type SiteVisitValue,
} from "../../contracts/site-visit-workflow";

// Resolved artifact text is supplied only by the company/visit-scoped repository.
// Tool inputs carry artifact references, never caller-asserted extraction results.
const ResolvedSourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("operator_notes"),
      text: z.string().min(1).max(32000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("visit_artifact"),
      artifact_id: z.uuid(),
      sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      artifact_kind: z.enum([
        "photo",
        "annotated_photo",
        "dimensioned_photo",
        "note",
        "transcript",
        "measurement",
        "deck_design",
      ]),
      text: z.string().max(200000),
      deck_design_id: z.uuid().nullable(),
      has_remote_asset: z.boolean(),
    })
    .strict(),
]);

function valueFits(kind: string, raw: unknown): raw is SiteVisitValue {
  const parsed = SiteVisitValueSchema.safeParse(raw);
  if (!parsed.success) return false;
  const value = parsed.data;
  const present = Object.keys(value).filter(
    (k) => k !== "artifactIds" || (value.artifactIds?.length ?? 0) > 0
  );
  if (present.length !== 1) return false;
  switch (kind) {
    case "checkbox":
      return typeof value.boolValue === "boolean";
    case "yes_no_na":
      return value.choice !== undefined;
    case "short_text":
      return (
        typeof value.text === "string" &&
        value.text.trim().length > 0 &&
        value.text.length <= 2000
      );
    case "long_text":
    case "measurement":
      return typeof value.text === "string" && value.text.trim().length > 0;
    case "photo":
    case "photo_markup":
      return (
        !!value.artifactIds?.length &&
        new Set(value.artifactIds).size === value.artifactIds.length
      );
    case "deck_design":
      return value.deckDesignId !== undefined;
    default:
      return false;
  }
}

export function missingRequiredFields(raw: unknown) {
  const answers = z.array(SiteVisitAnswerSnapshotSchema).max(200).parse(raw);
  return answers
    .filter((a) => a.required && !valueFits(a.kind, a.answer_value))
    .map((a) => ({
      answer_id: a.id,
      field_id: a.field_id,
      label: a.label,
      kind: a.kind,
    }));
}

export function compileAnswerChanges(
  rawAnswers: unknown,
  rawPatches: unknown,
  rawSources: unknown
) {
  const answers = z
    .array(SiteVisitAnswerSnapshotSchema)
    .max(200)
    .parse(rawAnswers);
  const patches = z
    .array(SiteVisitAnswerPatchSchema)
    .min(1)
    .max(100)
    .parse(rawPatches);
  const sources = z.array(ResolvedSourceSchema).max(20).parse(rawSources);
  if (
    new Set(answers.map((a) => a.id)).size !== answers.length ||
    new Set(patches.map((p) => p.answer_id)).size !== patches.length
  )
    throw new Error("Inspect one exact answer per field before continuing.");
  const changes = patches.map((patch) => {
    const before = answers.find((a) => a.id === patch.answer_id);
    if (!before) throw new Error("The field was not found in this visit.");
    if (before.revision !== patch.expected_revision)
      throw new Error("The answer changed. Review the current value.");
    const resolveEvidence = (
      ref:
        | { source_index: number; quote: string }
        | { source_index: number; reference_only: true }
    ) => {
      const source = sources[ref.source_index];
      if (
        !source ||
        ("quote" in ref
          ? !source.text.includes(ref.quote)
          : source.kind !== "visit_artifact" ||
            !["photo", "photo_markup", "deck_design"].includes(before.kind))
      )
        throw new Error(
          "Use an exact quote from readable source material, or link captured media by identity."
        );
      return {
        ...ref,
        source_kind: source.kind,
        artifact_id:
          source.kind === "visit_artifact" ? source.artifact_id : null,
        source_sha256:
          source.kind === "visit_artifact"
            ? source.sha256
            : `sha256:${createHash("sha256").update(source.text, "utf8").digest("hex")}`,
      };
    };
    const evidence = patch.evidence.map(resolveEvidence);
    const uncertainty = (patch.uncertainty ?? []).map((item) => ({
      reason: item.reason,
      evidence: item.evidence.map(resolveEvidence),
    }));
    const after = patch.intent === "set" ? patch.value! : {};
    if (patch.intent === "set") {
      if (!valueFits(before.kind, after))
        throw new Error("Use the value type supported by this field.");
      if (
        before.kind === "measurement" &&
        !patch.evidence.some(
          (e) => "quote" in e && e.quote.includes(after.text!)
        )
      )
        throw new Error(
          "Keep the measurement and its units exactly as recorded in the source."
        );
      const linked = patch.evidence.map((e) => sources[e.source_index]);
      if (
        after.artifactIds?.some(
          (id) =>
            !linked.some(
              (s) =>
                s.kind === "visit_artifact" &&
                s.artifact_id === id &&
                s.has_remote_asset &&
                (before.kind === "photo_markup"
                  ? ["annotated_photo", "dimensioned_photo"].includes(
                      s.artifact_kind
                    )
                  : ["photo", "annotated_photo", "dimensioned_photo"].includes(
                      s.artifact_kind
                    ))
            )
        )
      )
        throw new Error("Attach existing captured evidence from this visit.");
      if (
        after.deckDesignId &&
        !linked.some(
          (s) =>
            s.kind === "visit_artifact" &&
            s.artifact_kind === "deck_design" &&
            s.deck_design_id === after.deckDesignId
        )
      )
        throw new Error("Use a saved deck design linked to this visit.");
    }
    return {
      answer_id: before.id,
      field_id: before.field_id,
      label: before.label,
      kind: before.kind,
      expected_revision: before.revision,
      before: before.answer_value,
      after,
      intent: patch.intent,
      reason: patch.reason ?? null,
      evidence,
      uncertainty,
    };
  });
  const projected: SiteVisitAnswerSnapshot[] = answers.map((a) => ({
    ...a,
    answer_value:
      changes.find((c) => c.answer_id === a.id)?.after ?? a.answer_value,
  }));
  const result = {
    changes,
    sources: sources.map((s, index) => ({
      ...s,
      index,
      sha256:
        s.kind === "visit_artifact"
          ? s.sha256
          : `sha256:${createHash("sha256").update(s.text, "utf8").digest("hex")}`,
    })),
    missing_required: missingRequiredFields(projected),
    physical_visit_status_changed: false as const,
    content_kind: "untrusted_business_data" as const,
  };
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > 200000)
    throw new Error(
      "Review fewer fields or a smaller source excerpt in this proposal."
    );
  return result;
}

export function selectChecklistFields(rawAnswers: unknown, rawFields: unknown) {
  const answers = z
    .array(SiteVisitAnswerSnapshotSchema)
    .max(200)
    .parse(rawAnswers);
  const fields = ChecklistFieldsSchema.parse(rawFields);
  const existing = new Set(answers.map((a) => a.field_id));
  const added = fields.filter(
    (f) => f.isVisible !== false && !existing.has(f.id)
  );
  if (answers.length + added.length > 200)
    throw new Error("This visit has reached its checklist field limit.");
  return { preserved: answers, added };
}
