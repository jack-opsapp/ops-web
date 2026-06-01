/**
 * Unit tests for mapTaskToInternalEvent — the unified mapping that powers
 * every calendar view (Day, Week, Month, Crew, popovers).
 *
 * Verifies the new fields exposed by T8 of the 2026-04-27 rework:
 *   projectTitle, taskTitle, typeLabel, typeColors, statusColors,
 *   statusKey, crewIds, address, startTime, endTime, allDay
 */

import { describe, it, expect } from "vitest";
import { mapTaskToInternalEvent } from "@/lib/utils/calendar-utils";
import { TaskStatus, type ProjectTask, type Project } from "@/lib/types/models";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    title: "Test Project",
    address: "123 Test St",
    companyId: "c1",
    clientId: "cl1",
    createdAt: null,
    updatedAt: null,
    deletedAt: null,
    lastSyncedAt: null,
    needsSync: false,
    archived: false,
    archivedAt: null,
    deletedReason: null,
    archivedReason: null,
    color: null,
    description: null,
    estimateId: null,
    invoiceId: null,
    latitude: null,
    longitude: null,
    notes: null,
    profileImageURL: null,
    siteImageURLs: null,
    workOrder: null,
    duration: null,
    progress: null,
    projectStatus: "rfq" as never,
    revenue: null,
    sortOrder: 0,
    startDate: null,
    endDate: null,
    allDay: true,
    ...overrides,
  } as Project;
}

function makeTask(overrides: Partial<ProjectTask> = {}): ProjectTask {
  return {
    id: "t1",
    projectId: "p1",
    companyId: "c1",
    status: TaskStatus.Booked,
    taskColor: "#B58289", // installation
    taskNotes: null,
    taskTypeId: "tt1",
    taskIndex: 0,
    displayOrder: 0,
    customTitle: null,
    sourceLineItemId: null,
    sourceEstimateId: null,
    teamMemberIds: [],
    dependencyOverrides: null,
    startDate: new Date("2026-05-01T00:00:00Z"),
    endDate: new Date("2026-05-02T00:00:00Z"),
    duration: 1,
    startTime: null,
    endTime: null,
    allDay: true,
    recurrenceId: null,
    recurrenceOriginDate: null,
    inventoryDeducted: false,
    lastSyncedAt: null,
    needsSync: false,
    deletedAt: null,
    project: makeProject(),
    taskType: {
      id: "tt1",
      display: "Installation",
      color: "#B58289",
      icon: null,
      isDefault: false,
      companyId: "c1",
      displayOrder: 0,
      defaultTeamMemberIds: [],
      dependencies: [],
      lastSyncedAt: null,
      needsSync: false,
      deletedAt: null,
    },
    ...overrides,
  };
}

