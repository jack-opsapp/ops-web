import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PhotoBubble, photoGridCols } from "../photo-bubble";

const PHOTOS = [
  { id: "p1", url: "/img/p1.jpg", alt: "roof-1.jpg" },
  { id: "p2", url: "/img/p2.jpg", alt: "roof-2.jpg" },
  { id: "p3", url: "/img/p3.jpg", alt: "roof-3.jpg" },
  { id: "p4", url: "/img/p4.jpg", alt: "roof-4.jpg" },
  { id: "p5", url: "/img/p5.jpg", alt: "roof-5.jpg" },
  { id: "p6", url: "/img/p6.jpg", alt: "roof-6.jpg" },
  { id: "p7", url: "/img/p7.jpg", alt: "roof-7.jpg" },
];

describe("photoGridCols", () => {
  it("returns 1 column for one photo", () => {
    expect(photoGridCols(1)).toBe(1);
  });

  it("returns 2 columns for two photos", () => {
    expect(photoGridCols(2)).toBe(2);
  });

  it("returns 2 columns for three or more photos (Phase F3 2x2 grid)", () => {
    expect(photoGridCols(3)).toBe(2);
    expect(photoGridCols(4)).toBe(2);
    expect(photoGridCols(7)).toBe(2);
  });

  it("returns 0 for zero photos", () => {
    expect(photoGridCols(0)).toBe(0);
  });
});

describe("<PhotoBubble>", () => {
  it("renders nothing when photos array is empty", () => {
    const { container } = render(
      <PhotoBubble direction="inbound" photos={[]} senderName="Jeanne" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("uses 1-column grid for a single photo and renders one image", () => {
    render(
      <PhotoBubble
        direction="inbound"
        photos={[PHOTOS[0]]}
        senderName="Jeanne"
      />,
    );
    expect(screen.getByTestId("photo-grid").className).toMatch(/grid-cols-1/);
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.queryByTestId("photo-overflow")).toBeNull();
  });

  it("uses 2-column grid for two photos and renders both", () => {
    render(
      <PhotoBubble
        direction="inbound"
        photos={PHOTOS.slice(0, 2)}
        senderName="Jeanne"
      />,
    );
    expect(screen.getByTestId("photo-grid").className).toMatch(/grid-cols-2/);
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(screen.queryByTestId("photo-overflow")).toBeNull();
  });

  it("uses 2-column grid for three photos with no overflow", () => {
    render(
      <PhotoBubble
        direction="inbound"
        photos={PHOTOS.slice(0, 3)}
        senderName="Jeanne"
      />,
    );
    expect(screen.getByTestId("photo-grid").className).toMatch(/grid-cols-2/);
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(screen.queryByTestId("photo-overflow")).toBeNull();
  });

  it("uses 2-column grid for four photos with no overflow (all visible)", () => {
    render(
      <PhotoBubble
        direction="inbound"
        photos={PHOTOS.slice(0, 4)}
        senderName="Jeanne"
      />,
    );
    expect(screen.getByTestId("photo-grid").className).toMatch(/grid-cols-2/);
    expect(screen.getAllByRole("button")).toHaveLength(4);
    expect(screen.queryByTestId("photo-overflow")).toBeNull();
  });

  it("renders overflow overlay on the 4th cell for 5 photos with +1 MORE", () => {
    render(
      <PhotoBubble
        direction="inbound"
        photos={PHOTOS.slice(0, 5)}
        senderName="Jeanne"
      />,
    );
    // Only 4 cells render — the rest are hidden behind the overflow.
    expect(screen.getAllByRole("button")).toHaveLength(4);
    const overlay = screen.getByTestId("photo-overflow");
    expect(overlay).toBeInTheDocument();
    expect(overlay.textContent).toBe("+1 MORE");
  });

  it("shows +3 MORE for 7 photos and still renders only 4 cells", () => {
    render(
      <PhotoBubble
        direction="inbound"
        photos={PHOTOS}
        senderName="Jeanne"
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(4);
    const overlay = screen.getByTestId("photo-overflow");
    expect(overlay.textContent).toBe("+3 MORE");
  });

  it("calls onPhotoClick with photo + index when a non-overlay cell is clicked", () => {
    const onPhotoClick = vi.fn();
    render(
      <PhotoBubble
        direction="inbound"
        photos={PHOTOS.slice(0, 4)}
        senderName="Jeanne"
        onPhotoClick={onPhotoClick}
      />,
    );
    const cells = screen.getAllByRole("button");
    fireEvent.click(cells[1]);
    expect(onPhotoClick).toHaveBeenCalledWith(PHOTOS[1], 1);
  });

  it("calls onPhotoClick when the overlay (4th) cell is clicked — overlay does not block clicks", () => {
    const onPhotoClick = vi.fn();
    render(
      <PhotoBubble
        direction="inbound"
        photos={PHOTOS.slice(0, 6)}
        senderName="Jeanne"
        onPhotoClick={onPhotoClick}
      />,
    );
    const cells = screen.getAllByRole("button");
    expect(cells).toHaveLength(4);
    fireEvent.click(cells[3]);
    // The 4th cell wraps photos[3], even though it carries the +N MORE overlay.
    expect(onPhotoClick).toHaveBeenCalledWith(PHOTOS[3], 3);
  });

  it("renders body text below the grid when provided", () => {
    render(
      <PhotoBubble
        direction="inbound"
        photos={PHOTOS.slice(0, 4)}
        senderName="Jeanne"
        body="Here are the photos"
      />,
    );
    expect(screen.getByText("Here are the photos")).toBeInTheDocument();
  });

  it("renders the tactical uppercase plural meta for >1 photo (e.g. '5 PHOTOS')", () => {
    render(
      <PhotoBubble
        direction="inbound"
        photos={PHOTOS.slice(0, 5)}
        senderName="Jeanne"
      />,
    );
    expect(screen.getByText("5 PHOTOS")).toBeInTheDocument();
  });

  it("renders singular meta for one photo ('1 PHOTO')", () => {
    render(
      <PhotoBubble
        direction="inbound"
        photos={[PHOTOS[0]]}
        senderName="Jeanne"
      />,
    );
    expect(screen.getByText("1 PHOTO")).toBeInTheDocument();
  });
});
