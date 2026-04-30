import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { TEMPLATE_REGISTRY } from "@/lib/email/template-registry";

export interface TemplateListEntry {
  templateId: string;
  displayName: string;
  currentVersion: string | null;
  versionsCount: number;
}

export interface TemplateVersionRow {
  id: string;
  template_id: string;
  version: string;
  content_hash: string;
  rendered_sample_html: string | null;
  preview_props: any;
  notes: string | null;
  created_at: string;
}

export async function listTemplates(): Promise<TemplateListEntry[]> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("email_template_versions")
    .select("template_id, version, created_at")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[listTemplates]", error);
    return TEMPLATE_REGISTRY.map((t) => ({
      templateId: t.templateId,
      displayName: t.displayName,
      currentVersion: null,
      versionsCount: 0,
    }));
  }
  const byTemplate = new Map<string, { current: string; count: number }>();
  for (const row of data ?? []) {
    const existing = byTemplate.get(row.template_id);
    if (!existing) {
      byTemplate.set(row.template_id, { current: row.version, count: 1 });
    } else {
      byTemplate.set(row.template_id, { current: existing.current, count: existing.count + 1 });
    }
  }
  return TEMPLATE_REGISTRY.map((t) => {
    const agg = byTemplate.get(t.templateId);
    return {
      templateId: t.templateId,
      displayName: t.displayName,
      currentVersion: agg?.current ?? null,
      versionsCount: agg?.count ?? 0,
    };
  });
}

export async function listTemplateVersions(templateId: string): Promise<TemplateVersionRow[]> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("email_template_versions")
    .select("id, template_id, version, content_hash, rendered_sample_html, preview_props, notes, created_at")
    .eq("template_id", templateId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[listTemplateVersions]", error);
    return [];
  }
  return data ?? [];
}
