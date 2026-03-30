"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Phone,
  Mail,
  FolderKanban,
  FileText,
  Receipt,
  ExternalLink,
  UserPlus,
  Link,
  X,
} from "lucide-react";
import { useAuthStore } from "@/lib/store/auth-store";
import { requireSupabase } from "@/lib/supabase/helpers";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import type { InboxConversation } from "@/lib/types/unified-inbox";

interface ContextPanelProps {
  open: boolean;
  onClose: () => void;
  conversation: InboxConversation | null;
}

interface ClientContext {
  name: string;
  email: string | null;
  phone: string | null;
  projects: Array<{ id: string; title: string; status: string }>;
  estimates: Array<{ id: string; title: string | null; status: string; total: number }>;
  invoices: Array<{ id: string; subject: string | null; status: string; total: number }>;
}

async function fetchClientContext(
  companyId: string,
  clientId: string
): Promise<ClientContext> {
  const supabase = requireSupabase();

  const [clientRes, projectsRes, estimatesRes, invoicesRes] = await Promise.all([
    supabase.from("clients").select("name, email, phone").eq("id", clientId).single(),
    supabase
      .from("projects")
      .select("id, title, status")
      .eq("company_id", companyId)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("estimates")
      .select("id, title, status, total")
      .eq("company_id", companyId)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(3),
    supabase
      .from("invoices")
      .select("id, subject, status, total")
      .eq("company_id", companyId)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(3),
  ]);

  return {
    name: (clientRes.data?.name as string) ?? "",
    email: (clientRes.data?.email as string) ?? null,
    phone: (clientRes.data?.phone as string) ?? null,
    projects: (projectsRes.data ?? []).map((p) => ({
      id: p.id as string,
      title: p.title as string,
      status: p.status as string,
    })),
    estimates: (estimatesRes.data ?? []).map((e) => ({
      id: e.id as string,
      title: (e.title as string) ?? null,
      status: e.status as string,
      total: (e.total as number) ?? 0,
    })),
    invoices: (invoicesRes.data ?? []).map((i) => ({
      id: i.id as string,
      subject: (i.subject as string) ?? null,
      status: i.status as string,
      total: (i.total as number) ?? 0,
    })),
  };
}

