/**
 * Tests for DTO -> Model Conversion
 *
 * Tests the conversion logic from raw Bubble.io DTOs to application models.
 * Covers field mapping, status normalization, role detection, data validation,
 * and edge cases in the Bubble response format.
 *
 * NOTE: These tests define the expected API for src/lib/converters/ which
 * will be created as part of the web app build-out. The conversion functions
 * are implemented inline here to validate the test logic and serve as a
 * specification for the real implementations.
 */

import { describe, it, expect } from "vitest";
import {
  mockProject,
  mockTask,
  mockCalendarEvent,
  mockUser,
  mockCompany,
  mockClient,
  mockSubClient,
  type ProjectDTO,
  type TaskDTO,
  type CalendarEventDTO,
  type UserDTO,
  type CompanyDTO,
  type ClientDTO,
  type SubClientDTO,
} from "../../mocks/data";

// ─── Inline Conversion Functions (specification for real module) ─────────────

interface ProjectModel {
  id: string;
  name: string;
  address: string;
  clientId: string;
  clientName: string;
  companyId: string;
  status: string;
  startDate: Date | null;
  completion: number;
  description: string;
  teamNotes: string;
  taskIds: string[];
  calendarEventIds: string[];
  imageUrls: string[];
  allDay: boolean;
  duration: number;
  deletedAt: Date | null;
}

function projectDtoToModel(dto: ProjectDTO): ProjectModel {
  return {
    id: dto._id,
    name: dto.projectName,
    address: dto.address || "",
    clientId: dto.client || "",
    clientName: dto.clientName || "",
    companyId: dto.company,
    status: dto.status,
    startDate: dto.startDate ? new Date(dto.startDate) : null,
    completion: dto.completion || 0,
    description: dto.description || "",
    teamNotes: dto.teamNotes || "",
    taskIds: dto.tasks || [],
    calendarEventIds: dto.calendarEvent || [],
    imageUrls: dto.projectImages || [],
    allDay: dto.allDay ?? true,
    duration: dto.duration || 0,
    deletedAt: dto.deletedAt ? new Date(dto.deletedAt) : null,
  };
}

interface TaskModel {
  id: string;
  calendarEventId: string;
  companyId: string;
  completionDate: Date | null;
  projectId: string;
  scheduledDate: Date | null;
  status: string;
  color: string;
  taskIndex: number;
  notes: string;
  teamMemberIds: string[];
  taskTypeId: string;
  deletedAt: Date | null;
}

function normalizeTaskStatus(status: string): string {
  if (status === "Scheduled") return "Booked";
  return status;
}

function normalizeColor(color: string): string {
  if (!color) return "#417394";
  if (color.startsWith("#")) return color;
  // Add # prefix if missing
  if (/^[0-9a-fA-F]{6}$/.test(color)) return `#${color}`;
  if (/^[0-9a-fA-F]{3}$/.test(color)) return `#${color}`;
  return color;
}

function taskDtoToModel(dto: TaskDTO): TaskModel {
  return {
    id: dto._id,
    calendarEventId: dto.calendarEventId || "",
    companyId: dto.companyId,
    completionDate: dto.completionDate ? new Date(dto.completionDate) : null,
    projectId: dto.projectId,
    scheduledDate: dto.scheduledDate ? new Date(dto.scheduledDate) : null,
    status: normalizeTaskStatus(dto.status),
    color: normalizeColor(dto.taskColor),
    taskIndex: dto.taskIndex ?? 0,
    notes: dto.taskNotes || "",
    teamMemberIds: dto.teamMembers || [],
    taskTypeId: dto.type || "",
    deletedAt: dto.deletedAt ? new Date(dto.deletedAt) : null,
  };
}

interface CalendarEventModel {
  id: string;
  color: string;
  companyId: string;
  duration: number;
  endDate: Date;
  projectId: string;
  startDate: Date;
  taskId: string;
  teamMemberIds: string[];
  title: string;
  deletedAt: Date | null;
}

