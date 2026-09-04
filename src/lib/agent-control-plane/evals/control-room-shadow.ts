import { z } from "zod-v4";

import {
  PrepareDispatchConfirmationTaskInputSchema,
  type PrepareDispatchConfirmationTaskInput,
} from "@/lib/agent-control-plane/contracts/dispatch-confirmation-task";
import {
  P2CanonicalTimestampSchema,
  P2CanonicalUuidSchema,
} from "@/lib/agent-control-plane/contracts/p2-common";
import { P2ProofRefSchema } from "@/lib/agent-control-plane/contracts/p2-proof";

const ShadowEvidenceInputSchema = z
  .object({
    overview: z
      .object({
        component: z.literal("schedule_readiness"),
        state: z.enum(["attention", "clear"]),
        proof_ref: P2ProofRefSchema,
      })
      .strict(),
    work_queue: z
      .object({
        items: z
          .array(
            z
              .object({
                source: z.literal("schedule"),
                reason: z.enum(["confirmation_required", "starts_soon"]),
                priority: z.number().int().min(0).max(99),
                attention_at: P2CanonicalTimestampSchema,
                task_id: P2CanonicalUuidSchema,
                project_id: P2CanonicalUuidSchema,
                proof_ref: P2ProofRefSchema,
                title: z.string().max(256).optional(),
              })
              .strict()
          )
          .max(100),
      })
      .strict(),
    task_context: z
      .object({
        task_id: P2CanonicalUuidSchema,
        project_id: P2CanonicalUuidSchema,
        schedule_version: z.number().int().safe().nonnegative(),
        confirmation: z.enum(["unconfirmed", "current", "stale"]),
        proof_ref: P2ProofRefSchema,
      })
      .strict(),
    idempotency_key: z
      .string()
      .min(8)
      .max(200)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/),
  })
  .strict();

export class ControlRoomShadowInputError extends Error {
  constructor() {
    super("The control-room evidence is missing, stale, or inconsistent.");
    this.name = "ControlRoomShadowInputError";
  }
}

export function buildDispatchConfirmationTaskPrepareRequest(
  rawInput: z.input<typeof ShadowEvidenceInputSchema>
): PrepareDispatchConfirmationTaskInput {
  const parsed = ShadowEvidenceInputSchema.safeParse(rawInput);
  if (!parsed.success || parsed.data.overview.state !== "attention") {
    throw new ControlRoomShadowInputError();
  }

  const selected = parsed.data.work_queue.items.find(
    (item) => item.reason === "confirmation_required"
  );
  if (
    !selected ||
    parsed.data.task_context.confirmation !== "unconfirmed" ||
    parsed.data.task_context.task_id !== selected.task_id ||
    parsed.data.task_context.project_id !== selected.project_id
  ) {
    throw new ControlRoomShadowInputError();
  }

  const request = PrepareDispatchConfirmationTaskInputSchema.safeParse({
    source_task_id: selected.task_id,
    expected_schedule_version: parsed.data.task_context.schedule_version,
    evidence: {
      operational_overview_proof_ref: parsed.data.overview.proof_ref,
      work_queue_proof_ref: selected.proof_ref,
      task_context_proof_ref: parsed.data.task_context.proof_ref,
    },
    idempotency_key: parsed.data.idempotency_key,
  });
  if (!request.success) throw new ControlRoomShadowInputError();
  return Object.freeze(request.data);
}
