import { createSocialPublishCronHandler } from "@/lib/social/publish-cron-handler";

export const runtime = "nodejs";
export const maxDuration = 300;

export const GET = createSocialPublishCronHandler();