export function ContextPanel({ open, onClose, conversation }: ContextPanelProps) {
  const { t } = useDictionary("inbox");
  const router = useRouter();
  const companyId = useAuthStore((s) => s.company?.id);

  const { data: context, isLoading } = useQuery({
    queryKey: ["inbox", "context", conversation?.clientId ?? ""],
    queryFn: () => fetchClientContext(companyId!, conversation!.clientId!),
    enabled: open && !!companyId && !!conversation?.clientId,
  });

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 320, opacity: 1, transition: { duration: 0.2, ease: EASE_SMOOTH } }}
          exit={{ width: 0, opacity: 0, transition: { duration: 0.15, ease: EASE_SMOOTH } }}
          className="shrink-0 border-l border-[rgba(255,255,255,0.06)] overflow-hidden"
        >
          <div className="w-[320px] h-full flex flex-col overflow-y-auto scrollbar-hide">
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-[rgba(255,255,255,0.06)]">
              <span className="font-kosugi text-micro-sm text-text-tertiary uppercase tracking-wider">
                {t("context.toggle")}
              </span>
              <button onClick={onClose} className="text-text-disabled hover:text-text-secondary transition-colors">
                <X className="w-[14px] h-[14px]" />
              </button>
            </div>

            {/* Unmatched state */}
            {conversation?.type === "unmatched" && (
              <div className="p-3 space-y-2">
                <p className="font-mohave text-body text-text-primary">
                  {conversation.displayName}
                </p>
                <div className="space-y-1">
                  <button className="flex items-center gap-1.5 w-full px-2.5 py-2 rounded-[3px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.06)] transition-colors">
                    <UserPlus className="w-[12px] h-[12px] text-text-tertiary" />
                    <span className="font-kosugi text-micro-xs text-text-secondary uppercase">{t("unmatched.createClient")}</span>
                  </button>
                  <button className="flex items-center gap-1.5 w-full px-2.5 py-2 rounded-[3px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.06)] transition-colors">
                    <Link className="w-[12px] h-[12px] text-text-tertiary" />
                    <span className="font-kosugi text-micro-xs text-text-secondary uppercase">{t("unmatched.linkToClient")}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Client context */}
            {conversation?.type === "client" && (
              <div className="p-3 space-y-4">
                {isLoading ? (
                  <div className="space-y-3 animate-pulse">
                    <div className="h-[18px] w-[120px] rounded bg-[rgba(255,255,255,0.06)]" />
                    <div className="h-[14px] w-[180px] rounded bg-[rgba(255,255,255,0.04)]" />
                    <div className="h-[14px] w-[140px] rounded bg-[rgba(255,255,255,0.04)]" />
                  </div>
                ) : context ? (
                  <>
                    {/* Name + contact */}
                    <div>
                      <p className="font-mohave text-body text-text-primary font-semibold">
                        {context.name}
                      </p>
                      {context.phone && (
                        <a
                          href={`tel:${context.phone}`}
                          className="flex items-center gap-1.5 mt-1.5 text-text-secondary hover:text-text-primary transition-colors"
                        >
                          <Phone className="w-[11px] h-[11px]" />
                          <span className="font-mohave text-body-sm">{context.phone}</span>
                        </a>
                      )}
                      {context.email && (
                        <div className="flex items-center gap-1.5 mt-1">
                          <Mail className="w-[11px] h-[11px] text-text-tertiary" />
                          <span className="font-mohave text-body-sm text-text-secondary">{context.email}</span>
                        </div>
                      )}
                    </div>

                    {/* Projects */}
                    {context.projects.length > 0 && (
                      <div>
                        <p className="font-kosugi text-micro-xs text-text-disabled uppercase tracking-wider mb-1.5">
                          {t("context.projects")}
                        </p>
                        <div className="space-y-1">
                          {context.projects.map((p) => (
                            <button
                              key={p.id}
                              onClick={() => router.push(`/projects/${p.id}`)}
                              className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded-[3px] hover:bg-[rgba(255,255,255,0.04)] transition-colors text-left"
                            >
                              <FolderKanban className="w-[11px] h-[11px] text-text-disabled shrink-0" />
                              <span className="font-mohave text-body-sm text-text-secondary truncate flex-1">
                                {p.title}
                              </span>
                              <span className="font-kosugi text-micro-xs text-text-disabled uppercase">
                                {p.status}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Estimates */}
                    {context.estimates.length > 0 && (
                      <div>
                        <p className="font-kosugi text-micro-xs text-text-disabled uppercase tracking-wider mb-1.5">
                          {t("context.estimates")}
                        </p>
                        <div className="space-y-1">
                          {context.estimates.map((e) => (
                            <button
                              key={e.id}
                              onClick={() => router.push(`/estimates/${e.id}`)}
                              className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded-[3px] hover:bg-[rgba(255,255,255,0.04)] transition-colors text-left"
                            >
                              <FileText className="w-[11px] h-[11px] text-text-disabled shrink-0" />
                              <span className="font-mohave text-body-sm text-text-secondary truncate flex-1">
                                {e.title || "Untitled"}
                              </span>
                              <span className="font-kosugi text-micro-xs text-text-disabled uppercase">
                                {e.status}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Invoices */}
                    {context.invoices.length > 0 && (
                      <div>
                        <p className="font-kosugi text-micro-xs text-text-disabled uppercase tracking-wider mb-1.5">
                          {t("context.invoices")}
                        </p>
                        <div className="space-y-1">
                          {context.invoices.map((inv) => (
                            <button
                              key={inv.id}
                              onClick={() => router.push(`/invoices/${inv.id}`)}
                              className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded-[3px] hover:bg-[rgba(255,255,255,0.04)] transition-colors text-left"
                            >
                              <Receipt className="w-[11px] h-[11px] text-text-disabled shrink-0" />
                              <span className="font-mohave text-body-sm text-text-secondary truncate flex-1">
                                {inv.subject || "Untitled"}
                              </span>
                              <span className="font-kosugi text-micro-xs text-text-disabled uppercase">
                                {inv.status}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Quick actions */}
                    <div className="pt-2 border-t border-[rgba(255,255,255,0.06)]">
                      <button
                        onClick={() => router.push(`/clients/${conversation?.clientId}`)}
                        className="flex items-center gap-1.5 w-full px-2.5 py-2 rounded-[3px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.06)] transition-colors"
                      >
                        <ExternalLink className="w-[11px] h-[11px] text-text-tertiary" />
                        <span className="font-kosugi text-micro-xs text-text-secondary uppercase">
                          {t("context.viewClient")}
                        </span>
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
