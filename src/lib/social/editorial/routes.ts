import { NextRequest, NextResponse } from "next/server";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
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
