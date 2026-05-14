import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { FilesViewV3 } from "../context-rail/files-view-v3";
import type { ProjectDocument } from "@/lib/api/services/project-file-service";
import type { ProjectPhoto } from "@/lib/types/pipeline";
import { ProjectStatus, type Project } from "@/lib/types/models";

/** Build a synthetic ProjectDocument. */
function doc(
  overrides: Partial<ProjectDocument> & Pick<ProjectDocument, "id">
): ProjectDocument {
  return {
    id: overrides.id,
    filename: overrides.filename ?? `Document ${overrides.id}.pdf`,
    sourceType: overrides.sourceType ?? "estimate",
    sourceId: overrides.sourceId ?? overrides.id,
    status: overrides.status ?? "draft",
    pdfStoragePath: overrides.pdfStoragePath ?? null,
    updatedAt: overrides.updatedAt ?? "2026-05-01T12:00:00.000Z",
    value: overrides.value ?? null,
  };
}

/** Build a synthetic ProjectPhoto. */
function photo(
  overrides: Partial<ProjectPhoto> & Pick<ProjectPhoto, "id" | "projectId">
): ProjectPhoto {
  return {
    id: overrides.id,
    projectId: overrides.projectId,
    companyId: overrides.companyId ?? "company-1",
    url: overrides.url ?? `/img/${overrides.id}.jpg`,
    thumbnailUrl: overrides.thumbnailUrl ?? null,
    source: overrides.source ?? "site_visit",
    siteVisitId: overrides.siteVisitId ?? null,
    uploadedBy: overrides.uploadedBy ?? "user-1",
    takenAt: overrides.takenAt ?? null,
    caption: overrides.caption ?? null,
    deletedAt: overrides.deletedAt ?? null,
    createdAt: overrides.createdAt ?? new Date("2026-05-01T12:00:00.000Z"),
    isClientVisible: overrides.isClientVisible ?? true,
  };
}

/** Build a synthetic Project — only fields the view consumes. */
function project(id: string, title: string): Project {
  return {
    id,
    title,
    address: null,
    latitude: null,
    longitude: null,
    startDate: null,
    endDate: null,
    duration: null,
    status: ProjectStatus.InProgress,
    notes: null,
    companyId: "company-1",
    clientId: "client-1",
    opportunityId: null,
    allDay: false,
    teamMemberIds: [],
    projectDescription: null,
    projectImages: [],
    trade: null,
    visibility: "all",
    createdAt: null,
    lastSyncedAt: null,
    needsSync: false,
    syncPriority: 0,
    deletedAt: null,
  };
}

