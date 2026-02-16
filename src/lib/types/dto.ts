/**
 * OPS Web - Data Transfer Objects
 *
 * Complete DTO interfaces matching Bubble API response shapes EXACTLY.
 * Includes conversion functions (toModel / fromModel) for each DTO.
 *
 * CRITICAL QUIRKS:
 * - SubClientDTO.phoneNumber can be string OR number
 * - CompanyDTO dates can be UNIX timestamps OR ISO8601 strings
 * - TaskStatus "Scheduled" maps to "Booked"
 * - TaskTypeDTO can return "id" or "_id", and "display" or "Display"
 * - BubbleReference can be string ID or { unique_id: string } object
 * - CalendarEvent API type is lowercase "calendarevent"
 * - Project teamMembers is legacy - compute from task assignments
 */

import { parseBubbleDate } from "../utils/date";
// parseBubbleDate already handles string | number | null | undefined
import {
  type Project,
  type ProjectTask,
  type CalendarEvent,
  type TaskType,
  type Client,
  type SubClient,
  type User,
  type Company,
  type OpsContact,
  ProjectStatus,
  TaskStatus,
  UserRole,
  UserType,
  SubscriptionStatus,
  SubscriptionPlan,
  PaymentSchedule,
  OpsContactRole,
} from "./models";
import { normalizeTaskStatus, employeeTypeToRole } from "../constants/bubble-fields";

// ─── Bubble API Response Wrappers ─────────────────────────────────────────────

/** Wraps a list response from the Bubble Data API */
export interface BubbleListResponse<T> {
  response: {
    cursor: number;
    results: T[];
    count: number;
    remaining: number;
  };
}

/** Wraps a single object response from the Bubble Data API */
export interface BubbleObjectResponse<T> {
  response: T;
}

/** Wraps a workflow API response */
export interface BubbleWorkflowResponse {
  status: string;
  response?: Record<string, unknown>;
}

/** Wraps a creation response - just returns the ID */
export interface BubbleCreationResponse {
  status: string;
  id: string;
}

// ─── Bubble Primitive Types ───────────────────────────────────────────────────

/** Bubble geographic address */
export interface BubbleAddress {
  address: string; // CodingKey: "address" maps to formattedAddress
  lat?: number | null;
  lng?: number | null;
}

/**
 * Bubble reference type - can be a string ID or an object with unique_id.
 * Handles both formats transparently.
 */
export type BubbleReference = string | { unique_id: string; text?: string };

/** Extract string ID from a BubbleReference */
export function resolveBubbleReference(ref: BubbleReference | null | undefined): string | null {
  if (ref === null || ref === undefined) return null;
  if (typeof ref === "string") return ref || null;
  if (typeof ref === "object" && "unique_id" in ref) return ref.unique_id || null;
  return null;
}

/** Extract string IDs from array of BubbleReferences */
export function resolveBubbleReferences(
  refs: BubbleReference[] | null | undefined
): string[] {
  if (!refs) return [];
  return refs
    .map(resolveBubbleReference)
    .filter((id): id is string => id !== null && id.length > 0);
}

/** Bubble image type */
export interface BubbleImage {
  url?: string | null;
  filename?: string | null;
}

// ─── Project DTO ──────────────────────────────────────────────────────────────

export interface ProjectDTO {
  _id: string; // CodingKey: "_id"
  address?: BubbleAddress | null; // CodingKey: "address"
  allDay?: boolean | null; // CodingKey: "allDay"
  client?: string | null; // CodingKey: "client" - string ID
  company?: BubbleReference | null; // CodingKey: "company"
  completion?: string | null; // CodingKey: "completion" - ISO date
  description?: string | null; // CodingKey: "description"
  projectName: string; // CodingKey: "projectName"
  startDate?: string | null; // CodingKey: "startDate" - ISO date
  status: string; // CodingKey: "status" - Job Status
  teamNotes?: string | null; // CodingKey: "teamNotes"
  teamMembers?: string[] | null; // CodingKey: "teamMembers" - LEGACY
  thumbnail?: string | null; // CodingKey: "thumbnail"
  projectImages?: string[] | null; // CodingKey: "projectImages"
  duration?: number | null; // CodingKey: "duration"
  projectValue?: number | null; // CodingKey: "projectValue"
  projectGrossCost?: number | null; // CodingKey: "projectGrossCost"
  balance?: number | null; // CodingKey: "balance"
  Slug?: string | null; // CodingKey: "Slug"
  tasks?: BubbleReference[] | null; // CodingKey: "tasks"
  deletedAt?: string | null; // CodingKey: "deletedAt"
  "Created Date"?: string | null;
  "Modified Date"?: string | null;
}