describe("mapTaskToInternalEvent", () => {
  it("returns null when startDate is missing", () => {
    const task = makeTask({ startDate: null });
    expect(mapTaskToInternalEvent(task)).toBeNull();
  });

  describe("three-source title rule", () => {
    it("primary title = project.title when present", () => {
      const task = makeTask({
        project: makeProject({ title: "Roof Job" }),
        customTitle: null,
        taskType: { ...makeTask().taskType!, display: "Installation" },
      });
      const event = mapTaskToInternalEvent(task);
      expect(event?.projectTitle).toBe("Roof Job");
      expect(event?.title).toBe("Roof Job"); // backward-compat field
    });

    it("primary title falls back to taskTitle when project is missing", () => {
      const task = makeTask({
        project: null,
        customTitle: "Custom Task Name",
      });
      const event = mapTaskToInternalEvent(task);
      expect(event?.projectTitle).toBeNull();
      expect(event?.taskTitle).toBe("Custom Task Name");
      expect(event?.title).toBe("Custom Task Name");
    });

    it("taskTitle = customTitle when present", () => {
      const task = makeTask({
        customTitle: "Final Walkthrough",
        taskType: { ...makeTask().taskType!, display: "Inspection" },
      });
      const event = mapTaskToInternalEvent(task);
      expect(event?.taskTitle).toBe("Final Walkthrough");
    });

    it("taskTitle falls back to taskType.display when no customTitle", () => {
      const task = makeTask({
        customTitle: null,
        taskType: { ...makeTask().taskType!, display: "Installation" },
      });
      const event = mapTaskToInternalEvent(task);
      expect(event?.taskTitle).toBe("Installation");
    });
  });

  describe("type colors (drives left stripe + badge)", () => {
    it("populates typeColors from TASK_TYPE_COLORS", () => {
      const task = makeTask({ taskColor: "#B58289" }); // installation
      const event = mapTaskToInternalEvent(task);
      expect(event?.typeColors).toBeDefined();
      expect(event?.typeColors.bg).toMatch(/rgba\(/);
      expect(event?.typeColors.border).toBeDefined();
      expect(event?.typeColors.text).toBeDefined();
    });

    it("exposes typeLabel = taskType.display", () => {
      const task = makeTask({
        taskType: { ...makeTask().taskType!, display: "Site Visit" },
      });
      const event = mapTaskToInternalEvent(task);
      expect(event?.typeLabel).toBe("Site Visit");
    });

    it("typeLabel falls back to 'Unmapped type' when taskType is null", () => {
      // bug-d789ff9a (011d6bbd) deliberately replaced the generic "Task"
      // fallback with the explicit "Unmapped type" label, routed through
      // cleanTaskTypeLabel() so a null taskType — or a UUID-like / blank
      // taskType.display — surfaces the same tactical badge instead of
      // leaking a meaningless value into the calendar UI.
      const task = makeTask({ taskType: null });
      const event = mapTaskToInternalEvent(task);
      expect(event?.typeLabel).toBe("Unmapped type");
    });
  });

  describe("status colors (drives body fill + border)", () => {
    it("populates statusColors based on derived status key", () => {
      const task = makeTask({ status: TaskStatus.Completed });
      const event = mapTaskToInternalEvent(task);
      expect(event?.statusKey).toBe("completed");
      expect(event?.statusColors).toBeDefined();
      expect(event?.statusColors.text).toBe("#6A6A6A"); // mute
    });

    it("statusColors reflects 'in_progress' for active task with now between dates", () => {
      const task = makeTask({
        status: TaskStatus.Booked,
        startDate: new Date(Date.now() - 24 * 60 * 60 * 1000), // yesterday
        endDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // tomorrow
      });
      const event = mapTaskToInternalEvent(task);
      expect(event?.statusKey).toBe("in_progress");
      expect(event?.statusColors.text).toBe("#C4A868"); // tan
    });

    it("statusColors reflects 'cancelled' for cancelled tasks", () => {
      const task = makeTask({ status: TaskStatus.Cancelled });
      const event = mapTaskToInternalEvent(task);
      expect(event?.statusKey).toBe("cancelled");
      expect(event?.statusColors.text).toBe("#93321A"); // brick
    });
  });

  describe("crew + address", () => {
    it("crewIds = task.teamMemberIds", () => {
      const task = makeTask({ teamMemberIds: ["u1", "u2", "u3", "u4"] });
      const event = mapTaskToInternalEvent(task);
      expect(event?.crewIds).toEqual(["u1", "u2", "u3", "u4"]);
    });

    it("crewIds is empty when teamMemberIds is empty", () => {
      const task = makeTask({ teamMemberIds: [] });
      const event = mapTaskToInternalEvent(task);
      expect(event?.crewIds).toEqual([]);
    });

    it("address = project.address when present", () => {
      const task = makeTask({
        project: makeProject({ address: "456 Oak Ave" }),
      });
      const event = mapTaskToInternalEvent(task);
      expect(event?.address).toBe("456 Oak Ave");
    });

    it("address is null when project has no address", () => {
      const task = makeTask({ project: makeProject({ address: null }) });
      const event = mapTaskToInternalEvent(task);
      expect(event?.address).toBeNull();
    });

    it("address is null when project is null", () => {
      const task = makeTask({ project: null });
      const event = mapTaskToInternalEvent(task);
      expect(event?.address).toBeNull();
    });
  });

  describe("Phase 3 fields (allDay is authoritative)", () => {
    it("allDay = true is preserved on the event", () => {
      const task = makeTask({ allDay: true, startTime: null, endTime: null });
      const event = mapTaskToInternalEvent(task);
      expect(event?.allDay).toBe(true);
    });

    it("allDay = false is preserved on the event", () => {
      const task = makeTask({ allDay: false, startTime: "08:00:00", endTime: "17:00:00" });
      const event = mapTaskToInternalEvent(task);
      expect(event?.allDay).toBe(false);
    });

    it("allDay is true even if startTime/endTime are populated (legacy 08:00-17:00 rows)", () => {
      // Production has 275/275 tasks with hardcoded 08:00-17:00 startTime/endTime
      // that are functionally all-day. The allDay flag is the source of truth.
      const task = makeTask({ allDay: true, startTime: "08:00:00", endTime: "17:00:00" });
      const event = mapTaskToInternalEvent(task);
      expect(event?.allDay).toBe(true);
    });

    it("preserves startTime / endTime values from the task", () => {
      const task = makeTask({ startTime: "09:30:00", endTime: "11:00:00" });
      const event = mapTaskToInternalEvent(task);
      expect(event?.startTime).toBe("09:30:00");
      expect(event?.endTime).toBe("11:00:00");
    });
  });

  describe("backward-compat field 'title'", () => {
    it("title === projectTitle when project present", () => {
      const task = makeTask({
        project: makeProject({ title: "Vinyl Siding Job" }),
        customTitle: "Day 2",
      });
      const event = mapTaskToInternalEvent(task);
      expect(event?.title).toBe("Vinyl Siding Job");
      expect(event?.projectTitle).toBe("Vinyl Siding Job");
      expect(event?.taskTitle).toBe("Day 2");
    });

    it("title === taskTitle when no project", () => {
      const task = makeTask({
        project: null,
        customTitle: "Standalone task",
      });
      const event = mapTaskToInternalEvent(task);
      expect(event?.title).toBe("Standalone task");
    });
  });
});