function calendarEventDtoToModel(
  dto: CalendarEventDTO
): CalendarEventModel | null {
  // Validate required fields
  if (!dto._id || !dto.startDate || !dto.endDate) {
    return null;
  }

  const startDate = new Date(dto.startDate);
  const endDate = new Date(dto.endDate);

  // Validate date order
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return null;
  }

  // If end is before start, swap them
  const effectiveStart = endDate < startDate ? endDate : startDate;
  const effectiveEnd = endDate < startDate ? startDate : endDate;

  return {
    id: dto._id,
    color: normalizeColor(dto.color),
    companyId: dto.companyId,
    duration: dto.duration || 1,
    endDate: effectiveEnd,
    projectId: dto.projectId || "",
    startDate: effectiveStart,
    taskId: dto.taskId || "",
    teamMemberIds: dto.teamMembers || [],
    title: dto.title || "Untitled Event",
    deletedAt: dto.deletedAt ? new Date(dto.deletedAt) : null,
  };
}

type UserRole = "admin" | "officeCrew" | "fieldCrew";

interface UserModel {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  companyId: string;
  role: UserRole;
  userType: string;
  avatarUrl: string;
  isAdmin: boolean;
  deletedAt: Date | null;
}

function detectUserRole(
  dto: UserDTO,
  companyAdminIds?: string[]
): UserRole {
  // CRITICAL: Check company admin IDs FIRST
  if (companyAdminIds && companyAdminIds.includes(dto._id)) {
    return "admin";
  }
  // Then fall back to employeeType
  switch (dto.employeeType) {
    case "Admin":
      return "admin";
    case "Office Crew":
      return "officeCrew";
    case "Field Crew":
      return "fieldCrew";
    default:
      return "fieldCrew";
  }
}

function userDtoToModel(
  dto: UserDTO,
  companyAdminIds?: string[]
): UserModel {
  const role = detectUserRole(dto, companyAdminIds);
  return {
    id: dto._id,
    firstName: dto.nameFirst || "",
    lastName: dto.nameLast || "",
    email: dto.email || "",
    phone: dto.phone || "",
    companyId: dto.company || "",
    role,
    userType: dto.userType || "Employee",
    avatarUrl: dto.profileImageURL || dto.avatar || "",
    isAdmin: role === "admin",
    deletedAt: dto.deletedAt ? new Date(dto.deletedAt) : null,
  };
}

interface CompanyModel {
  id: string;
  name: string;
  externalId: string;
  location: string;
  logoUrl: string;
  defaultProjectColor: string;
  adminIds: string[];
  subscriptionStatus: string;
  subscriptionPlan: string;
  deletedAt: Date | null;
}

function companyDtoToModel(dto: CompanyDTO): CompanyModel {
  return {
    id: dto._id,
    name: dto.companyName || "",
    externalId: dto.companyId || "",
    location: dto.location || "",
    logoUrl: dto.logoURL || dto.logo || "",
    defaultProjectColor: dto.defaultProjectColor || "#9CA3AF",
    adminIds: dto.admin || [],
    subscriptionStatus: (dto.subscriptionStatus || "").toLowerCase(),
    subscriptionPlan: (dto.subscriptionPlan || "").toLowerCase(),
    deletedAt: dto.deletedAt ? new Date(dto.deletedAt) : null,
  };
}

interface SubClientModel {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  parentClientId: string;
  title: string;
}

function subClientDtoToModel(dto: SubClientDTO): SubClientModel {
  // Phone can be string or number type from Bubble
  const phone = typeof dto.phoneNumber === "number"
    ? String(dto.phoneNumber)
    : dto.phoneNumber || "";

  return {
    id: dto._id,
    name: dto.name || "",
    email: dto.emailAddress || "",
    phone,
    address: dto.address || "",
    parentClientId: dto.parentClient || "",
    title: dto.title || "",
  };
}