/** Convert ProjectDTO to Project model */
export function projectDtoToModel(dto: ProjectDTO): Project {
  const statusValue = dto.status as ProjectStatus;
  const validStatus = Object.values(ProjectStatus).includes(statusValue)
    ? statusValue
    : ProjectStatus.RFQ;

  // Handle "Pending" legacy status
  const finalStatus = dto.status === "Pending" ? ProjectStatus.RFQ : validStatus;

  return {
    id: dto._id,
    title: dto.projectName,
    address: dto.address?.address ?? null,
    latitude: dto.address?.lat ?? null,
    longitude: dto.address?.lng ?? null,
    startDate: dto.startDate ? parseBubbleDate(dto.startDate) : null,
    endDate: dto.completion ? parseBubbleDate(dto.completion) : null,
    duration: dto.duration ?? null,
    status: finalStatus,
    notes: dto.teamNotes ?? null,
    companyId: resolveBubbleReference(dto.company) ?? "",
    clientId: dto.client ?? null,
    allDay: dto.allDay ?? false,
    // NOTE: teamMemberIds is computed from tasks, NOT from Bubble legacy field
    teamMemberIds: [],
    projectDescription: dto.description ?? null,
    projectImages: dto.projectImages ?? [],
    lastSyncedAt: new Date(),
    needsSync: false,
    syncPriority: 1,
    deletedAt: dto.deletedAt ? parseBubbleDate(dto.deletedAt) : null,
  };
}

/** Convert Project model to DTO for API requests */
export function projectModelToDto(
  project: Partial<Project> & { id?: string }
): Record<string, unknown> {
  const dto: Record<string, unknown> = {};

  if (project.title !== undefined) dto.projectName = project.title;
  if (project.address !== undefined) {
    dto.address =
      project.address !== null
        ? {
            address: project.address,
            lat: project.latitude ?? undefined,
            lng: project.longitude ?? undefined,
          }
        : null;
  }
  if (project.allDay !== undefined) dto.allDay = project.allDay;
  if (project.clientId !== undefined) dto.client = project.clientId;
  if (project.companyId !== undefined) dto.company = project.companyId;
  if (project.endDate !== undefined)
    dto.completion = project.endDate?.toISOString() ?? null;
  if (project.projectDescription !== undefined)
    dto.description = project.projectDescription;
  if (project.startDate !== undefined)
    dto.startDate = project.startDate?.toISOString() ?? null;
  if (project.status !== undefined) dto.status = project.status;
  if (project.notes !== undefined) dto.teamNotes = project.notes;
  if (project.duration !== undefined) dto.duration = project.duration;
  if (project.projectImages !== undefined)
    dto.projectImages = project.projectImages;
  if (project.deletedAt !== undefined)
    dto.deletedAt = project.deletedAt?.toISOString() ?? null;

  return dto;
}

// ─── Task DTO ─────────────────────────────────────────────────────────────────

export interface TaskDTO {
  _id: string; // CodingKey: "_id"
  calendarEventId?: string | null; // CodingKey: "calendarEventId"
  companyId?: string | null; // CodingKey: "companyId"
  completionDate?: string | null; // CodingKey: "completionDate"
  projectId?: string | null; // CodingKey: "projectId" (lowercase Id)
  scheduledDate?: string | null; // CodingKey: "scheduledDate"
  status?: string | null; // CodingKey: "status"
  taskColor?: string | null; // CodingKey: "taskColor"
  taskIndex?: number | null; // CodingKey: "taskIndex"
  taskNotes?: string | null; // CodingKey: "taskNotes"
  teamMembers?: string[] | null; // CodingKey: "teamMembers"
  type?: string | null; // CodingKey: "type" - TaskType ID
  "Created Date"?: string | null;
  "Modified Date"?: string | null;
  deletedAt?: string | null; // CodingKey: "deletedAt"
}

