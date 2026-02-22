/**
 * OPS Web - Zod Validation Schemas
 *
 * Complete validation schemas for all entities, including:
 * - Entity schemas for runtime validation
 * - Form schemas for user input validation
 * - DTO schemas for API responses
 */

import { z } from "zod";

// ─── Enum Schemas ─────────────────────────────────────────────────────────────

export const projectStatusSchema = z.enum([
  "RFQ",
  "Estimated",
  "Accepted",
  "In Progress",
  "Completed",
  "Closed",
  "Archived",
]);

export const taskStatusSchema = z.enum([
  "Booked",
  "In Progress",
  "Completed",
  "Cancelled",
]);

export const userRoleSchema = z.enum(["Field Crew", "Office Crew", "Admin"]);

export const userTypeSchema = z.enum(["Employee", "Company"]);

export const subscriptionStatusSchema = z.enum([
  "trial",
  "active",
  "grace",
  "expired",
  "cancelled",
]);

export const subscriptionPlanSchema = z.enum([
  "trial",
  "starter",
  "team",
  "business",
]);

export const paymentScheduleSchema = z.enum(["Monthly", "Annual"]);

export const opsContactRoleSchema = z.enum([
  "jack",
  "Priority Support",
  "Data Setup",
  "General Support",
  "Web App Auto Send",
]);

// ─── Entity Schemas ───────────────────────────────────────────────────────────

export const projectSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  address: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  startDate: z.date().nullable(),
  endDate: z.date().nullable(),
  duration: z.number().nullable(),
  status: projectStatusSchema,
  notes: z.string().nullable(),
  companyId: z.string(),
  clientId: z.string().nullable(),
  allDay: z.boolean(),
  teamMemberIds: z.array(z.string()),
  projectDescription: z.string().nullable(),
  projectImages: z.array(z.string()),
  lastSyncedAt: z.date().nullable(),
  needsSync: z.boolean(),
  syncPriority: z.number(),
  deletedAt: z.date().nullable(),
});

export const taskSchema = z.object({
  id: z.string().min(1),
  projectId: z.string(),
  calendarEventId: z.string().nullable(),
  companyId: z.string(),
  status: taskStatusSchema,
  taskColor: z.string(),
  taskNotes: z.string().nullable(),
  taskTypeId: z.string(),
  taskIndex: z.number().nullable(),
  displayOrder: z.number(),
  customTitle: z.string().nullable(),
  teamMemberIds: z.array(z.string()),
  lastSyncedAt: z.date().nullable(),
  needsSync: z.boolean(),
  deletedAt: z.date().nullable(),
});

export const calendarEventSchema = z.object({
  id: z.string().min(1),
  color: z.string(),
  companyId: z.string().min(1),
  projectId: z.string().min(1),
  taskId: z.string().nullable(),
  duration: z.number().min(1),
  endDate: z.date().nullable(),
  startDate: z.date().nullable(),
  title: z.string(),
  teamMemberIds: z.array(z.string()),
  lastSyncedAt: z.date().nullable(),
  needsSync: z.boolean(),
  deletedAt: z.date().nullable(),
});

export const clientSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email().nullable().or(z.literal("")),
  phoneNumber: z.string().nullable(),
  address: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  profileImageURL: z.string().url().nullable().or(z.literal("")).or(z.null()),
  notes: z.string().nullable(),
  companyId: z.string().nullable(),
  lastSyncedAt: z.date().nullable(),
  needsSync: z.boolean(),
  createdAt: z.date().nullable(),
  deletedAt: z.date().nullable(),
});

export const subClientSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  title: z.string().nullable(),
  email: z.string().email().nullable().or(z.literal("")),
  phoneNumber: z.string().nullable(),
  address: z.string().nullable(),
  clientId: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  lastSyncedAt: z.date().nullable(),
  needsSync: z.boolean(),
  deletedAt: z.date().nullable(),
});

