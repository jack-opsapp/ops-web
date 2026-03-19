"use client";

import { useState, useCallback, useRef, useMemo } from "react";
import {
  Bold,
  Italic,
  Link2,
  ChevronDown,
  FileText,
  Send,
  X,
  AlertTriangle,
  Sparkles,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { useAuthStore } from "@/lib/store/auth-store";
import { useEmailConnections } from "@/lib/hooks/use-email-connections";
import { useEmailTemplates } from "@/lib/hooks/use-email-templates";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ComposeEmailData, EmailTemplate, MergeFieldContext } from "@/lib/types/email-template";
import { resolveMergeFields, hasUnresolvedFields, MERGE_FIELDS } from "@/lib/types/email-template";
import type { EmailConnection } from "@/lib/types/email-connection";

// ─── Props ──────────────────────────────────────────────────────────────────

interface ComposeEmailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Initial compose data (mode, pre-fills, merge context) */
  composeData?: ComposeEmailData;
}

// ─── AI Draft State ─────────────────────────────────────────────────────────

interface AIDraftState {
  /** Whether the current body was AI-generated */
  isAIDraft: boolean;
  /** The original AI-generated draft text (for diff comparison) */
  originalDraft: string;
  /** The draftHistoryId from the server for edit tracking */
  draftHistoryId: string;
  /** Confidence score of the writing profile match */
  confidence: number;
  /** Sources used for the draft */
  sources: string[];
}

const EMPTY_AI_STATE: AIDraftState = {
  isAIDraft: false,
  originalDraft: "",
  draftHistoryId: "",
  confidence: 0,
  sources: [],
};

// ─── Link Insert Popover ────────────────────────────────────────────────────

function LinkInsertPopover({
  onInsert,
  onCancel,
}: {
  onInsert: (url: string, text: string) => void;
  onCancel: () => void;
}) {
  const { t } = useDictionary("compose");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");

  return (
    <div className="absolute top-full left-0 mt-1 z-10 p-2 rounded-[4px] bg-[rgba(10,10,10,0.85)] backdrop-blur-[20px] backdrop-saturate-[1.2] border border-[rgba(255,255,255,0.08)] space-y-1.5 min-w-[240px]">
      <input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder={t("toolbar.link.url")}
        className="w-full px-2 py-1 rounded-[3px] bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] font-mohave text-body-sm text-text-primary placeholder:text-text-disabled outline-none focus:border-[rgba(89,119,148,0.4)]"
        autoFocus
      />
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("toolbar.link.text")}
        className="w-full px-2 py-1 rounded-[3px] bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] font-mohave text-body-sm text-text-primary placeholder:text-text-disabled outline-none focus:border-[rgba(89,119,148,0.4)]"
      />
      <div className="flex items-center gap-1 pt-0.5">
        <button
          onClick={() => {
            if (url) onInsert(url, text || url);
          }}
          disabled={!url}
          className="px-2 py-0.5 rounded-[3px] bg-[rgba(255,255,255,0.08)] font-kosugi text-[10px] text-text-primary uppercase tracking-wider hover:bg-[rgba(255,255,255,0.12)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {t("toolbar.link.insert")}
        </button>
        <button
          onClick={onCancel}
          className="px-2 py-0.5 rounded-[3px] font-kosugi text-[10px] text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors"
        >
          {t("toolbar.link.cancel")}
        </button>
      </div>
    </div>
  );
}

// ─── Template Picker Dropdown ───────────────────────────────────────────────

