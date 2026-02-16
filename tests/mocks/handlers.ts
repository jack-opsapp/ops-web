/**
 * MSW Request Handlers
 *
 * Mock Service Worker handlers for all Bubble.io API endpoints.
 * Each handler returns data in the exact Bubble response format.
 */

import { http, HttpResponse, delay } from "msw";
import {
  mockProject,
  mockTask,
  mockCalendarEvent,
  mockClient,
  mockUser,
  mockCompany,
  mockTaskType,
  mockProjects,
  mockTasks,
  mockCalendarEvents,
  mockClients,
  mockUsers,
  mockTaskTypes,
  wrapBubbleList,
  wrapBubbleSingle,
} from "./data";

const BASE_URL = "https://opsapp.co/api/1.1";

// ─── Project Handlers ───────────────────────────────────────────────────────

const projectHandlers = [
  // GET /api/1.1/obj/project - List projects
  http.get(`${BASE_URL}/obj/project`, async ({ request }) => {
    await delay(50);
    const url = new URL(request.url);
    const cursor = parseInt(url.searchParams.get("cursor") || "0", 10);
    const limit = parseInt(url.searchParams.get("limit") || "100", 10);

    const projects = mockProjects(5);
    const paged = projects.slice(cursor, cursor + limit);

    return HttpResponse.json(
      wrapBubbleList(paged, cursor)
    );
  }),

  // POST /api/1.1/obj/project - Create project
  http.post(`${BASE_URL}/obj/project`, async ({ request }) => {
    await delay(50);
    const body = (await request.json()) as Record<string, unknown>;
    const created = mockProject({
      projectName: (body.projectName as string) || "New Project",
      address: (body.address as string) || "",
      status: (body.status as string) || "RFQ",
      description: (body.description as string) || "",
    });

    return HttpResponse.json(
      {
        status: "success",
        id: created._id,
        ...wrapBubbleSingle(created),
      },
      { status: 201 }
    );
  }),

  // PATCH /api/1.1/obj/project/:id - Update project
  http.patch(`${BASE_URL}/obj/project/:id`, async ({ params, request }) => {
    await delay(50);
    const body = (await request.json()) as Record<string, unknown>;
    const updated = mockProject({
      _id: params.id as string,
      ...body as Partial<ReturnType<typeof mockProject>>,
    });

    return HttpResponse.json(
      wrapBubbleSingle(updated)
    );
  }),

  // POST /api/1.1/wf/delete_project - Soft delete project
  http.post(`${BASE_URL}/wf/delete_project`, async ({ request }) => {
    await delay(50);
    const body = (await request.json()) as Record<string, unknown>;

    return HttpResponse.json({
      status: "success",
      response: {
        project_id: body.project_id,
        deleted: true,
      },
    });
  }),

  // POST /api/1.1/wf/update_project_status - Update project status
  http.post(`${BASE_URL}/wf/update_project_status`, async ({ request }) => {
    await delay(50);
    const body = (await request.json()) as Record<string, unknown>;

    return HttpResponse.json({
      status: "success",
      response: {
        project_id: body.project_id,
        new_status: body.status,
      },
    });
  }),
];

// ─── Task Handlers ──────────────────────────────────────────────────────────

const taskHandlers = [
  // GET /api/1.1/obj/task - List tasks
  http.get(`${BASE_URL}/obj/task`, async ({ request }) => {
    await delay(50);
    const url = new URL(request.url);
    const cursor = parseInt(url.searchParams.get("cursor") || "0", 10);

    const tasks = mockTasks(6);
    return HttpResponse.json(wrapBubbleList(tasks, cursor));
  }),

  // POST /api/1.1/obj/task - Create task
  http.post(`${BASE_URL}/obj/task`, async ({ request }) => {
    await delay(50);
    const body = (await request.json()) as Record<string, unknown>;
    const created = mockTask({
      status: (body.status as string) || "Booked",
      taskColor: (body.taskColor as string) || "#417394",
      taskNotes: (body.taskNotes as string) || "",
      projectId: (body.projectId as string) || "",
    });

    return HttpResponse.json(
      {
        status: "success",
        id: created._id,
        ...wrapBubbleSingle(created),
      },
      { status: 201 }
    );
  }),

  // PATCH /api/1.1/obj/task/:id - Update task
  http.patch(`${BASE_URL}/obj/task/:id`, async ({ params, request }) => {
    await delay(50);
    const body = (await request.json()) as Record<string, unknown>;
    const updated = mockTask({
      _id: params.id as string,
      ...body as Partial<ReturnType<typeof mockTask>>,
    });

    return HttpResponse.json(wrapBubbleSingle(updated));
  }),
];

// ─── Calendar Event Handlers ────────────────────────────────────────────────

const calendarEventHandlers = [
  // GET /api/1.1/obj/calendarevent - List events (NOTE: lowercase!)
  http.get(`${BASE_URL}/obj/calendarevent`, async ({ request }) => {
    await delay(50);
    const url = new URL(request.url);
    const cursor = parseInt(url.searchParams.get("cursor") || "0", 10);

    const events = mockCalendarEvents(4);
    return HttpResponse.json(wrapBubbleList(events, cursor));
  }),

  // POST /api/1.1/obj/calendarevent - Create event
  http.post(`${BASE_URL}/obj/calendarevent`, async ({ request }) => {
    await delay(50);
    const body = (await request.json()) as Record<string, unknown>;
    const created = mockCalendarEvent({
      title: (body.title as string) || "New Event",
      startDate: (body.startDate as string) || new Date().toISOString(),
      endDate: (body.endDate as string) || new Date().toISOString(),
    });

    return HttpResponse.json(
      {
        status: "success",
        id: created._id,
        ...wrapBubbleSingle(created),
      },
      { status: 201 }
    );
  }),
];

