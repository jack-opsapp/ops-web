import { describe, expect, it } from "vitest";

import { removeSolidBackgroundFromPixels } from "@/lib/images/remove-solid-background";

type Rgba = [number, number, number, number];

const WHITE: Rgba = [255, 255, 255, 255];
const RED: Rgba = [200, 30, 30, 255];
/** 35 off white — past the fill tolerance, inside the feather tolerance. */
const NEAR_WHITE: Rgba = [220, 220, 220, 255];

class Bitmap {
  readonly data: Uint8ClampedArray;

  constructor(
    readonly width: number,
    readonly height: number,
    fill: Rgba
  ) {
    this.data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i += 1) this.set(i % width, Math.floor(i / width), fill);
  }

  set(x: number, y: number, [r, g, b, a]: Rgba): void {
    const offset = (y * this.width + x) * 4;
    this.data[offset] = r;
    this.data[offset + 1] = g;
    this.data[offset + 2] = b;
    this.data[offset + 3] = a;
  }

  fillRect(x0: number, y0: number, x1: number, y1: number, color: Rgba): void {
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) this.set(x, y, color);
    }
  }

  pixel(x: number, y: number): Rgba {
    const offset = (y * this.width + x) * 4;
    return [
      this.data[offset],
      this.data[offset + 1],
      this.data[offset + 2],
      this.data[offset + 3],
    ];
  }

  alpha(x: number, y: number): number {
    return this.data[(y * this.width + x) * 4 + 3];
  }

  run(): { applied: boolean } {
    return removeSolidBackgroundFromPixels(this.data, this.width, this.height);
  }
}

describe("removeSolidBackgroundFromPixels", () => {
  it("clears a solid white field and leaves the mark untouched", () => {
    const image = new Bitmap(20, 20, WHITE);
    image.fillRect(6, 6, 13, 13, RED);

    expect(image.run()).toEqual({ applied: true });

    // Every corner is background, so every corner goes.
    expect(image.alpha(0, 0)).toBe(0);
    expect(image.alpha(19, 0)).toBe(0);
    expect(image.alpha(0, 19)).toBe(0);
    expect(image.alpha(19, 19)).toBe(0);

    // The mark survives whole — colour untouched, fully opaque, edge to edge.
    expect(image.pixel(10, 10)).toEqual(RED);
    expect(image.pixel(6, 6)).toEqual(RED);
    expect(image.pixel(13, 13)).toEqual(RED);
  });

  it("leaves an enclosed white hole inside the mark alone", () => {
    const image = new Bitmap(24, 24, WHITE);
    image.fillRect(5, 5, 18, 18, RED);
    image.fillRect(10, 10, 13, 13, WHITE);

    expect(image.run()).toEqual({ applied: true });

    // The fill is seeded from the border only, so a counter or the hole in a
    // letter stays white instead of punching through to whatever is behind.
    expect(image.pixel(11, 11)).toEqual(WHITE);
    expect(image.alpha(12, 12)).toBe(255);
    // Outside the mark, the same white is gone.
    expect(image.alpha(1, 1)).toBe(0);
  });

  it("leaves a gradient background exactly as it found it", () => {
    const image = new Bitmap(20, 20, WHITE);
    for (let y = 0; y < 20; y += 1) {
      for (let x = 0; x < 20; x += 1) {
        const value = x * 12;
        image.set(x, y, [value, value, value, 255]);
      }
    }
    const before = Uint8ClampedArray.from(image.data);

    expect(image.run()).toEqual({ applied: false });
    expect(image.data).toEqual(before);
  });

  it("keeps a mark that runs off the edge of the image", () => {
    const image = new Bitmap(40, 40, WHITE);
    image.fillRect(0, 18, 5, 21, RED);

    expect(image.run()).toEqual({ applied: true });

    // The mark owns a sliver of the border; the background is still solid.
    expect(image.pixel(0, 19)).toEqual(RED);
    expect(image.pixel(5, 19)).toEqual(RED);
    // The fill walks around the mark rather than stopping at it.
    expect(image.alpha(0, 0)).toBe(0);
    expect(image.alpha(6, 19)).toBe(0);
    expect(image.alpha(0, 25)).toBe(0);
  });

  it("softens the anti-aliased rim instead of cutting a jagged edge", () => {
    const image = new Bitmap(12, 12, WHITE);
    image.fillRect(3, 3, 8, 8, NEAR_WHITE);
    image.fillRect(4, 4, 7, 7, RED);

    expect(image.run()).toEqual({ applied: true });

    // Too far from the background to clear, close enough to half-fade.
    expect(image.pixel(3, 3)).toEqual([220, 220, 220, 128]);
    expect(image.pixel(8, 5)).toEqual([220, 220, 220, 128]);
    // The mark itself never fades.
    expect(image.pixel(5, 5)).toEqual(RED);
  });

  it("reports nothing done when the background was already cut out", () => {
    const image = new Bitmap(16, 16, [0, 0, 0, 0]);
    image.fillRect(5, 5, 10, 10, RED);
    const before = Uint8ClampedArray.from(image.data);

    // A transparent border is a logo somebody already cleaned up. Re-cutting it
    // would flood the mark's own black pixels away.
    expect(image.run()).toEqual({ applied: false });
    expect(image.data).toEqual(before);
  });

  it("refuses to read past the end of a short buffer", () => {
    expect(
      removeSolidBackgroundFromPixels(new Uint8ClampedArray(8), 4, 4)
    ).toEqual({ applied: false });
    expect(
      removeSolidBackgroundFromPixels(new Uint8ClampedArray(0), 0, 0)
    ).toEqual({ applied: false });
  });
});