/** Convert TaskDTO to ProjectTask model */
export function taskDtoToModel(
  dto: TaskDTO,
  defaultColor: string = "#59779F"
): ProjectTask {
  // Validate color - ensure it starts with #
  let validColor = defaultColor;
  if (dto.taskColor && dto.taskColor.length > 0) {
    validColor = dto.taskColor.startsWith("#")
      ? dto.taskColor
      : `#${dto.taskColor}`;
  }

  // Map status - handle "Scheduled" -> "Booked" backward compatibility
  let taskStatus: TaskStatus = TaskStatus.Booked;
  if (dto.status) {
    const normalized = normalizeTaskStatus(dto.status);
    if (Object.values(TaskStatus).includes(normalized as TaskStatus)) {
      taskStatus = normalized as TaskStatus;
    }
  }

  return {
    id: dto._id,
    projectId: dto.projectId || "",
    calendarEventId: dto.calendarEventId ?? null,
    companyId: dto.companyId || "",
    status: taskStatus,
    taskColor: validColor,
    taskNotes: dto.taskNotes ?? null,
    taskTypeId: dto.type ?? "",
    taskIndex: dto.taskIndex ?? null,
    displayOrder: dto.taskIndex ?? 0,
    customTitle: null,
    teamMemberIds: dto.teamMembers ?? [],
    lastSyncedAt: new Date(),
    needsSync: false,
    deletedAt: dto.deletedAt ? parseBubbleDate(dto.deletedAt) : null,
  };
}

/** Convert ProjectTask model to DTO for API requests */
export function taskModelToDto(
  task: Partial<ProjectTask> & { id?: string }
): Record<string, unknown> {
  const dto: Record<string, unknown> = {};

  if (task.calendarEventId !== undefined)
    dto.calendarEventId = task.calendarEventId;
  if (task.companyId !== undefined && task.companyId !== "")
    dto.companyId = task.companyId;
  if (task.projectId !== undefined && task.projectId !== "")
    dto.projectId = task.projectId;
  if (task.status !== undefined) dto.status = task.status;
  if (task.taskColor !== undefined) dto.taskColor = task.taskColor;
  if (task.displayOrder !== undefined) dto.taskIndex = task.displayOrder;
  if (task.taskNotes !== undefined) dto.taskNotes = task.taskNotes;
  if (task.teamMemberIds !== undefined && task.teamMemberIds.length > 0)
    dto.teamMembers = task.teamMemberIds;
  if (task.taskTypeId !== undefined && task.taskTypeId !== "")
    dto.type = task.taskTypeId;
  if (task.deletedAt !== undefined)
    dto.deletedAt = task.deletedAt?.toISOString() ?? null;

  return dto;
}

// ─── CalendarEvent DTO ────────────────────────────────────────────────────────

export interface CalendarEventDTO {
  _id: string; // CodingKey: "_id"
  color?: string | null; // CodingKey: "color"
  companyId?: string | null; // CodingKey: "companyId" (lowercase c)
  projectId?: string | null; // CodingKey: "projectId" (lowercase p)
  taskId?: string | null; // CodingKey: "taskId" (lowercase t)
  duration?: number | null; // CodingKey: "duration" - can be decimal
  endDate?: string | null; // CodingKey: "endDate"
  startDate?: string | null; // CodingKey: "startDate"
  teamMembers?: string[] | null; // CodingKey: "teamMembers"
  title?: string | null; // CodingKey: "title"
  "Created Date"?: string | null;
  "Modified Date"?: string | null;
  deletedAt?: string | null; // CodingKey: "deletedAt"
}

/** Convert CalendarEventDTO to CalendarEvent model */
export function calendarEventDtoToModel(
  dto: CalendarEventDTO
): CalendarEvent | null {
  // Validate required fields
  if (!dto.projectId || dto.projectId.length === 0) return null;
  if (!dto.companyId || dto.companyId.length === 0) return null;

  // Validate and clean color
  let validColor = "#59779F";
  if (dto.color && dto.color.length > 0) {
    validColor = dto.color.startsWith("#") ? dto.color : `#${dto.color}`;
  }

  // Parse dates
  let startDateObj: Date | null = null;
  let endDateObj: Date | null = null;

  if (dto.startDate) {
    startDateObj = parseBubbleDate(dto.startDate);
  }

  if (dto.endDate) {
    endDateObj = parseBubbleDate(dto.endDate);
  }

  // Validate date order
  if (startDateObj && endDateObj && endDateObj < startDateObj) {
    endDateObj = startDateObj;
  }

  // Validate duration
  if (startDateObj && endDateObj && dto.duration !== null && dto.duration !== undefined) {
    if (dto.duration <= 0) {
      endDateObj = startDateObj;
    }
  }

  const validTitle =
    dto.title?.trim() || "Untitled Event";

  return {
    id: dto._id,
    color: validColor,
    companyId: dto.companyId,
    projectId: dto.projectId,
    taskId: dto.taskId ?? null,
    duration: Math.max(1, Math.round(dto.duration ?? 1)),
    endDate: endDateObj,
    startDate: startDateObj,
    title: validTitle,
    teamMemberIds: dto.teamMembers ?? [],
    lastSyncedAt: new Date(),
    needsSync: false,
    deletedAt: dto.deletedAt ? parseBubbleDate(dto.deletedAt) : null,
  };
}

