"use client";

import { useState, useCallback } from "react";
import { Plus, Pencil, Trash2, FileText } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  useAllEmailTemplates,
  useCreateEmailTemplate,
  useUpdateEmailTemplate,
  useDeleteEmailTemplate,
} from "@/lib/hooks/use-email-templates";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type {
  EmailTemplate,
  EmailTemplateCategory,
  CreateEmailTemplate,
  UpdateEmailTemplate,
} from "@/lib/types/email-template";
import { EMAIL_TEMPLATE_CATEGORIES, MERGE_FIELDS } from "@/lib/types/email-template";

// ─── Template Form ──────────────────────────────────────────────────────────

interface TemplateFormState {
  name: string;
  subject: string;
  body: string;
  category: EmailTemplateCategory;
}

const EMPTY_FORM: TemplateFormState = {
  name: "",
  subject: "",
  body: "",
  category: "general",
};

function TemplateFormModal({
  open,
  onOpenChange,
  editTemplate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editTemplate?: EmailTemplate | null;
}) {
  const { t } = useDictionary("email-templates");
  const { currentUser, company } = useAuthStore();
  const createMutation = useCreateEmailTemplate();
  const updateMutation = useUpdateEmailTemplate();

  const [form, setForm] = useState<TemplateFormState>(
    editTemplate
      ? {
          name: editTemplate.name,
          subject: editTemplate.subject,
          body: editTemplate.body,
          category: editTemplate.category,
        }
      : EMPTY_FORM
  );

  const handleSave = useCallback(async () => {
    if (!form.name.trim()) return;

    if (editTemplate) {
      const data: UpdateEmailTemplate = {
        name: form.name.trim(),
        subject: form.subject.trim(),
        body: form.body.trim(),
        category: form.category,
      };
      await updateMutation.mutateAsync({ id: editTemplate.id, data });
    } else {
      const data: CreateEmailTemplate = {
        companyId: company?.id ?? "",
        name: form.name.trim(),
        subject: form.subject.trim(),
        body: form.body.trim(),
        category: form.category,
        createdBy: currentUser?.id,
      };
      await createMutation.mutateAsync(data);
    }
    onOpenChange(false);
  }, [form, editTemplate, company?.id, currentUser?.id, createMutation, updateMutation, onOpenChange]);

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {editTemplate ? t("edit") : t("create")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {editTemplate ? t("edit") : t("create")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* Name */}
          <div className="space-y-1">
            <label className="font-mono text-micro text-text-mute uppercase tracking-wider">
              {t("field.name")}
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder={t("field.name.placeholder")}
              className="w-full px-2.5 py-1.5 rounded-panel bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] font-mohave text-body-sm text-text placeholder:text-text-mute outline-none focus:border-[rgba(111, 148, 176,0.4)] transition-colors"
              autoFocus
            />
          </div>

          {/* Category */}
          <div className="space-y-1">
            <label className="font-mono text-micro text-text-mute uppercase tracking-wider">
              {t("field.category")}
            </label>
            <div className="flex flex-wrap gap-1">
              {EMAIL_TEMPLATE_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setForm((f) => ({ ...f, category: cat }))}
                  className={cn(
                    "px-2 py-0.5 rounded-panel font-mono text-micro uppercase tracking-wider transition-colors",
                    form.category === cat
                      ? "bg-[rgba(111, 148, 176,0.15)] text-[#6F94B0] border border-[rgba(111, 148, 176,0.3)]"
                      : "bg-[rgba(255,255,255,0.04)] text-text-3 border border-[rgba(255,255,255,0.06)] hover:text-text-2"
                  )}
                >
                  {t(`category.${cat}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Subject */}
          <div className="space-y-1">
            <label className="font-mono text-micro text-text-mute uppercase tracking-wider">
              {t("field.subject")}
            </label>
            <input
              type="text"
              value={form.subject}
              onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
              placeholder={t("field.subject.placeholder")}
              className="w-full px-2.5 py-1.5 rounded-panel bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] font-mohave text-body-sm text-text placeholder:text-text-mute outline-none focus:border-[rgba(111, 148, 176,0.4)] transition-colors"
            />
          </div>

          {/* Body */}
          <div className="space-y-1">
            <label className="font-mono text-micro text-text-mute uppercase tracking-wider">
              {t("field.body")}
            </label>
            <textarea
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              placeholder={t("field.body.placeholder")}
              rows={6}
              className="w-full px-2.5 py-1.5 rounded-panel bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] font-mohave text-body-sm text-text placeholder:text-text-mute outline-none focus:border-[rgba(111, 148, 176,0.4)] transition-colors resize-none leading-relaxed"
            />
          </div>

          {/* Merge Fields Reference */}
          <div className="px-2.5 py-2 rounded-panel bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.04)]">
            <span className="font-mono text-micro text-text-mute uppercase tracking-wider block mb-1">
              {t("mergeFields.title")}
            </span>
            <div className="space-y-0.5">
              {MERGE_FIELDS.map((field) => (
                <button
                  key={field.key}
                  type="button"
                  onClick={() => {
                    setForm((f) => ({
                      ...f,
                      body: f.body + field.key,
                    }));
                  }}
                  className="block w-full text-left font-mohave text-caption-sm text-text-3 hover:text-[#C4A868] transition-colors"
                >
                  <span className="text-[#C4A868]">{field.key}</span>
                  <span className="text-text-mute"> — {field.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="px-3 py-1.5 font-mono text-micro text-text-3 uppercase tracking-wider hover:text-text-2 transition-colors"
          >
            {t("cancel")}
          </button>
          <Button
            onClick={handleSave}
            disabled={!form.name.trim() || isPending}
            className="px-3 py-1.5 bg-text-primary text-[#0A0A0A] font-mono text-[11px] uppercase tracking-wider rounded-panel hover:bg-text-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete Confirmation ────────────────────────────────────────────────────

function DeleteConfirmModal({
  open,
  onOpenChange,
  template,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: EmailTemplate | null;
  onConfirm: () => void;
}) {
  const { t } = useDictionary("email-templates");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[340px]">
        <DialogHeader>
          <DialogTitle>{t("delete.confirm.title")}</DialogTitle>
          <DialogDescription>
            {t("delete.confirm.message")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="px-3 py-1.5 font-mono text-micro text-text-3 uppercase tracking-wider hover:text-text-2 transition-colors"
          >
            {t("cancel")}
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 rounded-panel bg-[rgba(147,50,26,0.2)] border border-[rgba(147,50,26,0.3)] font-mono text-micro text-[#93321A] uppercase tracking-wider hover:bg-[rgba(147,50,26,0.3)] transition-colors"
          >
            {t("delete.confirm.yes")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Tab Component ─────────────────────────────────────────────────────

export function EmailTemplatesTab() {
  const { t } = useDictionary("email-templates");
  const { data: templates = [], isLoading } = useAllEmailTemplates();
  const deleteMutation = useDeleteEmailTemplate();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [deletingTemplate, setDeletingTemplate] = useState<EmailTemplate | null>(null);

  const handleDelete = useCallback(async () => {
    if (!deletingTemplate) return;
    await deleteMutation.mutateAsync(deletingTemplate.id);
    setDeletingTemplate(null);
  }, [deletingTemplate, deleteMutation]);

  // Group templates by category
  const grouped = templates.reduce(
    (acc, tpl) => {
      const key = tpl.category;
      if (!acc[key]) acc[key] = [];
      acc[key].push(tpl);
      return acc;
    },
    {} as Record<string, EmailTemplate[]>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-mohave text-heading text-text">
            {t("title")}
          </h2>
          <p className="font-mohave text-body-sm text-text-2 mt-0.5">
            {t("description")}
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-panel bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.08)] font-mono text-micro text-text-2 uppercase tracking-wider hover:bg-[rgba(255,255,255,0.1)] hover:text-text transition-colors"
        >
          <Plus className="w-[12px] h-[12px]" />
          {t("create")}
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[56px] rounded-[4px] bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.04)] animate-pulse"
            />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && templates.length === 0 && (
        <div className="py-8 text-center rounded-[4px] border border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.01)]">
          <FileText className="w-[24px] h-[24px] text-text-mute mx-auto mb-2" />
          <p className="font-mohave text-body text-text-2">
            {t("empty.title")}
          </p>
          <p className="font-mohave text-body-sm text-text-mute mt-0.5">
            {t("empty.description")}
          </p>
        </div>
      )}

      {/* Template List (grouped by category) */}
      {!isLoading &&
        templates.length > 0 &&
        EMAIL_TEMPLATE_CATEGORIES.filter((cat) => grouped[cat]?.length).map(
          (category) => (
            <div key={category}>
              <div className="mb-1.5">
                <span className="font-mono text-micro text-text-mute uppercase tracking-wider">
                  {t(`category.${category}`)}
                </span>
              </div>
              <div className="space-y-1">
                {grouped[category].map((tpl) => (
                  <div
                    key={tpl.id}
                    className={cn(
                      "flex items-center gap-2.5 px-3 py-2 rounded-[4px]",
                      "border border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.02)]",
                      "hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.06)]",
                      "transition-colors group"
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-mohave text-body-sm text-text truncate">
                        {tpl.name}
                      </p>
                      {tpl.subject && (
                        <p className="font-mohave text-caption-sm text-text-mute truncate">
                          {tpl.subject}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => setEditingTemplate(tpl)}
                        className="p-1 rounded-panel text-text-3 hover:text-text hover:bg-[rgba(255,255,255,0.06)] transition-colors"
                        title={t("edit")}
                      >
                        <Pencil className="w-[13px] h-[13px]" />
                      </button>
                      <button
                        onClick={() => setDeletingTemplate(tpl)}
                        className="p-1 rounded-panel text-text-3 hover:text-[#93321A] hover:bg-[rgba(147,50,26,0.1)] transition-colors"
                        title={t("delete")}
                      >
                        <Trash2 className="w-[13px] h-[13px]" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        )}

      {/* Create / Edit Modal */}
      {showCreateModal && (
        <TemplateFormModal
          open={showCreateModal}
          onOpenChange={setShowCreateModal}
        />
      )}
      {editingTemplate && (
        <TemplateFormModal
          open={!!editingTemplate}
          onOpenChange={(open) => {
            if (!open) setEditingTemplate(null);
          }}
          editTemplate={editingTemplate}
        />
      )}

      {/* Delete Confirmation */}
      <DeleteConfirmModal
        open={!!deletingTemplate}
        onOpenChange={(open) => {
          if (!open) setDeletingTemplate(null);
        }}
        template={deletingTemplate}
        onConfirm={handleDelete}
      />
    </div>
  );
}
