import type { AudienceField, AudienceOp } from "@/lib/admin/types";

export const FIELD_OPTIONS: Array<{
  id: AudienceField;
  label: string;
  type: "text" | "boolean" | "date" | "enum" | "uuid";
  values?: string[];
}> = [
  { id: "email", label: "Email", type: "text" },
  {
    id: "role",
    label: "User role",
    type: "enum",
    values: ["owner", "admin", "employee", "client", "prospect"],
  },
  { id: "user_type", label: "User type", type: "text" },
  { id: "is_company_admin", label: "Is company admin", type: "boolean" },
  { id: "is_active", label: "Is active", type: "boolean" },
  {
    id: "removed_from_email_list",
    label: "Removed from email list",
    type: "boolean",
  },
  { id: "company_id", label: "Company id", type: "uuid" },
  { id: "created_at", label: "Created at", type: "date" },
  {
    id: "plan",
    label: "Subscription plan",
    type: "enum",
    values: ["starter", "team", "business"],
  },
  {
    id: "subscription_status",
    label: "Subscription status",
    type: "enum",
    values: ["trialing", "active", "past_due", "canceled", "incomplete"],
  },
  { id: "trial_end_date", label: "Trial end date", type: "date" },
];

export const OP_OPTIONS: Record<
  string,
  Array<{ id: AudienceOp; label: string; needsValue: boolean; arrayValue?: boolean }>
> = {
  text: [
    { id: "eq", label: "equals", needsValue: true },
    { id: "neq", label: "not equals", needsValue: true },
    { id: "like", label: "contains", needsValue: true },
    { id: "in", label: "is in list", needsValue: true, arrayValue: true },
    { id: "is_null", label: "is empty", needsValue: false },
    { id: "is_not_null", label: "is not empty", needsValue: false },
  ],
  boolean: [{ id: "eq", label: "equals", needsValue: true }],
  date: [
    { id: "gte_days", label: "in last (days)", needsValue: true },
    { id: "lte_days", label: "older than (days)", needsValue: true },
    { id: "gt", label: "after", needsValue: true },
    { id: "lt", label: "before", needsValue: true },
    { id: "is_null", label: "is empty", needsValue: false },
    { id: "is_not_null", label: "is not empty", needsValue: false },
  ],
  enum: [
    { id: "eq", label: "equals", needsValue: true },
    { id: "neq", label: "not equals", needsValue: true },
    { id: "in", label: "is one of", needsValue: true, arrayValue: true },
    { id: "not_in", label: "is none of", needsValue: true, arrayValue: true },
  ],
  uuid: [
    { id: "eq", label: "equals", needsValue: true },
    { id: "in", label: "is in list", needsValue: true, arrayValue: true },
  ],
};