// ─── ProjectDTO.toModel() ───────────────────────────────────────────────────

describe("ProjectDTO -> Model conversion", () => {
  it("maps _id to id", () => {
    const dto = mockProject({ _id: "proj-abc-123" });
    const model = projectDtoToModel(dto);
    expect(model.id).toBe("proj-abc-123");
  });

  it("maps projectName to name", () => {
    const dto = mockProject({ projectName: "Kitchen Renovation" });
    const model = projectDtoToModel(dto);
    expect(model.name).toBe("Kitchen Renovation");
  });

  it("maps address directly", () => {
    const dto = mockProject({ address: "1425 Oak Valley Dr, Austin, TX" });
    const model = projectDtoToModel(dto);
    expect(model.address).toBe("1425 Oak Valley Dr, Austin, TX");
  });

  it("maps client to clientId", () => {
    const dto = mockProject({ client: "cli-xyz" });
    const model = projectDtoToModel(dto);
    expect(model.clientId).toBe("cli-xyz");
  });

  it("maps clientName directly", () => {
    const dto = mockProject({ clientName: "John Smith" });
    const model = projectDtoToModel(dto);
    expect(model.clientName).toBe("John Smith");
  });

  it("maps company to companyId", () => {
    const dto = mockProject({ company: "comp-abc" });
    const model = projectDtoToModel(dto);
    expect(model.companyId).toBe("comp-abc");
  });

  it("parses startDate into a Date object", () => {
    const dateStr = "2025-06-15T10:30:00.000Z";
    const dto = mockProject({ startDate: dateStr });
    const model = projectDtoToModel(dto);
    expect(model.startDate).toBeInstanceOf(Date);
    expect(model.startDate!.toISOString()).toBe(dateStr);
  });

  it("maps completion as a number", () => {
    const dto = mockProject({ completion: 75 });
    const model = projectDtoToModel(dto);
    expect(model.completion).toBe(75);
  });

  it("maps tasks array to taskIds", () => {
    const dto = mockProject({ tasks: ["task-1", "task-2", "task-3"] });
    const model = projectDtoToModel(dto);
    expect(model.taskIds).toEqual(["task-1", "task-2", "task-3"]);
  });

  it("maps calendarEvent array to calendarEventIds", () => {
    const dto = mockProject({ calendarEvent: ["cal-1", "cal-2"] });
    const model = projectDtoToModel(dto);
    expect(model.calendarEventIds).toEqual(["cal-1", "cal-2"]);
  });

  it("maps projectImages to imageUrls", () => {
    const urls = ["https://s3.amazonaws.com/img1.jpg", "https://s3.amazonaws.com/img2.jpg"];
    const dto = mockProject({ projectImages: urls });
    const model = projectDtoToModel(dto);
    expect(model.imageUrls).toEqual(urls);
  });

  it("handles null deletedAt", () => {
    const dto = mockProject({ deletedAt: null });
    const model = projectDtoToModel(dto);
    expect(model.deletedAt).toBeNull();
  });

  it("parses deletedAt when present", () => {
    const dateStr = "2025-06-15T10:30:00.000Z";
    const dto = mockProject({ deletedAt: dateStr });
    const model = projectDtoToModel(dto);
    expect(model.deletedAt).toBeInstanceOf(Date);
  });
});

// ─── TaskDTO.toModel() ─────────────────────────────────────────────────────

