import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PhotoBubble, photoGridCols } from "../photo-bubble";

const PHOTOS = [
  { id: "p1", url: "/img/p1.jpg", alt: "roof-1.jpg" },
  { id: "p2", url: "/img/p2.jpg", alt: "roof-2.jpg" },
  { id: "p3", url: "/img/p3.jpg", alt: "roof-3.jpg" },
  { id: "p4", url: "/img/p4.jpg", alt: "roof-4.jpg" },
];

describe("photoGridCols", () => {
  it("returns 1 column for one photo", () => {
    expect(photoGridCols(1)).toBe(1);
  });

  it("returns 2 columns for two photos", () => {
    expect(photoGridCols(2)).toBe(2);
  });

  it("returns 3 columns for three or more photos", () => {
    expect(photoGridCols(3)).toBe(3);
    expect(photoGridCols(7)).toBe(3);
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

  it("renders one image per photo", () => {
    render(
      <PhotoBubble direction="inbound" photos={PHOTOS} senderName="Jeanne" />,
    );
    const imgs = screen.getAllByRole("img");
    expect(imgs).toHaveLength(4);
  });

  it("uses 3-column grid for >= 3 photos", () => {
    render(
      <PhotoBubble direction="inbound" photos={PHOTOS} senderName="Jeanne" />,
    );
    expect(screen.getByTestId("photo-grid").className).toMatch(/grid-cols-3/);
  });

  it("uses 1-column grid for a single photo", () => {
    render(
      <PhotoBubble
        direction="inbound"
        photos={[PHOTOS[0]]}
        senderName="Jeanne"
      />,
    );
    expect(screen.getByTestId("photo-grid").className).toMatch(/grid-cols-1/);
  });

  it("calls onPhotoClick with photo + index when a cell is clicked", () => {
    const onPhotoClick = vi.fn();
    render(
      <PhotoBubble
        direction="inbound"
        photos={PHOTOS}
        senderName="Jeanne"
        onPhotoClick={onPhotoClick}
      />,
    );
    const cells = screen.getAllByRole("button");
    fireEvent.click(cells[1]);
    expect(onPhotoClick).toHaveBeenCalledWith(PHOTOS[1], 1);
  });

  it("renders body text below the grid when provided", () => {
    render(
      <PhotoBubble
        direction="inbound"
        photos={PHOTOS}
        senderName="Jeanne"
        body="Here are the photos"
      />,
    );
    expect(screen.getByText("Here are the photos")).toBeInTheDocument();
  });

  it("surfaces the photo count in the meta row", () => {
    render(
      <PhotoBubble direction="inbound" photos={PHOTOS} senderName="Jeanne" />,
    );
    expect(screen.getByText(/4 photos/i)).toBeInTheDocument();
  });
});
