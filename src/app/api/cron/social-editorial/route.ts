import { createEditorialCronHandler } from "@/lib/social/editorial/routes";
import { runCloudEditorial } from "@/lib/social/editorial/runtime";
export const runtime = "nodejs";
export const maxDuration = 300;
export const GET = createEditorialCronHandler(runCloudEditorial);