function TemplatePicker({
  templates,
  onSelect,
  onClose,
}: {
  templates: EmailTemplate[];
  onSelect: (template: EmailTemplate) => void;
  onClose: () => void;
}) {
  const { t } = useDictionary("compose");
  const { t: tTemplates } = useDictionary("email-templates");

  // Group by category
  const grouped = useMemo(() => {
    const map = new Map<string, EmailTemplate[]>();
    for (const tpl of templates) {
      const existing = map.get(tpl.category) ?? [];
      existing.push(tpl);
      map.set(tpl.category, existing);
    }
    return map;
  }, [templates]);

  if (templates.length === 0) {
    return (
      <div className="absolute top-full right-0 mt-1 z-10 p-3 rounded-[4px] bg-[rgba(10,10,10,0.85)] backdrop-blur-[20px] backdrop-saturate-[1.2] border border-[rgba(255,255,255,0.08)] min-w-[220px]">
        <p className="font-mohave text-body-sm text-text-disabled">
          {t("template.none")}
        </p>
      </div>
    );
  }

  return (
    <div
      className="absolute top-full right-0 mt-1 z-10 rounded-[4px] bg-[rgba(10,10,10,0.85)] backdrop-blur-[20px] backdrop-saturate-[1.2] border border-[rgba(255,255,255,0.08)] min-w-[260px] max-h-[300px] overflow-y-auto scrollbar-hide"
      onMouseDown={(e) => e.preventDefault()}
    >
      {Array.from(grouped.entries()).map(([category, items]) => (
        <div key={category}>
          <div className="px-2.5 py-1 sticky top-0 bg-[rgba(10,10,10,0.95)]">
            <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider">
              {tTemplates(`category.${category}`)}
            </span>
          </div>
          {items.map((tpl) => (
            <button
              key={tpl.id}
              onClick={() => {
                onSelect(tpl);
                onClose();
              }}
              className="w-full text-left px-2.5 py-1.5 hover:bg-[rgba(255,255,255,0.04)] transition-colors"
            >
              <span className="font-mohave text-body-sm text-text-primary block truncate">
                {tpl.name}
              </span>
              {tpl.subject && (
                <span className="font-mohave text-caption-sm text-text-disabled block truncate">
                  {tpl.subject}
                </span>
              )}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Merge Field Highlighter ────────────────────────────────────────────────

/**
 * Renders text with merge fields highlighted in amber.
 * Used for the body preview overlay (not editable).
 */
function MergeFieldHighlightOverlay({ text }: { text: string }) {
  if (!hasUnresolvedFields(text)) return null;

  const parts = text.split(/(\{\{(?:client_name|project_title|company_name)\}\})/g);

  return (
    <div className="absolute inset-0 pointer-events-none px-2.5 py-2 font-mohave text-body-sm leading-relaxed whitespace-pre-wrap break-words">
      {parts.map((part, i) => {
        if (/^\{\{(client_name|project_title|company_name)\}\}$/.test(part)) {
          return (
            <span
              key={i}
              className="bg-[rgba(196,168,104,0.15)] text-[#C4A868] rounded-[2px] px-0.5"
              title={MERGE_FIELDS.find((f) => f.key === part)?.label ?? part}
            >
              {part}
            </span>
          );
        }
        return <span key={i} className="invisible">{part}</span>;
      })}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function ComposeEmailModal({
  open,
  onOpenChange,
  composeData,
}: ComposeEmailModalProps) {
  const { t } = useDictionary("compose");
  const { currentUser, company } = useAuthStore();

  // Data hooks
  const { data: connections = [] } = useEmailConnections();
  const { data: templates = [] } = useEmailTemplates();

  // Active connections only
  const activeConnections = useMemo(
    () => connections.filter((c: EmailConnection) => c.status === "active"),
    [connections]
  );

  // Form state
  const mode = composeData?.mode ?? "new";
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>("");
  const [to, setTo] = useState(composeData?.to ?? "");
  const [cc, setCc] = useState(composeData?.cc?.join(", ") ?? "");
  const [showCc, setShowCc] = useState(!!composeData?.cc?.length);
  const [subject, setSubject] = useState(
    mode === "reply" && composeData?.subject
      ? composeData.subject.startsWith("Re: ")
        ? composeData.subject
        : `Re: ${composeData.subject}`
      : composeData?.subject ?? ""
  );
  const [body, setBody] = useState("");
  const [isSending, setIsSending] = useState(false);

  // AI Draft state
  const [aiState, setAiState] = useState<AIDraftState>(EMPTY_AI_STATE);
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
  const [showAiReplaceConfirm, setShowAiReplaceConfirm] = useState(false);

  // UI state
  const [showLinkPopover, setShowLinkPopover] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [showReplaceConfirm, setShowReplaceConfirm] = useState<EmailTemplate | null>(null);
  const [showSenderDropdown, setShowSenderDropdown] = useState(false);

  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Auto-select first connection or the one specified in composeData
  const effectiveConnectionId = useMemo(() => {
    if (selectedConnectionId) return selectedConnectionId;
    if (composeData?.connectionId) return composeData.connectionId;
    if (activeConnections.length === 1) return activeConnections[0].id;
    return "";
  }, [selectedConnectionId, composeData?.connectionId, activeConnections]);

  const selectedConnection = activeConnections.find(
    (c: EmailConnection) => c.id === effectiveConnectionId
  );

  // ─── Markdown Toolbar Actions ───────────────────────────────────────────

  const wrapSelection = useCallback(
    (prefix: string, suffix: string) => {
      const textarea = bodyRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selected = body.slice(start, end);
      const before = body.slice(0, start);
      const after = body.slice(end);

      const wrapped = `${prefix}${selected || "text"}${suffix}`;
      setBody(`${before}${wrapped}${after}`);

      // Re-focus and select the wrapped text
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(
          start + prefix.length,
          start + prefix.length + (selected.length || 4)
        );
      });
    },
    [body]
  );

  const handleBold = useCallback(() => wrapSelection("**", "**"), [wrapSelection]);
  const handleItalic = useCallback(() => wrapSelection("*", "*"), [wrapSelection]);

  const handleInsertLink = useCallback(
    (url: string, text: string) => {
      const textarea = bodyRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const before = body.slice(0, start);
      const after = body.slice(textarea.selectionEnd);
      const link = `[${text}](${url})`;

      setBody(`${before}${link}${after}`);
      setShowLinkPopover(false);

      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(start + link.length, start + link.length);
      });
    },
    [body]
  );

  // ─── Template Insertion ─────────────────────────────────────────────────

  const applyTemplate = useCallback(
    (template: EmailTemplate) => {
      const ctx = composeData?.mergeContext ?? {};
      // Add company name from auth store
      const fullCtx: MergeFieldContext = {
        ...ctx,
        companyName: ctx.companyName || company?.name || undefined,
      };

      const resolvedSubject = resolveMergeFields(template.subject, fullCtx);
      const resolvedBody = resolveMergeFields(template.body, fullCtx);

      setSubject(resolvedSubject);
      setBody(resolvedBody);
      // Clear AI state when applying template
      setAiState(EMPTY_AI_STATE);
    },
    [composeData?.mergeContext, company?.name]
  );

  const handleTemplateSelect = useCallback(
    (template: EmailTemplate) => {
      // If body has content, show replace confirmation
      if (body.trim().length > 0) {
        setShowReplaceConfirm(template);
      } else {
        applyTemplate(template);
      }
    },
    [body, applyTemplate]
  );

  // ─── AI Draft Generation ──────────────────────────────────────────────

  const applyAiDraft = useCallback(
    async () => {
      if (!effectiveConnectionId || !currentUser?.id || !company?.id) {
        toast.error("Select a sender account first");
        return;
      }

      setIsGeneratingDraft(true);

      try {
        const response = await fetch("/api/integrations/email/ai-draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId: company.id,
            userId: currentUser.id,
            connectionId: effectiveConnectionId,
            opportunityId: composeData?.opportunityId,
            threadId: composeData?.threadId,
            recipientEmail: to || composeData?.to,
            recipientName: composeData?.recipientName,
          }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error((data as { error?: string }).error ?? "Draft generation failed");
        }

        const result = await response.json() as {
          available: boolean;
          draft: string;
          draftHistoryId: string;
          confidence: number;
          sources: string[];
          reason?: string;
        };

        if (!result.available) {
          toast.error(result.reason || "AI drafting unavailable");
          return;
        }

        setBody(result.draft);
        setAiState({
          isAIDraft: true,
          originalDraft: result.draft,
          draftHistoryId: result.draftHistoryId,
          confidence: result.confidence,
          sources: result.sources,
        });

        // Focus the body textarea so user can review/edit
        requestAnimationFrame(() => {
          bodyRef.current?.focus();
        });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to generate draft"
        );
      } finally {
        setIsGeneratingDraft(false);
      }
    },
    [effectiveConnectionId, currentUser?.id, company?.id, composeData, to]
  );

  const handleAiDraft = useCallback(() => {
    if (body.trim().length > 0) {
      setShowAiReplaceConfirm(true);
    } else {
      applyAiDraft();
    }
  }, [body, applyAiDraft]);

  const clearAiDraft = useCallback(() => {
    setBody("");
    // Record as discarded if we have a draft history ID
    if (aiState.draftHistoryId && currentUser?.id && company?.id) {
      fetch("/api/integrations/email/draft-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftHistoryId: aiState.draftHistoryId,
          companyId: company.id,
          userId: currentUser.id,
          outcome: "discarded",
        }),
      }).catch(() => {
        // Non-fatal — don't block UI for feedback failure
      });
    }
    setAiState(EMPTY_AI_STATE);
  }, [aiState.draftHistoryId, currentUser?.id, company?.id]);

  // ─── Send ───────────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    // Validation
    if (!effectiveConnectionId) {
      toast.error("Select a sender account");
      return;
    }
    if (!to.trim()) {
      toast.error("Add a recipient");
      return;
    }
    if (!subject.trim()) {
      toast.error("Add a subject line");
      return;
    }

    setIsSending(true);

    try {
      const payload = {
        userId: currentUser?.id,
        companyId: company?.id,
        connectionId: effectiveConnectionId,
        to: to.split(",").map((e) => e.trim()).filter(Boolean),
        cc: cc ? cc.split(",").map((e) => e.trim()).filter(Boolean) : [],
        subject: subject.trim(),
        body: body.trim(),
        threadId: composeData?.threadId ?? null,
        opportunityId: composeData?.opportunityId ?? null,
        inReplyTo: composeData?.inReplyTo ?? null,
        format: "markdown" as const,
      };

      const response = await fetch("/api/integrations/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Send failed");
      }

      // ── AI Draft edit tracking (fire-and-forget) ─────────────────────
      if (aiState.isAIDraft && aiState.draftHistoryId && currentUser?.id && company?.id) {
        fetch("/api/integrations/email/draft-feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            draftHistoryId: aiState.draftHistoryId,
            companyId: company.id,
            userId: currentUser.id,
            outcome: "sent",
            finalVersion: body.trim(),
          }),
        }).catch(() => {
          // Non-fatal
        });
      }

      toast.success("Email sent");
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to send email"
      );
    } finally {
      setIsSending(false);
    }
  }, [effectiveConnectionId, to, cc, subject, body, composeData?.threadId, onOpenChange, aiState, currentUser?.id, company?.id]);

  // ─── Discard ────────────────────────────────────────────────────────────

  const handleClose = useCallback(() => {
    const hasContent = to.trim() || subject.trim() || body.trim();
    if (hasContent) {
      setShowDiscardConfirm(true);
    } else {
      onOpenChange(false);
    }
  }, [to, subject, body, onOpenChange]);

  const handleDiscard = useCallback(() => {
    // Track AI draft discard
    if (aiState.isAIDraft && aiState.draftHistoryId && currentUser?.id && company?.id) {
      fetch("/api/integrations/email/draft-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftHistoryId: aiState.draftHistoryId,
          companyId: company.id,
          userId: currentUser.id,
          outcome: "discarded",
        }),
      }).catch(() => {});
    }
    setShowDiscardConfirm(false);
    setAiState(EMPTY_AI_STATE);
    onOpenChange(false);
  }, [onOpenChange, aiState, currentUser?.id, company?.id]);

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="max-w-[620px] max-h-[90vh] p-0 overflow-hidden flex flex-col"
        hideClose
      >
        {/* Header */}
        <div className="shrink-0 px-3 pt-3 pb-2 border-b border-[rgba(255,255,255,0.06)]">
          <div className="flex items-center justify-between">
            <DialogHeader className="pb-0">
              <DialogTitle className="text-heading-sm">
                {mode === "reply" ? t("title.reply") : t("title.new")}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {mode === "reply" ? t("title.reply") : t("title.new")}
              </DialogDescription>
            </DialogHeader>
            <button
              onClick={handleClose}
              className="p-1 rounded-[3px] text-text-tertiary hover:text-text-primary transition-colors"
            >
              <X className="w-[16px] h-[16px]" />
            </button>
          </div>
        </div>

        {/* Fields */}
        <div className="shrink-0 px-3 py-1.5 space-y-0 border-b border-[rgba(255,255,255,0.04)]">
          {/* From */}
          <div className="flex items-center gap-2 py-1">
            <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider w-[32px] shrink-0">
              {t("from")}
            </span>
            {activeConnections.length === 0 ? (
              <span className="font-mohave text-body-sm text-text-disabled italic">
                {t("from.noConnections")}
              </span>
            ) : activeConnections.length === 1 ? (
              <span className="font-mohave text-body-sm text-text-secondary">
                {activeConnections[0].email}
              </span>
            ) : (
              <div className="relative flex-1">
                <button
                  onClick={() => setShowSenderDropdown(!showSenderDropdown)}
                  className="flex items-center gap-1 font-mohave text-body-sm text-text-secondary hover:text-text-primary transition-colors"
                >
                  {selectedConnection?.email ?? t("from.select")}
                  <ChevronDown className="w-[12px] h-[12px] text-text-disabled" />
                </button>
                {showSenderDropdown && (
                  <div className="absolute top-full left-0 mt-1 z-10 rounded-[4px] bg-[rgba(10,10,10,0.85)] backdrop-blur-[20px] backdrop-saturate-[1.2] border border-[rgba(255,255,255,0.08)] min-w-[260px]">
                    {activeConnections.map((conn: EmailConnection) => (
                      <button
                        key={conn.id}
                        onClick={() => {
                          setSelectedConnectionId(conn.id);
                          setShowSenderDropdown(false);
                        }}
                        className={cn(
                          "w-full text-left px-2.5 py-1.5 hover:bg-[rgba(255,255,255,0.04)] transition-colors",
                          conn.id === effectiveConnectionId &&
                            "bg-[rgba(255,255,255,0.03)]"
                        )}
                      >
                        <span className="font-mohave text-body-sm text-text-primary block truncate">
                          {conn.email}
                        </span>
                        <span className="font-kosugi text-[10px] text-text-disabled uppercase">
                          {conn.provider}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* To */}
          <div className="flex items-center gap-2 py-1">
            <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider w-[32px] shrink-0">
              {t("to")}
            </span>
            <input
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder={t("to.placeholder")}
              className="flex-1 bg-transparent font-mohave text-body-sm text-text-primary placeholder:text-text-disabled outline-none"
              readOnly={mode === "reply" && !!composeData?.to}
            />
            {!showCc && (
              <button
                onClick={() => setShowCc(true)}
                className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider hover:text-text-tertiary transition-colors"
              >
                {t("cc.show")}
              </button>
            )}
          </div>

          {/* CC */}
          {showCc && (
            <div className="flex items-center gap-2 py-1">
              <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider w-[32px] shrink-0">
                {t("cc")}
              </span>
              <input
                type="text"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                placeholder={t("cc.placeholder")}
                className="flex-1 bg-transparent font-mohave text-body-sm text-text-primary placeholder:text-text-disabled outline-none"
              />
              <button
                onClick={() => {
                  setShowCc(false);
                  setCc("");
                }}
                className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider hover:text-text-tertiary transition-colors"
              >
                {t("cc.hide")}
              </button>
            </div>
          )}

          {/* Subject */}
          <div className="flex items-center gap-2 py-1">
            <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider w-[32px] shrink-0">
              {t("subject")}
            </span>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t("subject.placeholder")}
              className="flex-1 bg-transparent font-mohave text-body-sm text-text-primary placeholder:text-text-disabled outline-none"
            />
          </div>
        </div>

        {/* Toolbar */}
        <div className="shrink-0 px-3 py-1 flex items-center gap-0.5 border-b border-[rgba(255,255,255,0.04)]">
          <button
            onClick={handleBold}
            title={t("toolbar.bold")}
            className="p-1 rounded-[3px] text-text-tertiary hover:text-text-primary hover:bg-[rgba(255,255,255,0.04)] transition-colors"
          >
            <Bold className="w-[14px] h-[14px]" />
          </button>
          <button
            onClick={handleItalic}
            title={t("toolbar.italic")}
            className="p-1 rounded-[3px] text-text-tertiary hover:text-text-primary hover:bg-[rgba(255,255,255,0.04)] transition-colors"
          >
            <Italic className="w-[14px] h-[14px]" />
          </button>
          <div className="relative">
            <button
              onClick={() => setShowLinkPopover(!showLinkPopover)}
              title={t("toolbar.link")}
              className={cn(
                "p-1 rounded-[3px] text-text-tertiary hover:text-text-primary hover:bg-[rgba(255,255,255,0.04)] transition-colors",
                showLinkPopover && "bg-[rgba(255,255,255,0.06)] text-text-primary"
              )}
            >
              <Link2 className="w-[14px] h-[14px]" />
            </button>
            {showLinkPopover && (
              <LinkInsertPopover
                onInsert={handleInsertLink}
                onCancel={() => setShowLinkPopover(false)}
              />
            )}
          </div>

          <div className="w-px h-[14px] bg-[rgba(255,255,255,0.06)] mx-1" />

          {/* AI Draft Button */}
          <button
            onClick={handleAiDraft}
            disabled={isGeneratingDraft || !effectiveConnectionId}
            title={t("toolbar.aiDraft.tooltip")}
            className={cn(
              "flex items-center gap-1 px-1.5 py-0.5 rounded-[3px] font-kosugi text-[10px] uppercase tracking-wider transition-colors",
              isGeneratingDraft
                ? "text-[#597794] bg-[rgba(89,119,148,0.1)]"
                : "text-text-tertiary hover:text-[#597794] hover:bg-[rgba(89,119,148,0.08)]",
              !effectiveConnectionId && "opacity-40 cursor-not-allowed"
            )}
          >
            {isGeneratingDraft ? (
              <Loader2 className="w-[12px] h-[12px] animate-spin" />
            ) : (
              <Sparkles className="w-[12px] h-[12px]" />
            )}
            {isGeneratingDraft ? t("toolbar.aiDraft.loading") : t("toolbar.aiDraft")}
          </button>

          {/* Template Picker */}
          <div className="relative ml-auto">
            <button
              onClick={() => setShowTemplatePicker(!showTemplatePicker)}
              className={cn(
                "flex items-center gap-1 px-1.5 py-0.5 rounded-[3px] font-kosugi text-[10px] text-text-tertiary uppercase tracking-wider hover:text-text-secondary hover:bg-[rgba(255,255,255,0.04)] transition-colors",
                showTemplatePicker && "bg-[rgba(255,255,255,0.06)] text-text-secondary"
              )}
            >
              <FileText className="w-[12px] h-[12px]" />
              {t("template")}
              <ChevronDown className="w-[10px] h-[10px]" />
            </button>
            {showTemplatePicker && (
              <TemplatePicker
                templates={templates}
                onSelect={handleTemplateSelect}
                onClose={() => setShowTemplatePicker(false)}
              />
            )}
          </div>
        </div>

        {/* AI Draft Banner */}
        {aiState.isAIDraft && (
          <div className="shrink-0 mx-3 mt-1.5 px-2 py-1 rounded-[3px] bg-[rgba(89,119,148,0.06)] border border-[rgba(89,119,148,0.12)] flex items-center gap-1.5">
            <Sparkles className="w-[12px] h-[12px] text-[#597794] shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="font-mohave text-caption-sm text-[#597794]">
                {t("aiDraft.banner")}
              </span>
              <span className="font-mohave text-caption-sm text-text-disabled ml-1.5">
                {t("aiDraft.banner.description")}
              </span>
            </div>
            <button
              onClick={clearAiDraft}
              className="font-kosugi text-[9px] text-text-disabled uppercase tracking-wider hover:text-text-tertiary transition-colors shrink-0"
            >
              {t("aiDraft.banner.discard")}
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 min-h-0 relative">
          <textarea
            ref={bodyRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("body.placeholder")}
            className="w-full h-full min-h-[200px] resize-none bg-transparent px-3 py-2 font-mohave text-body-sm text-text-primary placeholder:text-text-disabled outline-none leading-relaxed"
          />
          <MergeFieldHighlightOverlay text={body} />
        </div>

        {/* Unresolved merge fields warning */}
        {hasUnresolvedFields(body) && (
          <div className="shrink-0 mx-3 px-2 py-1 rounded-[3px] bg-[rgba(196,168,104,0.08)] border border-[rgba(196,168,104,0.15)] flex items-center gap-1.5">
            <AlertTriangle className="w-[12px] h-[12px] text-[#C4A868] shrink-0" />
            <span className="font-mohave text-caption-sm text-[#C4A868]">
              {t("mergeField.unresolved")}
            </span>
          </div>
        )}

        {/* Quoted Message (Reply mode) */}
        {mode === "reply" && composeData?.quotedMessage && (
          <div className="shrink-0 mx-3 mt-1 px-2.5 py-2 rounded-[4px] bg-[rgba(255,255,255,0.02)] border-l-2 border-[rgba(255,255,255,0.08)] max-h-[120px] overflow-y-auto scrollbar-hide">
            <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider block mb-1">
              {t("quotedMessage")}
            </span>
            <p className="font-mohave text-caption-sm text-text-disabled whitespace-pre-wrap leading-relaxed">
              {composeData.quotedMessage}
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="shrink-0 px-3 py-2 border-t border-[rgba(255,255,255,0.06)] flex items-center justify-between">
          <button
            onClick={handleClose}
            className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors"
          >
            {t("discard")}
          </button>

          <Button
            onClick={handleSend}
            disabled={isSending || !effectiveConnectionId || !to.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-text-primary text-[#0A0A0A] font-kosugi text-[11px] uppercase tracking-wider rounded-[3px] hover:bg-text-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-[12px] h-[12px]" />
            {isSending ? t("send.sending") : t("send")}
          </Button>
        </div>

        {/* Discard Confirmation Overlay */}
        {showDiscardConfirm && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[rgba(0,0,0,0.4)] backdrop-blur-sm rounded-sm">
            <div className="p-3 rounded-[4px] bg-[rgba(10,10,10,0.90)] backdrop-blur-[20px] border border-[rgba(255,255,255,0.08)] max-w-[280px] space-y-2">
              <p className="font-mohave text-body text-text-primary font-semibold">
                {t("discard.confirm.title")}
              </p>
              <p className="font-mohave text-body-sm text-text-secondary">
                {t("discard.confirm.message")}
              </p>
              <div className="flex items-center gap-1 pt-1">
                <button
                  onClick={handleDiscard}
                  className="px-2.5 py-1 rounded-[3px] bg-[rgba(147,50,26,0.2)] border border-[rgba(147,50,26,0.3)] font-kosugi text-[10px] text-[#93321A] uppercase tracking-wider hover:bg-[rgba(147,50,26,0.3)] transition-colors"
                >
                  {t("discard.confirm.yes")}
                </button>
                <button
                  onClick={() => setShowDiscardConfirm(false)}
                  className="px-2.5 py-1 rounded-[3px] font-kosugi text-[10px] text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors"
                >
                  {t("discard.confirm.no")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Template Replace Confirmation Overlay */}
        {showReplaceConfirm && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[rgba(0,0,0,0.4)] backdrop-blur-sm rounded-sm">
            <div className="p-3 rounded-[4px] bg-[rgba(10,10,10,0.90)] backdrop-blur-[20px] border border-[rgba(255,255,255,0.08)] max-w-[280px] space-y-2">
              <p className="font-mohave text-body text-text-primary font-semibold">
                {t("template.replace.title")}
              </p>
              <p className="font-mohave text-body-sm text-text-secondary">
                {t("template.replace.message")}
              </p>
              <div className="flex items-center gap-1 pt-1">
                <button
                  onClick={() => {
                    applyTemplate(showReplaceConfirm);
                    setShowReplaceConfirm(null);
                  }}
                  className="px-2.5 py-1 rounded-[3px] bg-[rgba(255,255,255,0.08)] font-kosugi text-[10px] text-text-primary uppercase tracking-wider hover:bg-[rgba(255,255,255,0.12)] transition-colors"
                >
                  {t("template.replace.confirm")}
                </button>
                <button
                  onClick={() => setShowReplaceConfirm(null)}
                  className="px-2.5 py-1 rounded-[3px] font-kosugi text-[10px] text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors"
                >
                  {t("template.replace.cancel")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* AI Draft Replace Confirmation Overlay */}
        {showAiReplaceConfirm && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[rgba(0,0,0,0.4)] backdrop-blur-sm rounded-sm">
            <div className="p-3 rounded-[4px] bg-[rgba(10,10,10,0.90)] backdrop-blur-[20px] border border-[rgba(255,255,255,0.08)] max-w-[280px] space-y-2">
              <p className="font-mohave text-body text-text-primary font-semibold">
                {t("aiDraft.replace.title")}
              </p>
              <p className="font-mohave text-body-sm text-text-secondary">
                {t("aiDraft.replace.message")}
              </p>
              <div className="flex items-center gap-1 pt-1">
                <button
                  onClick={() => {
                    setShowAiReplaceConfirm(false);
                    applyAiDraft();
                  }}
                  className="px-2.5 py-1 rounded-[3px] bg-[rgba(89,119,148,0.15)] border border-[rgba(89,119,148,0.25)] font-kosugi text-[10px] text-[#597794] uppercase tracking-wider hover:bg-[rgba(89,119,148,0.25)] transition-colors"
                >
                  {t("aiDraft.replace.confirm")}
                </button>
                <button
                  onClick={() => setShowAiReplaceConfirm(false)}
                  className="px-2.5 py-1 rounded-[3px] font-kosugi text-[10px] text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors"
                >
                  {t("aiDraft.replace.cancel")}
                </button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
