import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { FilesView, type FileItem, type PhotoItem } from "../context-rail/files-view";

const photos: PhotoItem[] = [
  { id: "p1", url: "/img/p1.jpg", filename: "roof-1.jpg" },
  { id: "p2", url: "/img/p2.jpg", filename: "roof-2.jpg" },
  { id: "p3", url: "/img/p3.jpg", filename: "roof-3.jpg" },
  { id: "p4", url: "/img/p4.jpg", filename: "roof-4.jpg" },
];

const docs: FileItem[] = [
  { id: "d1", filename: "scope-of-work.pdf", size: 142_336, kind: "pdf", updatedAt: "2026-04-30" },
  { id: "d2", filename: "permit-app.docx", size: 31_872, kind: "doc", updatedAt: "2026-05-01" },
];

describe("<FilesView>", () => {
  it("renders the // IMAGES section label with count", () => {
    render(<FilesView photos={photos} documents={docs} />);
    expect(screen.getByText(/\/\/ IMAGES · 4/)).toBeInTheDocument();
  });

  it("renders the // DOCUMENTS section label with count", () => {
    render(<FilesView photos={photos} documents={docs} />);
    expect(screen.getByText(/\/\/ DOCUMENTS · 2/)).toBeInTheDocument();
  });

  it("renders one image cell per photo in a 3-col grid", () => {
    render(<FilesView photos={photos} documents={docs} />);
    const grid = screen.getByTestId("files-photo-grid");
    expect(grid.className).toMatch(/grid-cols-3/);
    expect(grid.querySelectorAll("img")).toHaveLength(4);
  });

  it("calls onPhotoOpen with the photo when a photo cell is clicked", () => {
    const onPhotoOpen = vi.fn();
    render(<FilesView photos={photos} documents={docs} onPhotoOpen={onPhotoOpen} />);
    const cells = screen.getAllByRole("button");
    fireEvent.click(cells[1]);
    expect(onPhotoOpen).toHaveBeenCalledWith(photos[1]);
  });

  it("renders one row per document with file name + size", () => {
    render(<FilesView photos={photos} documents={docs} />);
    expect(screen.getByText("scope-of-work.pdf")).toBeInTheDocument();
    expect(screen.getByText("permit-app.docx")).toBeInTheDocument();
  });

  it("hides the IMAGES section when zero photos", () => {
    render(<FilesView photos={[]} documents={docs} />);
    expect(screen.queryByText(/\/\/ IMAGES/)).not.toBeInTheDocument();
    expect(screen.getByText(/\/\/ DOCUMENTS/)).toBeInTheDocument();
  });

  it("hides the DOCUMENTS section when zero docs", () => {
    render(<FilesView photos={photos} documents={[]} />);
    expect(screen.queryByText(/\/\/ DOCUMENTS/)).not.toBeInTheDocument();
    expect(screen.getByText(/\/\/ IMAGES/)).toBeInTheDocument();
  });

  it("renders an empty state when neither photos nor docs", () => {
    render(<FilesView photos={[]} documents={[]} />);
    expect(screen.getByText(/no files attached/i)).toBeInTheDocument();
  });
});
