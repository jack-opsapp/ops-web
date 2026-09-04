import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET } from "@/app/developers/api/openapi.json/route";

const expected = readFileSync(
  resolve(process.cwd(), "docs/api/openapi-v1.json"),
  "utf8"
);

describe("public external API OpenAPI route", () => {
  it("serves the checked OpenAPI artifact byte-for-byte", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(expected);
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.oai.openapi+json;version=3.1; charset=utf-8"
    );
  });

  it("uses a stable and safe download filename", async () => {
    const response = await GET();

    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="ops-external-lead-api-v1.openapi.json"'
    );
  });

  it("does not require or vary on OPS session state", async () => {
    const anonymous = await GET();
    const secondAnonymousRequest = await GET();

    expect(secondAnonymousRequest.status).toBe(anonymous.status);
    expect(await secondAnonymousRequest.text()).toBe(await anonymous.text());
    expect(anonymous.headers.get("www-authenticate")).toBeNull();
    expect(anonymous.headers.get("set-cookie")).toBeNull();
  });
});