describe("TaskDTO -> Model conversion", () => {
  it("maps all fields correctly", () => {
    const dto = mockTask({
      _id: "task-123",
      projectId: "proj-456",
      companyId: "comp-789",
      status: "Booked",
      taskColor: "#C4A868",
      taskIndex: 2,
      taskNotes: "Some notes",
      type: "tt-abc",
    });
    const model = taskDtoToModel(dto);
    expect(model.id).toBe("task-123");
    expect(model.projectId).toBe("proj-456");
    expect(model.companyId).toBe("comp-789");
    expect(model.status).toBe("Booked");
    expect(model.color).toBe("#C4A868");
    expect(model.taskIndex).toBe(2);
    expect(model.notes).toBe("Some notes");
    expect(model.taskTypeId).toBe("tt-abc");
  });

  it("converts 'Scheduled' status to 'Booked'", () => {
    const dto = mockTask({ status: "Scheduled" });
    const model = taskDtoToModel(dto);
    expect(model.status).toBe("Booked");
  });

  it("preserves 'Booked' status as-is", () => {
    const dto = mockTask({ status: "Booked" });
    const model = taskDtoToModel(dto);
    expect(model.status).toBe("Booked");
  });

  it("preserves 'In Progress' status", () => {
    const dto = mockTask({ status: "In Progress" });
    const model = taskDtoToModel(dto);
    expect(model.status).toBe("In Progress");
  });

  it("preserves 'Completed' status", () => {
    const dto = mockTask({ status: "Completed" });
    const model = taskDtoToModel(dto);
    expect(model.status).toBe("Completed");
  });

  it("adds # prefix to color when missing", () => {
    const dto = mockTask({ taskColor: "C4A868" });
    const model = taskDtoToModel(dto);
    expect(model.color).toBe("#C4A868");
  });

  it("preserves # prefix when already present", () => {
    const dto = mockTask({ taskColor: "#417394" });
    const model = taskDtoToModel(dto);
    expect(model.color).toBe("#417394");
  });

  it("handles 3-character hex color", () => {
    const dto = mockTask({ taskColor: "FFF" });
    const model = taskDtoToModel(dto);
    expect(model.color).toBe("#FFF");
  });

  it("uses default color when taskColor is empty", () => {
    const dto = mockTask({ taskColor: "" });
    const model = taskDtoToModel(dto);
    expect(model.color).toBe("#417394");
  });

  it("maps teamMembers to teamMemberIds", () => {
    const dto = mockTask({ teamMembers: ["user-1", "user-2"] });
    const model = taskDtoToModel(dto);
    expect(model.teamMemberIds).toEqual(["user-1", "user-2"]);
  });

  it("handles null completionDate", () => {
    const dto = mockTask({ completionDate: null });
    const model = taskDtoToModel(dto);
    expect(model.completionDate).toBeNull();
  });

  it("parses completionDate when present", () => {
    const dto = mockTask({ completionDate: "2025-06-20T16:00:00.000Z" });
    const model = taskDtoToModel(dto);
    expect(model.completionDate).toBeInstanceOf(Date);
  });
});

// ─── CalendarEventDTO.toModel() ─────────────────────────────────────────────

