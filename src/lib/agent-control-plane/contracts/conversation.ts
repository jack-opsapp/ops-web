import { z } from "zod-v4";

import { OpaqueIdSchema } from "./common";
import { JobRefSchema } from "./jobs";

export const JobConversationRefSchema = z
  .object({
    conversation_id: OpaqueIdSchema,
    job_refs: z.array(JobRefSchema).min(1).max(2),
  })
  .strict()
  .superRefine((conversation, context) => {
    if (conversation.job_refs.length !== 2) return;

    const [opportunity, project] = conversation.job_refs;
    if (opportunity.kind !== "opportunity" || project.kind !== "project") {
      context.addIssue({
        code: "custom",
        path: ["job_refs"],
        message:
          "Two job anchors must be one opportunity followed by its project",
      });
    }
    if (opportunity.id === project.id) {
      context.addIssue({
        code: "custom",
        path: ["job_refs"],
        message: "Job anchor IDs must be unique",
      });
    }
  });

export type JobConversationRef = z.infer<typeof JobConversationRefSchema>;
