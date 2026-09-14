import { afterEach, expect, it, vi } from "vitest";
import { UserService } from "@/lib/api/services/user-service";
import { readCookieFirstTouch } from "@/lib/pmf/utm-capture";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.cookie = "__ops_first_touch=; Max-Age=0; Path=/";
  history.replaceState({}, "", "/");
});

it("captures the landing source before the first account-sync request, even before the layout effect", async () => {
  history.replaceState(
    {},
    "",
    "/register?utm_source=google&utm_medium=organic"
  );
  let sentTouch: ReturnType<typeof readCookieFirstTouch> = null;
  vi.stubGlobal("fetch", async () => {
    sentTouch = readCookieFirstTouch();
    return Response.json({ user: { id: "new-account" }, company: null });
  });
  const result = await UserService.syncUser("token", "owner@example.com");
  expect(result.user.id).toBe("new-account");
  expect(sentTouch).toMatchObject({
    utm_source: "google",
    utm_medium: "organic",
    landing_path: "/register",
  });
});

it("does not block authentication if cookie access is denied", async () => {
  vi.spyOn(document, "cookie", "get").mockImplementation(() => {
    throw new Error("denied");
  });
  vi.stubGlobal("fetch", async () =>
    Response.json({ user: { id: "new-account" }, company: null })
  );
  await expect(
    UserService.syncUser("token", "owner@example.com")
  ).resolves.toMatchObject({ user: { id: "new-account" } });
});