export const userSchema = z.object({
  id: z.string().min(1),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().email().nullable().or(z.literal("")).or(z.null()),
  phone: z.string().nullable(),
  profileImageURL: z.string().nullable(),
  role: userRoleSchema,
  companyId: z.string().nullable(),
  userType: userTypeSchema.nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  locationName: z.string().nullable(),
  homeAddress: z.string().nullable(),
  clientId: z.string().nullable(),
  isActive: z.boolean().nullable(),
  userColor: z.string().nullable(),
  devPermission: z.boolean(),
  hasCompletedAppOnboarding: z.boolean(),
  hasCompletedAppTutorial: z.boolean(),
  isCompanyAdmin: z.boolean(),
  stripeCustomerId: z.string().nullable(),
  deviceToken: z.string().nullable(),
  lastSyncedAt: z.date().nullable(),
  needsSync: z.boolean(),
  deletedAt: z.date().nullable(),
});

export const companySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  logoURL: z.string().nullable(),
  externalId: z.string().nullable(),
  companyDescription: z.string().nullable(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  website: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  openHour: z.string().nullable(),
  closeHour: z.string().nullable(),
  industries: z.array(z.string()),
  companySize: z.string().nullable(),
  companyAge: z.string().nullable(),
  referralMethod: z.string().nullable(),
  projectIds: z.array(z.string()),
  teamIds: z.array(z.string()),
  adminIds: z.array(z.string()),
  accountHolderId: z.string().nullable(),
  defaultProjectColor: z.string(),
  teamMembersSynced: z.boolean(),
  subscriptionStatus: subscriptionStatusSchema.nullable(),
  subscriptionPlan: subscriptionPlanSchema.nullable(),
  subscriptionEnd: z.date().nullable(),
  subscriptionPeriod: paymentScheduleSchema.nullable(),
  maxSeats: z.number(),
  seatedEmployeeIds: z.array(z.string()),
  seatGraceStartDate: z.date().nullable(),
  trialStartDate: z.date().nullable(),
  trialEndDate: z.date().nullable(),
  hasPrioritySupport: z.boolean(),
  dataSetupPurchased: z.boolean(),
  dataSetupCompleted: z.boolean(),
  dataSetupScheduledDate: z.date().nullable(),
  stripeCustomerId: z.string().nullable(),
  lastSyncedAt: z.date().nullable(),
  needsSync: z.boolean(),
  deletedAt: z.date().nullable(),
});

export const taskTypeSchema = z.object({
  id: z.string().min(1),
  color: z.string(),
  display: z.string().min(1),
  icon: z.string().nullable(),
  isDefault: z.boolean(),
  companyId: z.string(),
  displayOrder: z.number(),
  lastSyncedAt: z.date().nullable(),
  needsSync: z.boolean(),
  deletedAt: z.date().nullable(),
});

export const teamMemberSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  profileImageURL: z.string().nullable(),
  role: userRoleSchema,
  userColor: z.string().nullable(),
  isActive: z.boolean(),
});

export const opsContactSchema = z.object({
  id: z.string().min(1),
  email: z.string(),
  name: z.string(),
  phone: z.string(),
  display: z.string(),
  role: opsContactRoleSchema,
  lastSynced: z.date(),
});

// ─── Form Validation Schemas ──────────────────────────────────────────────────

/** Create project form */
export const createProjectSchema = z.object({
  title: z
    .string()
    .min(1, "Project name is required")
    .max(200, "Project name too long"),
  address: z.string().optional().nullable(),
  startDate: z.date().optional().nullable(),
  endDate: z.date().optional().nullable(),
  duration: z.number().min(1).optional().nullable(),
  status: projectStatusSchema.default("RFQ"),
  notes: z.string().optional().nullable(),
  companyId: z.string().min(1, "Company is required"),
  clientId: z.string().optional().nullable(),
  allDay: z.boolean().default(true),
  projectDescription: z.string().optional().nullable(),
});

/** Update project form - all fields optional except id */
export const updateProjectSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  address: z.string().optional().nullable(),
  startDate: z.date().optional().nullable(),
  endDate: z.date().optional().nullable(),
  duration: z.number().min(1).optional().nullable(),
  status: projectStatusSchema.optional(),
  notes: z.string().optional().nullable(),
  clientId: z.string().optional().nullable(),
  allDay: z.boolean().optional(),
  projectDescription: z.string().optional().nullable(),
});

/** Create task form */
export const createTaskSchema = z.object({
  projectId: z.string().min(1, "Project is required"),
  companyId: z.string().min(1, "Company is required"),
  taskTypeId: z.string().min(1, "Task type is required"),
  status: taskStatusSchema.default("Booked"),
  taskColor: z.string().default("#59779F"),
  taskNotes: z.string().optional().nullable(),
  teamMemberIds: z.array(z.string()).default([]),
  scheduledDate: z.date().optional().nullable(),
  endDate: z.date().optional().nullable(),
});

