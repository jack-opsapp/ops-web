"use client";

import { useMemo } from "react";
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
  ImageIcon,
  ArrowRight,
  Users,
} from "lucide-react";
import { useAuthStore } from "@/lib/store/auth-store";
import { requireSupabase } from "@/lib/supabase/helpers";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import type { InboxConversation, InboxMessage } from "@/lib/types/unified-inbox";

// ─── Props ─────────────────────────────────────────────────────────────────

interface ContextPanelProps {
  open: boolean;
  onClose: () => void;
  conversation: InboxConversation | null;
  /** All messages across all threads (for extracting contacts + attachments) */
  messages?: InboxMessage[];
  /** Navigate to a specific email thread */
  onGoToThread?: (threadId: string) => void;
}

// ─── Data types ────────────────────────────────────────────────────────────

interface ClientContext {
  name: string;
  email: string | null;
  phone: string | null;
  subClients: Array<{ id: string; name: string; email: string | null; title: string | null }>;
  projects: Array<{ id: string; title: string; status: string }>;
  estimates: Array<{ id: string; title: string | null; status: string; total: number }>;
  invoices: Array<{ id: string; subject: string | null; status: string; total: number }>;
}

interface ThreadImage {
  attachmentId: string;
  filename: string;
  mimeType: string;
  messageId: string;
  threadId: string;
  threadSubject: string;
}

interface ThreadContact {
  email: string;
  name: string;
  title: string | null;
  isSubClient: boolean;
}

// ─── Data fetching ─────────────────────────────────────────────────────────

