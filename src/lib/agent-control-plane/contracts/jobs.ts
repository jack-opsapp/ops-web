import { z } from "zod-v4";

import { OpaqueIdSchema } from "./common";

const OpportunityJobRefSchema = z
  .object({
    kind: z.literal("opportunity"),
    id: OpaqueIdSchema,
  })
  .strict();

const ProjectJobRefSchema = z
  .object({
    kind: z.literal("project"),
    id: OpaqueIdSchema,
  })
  .strict();

export const JobRefSchema = z.discriminatedUnion("kind", [
  OpportunityJobRefSchema,
  ProjectJobRefSchema,
]);

export type JobRef = z.infer<typeof JobRefSchema>;
