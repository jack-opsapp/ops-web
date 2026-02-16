/**
 * BubbleFields Constants
 *
 * Exact field mappings from Bubble.io to TypeScript.
 * These MUST be byte-identical to the iOS BubbleFields.swift constants.
 * Any mismatch will cause API queries to fail silently.
 */

// ─── Entity Type Names ────────────────────────────────────────────────────────

export const BubbleTypes = {
  client: "Client",
  company: "Company",
  project: "Project",
  user: "User",
  subClient: "Sub Client", // Note the space - Bubble uses "Sub Client"
  task: "Task",
  taskType: "TaskType",
  calendarEvent: "calendarevent", // Bubble uses lowercase
} as const;

// ─── Job Status Values ────────────────────────────────────────────────────────

export const BubbleJobStatus = {
  rfq: "RFQ",
  estimated: "Estimated",
  accepted: "Accepted",
  inProgress: "In Progress",
  completed: "Completed",
  closed: "Closed",
  archived: "Archived",
} as const;

// ─── Task Status Values ───────────────────────────────────────────────────────

export const BubbleTaskStatus = {
  booked: "Booked",
  inProgress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
} as const;

// ─── Employee Type Values ─────────────────────────────────────────────────────

export const BubbleEmployeeType = {
  officeCrew: "Office Crew",
  fieldCrew: "Field Crew",
  admin: "Admin",
} as const;

// ─── User Type Values ─────────────────────────────────────────────────────────

export const BubbleUserType = {
  company: "Company",
  employee: "Employee",
  client: "Client",
  admin: "Admin",
} as const;

// ─── Project Field Names ──────────────────────────────────────────────────────

export const BubbleProjectFields = {
  id: "_id",
  address: "address",
  allDay: "allDay",
  calendarEvent: "calendarEvent",
  client: "client",
  company: "company",
  completion: "completion",
  description: "description",
  eventType: "eventType", // legacy
  projectName: "projectName",
  startDate: "startDate",
  status: "status",
  teamMembers: "teamMembers", // legacy - computed from tasks
  teamNotes: "teamNotes",
  clientName: "clientName",
  tasks: "tasks",
  projectImages: "projectImages",
  duration: "duration",
  deletedAt: "deletedAt",
} as const;

// ─── Task Field Names ─────────────────────────────────────────────────────────

export const BubbleTaskFields = {
  id: "_id",
  calendarEventId: "calendarEventId",
  companyId: "companyId",
  completionDate: "completionDate",
  projectId: "projectId", // lowercase 'Id'
  scheduledDate: "scheduledDate",
  status: "status",
  taskColor: "taskColor",
  taskIndex: "taskIndex",
  taskNotes: "taskNotes",
  teamMembers: "teamMembers",
  type: "type", // TaskType ID
  deletedAt: "deletedAt",
} as const;

// ─── CalendarEvent Field Names ────────────────────────────────────────────────

export const BubbleCalendarEventFields = {
  id: "_id",
  active: "active", // legacy
  color: "color",
  companyId: "companyId", // lowercase 'c'
  duration: "duration",
  endDate: "endDate",
  projectId: "projectId", // lowercase 'p'
  startDate: "startDate",
  taskId: "taskId", // lowercase 't'
  teamMembers: "teamMembers",
  title: "title",
  eventType: "eventType", // legacy
  deletedAt: "deletedAt",
} as const;

// ─── User Field Names ─────────────────────────────────────────────────────────

export const BubbleUserFields = {
  id: "_id",
  clientId: "clientId",
  company: "company",
  currentLocation: "currentLocation",
  employeeType: "employeeType",
  nameFirst: "nameFirst",
  nameLast: "nameLast",
  userType: "userType",
  avatar: "avatar",
  profileImageURL: "profileImageURL",
  email: "email",
  phone: "phone",
  homeAddress: "homeAddress",
  deviceToken: "deviceToken",
  hasCompletedAppTutorial: "hasCompletedAppTutorial",
  deletedAt: "deletedAt",
} as const;

// ─── Company Field Names ──────────────────────────────────────────────────────

export const BubbleCompanyFields = {
  id: "_id",
  companyName: "companyName",
  companyId: "companyId",
  location: "location",
  logo: "logo",
  logoURL: "logoURL", // legacy/alternative
  defaultProjectColor: "defaultProjectColor",
  projects: "projects",
  teams: "teams",
  clients: "clients",
  taskTypes: "taskTypes",
  calendarEventsList: "calendarEventsList",
  admin: "admin",
  seatedEmployees: "seatedEmployees",
  subscriptionStatus: "subscriptionStatus",
  subscriptionPlan: "subscriptionPlan",
  deletedAt: "deletedAt",
} as const;

