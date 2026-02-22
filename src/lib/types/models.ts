/**
 * OPS Web - Domain Models
 *
 * Complete TypeScript interfaces for all 10 entities matching the iOS SwiftData models.
 * Includes all enums, computed property helpers, and utility types.
 */

// ─── Enums ────────────────────────────────────────────────────────────────────

/** Project status - matches iOS Status enum exactly */
export enum ProjectStatus {
  RFQ = "RFQ",
  Estimated = "Estimated",
  Accepted = "Accepted",
  InProgress = "In Progress",
  Completed = "Completed",
  Closed = "Closed",
  Archived = "Archived",
}

/** Task status - matches iOS TaskStatus enum exactly */
export enum TaskStatus {
  Booked = "Booked",
  InProgress = "In Progress",
  Completed = "Completed",
  Cancelled = "Cancelled",
}

/** User role - matches iOS UserRole enum exactly */
export enum UserRole {
  FieldCrew = "Field Crew",
  OfficeCrew = "Office Crew",
  Admin = "Admin",
}

/** User type - matches iOS UserType enum exactly */
export enum UserType {
  Employee = "Employee",
  Company = "Company",
}

/** Subscription status values */
export enum SubscriptionStatus {
  Trial = "trial",
  Active = "active",
  Grace = "grace",
  Expired = "expired",
  Cancelled = "cancelled",
}

/** Subscription plan tiers */
export enum SubscriptionPlan {
  Trial = "trial",
  Starter = "starter",
  Team = "team",
  Business = "business",
}

/** Payment schedule */
export enum PaymentSchedule {
  Monthly = "Monthly",
  Annual = "Annual",
}

/** OPS contact roles */
export enum OpsContactRole {
  Jack = "jack",
  PrioritySupport = "Priority Support",
  DataSetup = "Data Setup",
  GeneralSupport = "General Support",
  WebAppAutoSend = "Web App Auto Send",
}

// ─── Status Color Mappings ────────────────────────────────────────────────────

export const PROJECT_STATUS_COLORS: Record<ProjectStatus, string> = {
  [ProjectStatus.RFQ]: "#BCBCBC",
  [ProjectStatus.Estimated]: "#B5A381",
  [ProjectStatus.Accepted]: "#9DB582",
  [ProjectStatus.InProgress]: "#8195B5",
  [ProjectStatus.Completed]: "#B58289",
  [ProjectStatus.Closed]: "#E9E9E9",
  [ProjectStatus.Archived]: "#A182B5",
};

export const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  [TaskStatus.Booked]: "#8195B5",
  [TaskStatus.InProgress]: "#C4A868",
  [TaskStatus.Completed]: "#9DB582",
  [TaskStatus.Cancelled]: "#BCBCBC",
};

// ─── Status Sort Orders ───────────────────────────────────────────────────────

export const PROJECT_STATUS_SORT_ORDER: Record<ProjectStatus, number> = {
  [ProjectStatus.RFQ]: 0,
  [ProjectStatus.Estimated]: 1,
  [ProjectStatus.Accepted]: 2,
  [ProjectStatus.InProgress]: 3,
  [ProjectStatus.Completed]: 4,
  [ProjectStatus.Closed]: 5,
  [ProjectStatus.Archived]: 6,
};

export const TASK_STATUS_SORT_ORDER: Record<TaskStatus, number> = {
  [TaskStatus.Booked]: 0,
  [TaskStatus.InProgress]: 1,
  [TaskStatus.Completed]: 2,
  [TaskStatus.Cancelled]: 3,
};

// ─── Status Navigation ───────────────────────────────────────────────────────

const PROJECT_STATUS_ORDER = [
  ProjectStatus.RFQ,
  ProjectStatus.Estimated,
  ProjectStatus.Accepted,
  ProjectStatus.InProgress,
  ProjectStatus.Completed,
  ProjectStatus.Closed,
  ProjectStatus.Archived,
];

const TASK_STATUS_ORDER = [
  TaskStatus.Booked,
  TaskStatus.InProgress,
  TaskStatus.Completed,
  TaskStatus.Cancelled,
];

