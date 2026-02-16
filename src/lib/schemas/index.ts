/**
 * OPS Web - Zod Validation Schemas
 *
 * Complete validation schemas for all entities, including:
 * - Entity schemas for runtime validation
 * - Form schemas for user input validation
 * - DTO schemas that handle Bubble API quirks
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

// ─── Bubble Primitive Schemas ─────────────────────────────────────────────────

export const bubbleAddressSchema = z.object({
  address: z.string(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
});

/** BubbleReference: can be string ID or object with unique_id */
export const bubbleReferenceSchema = z.union([
  z.string(),
  z.object({
    unique_id: z.string(),
    text: z.string().optional(),
  }),
]);

export const bubbleImageSchema = z.object({
  url: z.string().nullable().optional(),
  filename: z.string().nullable().optional(),
});

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

// ─── DTO Validation Schemas (for API responses) ───────────────────────────────

/** Project DTO from Bubble - handles all quirks */
export const projectDtoSchema = z.object({
  _id: z.string(),
  address: bubbleAddressSchema.nullable().optional(),
  allDay: z.boolean().nullable().optional(),
  client: z.string().nullable().optional(),
  company: bubbleReferenceSchema.nullable().optional(),
  completion: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  projectName: z.string(),
  startDate: z.string().nullable().optional(),
  status: z.string(),
  teamNotes: z.string().nullable().optional(),
  teamMembers: z.array(z.string()).nullable().optional(),
  thumbnail: z.string().nullable().optional(),
  projectImages: z.array(z.string()).nullable().optional(),
  duration: z.number().nullable().optional(),
  tasks: z.array(bubbleReferenceSchema).nullable().optional(),
  deletedAt: z.string().nullable().optional(),
});

/** Task DTO from Bubble */
export const taskDtoSchema = z.object({
  _id: z.string(),
  calendarEventId: z.string().nullable().optional(),
  companyId: z.string().nullable().optional(),
  completionDate: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  scheduledDate: z.string().nullable().optional(),
  status: z.string().nullable().optional(), // "Scheduled" maps to "Booked"
  taskColor: z.string().nullable().optional(),
  taskIndex: z.number().nullable().optional(),
  taskNotes: z.string().nullable().optional(),
  teamMembers: z.array(z.string()).nullable().optional(),
  type: z.string().nullable().optional(),
  deletedAt: z.string().nullable().optional(),
});

/** CalendarEvent DTO from Bubble */
export const calendarEventDtoSchema = z.object({
  _id: z.string(),
  color: z.string().nullable().optional(),
  companyId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  taskId: z.string().nullable().optional(),
  duration: z.number().nullable().optional(),
  endDate: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  teamMembers: z.array(z.string()).nullable().optional(),
  title: z.string().nullable().optional(),
  deletedAt: z.string().nullable().optional(),
});

/** User DTO from Bubble */
export const userDtoSchema = z.object({
  _id: z.string(),
  nameFirst: z.string().nullable().optional(),
  nameLast: z.string().nullable().optional(),
  employeeType: z.string().nullable().optional(),
  userType: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  homeAddress: bubbleAddressSchema.nullable().optional(),
  phone: z.string().nullable().optional(),
  userColor: z.string().nullable().optional(),
  devPermission: z.boolean().nullable().optional(),
  hasCompletedAppOnboarding: z.boolean().nullable().optional(),
  hasCompletedAppTutorial: z.boolean().nullable().optional(),
  stripeCustomerId: z.string().nullable().optional(),
  deviceToken: z.string().nullable().optional(),
  deletedAt: z.string().nullable().optional(),
  authentication: z
    .object({
      email: z
        .object({
          email: z.string().nullable().optional(),
          email_confirmed: z.boolean().nullable().optional(),
        })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
});

/** Company DTO from Bubble - dates can be UNIX timestamps OR ISO8601 */
export const companyDtoSchema = z.object({
  _id: z.string(),
  companyName: z.string().nullable().optional(),
  companyId: z.string().nullable().optional(),
  companyDescription: z.string().nullable().optional(),
  location: bubbleAddressSchema.nullable().optional(),
  logo: bubbleImageSchema.nullable().optional(),
  projects: z.array(bubbleReferenceSchema).nullable().optional(),
  teams: z.array(bubbleReferenceSchema).nullable().optional(),
  admin: z.array(bubbleReferenceSchema).nullable().optional(),
  seatedEmployees: z.array(bubbleReferenceSchema).nullable().optional(),
  defaultProjectColor: z.string().nullable().optional(),
  subscriptionStatus: z.string().nullable().optional(),
  subscriptionPlan: z.string().nullable().optional(),
  // CRITICAL: These can be number (UNIX) or string (ISO8601)
  subscriptionEnd: z.union([z.number(), z.string()]).nullable().optional(),
  subscriptionPeriod: z.string().nullable().optional(),
  maxSeats: z.number().nullable().optional(),
  seatGraceStartDate: z
    .union([z.number(), z.string()])
    .nullable()
    .optional(),
  trialStartDate: z.union([z.number(), z.string()]).nullable().optional(),
  trialEndDate: z.union([z.number(), z.string()]).nullable().optional(),
  hasPrioritySupport: z.boolean().nullable().optional(),
  dataSetupPurchased: z.boolean().nullable().optional(),
  dataSetupCompleted: z.boolean().nullable().optional(),
  stripeCustomerId: z.string().nullable().optional(),
  deletedAt: z.string().nullable().optional(),
});

/** Client DTO from Bubble */
export const clientDtoSchema = z.object({
  _id: z.string(),
  address: bubbleAddressSchema.nullable().optional(),
  emailAddress: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  phoneNumber: z.string().nullable().optional(),
  balance: z.string().nullable().optional(),
  clientIdNo: z.string().nullable().optional(),
  isCompany: z.boolean().nullable().optional(),
  parentCompany: bubbleReferenceSchema.nullable().optional(),
  status: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
  subClients: z.array(z.string()).nullable().optional(),
  notes: z.string().nullable().optional(),
  deletedAt: z.string().nullable().optional(),
});

/** SubClient DTO - CRITICAL: phoneNumber can be string OR number */
export const subClientDtoSchema = z.object({
  _id: z.string(),
  name: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  emailAddress: z.string().nullable().optional(),
  phoneNumber: z.union([z.string(), z.number()]).nullable().optional(),
  address: bubbleAddressSchema.nullable().optional(),
  parentClient: z.string().nullable().optional(),
  deletedAt: z.string().nullable().optional(),
});

/** TaskType DTO - CRITICAL: id can be "id" or "_id", display can be "display" or "Display" */
export const taskTypeDtoSchema = z.object({
  _id: z.string().optional(),
  id: z.string().optional(),
  color: z.string(),
  display: z.string().optional(),
  Display: z.string().optional(),
  isDefault: z.boolean().nullable().optional(),
  deletedAt: z.string().nullable().optional(),
});

/** Bubble list response wrapper */
export const bubbleListResponseSchema = <T extends z.ZodType>(itemSchema: T) =>
  z.object({
    response: z.object({
      cursor: z.number(),
      results: z.array(itemSchema),
      count: z.number(),
      remaining: z.number(),
    }),
  });

/** Bubble single object response wrapper */
export const bubbleObjectResponseSchema = <T extends z.ZodType>(
  itemSchema: T
) =>
  z.object({
    response: itemSchema,
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
