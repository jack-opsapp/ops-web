import { createSocialSubmissionHandler } from "@/lib/social/agent-submission-handler";

export const runtime = "nodejs";
export const maxDuration = 120;

export const POST = createSocialSubmissionHandler();