export function nextProjectStatus(
  current: ProjectStatus
): ProjectStatus | null {
  const idx = PROJECT_STATUS_ORDER.indexOf(current);
  return idx < PROJECT_STATUS_ORDER.length - 1
    ? PROJECT_STATUS_ORDER[idx + 1]
    : null;
}

export function previousProjectStatus(
  current: ProjectStatus
): ProjectStatus | null {
  const idx = PROJECT_STATUS_ORDER.indexOf(current);
  return idx > 0 ? PROJECT_STATUS_ORDER[idx - 1] : null;
}

export function nextTaskStatus(current: TaskStatus): TaskStatus | null {
  const idx = TASK_STATUS_ORDER.indexOf(current);
  return idx < TASK_STATUS_ORDER.length - 1
    ? TASK_STATUS_ORDER[idx + 1]
    : null;
}

export function previousTaskStatus(current: TaskStatus): TaskStatus | null {
  const idx = TASK_STATUS_ORDER.indexOf(current);
  return idx > 0 ? TASK_STATUS_ORDER[idx - 1] : null;
}

export function isActiveProjectStatus(status: ProjectStatus): boolean {
  return (
    status !== ProjectStatus.Completed &&
    status !== ProjectStatus.Closed &&
    status !== ProjectStatus.Archived
  );
}

export function isCompletedProjectStatus(status: ProjectStatus): boolean {
  return (
    status === ProjectStatus.Completed ||
    status === ProjectStatus.Closed ||
    status === ProjectStatus.Archived
  );
}

// ─── Subscription Helpers ─────────────────────────────────────────────────────

export function subscriptionAllowsAccess(status: SubscriptionStatus): boolean {
  return (
    status === SubscriptionStatus.Trial ||
    status === SubscriptionStatus.Active ||
    status === SubscriptionStatus.Grace
  );
}

export function subscriptionShowsWarning(status: SubscriptionStatus): boolean {
  return (
    status === SubscriptionStatus.Grace ||
    status === SubscriptionStatus.Expired ||
    status === SubscriptionStatus.Cancelled
  );
}

export interface SubscriptionPlanInfo {
  displayName: string;
  maxSeats: number;
  monthlyPrice: number;
  annualPrice: number;
}

export const SUBSCRIPTION_PLAN_INFO: Record<SubscriptionPlan, SubscriptionPlanInfo> = {
  [SubscriptionPlan.Trial]: {
    displayName: "Free Trial",
    maxSeats: 5,
    monthlyPrice: 0,
    annualPrice: 0,
  },
  [SubscriptionPlan.Starter]: {
    displayName: "Starter",
    maxSeats: 5,
    monthlyPrice: 49,
    annualPrice: 470,
  },
  [SubscriptionPlan.Team]: {
    displayName: "Team",
    maxSeats: 15,
    monthlyPrice: 99,
    annualPrice: 950,
  },
  [SubscriptionPlan.Business]: {
    displayName: "Business",
    maxSeats: 50,
    monthlyPrice: 199,
    annualPrice: 1910,
  },
};

// ─── Entity Interfaces ────────────────────────────────────────────────────────

/** Project entity - matches iOS Project model */
export interface Project {
  id: string;
  title: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  startDate: Date | null;
  endDate: Date | null;
  duration: number | null;
  status: ProjectStatus;
  notes: string | null;
  companyId: string;
  clientId: string | null;
  opportunityId: string | null;
  allDay: boolean;
  teamMemberIds: string[];
  projectDescription: string | null;
  projectImages: string[];
  lastSyncedAt: Date | null;
  needsSync: boolean;
  syncPriority: number;
  deletedAt: Date | null;

  // Relationships (loaded separately)
  client?: Client | null;
  tasks?: ProjectTask[];
  teamMembers?: User[];
}

/** ProjectTask entity - matches iOS ProjectTask model */
export interface ProjectTask {
  id: string;
  projectId: string;
  calendarEventId: string | null;
  companyId: string;
  status: TaskStatus;
  taskColor: string;
  taskNotes: string | null;
  taskTypeId: string;
  taskIndex: number | null;
  displayOrder: number;
  customTitle: string | null;
  sourceLineItemId: string | null;
  sourceEstimateId: string | null;
  teamMemberIds: string[];
  lastSyncedAt: Date | null;
  needsSync: boolean;
  deletedAt: Date | null;

