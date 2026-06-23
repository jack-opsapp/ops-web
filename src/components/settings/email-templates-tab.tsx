"use client";

import { useState, useCallback } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FilterChips } from "@/components/ui/filter-chip";
import {
  RegisterTable,
  RegisterEmpty,
  Tag,
  TablePrimary,
  TableMeta,
} from "@/components/ui/register-table";
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
          <Input
            label={t("field.name")}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder={t("field.name.placeholder")}
            autoFocus
          />

          {/* Category */}
          <div className="space-y-1">
            <label className="font-mohave text-caption-sm text-text-3 uppercase tracking-[0.08em]">
              {t("field.category")}
            </label>
            <FilterChips
              options={EMAIL_TEMPLATE_CATEGORIES.map((cat) => ({
                value: cat,
                label: t(`category.${cat}`),
              }))}
              value={form.category}
              onChange={(cat) =>
                setForm((f) => ({ ...f, category: cat as EmailTemplateCategory }))
              }
            />
          </div>

          {/* Subject */}
          <Input
            label={t("field.subject")}
            value={form.subject}
            onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
            placeholder={t("field.subject.placeholder")}
          />

          {/* Body */}
          <Textarea
            label={t("field.body")}
            value={form.body}
            onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
            placeholder={t("field.body.placeholder")}
            rows={6}
            className="leading-relaxed"
          />

          {/* Merge Fields Reference */}
          <div className="rounded-panel border border-border-subtle bg-surface-input/40 px-2.5 py-2">
            <span className="mb-1.5 block font-mono text-micro uppercase tracking-[0.16em] text-text-3">
              <span className="text-text-mute">{"// "}</span>
              {t("mergeFields.title")}
            </span>
            <div className="flex flex-wrap gap-1">
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
                  title={field.label}
                  className="transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent rounded-chip"
                >
                  <Tag variant="tan">{field.key}</Tag>
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={!form.name.trim() || isPending}
            loading={isPending}
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
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button variant="destructive" size="sm" onClick={onConfirm}>
            {t("delete.confirm.yes")}
          </Button>
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
          <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
            <span className="text-text-mute">{"// "}</span>
            {t("title")}
          </span>
          <p className="font-mohave text-body-sm text-text-2 mt-0.5">
            {t("description")}
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setShowCreateModal(true)}>
          <Plus className="w-[12px] h-[12px]" />
          {t("create")}
        </Button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[56px] rounded-chip bg-surface-input/40 border border-border-subtle animate-pulse"
            />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && templates.length === 0 && (
        <div className="glass-surface rounded-panel">
          <RegisterEmpty noun={t("title")} hint={t("empty.description")} />
        </div>
      )}

      {/* Template List (grouped by category) */}
      {!isLoading &&
        templates.length > 0 &&
        EMAIL_TEMPLATE_CATEGORIES.filter((cat) => grouped[cat]?.length).map(
          (category) => (
            <div key={category} className="space-y-1.5">
              <span className="block font-mono text-micro uppercase tracking-[0.16em] text-text-3">
                <span className="text-text-mute">{"// "}</span>
                {t(`category.${category}`)}
              </span>
              <RegisterTable
                ariaLabel={t(`category.${category}`)}
                rows={grouped[category]}
                getRowId={(tpl) => tpl.id}
                onRowClick={(tpl) => setEditingTemplate(tpl)}
                minWidth={420}
                columns={[
                  {
                    id: "name",
                    header: t("field.name"),
                    cell: (tpl) => (
                      <div className="min-w-0">
                        <TablePrimary>{tpl.name}</TablePrimary>
                        {tpl.subject && (
                          <TableMeta>{tpl.subject}</TableMeta>
                        )}
                      </div>
                    ),
                  },
                  {
                    id: "actions",
                    header: "",
                    align: "right",
                    cell: (tpl) => (
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingTemplate(tpl);
                          }}
                          className="rounded-chip p-1 text-text-3 transition-colors hover:bg-surface-hover hover:text-text"
                          title={t("edit")}
                        >
                          <Pencil className="h-[13px] w-[13px]" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeletingTemplate(tpl);
                          }}
                          className="rounded-chip p-1 text-text-3 transition-colors hover:bg-rose-soft hover:text-rose"
                          title={t("delete")}
                        >
                          <Trash2 className="h-[13px] w-[13px]" />
                        </button>
                      </div>
                    ),
                  },
                ]}
              />
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
