"use client";

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import {
  Bold,
  Italic,
  Link2,
  ChevronDown,
  FileText,
  Send,
  AlertTriangle,
  Sparkles,
  Loader2,
} from "lucide-react";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { useAuthStore } from "@/lib/store/auth-store";
import { useEmailConnections } from "@/lib/hooks/use-email-connections";
import { useEmailTemplates } from "@/lib/hooks/use-email-templates";
import { Button } from "@/components/ui/button";
import type {
  ComposeEmailData,
  EmailTemplate,
  MergeFieldContext,
} from "@/lib/types/email-template";
import {
  resolveMergeFields,
  hasUnresolvedFields,
} from "@/lib/types/email-template";
import type { EmailConnection } from "@/lib/types/email-connection";
import {
  normalizeReplySubject,
  subjectDraftRequestFields,
  type DraftSubjectInputSource,
} from "@/lib/email/email-subject-policy";
import { authedFetch } from "@/lib/utils/authed-fetch";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ComposeEmailFormProps {
  composeData?: ComposeEmailData;
  onClose: () => void;
}

// ─── AI Draft State ─────────────────────────────────────────────────────────

interface AIDraftState {
  isAIDraft: boolean;
  originalDraft: string;
  draftHistoryId: string;
  confidence: number;
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
    <div className="absolute left-0 top-full z-10 mt-1 min-w-[240px] space-y-1.5 rounded-chip border border-[rgba(255,255,255,0.08)] bg-[var(--surface-glass-dense)] p-2 backdrop-blur-[20px] backdrop-saturate-[1.2]">
      <input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder={t("toolbar.link.url")}
        className="focus:border-[rgba(111, 148, 176,0.4)] w-full rounded-panel border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-2 py-1 font-mohave text-body-sm text-text outline-none placeholder:text-text-mute"
        autoFocus
      />
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("toolbar.link.text")}
        className="focus:border-[rgba(111, 148, 176,0.4)] w-full rounded-panel border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-2 py-1 font-mohave text-body-sm text-text outline-none placeholder:text-text-mute"
      />
      <div className="flex items-center gap-1 pt-0.5">
        <button
          onClick={() => {
            if (url) onInsert(url, text || url);
          }}
          disabled={!url}
          className="rounded-panel bg-[rgba(255,255,255,0.08)] px-2 py-0.5 font-mono text-micro uppercase tracking-wider text-text transition-colors hover:bg-[rgba(255,255,255,0.12)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("toolbar.link.insert")}
        </button>
        <button
          onClick={onCancel}
          className="rounded-panel px-2 py-0.5 font-mono text-micro uppercase tracking-wider text-text-3 transition-colors hover:text-text-2"
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
      <div className="absolute right-0 top-full z-10 mt-1 min-w-[220px] rounded-chip border border-[rgba(255,255,255,0.08)] bg-[var(--surface-glass-dense)] p-3 backdrop-blur-[20px] backdrop-saturate-[1.2]">
        <p className="font-mohave text-body-sm text-text-mute">
          {t("template.none")}
        </p>
      </div>
    );
  }

  return (
    <div
      className="scrollbar-hide absolute right-0 top-full z-10 mt-1 max-h-[300px] min-w-[260px] overflow-y-auto rounded-chip border border-[rgba(255,255,255,0.08)] bg-[var(--surface-glass-dense)] backdrop-blur-[20px] backdrop-saturate-[1.2]"
      onMouseDown={(e) => e.preventDefault()}
    >
      {Array.from(grouped.entries()).map(([category, items]) => (
        <div key={category}>
          <div className="sticky top-0 bg-[var(--surface-glass-dense)] px-2.5 py-1">
            <span className="font-mono text-micro uppercase tracking-wider text-text-mute">
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
              className="w-full px-2.5 py-1.5 text-left transition-colors hover:bg-[rgba(255,255,255,0.04)]"
            >
              <span className="block truncate font-mohave text-body-sm text-text">
                {tpl.name}
              </span>
              {tpl.subject && (
                <span className="block truncate font-mohave text-caption-sm text-text-mute">
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

function MergeFieldHighlightOverlay({ text }: { text: string }) {
  if (!hasUnresolvedFields(text)) return null;

  const parts = text.split(
    /(\{\{(?:client_name|project_title|company_name)\}\})/g
  );

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-3 py-2 font-mohave text-body-sm leading-relaxed">
      {parts.map((part, i) => {
        if (/^\{\{.+\}\}$/.test(part)) {
          return (
            <span
              key={i}
              className="rounded-bar bg-[rgba(196,168,104,0.15)] px-0.5 text-[#C4A868]"
            >
              {part}
            </span>
          );
        }
        return (
          <span key={i} className="invisible">
            {part}
          </span>
        );
      })}
    </div>
  );
}

// ─── Main Form Component ─────────────────────────────────────────────────────

export function ComposeEmailForm({
  composeData,
  onClose,
}: ComposeEmailFormProps) {
  const { t } = useDictionary("compose");
  const { currentUser, company } = useAuthStore();

  // Data hooks
  const { data: connections = [] } = useEmailConnections();
  const { data: templates = [] } = useEmailTemplates();

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
      ? normalizeReplySubject(composeData.subject)
      : (composeData?.subject ?? "")
  );
  const [subjectSource, setSubjectSource] = useState<DraftSubjectInputSource>(
    mode === "reply"
      ? "thread"
      : composeData?.subject
        ? "configured"
        : "operator"
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
  const [showReplaceConfirm, setShowReplaceConfirm] =
    useState<EmailTemplate | null>(null);
  const [showSenderDropdown, setShowSenderDropdown] = useState(false);

  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const effectiveConnectionId = useMemo(() => {
    if (selectedConnectionId) return selectedConnectionId;
    if (composeData?.connectionId) return composeData.connectionId;
    if (activeConnections.length === 1) return activeConnections[0].id;
    return "";
  }, [selectedConnectionId, composeData?.connectionId, activeConnections]);

  const selectedConnection = activeConnections.find(
    (c: EmailConnection) => c.id === effectiveConnectionId
  );

  // ─── E5: Auto-draft pre-population ──────────────────────────────────────
  // When opening compose for a thread, check if an auto-draft exists
  // and pre-populate the body + AI state.
  useEffect(() => {
    if (!composeData?.threadId || !company?.id || body.trim().length > 0)
      return;

    const checkAutoDraft = async () => {
      try {
        const res = await authedFetch(
          `/api/integrations/email/auto-drafts?companyId=${company.id}&threadId=${composeData.threadId}`
        );
        if (!res.ok) return;
        const data = await res.json();
        const drafts = data.autoDrafts as Array<{
          id: string;
          draft: string;
          threadId: string;
          connectionId: string;
        }>;
        if (drafts.length === 0) return;

        const autoDraft = drafts[0];
        setBody(autoDraft.draft);
        setAiState({
          isAIDraft: true,
          originalDraft: autoDraft.draft,
          draftHistoryId: autoDraft.id,
          confidence: 1, // auto-drafts already passed confidence check
          sources: ["auto_draft"],
        });
      } catch {
        // Non-fatal — auto-draft check is supplementary
      }
    };

    checkAutoDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composeData?.threadId, company?.id]);

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

  const handleBold = useCallback(
    () => wrapSelection("**", "**"),
    [wrapSelection]
  );
  const handleItalic = useCallback(
    () => wrapSelection("*", "*"),
    [wrapSelection]
  );

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
      const fullCtx: MergeFieldContext = {
        ...ctx,
        companyName: ctx.companyName || company?.name || undefined,
      };
      const resolvedSubject = resolveMergeFields(template.subject, fullCtx);
      const resolvedBody = resolveMergeFields(template.body, fullCtx);
      setSubject(resolvedSubject);
      setSubjectSource("configured");
      setBody(resolvedBody);
      setAiState(EMPTY_AI_STATE);
    },
    [composeData?.mergeContext, company?.name]
  );

  const handleTemplateSelect = useCallback(
    (template: EmailTemplate) => {
      if (body.trim().length > 0) {
        setShowReplaceConfirm(template);
      } else {
        applyTemplate(template);
      }
    },
    [body, applyTemplate]
  );

  // ─── AI Draft Generation ──────────────────────────────────────────────

  const applyAiDraft = useCallback(async () => {
    if (!effectiveConnectionId || !currentUser?.id || !company?.id) {
      toast.error("Select a sender account first");
      return;
    }
    setIsGeneratingDraft(true);
    try {
      const response = await authedFetch("/api/integrations/email/ai-draft", {
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
          ...subjectDraftRequestFields(subject, subjectSource),
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error ?? "Draft generation failed"
        );
      }
      const result = (await response.json()) as {
        available: boolean;
        draft: string;
        draftHistoryId: string;
        confidence: number;
        sources: string[];
        reason?: string;
        subject?: string;
        subjectSource?: DraftSubjectInputSource;
      };
      if (!result.available) {
        toast.error(result.reason || "AI drafting unavailable");
        return;
      }
      setBody(result.draft);
      if (!subject.trim() && result.subject) {
        setSubject(result.subject);
        setSubjectSource(result.subjectSource ?? "generated");
      }
      setAiState({
        isAIDraft: true,
        originalDraft: result.draft,
        draftHistoryId: result.draftHistoryId,
        confidence: result.confidence,
        sources: result.sources,
      });
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
  }, [
    effectiveConnectionId,
    currentUser?.id,
    company?.id,
    composeData,
    to,
    subject,
    subjectSource,
  ]);

  const handleAiDraft = useCallback(() => {
    if (body.trim().length > 0) {
      setShowAiReplaceConfirm(true);
    } else {
      applyAiDraft();
    }
  }, [body, applyAiDraft]);

  const clearAiDraft = useCallback(() => {
    setBody("");
    if (aiState.draftHistoryId && currentUser?.id && company?.id) {
      authedFetch("/api/integrations/email/draft-feedback", {
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
    setAiState(EMPTY_AI_STATE);
  }, [aiState.draftHistoryId, currentUser?.id, company?.id]);

  // ─── Send ───────────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
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
        to: to
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean),
        cc: cc
          ? cc
              .split(",")
              .map((e) => e.trim())
              .filter(Boolean)
          : [],
        subject: subject.trim(),
        body: body.trim(),
        threadId: composeData?.threadId ?? null,
        opportunityId: composeData?.opportunityId ?? null,
        inReplyTo: composeData?.inReplyTo ?? null,
        draftHistoryId:
          aiState.isAIDraft && aiState.draftHistoryId
            ? aiState.draftHistoryId
            : null,
        format: "markdown" as const,
      };
      const response = await authedFetch("/api/integrations/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Send failed");
      }
      toast.success("Email sent");
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to send email"
      );
    } finally {
      setIsSending(false);
    }
  }, [
    effectiveConnectionId,
    to,
    cc,
    subject,
    body,
    composeData?.threadId,
    composeData?.opportunityId,
    composeData?.inReplyTo,
    onClose,
    aiState,
    currentUser?.id,
    company?.id,
  ]);

  // ─── Discard ────────────────────────────────────────────────────────────

  const handleClose = useCallback(() => {
    const hasContent = to.trim() || subject.trim() || body.trim();
    if (hasContent) {
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  }, [to, subject, body, onClose]);

  const handleDiscard = useCallback(() => {
    if (
      aiState.isAIDraft &&
      aiState.draftHistoryId &&
      currentUser?.id &&
      company?.id
    ) {
      authedFetch("/api/integrations/email/draft-feedback", {
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
    onClose();
  }, [onClose, aiState, currentUser?.id, company?.id]);

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="relative flex h-full flex-col">
      {/* Fields */}
      <div className="shrink-0 space-y-0 border-b border-[rgba(255,255,255,0.04)] px-3 py-1.5">
        {/* From */}
        <div className="flex items-center gap-2 py-1">
          <span className="w-[32px] shrink-0 font-mono text-micro uppercase tracking-wider text-text-mute">
            {t("from")}
          </span>
          {activeConnections.length === 0 ? (
            <span className="font-mohave text-body-sm italic text-text-mute">
              {t("from.noConnections")}
            </span>
          ) : activeConnections.length === 1 ? (
            <span className="font-mohave text-body-sm text-text-2">
              {activeConnections[0].email}
            </span>
          ) : (
            <div className="relative flex-1">
              <button
                onClick={() => setShowSenderDropdown(!showSenderDropdown)}
                className="flex items-center gap-1 font-mohave text-body-sm text-text-2 transition-colors hover:text-text"
              >
                {selectedConnection?.email ?? t("from.select")}
                <ChevronDown className="h-[12px] w-[12px] text-text-mute" />
              </button>
              {showSenderDropdown && (
                <div className="absolute left-0 top-full z-10 mt-1 min-w-[260px] rounded-chip border border-[rgba(255,255,255,0.08)] bg-[var(--surface-glass-dense)] backdrop-blur-[20px] backdrop-saturate-[1.2]">
                  {activeConnections.map((conn: EmailConnection) => (
                    <button
                      key={conn.id}
                      onClick={() => {
                        setSelectedConnectionId(conn.id);
                        setShowSenderDropdown(false);
                      }}
                      className={cn(
                        "w-full px-2.5 py-1.5 text-left transition-colors hover:bg-[rgba(255,255,255,0.04)]",
                        conn.id === effectiveConnectionId &&
                          "bg-[rgba(255,255,255,0.03)]"
                      )}
                    >
                      <span className="block truncate font-mohave text-body-sm text-text">
                        {conn.email}
                      </span>
                      <span className="font-mono text-micro uppercase text-text-mute">
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
          <span className="w-[32px] shrink-0 font-mono text-micro uppercase tracking-wider text-text-mute">
            {t("to")}
          </span>
          <input
            type="text"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder={t("to.placeholder")}
            className="flex-1 bg-transparent font-mohave text-body-sm text-text outline-none placeholder:text-text-mute"
            readOnly={mode === "reply" && !!composeData?.to}
          />
          {!showCc && (
            <button
              onClick={() => setShowCc(true)}
              className="font-mono text-micro uppercase tracking-wider text-text-mute transition-colors hover:text-text-3"
            >
              {t("cc.show")}
            </button>
          )}
        </div>

        {/* CC */}
        {showCc && (
          <div className="flex items-center gap-2 py-1">
            <span className="w-[32px] shrink-0 font-mono text-micro uppercase tracking-wider text-text-mute">
              {t("cc")}
            </span>
            <input
              type="text"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder={t("cc.placeholder")}
              className="flex-1 bg-transparent font-mohave text-body-sm text-text outline-none placeholder:text-text-mute"
            />
            <button
              onClick={() => {
                setShowCc(false);
                setCc("");
              }}
              className="font-mono text-micro uppercase tracking-wider text-text-mute transition-colors hover:text-text-3"
            >
              {t("cc.hide")}
            </button>
          </div>
        )}

        {/* Subject */}
        <div className="flex items-center gap-2 py-1">
          <span className="w-[32px] shrink-0 font-mono text-micro uppercase tracking-wider text-text-mute">
            {t("subject")}
          </span>
          <input
            type="text"
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value);
              setSubjectSource("operator");
            }}
            placeholder={t("subject.placeholder")}
            className="flex-1 bg-transparent font-mohave text-body-sm text-text outline-none placeholder:text-text-mute"
          />
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-0.5 border-b border-[rgba(255,255,255,0.04)] px-3 py-1">
        <button
          onClick={handleBold}
          title={t("toolbar.bold")}
          className="rounded-panel p-1 text-text-3 transition-colors hover:bg-[rgba(255,255,255,0.04)] hover:text-text"
        >
          <Bold className="h-[14px] w-[14px]" />
        </button>
        <button
          onClick={handleItalic}
          title={t("toolbar.italic")}
          className="rounded-panel p-1 text-text-3 transition-colors hover:bg-[rgba(255,255,255,0.04)] hover:text-text"
        >
          <Italic className="h-[14px] w-[14px]" />
        </button>
        <div className="relative">
          <button
            onClick={() => setShowLinkPopover(!showLinkPopover)}
            title={t("toolbar.link")}
            className={cn(
              "rounded-panel p-1 text-text-3 transition-colors hover:bg-[rgba(255,255,255,0.04)] hover:text-text",
              showLinkPopover && "bg-[rgba(255,255,255,0.06)] text-text"
            )}
          >
            <Link2 className="h-[14px] w-[14px]" />
          </button>
          {showLinkPopover && (
            <LinkInsertPopover
              onInsert={handleInsertLink}
              onCancel={() => setShowLinkPopover(false)}
            />
          )}
        </div>

        <div className="mx-1 h-[14px] w-px bg-[rgba(255,255,255,0.06)]" />

        {/* AI Draft Button */}
        <button
          onClick={handleAiDraft}
          disabled={isGeneratingDraft || !effectiveConnectionId}
          title={t("toolbar.aiDraft.tooltip")}
          className={cn(
            "flex items-center gap-1 rounded-panel px-1.5 py-0.5 font-mono text-micro uppercase tracking-wider transition-colors",
            isGeneratingDraft
              ? "bg-[rgba(111, 148, 176,0.1)] text-[#6F94B0]"
              : "hover:bg-[rgba(111, 148, 176,0.08)] text-text-3 hover:text-[#6F94B0]",
            !effectiveConnectionId && "cursor-not-allowed opacity-40"
          )}
        >
          {isGeneratingDraft ? (
            <Loader2 className="h-[12px] w-[12px] animate-spin" />
          ) : (
            <Sparkles className="h-[12px] w-[12px]" />
          )}
          {isGeneratingDraft
            ? t("toolbar.aiDraft.loading")
            : t("toolbar.aiDraft")}
        </button>

        {/* Template Picker */}
        <div className="relative ml-auto">
          <button
            onClick={() => setShowTemplatePicker(!showTemplatePicker)}
            className={cn(
              "flex items-center gap-1 rounded-panel px-1.5 py-0.5 font-mono text-micro uppercase tracking-wider text-text-3 transition-colors hover:bg-[rgba(255,255,255,0.04)] hover:text-text-2",
              showTemplatePicker && "bg-[rgba(255,255,255,0.06)] text-text-2"
            )}
          >
            <FileText className="h-[12px] w-[12px]" />
            {t("template")}
            <ChevronDown className="h-[10px] w-[10px]" />
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
        <div className="bg-[rgba(111, 148, 176,0.06)] border-[rgba(111, 148, 176,0.12)] mx-3 mt-1.5 flex shrink-0 items-center gap-1.5 rounded-panel border px-2 py-1">
          <Sparkles className="h-[12px] w-[12px] shrink-0 text-[#6F94B0]" />
          <div className="min-w-0 flex-1">
            <span className="font-mohave text-caption-sm text-[#6F94B0]">
              {aiState.sources.includes("auto_draft")
                ? t("aiDraft.banner.auto")
                : t("aiDraft.banner")}
            </span>
            {!aiState.sources.includes("auto_draft") && (
              <span className="ml-1.5 font-mohave text-caption-sm text-text-mute">
                {t("aiDraft.banner.description")}
              </span>
            )}
          </div>
          <button
            onClick={clearAiDraft}
            className="shrink-0 font-mono text-micro uppercase tracking-wider text-text-mute transition-colors hover:text-text-3"
          >
            {t("aiDraft.banner.discard")}
          </button>
        </div>
      )}

      {/* Body */}
      <div className="relative min-h-0 flex-1">
        <textarea
          ref={bodyRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("body.placeholder")}
          className="h-full min-h-[200px] w-full resize-none bg-transparent px-3 py-2 font-mohave text-body-sm leading-relaxed text-text outline-none placeholder:text-text-mute"
        />
        <MergeFieldHighlightOverlay text={body} />
      </div>

      {/* Unresolved merge fields warning */}
      {hasUnresolvedFields(body) && (
        <div className="mx-3 flex shrink-0 items-center gap-1.5 rounded-panel border border-[rgba(196,168,104,0.15)] bg-[rgba(196,168,104,0.08)] px-2 py-1">
          <AlertTriangle className="h-[12px] w-[12px] shrink-0 text-[#C4A868]" />
          <span className="font-mohave text-caption-sm text-[#C4A868]">
            {t("mergeField.unresolved")}
          </span>
        </div>
      )}

      {/* Quoted Message (Reply mode) */}
      {mode === "reply" && composeData?.quotedMessage && (
        <div className="scrollbar-hide mx-3 mt-1 max-h-[120px] shrink-0 overflow-y-auto rounded-chip border-l-2 border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-2.5 py-2">
          <span className="mb-1 block font-mono text-micro uppercase tracking-wider text-text-mute">
            {t("quotedMessage")}
          </span>
          <p className="whitespace-pre-wrap font-mohave text-caption-sm leading-relaxed text-text-mute">
            {composeData.quotedMessage}
          </p>
        </div>
      )}

      {/* Footer */}
      <div className="flex shrink-0 items-center justify-between border-t border-[rgba(255,255,255,0.06)] px-3 py-2">
        <button
          onClick={handleClose}
          className="font-mono text-micro uppercase tracking-wider text-text-3 transition-colors hover:text-text-2"
        >
          {t("discard")}
        </button>

        <Button
          onClick={handleSend}
          disabled={isSending || !effectiveConnectionId || !to.trim()}
          className="flex items-center gap-1.5 rounded-panel bg-text-primary px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-[#0A0A0A] transition-colors hover:bg-text-secondary disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send className="h-[12px] w-[12px]" />
          {isSending ? t("send.sending") : t("send")}
        </Button>
      </div>

      {/* Discard Confirmation Overlay */}
      {showDiscardConfirm && (
        <div className="absolute inset-0 z-20 flex items-center justify-center rounded-sm bg-[rgba(0,0,0,0.4)] backdrop-blur-sm">
          <div className="max-w-[280px] space-y-2 rounded-chip border border-[rgba(255,255,255,0.08)] bg-[var(--surface-glass-dense)] p-3 backdrop-blur-[20px]">
            <p className="font-mohave text-body font-semibold text-text">
              {t("discard.confirm.title")}
            </p>
            <p className="font-mohave text-body-sm text-text-2">
              {t("discard.confirm.message")}
            </p>
            <div className="flex items-center gap-1 pt-1">
              <button
                onClick={handleDiscard}
                className="rounded-panel border border-[rgba(147,50,26,0.3)] bg-[rgba(147,50,26,0.2)] px-2.5 py-1 font-mono text-micro uppercase tracking-wider text-[#93321A] transition-colors hover:bg-[rgba(147,50,26,0.3)]"
              >
                {t("discard.confirm.yes")}
              </button>
              <button
                onClick={() => setShowDiscardConfirm(false)}
                className="rounded-panel px-2.5 py-1 font-mono text-micro uppercase tracking-wider text-text-3 transition-colors hover:text-text-2"
              >
                {t("discard.confirm.no")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Template Replace Confirmation Overlay */}
      {showReplaceConfirm && (
        <div className="absolute inset-0 z-20 flex items-center justify-center rounded-sm bg-[rgba(0,0,0,0.4)] backdrop-blur-sm">
          <div className="max-w-[280px] space-y-2 rounded-chip border border-[rgba(255,255,255,0.08)] bg-[var(--surface-glass-dense)] p-3 backdrop-blur-[20px]">
            <p className="font-mohave text-body font-semibold text-text">
              {t("template.replace.title")}
            </p>
            <p className="font-mohave text-body-sm text-text-2">
              {t("template.replace.message")}
            </p>
            <div className="flex items-center gap-1 pt-1">
              <button
                onClick={() => {
                  applyTemplate(showReplaceConfirm);
                  setShowReplaceConfirm(null);
                }}
                className="rounded-panel bg-[rgba(255,255,255,0.08)] px-2.5 py-1 font-mono text-micro uppercase tracking-wider text-text transition-colors hover:bg-[rgba(255,255,255,0.12)]"
              >
                {t("template.replace.confirm")}
              </button>
              <button
                onClick={() => setShowReplaceConfirm(null)}
                className="rounded-panel px-2.5 py-1 font-mono text-micro uppercase tracking-wider text-text-3 transition-colors hover:text-text-2"
              >
                {t("template.replace.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Draft Replace Confirmation Overlay */}
      {showAiReplaceConfirm && (
        <div className="absolute inset-0 z-20 flex items-center justify-center rounded-sm bg-[rgba(0,0,0,0.4)] backdrop-blur-sm">
          <div className="max-w-[280px] space-y-2 rounded-chip border border-[rgba(255,255,255,0.08)] bg-[var(--surface-glass-dense)] p-3 backdrop-blur-[20px]">
            <p className="font-mohave text-body font-semibold text-text">
              {t("aiDraft.replace.title")}
            </p>
            <p className="font-mohave text-body-sm text-text-2">
              {t("aiDraft.replace.message")}
            </p>
            <div className="flex items-center gap-1 pt-1">
              <button
                onClick={() => {
                  setShowAiReplaceConfirm(false);
                  applyAiDraft();
                }}
                className="bg-[rgba(111, 148, 176,0.15)] border-[rgba(111, 148, 176,0.25)] hover:bg-[rgba(111, 148, 176,0.25)] rounded-panel border px-2.5 py-1 font-mono text-micro uppercase tracking-wider text-[#6F94B0] transition-colors"
              >
                {t("aiDraft.replace.confirm")}
              </button>
              <button
                onClick={() => setShowAiReplaceConfirm(false)}
                className="rounded-panel px-2.5 py-1 font-mono text-micro uppercase tracking-wider text-text-3 transition-colors hover:text-text-2"
              >
                {t("aiDraft.replace.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