describe("<FilesViewV3>", () => {
  it("defaults to the FILES sub-view with the toggle visible", () => {
    render(
      <FilesViewV3
        documents={[]}
        photos={[]}
        threadOnlyPhotos={[]}
        projects={[]}
      />
    );
    const filesToggle = screen.getByTestId("files-toggle-files");
    const photosToggle = screen.getByTestId("files-toggle-photos");
    expect(filesToggle.getAttribute("data-active")).toBe("true");
    expect(photosToggle.getAttribute("data-active")).toBe("false");
  });

  it("clicking [PHOTOS] switches the view", () => {
    render(
      <FilesViewV3
        documents={[]}
        photos={[]}
        threadOnlyPhotos={[]}
        projects={[]}
      />
    );
    fireEvent.click(screen.getByTestId("files-toggle-photos"));
    expect(
      screen.getByTestId("files-toggle-photos").getAttribute("data-active")
    ).toBe("true");
    expect(
      screen.getByTestId("files-toggle-files").getAttribute("data-active")
    ).toBe("false");
  });

  it("FILES sub-view shows the empty state when documents contains only estimates+invoices", () => {
    render(
      <FilesViewV3
        documents={[
          doc({ id: "e1", sourceType: "estimate" }),
          doc({ id: "i1", sourceType: "invoice" }),
        ]}
        photos={[]}
        threadOnlyPhotos={[]}
        projects={[]}
      />
    );
    expect(screen.getByTestId("files-toggle-files")).toHaveTextContent("0");
    expect(screen.getByTestId("files-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("files-contracts")).not.toBeInTheDocument();
  });

  it("FILES sub-view renders provider thread attachments as contracts", () => {
    const onFileOpen = vi.fn();
    const attachment = doc({
      id: "email-att-1",
      filename: "curb-flashing-field-measure.pdf",
      sourceType: "email_attachment",
      status: null,
      pdfStoragePath: "/api/inbox/threads/thread-1/attachments/att-1",
      updatedAt: "2026-05-07T12:00:00.000Z",
    });
    render(
      <FilesViewV3
        documents={[attachment]}
        photos={[]}
        threadOnlyPhotos={[]}
        projects={[]}
        onFileOpen={onFileOpen}
      />
    );

    expect(screen.getByTestId("files-contracts")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /curb-flashing/i }));
    expect(onFileOpen).toHaveBeenCalledWith(attachment);
  });

  it("PHOTOS sub-view groups photos by project and renders project name headers", () => {
    const p1 = project("proj-1", "Roof replacement");
    const p2 = project("proj-2", "Boiler swap");
    render(
      <FilesViewV3
        documents={[]}
        photos={[
          photo({ id: "ph1", projectId: "proj-1" }),
          photo({ id: "ph2", projectId: "proj-1" }),
          photo({ id: "ph3", projectId: "proj-2" }),
        ]}
        threadOnlyPhotos={[]}
        projects={[p1, p2]}
      />
    );
    fireEvent.click(screen.getByTestId("files-toggle-photos"));

    const proj1Group = screen.getByTestId("photos-group-proj-1");
    const proj2Group = screen.getByTestId("photos-group-proj-2");
    expect(proj1Group).toBeInTheDocument();
    expect(proj2Group).toBeInTheDocument();

    // Section headers are uppercased per spec.
    expect(proj1Group.textContent).toMatch(/ROOF REPLACEMENT/);
    expect(proj2Group.textContent).toMatch(/BOILER SWAP/);

    // Each project group renders a 3-col grid with one thumb per photo.
    const grid1 = screen.getByTestId("photos-group-proj-1-grid");
    expect(grid1.className).toMatch(/grid-cols-3/);
    expect(grid1.querySelectorAll("img")).toHaveLength(2);
  });

  it("renders the THIS THREAD section when threadOnlyPhotos is non-empty", () => {
    render(
      <FilesViewV3
        documents={[]}
        photos={[]}
        threadOnlyPhotos={[
          photo({ id: "tp1", projectId: "" }),
          photo({ id: "tp2", projectId: "" }),
        ]}
        projects={[]}
      />
    );
    fireEvent.click(screen.getByTestId("files-toggle-photos"));
    const thisThread = screen.getByTestId("photos-group-this-thread");
    expect(thisThread).toBeInTheDocument();
    expect(thisThread.textContent).toMatch(/THIS THREAD/);
    expect(thisThread.textContent).toMatch(/not assigned to a project/i);
  });

  it("hides the THIS THREAD section when threadOnlyPhotos is empty", () => {
    const p1 = project("proj-1", "Roof replacement");
    render(
      <FilesViewV3
        documents={[]}
        photos={[photo({ id: "ph1", projectId: "proj-1" })]}
        threadOnlyPhotos={[]}
        projects={[p1]}
      />
    );
    fireEvent.click(screen.getByTestId("files-toggle-photos"));
    expect(
      screen.queryByTestId("photos-group-this-thread")
    ).not.toBeInTheDocument();
  });

  it("PHOTOS sub-view shows the empty state when all three buckets are empty", () => {
    render(
      <FilesViewV3
        documents={[]}
        photos={[]}
        threadOnlyPhotos={[]}
        projects={[]}
      />
    );
    fireEvent.click(screen.getByTestId("files-toggle-photos"));
    expect(screen.getByText(/no photos attached/i)).toBeInTheDocument();
  });

  it("clicking a photo thumb fires onPhotoOpen with the right photo", () => {
    const onPhotoOpen = vi.fn();
    const p1 = project("proj-1", "Roof replacement");
    const photos = [
      photo({ id: "ph1", projectId: "proj-1" }),
      photo({ id: "ph2", projectId: "proj-1" }),
    ];
    render(
      <FilesViewV3
        documents={[]}
        photos={photos}
        threadOnlyPhotos={[]}
        projects={[p1]}
        onPhotoOpen={onPhotoOpen}
      />
    );
    fireEvent.click(screen.getByTestId("files-toggle-photos"));
    const grid = screen.getByTestId("photos-group-proj-1-grid");
    const buttons = grid.querySelectorAll("button");
    fireEvent.click(buttons[1]);
    expect(onPhotoOpen).toHaveBeenCalledWith(photos[1]);
  });
});