/** Convert CalendarEvent model to DTO for API requests */
export function calendarEventModelToDto(
  event: Partial<CalendarEvent> & { id?: string }
): Record<string, unknown> {
  const dto: Record<string, unknown> = {};

  if (event.color !== undefined) dto.color = event.color;
  if (event.companyId !== undefined) dto.companyId = event.companyId;
  if (event.projectId !== undefined) dto.projectId = event.projectId;
  if (event.taskId !== undefined) dto.taskId = event.taskId;
  if (event.duration !== undefined) dto.duration = event.duration;
  if (event.endDate !== undefined)
    dto.endDate = event.endDate?.toISOString() ?? null;
  if (event.startDate !== undefined)
    dto.startDate = event.startDate?.toISOString() ?? null;
  if (event.teamMemberIds !== undefined) dto.teamMembers = event.teamMemberIds;
  if (event.title !== undefined) dto.title = event.title;
  if (event.deletedAt !== undefined)
    dto.deletedAt = event.deletedAt?.toISOString() ?? null;

  return dto;
}

// ─── User DTO ─────────────────────────────────────────────────────────────────

export interface UserDTO {
  _id: string; // CodingKey: "_id"
  nameFirst?: string | null; // CodingKey: "nameFirst"
  nameLast?: string | null; // CodingKey: "nameLast"
  employeeType?: string | null; // CodingKey: "employeeType"
  userType?: string | null; // CodingKey: "userType"
  avatar?: string | null; // CodingKey: "avatar"
  company?: string | null; // CodingKey: "company"
  email?: string | null; // CodingKey: "email"
  homeAddress?: BubbleAddress | null; // CodingKey: "homeAddress"
  phone?: string | null; // CodingKey: "phone"
  userColor?: string | null; // CodingKey: "userColor"
  devPermission?: boolean | null; // CodingKey: "devPermission"
  hasCompletedAppOnboarding?: boolean | null; // CodingKey: "hasCompletedAppOnboarding"
  hasCompletedAppTutorial?: boolean | null; // CodingKey: "hasCompletedAppTutorial"
  stripeCustomerId?: string | null; // CodingKey: "stripeCustomerId"
  deviceToken?: string | null; // CodingKey: "deviceToken"
  deletedAt?: string | null; // CodingKey: "deletedAt"
  authentication?: {
    email?: {
      email?: string | null;
      email_confirmed?: boolean | null;
    } | null;
  } | null;
}

/**
 * Convert UserDTO to User model.
 * @param dto - The raw DTO from Bubble
 * @param companyAdminIds - Admin IDs from company for role detection (Priority 1)
 */
export function userDtoToModel(
  dto: UserDTO,
  companyAdminIds?: string[]
): User {
  // Role detection with iOS priority logic:
  // 1. user.id IN company.adminIds[] -> Admin
  // 2. user.employeeType -> mapped role
  // 3. default -> FieldCrew
  let role: UserRole;

  if (companyAdminIds && companyAdminIds.includes(dto._id)) {
    role = UserRole.Admin;
  } else if (dto.employeeType) {
    const mappedRole = employeeTypeToRole(dto.employeeType);
    switch (mappedRole) {
      case "admin":
        role = UserRole.Admin;
        break;
      case "officeCrew":
        role = UserRole.OfficeCrew;
        break;
      case "fieldCrew":
      default:
        role = UserRole.FieldCrew;
        break;
    }
  } else {
    role = UserRole.FieldCrew;
  }

  // Resolve email - authentication.email.email takes priority
  const resolvedEmail =
    dto.authentication?.email?.email || dto.email || null;

  // Map userType
  let userType: UserType | null = null;
  if (dto.userType === "Company") userType = UserType.Company;
  else if (dto.userType === "Employee") userType = UserType.Employee;

  return {
    id: dto._id,
    firstName: dto.nameFirst ?? "",
    lastName: dto.nameLast ?? "",
    email: resolvedEmail,
    phone: dto.phone ?? null,
    profileImageURL: dto.avatar ?? null,
    role,
    companyId: dto.company ?? null,
    userType,
    latitude: null,
    longitude: null,
    locationName: null,
    homeAddress: dto.homeAddress?.address ?? null,
    clientId: null,
    isActive: null,
    userColor: dto.userColor ?? null,
    devPermission: dto.devPermission ?? false,
    hasCompletedAppOnboarding: dto.hasCompletedAppOnboarding ?? false,
    hasCompletedAppTutorial: dto.hasCompletedAppTutorial ?? false,
    isCompanyAdmin: companyAdminIds
      ? companyAdminIds.includes(dto._id)
      : false,
    stripeCustomerId: dto.stripeCustomerId ?? null,
    deviceToken: dto.deviceToken ?? null,
    lastSyncedAt: new Date(),
    needsSync: false,
    deletedAt: dto.deletedAt ? parseBubbleDate(dto.deletedAt) : null,
  };
}