/** Update task form */
export const updateTaskSchema = z.object({
  id: z.string().min(1),
  status: taskStatusSchema.optional(),
  taskColor: z.string().optional(),
  taskNotes: z.string().optional().nullable(),
  taskTypeId: z.string().optional(),
  teamMemberIds: z.array(z.string()).optional(),
  displayOrder: z.number().optional(),
});

/** Create client form */
export const createClientSchema = z.object({
  name: z
    .string()
    .min(1, "Client name is required")
    .max(200, "Name too long"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phoneNumber: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  companyId: z.string().min(1, "Company is required"),
});

/** Update client form */
export const updateClientSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().optional().or(z.literal("")),
  phoneNumber: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

/** Create sub-client form */
export const createSubClientSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  title: z.string().optional().nullable(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phoneNumber: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  clientId: z.string().min(1, "Parent client is required"),
});

/** Update sub-client form */
export const updateSubClientSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  title: z.string().optional().nullable(),
  email: z.string().email().optional().or(z.literal("")),
  phoneNumber: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
});

/** Create task type form */
export const createTaskTypeSchema = z.object({
  display: z.string().min(1, "Display name is required").max(100),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color"),
  icon: z.string().optional().nullable(),
  isDefault: z.boolean().default(false),
  companyId: z.string().min(1, "Company is required"),
});

/** Update task type form */
export const updateTaskTypeSchema = z.object({
  id: z.string().min(1),
  display: z.string().min(1).max(100).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  icon: z.string().optional().nullable(),
  isDefault: z.boolean().optional(),
});

/** Create calendar event form */
export const createCalendarEventSchema = z.object({
  projectId: z.string().min(1, "Project is required"),
  companyId: z.string().min(1, "Company is required"),
  taskId: z.string().optional().nullable(),
  title: z.string().min(1, "Title is required").max(200),
  startDate: z.date({ required_error: "Start date is required" }),
  endDate: z.date().optional().nullable(),
  color: z.string().default("#59779F"),
  duration: z.number().min(1).default(1),
  teamMemberIds: z.array(z.string()).default([]),
});

/** Update calendar event form */
export const updateCalendarEventSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional().nullable(),
  color: z.string().optional(),
  duration: z.number().min(1).optional(),
  teamMemberIds: z.array(z.string()).optional(),
});

// ─── Financial Enum Schemas ──────────────────────────────────────────────────

export const estimateStatusSchema = z.enum([
  "draft", "sent", "viewed", "approved", "changes_requested", "declined", "converted", "expired", "superseded",
]);

export const invoiceStatusSchema = z.enum([
  "draft", "sent", "awaiting_payment", "partially_paid", "past_due", "paid", "void", "written_off",
]);

export const paymentMethodSchema = z.enum([
  "cash", "check", "credit_card", "debit_card", "ach", "bank_transfer", "stripe", "other",
]);

export const accountingProviderSchema = z.enum(["quickbooks", "sage"]);

// ─── Financial Entity Schemas ────────────────────────────────────────────────

export const productSchema = z.object({
  id: z.string().min(1),
  companyId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  defaultPrice: z.number(),
  unitCost: z.number().nullable(),
  unit: z.string(),
  category: z.string().nullable(),
  isTaxable: z.boolean(),
  isActive: z.boolean(),
  deletedAt: z.date().nullable(),
  createdAt: z.date().nullable(),
  updatedAt: z.date().nullable(),
});

export const lineItemSchema = z.object({
  id: z.string().min(1),
  companyId: z.string().min(1),
  estimateId: z.string().nullable(),
  invoiceId: z.string().nullable(),
  productId: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  quantity: z.number().min(0),
  unit: z.string(),
  unitPrice: z.number(),
  unitCost: z.number().nullable(),
  discountPercent: z.number().min(0).max(100),
  isTaxable: z.boolean(),
  taxRateId: z.string().nullable(),
  lineTotal: z.number(),
  isOptional: z.boolean(),
  isSelected: z.boolean(),
  sortOrder: z.number(),
  category: z.string().nullable(),
  serviceDate: z.date().nullable(),
  createdAt: z.date().nullable(),
});

