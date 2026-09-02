import externalApiDocument from "../../../../../docs/api/openapi-v1.json";

export const dynamic = "force-static";
export const revalidate = 300;

const serializedDocument = `${JSON.stringify(externalApiDocument, null, 2)}\n`;

export function GET() {
  return new Response(serializedDocument, {
    status: 200,
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
      "Content-Disposition":
        'attachment; filename="ops-external-lead-api-v1.openapi.json"',
      "Content-Type":
        "application/vnd.oai.openapi+json;version=3.1; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
