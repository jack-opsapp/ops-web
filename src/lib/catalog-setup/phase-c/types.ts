import type { z } from "zod";
import type {
  CatalogActionSchema,
  CatalogAgentTurnSchema,
  CatalogBlueprintSchema,
  CatalogFactSchema,
  CatalogSetupIssueSchema,
  GuidedConversationMessageSchema,
  GuidedInputLedgerEntrySchema,
  GuidedQuestionSchema,
  GuidedSetupSessionDocumentSchema,
} from "./schemas";

export type CatalogFact = z.infer<typeof CatalogFactSchema>;
export type GuidedQuestion = z.infer<typeof GuidedQuestionSchema>;
export type GuidedConversationMessage = z.infer<
  typeof GuidedConversationMessageSchema
>;
export type GuidedInputLedgerEntry = z.infer<
  typeof GuidedInputLedgerEntrySchema
>;
export type CatalogAction = z.infer<typeof CatalogActionSchema>;
export type CatalogSetupIssue = z.infer<typeof CatalogSetupIssueSchema>;
export type CatalogBlueprint = z.infer<typeof CatalogBlueprintSchema>;
export type CatalogAgentTurn = z.infer<typeof CatalogAgentTurnSchema>;
export type GuidedSetupSessionDocument = z.infer<
  typeof GuidedSetupSessionDocumentSchema
>;