// ─── Client Handlers ────────────────────────────────────────────────────────

const clientHandlers = [
  // GET /api/1.1/obj/client - List clients
  http.get(`${BASE_URL}/obj/client`, async ({ request }) => {
    await delay(50);
    const url = new URL(request.url);
    const cursor = parseInt(url.searchParams.get("cursor") || "0", 10);

    const clients = mockClients(4);
    return HttpResponse.json(wrapBubbleList(clients, cursor));
  }),

  // POST /api/1.1/obj/client - Create client
  http.post(`${BASE_URL}/obj/client`, async ({ request }) => {
    await delay(50);
    const body = (await request.json()) as Record<string, unknown>;
    const created = mockClient({
      name: (body.name as string) || "New Client",
      emailAddress: (body.emailAddress as string) || "",
      phoneNumber: (body.phoneNumber as string) || "",
    });

    return HttpResponse.json(
      {
        status: "success",
        id: created._id,
        ...wrapBubbleSingle(created),
      },
      { status: 201 }
    );
  }),
];

// ─── User Handlers ──────────────────────────────────────────────────────────

const userHandlers = [
  // GET /api/1.1/obj/user - List users
  http.get(`${BASE_URL}/obj/user`, async ({ request }) => {
    await delay(50);
    const url = new URL(request.url);
    const cursor = parseInt(url.searchParams.get("cursor") || "0", 10);

    const users = mockUsers(5);
    return HttpResponse.json(wrapBubbleList(users, cursor));
  }),
];

// ─── Company Handlers ───────────────────────────────────────────────────────

const companyHandlers = [
  // GET /api/1.1/obj/company/:id - Get company by ID
  http.get(`${BASE_URL}/obj/company/:id`, async ({ params }) => {
    await delay(50);
    const company = mockCompany({
      _id: params.id as string,
    });

    return HttpResponse.json(wrapBubbleSingle(company));
  }),
];

// ─── TaskType Handlers ──────────────────────────────────────────────────────

const taskTypeHandlers = [
  // GET /api/1.1/obj/tasktype - List task types
  http.get(`${BASE_URL}/obj/tasktype`, async () => {
    await delay(50);
    const taskTypes = mockTaskTypes(6);
    return HttpResponse.json(wrapBubbleList(taskTypes));
  }),
];

// ─── Auth Workflow Handlers ─────────────────────────────────────────────────

const authWorkflowHandlers = [
  // POST /api/1.1/wf/login - Login workflow
  http.post(`${BASE_URL}/wf/login`, async ({ request }) => {
    await delay(100);
    const body = (await request.json()) as Record<string, unknown>;

    if (body.email === "invalid@test.com") {
      return HttpResponse.json(
        {
          status: "error",
          message: "Invalid credentials",
        },
        { status: 401 }
      );
    }

    const user = mockUser({
      email: (body.email as string) || "test@opsapp.co",
    });

    return HttpResponse.json({
      status: "success",
      response: {
        user_id: user._id,
        token: "mock-session-token-abc123",
      },
    });
  }),

  // POST /api/1.1/wf/signup - Signup workflow
  http.post(`${BASE_URL}/wf/signup`, async ({ request }) => {
    await delay(100);
    const body = (await request.json()) as Record<string, unknown>;
    const user = mockUser({
      email: (body.email as string) || "new@opsapp.co",
      nameFirst: (body.nameFirst as string) || "New",
      nameLast: (body.nameLast as string) || "User",
    });

    return HttpResponse.json({
      status: "success",
      response: {
        user_id: user._id,
        token: "mock-session-token-new",
      },
    });
  }),
];

// ─── Error Simulation Handlers ──────────────────────────────────────────────
// These are not included by default but can be added via server.use() in tests

export const errorHandlers = {
  /**
   * Simulate a 500 server error for project fetches.
   */
  projectServerError: http.get(`${BASE_URL}/obj/project`, () => {
    return HttpResponse.json(
      { status: "error", message: "Internal Server Error" },
      { status: 500 }
    );
  }),

  /**
   * Simulate a 429 rate limit response.
   */
  rateLimitError: http.get(`${BASE_URL}/obj/project`, () => {
    return HttpResponse.json(
      { status: "error", message: "Rate limit exceeded" },
      { status: 429 }
    );
  }),

  /**
   * Simulate a network timeout.
   */
  networkTimeout: http.get(`${BASE_URL}/obj/project`, async () => {
    await delay(30000);
    return HttpResponse.json({ response: { results: [] } });
  }),

  /**
   * Simulate an unauthorized response.
   */
  unauthorized: http.get(`${BASE_URL}/obj/project`, () => {
    return HttpResponse.json(
      { status: "error", message: "Unauthorized" },
      { status: 401 }
    );
  }),
};

// ─── Combined Handlers ──────────────────────────────────────────────────────

export const handlers = [
  ...projectHandlers,
  ...taskHandlers,
  ...calendarEventHandlers,
  ...clientHandlers,
  ...userHandlers,
  ...companyHandlers,
  ...taskTypeHandlers,
  ...authWorkflowHandlers,
];