  // Relationships (loaded separately)
  project?: Project | null;
  calendarEvent?: CalendarEvent | null;
  taskType?: TaskType | null;
  teamMembers?: User[];
}

/** CalendarEvent entity - matches iOS CalendarEvent model */
export interface CalendarEvent {
  id: string;
  color: string;
  companyId: string;
  projectId: string;
  taskId: string | null;
  duration: number;
  endDate: Date | null;
  startDate: Date | null;
  title: string;
  teamMemberIds: string[];
  eventType: string;
  opportunityId: string | null;
  siteVisitId: string | null;
  lastSyncedAt: Date | null;
  needsSync: boolean;
  deletedAt: Date | null;

  // Relationships (loaded separately)
  project?: Project | null;
  task?: ProjectTask | null;
  teamMembers?: User[];
}

/** TaskType entity - matches iOS TaskType model */
export interface TaskType {
  id: string;
  color: string;
  display: string;
  icon: string | null;
  isDefault: boolean;
  companyId: string;
  displayOrder: number;
  defaultTeamMemberIds: string[];
  lastSyncedAt: Date | null;
  needsSync: boolean;
  deletedAt: Date | null;
}

/** Client entity - matches iOS Client model */
export interface Client {
  id: string;
  name: string;
  email: string | null;
  phoneNumber: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  profileImageURL: string | null;
  notes: string | null;
  companyId: string | null;
  lastSyncedAt: Date | null;
  needsSync: boolean;
  createdAt: Date | null;
  deletedAt: Date | null;

  // Relationships (loaded separately)
  projects?: Project[];
  subClients?: SubClient[];
}

/** SubClient entity - matches iOS SubClient model */
export interface SubClient {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phoneNumber: string | null;
  address: string | null;
  clientId: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastSyncedAt: Date | null;
  needsSync: boolean;
  deletedAt: Date | null;
}

/** User entity - matches iOS User model */
export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  profileImageURL: string | null;
  role: UserRole;
  companyId: string | null;
  userType: UserType | null;
  latitude: number | null;
  longitude: number | null;
  locationName: string | null;
  homeAddress: string | null;
  clientId: string | null;
  isActive: boolean | null;
  userColor: string | null;
  devPermission: boolean;
  hasCompletedAppOnboarding: boolean;
  hasCompletedAppTutorial: boolean;
  isCompanyAdmin: boolean;
  stripeCustomerId: string | null;
  deviceToken: string | null;
  lastSyncedAt: Date | null;
  needsSync: boolean;
  deletedAt: Date | null;
}

/** Company entity - matches iOS Company model */
export interface Company {
  id: string;
  name: string;
  logoURL: string | null;
  externalId: string | null;
  companyDescription: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  latitude: number | null;
  longitude: number | null;
  openHour: string | null;
  closeHour: string | null;
  industries: string[];
  companySize: string | null;
  companyAge: string | null;
  referralMethod: string | null;
  projectIds: string[];
  teamIds: string[];
  adminIds: string[];
  accountHolderId: string | null;
  defaultProjectColor: string;
  teamMembersSynced: boolean;
  subscriptionStatus: SubscriptionStatus | null;
  subscriptionPlan: SubscriptionPlan | null;
  subscriptionEnd: Date | null;
  subscriptionPeriod: PaymentSchedule | null;
  maxSeats: number;
  seatedEmployeeIds: string[];
  seatGraceStartDate: Date | null;
  trialStartDate: Date | null;
  trialEndDate: Date | null;
  hasPrioritySupport: boolean;
  dataSetupPurchased: boolean;
  dataSetupCompleted: boolean;
  dataSetupScheduledDate: Date | null;
  stripeCustomerId: string | null;
  lastSyncedAt: Date | null;
  needsSync: boolean;
  deletedAt: Date | null;

  // Relationships (loaded separately)
  teamMembers?: TeamMember[];
  taskTypes?: TaskType[];
}

/** TeamMember entity - lightweight user reference within a company */
export interface TeamMember {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  profileImageURL: string | null;
  role: UserRole;
  userColor: string | null;
  isActive: boolean;
}

