// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import sharp from "sharp";
const wire = vi.hoisted(() => ({ all: true, image: Buffer.alloc(0) }));
vi.mock("node:https", () => ({
  request: (url: URL, options: any, response: (stream: any) => void) => {
    const request = new EventEmitter() as any;
    request.destroy = (error?: Error) => {
      if (error) request.emit("error", error);
      request.emit("close");
    };
    request.end = () =>
      queueMicrotask(() => {
        options.lookup(
          url.hostname,
          { all: wire.all },
          (error: Error | null, address: unknown, family: number) => {
            if (error) return request.emit("error", error);
            // Node requests an address array when autoSelectFamily asks for all records.
            const records = wire.all ? address : [{ address, family }];
            if (
              !Array.isArray(records) ||
              records.length !== 1 ||
              records[0].address !== "93.184.216.34" ||
              records[0].family !== 4
            )
              return request.emit(
                "error",
                new TypeError("Invalid pinned lookup response")
              );
            const incoming = new PassThrough() as any;
            incoming.statusCode = 200;
            incoming.headers = { "content-type": "image/png" };
            response(incoming);
            incoming.end(wire.image);
            request.emit("close");
          }
        );
      });
    return request;
  },
}));
import { downloadPublicImage } from "@/lib/social/public-media";
describe("pinned HTTPS lookup contract", () => {
  it.each([true, false])(
    "downloads through the real pinned fetcher when lookup all=%s",
    async (all) => {
      wire.all = all;
      wire.image = await sharp({
        create: { width: 20, height: 10, channels: 3, background: "#111111" },
      })
        .png()
        .toBuffer();
      const image = await downloadPublicImage(
        "https://images.example.com/photo.png",
        { lookup: async () => [{ address: "93.184.216.34", family: 4 }] }
      );
      expect(image.contentType).toBe("image/jpeg");
      expect(image.width).toBe(20);
      expect(image.height).toBe(10);
    }
  );
});
