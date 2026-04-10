/**
 * OPS Web — Project Suggestion Service
 *
 * Detects when an inbound email creates a new lead that could become a project,
 * and proposes a create_project action via the approval queue.
 *
 * Integration point: called from sync-engine.ts after new leads are created.
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import { ApprovalQueueService } from "./approval-queue-service";
import type { NormalizedEmail } from "./email-provider";
import type { CreateProjectActionData } from "@/lib/types/approval-queue";

/**
 * After a new lead is created from an inbound email, check if we should
 * suggest creating a project. Fire-and-forget — must not block the sync loop.
 */
export async function maybeSuggestProject(params: {
  email: NormalizedEmail;
  companyId: string;
  userId: string;
  clientId: string;
  opportunityId: string;
}): Promise<void> {
  const { email, companyId, userId, clientId, opportunityId } = params;

  const supabase = requireSupabase();

  // Check if a project already exists for this client (prevent duplicate suggestions)
  const { data: existingProjects } = await supabase
    .from("projects")
    .select("id")
    .eq("company_id", companyId)
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .limit(1);

  if (existingProjects && existingProjects.length > 0) {
    return; // Client already has a project
  }

  // Extract what we can from the email
  const clientName = email.fromName || email.from.split("@")[0];
  const serviceHints = extractServiceHints(email.subject, email.snippet ?? "");
  const title = serviceHints
    ? `${serviceHints} — ${clientName}`
    : `New Project — ${clientName}`;

  // Get client record for address
  const { data: client } = await supabase
    .from("clients")
    .select("name, address")
    .eq("id", clientId)
    .single();

  // Get common task types for this company
  const { data: taskTypes } = await supabase
    .from("task_types_v2")
    .select("id, display")
    .eq("company_id", companyId)
    .eq("is_default", true)
    .limit(5);

  const suggestedTasks = (taskTypes ?? []).map((tt) => ({
    task_type_id: tt.id as string,
    title: tt.display as string,
  }));

  const actionData: CreateProjectActionData = {
    title,
    client_id: clientId,
    address: (client?.address as string) ?? null,
    scope: serviceHints,
    suggested_tasks: suggestedTasks,
    source_thread_id: email.threadId,
    source_opportunity_id: opportunityId,
  };

  // Calculate confidence based on available context
  let confidence = 0.5;
  if (client?.name) confidence += 0.1; // Known client with name
  if (client?.address) confidence += 0.1; // Has address
  if (serviceHints) confidence += 0.1; // Service type detected

  const shortSubject =
    email.subject.length > 60
      ? email.subject.slice(0, 57) + "..."
      : email.subject;

  await ApprovalQueueService.proposeAction({
    companyId,
    userId,
    actionType: "create_project",
    actionData: actionData as unknown as Record<string, unknown>,
    contextSummary: `New inquiry from ${clientName}. Based on email: "${shortSubject}".`,
    contextSource: "email_thread",
    sourceId: email.threadId,
    confidence: Math.min(confidence, 1),
    priority: "normal",
  });
}

/**
 * Extract service type hints from email subject and body snippet.
 * Returns a short description or null if nothing detected.
 */
function extractServiceHints(
  subject: string,
  snippet: string
): string | null {
  const text = `${subject} ${snippet}`.toLowerCase();

  // Common trade service keywords
  const servicePatterns: Array<[RegExp, string]> = [
    [/\b(deck|decking)\b/, "Deck"],
    [/\b(fence|fencing)\b/, "Fence"],
    [/\b(roof|roofing|shingle)\b/, "Roofing"],
    [/\b(paint|painting)\b/, "Painting"],
    [/\b(plumb|plumbing|pipe)\b/, "Plumbing"],
    [/\b(electric|electrical|wiring)\b/, "Electrical"],
    [/\b(hvac|heating|cooling|furnace|ac\b)/, "HVAC"],
    [/\b(landscap|yard|lawn|garden)\b/, "Landscaping"],
    [/\b(concrete|foundation|slab)\b/, "Concrete"],
    [/\b(drywall|drywalling)\b/, "Drywall"],
    [/\b(tile|tiling|flooring)\b/, "Flooring"],
    [/\b(window|door|siding)\b/, "Windows & Doors"],
    [/\b(kitchen|bathroom|reno|renovation|remodel)\b/, "Renovation"],
    [/\b(rail|railing)\b/, "Railing"],
    [/\b(framing|frame)\b/, "Framing"],
    [/\b(insulation|insulate)\b/, "Insulation"],
    [/\b(demolition|demo)\b/, "Demolition"],
    [/\b(excavat|dig|grading)\b/, "Excavation"],
    [/\b(sewer|septic|drain)\b/, "Sewer & Drainage"],
    [/\b(gutter|eavestrough)\b/, "Gutters"],
  ];

  for (const [pattern, label] of servicePatterns) {
    if (pattern.test(text)) return label;
  }

  return null;
}