/** Convert User model to DTO for API requests */
export function userModelToDto(
  user: Partial<User> & { id?: string }
): Record<string, unknown> {
  const dto: Record<string, unknown> = {};

  if (user.firstName !== undefined) dto.nameFirst = user.firstName;
  if (user.lastName !== undefined) dto.nameLast = user.lastName;
  if (user.email !== undefined) dto.email = user.email;
  if (user.phone !== undefined) dto.phone = user.phone;
  if (user.profileImageURL !== undefined) dto.avatar = user.profileImageURL;
  if (user.companyId !== undefined) dto.company = user.companyId;
  if (user.role !== undefined) dto.employeeType = user.role;
  if (user.userType !== undefined) dto.userType = user.userType;
  if (user.homeAddress !== undefined && user.homeAddress !== null) {
    dto.homeAddress = { address: user.homeAddress };
  }
  if (user.deviceToken !== undefined) dto.deviceToken = user.deviceToken;
  if (user.hasCompletedAppTutorial !== undefined)
    dto.hasCompletedAppTutorial = user.hasCompletedAppTutorial;

  return dto;
}

// ─── Company DTO ──────────────────────────────────────────────────────────────

export interface CompanyDTO {
  _id: string; // CodingKey: "_id"
  companyName?: string | null; // CodingKey: "companyName"
  companyId?: string | null; // CodingKey: "companyId"
  companyDescription?: string | null; // CodingKey: "companyDescription"
  location?: BubbleAddress | null; // CodingKey: "location"
  logo?: BubbleImage | null; // CodingKey: "logo"
  projects?: BubbleReference[] | null; // CodingKey: "projects"
  teams?: BubbleReference[] | null; // CodingKey: "teams"
  openHour?: string | null; // CodingKey: "openHour"
  closeHour?: string | null; // CodingKey: "closeHour"
  phone?: string | null; // CodingKey: "phone"
  officeEmail?: string | null; // CodingKey: "officeEmail"
  industry?: string | null; // CodingKey: "industry"
  companySize?: string | null; // CodingKey: "companySize"
  companyAge?: string | null; // CodingKey: "companyAge"
  employees?: BubbleReference[] | null; // CodingKey: "employees"
  admin?: BubbleReference[] | null; // CodingKey: "admin"
  website?: string | null; // CodingKey: "website"
  calendarEventsList?: BubbleReference[] | null; // CodingKey: "calendarEventsList"
  defaultProjectColor?: string | null; // CodingKey: "defaultProjectColor"
  taskTypes?: BubbleReference[] | null; // CodingKey: "taskTypes"
  clients?: BubbleReference[] | null; // CodingKey: "clients"
  estimates?: BubbleReference[] | null; // CodingKey: "estimates"
  invoices?: BubbleReference[] | null; // CodingKey: "invoices"
  accountHolder?: BubbleReference | null; // CodingKey: "accountHolder"
  seatedEmployees?: BubbleReference[] | null; // CodingKey: "seatedEmployees"

  // Subscription fields - CRITICAL: dates can be UNIX timestamps OR ISO8601
  subscriptionStatus?: string | null; // CodingKey: "subscriptionStatus"
  subscriptionPlan?: string | null; // CodingKey: "subscriptionPlan"
  subscriptionEnd?: number | string | null; // CodingKey: "subscriptionEnd" - UNIX or ISO
  subscriptionPeriod?: string | null; // CodingKey: "subscriptionPeriod"
  maxSeats?: number | null; // CodingKey: "maxSeats"
  seatGraceStartDate?: number | string | null; // CodingKey: "seatGraceStartDate" - UNIX or ISO
  trialStartDate?: number | string | null; // CodingKey: "trialStartDate" - UNIX or ISO
  trialEndDate?: number | string | null; // CodingKey: "trialEndDate" - UNIX or ISO

  // Add-ons
  hasPrioritySupport?: boolean | null;
  dataSetupPurchased?: boolean | null;
  dataSetupCompleted?: boolean | null;
  dataSetupScheduledDate?: number | string | null; // UNIX or ISO

  // Stripe
  stripeCustomerId?: string | null; // CodingKey: "stripeCustomerId"
  referralMethod?: string | null;

  deletedAt?: string | null; // CodingKey: "deletedAt"
}

