import type { Json } from "@/lib/types/database.types";

export type ProjectTableFilterInstruction =
  | { type: "in"; field: "status" | "client_id"; values: string[] }
  | { type: "not_in"; field: "status" | "client_id"; values: string[] }
  | { type: "contains"; field: "team_member_ids"; values: string[] }
  | { type: "ilike_any"; fields: ("title" | "client_name" | "address")[]; value: string };

type FilterObject = {
  type?: unknown;
  key?: unknown;
  field?: unknown;
  op?: unknown;
  value?: unknown;
  and?: unknown;
};

const PROJECT_STATUS_VALUES = new Set([
  "rfq",
  "estimated",
  "accepted",
  "in_progress",
  "completed",
  "closed",
  "archived",
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asObject(value: Json): FilterObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as FilterObject;
}

function stringValues(field: "status" | "client_id", value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => {
    if (typeof item !== "string" || item.length === 0) return false;
    if (field === "status") return PROJECT_STATUS_VALUES.has(item);
    return UUID_PATTERN.test(item);
  });
}

function fromNode(node: Json, currentUserId: string): ProjectTableFilterInstruction[] {
  const obj = asObject(node);
  if (!obj) return [];

  const instructions: ProjectTableFilterInstruction[] = [];

  if (obj.type === "dynamic" && obj.key === "current_user_assigned") {
    instructions.push({ type: "contains", field: "team_member_ids", values: [currentUserId] });
  }

  if ((obj.field === "status" || obj.field === "client_id") && (obj.op === "in" || obj.op === "not_in")) {
    const values = stringValues(obj.field, obj.value);
    if (values.length > 0) {
      instructions.push({ type: obj.op, field: obj.field, values });
    }
  }

  if (Array.isArray(obj.and)) {
    for (const child of obj.and) {
      instructions.push(...fromNode(child as Json, currentUserId));
    }
  }

  return instructions;
}

export function buildProjectTableFilterInstructions(
  filter: Json,
  currentUserId: string,
  search: string,
): ProjectTableFilterInstruction[] {
  const instructions = fromNode(filter, currentUserId);
  const trimmed = search.trim();
  if (trimmed.length > 0) {
    instructions.push({
      type: "ilike_any",
      fields: ["title", "client_name", "address"],
      value: trimmed,
    });
  }
  return instructions;
}