describe("CalendarEventDTO -> Model conversion", () => {
  it("maps all fields correctly", () => {
    const dto = mockCalendarEvent({
      _id: "cal-123",
      title: "Cabinet Installation",
      color: "#417394",
      companyId: "comp-abc",
      projectId: "proj-def",
      taskId: "task-ghi",
      duration: 2,
    });
    const model = calendarEventDtoToModel(dto)!;
    expect(model).not.toBeNull();
    expect(model.id).toBe("cal-123");
    expect(model.title).toBe("Cabinet Installation");
    expect(model.color).toBe("#417394");
    expect(model.companyId).toBe("comp-abc");
    expect(model.projectId).toBe("proj-def");
    expect(model.taskId).toBe("task-ghi");
    expect(model.duration).toBe(2);
  });

  it("validates date order (end >= start)", () => {
    const dto = mockCalendarEvent({
      startDate: "2025-06-15T08:00:00.000Z",
      endDate: "2025-06-17T17:00:00.000Z",
    });
    const model = calendarEventDtoToModel(dto)!;
    expect(model.startDate.getTime()).toBeLessThanOrEqual(model.endDate.getTime());
  });

  it("swaps dates when end is before start", () => {
    const dto = mockCalendarEvent({
      startDate: "2025-06-17T17:00:00.000Z",
      endDate: "2025-06-15T08:00:00.000Z",
    });
    const model = calendarEventDtoToModel(dto)!;
    expect(model.startDate.getTime()).toBeLessThan(model.endDate.getTime());
    expect(model.startDate.toISOString()).toBe("2025-06-15T08:00:00.000Z");
    expect(model.endDate.toISOString()).toBe("2025-06-17T17:00:00.000Z");
  });

  it("returns null for missing _id", () => {
    const dto = mockCalendarEvent({ _id: "" });
    const model = calendarEventDtoToModel(dto);
    expect(model).toBeNull();
  });

  it("returns null for missing startDate", () => {
    const dto = mockCalendarEvent();
    dto.startDate = "";
    const model = calendarEventDtoToModel(dto);
    expect(model).toBeNull();
  });

  it("returns null for missing endDate", () => {
    const dto = mockCalendarEvent();
    dto.endDate = "";
    const model = calendarEventDtoToModel(dto);
    expect(model).toBeNull();
  });

  it("returns null for invalid date strings", () => {
    const dto = mockCalendarEvent({
      startDate: "not-a-date",
      endDate: "also-not-a-date",
    });
    const model = calendarEventDtoToModel(dto);
    expect(model).toBeNull();
  });

  it("normalizes color with # prefix", () => {
    const dto = mockCalendarEvent({ color: "C4A868" });
    const model = calendarEventDtoToModel(dto)!;
    expect(model.color).toBe("#C4A868");
  });

  it("uses default title when empty", () => {
    const dto = mockCalendarEvent({ title: "" });
    const model = calendarEventDtoToModel(dto)!;
    expect(model.title).toBe("Untitled Event");
  });
});

// ─── UserDTO.toModel() with Admin Detection ────────────────────────────────

describe("UserDTO -> Model conversion", () => {
  describe("role detection with companyAdminIds", () => {
    it("detects admin when user ID is in companyAdminIds", () => {
      const dto = mockUser({
        _id: "user-admin-1",
        employeeType: "Field Crew", // Even as Field Crew, admin IDs take priority
      });
      const model = userDtoToModel(dto, ["user-admin-1", "user-admin-2"]);
      expect(model.role).toBe("admin");
      expect(model.isAdmin).toBe(true);
    });

    it("admin IDs take priority over employeeType", () => {
      const dto = mockUser({
        _id: "user-123",
        employeeType: "Field Crew",
      });
      const model = userDtoToModel(dto, ["user-123"]);
      expect(model.role).toBe("admin");
      expect(model.isAdmin).toBe(true);
    });

    it("non-admin user with admin check falls back to employeeType", () => {
      const dto = mockUser({
        _id: "user-456",
        employeeType: "Office Crew",
      });
      const model = userDtoToModel(dto, ["user-other"]);
      expect(model.role).toBe("officeCrew");
      expect(model.isAdmin).toBe(false);
    });
  });

  describe("role detection without companyAdminIds", () => {
    it("maps 'Admin' employeeType to admin role", () => {
      const dto = mockUser({ employeeType: "Admin" });
      const model = userDtoToModel(dto);
      expect(model.role).toBe("admin");
      expect(model.isAdmin).toBe(true);
    });

    it("maps 'Office Crew' employeeType to officeCrew role", () => {
      const dto = mockUser({ employeeType: "Office Crew" });
      const model = userDtoToModel(dto);
      expect(model.role).toBe("officeCrew");
      expect(model.isAdmin).toBe(false);
    });

    it("maps 'Field Crew' employeeType to fieldCrew role", () => {
      const dto = mockUser({ employeeType: "Field Crew" });
      const model = userDtoToModel(dto);
      expect(model.role).toBe("fieldCrew");
      expect(model.isAdmin).toBe(false);
    });
  });

  describe("role detection defaults", () => {
    it("defaults to fieldCrew when no role info available", () => {
      const dto = mockUser({ employeeType: "" });
      const model = userDtoToModel(dto);
      expect(model.role).toBe("fieldCrew");
    });

    it("defaults to fieldCrew for unknown employeeType", () => {
      const dto = mockUser({ employeeType: "Unknown Type" });
      const model = userDtoToModel(dto);
      expect(model.role).toBe("fieldCrew");
    });

    it("defaults to fieldCrew when companyAdminIds is empty", () => {
      const dto = mockUser({ _id: "user-1", employeeType: "" });
      const model = userDtoToModel(dto, []);
      expect(model.role).toBe("fieldCrew");
    });
  });

  describe("field mapping", () => {
    it("maps nameFirst to firstName", () => {
      const dto = mockUser({ nameFirst: "Marcus" });
      const model = userDtoToModel(dto);
      expect(model.firstName).toBe("Marcus");
    });

    it("maps nameLast to lastName", () => {
      const dto = mockUser({ nameLast: "Johnson" });
      const model = userDtoToModel(dto);
      expect(model.lastName).toBe("Johnson");
    });

    it("uses profileImageURL for avatarUrl", () => {
      const dto = mockUser({ profileImageURL: "https://example.com/avatar.png", avatar: "" });
      const model = userDtoToModel(dto);
      expect(model.avatarUrl).toBe("https://example.com/avatar.png");
    });

    it("falls back to avatar when profileImageURL is empty", () => {
      const dto = mockUser({ profileImageURL: "", avatar: "https://example.com/fallback.png" });
      const model = userDtoToModel(dto);
      expect(model.avatarUrl).toBe("https://example.com/fallback.png");
    });

    it("maps company to companyId", () => {
      const dto = mockUser({ company: "comp-xyz" });
      const model = userDtoToModel(dto);
      expect(model.companyId).toBe("comp-xyz");
    });
  });
});