async function fetchClientContext(
  companyId: string,
  clientId: string
): Promise<ClientContext> {
  const supabase = requireSupabase();

  const [clientRes, subClientsRes, projectsRes, estimatesRes, invoicesRes] = await Promise.all([
    supabase.from("clients").select("name, email, phone").eq("id", clientId).single(),
    supabase
      .from("sub_clients")
      .select("id, name, email, title")
      .eq("client_id", clientId)
      .is("deleted_at", null)
      .order("name"),
    supabase
      .from("projects")
      .select("id, title, status")
      .eq("company_id", companyId)
      .eq("client_id", clientId)
      .is("deleted_at", null)
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
    subClients: (subClientsRes.data ?? []).map((sc) => ({
      id: sc.id as string,
      name: sc.name as string,
      email: (sc.email as string) ?? null,
      title: (sc.title as string) ?? null,
    })),
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

// ─── Section header ────────────────────────────────────────────────────────

function SectionHeader({ label, count }: { label: string; count?: number }) {
  return (
    <div className="flex items-center gap-1.5 mb-1.5">
      <span className="font-kosugi text-micro text-text-mute uppercase tracking-wider">
        {label}
      </span>
      {count !== undefined && (
        <span className="font-kosugi text-micro text-text-mute/60">
          {count}
        </span>
      )}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <p className="font-mohave text-caption-sm text-text-mute/50 italic px-2 py-1.5">
      No {label.toLowerCase()}
    </p>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────

export function ContextPanel({
  open,
  onClose,
  conversation,
  messages = [],
  onGoToThread,
}: ContextPanelProps) {
  const { t } = useDictionary("inbox");
  const router = useRouter();
  const companyId = useAuthStore((s) => s.company?.id);

  const { data: context, isLoading } = useQuery({
    queryKey: ["inbox", "context", conversation?.clientId ?? ""],
    queryFn: () => fetchClientContext(companyId!, conversation!.clientId!),
    enabled: open && !!companyId && !!conversation?.clientId,
  });

  // ─── Derive contacts from sub-clients + message participants ─────────

  const contacts: ThreadContact[] = useMemo(() => {
    const seen = new Set<string>();
    const result: ThreadContact[] = [];

    // Sub-clients first (they have titles/roles)
    if (context?.subClients) {
      for (const sc of context.subClients) {
        const key = sc.email?.toLowerCase() ?? sc.name.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          if (sc.email) seen.add(sc.email.toLowerCase());
          result.push({
            email: sc.email ?? "",
            name: sc.name,
            title: sc.title,
            isSubClient: true,
          });
        }
      }
    }

    // Add unique inbound email participants not already in sub-clients
    for (const msg of messages) {
      if (msg.channel !== "email" || msg.direction !== "inbound" || !msg.senderEmail) continue;
      const key = msg.senderEmail.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push({
          email: msg.senderEmail,
          name: msg.senderName,
          title: null,
          isSubClient: false,
        });
      }
    }

    return result;
  }, [context, messages]);

  // ─── Derive images from all messages ─────────────────────────────────

  const threadImages: ThreadImage[] = useMemo(() => {
    const images: ThreadImage[] = [];

    for (const msg of messages) {
      if (!msg.attachments || msg.attachments.length === 0) continue;
      for (const att of msg.attachments) {
        if (!att.mimeType.startsWith("image/")) continue;
        images.push({
          attachmentId: att.attachmentId,
          filename: att.filename,
          mimeType: att.mimeType,
          messageId: msg.emailMessageId ?? msg.id,
          threadId: msg.emailThreadId ?? "",
          threadSubject: msg.subject ?? "Email",
        });
      }
    }

    return images;
  }, [messages]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 320, opacity: 1, transition: { duration: 0.2, ease: EASE_SMOOTH } }}
          exit={{ width: 0, opacity: 0, transition: { duration: 0.15, ease: EASE_SMOOTH } }}
          className="shrink-0 border-l border-border-subtle overflow-hidden"
        >
          <div className="w-[320px] h-full flex flex-col overflow-y-auto scrollbar-hide">
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-border-subtle">
              <span className="font-kosugi text-micro text-text-3 uppercase tracking-wider">
                {t("context.toggle")}
              </span>
              <button onClick={onClose} className="text-text-mute hover:text-text-2 transition-colors">
                <X className="w-[14px] h-[14px]" />
              </button>
            </div>

            {/* Unmatched state */}
            {conversation?.type === "unmatched" && (
              <div className="p-3 space-y-2">
                <p className="font-mohave text-body text-text">
                  {conversation.displayName}
                </p>
                <div className="space-y-1">
                  <button className="flex items-center gap-1.5 w-full px-2.5 py-2 rounded-panel border border-border-subtle bg-surface-input hover:bg-glass glass-surface transition-colors">
                    <UserPlus className="w-[12px] h-[12px] text-text-3" />
                    <span className="font-kosugi text-micro text-text-2 uppercase">{t("unmatched.createClient")}</span>
                  </button>
                  <button className="flex items-center gap-1.5 w-full px-2.5 py-2 rounded-panel border border-border-subtle bg-surface-input hover:bg-glass glass-surface transition-colors">
                    <Link className="w-[12px] h-[12px] text-text-3" />
                    <span className="font-kosugi text-micro text-text-2 uppercase">{t("unmatched.linkToClient")}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Client context */}
            {conversation?.type === "client" && (
              <div className="p-3 space-y-4">
                {isLoading ? (
                  <div className="space-y-3 animate-pulse">
                    <div className="h-[18px] w-[120px] rounded bg-surface-input" />
                    <div className="h-[14px] w-[180px] rounded bg-border-subtle" />
                    <div className="h-[14px] w-[140px] rounded bg-border-subtle" />
                  </div>
                ) : context ? (
                  <>
                    {/* Name + primary contact */}
                    <div>
                      <p className="font-mohave text-body text-text font-semibold">
                        {context.name}
                      </p>
                      {context.phone && (
                        <a
                          href={`tel:${context.phone}`}
                          className="flex items-center gap-1.5 mt-1.5 text-text-2 hover:text-text transition-colors"
                        >
                          <Phone className="w-[11px] h-[11px]" />
                          <span className="font-mohave text-body-sm">{context.phone}</span>
                        </a>
                      )}
                      {context.email && (
                        <div className="flex items-center gap-1.5 mt-1">
                          <Mail className="w-[11px] h-[11px] text-text-3" />
                          <span className="font-mohave text-body-sm text-text-2">{context.email}</span>
                        </div>
                      )}
                    </div>

                    {/* ─── Contacts ──────────────────────────────────────── */}
                    <div>
                      <SectionHeader label="Contacts" count={contacts.length} />
                      {contacts.length === 0 ? (
                        <EmptyState label="contacts" />
                      ) : (
                        <div className="space-y-0.5">
                          {contacts.map((c, i) => (
                            <div
                              key={c.email || i}
                              className="flex items-center gap-2 px-2 py-1.5 rounded-panel hover:bg-surface-input transition-colors"
                            >
                              <div className="w-[24px] h-[24px] rounded-full bg-glass glass-surface border border-border-subtle flex items-center justify-center shrink-0">
                                <Users className="w-[10px] h-[10px] text-text-mute" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="font-mohave text-caption-sm text-text-2 truncate">
                                  {c.name}
                                </p>
                                <div className="flex items-center gap-1.5">
                                  {c.title && (
                                    <span className="font-kosugi text-micro text-ops-accent uppercase tracking-wider">
                                      {c.title}
                                    </span>
                                  )}
                                  {c.email && (
                                    <span className="font-mohave text-micro text-text-mute truncate">
                                      {c.title && <>&middot; </>}{c.email}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* ─── Attachments / Images ─────────────────────────── */}
                    <div>
                      <SectionHeader label="Photos" count={threadImages.length} />
                      {threadImages.length === 0 ? (
                        <EmptyState label="photos" />
                      ) : (
                        <div className="grid grid-cols-3 gap-1">
                          {threadImages.map((img) => (
                            <ImageThumbnail
                              key={img.attachmentId}
                              image={img}
                              companyId={companyId!}
                              onGoToThread={onGoToThread}
                            />
                          ))}
                        </div>
                      )}
                    </div>

                    {/* ─── Projects ──────────────────────────────────────── */}
                    <div>
                      <SectionHeader label={t("context.projects")} count={context.projects.length} />
                      {context.projects.length === 0 ? (
                        <EmptyState label="projects" />
                      ) : (
                        <div className="space-y-0.5">
                          {context.projects.map((p) => (
                            <button
                              key={p.id}
                              onClick={() => router.push(`/projects/${p.id}`)}
                              className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded-panel hover:bg-surface-input transition-colors text-left"
                            >
                              <FolderKanban className="w-[11px] h-[11px] text-text-mute shrink-0" />
                              <span className="font-mohave text-body-sm text-text-2 truncate flex-1">
                                {p.title}
                              </span>
                              <span className="font-kosugi text-micro text-text-mute uppercase">
                                {p.status}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* ─── Estimates ─────────────────────────────────────── */}
                    <div>
                      <SectionHeader label={t("context.estimates")} count={context.estimates.length} />
                      {context.estimates.length === 0 ? (
                        <EmptyState label="estimates" />
                      ) : (
                        <div className="space-y-0.5">
                          {context.estimates.map((e) => (
                            <button
                              key={e.id}
                              onClick={() => router.push(`/estimates/${e.id}`)}
                              className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded-panel hover:bg-surface-input transition-colors text-left"
                            >
                              <FileText className="w-[11px] h-[11px] text-text-mute shrink-0" />
                              <span className="font-mohave text-body-sm text-text-2 truncate flex-1">
                                {e.title || "Untitled"}
                              </span>
                              <span className="font-kosugi text-micro text-text-mute uppercase">
                                {e.status}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* ─── Invoices ──────────────────────────────────────── */}
                    <div>
                      <SectionHeader label={t("context.invoices")} count={context.invoices.length} />
                      {context.invoices.length === 0 ? (
                        <EmptyState label="invoices" />
                      ) : (
                        <div className="space-y-0.5">
                          {context.invoices.map((inv) => (
                            <button
                              key={inv.id}
                              onClick={() => router.push(`/invoices/${inv.id}`)}
                              className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded-panel hover:bg-surface-input transition-colors text-left"
                            >
                              <Receipt className="w-[11px] h-[11px] text-text-mute shrink-0" />
                              <span className="font-mohave text-body-sm text-text-2 truncate flex-1">
                                {inv.subject || "Untitled"}
                              </span>
                              <span className="font-kosugi text-micro text-text-mute uppercase">
                                {inv.status}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* ─── Quick actions ─────────────────────────────────── */}
                    <div className="pt-2 border-t border-border-subtle">
                      <button
                        onClick={() => router.push(`/clients/${conversation?.clientId}`)}
                        className="flex items-center gap-1.5 w-full px-2.5 py-2 rounded-panel border border-border-subtle bg-surface-input hover:bg-glass glass-surface transition-colors"
                      >
                        <ExternalLink className="w-[11px] h-[11px] text-text-3" />
                        <span className="font-kosugi text-micro text-text-2 uppercase">
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

// ─── Image thumbnail with go-to-thread ─────────────────────────────────────

function ImageThumbnail({
  image,
  companyId,
  onGoToThread,
}: {
  image: ThreadImage;
  companyId: string;
  onGoToThread?: (threadId: string) => void;
}) {
  const src = `/api/integrations/email/attachment?companyId=${companyId}&messageId=${image.messageId}&attachmentId=${encodeURIComponent(image.attachmentId)}&mimeType=${encodeURIComponent(image.mimeType)}`;

  return (
    <div className="group relative aspect-square rounded-panel overflow-hidden border border-border-subtle bg-glass glass-surface">
      <img
        src={src}
        alt={image.filename}
        className="w-full h-full object-cover"
        loading="lazy"
      />

      {/* Hover overlay with go-to-thread */}
      {onGoToThread && image.threadId && (
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-end p-1.5">
          <button
            onClick={() => onGoToThread(image.threadId)}
            className="flex items-center gap-1 w-full px-1.5 py-1 rounded-[2px] bg-glass glass-surface/90 border border-border-subtle text-text-2 hover:text-ops-accent transition-colors cursor-pointer"
          >
            <ArrowRight className="w-[10px] h-[10px] shrink-0" />
            <span className="font-kosugi text-[9px] uppercase tracking-wider truncate">
              Go to thread
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
