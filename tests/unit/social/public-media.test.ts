import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  PublicMediaError,
  downloadPublicImage,
  validatePublicMediaUrl,
  type PublicMediaDependencies,
} from "@/lib/social/public-media";

const publicLookup: PublicMediaDependencies["lookup"] = async () => [
  { address: "93.184.216.34", family: 4 },
];

async function pngFixture(): Promise<Buffer> {
  return sharp({
    create: { width: 20, height: 10, channels: 3, background: "#202020" },
  })
    .png()
    .toBuffer();
}

describe("public social media guard", () => {
  it.each([
    "http://example.com/image.jpg",
    "https://user:password@example.com/image.jpg",
    "https://example.com:8443/image.jpg",
    "https://localhost/image.jpg",
    "https://127.0.0.1/image.jpg",
    "https://169.254.169.254/latest/meta-data",
    "https://10.0.0.4/image.jpg",
    "https://[::1]/image.jpg",
    "https://[fc00::1]/image.jpg",
    "https://[::ffff:127.0.0.1]/image.jpg",
    "https://[::ffff:7f00:1]/image.jpg",
  ])("rejects unsafe URL %s", async (url) => {
    await expect(validatePublicMediaUrl(url, { lookup: publicLookup })).rejects.toBeInstanceOf(
      PublicMediaError
    );
  });

  it("rejects a public hostname that resolves to a private address", async () => {
    await expect(
      validatePublicMediaUrl("https://images.example.com/job.jpg", {
        lookup: async () => [{ address: "192.168.1.10", family: 4 }],
      })
    ).rejects.toMatchObject({ code: "PRIVATE_ADDRESS" });
  });

  it("revalidates every redirect before following it", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://127.0.0.1/private.jpg" },
        })
      );

    await expect(
      downloadPublicImage("https://images.example.com/job.jpg", { lookup: publicLookup, fetcher })
    ).rejects.toMatchObject({ code: "PRIVATE_ADDRESS" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("pins the validated DNS address for the network connection", async () => {
    const png = await pngFixture();
    const fetcher: PublicMediaDependencies["fetcher"] = vi.fn(
      async (_url, _init, pinnedAddress) => {
        expect(pinnedAddress).toEqual({ address: "93.184.216.34", family: 4 });
        return new Response(Uint8Array.from(png), {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }
    );

    await downloadPublicImage("https://images.example.com/job.png", {
      lookup: publicLookup,
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects non-image responses and oversized bodies", async () => {
    const textFetcher = vi.fn().mockResolvedValue(
      new Response("not an image", { status: 200, headers: { "content-type": "text/plain" } })
    );
    const largeFetcher = vi.fn().mockResolvedValue(
      new Response(new Uint8Array(13 * 1024 * 1024), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      })
    );

    await expect(
      downloadPublicImage("https://images.example.com/file.txt", {
        lookup: publicLookup,
        fetcher: textFetcher,
      })
    ).rejects.toMatchObject({ code: "INVALID_CONTENT_TYPE" });
    await expect(
      downloadPublicImage("https://images.example.com/large.jpg", {
        lookup: publicLookup,
        fetcher: largeFetcher,
      })
    ).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });
  });

  it("stops reading a streamed body as soon as it crosses the 12 MB limit", async () => {
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(1024 * 1024));
        if (pulls === 20) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetcher = vi.fn().mockResolvedValue(
      new Response(body, { status: 200, headers: { "content-type": "image/jpeg" } })
    );

    await expect(
      downloadPublicImage("https://images.example.com/large.jpg", {
        lookup: publicLookup,
        fetcher,
      })
    ).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });
    expect(pulls).toBeLessThan(20);
    expect(cancelled).toBe(true);
  });

  it("normalizes supported images to metadata-free JPEG", async () => {
    const png = await pngFixture();
    const fetcher = vi.fn().mockResolvedValue(
      new Response(Uint8Array.from(png), {
        status: 200,
        headers: { "content-type": "image/png" },
      })
    );

    const result = await downloadPublicImage("https://images.example.com/job.png", {
      lookup: publicLookup,
      fetcher,
    });
    const metadata = await sharp(result.buffer).metadata();

    expect(result.contentType).toBe("image/jpeg");
    expect(result.width).toBe(20);
    expect(result.height).toBe(10);
    expect(metadata.format).toBe("jpeg");
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
  });

  it("maps fetch failures to an operator-safe timeout error", async () => {
    const fetcher = vi.fn().mockRejectedValue(new DOMException("timed out", "AbortError"));

    await expect(
      downloadPublicImage("https://images.example.com/job.jpg", {
        lookup: publicLookup,
        fetcher,
      })
    ).rejects.toMatchObject({ code: "FETCH_TIMEOUT" });
  });
});
