/**
 * Integration Tests for Project Operations
 *
 * Tests the full project lifecycle including listing, creating, updating,
 * deleting, filtering, and searching projects through the UI layer
 * with MSW intercepting API calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../mocks/server";
import {
  mockProject,
  mockProjects,
  mockProjectScenario,
  wrapBubbleList,
  wrapBubbleSingle,
  type ProjectDTO,
} from "../mocks/data";
import {
  renderWithProviders,
  createTestQueryClient,
  mockAuthStore,
  resetAuthStore,
} from "../utils/test-utils";
import { QueryClient, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const BASE_URL = "https://opsapp.co/api/1.1";

// ─── Minimal Project List Component for Testing ─────────────────────────────
// This acts as a stand-in for the real ProjectList component.
// Tests verify the data flow and interaction patterns.

function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const response = await fetch(`${BASE_URL}/obj/project`, {
        headers: {
          Authorization: "Bearer f81e9da85b7a12e996ac53e970a52299",
          "Content-Type": "application/json",
        },
      });
      const json = await response.json();
      return json.response.results as ProjectDTO[];
    },
  });
}

function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (project: Partial<ProjectDTO>) => {
      const response = await fetch(`${BASE_URL}/obj/project`, {
        method: "POST",
        headers: {
          Authorization: "Bearer f81e9da85b7a12e996ac53e970a52299",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(project),
      });
      const json = await response.json();
      return json.response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

function useUpdateProjectStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      projectId,
      status,
    }: {
      projectId: string;
      status: string;
    }) => {
      const response = await fetch(`${BASE_URL}/wf/update_project_status`, {
        method: "POST",
        headers: {
          Authorization: "Bearer f81e9da85b7a12e996ac53e970a52299",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ project_id: projectId, status }),
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (projectId: string) => {
      const response = await fetch(`${BASE_URL}/wf/delete_project`, {
        method: "POST",
        headers: {
          Authorization: "Bearer f81e9da85b7a12e996ac53e970a52299",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ project_id: projectId }),
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

function ProjectListTestComponent({
  filterStatus,
  searchQuery,
}: {
  filterStatus?: string;
  searchQuery?: string;
}) {
  const { data: projects, isLoading, error } = useProjects();
  const createProject = useCreateProject();
  const updateStatus = useUpdateProjectStatus();
  const deleteProject = useDeleteProject();

  if (isLoading) return <div data-testid="loading">Loading projects...</div>;
  if (error) return <div data-testid="error">Error: {error.message}</div>;
  if (!projects || projects.length === 0)
    return <div data-testid="empty">No projects found</div>;

  let filteredProjects = projects;

  if (filterStatus) {
    filteredProjects = filteredProjects.filter((p) => p.status === filterStatus);
  }

  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    filteredProjects = filteredProjects.filter(
      (p) =>
        p.projectName.toLowerCase().includes(query) ||
        p.address.toLowerCase().includes(query) ||
        p.clientName.toLowerCase().includes(query)
    );
  }

  return (
    <div>
      <h1>Projects ({filteredProjects.length})</h1>
      <button
        data-testid="create-project-btn"
        onClick={() =>
          createProject.mutate({
            projectName: "New Test Project",
            status: "RFQ",
            address: "123 Test St",
          })
        }
      >
        Create Project
      </button>
      <ul data-testid="project-list">
        {filteredProjects.map((project) => (
          <li key={project._id} data-testid={`project-${project._id}`}>
            <span data-testid="project-name">{project.projectName}</span>
            <span data-testid="project-status">{project.status}</span>
            <span data-testid="project-address">{project.address}</span>
            <span data-testid="project-client">{project.clientName}</span>
            <button
              data-testid={`update-status-${project._id}`}
              onClick={() =>
                updateStatus.mutate({
                  projectId: project._id,
                  status: "Completed",
                })
              }
            >
              Complete
            </button>
            <button
              data-testid={`delete-${project._id}`}
              onClick={() => deleteProject.mutate(project._id)}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      {createProject.isPending && <div data-testid="creating">Creating...</div>}
      {updateStatus.isPending && <div data-testid="updating">Updating...</div>}
      {deleteProject.isPending && <div data-testid="deleting">Deleting...</div>}
    </div>
  );
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe("Project Integration Tests", () => {
  beforeEach(() => {
    mockAuthStore();
  });

  afterEach(() => {
    resetAuthStore();
  });

  // ─── Fetching and Displaying ────────────────────────────────────────

  describe("Fetching and displaying project list", () => {
    it("shows loading state while fetching", () => {
      renderWithProviders(<ProjectListTestComponent />);
      expect(screen.getByTestId("loading")).toBeInTheDocument();
    });

    it("displays projects after fetch completes", async () => {
      const projects = mockProjects(3);
      server.use(
        http.get(`${BASE_URL}/obj/project`, () => {
          return HttpResponse.json(wrapBubbleList(projects));
        })
      );

      renderWithProviders(<ProjectListTestComponent />);

      await waitFor(() => {
        expect(screen.queryByTestId("loading")).not.toBeInTheDocument();
      });

      const projectList = screen.getByTestId("project-list");
      const items = within(projectList).getAllByRole("listitem");
      expect(items).toHaveLength(3);
    });

    it("displays project names correctly", async () => {
      const projects = [
        mockProject({ projectName: "Kitchen Renovation - Smith Residence" }),
        mockProject({ projectName: "Roof Repair - Johnson Home" }),
      ];
      server.use(
        http.get(`${BASE_URL}/obj/project`, () => {
          return HttpResponse.json(wrapBubbleList(projects));
        })
      );

      renderWithProviders(<ProjectListTestComponent />);

      await waitFor(() => {
        expect(screen.getByText("Kitchen Renovation - Smith Residence")).toBeInTheDocument();
        expect(screen.getByText("Roof Repair - Johnson Home")).toBeInTheDocument();
      });
    });

    it("displays empty state when no projects", async () => {
      server.use(
        http.get(`${BASE_URL}/obj/project`, () => {
          return HttpResponse.json(wrapBubbleList([]));
        })
      );

      renderWithProviders(<ProjectListTestComponent />);

      await waitFor(() => {
        expect(screen.getByTestId("empty")).toBeInTheDocument();
        expect(screen.getByText("No projects found")).toBeInTheDocument();
      });
    });

    it("displays error state on fetch failure", async () => {
      server.use(
        http.get(`${BASE_URL}/obj/project`, () => {
          return HttpResponse.json(
            { status: "error", message: "Server error" },
            { status: 500 }
          );
        })
      );

      renderWithProviders(<ProjectListTestComponent />);

      await waitFor(() => {
        expect(screen.getByTestId("error")).toBeInTheDocument();
      });
    });
  });

  // ─── Creating a New Project ─────────────────────────────────────────

  describe("Creating a new project", () => {
    it("sends create request when button is clicked", async () => {
      const user = userEvent.setup();
      let createCalled = false;
      let createBody: unknown = null;

      server.use(
        http.get(`${BASE_URL}/obj/project`, () => {
          return HttpResponse.json(wrapBubbleList(mockProjects(1)));
        }),
        http.post(`${BASE_URL}/obj/project`, async ({ request }) => {
          createCalled = true;
          createBody = await request.json();
          return HttpResponse.json(
            { response: mockProject({ projectName: "New Test Project" }) },
            { status: 201 }
          );
        })
      );

      renderWithProviders(<ProjectListTestComponent />);

      await waitFor(() => {
        expect(screen.queryByTestId("loading")).not.toBeInTheDocument();
      });

      const createBtn = screen.getByTestId("create-project-btn");
      await user.click(createBtn);

      await waitFor(() => {
        expect(createCalled).toBe(true);
      });

      expect(createBody).toEqual({
        projectName: "New Test Project",
        status: "RFQ",
        address: "123 Test St",
      });
    });

    it("shows creating indicator while mutation is in flight", async () => {
      const user = userEvent.setup();

      server.use(
        http.get(`${BASE_URL}/obj/project`, () => {
          return HttpResponse.json(wrapBubbleList(mockProjects(1)));
        }),
        http.post(`${BASE_URL}/obj/project`, async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return HttpResponse.json(
            { response: mockProject() },
            { status: 201 }
          );
        })
      );

      renderWithProviders(<ProjectListTestComponent />);

      await waitFor(() => {
        expect(screen.queryByTestId("loading")).not.toBeInTheDocument();
      });

      await user.click(screen.getByTestId("create-project-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("creating")).toBeInTheDocument();
      });
    });
  });

  // ─── Updating Project Status ────────────────────────────────────────

  describe("Updating project status", () => {
    it("sends status update workflow request", async () => {
      const user = userEvent.setup();
      let updateCalled = false;
      let updateBody: unknown = null;

      const projects = [mockProject({ _id: "proj-update-test" })];

      server.use(
        http.get(`${BASE_URL}/obj/project`, () => {
          return HttpResponse.json(wrapBubbleList(projects));
        }),
        http.post(`${BASE_URL}/wf/update_project_status`, async ({ request }) => {
          updateCalled = true;
          updateBody = await request.json();
          return HttpResponse.json({
            status: "success",
            response: { project_id: "proj-update-test", new_status: "Completed" },
          });
        })
      );

      renderWithProviders(<ProjectListTestComponent />);

      await waitFor(() => {
        expect(screen.queryByTestId("loading")).not.toBeInTheDocument();
      });

      const updateBtn = screen.getByTestId("update-status-proj-update-test");
      await user.click(updateBtn);

      await waitFor(() => {
        expect(updateCalled).toBe(true);
      });

      expect(updateBody).toEqual({
        project_id: "proj-update-test",
        status: "Completed",
      });
    });
  });

  // ─── Soft Deleting a Project ────────────────────────────────────────

  describe("Soft deleting a project", () => {
    it("sends delete workflow request", async () => {
      const user = userEvent.setup();
      let deleteCalled = false;
      let deleteBody: unknown = null;

      const projects = [mockProject({ _id: "proj-delete-test" })];

      server.use(
        http.get(`${BASE_URL}/obj/project`, () => {
          return HttpResponse.json(wrapBubbleList(projects));
        }),
        http.post(`${BASE_URL}/wf/delete_project`, async ({ request }) => {
          deleteCalled = true;
          deleteBody = await request.json();
          return HttpResponse.json({
            status: "success",
            response: { project_id: "proj-delete-test", deleted: true },
          });
        })
      );

      renderWithProviders(<ProjectListTestComponent />);

      await waitFor(() => {
        expect(screen.queryByTestId("loading")).not.toBeInTheDocument();
      });

      const deleteBtn = screen.getByTestId("delete-proj-delete-test");
      await user.click(deleteBtn);

      await waitFor(() => {
        expect(deleteCalled).toBe(true);
      });

      expect(deleteBody).toEqual({ project_id: "proj-delete-test" });
    });

    it("shows deleting indicator during delete", async () => {
      const user = userEvent.setup();
      const projects = [mockProject({ _id: "proj-del-loading" })];

      server.use(
        http.get(`${BASE_URL}/obj/project`, () => {
          return HttpResponse.json(wrapBubbleList(projects));
        }),
        http.post(`${BASE_URL}/wf/delete_project`, async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return HttpResponse.json({ status: "success" });
        })
      );

      renderWithProviders(<ProjectListTestComponent />);

      await waitFor(() => {
        expect(screen.queryByTestId("loading")).not.toBeInTheDocument();
      });

      await user.click(screen.getByTestId("delete-proj-del-loading"));

      await waitFor(() => {
        expect(screen.getByTestId("deleting")).toBeInTheDocument();
      });
    });
  });

  // ─── Filtering Projects by Status ───────────────────────────────────

  describe("Filtering projects by status", () => {
    it("filters to show only 'In Progress' projects", async () => {
      const projects = [
        mockProject({ _id: "p1", projectName: "Active Project", status: "In Progress" }),
        mockProject({ _id: "p2", projectName: "Complete Project", status: "Completed" }),
        mockProject({ _id: "p3", projectName: "Another Active", status: "In Progress" }),
      ];

      server.use(
        http.get(`${BASE_URL}/obj/project`, () => {
          return HttpResponse.json(wrapBubbleList(projects));
        })
      );

      renderWithProviders(<ProjectListTestComponent filterStatus="In Progress" />);

      await waitFor(() => {
        expect(screen.queryByTestId("loading")).not.toBeInTheDocument();
      });

      const items = within(screen.getByTestId("project-list")).getAllByRole("listitem");
      expect(items).toHaveLength(2);
      expect(screen.getByText("Active Project")).toBeInTheDocument();
      expect(screen.getByText("Another Active")).toBeInTheDocument();
      expect(screen.queryByText("Complete Project")).not.toBeInTheDocument();
    });

    it("filters to show only 'RFQ' projects", async () => {
      const projects = [
        mockProject({ _id: "p1", projectName: "RFQ Project", status: "RFQ" }),
        mockProject({ _id: "p2", projectName: "Active Project", status: "In Progress" }),
      ];

      server.use(
        http.get(`${BASE_URL}/obj/project`, () => {
          return HttpResponse.json(wrapBubbleList(projects));
        })
      );

      renderWithProviders(<ProjectListTestComponent filterStatus="RFQ" />);

      await waitFor(() => {
        expect(screen.queryByTestId("loading")).not.toBeInTheDocument();
      });

      const items = within(screen.getByTestId("project-list")).getAllByRole("listitem");
      expect(items).toHaveLength(1);
      expect(screen.getByText("RFQ Project")).toBeInTheDocument();
    });

    it("shows empty when filter matches nothing", async () => {
      const projects = [
        mockProject({ _id: "p1", status: "In Progress" }),
        mockProject({ _id: "p2", status: "Completed" }),
      ];

      server.use(
        http.get(`${BASE_URL}/obj/project`, () => {
          return HttpResponse.json(wrapBubbleList(projects));
        })
      );

      renderWithProviders(<ProjectListTestComponent filterStatus="Archived" />);

      await waitFor(() => {
        expect(screen.queryByTestId("loading")).not.toBeInTheDocument();
      });

      // When filtered to empty, should show the count as 0
      expect(screen.getByText("Projects (0)")).toBeInTheDocument();
    });
  });

  // ─── Search Functionality ───────────────────────────────────────────

  describe("Search functionality", () => {
    it("searches by project name", async () => {
      const projects = [
        mockProject({ _id: "p1", projectName: "Kitchen Renovation" }),
        mockProject({ _id: "p2", projectName: "Roof Repair" }),
        mockProject({ _id: "p3", projectName: "Kitchen Remodel" }),
      ];

      server.use(
        http.get(`${BASE_URL}/obj/project`, () => {
          return HttpResponse.json(wrapBubbleList(projects));
        })
      );

      renderWithProviders(<ProjectListTestComponent searchQuery="kitchen" />);

      await waitFor(() => {
        expect(screen.queryByTestId("loading")).not.toBeInTheDocument();
      });

      expect(screen.getByText("Kitchen Renovation")).toBeInTheDocument();
      expect(screen.getByText("Kitchen Remodel")).toBeInTheDocument();
      expect(screen.queryByText("Roof Repair")).not.toBeInTheDocument();
    });

    it("searches by address", async () => {
      const projects = [
        mockProject({ _id: "p1", projectName: "Project A", address: "1425 Oak Valley Dr" }),
        mockProject({ _id: "p2", projectName: "Project B", address: "2810 South Lamar Blvd" }),
      ];

      server.use(
        http.get(`${BASE_URL}/obj/project`, () => {
          return HttpResponse.json(wrapBubbleList(projects));
        })
      );

      renderWithProviders(<ProjectListTestComponent searchQuery="oak valley" />);

      await waitFor(() => {
        expect(screen.queryByTestId("loading")).not.toBeInTheDocument();
      });

      expect(screen.getByText("Project A")).toBeInTheDocument();
      expect(screen.queryByText("Project B")).not.toBeInTheDocument();
    });

    it("searches by client name", async () => {
      const projects = [
        mockProject({ _id: "p1", projectName: "Proj 1", clientName: "John Smith" }),
        mockProject({ _id: "p2", projectName: "Proj 2", clientName: "Sarah Martinez" }),
      ];

      server.use(
        http.get(`${BASE_URL}/obj/project`, () => {
          return HttpResponse.json(wrapBubbleList(projects));
        })
      );

      renderWithProviders(<ProjectListTestComponent searchQuery="smith" />);

      await waitFor(() => {
        expect(screen.queryByTestId("loading")).not.toBeInTheDocument();
      });

      expect(screen.getByText("Proj 1")).toBeInTheDocument();
      expect(screen.queryByText("Proj 2")).not.toBeInTheDocument();
    });

    it("search is case-insensitive", async () => {
      const projects = [
        mockProject({ _id: "p1", projectName: "KITCHEN renovation" }),
      ];

      server.use(
        http.get(`${BASE_URL}/obj/project`, () => {
          return HttpResponse.json(wrapBubbleList(projects));
        })
      );

      renderWithProviders(<ProjectListTestComponent searchQuery="Kitchen" />);

      await waitFor(() => {
        expect(screen.queryByTestId("loading")).not.toBeInTheDocument();
      });

      expect(screen.getByText("KITCHEN renovation")).toBeInTheDocument();
    });
  });
});
