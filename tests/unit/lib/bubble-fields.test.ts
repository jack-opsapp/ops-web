/**
 * Tests for BubbleFields Constants
 *
 * Verifies that all Bubble.io field name constants are byte-identical
 * to the values expected by the API. Any mismatch causes silent failures.
 */

import { describe, it, expect } from "vitest";
import {
  BubbleTypes,
  BubbleJobStatus,
  BubbleTaskStatus,
  BubbleEmployeeType,
  BubbleUserType,
  BubbleProjectFields,
  BubbleTaskFields,
  BubbleCalendarEventFields,
  BubbleUserFields,
  BubbleCompanyFields,
  BubbleClientFields,
  BubbleSubClientFields,
  BubbleTaskTypeFields,
  BubbleTaskStatusOptionFields,
  BubbleApiPaths,
  BubbleConstraintType,
  normalizeTaskStatus,
  employeeTypeToRole,
  jobStatusToEnum,
  buildConstraints,
  companyConstraint,
  notDeletedConstraint,
  type BubbleConstraint,
} from "@/lib/constants/bubble-fields";

// ─── Entity Type Names ──────────────────────────────────────────────────────

describe("BubbleTypes", () => {
  it("maps client to 'Client'", () => {
    expect(BubbleTypes.client).toBe("Client");
  });

  it("maps company to 'Company'", () => {
    expect(BubbleTypes.company).toBe("Company");
  });

  it("maps project to 'Project'", () => {
    expect(BubbleTypes.project).toBe("Project");
  });

  it("maps user to 'User'", () => {
    expect(BubbleTypes.user).toBe("User");
  });

  it("maps subClient to 'Sub Client' with space", () => {
    expect(BubbleTypes.subClient).toBe("Sub Client");
    expect(BubbleTypes.subClient).toContain(" ");
  });

  it("maps task to 'Task'", () => {
    expect(BubbleTypes.task).toBe("Task");
  });

  it("maps taskType to 'TaskType'", () => {
    expect(BubbleTypes.taskType).toBe("TaskType");
  });

  it("maps calendarEvent to 'calendarevent' in lowercase", () => {
    expect(BubbleTypes.calendarEvent).toBe("calendarevent");
    expect(BubbleTypes.calendarEvent).toEqual(BubbleTypes.calendarEvent.toLowerCase());
  });

  it("has exactly 8 entity types", () => {
    expect(Object.keys(BubbleTypes)).toHaveLength(8);
  });
});

// ─── Job Status Values ──────────────────────────────────────────────────────

describe("BubbleJobStatus", () => {
  it("contains all expected job statuses", () => {
    expect(BubbleJobStatus.rfq).toBe("RFQ");
    expect(BubbleJobStatus.estimated).toBe("Estimated");
    expect(BubbleJobStatus.accepted).toBe("Accepted");
    expect(BubbleJobStatus.inProgress).toBe("In Progress");
    expect(BubbleJobStatus.completed).toBe("Completed");
    expect(BubbleJobStatus.closed).toBe("Closed");
    expect(BubbleJobStatus.archived).toBe("Archived");
  });

  it("has exactly 7 statuses", () => {
    expect(Object.keys(BubbleJobStatus)).toHaveLength(7);
  });

  it("inProgress uses exact spacing 'In Progress'", () => {
    expect(BubbleJobStatus.inProgress).toBe("In Progress");
    expect(BubbleJobStatus.inProgress).not.toBe("InProgress");
    expect(BubbleJobStatus.inProgress).not.toBe("in progress");
  });
});

// ─── Task Status Values ─────────────────────────────────────────────────────

describe("BubbleTaskStatus", () => {
  it("uses 'Booked' (not 'Scheduled')", () => {
    expect(BubbleTaskStatus.booked).toBe("Booked");
  });

  it("contains all expected task statuses", () => {
    expect(BubbleTaskStatus.booked).toBe("Booked");
    expect(BubbleTaskStatus.inProgress).toBe("In Progress");
    expect(BubbleTaskStatus.completed).toBe("Completed");
    expect(BubbleTaskStatus.cancelled).toBe("Cancelled");
  });

  it("has exactly 4 statuses", () => {
    expect(Object.keys(BubbleTaskStatus)).toHaveLength(4);
  });

  it("does NOT contain 'Scheduled' as a value", () => {
    const values = Object.values(BubbleTaskStatus);
    expect(values).not.toContain("Scheduled");
  });
});

