import {
  Lightbulb, Clock, FlaskConical, CheckCircle2,
  type LucideIcon,
} from "lucide-react";

export interface WhatsNewItem {
  id: string;
  category_id: string;
  title: string;
  description: string;
  icon: string;
  status: string;
  feature_flag_slug: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WhatsNewCategory {
  id: string;
  name: string;
  icon: string;
  sort_order: number;
  is_active: boolean;
  whats_new_items: WhatsNewItem[];
}

export interface BetaRequest {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  company_id: string;
  company_name: string;
  whats_new_item_id: string;
  status: string;
  admin_notes: string | null;
  requested_at: string;
  reviewed_at: string | null;
  whats_new_items: {
    title: string;
    description: string;
    feature_flag_slug: string | null;
  } | null;
}

export interface StatusOption {
  value: string;
  label: string;
  chip: string;
  icon: LucideIcon;
  color: string;
}

export const STATUS_OPTIONS: StatusOption[] = [
  { value: "planned", label: "Planning", chip: "Plan", icon: Lightbulb, color: "#6B6B6B" },
  { value: "in_development", label: "Development", chip: "Dev", icon: Clock, color: "#E5E5E5" },
  { value: "in_testing", label: "Testing", chip: "Test", icon: FlaskConical, color: "#C4A868" },
  { value: "completed", label: "Done", chip: "Done", icon: CheckCircle2, color: "#9DB582" },
];
