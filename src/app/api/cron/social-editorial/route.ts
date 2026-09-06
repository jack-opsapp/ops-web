import { createEditorialCronHandler } from "@/lib/social/editorial/routes";
import { runCloudEditorial } from "@/lib/social/editorial/runtime";
export const runtime = "nodejs";
export const maxDuration = 300;
const handler = createEditorialCronHandler(
  () => runCloudEditorial(),
  (prepareDate) => runCloudEditorial({ prepareDate })
);
export const GET = handler;
export const POST = handler;