/**
 * Parse a flexible date field that can be UNIX timestamp (number) or ISO8601 (string).
 * This is critical for Company DTO fields that originate from Stripe.
 */
function parseFlexibleDate(
  value: number | string | null | undefined
): Date | null {
  if (value === null || value === undefined) return null;

  // UNIX timestamp (number)
  if (typeof value === "number") {
    return new Date(value * 1000);
  }

  // ISO8601 string
  if (typeof value === "string") {
    // Try parsing as number string first (UNIX timestamp as string)
    const numValue = Number(value);
    if (!isNaN(numValue) && value.match(/^\d+(\.\d+)?$/)) {
      return new Date(numValue * 1000);
    }
    return parseBubbleDate(value);
  }

  return null;
}

/** Convert CompanyDTO to Company model */
export function companyDtoToModel(dto: CompanyDTO): Company {
  // Normalize subscription status to lowercase
  let subStatus: SubscriptionStatus | null = null;
  if (dto.subscriptionStatus) {
    const normalized = dto.subscriptionStatus
      .toLowerCase()
      .trim() as SubscriptionStatus;
    if (Object.values(SubscriptionStatus).includes(normalized)) {
      subStatus = normalized;
    }
  }

  // Normalize subscription plan to lowercase
  let subPlan: SubscriptionPlan | null = null;
  if (dto.subscriptionPlan) {
    const normalized = dto.subscriptionPlan
      .toLowerCase()
      .trim() as SubscriptionPlan;
    if (Object.values(SubscriptionPlan).includes(normalized)) {
      subPlan = normalized;
    }
  }

  // Parse payment schedule
  let paymentSchedule: PaymentSchedule | null = null;
  if (dto.subscriptionPeriod === "Monthly") {
    paymentSchedule = PaymentSchedule.Monthly;
  } else if (dto.subscriptionPeriod === "Annual") {
    paymentSchedule = PaymentSchedule.Annual;
  }

  return {
    id: dto._id,
    name: dto.companyName ?? "Unknown Company",
    logoURL: dto.logo?.url ?? null,
    externalId: dto.companyId ?? null,
    companyDescription: dto.companyDescription ?? null,
    address: dto.location?.address ?? null,
    phone: dto.phone ?? null,
    email: dto.officeEmail ?? null,
    website: dto.website ?? null,
    latitude: dto.location?.lat ?? null,
    longitude: dto.location?.lng ?? null,
    openHour: dto.openHour ?? null,
    closeHour: dto.closeHour ?? null,
    industries: dto.industry ? [dto.industry] : [],
    companySize: dto.companySize ?? null,
    companyAge: dto.companyAge ?? null,
    referralMethod: dto.referralMethod ?? null,
    projectIds: resolveBubbleReferences(dto.projects),
    teamIds: resolveBubbleReferences(dto.teams),
    adminIds: resolveBubbleReferences(dto.admin),
    accountHolderId: resolveBubbleReference(dto.accountHolder),
    defaultProjectColor: dto.defaultProjectColor ?? "#9CA3AF",
    teamMembersSynced: false,
    subscriptionStatus: subStatus,
    subscriptionPlan: subPlan,
    subscriptionEnd: parseFlexibleDate(dto.subscriptionEnd),
    subscriptionPeriod: paymentSchedule,
    maxSeats: dto.maxSeats ?? 0,
    seatedEmployeeIds: resolveBubbleReferences(dto.seatedEmployees),
    seatGraceStartDate: parseFlexibleDate(dto.seatGraceStartDate),
    trialStartDate: parseFlexibleDate(dto.trialStartDate),
    trialEndDate: parseFlexibleDate(dto.trialEndDate),
    hasPrioritySupport: dto.hasPrioritySupport ?? false,
    dataSetupPurchased: dto.dataSetupPurchased ?? false,
    dataSetupCompleted: dto.dataSetupCompleted ?? false,
    dataSetupScheduledDate: parseFlexibleDate(dto.dataSetupScheduledDate),
    stripeCustomerId: dto.stripeCustomerId ?? null,
    lastSyncedAt: new Date(),
    needsSync: false,
    deletedAt: dto.deletedAt ? parseBubbleDate(dto.deletedAt) : null,
  };
}