// ─── Employee Type Values ───────────────────────────────────────────────────

describe("BubbleEmployeeType", () => {
  it("maps officeCrew to 'Office Crew'", () => {
    expect(BubbleEmployeeType.officeCrew).toBe("Office Crew");
  });

  it("maps fieldCrew to 'Field Crew'", () => {
    expect(BubbleEmployeeType.fieldCrew).toBe("Field Crew");
  });

  it("maps admin to 'Admin'", () => {
    expect(BubbleEmployeeType.admin).toBe("Admin");
  });

  it("has exactly 3 employee types", () => {
    expect(Object.keys(BubbleEmployeeType)).toHaveLength(3);
  });
});

// ─── User Type Values ───────────────────────────────────────────────────────

describe("BubbleUserType", () => {
  it("contains all expected user types", () => {
    expect(BubbleUserType.company).toBe("Company");
    expect(BubbleUserType.employee).toBe("Employee");
    expect(BubbleUserType.client).toBe("Client");
    expect(BubbleUserType.admin).toBe("Admin");
  });

  it("has exactly 4 user types", () => {
    expect(Object.keys(BubbleUserType)).toHaveLength(4);
  });
});

// ─── Project Field Names ────────────────────────────────────────────────────

describe("BubbleProjectFields", () => {
  it("id is '_id'", () => {
    expect(BubbleProjectFields.id).toBe("_id");
  });

  it("projectName is 'projectName' (camelCase)", () => {
    expect(BubbleProjectFields.projectName).toBe("projectName");
  });

  it("contains all required project fields", () => {
    const expectedFields = [
      "id", "address", "allDay", "calendarEvent", "client",
      "company", "completion", "description", "eventType",
      "projectName", "startDate", "status", "teamMembers",
      "teamNotes", "clientName", "tasks", "projectImages",
      "duration", "deletedAt",
    ];
    expectedFields.forEach((field) => {
      expect(BubbleProjectFields).toHaveProperty(field);
    });
  });

  it("deletedAt is 'deletedAt' for soft delete support", () => {
    expect(BubbleProjectFields.deletedAt).toBe("deletedAt");
  });
});

// ─── Task Field Names ───────────────────────────────────────────────────────

describe("BubbleTaskFields", () => {
  it("projectId uses lowercase 'Id' suffix", () => {
    expect(BubbleTaskFields.projectId).toBe("projectId");
  });

  it("calendarEventId uses lowercase 'Id' suffix", () => {
    expect(BubbleTaskFields.calendarEventId).toBe("calendarEventId");
  });

  it("type refers to TaskType ID", () => {
    expect(BubbleTaskFields.type).toBe("type");
  });

  it("contains all required task fields", () => {
    const expectedFields = [
      "id", "calendarEventId", "companyId", "completionDate",
      "projectId", "scheduledDate", "status", "taskColor",
      "taskIndex", "taskNotes", "teamMembers", "type", "deletedAt",
    ];
    expectedFields.forEach((field) => {
      expect(BubbleTaskFields).toHaveProperty(field);
    });
  });
});

// ─── CalendarEvent Field Names ──────────────────────────────────────────────

describe("BubbleCalendarEventFields", () => {
  it("companyId uses lowercase 'c' (as documented)", () => {
    expect(BubbleCalendarEventFields.companyId).toBe("companyId");
  });

  it("projectId uses lowercase 'p'", () => {
    expect(BubbleCalendarEventFields.projectId).toBe("projectId");
  });

  it("taskId uses lowercase 't'", () => {
    expect(BubbleCalendarEventFields.taskId).toBe("taskId");
  });

  it("contains all required calendar event fields", () => {
    const expectedFields = [
      "id", "active", "color", "companyId", "duration", "endDate",
      "projectId", "startDate", "taskId", "teamMembers", "title",
      "eventType", "deletedAt",
    ];
    expectedFields.forEach((field) => {
      expect(BubbleCalendarEventFields).toHaveProperty(field);
    });
  });
});