// ─── CompanyDTO.toModel() ───────────────────────────────────────────────────

describe("CompanyDTO -> Model conversion", () => {
  it("maps all fields correctly", () => {
    const dto = mockCompany({
      _id: "comp-123",
      companyName: "Lone Star Renovations",
      companyId: "LSR-2024",
      location: "Austin, TX",
    });
    const model = companyDtoToModel(dto);
    expect(model.id).toBe("comp-123");
    expect(model.name).toBe("Lone Star Renovations");
    expect(model.externalId).toBe("LSR-2024");
    expect(model.location).toBe("Austin, TX");
  });

  it("normalizes subscriptionStatus to lowercase", () => {
    const dto = mockCompany({ subscriptionStatus: "Active" });
    const model = companyDtoToModel(dto);
    expect(model.subscriptionStatus).toBe("active");
  });

  it("normalizes subscriptionPlan to lowercase", () => {
    const dto = mockCompany({ subscriptionPlan: "Team" });
    const model = companyDtoToModel(dto);
    expect(model.subscriptionPlan).toBe("team");
  });

  it("handles 'TRIAL' subscription status (mixed case)", () => {
    const dto = mockCompany({ subscriptionStatus: "TRIAL" });
    const model = companyDtoToModel(dto);
    expect(model.subscriptionStatus).toBe("trial");
  });

  it("handles empty subscription status", () => {
    const dto = mockCompany({ subscriptionStatus: "" });
    const model = companyDtoToModel(dto);
    expect(model.subscriptionStatus).toBe("");
  });

  it("maps admin IDs array", () => {
    const dto = mockCompany({ admin: ["user-1", "user-2"] });
    const model = companyDtoToModel(dto);
    expect(model.adminIds).toEqual(["user-1", "user-2"]);
  });

  it("uses logoURL for logoUrl", () => {
    const dto = mockCompany({
      logoURL: "https://example.com/logo.png",
      logo: "https://example.com/old-logo.png",
    });
    const model = companyDtoToModel(dto);
    expect(model.logoUrl).toBe("https://example.com/logo.png");
  });

  it("falls back to logo when logoURL is empty", () => {
    const dto = mockCompany({
      logoURL: "",
      logo: "https://example.com/old-logo.png",
    });
    const model = companyDtoToModel(dto);
    expect(model.logoUrl).toBe("https://example.com/old-logo.png");
  });

  it("uses default project color when not set", () => {
    const dto = mockCompany({ defaultProjectColor: "" });
    const model = companyDtoToModel(dto);
    expect(model.defaultProjectColor).toBe("#9CA3AF");
  });
});