/** OpsContact entity - OPS support contact */
export interface OpsContact {
  id: string;
  email: string;
  name: string;
  phone: string;
  display: string;
  role: OpsContactRole;
  lastSynced: Date;
}

// ─── Computed Property Helpers ────────────────────────────────────────────────

/** Get full name for a User */
export function getUserFullName(user: Pick<User, "firstName" | "lastName">): string {
  return `${user.firstName} ${user.lastName}`.trim() || "Unknown User";
}

/** Get full name for a TeamMember */
export function getTeamMemberFullName(
  member: Pick<TeamMember, "firstName" | "lastName">
): string {
  return `${member.firstName} ${member.lastName}`.trim() || "Unknown";
}

/** Get display name for a client */
export function getClientDisplayName(client: Pick<Client, "name">): string {
  return client.name || "Unknown Client";
}

/** Check if client has any contact info */
export function clientHasContactInfo(
  client: Pick<Client, "email" | "phoneNumber" | "address">
): boolean {
  return !!(client.email || client.phoneNumber || client.address);
}

/** Get display title for a task */
export function getTaskDisplayTitle(
  task: Pick<ProjectTask, "customTitle">,
  taskType?: TaskType | null
): string {
  return task.customTitle || taskType?.display || "Task";
}

/** Get effective color for a task */
export function getTaskEffectiveColor(
  task: Pick<ProjectTask, "taskColor">,
  taskType?: TaskType | null
): string {
  return taskType?.color || task.taskColor || "#59779F";
}

/** Get scheduled date for a task (from its calendar event) */
export function getTaskScheduledDate(
  calendarEvent?: CalendarEvent | null
): Date | null {
  return calendarEvent?.startDate ?? null;
}

/** Check if a task is overdue */
export function isTaskOverdue(
  task: Pick<ProjectTask, "status">,
  calendarEvent?: CalendarEvent | null
): boolean {
  if (
    task.status === TaskStatus.Completed ||
    task.status === TaskStatus.Cancelled
  ) {
    return false;
  }
  const scheduledDate = calendarEvent?.startDate;
  if (!scheduledDate) return false;
  return new Date() > scheduledDate;
}

/** Check if a task is today */
export function isTaskToday(calendarEvent?: CalendarEvent | null): boolean {
  const scheduledDate = calendarEvent?.startDate;
  if (!scheduledDate) return false;
  const today = new Date();
  return (
    scheduledDate.getFullYear() === today.getFullYear() &&
    scheduledDate.getMonth() === today.getMonth() &&
    scheduledDate.getDate() === today.getDate()
  );
}

/** Get the effective client name from a project */
export function getProjectClientName(
  project: Pick<Project, "title">,
  client?: Client | null
): string {
  return client?.name || "No Client";
}

/** Calculate effective end date (endDate or startDate + duration) */
export function getProjectEffectiveEndDate(
  project: Pick<Project, "startDate" | "endDate" | "duration">
): Date | null {
  if (project.endDate) return project.endDate;
  if (project.startDate && project.duration) {
    const end = new Date(project.startDate);
    end.setDate(end.getDate() + project.duration);
    return end;
  }
  return null;
}

/** Check if project is multi-day */
export function isProjectMultiDay(
  project: Pick<Project, "startDate" | "endDate" | "duration">
): boolean {
  const effectiveEnd = getProjectEffectiveEndDate(project);
  if (!project.startDate || !effectiveEnd) return false;
  return project.startDate.toDateString() !== effectiveEnd.toDateString();
}

