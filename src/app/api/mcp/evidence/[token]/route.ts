import {
  createProductionEvidenceGetHandler,
  evidenceMethodNotAllowed,
} from "@/lib/agent-control-plane/mcp/evidence-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = createProductionEvidenceGetHandler();
export const HEAD = evidenceMethodNotAllowed;
export const POST = evidenceMethodNotAllowed;
export const PUT = evidenceMethodNotAllowed;
export const PATCH = evidenceMethodNotAllowed;
export const DELETE = evidenceMethodNotAllowed;