// ─── User Field Names ───────────────────────────────────────────────────────

describe("BubbleUserFields", () => {
  it("uses 'nameFirst' and 'nameLast' (not firstName/lastName)", () => {
    expect(BubbleUserFields.nameFirst).toBe("nameFirst");
    expect(BubbleUserFields.nameLast).toBe("nameLast");
  });

  it("uses 'employeeType' for role detection", () => {
    expect(BubbleUserFields.employeeType).toBe("employeeType");
  });

  it("contains all required user fields", () => {
    const expectedFields = [
      "id", "clientId", "company", "currentLocation", "employeeType",
      "nameFirst", "nameLast", "userType", "avatar", "profileImageURL",
      "email", "phone", "homeAddress", "deviceToken",
      "hasCompletedAppTutorial", "deletedAt",
    ];
    expectedFields.forEach((field) => {
      expect(BubbleUserFields).toHaveProperty(field);
    });
  });
});

// ─── Company Field Names ────────────────────────────────────────────────────

describe("BubbleCompanyFields", () => {
  it("admin field holds admin user IDs", () => {
    expect(BubbleCompanyFields.admin).toBe("admin");
  });

  it("subscriptionStatus tracks subscription state", () => {
    expect(BubbleCompanyFields.subscriptionStatus).toBe("subscriptionStatus");
  });

  it("seatedEmployees tracks licensed users", () => {
    expect(BubbleCompanyFields.seatedEmployees).toBe("seatedEmployees");
  });

  it("contains all required company fields", () => {
    const expectedFields = [
      "id", "companyName", "companyId", "location", "logo", "logoURL",
      "defaultProjectColor", "projects", "teams", "clients", "taskTypes",
      "calendarEventsList", "admin", "seatedEmployees",
      "subscriptionStatus", "subscriptionPlan", "deletedAt",
    ];
    expectedFields.forEach((field) => {
      expect(BubbleCompanyFields).toHaveProperty(field);
    });
  });
});

// ─── Client Field Names ─────────────────────────────────────────────────────

describe("BubbleClientFields", () => {
  it("uses 'emailAddress' (not 'email')", () => {
    expect(BubbleClientFields.emailAddress).toBe("emailAddress");
  });

  it("uses 'phoneNumber' (not 'phone')", () => {
    expect(BubbleClientFields.phoneNumber).toBe("phoneNumber");
  });

  it("contains all required client fields", () => {
    const expectedFields = [
      "id", "address", "balance", "clientIdNo", "subClients",
      "emailAddress", "estimates", "invoices", "isCompany", "name",
      "parentCompany", "phoneNumber", "projectsList", "status",
      "avatar", "unit", "userId", "notes", "deletedAt",
    ];
    expectedFields.forEach((field) => {
      expect(BubbleClientFields).toHaveProperty(field);
    });
  });
});

// ─── SubClient Field Names ──────────────────────────────────────────────────

describe("BubbleSubClientFields", () => {
  it("uses 'parentClient' to reference parent Client", () => {
    expect(BubbleSubClientFields.parentClient).toBe("parentClient");
  });

  it("contains all required subclient fields", () => {
    const expectedFields = [
      "id", "address", "emailAddress", "name",
      "parentClient", "phoneNumber", "title", "deletedAt",
    ];
    expectedFields.forEach((field) => {
      expect(BubbleSubClientFields).toHaveProperty(field);
    });
  });
});

// ─── TaskType Field Names ───────────────────────────────────────────────────

describe("BubbleTaskTypeFields", () => {
  it("uses 'display' for the human-readable name", () => {
    expect(BubbleTaskTypeFields.display).toBe("display");
  });

  it("isDefault tracks whether it's a system default", () => {
    expect(BubbleTaskTypeFields.isDefault).toBe("isDefault");
  });
});

// ─── TaskStatusOption Field Names ───────────────────────────────────────────

describe("BubbleTaskStatusOptionFields", () => {
  it("uses uppercase 'Display' (capital D)", () => {
    expect(BubbleTaskStatusOptionFields.display).toBe("Display");
  });

  it("has company and color fields", () => {
    expect(BubbleTaskStatusOptionFields.company).toBe("company");
    expect(BubbleTaskStatusOptionFields.color).toBe("color");
  });
});

