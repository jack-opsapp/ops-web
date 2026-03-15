"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, Trash2, GripVertical, Loader2, Save, X, Users, Clock, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useTaskTypes,
  useCreateTaskType,
  useUpdateTaskType,
  useDeleteTaskType,
  useTeamMembers,
} from "@/lib/hooks";
import {
  useTaskTemplates,
  useCreateTaskTemplate,
  useUpdateTaskTemplate,
  useDeleteTaskTemplate,
} from "@/lib/hooks/use-task-templates";
import { useAuthStore } from "@/lib/store/auth-store";
import { getUserFullName } from "@/lib/types/models";
import type { TaskType } from "@/lib/types/models";
import type { TaskTemplate } from "@/lib/types/pipeline";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { TaskTypesWizard } from "./task-types-wizard";

// ─── Default Crew Picker ─────────────────────────────────────────────────────

function CrewPicker({
  selectedIds,
  onChange,
}: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useDictionary("settings");
  const { data: teamData } = useTeamMembers();
  const members = teamData?.users ?? [];
  const [open, setOpen] = useState(false);

  function toggle(id: string) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((i) => i !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  const selectedNames = members
    .filter((m) => selectedIds.includes(m.id))
    .map(getUserFullName);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-[6px] px-1.5 py-[8px] bg-background-input border border-border rounded font-mohave text-body-sm text-text-primary text-left"
      >
        <Users className="w-[14px] h-[14px] text-text-disabled shrink-0" />
        {selectedNames.length > 0 ? (
          <span className="truncate">{selectedNames.join(", ")}</span>
        ) : (
          <span className="text-text-disabled">{t("taskTypes.crewPlaceholder")}</span>
        )}
      </button>
      {open && (
        <div className="absolute z-50 top-full mt-[4px] left-0 w-full max-h-[200px] overflow-y-auto bg-background-elevated border border-border rounded shadow-lg">
          {members.map((member) => {
            const name = getUserFullName(member);
            const selected = selectedIds.includes(member.id);
            return (
              <button
                key={member.id}
                type="button"
                onClick={() => toggle(member.id)}
                className={cn(
                  "w-full flex items-center gap-1 px-1.5 py-[8px] text-left font-mohave text-body-sm transition-colors",
                  selected
                    ? "bg-ops-accent-muted text-ops-accent"
                    : "text-text-primary hover:bg-[rgba(255,255,255,0.04)]"
                )}
              >
                <div
                  className={cn(
                    "w-[16px] h-[16px] rounded-sm border flex items-center justify-center shrink-0",
                    selected ? "bg-ops-accent border-ops-accent" : "border-border"
                  )}
                >
                  {selected && <span className="text-[10px] text-white font-bold">✓</span>}
                </div>
                {name}
              </button>
            );
          })}
          {members.length === 0 && (
            <p className="px-1.5 py-[8px] font-mohave text-body-sm text-text-disabled">
              {t("taskTypes.noMembers")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Task Templates Section ──────────────────────────────────────────────────

function TaskTemplatesSection({ taskType }: { taskType: TaskType }) {
  const { t } = useDictionary("settings");
  const can = usePermissionStore((s) => s.can);
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  const { data: templates = [], isLoading } = useTaskTemplates(taskType.id);
  const createTemplate = useCreateTaskTemplate();
  const updateTemplate = useUpdateTaskTemplate();
  const deleteTemplate = useDeleteTaskTemplate();

  const [newTitle, setNewTitle] = useState("");
  const [newHours, setNewHours] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editHours, setEditHours] = useState("");

  function handleAdd() {
    if (!can("settings.company")) return;
    if (!newTitle.trim()) return;
    createTemplate.mutate(
      {
        companyId,
        taskTypeId: taskType.id,
        title: newTitle.trim(),
        description: null,
        estimatedHours: newHours ? parseFloat(newHours) : null,
        displayOrder: templates.length,
        defaultTeamMemberIds: [],
      },
      {
        onSuccess: () => {
          setNewTitle("");
          setNewHours("");
          toast.success(t("taskTypes.toast.templateAdded"));
        },
        onError: (err) => toast.error(t("taskTypes.toast.templateAddFailed"), { description: err.message }),
      }
    );
  }

  function handleUpdate(template: TaskTemplate) {
    if (!can("settings.company")) return;
    updateTemplate.mutate(
      {
        id: template.id,
        data: {
          id: template.id,
          title: editTitle.trim(),
          estimatedHours: editHours ? parseFloat(editHours) : null,
        },
      },
      {
        onSuccess: () => {
          setEditingId(null);
          toast.success(t("taskTypes.toast.templateUpdated"));
        },
        onError: (err) => toast.error(t("taskTypes.toast.templateUpdateFailed"), { description: err.message }),
      }
    );
  }

  function handleDelete(id: string) {
    if (!can("settings.company")) return;
    deleteTemplate.mutate(id, {
      onSuccess: () => toast.success(t("taskTypes.toast.templateRemoved")),
      onError: (err) => toast.error(t("taskTypes.toast.templateRemoveFailed"), { description: err.message }),
    });
  }

  function startEdit(template: TaskTemplate) {
    setEditingId(template.id);
    setEditTitle(template.title);
    setEditHours(template.estimatedHours?.toString() ?? "");
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-[6px] py-[4px]">
        <Loader2 className="w-[14px] h-[14px] text-text-disabled animate-spin" />
        <span className="font-mohave text-body-sm text-text-disabled">{t("taskTypes.loadingTemplates")}</span>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
        {t("taskTypes.taskTemplates")}
      </label>
      <p className="font-kosugi text-[11px] text-text-disabled">
        {t("taskTypes.templateHelper")}
      </p>

      {templates.length > 0 && (
        <div className="space-y-0">
          {templates.map((template) => (
            <div
              key={template.id}
              className="flex items-center gap-1 py-[6px] border-b border-[rgba(255,255,255,0.04)] last:border-0"
            >
              <GripVertical className="w-[14px] h-[14px] text-text-disabled shrink-0" />
              {editingId === template.id ? (
                <>
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="flex-1 h-[32px]"
                    autoFocus
                  />
                  <Input
                    value={editHours}
                    onChange={(e) => setEditHours(e.target.value)}
                    placeholder={t("taskTypes.hrs")}
                    className="w-[56px] h-[32px]"
                    type="number"
                    step="0.5"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleUpdate(template)}
                    disabled={updateTemplate.isPending}
                  >
                    <Save className="w-[14px] h-[14px]" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingId(null)}
                  >
                    <X className="w-[14px] h-[14px]" />
                  </Button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => startEdit(template)}
                    className="flex-1 text-left font-mohave text-body-sm text-text-primary hover:text-ops-accent transition-colors"
                  >
                    {template.title}
                  </button>
                  {template.estimatedHours != null && (
                    <span className="flex items-center gap-[2px] font-mono text-[10px] text-text-disabled shrink-0">
                      <Clock className="w-[10px] h-[10px]" />
                      {template.estimatedHours}h
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(template.id)}
                    className="text-text-disabled hover:text-ops-error shrink-0"
                  >
                    <Trash2 className="w-[14px] h-[14px]" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1 pt-[4px]">
        <Input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder={t("taskTypes.templatePlaceholder")}
          className="flex-1 h-[32px]"
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
        />
        <Input
          value={newHours}
          onChange={(e) => setNewHours(e.target.value)}
          placeholder="hrs"
          className="w-[56px] h-[32px]"
          type="number"
          step="0.5"
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={handleAdd}
          disabled={!newTitle.trim() || createTemplate.isPending}
          className="gap-[4px] shrink-0"
        >
          <Plus className="w-[14px] h-[14px]" />
          Add
        </Button>
      </div>
    </div>
  );
}

// ─── Task Type Card ──────────────────────────────────────────────────────────

function TaskTypeCard({ taskType }: { taskType: TaskType }) {
  const { t } = useDictionary("settings");
  const can = usePermissionStore((s) => s.can);
  const updateTaskType = useUpdateTaskType();
  const [expanded, setExpanded] = useState(false);

  function handleCrewChange(ids: string[]) {
    if (!can("settings.company")) return;
    updateTaskType.mutate(
      { id: taskType.id, data: { defaultTeamMemberIds: ids } },
      {
        onError: (err) => toast.error(t("taskTypes.toast.crewUpdateFailed"), { description: err.message }),
      }
    );
  }

  return (
    <div className="border border-[rgba(255,255,255,0.08)] rounded overflow-hidden">
      {/* Header — always visible, click to expand */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-1.5 p-2 text-left hover:bg-[rgba(255,255,255,0.02)] transition-colors"
      >
        <div
          className="w-[12px] h-[12px] rounded-full shrink-0"
          style={{ backgroundColor: taskType.color }}
        />
        <h4 className="font-mohave text-body text-text-primary flex-1">{taskType.display}</h4>
        {taskType.isDefault && (
          <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider">
            {t("taskTypes.default")}
          </span>
        )}
        <svg
          className={cn(
            "w-[14px] h-[14px] text-text-disabled transition-transform duration-200",
            expanded && "rotate-180"
          )}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expandable content */}
      {expanded && (
        <div className="px-2 pb-2 space-y-2 border-t border-[rgba(255,255,255,0.04)]">
          {/* Section: Default Crew */}
          <div className="space-y-1 pt-1.5">
            <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
              {t("taskTypes.defaultCrew")}
            </label>
            <CrewPicker
              selectedIds={taskType.defaultTeamMemberIds ?? []}
              onChange={handleCrewChange}
            />
          </div>

          {/* Divider */}
          <div className="border-t border-[rgba(255,255,255,0.06)]" />

          {/* Section: Task Templates */}
          <TaskTemplatesSection taskType={taskType} />
        </div>
      )}
    </div>
  );
}

// ─── Main Tab ────────────────────────────────────────────────────────────────

export function TaskTypesTab() {
  const { t } = useDictionary("settings");
  const can = usePermissionStore((s) => s.can);
  const searchParams = useSearchParams();
  const { data: taskTypes = [], isLoading } = useTaskTypes();
  const createTaskType = useCreateTaskType();

  const [showWizard, setShowWizard] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#417394");
  const [forceWizard, setForceWizard] = useState(false);

  const activeTypes = taskTypes.filter((tt) => !tt.deletedAt);

  // Launch wizard when navigated with ?wizard=true (even if task types exist)
  useEffect(() => {
    if (searchParams.get("wizard") === "true") {
      setForceWizard(true);
    }
  }, [searchParams]);

  function handleCreate() {
    if (!can("settings.company")) return;
    if (!newName.trim()) return;
    createTaskType.mutate(
      { display: newName.trim(), color: newColor },
      {
        onSuccess: () => {
          setNewName("");
          setNewColor("#417394");
          setShowCreate(false);
          toast.success(t("taskTypes.toast.created"));
        },
        onError: (err) => toast.error(t("taskTypes.toast.createFailed"), { description: err.message }),
      }
    );
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t("taskTypes.title")} ({activeTypes.length})</CardTitle>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowCreate(!showCreate)}
              className="gap-[4px]"
            >
              <Plus className="w-[14px] h-[14px]" />
              {t("taskTypes.addType")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="font-mohave text-body-sm text-text-secondary">
            {t("taskTypes.description")}
          </p>

          {showCreate && (
            <div className="flex items-end gap-1 p-1.5 bg-[rgba(255,255,255,0.02)] border border-border rounded">
              <Input
                label={t("taskTypes.nameLabel")}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("taskTypes.namePlaceholder")}
                className="flex-1"
                autoFocus
              />
              <div className="flex flex-col gap-0.5">
                <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
                  {t("taskTypes.color")}
                </label>
                <input
                  type="color"
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  className="w-[40px] h-[36px] rounded border border-border bg-transparent cursor-pointer"
                />
              </div>
              <Button
                onClick={handleCreate}
                disabled={!newName.trim() || createTaskType.isPending}
                loading={createTaskType.isPending}
                size="sm"
              >
                Create
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowCreate(false)}
              >
                <X className="w-[14px] h-[14px]" />
              </Button>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-[20px] h-[20px] text-ops-accent animate-spin" />
            </div>
          ) : forceWizard || (activeTypes.length === 0 && showWizard) ? (
            <TaskTypesWizard onComplete={() => { setShowWizard(false); setForceWizard(false); }} />
          ) : activeTypes.length === 0 ? (
            <div className="flex flex-col items-start gap-1.5 py-2">
              <p className="font-mohave text-body-sm text-text-tertiary">
                {t("taskTypes.emptyState")}
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowWizard(true)}
              >
                Run Setup
              </Button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5">
                {activeTypes.map((taskType) => (
                  <TaskTypeCard key={taskType.id} taskType={taskType} />
                ))}
              </div>
              <div className="pt-1">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setForceWizard(true)}
                  className="gap-[4px]"
                >
                  <Wand2 className="w-[14px] h-[14px]" />
                  {t("taskTypes.runWizard")}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