/** Convert Company model to DTO for API requests */
export function companyModelToDto(
  company: Partial<Company> & { id?: string }
): Record<string, unknown> {
  const dto: Record<string, unknown> = {};

  if (company.name !== undefined) dto.companyName = company.name;
  if (company.externalId !== undefined) dto.companyId = company.externalId;
  if (company.companyDescription !== undefined)
    dto.companyDescription = company.companyDescription;
  if (company.address !== undefined && company.address !== null) {
    dto.location = {
      address: company.address,
      lat: company.latitude ?? undefined,
      lng: company.longitude ?? undefined,
    };
  }
  if (company.phone !== undefined) dto.phone = company.phone;
  if (company.email !== undefined) dto.officeEmail = company.email;
  if (company.website !== undefined) dto.website = company.website;
  if (company.openHour !== undefined) dto.openHour = company.openHour;
  if (company.closeHour !== undefined) dto.closeHour = company.closeHour;
  if (company.defaultProjectColor !== undefined)
    dto.defaultProjectColor = company.defaultProjectColor;

  return dto;
}

// ─── Client DTO ───────────────────────────────────────────────────────────────

export interface ClientDTO {
  _id: string; // CodingKey: "_id"
  address?: BubbleAddress | null; // CodingKey: "address"
  emailAddress?: string | null; // CodingKey: "emailAddress"
  name?: string | null; // CodingKey: "name"
  phoneNumber?: string | null; // CodingKey: "phoneNumber"
  balance?: string | null; // CodingKey: "balance"
  clientIdNo?: string | null; // CodingKey: "clientIdNo"
  isCompany?: boolean | null; // CodingKey: "isCompany"
  parentCompany?: BubbleReference | null; // CodingKey: "parentCompany"
  status?: string | null; // CodingKey: "status"
  avatar?: string | null; // CodingKey: "avatar" (was "thumbnail")
  subClients?: string[] | null; // CodingKey: "subClients"
  estimates?: string[] | null; // CodingKey: "estimates"
  invoices?: string[] | null; // CodingKey: "invoices"
  projectsList?: string[] | null; // CodingKey: "projectsList"
  notes?: string | null; // CodingKey: "notes"
  unit?: string | null; // CodingKey: "unit"
  userId?: string | null; // CodingKey: "userId"
  "Created Date"?: string | null;
  "Modified Date"?: string | null;
  Slug?: string | null;
  deletedAt?: string | null; // CodingKey: "deletedAt"
}

/** Convert ClientDTO to Client model */
export function clientDtoToModel(dto: ClientDTO): Client {
  return {
    id: dto._id,
    name: dto.name ?? "Unknown Client",
    email: dto.emailAddress ?? null,
    phoneNumber: dto.phoneNumber ?? null,
    address: dto.address?.address ?? null,
    latitude: dto.address?.lat ?? null,
    longitude: dto.address?.lng ?? null,
    profileImageURL: dto.avatar ?? null,
    notes: dto.notes ?? null,
    companyId: resolveBubbleReference(dto.parentCompany),
    lastSyncedAt: new Date(),
    needsSync: false,
    createdAt: dto["Created Date"]
      ? parseBubbleDate(dto["Created Date"])
      : null,
    deletedAt: dto.deletedAt ? parseBubbleDate(dto.deletedAt) : null,
  };
}

/** Convert Client model to DTO for API requests */
export function clientModelToDto(
  client: Partial<Client> & { id?: string }
): Record<string, unknown> {
  const dto: Record<string, unknown> = {};

  if (client.name !== undefined) dto.name = client.name;
  if (client.email !== undefined) dto.emailAddress = client.email;
  if (client.phoneNumber !== undefined) dto.phoneNumber = client.phoneNumber;
  if (client.address !== undefined && client.address !== null) {
    dto.address = {
      address: client.address,
      lat: client.latitude ?? undefined,
      lng: client.longitude ?? undefined,
    };
  }
  if (client.profileImageURL !== undefined) dto.avatar = client.profileImageURL;
  if (client.notes !== undefined) dto.notes = client.notes;
  if (client.companyId !== undefined) dto.parentCompany = client.companyId;

  return dto;
}

// ─── SubClient DTO ────────────────────────────────────────────────────────────

/**
 * CRITICAL: phoneNumber can be string OR number from the API.
 * We handle this with a union type and normalizer.
 */
export interface SubClientDTO {
  _id: string; // CodingKey: "_id"
  name?: string | null; // CodingKey: "name"
  title?: string | null; // CodingKey: "title"
  emailAddress?: string | null; // CodingKey: "emailAddress"
  phoneNumber?: string | number | null; // CodingKey: "phoneNumber" - CAN BE STRING OR NUMBER
  address?: BubbleAddress | null; // CodingKey: "address"
  parentClient?: string | null; // CodingKey: "parentClient"
  deletedAt?: string | null; // CodingKey: "deletedAt"
}

/** Normalize phone number that can be string or number */
function normalizePhoneNumber(
  value: string | number | null | undefined
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    // Format as integer string (no decimal places)
    return Math.round(value).toString();
  }
  return null;
}