export const estimateSchema = z.object({
  id: z.string().min(1),
  companyId: z.string().min(1),
  opportunityId: z.string().nullable(),
  clientId: z.string(),
  estimateNumber: z.string(),
  version: z.number(),
  parentId: z.string().nullable(),
  title: z.string().nullable(),
  clientMessage: z.string().nullable(),
  internalNotes: z.string().nullable(),
  terms: z.string().nullable(),
  subtotal: z.number(),
  discountType: z.enum(["percentage", "fixed"]).nullable(),
  discountValue: z.number().nullable(),
  discountAmount: z.number(),
  taxRate: z.number().nullable(),
  taxAmount: z.number(),
  total: z.number(),
  depositType: z.enum(["percentage", "fixed"]).nullable(),
  depositValue: z.number().nullable(),
  depositAmount: z.number().nullable(),
  status: estimateStatusSchema,
  issueDate: z.date(),
  expirationDate: z.date().nullable(),
  sentAt: z.date().nullable(),
  viewedAt: z.date().nullable(),
  approvedAt: z.date().nullable(),
  pdfStoragePath: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  deletedAt: z.date().nullable(),
});

export const invoiceSchema = z.object({
  id: z.string().min(1),
  companyId: z.string().min(1),
  clientId: z.string(),
  estimateId: z.string().nullable(),
  opportunityId: z.string().nullable(),
  projectId: z.string().nullable(),
  invoiceNumber: z.string(),
  subject: z.string().nullable(),
  clientMessage: z.string().nullable(),
  internalNotes: z.string().nullable(),
  footer: z.string().nullable(),
  terms: z.string().nullable(),
  subtotal: z.number(),
  discountType: z.enum(["percentage", "fixed"]).nullable(),
  discountValue: z.number().nullable(),
  discountAmount: z.number(),
  taxRate: z.number().nullable(),
  taxAmount: z.number(),
  total: z.number(),
  amountPaid: z.number(),
  balanceDue: z.number(),
  depositApplied: z.number(),
  status: invoiceStatusSchema,
  issueDate: z.date(),
  dueDate: z.date(),
  paymentTerms: z.string().nullable(),
  sentAt: z.date().nullable(),
  viewedAt: z.date().nullable(),
  paidAt: z.date().nullable(),
  pdfStoragePath: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  deletedAt: z.date().nullable(),
});

export const paymentSchema = z.object({
  id: z.string().min(1),
  companyId: z.string().min(1),
  invoiceId: z.string().min(1),
  clientId: z.string().min(1),
  amount: z.number().positive(),
  paymentMethod: paymentMethodSchema.nullable(),
  referenceNumber: z.string().nullable(),
  notes: z.string().nullable(),
  paymentDate: z.date(),
  stripePaymentIntent: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.date(),
  voidedAt: z.date().nullable(),
  voidedBy: z.string().nullable(),
});

// ─── Financial Form Schemas ──────────────────────────────────────────────────

/** Create product form */
export const createProductSchema = z.object({
  companyId: z.string().min(1, "Company is required"),
  name: z.string().min(1, "Product name is required").max(200),
  description: z.string().optional().nullable(),
  defaultPrice: z.number().min(0, "Price must be positive").default(0),
  unitCost: z.number().min(0).optional().nullable(),
  unit: z.string().default("each"),
  category: z.string().optional().nullable(),
  isTaxable: z.boolean().default(true),
  isActive: z.boolean().default(true),
});

/** Update product form */
export const updateProductSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional().nullable(),
  defaultPrice: z.number().min(0).optional(),
  unitCost: z.number().min(0).optional().nullable(),
  unit: z.string().optional(),
  category: z.string().optional().nullable(),
  isTaxable: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

/** Line item form (used within estimate/invoice forms) */
export const lineItemFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional().nullable(),
  quantity: z.number().min(0.0001, "Quantity must be positive").default(1),
  unit: z.string().default("each"),
  unitPrice: z.number().default(0),
  isTaxable: z.boolean().default(true),
  discountPercent: z.number().min(0).max(100).default(0),
  productId: z.string().optional().nullable(),
  isOptional: z.boolean().default(false),
  isSelected: z.boolean().default(true),
});

