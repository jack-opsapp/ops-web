"use client";

import { useState, useMemo, useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Save, X, Search, Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useUpdateProject } from "@/lib/hooks/use-projects";
import { useClients } from "@/lib/hooks/use-clients";
import { useTeamMembers } from "@/lib/hooks/use-users";
import {
  ProjectStatus,
  getUserFullName,
  getInitials,
  type Project,
  type Client,
  type User,
} from "@/lib/types/models";
import { toast } from "sonner";

// Format a Date as YYYY-MM-DD using local-time components (lossless for
// `<input type="date">`, unlike `.toISOString().slice(0, 10)` which can drift
// one day for users east of UTC).
function toDateOnlyString(date: Date | null | undefined): string {
  if (!date) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ─── Form Schema ───────────────────────────────────────────────────────────────

const editProjectSchema = z.object({
  title: z.string().min(1, "Project name is required").max(200, "Name too long"),
  clientId: z.string().nullable(),
  address: z.string().max(500).optional().or(z.literal("")),
  status: z.nativeEnum(ProjectStatus),
  startDate: z.string().optional().or(z.literal("")),
  endDate: z.string().optional().or(z.literal("")),
  projectDescription: z.string().max(2000).optional().or(z.literal("")),
  notes: z.string().max(5000).optional().or(z.literal("")),
  teamMemberIds: z.array(z.string()),
});

type EditProjectFormData = z.infer<typeof editProjectSchema>;

// All statuses available on edit (create-modal only allows the early ones).
const statusOptions: { value: ProjectStatus; label: string }[] = [
  { value: ProjectStatus.RFQ, label: "RFQ" },
  { value: ProjectStatus.Estimated, label: "Estimated" },
  { value: ProjectStatus.Accepted, label: "Accepted" },
  { value: ProjectStatus.InProgress, label: "In Progress" },
  { value: ProjectStatus.Completed, label: "Completed" },
  { value: ProjectStatus.Closed, label: "Closed" },
  { value: ProjectStatus.Archived, label: "Archived" },
];

// ─── Client Selector ───────────────────────────────────────────────────────────

function ClientSelector({
  value,
  onChange,
  clients,
  isLoadingClients,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  clients: Client[];
  isLoadingClients: boolean;
}) {
  const [clientSearch, setClientSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);

  const filteredClients = useMemo(
    () =>
      clients.filter((c) =>
        c.name.toLowerCase().includes(clientSearch.toLowerCase())
      ),
    [clients, clientSearch]
  );

  const selectedClient = clients.find((c) => c.id === value);

  return (
    <div className="flex flex-col gap-0.5">
      <label className="font-mono text-caption-sm text-text-2 uppercase tracking-widest">
        Client
      </label>
      <div className="relative">
        {selectedClient ? (
          <div className="flex items-center justify-between bg-surface-input border border-[rgba(255,255,255,0.2)] rounded px-1.5 py-1.5">
            <span className="font-mohave text-body text-text">
              {selectedClient.name}
            </span>
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setClientSearch("");
              }}
              className="text-text-3 hover:text-text-2"
            >
              <X className="w-[16px] h-[16px]" />
            </button>
          </div>
        ) : (
          <div>
            <Input
              placeholder={isLoadingClients ? "Loading clients..." : "Search clients..."}
              value={clientSearch}
              onChange={(e) => {
                setClientSearch(e.target.value);
                setShowDropdown(true);
              }}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
              prefixIcon={<Search className="w-[16px] h-[16px]" />}
              disabled={isLoadingClients}
            />
            {showDropdown && !isLoadingClients && (
              <div className="absolute z-10 left-0 right-0 top-full mt-[4px] bg-[rgba(13,13,13,0.9)] backdrop-blur-xl border border-[rgba(255,255,255,0.2)] rounded max-h-[200px] overflow-y-auto">
                {filteredClients.length === 0 ? (
                  <div className="px-1.5 py-1 text-left">
                    <p className="font-mohave text-body-sm text-text-3">
                      {clients.length === 0 ? "No clients found" : "No matching clients"}
                    </p>
                  </div>
                ) : (
                  filteredClients.map((client) => (
                    <button
                      key={client.id}
                      type="button"
                      onMouseDown={() => {
                        onChange(client.id);
                        setShowDropdown(false);
                        setClientSearch("");
                      }}
                      className="w-full px-1.5 py-1 text-left font-mohave text-body text-text-2 hover:text-text hover:bg-[rgba(255,255,255,0.05)] transition-colors"
                    >
                      {client.name}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Team Member Selector ──────────────────────────────────────────────────────

function TeamMemberSelector({
  selectedIds,
  onChange,
  members,
  isLoading,
}: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  members: User[];
  isLoading: boolean;
}) {
  function toggleMember(id: string) {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((i) => i !== id)
        : [...selectedIds, id]
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-0.5">
        <label className="font-mono text-caption-sm text-text-2 uppercase tracking-widest">
          Team Members
        </label>
        <div className="flex flex-wrap gap-1">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[36px] w-[120px] bg-fill-neutral-dim rounded animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <div className="flex flex-col gap-0.5">
        <label className="font-mono text-caption-sm text-text-2 uppercase tracking-widest">
          Team Members
        </label>
        <p className="font-mohave text-body-sm text-text-3">
          No team members available
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <label className="font-mono text-caption-sm text-text-2 uppercase tracking-widest">
        Team Members
      </label>
      <div className="flex flex-wrap gap-1">
        {members.map((member) => {
          const isSelected = selectedIds.includes(member.id);
          const fullName = getUserFullName(member);
          return (
            <button
              key={member.id}
              type="button"
              onClick={() => toggleMember(member.id)}
              className={cn(
                "flex items-center gap-[6px] px-1.5 py-[8px] rounded border transition-all",
                isSelected
                  ? "bg-[rgba(255,255,255,0.08)] text-text border-[rgba(255,255,255,0.18)]"
                  : "bg-surface-input border-[rgba(255,255,255,0.2)] text-text-3 hover:text-text-2"
              )}
            >
              <div
                className={cn(
                  "w-[20px] h-[20px] rounded-full flex items-center justify-center text-micro",
                  isSelected
                    ? "bg-text-2 text-background"
                    : "bg-fill-neutral-dim text-text-3"
                )}
              >
                {isSelected ? (
                  <Check className="w-[12px] h-[12px]" />
                ) : (
                  getInitials(fullName)
                )}
              </div>
              <span className="font-mohave text-body-sm">{fullName}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Modal ─────────────────────────────────────────────────────────────────────

interface EditProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
}

export function EditProjectModal({
  open,
  onOpenChange,
  project,
}: EditProjectModalProps) {
  const updateProjectMutation = useUpdateProject();
  const { data: clientsData, isLoading: isLoadingClients } = useClients();
  const { data: teamData, isLoading: isLoadingTeam } = useTeamMembers();
  const clients = clientsData?.clients ?? [];
  const teamMembers = teamData?.users ?? [];

  const [serverError, setServerError] = useState<string | null>(null);

  const defaults: EditProjectFormData = useMemo(
    () => ({
      title: project.title ?? "",
      clientId: project.clientId,
      address: project.address ?? "",
      status: project.status,
      startDate: toDateOnlyString(project.startDate),
      endDate: toDateOnlyString(project.endDate),
      projectDescription: project.projectDescription ?? "",
      notes: project.notes ?? "",
      teamMemberIds: project.teamMemberIds ?? [],
    }),
    [project]
  );

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isDirty },
  } = useForm<EditProjectFormData>({
    resolver: zodResolver(editProjectSchema),
    defaultValues: defaults,
  });

  // When the dialog re-opens or the underlying project changes, refresh the form.
  useEffect(() => {
    if (open) reset(defaults);
  }, [open, defaults, reset]);

  function handleClose() {
    setServerError(null);
    reset(defaults);
    onOpenChange(false);
  }

  async function onSubmit(data: EditProjectFormData) {
    setServerError(null);
    updateProjectMutation.mutate(
      {
        id: project.id,
        data: {
          title: data.title,
          clientId: data.clientId,
          address: data.address || null,
          status: data.status,
          startDate: data.startDate ? new Date(data.startDate) : null,
          endDate: data.endDate ? new Date(data.endDate) : null,
          projectDescription: data.projectDescription || null,
          notes: data.notes || null,
          teamMemberIds: data.teamMemberIds,
        },
      },
      {
        onSuccess: () => {
          toast.success("Project updated");
          onOpenChange(false);
        },
        onError: (err) => {
          setServerError(
            err instanceof Error
              ? err.message
              : "Failed to update project. Please try again."
          );
        },
      }
    );
  }

  const isSaving = updateProjectMutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
        else onOpenChange(true);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="uppercase tracking-wider">Edit Project</DialogTitle>
          <DialogDescription>
            Update project details. Inline-edit fields on the page can also be
            used for quick changes.
          </DialogDescription>
        </DialogHeader>

        {serverError && (
          <div className="bg-ops-error-muted border border-ops-error/30 rounded px-1.5 py-1 animate-slide-up">
            <p className="font-mohave text-body-sm text-ops-error">{serverError}</p>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-2">
          <Input
            label="Project Name"
            placeholder="e.g., Kitchen Renovation - Smith"
            {...register("title")}
            error={errors.title?.message}
          />

          <Controller
            name="clientId"
            control={control}
            render={({ field }) => (
              <ClientSelector
                value={field.value}
                onChange={field.onChange}
                clients={clients}
                isLoadingClients={isLoadingClients}
              />
            )}
          />

          <Input
            label="Address"
            placeholder="123 Main Street, City, State ZIP"
            {...register("address")}
            error={errors.address?.message}
          />

          <Controller
            name="status"
            control={control}
            render={({ field }) => (
              <div className="flex flex-col gap-0.5">
                <label className="font-mono text-caption-sm text-text-2 uppercase tracking-widest">
                  Status
                </label>
                <div className="flex flex-wrap items-center gap-1">
                  {statusOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => field.onChange(opt.value)}
                      className={cn(
                        "px-1.5 py-[8px] rounded border font-mohave text-body-sm transition-all uppercase",
                        field.value === opt.value
                          ? "bg-[rgba(255,255,255,0.08)] text-text border-[rgba(255,255,255,0.18)]"
                          : "bg-surface-input border-[rgba(255,255,255,0.2)] text-text-3 hover:text-text-2"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input
              label="Start Date"
              type="date"
              {...register("startDate")}
              error={errors.startDate?.message}
            />
            <Input
              label="End Date"
              type="date"
              {...register("endDate")}
              error={errors.endDate?.message}
            />
          </div>

          <Controller
            name="teamMemberIds"
            control={control}
            render={({ field }) => (
              <TeamMemberSelector
                selectedIds={field.value}
                onChange={field.onChange}
                members={teamMembers}
                isLoading={isLoadingTeam}
              />
            )}
          />

          <Textarea
            label="Description"
            placeholder="Project description..."
            {...register("projectDescription")}
            error={errors.projectDescription?.message}
          />

          <Textarea
            label="Notes"
            placeholder="Project notes, special instructions..."
            {...register("notes")}
            error={errors.notes?.message}
          />

          <div className="flex items-center justify-end gap-1 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={handleClose}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={isSaving}
              disabled={!isDirty}
              className="gap-[6px]"
            >
              <Save className="w-[16px] h-[16px]" />
              Save Changes
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