/** Convert SubClientDTO to SubClient model */
export function subClientDtoToModel(dto: SubClientDTO): SubClient {
  return {
    id: dto._id,
    name: dto.name ?? "Unknown",
    title: dto.title ?? null,
    email: dto.emailAddress ?? null,
    phoneNumber: normalizePhoneNumber(dto.phoneNumber),
    address: dto.address?.address ?? null,
    clientId: dto.parentClient ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSyncedAt: new Date(),
    needsSync: false,
    deletedAt: dto.deletedAt ? parseBubbleDate(dto.deletedAt) : null,
  };
}

/** Convert SubClient model to DTO for API requests */
export function subClientModelToDto(
  subClient: Partial<SubClient> & { id?: string }
): Record<string, unknown> {
  const dto: Record<string, unknown> = {};

  if (subClient.name !== undefined) dto.name = subClient.name;
  if (subClient.title !== undefined) dto.title = subClient.title;
  if (subClient.email !== undefined) dto.emailAddress = subClient.email;
  if (subClient.phoneNumber !== undefined)
    dto.phoneNumber = subClient.phoneNumber;
  if (subClient.address !== undefined && subClient.address !== null) {
    dto.address = { address: subClient.address };
  }
  if (subClient.clientId !== undefined) dto.parentClient = subClient.clientId;

  return dto;
}

// ─── TaskType DTO ─────────────────────────────────────────────────────────────

/**
 * CRITICAL: Bubble can return "id" or "_id", and "display" or "Display".
 * We handle both cases in the normalizer.
 */
export interface TaskTypeDTO {
  _id?: string; // CodingKey: "_id" (GET response)
  id?: string; // CodingKey: "id" (POST response)
  color: string; // CodingKey: "color"
  display?: string; // CodingKey: "display" (lowercase)
  Display?: string; // CodingKey: "Display" (capitalized - legacy)
  isDefault?: boolean | null; // CodingKey: "isDefault"
  "Created Date"?: string | null;
  "Modified Date"?: string | null;
  deletedAt?: string | null; // CodingKey: "deletedAt"
}

/** Normalize TaskTypeDTO to handle id/_id and display/Display variants */
function normalizeTaskTypeDto(dto: TaskTypeDTO): {
  id: string;
  display: string;
} {
  const id = dto._id || dto.id || "";
  const display = dto.display || dto.Display || "";
  return { id, display };
}

/** Convert TaskTypeDTO to TaskType model */
export function taskTypeDtoToModel(dto: TaskTypeDTO): TaskType {
  const { id, display } = normalizeTaskTypeDto(dto);

  return {
    id,
    color: dto.color,
    display,
    icon: null, // Icon field doesn't exist in Bubble
    isDefault: dto.isDefault ?? false,
    companyId: "", // Must be set by caller
    displayOrder: 0,
    lastSyncedAt: new Date(),
    needsSync: false,
    deletedAt: dto.deletedAt ? parseBubbleDate(dto.deletedAt) : null,
  };
}

/** Convert TaskType model to DTO for API requests */
export function taskTypeModelToDto(
  taskType: Partial<TaskType> & { id?: string }
): Record<string, unknown> {
  const dto: Record<string, unknown> = {};

  if (taskType.color !== undefined) dto.color = taskType.color;
  if (taskType.display !== undefined) dto.display = taskType.display;
  if (taskType.isDefault !== undefined) dto.isDefault = taskType.isDefault;

  return dto;
}

// ─── OpsContact DTO ───────────────────────────────────────────────────────────

export interface OpsContactDTO {
  _id: string;
  email?: string | null;
  name?: string | null;
  phone?: string | null;
  display?: string | null;
  role?: string | null;
}

/** Convert OpsContactDTO to OpsContact model */
export function opsContactDtoToModel(dto: OpsContactDTO): OpsContact {
  let role: OpsContactRole = OpsContactRole.GeneralSupport;
  switch (dto.role) {
    case "jack":
      role = OpsContactRole.Jack;
      break;
    case "Priority Support":
      role = OpsContactRole.PrioritySupport;
      break;
    case "Data Setup":
      role = OpsContactRole.DataSetup;
      break;
    case "General Support":
      role = OpsContactRole.GeneralSupport;
      break;
    case "Web App Auto Send":
      role = OpsContactRole.WebAppAutoSend;
      break;
  }

  return {
    id: dto._id,
    email: dto.email ?? "",
    name: dto.name ?? "",
    phone: dto.phone ?? "",
    display: dto.display ?? "",
    role,
    lastSynced: new Date(),
  };
}