/** Get all dates a project spans */
export function getProjectSpannedDates(
  project: Pick<Project, "startDate" | "endDate" | "duration">
): Date[] {
  if (!project.startDate) return [];
  const effectiveEnd = getProjectEffectiveEndDate(project);
  if (!effectiveEnd) return [project.startDate];

  const dates: Date[] = [];
  const current = new Date(project.startDate);
  while (current <= effectiveEnd) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

/** Get computed project status from its task statuses */
export function getProjectComputedStatus(tasks: ProjectTask[]): ProjectStatus {
  if (tasks.length === 0) return ProjectStatus.RFQ;

  const activeTasks = tasks.filter(
    (t) =>
      t.status !== TaskStatus.Cancelled && t.deletedAt === null
  );
  if (activeTasks.length === 0) return ProjectStatus.RFQ;

  const allCompleted = activeTasks.every(
    (t) => t.status === TaskStatus.Completed
  );
  if (allCompleted) return ProjectStatus.Completed;

  const anyInProgress = activeTasks.some(
    (t) => t.status === TaskStatus.InProgress
  );
  if (anyInProgress) return ProjectStatus.InProgress;

  return ProjectStatus.Accepted;
}

/** SubClient display name */
export function getSubClientDisplayName(
  subClient: Pick<SubClient, "name" | "title">
): string {
  if (subClient.title) {
    return `${subClient.name} - ${subClient.title}`;
  }
  return subClient.name;
}

/** Get initials from a name */
export function getInitials(name: string): string {
  return name
    .split(" ")
    .filter((part) => part.length > 0)
    .map((part) => part[0].toUpperCase())
    .slice(0, 2)
    .join("");
}

/** SubClient initials */
export function getSubClientInitials(
  subClient: Pick<SubClient, "name">
): string {
  return getInitials(subClient.name);
}

/** User role display name */
export function getUserRoleDisplay(role: UserRole): string {
  switch (role) {
    case UserRole.Admin:
      return "Admin";
    case UserRole.OfficeCrew:
      return "Office Crew";
    case UserRole.FieldCrew:
      return "Field Crew";
    default:
      return "Field Crew";
  }
}

/** User type display name */
export function getUserTypeDisplay(type: UserType): string {
  switch (type) {
    case UserType.Company:
      return "Business Owner";
    case UserType.Employee:
      return "Employee";
    default:
      return "Employee";
  }
}

// ─── Comma-Separated String Helpers ───────────────────────────────────────────

/** Parse comma-separated IDs into array */
export function parseCommaSeparatedIds(value: string): string[] {
  if (!value || value.trim() === "") return [];
  return value
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

/** Convert array of IDs to comma-separated string */
export function toCommaSeparatedString(ids: string[]): string {
  return ids.filter((id) => id.length > 0).join(",");
}

/** Get team member IDs from comma-separated string */
export function getTeamMemberIds(teamMemberIdsString: string): string[] {
  return parseCommaSeparatedIds(teamMemberIdsString);
}

/** Set team member IDs as comma-separated string */
export function setTeamMemberIds(ids: string[]): string {
  return toCommaSeparatedString(ids);
}

/** Get project IDs from comma-separated string */
export function getProjectIds(projectIdsString: string): string[] {
  return parseCommaSeparatedIds(projectIdsString);
}

/** Get admin IDs from comma-separated string */
export function getAdminIds(adminIdsString: string): string[] {
  return parseCommaSeparatedIds(adminIdsString);
}

/** Get seated employee IDs from comma-separated string */
export function getSeatedEmployeeIds(seatedEmployeeIdsString: string): string[] {
  return parseCommaSeparatedIds(seatedEmployeeIdsString);
}

// ─── Company Subscription Helpers ─────────────────────────────────────────────

export function isSubscriptionActive(company: Pick<Company, "subscriptionStatus">): boolean {
  if (!company.subscriptionStatus) return false;
  return subscriptionAllowsAccess(company.subscriptionStatus);
}

export function shouldShowGracePeriodWarning(
  company: Pick<Company, "subscriptionStatus">
): boolean {
  return company.subscriptionStatus === SubscriptionStatus.Grace;
}

export function getDaysRemainingInTrial(
  company: Pick<Company, "trialEndDate">
): number {
  if (!company.trialEndDate) return 0;
  const now = new Date();
  const diffMs = company.trialEndDate.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

export function getDaysRemainingInGracePeriod(
  company: Pick<Company, "seatGraceStartDate">,
  gracePeriodDays: number = 14
): number {
  if (!company.seatGraceStartDate) return 0;
  const graceEnd = new Date(company.seatGraceStartDate);
  graceEnd.setDate(graceEnd.getDate() + gracePeriodDays);
  const now = new Date();
  const diffMs = graceEnd.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

export function hasAvailableSeats(
  company: Pick<Company, "seatedEmployeeIds" | "maxSeats">
): boolean {
  return company.seatedEmployeeIds.length < company.maxSeats;
}

// ─── Default Task Types ───────────────────────────────────────────────────────

export interface DefaultTaskType {
  display: string;
  color: string;
  icon: string;
}

export const DEFAULT_TASK_TYPES: DefaultTaskType[] = [
  { display: "Quote", color: "#B5A381", icon: "FileText" },
  { display: "Installation", color: "#8195B5", icon: "Wrench" },
  { display: "Repair", color: "#B58289", icon: "Settings" },
  { display: "Inspection", color: "#9DB582", icon: "Search" },
  { display: "Consultation", color: "#A182B5", icon: "MessageSquare" },
  { display: "Follow-up", color: "#C4A868", icon: "PhoneCall" },
];

// ─── Role Detection ───────────────────────────────────────────────────────────

/**
 * Detect user role using iOS priority logic:
 * 1. user.id IN company.adminIds[] -> Admin
 * 2. user.employeeType -> mapped role
 * 3. default -> FieldCrew
 */
export function detectUserRole(
  userId: string,
  companyAdminIds: string[],
  employeeType?: string | null
): UserRole {
  // Priority 1: Check if user is in company admin list
  if (companyAdminIds.includes(userId)) {
    return UserRole.Admin;
  }

  // Priority 2: Map from employee type
  if (employeeType) {
    switch (employeeType) {
      case "Office Crew":
        return UserRole.OfficeCrew;
      case "Field Crew":
        return UserRole.FieldCrew;
      case "Admin":
        return UserRole.Admin;
    }
  }

  // Priority 3: Default to field crew
  return UserRole.FieldCrew;
}

// ─── Utility Types ────────────────────────────────────────────────────────────

/** Create type - omits server-generated fields */
export type CreateProject = Omit<
  Project,
  | "id"
  | "lastSyncedAt"
  | "needsSync"
  | "syncPriority"
  | "deletedAt"
  | "client"
  | "tasks"
  | "teamMembers"
>;

export type CreateTask = Omit<
  ProjectTask,
  | "id"
  | "lastSyncedAt"
  | "needsSync"
  | "deletedAt"
  | "project"
  | "calendarEvent"
  | "taskType"
  | "teamMembers"
>;

export type CreateClient = Omit<
  Client,
  | "id"
  | "lastSyncedAt"
  | "needsSync"
  | "createdAt"
  | "deletedAt"
  | "projects"
  | "subClients"
>;

export type CreateSubClient = Omit<
  SubClient,
  "id" | "lastSyncedAt" | "needsSync" | "createdAt" | "updatedAt" | "deletedAt"
>;

export type CreateCalendarEvent = Omit<
  CalendarEvent,
  | "id"
  | "lastSyncedAt"
  | "needsSync"
  | "deletedAt"
  | "project"
  | "task"
  | "teamMembers"
>;

export type CreateTaskType = Omit<
  TaskType,
  "id" | "lastSyncedAt" | "needsSync" | "deletedAt"
>;

/** Update type - all fields optional except id */
export type UpdateProject = Partial<CreateProject> & { id: string };
export type UpdateTask = Partial<CreateTask> & { id: string };
export type UpdateClient = Partial<CreateClient> & { id: string };
export type UpdateSubClient = Partial<CreateSubClient> & { id: string };
export type UpdateCalendarEvent = Partial<CreateCalendarEvent> & { id: string };
export type UpdateTaskType = Partial<CreateTaskType> & { id: string };

/** Soft-deletable entities */
export type SoftDeletable = {
  deletedAt: Date | null;
};

/** Filter out soft-deleted items */
export function filterDeleted<T extends SoftDeletable>(items: T[]): T[] {
  return items.filter((item) => item.deletedAt === null);
}

/** Syncable entities */
export type Syncable = {
  lastSyncedAt: Date | null;
  needsSync: boolean;
};

// ─── Financial types moved to pipeline.ts ────────────────────────────────────
// All financial enums, interfaces, and helpers (EstimateStatus, InvoiceStatus,
// Product, Estimate, Invoice, LineItem, Payment, AccountingConnection, etc.)
// are now imported from "@/lib/types/pipeline".