// ─── API Path Builders ──────────────────────────────────────────────────────

describe("BubbleApiPaths", () => {
  describe("dataApi", () => {
    it("builds correct path for entity type", () => {
      expect(BubbleApiPaths.dataApi("Project")).toBe("/obj/project");
    });

    it("lowercases the object type", () => {
      expect(BubbleApiPaths.dataApi("CalendarEvent")).toBe("/obj/calendarevent");
      expect(BubbleApiPaths.dataApi("TASK")).toBe("/obj/task");
    });

    it("handles 'Sub Client' with space", () => {
      expect(BubbleApiPaths.dataApi("Sub Client")).toBe("/obj/sub client");
    });
  });

  describe("dataApiById", () => {
    it("builds correct path with ID", () => {
      expect(BubbleApiPaths.dataApiById("Project", "abc123")).toBe("/obj/project/abc123");
    });
  });

  describe("workflowApi", () => {
    it("builds correct workflow path", () => {
      expect(BubbleApiPaths.workflowApi("delete_project")).toBe("/wf/delete_project");
      expect(BubbleApiPaths.workflowApi("update_project_status")).toBe("/wf/update_project_status");
    });
  });
});

// ─── Constraint Types ───────────────────────────────────────────────────────

describe("BubbleConstraintType", () => {
  it("maps equals correctly", () => {
    expect(BubbleConstraintType.equals).toBe("equals");
  });

  it("maps notEqual with space", () => {
    expect(BubbleConstraintType.notEqual).toBe("not equal");
  });

  it("maps isEmpty with underscore", () => {
    expect(BubbleConstraintType.isEmpty).toBe("is_empty");
  });

  it("maps isNotEmpty with underscores", () => {
    expect(BubbleConstraintType.isNotEmpty).toBe("is_not_empty");
  });

  it("maps textContains with space", () => {
    expect(BubbleConstraintType.textContains).toBe("text contains");
  });

  it("maps greaterThan with space", () => {
    expect(BubbleConstraintType.greaterThan).toBe("greater than");
  });

  it("maps lessThan with space", () => {
    expect(BubbleConstraintType.lessThan).toBe("less than");
  });

  it("has all 11 constraint types", () => {
    expect(Object.keys(BubbleConstraintType)).toHaveLength(11);
  });
});

// ─── normalizeTaskStatus ────────────────────────────────────────────────────

describe("normalizeTaskStatus", () => {
  it("converts 'Scheduled' to 'Booked'", () => {
    expect(normalizeTaskStatus("Scheduled")).toBe("Booked");
  });

  it("passes through 'Booked' unchanged", () => {
    expect(normalizeTaskStatus("Booked")).toBe("Booked");
  });

  it("passes through 'In Progress' unchanged", () => {
    expect(normalizeTaskStatus("In Progress")).toBe("In Progress");
  });

  it("passes through 'Completed' unchanged", () => {
    expect(normalizeTaskStatus("Completed")).toBe("Completed");
  });

  it("passes through 'Cancelled' unchanged", () => {
    expect(normalizeTaskStatus("Cancelled")).toBe("Cancelled");
  });

  it("passes through unknown statuses unchanged", () => {
    expect(normalizeTaskStatus("CustomStatus")).toBe("CustomStatus");
  });

  it("is case-sensitive (does not convert 'scheduled')", () => {
    expect(normalizeTaskStatus("scheduled")).toBe("scheduled");
  });
});

// ─── employeeTypeToRole ─────────────────────────────────────────────────────

describe("employeeTypeToRole", () => {
  it("maps 'Office Crew' to 'officeCrew'", () => {
    expect(employeeTypeToRole("Office Crew")).toBe("officeCrew");
  });

  it("maps 'Field Crew' to 'fieldCrew'", () => {
    expect(employeeTypeToRole("Field Crew")).toBe("fieldCrew");
  });

  it("maps 'Admin' to 'admin'", () => {
    expect(employeeTypeToRole("Admin")).toBe("admin");
  });

  it("defaults to 'fieldCrew' for null", () => {
    expect(employeeTypeToRole(null)).toBe("fieldCrew");
  });

  it("defaults to 'fieldCrew' for undefined", () => {
    expect(employeeTypeToRole(undefined)).toBe("fieldCrew");
  });

  it("defaults to 'fieldCrew' for unknown string", () => {
    expect(employeeTypeToRole("Unknown")).toBe("fieldCrew");
  });

  it("defaults to 'fieldCrew' for empty string", () => {
    expect(employeeTypeToRole("")).toBe("fieldCrew");
  });
});

