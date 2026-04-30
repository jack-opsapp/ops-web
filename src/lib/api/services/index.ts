/**
 * OPS Web - API Services Barrel Export
 */

export { ProjectService } from "./project-service";
export type { FetchProjectsOptions } from "./project-service";

export { TaskService } from "./task-service";
export type { FetchTasksOptions, CreateTaskWithEventData } from "./task-service";

export { RecurrenceService } from "./recurrence-service";
export type {
  CreateRecurrenceInput,
  UpsertRecurrenceExceptionInput,
} from "./recurrence-service";

export { ClientService } from "./client-service";
export type { FetchClientsOptions } from "./client-service";

export { UserService } from "./user-service";
export type { FetchUsersOptions } from "./user-service";

export { CompanyService } from "./company-service";

export { CalendarService } from "./calendar-service";
export type { FetchCalendarEventsOptions } from "./calendar-service";

export { TaskTypeService } from "./task-type-service";

export { uploadImage, uploadMultipleImages, ImageUploadError } from "./image-service";
export type { ImageUploadErrorCode } from "./image-service";

export { ProductService } from "./product-service";

export { EstimateService } from "./estimate-service";
export type { FetchEstimatesOptions } from "./estimate-service";

export { InvoiceService } from "./invoice-service";
export type { FetchInvoicesOptions } from "./invoice-service";

export { AccountingService } from "./accounting-service";

export { OpportunityService } from "./opportunity-service";
export type { FetchOpportunitiesOptions } from "./opportunity-service";

export { TaskTemplateService } from "./task-template-service";
export type { ProposedTask } from "./task-template-service";

export { ActivityCommentService } from "./activity-comment-service";

export { SiteVisitService } from "./site-visit-service";
export type { FetchSiteVisitsOptions } from "./site-visit-service";

export { ProjectPhotoService } from "./project-photo-service";

export { CompanySettingsService } from "./company-settings-service";

export { ExpenseSettingsService } from "./expense-settings-service";
export type { ExpenseSettings, UpdateExpenseSettings } from "./expense-settings-service";

export { NotificationPreferencesService } from "./notification-preferences-service";
export type { NotificationPreferences, UpdateNotificationPreferences } from "./notification-preferences-service";

export { GmailService } from "./gmail-service";

export { InventoryService } from "./inventory-service";

export { CrewLocationService } from "./crew-location-service";
export type { CrewLocation, CrewStatus } from "./crew-location-service";
export { resolveCrewStatus } from "./crew-location-service";

export { EmailFilterService } from "./email-filter-service";

export { EmailService } from "./email-service";

export { PatternDetectionService } from "./pattern-detection-service";
export type { DetectedSource, PatternDetectionResult } from "./pattern-detection-service";

export { EmailAIClassifier } from "./email-ai-classifier";
export type { ClassificationInput, ClassificationResult, ThreadSummaryInput, ThreadClassificationResult, ThreadAnalysisInput, ThreadAnalysisResult } from "./email-ai-classifier";

export { EmailMatchingServiceV2 } from "./email-matching-service-v2";
export type { MatchResultV2 } from "./email-matching-service-v2";

export { matchPlatform, isFormSubmissionSubject } from "./known-platforms";
export type { PlatformMatch } from "./known-platforms";

export { SyncEngine } from "./sync-engine";
export type { SyncCycleResult } from "./sync-engine";

export { StageEvaluator } from "./stage-evaluator";
export type { ThreadState, StageEvaluation } from "./stage-evaluator";

export { AdminFeatureOverrideService } from "./admin-feature-override-service";

export { AISyncReviewer } from "./ai-sync-reviewer";
export type { AIReviewResult } from "./ai-sync-reviewer";

export { MemoryService } from "./memory-service";
export type { MemoryFact } from "./memory-service";

export { WritingProfileService } from "./writing-profile-service";

export { DraftGenerator } from "./draft-generator";
export type { DraftResult } from "./draft-generator";

export { MetricsService } from "./metrics-service";

export { ApprovalQueueService } from "./approval-queue-service";
export type { ProposeActionParams, QueueFilters, QueueStats } from "@/lib/types/approval-queue";

export { ProductMaterialsService } from "./product-materials-service";
export { TaskMaterialsService } from "./task-materials-service";
export { InventoryDeductionService } from "./inventory-deduction-service";
export { LineItemMaterialsService } from "./line-item-materials-service";
