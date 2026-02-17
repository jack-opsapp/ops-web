/**
 * OPS Web - API Services Barrel Export
 */

export { ProjectService } from "./project-service";
export type { FetchProjectsOptions } from "./project-service";

export { TaskService } from "./task-service";
export type { FetchTasksOptions, CreateTaskWithEventData } from "./task-service";

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