/** Create estimate form */
export const createEstimateSchema = z.object({
  companyId: z.string().min(1, "Company is required"),
  clientId: z.string().min(1, "Client is required"),
  opportunityId: z.string().optional().nullable(),
  issueDate: z.date().default(() => new Date()),
  expirationDate: z.date().optional().nullable(),
  title: z.string().optional().nullable(),
  clientMessage: z.string().optional().nullable(),
  internalNotes: z.string().optional().nullable(),
  terms: z.string().optional().nullable(),
  lineItems: z.array(lineItemFormSchema).min(1, "At least one line item is required"),
});

/** Update estimate form */
export const updateEstimateSchema = z.object({
  id: z.string().min(1),
  clientId: z.string().optional().nullable(),
  opportunityId: z.string().optional().nullable(),
  issueDate: z.date().optional(),
  expirationDate: z.date().optional().nullable(),
  title: z.string().optional().nullable(),
  clientMessage: z.string().optional().nullable(),
  internalNotes: z.string().optional().nullable(),
  terms: z.string().optional().nullable(),
  lineItems: z.array(lineItemFormSchema).optional(),
});

/** Create invoice form */
export const createInvoiceSchema = z.object({
  companyId: z.string().min(1, "Company is required"),
  clientId: z.string().min(1, "Client is required"),
  projectId: z.string().optional().nullable(),
  estimateId: z.string().optional().nullable(),
  opportunityId: z.string().optional().nullable(),
  issueDate: z.date().default(() => new Date()),
  dueDate: z.date(),
  paymentTerms: z.string().default("Net 30"),
  subject: z.string().optional().nullable(),
  clientMessage: z.string().optional().nullable(),
  internalNotes: z.string().optional().nullable(),
  terms: z.string().optional().nullable(),
  lineItems: z.array(lineItemFormSchema).min(1, "At least one line item is required"),
});

/** Update invoice form */
export const updateInvoiceSchema = z.object({
  id: z.string().min(1),
  clientId: z.string().optional().nullable(),
  projectId: z.string().optional().nullable(),
  issueDate: z.date().optional(),
  dueDate: z.date().optional(),
  paymentTerms: z.string().optional(),
  subject: z.string().optional().nullable(),
  clientMessage: z.string().optional().nullable(),
  internalNotes: z.string().optional().nullable(),
  terms: z.string().optional().nullable(),
  lineItems: z.array(lineItemFormSchema).optional(),
});

/** Record payment form */
export const recordPaymentSchema = z.object({
  invoiceId: z.string().min(1),
  companyId: z.string().min(1),
  clientId: z.string().min(1),
  amount: z.number().positive("Amount must be positive"),
  paymentDate: z.date().default(() => new Date()),
  paymentMethod: paymentMethodSchema.default("other"),
  referenceNumber: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

// ─── Inferred Types ───────────────────────────────────────────────────────────

export type ProjectFormValues = z.infer<typeof createProjectSchema>;
export type UpdateProjectFormValues = z.infer<typeof updateProjectSchema>;
export type TaskFormValues = z.infer<typeof createTaskSchema>;
export type UpdateTaskFormValues = z.infer<typeof updateTaskSchema>;
export type ClientFormValues = z.infer<typeof createClientSchema>;
export type UpdateClientFormValues = z.infer<typeof updateClientSchema>;
export type SubClientFormValues = z.infer<typeof createSubClientSchema>;
export type UpdateSubClientFormValues = z.infer<typeof updateSubClientSchema>;
export type TaskTypeFormValues = z.infer<typeof createTaskTypeSchema>;
export type UpdateTaskTypeFormValues = z.infer<typeof updateTaskTypeSchema>;
export type CalendarEventFormValues = z.infer<typeof createCalendarEventSchema>;
export type UpdateCalendarEventFormValues = z.infer<typeof updateCalendarEventSchema>;
export type ProductFormValues = z.infer<typeof createProductSchema>;
export type UpdateProductFormValues = z.infer<typeof updateProductSchema>;
export type LineItemFormValues = z.infer<typeof lineItemFormSchema>;
export type EstimateFormValues = z.infer<typeof createEstimateSchema>;
export type UpdateEstimateFormValues = z.infer<typeof updateEstimateSchema>;
export type InvoiceFormValues = z.infer<typeof createInvoiceSchema>;
export type UpdateInvoiceFormValues = z.infer<typeof updateInvoiceSchema>;
export type RecordPaymentFormValues = z.infer<typeof recordPaymentSchema>;