// ─── jobStatusToEnum ────────────────────────────────────────────────────────

describe("jobStatusToEnum", () => {
  it("maps 'RFQ' to 'rfq'", () => {
    expect(jobStatusToEnum("RFQ")).toBe("rfq");
  });

  it("maps 'Estimated' to 'estimated'", () => {
    expect(jobStatusToEnum("Estimated")).toBe("estimated");
  });

  it("maps 'Accepted' to 'accepted'", () => {
    expect(jobStatusToEnum("Accepted")).toBe("accepted");
  });

  it("maps 'In Progress' to 'inProgress'", () => {
    expect(jobStatusToEnum("In Progress")).toBe("inProgress");
  });

  it("maps 'Completed' to 'completed'", () => {
    expect(jobStatusToEnum("Completed")).toBe("completed");
  });

  it("maps 'Closed' to 'closed'", () => {
    expect(jobStatusToEnum("Closed")).toBe("closed");
  });

  it("maps 'Archived' to 'archived'", () => {
    expect(jobStatusToEnum("Archived")).toBe("archived");
  });

  it("defaults to 'rfq' for unknown status", () => {
    expect(jobStatusToEnum("Unknown")).toBe("rfq");
  });

  it("defaults to 'rfq' for empty string", () => {
    expect(jobStatusToEnum("")).toBe("rfq");
  });
});

// ─── Constraint Builders ────────────────────────────────────────────────────

describe("buildConstraints", () => {
  it("serializes constraints to JSON string", () => {
    const constraints: BubbleConstraint[] = [
      { key: "company", constraint_type: "equals", value: "comp-123" },
    ];
    const result = buildConstraints(constraints);
    const parsed = JSON.parse(result);
    expect(parsed).toEqual(constraints);
  });

  it("serializes multiple constraints", () => {
    const constraints: BubbleConstraint[] = [
      { key: "company", constraint_type: "equals", value: "comp-123" },
      { key: "deletedAt", constraint_type: "is_empty" },
    ];
    const result = buildConstraints(constraints);
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].key).toBe("company");
    expect(parsed[1].key).toBe("deletedAt");
  });

  it("serializes empty array", () => {
    expect(buildConstraints([])).toBe("[]");
  });
});

describe("companyConstraint", () => {
  it("creates a constraint for company equals", () => {
    const constraint = companyConstraint("comp-abc");
    expect(constraint.key).toBe("company");
    expect(constraint.constraint_type).toBe("equals");
    expect(constraint.value).toBe("comp-abc");
  });
});

describe("notDeletedConstraint", () => {
  it("creates a constraint for deletedAt is_empty", () => {
    const constraint = notDeletedConstraint();
    expect(constraint.key).toBe("deletedAt");
    expect(constraint.constraint_type).toBe("is_empty");
    expect(constraint.value).toBeUndefined();
  });
});

// ─── All fields use _id convention ──────────────────────────────────────────

describe("All entity ID fields use '_id' convention", () => {
  const fieldSets = [
    { name: "Project", fields: BubbleProjectFields },
    { name: "Task", fields: BubbleTaskFields },
    { name: "CalendarEvent", fields: BubbleCalendarEventFields },
    { name: "User", fields: BubbleUserFields },
    { name: "Company", fields: BubbleCompanyFields },
    { name: "Client", fields: BubbleClientFields },
    { name: "SubClient", fields: BubbleSubClientFields },
    { name: "TaskType", fields: BubbleTaskTypeFields },
    { name: "TaskStatusOption", fields: BubbleTaskStatusOptionFields },
  ];

  fieldSets.forEach(({ name, fields }) => {
    it(`${name} id field is '_id'`, () => {
      expect(fields.id).toBe("_id");
    });
  });
});