// ─── Client Field Names ───────────────────────────────────────────────────────

export const BubbleClientFields = {
  id: "_id",
  address: "address",
  balance: "balance",
  clientIdNo: "clientIdNo",
  subClients: "subClients",
  emailAddress: "emailAddress",
  estimates: "estimates",
  invoices: "invoices",
  isCompany: "isCompany",
  name: "name",
  parentCompany: "parentCompany",
  phoneNumber: "phoneNumber",
  projectsList: "projectsList",
  status: "status",
  avatar: "avatar",
  unit: "unit",
  userId: "userId",
  notes: "notes",
  deletedAt: "deletedAt",
} as const;

// ─── SubClient Field Names ────────────────────────────────────────────────────

export const BubbleSubClientFields = {
  id: "_id",
  address: "address",
  emailAddress: "emailAddress",
  name: "name",
  parentClient: "parentClient",
  phoneNumber: "phoneNumber",
  title: "title",
  deletedAt: "deletedAt",
} as const;

// ─── TaskType Field Names ─────────────────────────────────────────────────────

export const BubbleTaskTypeFields = {
  id: "_id",
  color: "color",
  display: "display",
  isDefault: "isDefault",
  deletedAt: "deletedAt",
} as const;

// ─── TaskStatusOption Field Names ─────────────────────────────────────────────

export const BubbleTaskStatusOptionFields = {
  id: "_id",
  display: "Display",
  company: "company",
  color: "color",
  index: "index",
} as const;

// ─── Bubble API Paths ─────────────────────────────────────────────────────────

export const BubbleApiPaths = {
  dataApi: (objectType: string) => `/obj/${objectType.toLowerCase()}`,
  dataApiById: (objectType: string, id: string) =>
    `/obj/${objectType.toLowerCase()}/${id}`,
  workflowApi: (workflowName: string) => `/wf/${workflowName}`,
} as const;

// ─── Bubble Constraint Types ──────────────────────────────────────────────────

export const BubbleConstraintType = {
  equals: "equals",
  notEqual: "not equal",
  isEmpty: "is_empty",
  isNotEmpty: "is_not_empty",
  textContains: "text contains",
  greaterThan: "greater than",
  lessThan: "less than",
  in: "in",
  notIn: "not in",
  contains: "contains",
  notContains: "not contains",
} as const;

// ─── Helper: Map legacy "Scheduled" to "Booked" ──────────────────────────────

export function normalizeTaskStatus(status: string): string {
  if (status === "Scheduled") {
    return BubbleTaskStatus.booked;
  }
  return status;
}

// ─── Helper: Map Bubble employee type to role ─────────────────────────────────

export function employeeTypeToRole(
  employeeType: string | null | undefined
): "admin" | "officeCrew" | "fieldCrew" {
  switch (employeeType) {
    case BubbleEmployeeType.officeCrew:
      return "officeCrew";
    case BubbleEmployeeType.fieldCrew:
      return "fieldCrew";
    case BubbleEmployeeType.admin:
      return "admin";
    default:
      return "fieldCrew";
  }
}

// ─── Helper: Map Bubble job status string to enum key ─────────────────────────

export function jobStatusToEnum(
  bubbleStatus: string
): keyof typeof BubbleJobStatus {
  switch (bubbleStatus) {
    case BubbleJobStatus.rfq:
      return "rfq";
    case BubbleJobStatus.estimated:
      return "estimated";
    case BubbleJobStatus.accepted:
      return "accepted";
    case BubbleJobStatus.inProgress:
      return "inProgress";
    case BubbleJobStatus.completed:
      return "completed";
    case BubbleJobStatus.closed:
      return "closed";
    case BubbleJobStatus.archived:
      return "archived";
    default:
      return "rfq";
  }
}

// ─── Bubble Constraint Builder ────────────────────────────────────────────────

export interface BubbleConstraint {
  key: string;
  constraint_type: string;
  value?: string | number | boolean | string[];
}

export function buildConstraints(
  constraints: BubbleConstraint[]
): string {
  return JSON.stringify(constraints);
}

export function companyConstraint(companyId: string): BubbleConstraint {
  return {
    key: "company",
    constraint_type: BubbleConstraintType.equals,
    value: companyId,
  };
}

export function notDeletedConstraint(): BubbleConstraint {
  return {
    key: "deletedAt",
    constraint_type: BubbleConstraintType.isEmpty,
  };
}