// ─── SubClientDTO phone type handling ───────────────────────────────────────

describe("SubClientDTO -> Model conversion", () => {
  it("handles phoneNumber as string type", () => {
    const dto = mockSubClient({ phoneNumber: "(512) 555-0198" });
    const model = subClientDtoToModel(dto);
    expect(model.phone).toBe("(512) 555-0198");
  });

  it("handles phoneNumber as number type", () => {
    const dto = mockSubClient({ phoneNumber: 5125550198 });
    const model = subClientDtoToModel(dto);
    expect(model.phone).toBe("5125550198");
  });

  it("handles empty phone number", () => {
    const dto = mockSubClient({ phoneNumber: "" });
    const model = subClientDtoToModel(dto);
    expect(model.phone).toBe("");
  });

  it("handles zero as phone number (number type)", () => {
    const dto = mockSubClient({ phoneNumber: 0 });
    const model = subClientDtoToModel(dto);
    expect(model.phone).toBe("0");
  });

  it("maps parentClient to parentClientId", () => {
    const dto = mockSubClient({ parentClient: "cli-parent-123" });
    const model = subClientDtoToModel(dto);
    expect(model.parentClientId).toBe("cli-parent-123");
  });

  it("maps title directly", () => {
    const dto = mockSubClient({ title: "Property Manager" });
    const model = subClientDtoToModel(dto);
    expect(model.title).toBe("Property Manager");
  });

  it("maps all fields correctly", () => {
    const dto = mockSubClient({
      _id: "sub-123",
      name: "Sarah Martinez",
      emailAddress: "sarah@example.com",
      address: "1200 Congress Ave",
      title: "Site Supervisor",
    });
    const model = subClientDtoToModel(dto);
    expect(model.id).toBe("sub-123");
    expect(model.name).toBe("Sarah Martinez");
    expect(model.email).toBe("sarah@example.com");
    expect(model.address).toBe("1200 Congress Ave");
    expect(model.title).toBe("Site Supervisor");
  });
});

// ─── normalizeColor helper ──────────────────────────────────────────────────

describe("normalizeColor", () => {
  it("returns color unchanged when it starts with #", () => {
    expect(normalizeColor("#417394")).toBe("#417394");
  });

  it("adds # prefix to 6-character hex", () => {
    expect(normalizeColor("C4A868")).toBe("#C4A868");
  });

  it("adds # prefix to 3-character hex", () => {
    expect(normalizeColor("FFF")).toBe("#FFF");
  });

  it("returns default color for empty string", () => {
    expect(normalizeColor("")).toBe("#417394");
  });

  it("handles lowercase hex", () => {
    expect(normalizeColor("c4a868")).toBe("#c4a868");
  });

  it("passes through non-hex strings", () => {
    expect(normalizeColor("red")).toBe("red");
  });
});

// ─── normalizeTaskStatus helper ─────────────────────────────────────────────

describe("normalizeTaskStatus (DTO conversion)", () => {
  it("converts 'Scheduled' to 'Booked'", () => {
    expect(normalizeTaskStatus("Scheduled")).toBe("Booked");
  });

  it("passes through all other statuses", () => {
    expect(normalizeTaskStatus("Booked")).toBe("Booked");
    expect(normalizeTaskStatus("In Progress")).toBe("In Progress");
    expect(normalizeTaskStatus("Completed")).toBe("Completed");
    expect(normalizeTaskStatus("Cancelled")).toBe("Cancelled");
  });
});
