import { NextRequest, NextResponse } from "next/server";
import { readBearerToken, secureTokenEquals } from "../auth";
import { z } from "zod";
const manualPreparation = z
  .object({
    action: z.literal("prepare_now"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
export function createEditorialCronHandler(
  run: () => Promise<unknown>,
  prepare?: (date: string) => Promise<unknown>
) {
  return async (request: NextRequest) => {
    const secret = process.env.CRON_SECRET?.trim() ?? "";
    if (secret.length < 32)
      return json({ code: "CRON_AUTH_NOT_CONFIGURED" }, 503);
    const token = readBearerToken(request.headers.get("authorization"));
    if (!token || !secureTokenEquals(token, secret))
      return json({ code: "UNAUTHORIZED" }, 401);
    try {
      if (request.method === "POST") {
        if (!prepare) return json({ code: "METHOD_NOT_ALLOWED" }, 405);
        const input = manualPreparation.safeParse(
          await request.json().catch(() => null)
        );
        if (!input.success)
          return json({ code: "INVALID_PREPARATION_REQUEST" }, 400);
        return json(await prepare(input.data.date));
      }
      if (request.method !== "GET")
        return json({ code: "METHOD_NOT_ALLOWED" }, 405);
      return json(await run());
    } catch {
      return json({ code: "EDITORIAL_WORKER_FAILED" }, 500);
    }
  };
}
export function createEditorialReadHandler(d: {
  authenticate: (r: NextRequest) => Promise<unknown>;
  read: () => Promise<unknown>;
}) {
  return async (request: NextRequest) => {
    try {
      await d.authenticate(request);
      return json(await d.read());
    } catch (error) {
      if (error instanceof NextResponse) {
        error.headers.set("cache-control", "no-store");
        return error;
      }
      return json({ error: "Cloud production could not be loaded." }, 500);
    }
  };
}
