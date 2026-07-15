/**
 * uploadImage / uploadMultipleImages — auth regression pin.
 *
 * `/api/uploads/presign` rejects anonymous calls (401) since the S3-migration
 * security tightening. The legacy image service called it with a bare `fetch`
 * and no Authorization header, which broke every photo-attach flow riding it
 * (project gallery, note composer, site visits, photo markup). These tests
 * pin the Firebase bearer onto the multipart direct-upload request.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getIdTokenMock } = vi.hoisted(() => ({ getIdTokenMock: vi.fn() }));
vi.mock("@/lib/firebase/auth", () => ({ getIdToken: getIdTokenMock }));

import {
  uploadImage,
  uploadMultipleImages,
} from "@/lib/api/services/image-service";

const fetchMock = vi.fn();

/** Tiny JPEG stub — under the 2MB compress threshold so no canvas work runs. */
function jpeg(name: string): File {
  return new File([new Uint8Array([0xff, 0xd8, 0xff])], name, {
    type: "image/jpeg",
  });
}

function uploadResponse(url: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ url, publicUrl: url }),
  };
}

function authHeaderOf(call: unknown[]): string | undefined {
  const init = call[1] as RequestInit;
  return (init.headers as Record<string, string>).Authorization;
}

beforeEach(() => {
  fetchMock.mockReset();
  getIdTokenMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadImage", () => {
  it("sends the Firebase bearer with the multipart upload", async () => {
    getIdTokenMock.mockResolvedValue("test-jwt");
    fetchMock.mockResolvedValueOnce(
      uploadResponse("https://cdn.opsapp.co/projects/p1/a.jpg")
    );

    const url = await uploadImage(jpeg("a.jpg"), "projects/p1");

    expect(url).toBe("https://cdn.opsapp.co/projects/p1/a.jpg");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [target, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(target).toBe("/api/uploads/presign");
    expect(init.method).toBe("POST");
    expect(authHeaderOf(fetchMock.mock.calls[0])).toBe("Bearer test-jwt");
    const body = init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect((body.get("file") as File).name).toBe("a.jpg");
    expect(body.get("folder")).toBe("projects/p1");
  });

  it("force-refreshes the token and retries once on a 401", async () => {
    getIdTokenMock
      .mockResolvedValueOnce("stale-jwt")
      .mockResolvedValueOnce("fresh-jwt");
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: "Invalid auth token" }),
      })
      .mockResolvedValueOnce(
        uploadResponse("https://cdn.opsapp.co/uploads/b.jpg")
      );

    const url = await uploadImage(jpeg("b.jpg"));

    expect(url).toBe("https://cdn.opsapp.co/uploads/b.jpg");
    expect(getIdTokenMock).toHaveBeenNthCalledWith(2, true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authHeaderOf(fetchMock.mock.calls[1])).toBe("Bearer fresh-jwt");
  });
});

describe("uploadMultipleImages", () => {
  it("carries the bearer on every file's request", async () => {
    getIdTokenMock.mockResolvedValue("test-jwt");
    fetchMock
      .mockResolvedValueOnce(uploadResponse("https://cdn.opsapp.co/uploads/1.jpg"))
      .mockResolvedValueOnce(uploadResponse("https://cdn.opsapp.co/uploads/2.jpg"));

    const urls = await uploadMultipleImages([jpeg("1.jpg"), jpeg("2.jpg")]);

    expect(urls).toEqual([
      "https://cdn.opsapp.co/uploads/1.jpg",
      "https://cdn.opsapp.co/uploads/2.jpg",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      expect(authHeaderOf(call)).toBe("Bearer test-jwt");
    }
  });
});
