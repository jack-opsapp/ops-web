"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  ArrowLeft,
  Edit3,
  Trash2,
  Phone,
  Mail,
  MapPin,
  FolderKanban,
  Users,
  Plus,
  ExternalLink,
  StickyNote,
  Copy,
  Check,
  X,
  Save,
  Navigation,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ops/confirm-dialog";
import { toast } from "sonner";
import {
  useClient,
  useSubClients,
  useProjects,
  useUpdateClient,
  useDeleteClient,
  useCreateSubClient,
  useDeleteSubClient,
} from "@/lib/hooks";
import { getInitials } from "@/lib/types/models";
import type { Project } from "@/lib/types/models";

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  RFQ: { label: "RFQ", color: "text-status-rfq", bg: "bg-status-rfq/15" },
  Estimated: { label: "ESTIMATED", color: "text-status-estimated", bg: "bg-status-estimated/15" },
  Accepted: { label: "ACCEPTED", color: "text-status-accepted", bg: "bg-status-accepted/15" },
  "In Progress": { label: "IN PROGRESS", color: "text-status-in-progress", bg: "bg-status-in-progress/15" },
  Completed: { label: "COMPLETED", color: "text-status-completed", bg: "bg-status-completed/15" },
  Closed: { label: "CLOSED", color: "text-status-completed", bg: "bg-status-completed/15" },
  Archived: { label: "ARCHIVED", color: "text-status-completed", bg: "bg-status-completed/15" },
};

// ─── Sub-Client Inline Form ──────────────────────────────────────────────────

function AddSubClientForm({
  onSave,
  onCancel,
  isSaving,
}: {
  onSave: (data: { name: string; title: string; phone: string; email: string }) => void;
  onCancel: () => void;
  isSaving?: boolean;
}) {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setError(null);
    onSave({ name: name.trim(), title: title.trim(), phone: phone.trim(), email: email.trim() });
  }

  return (
    <div className="border border-ops-accent/30 rounded-lg p-1.5 space-y-1 bg-background-elevated/30 animate-slide-up">
      <div className="grid grid-cols-2 gap-1">
        <Input
          placeholder="Name *"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={error && !name.trim() ? "Required" : undefined}
        />
        <Input
          placeholder="Title (e.g., Spouse)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-1">
        <Input
          placeholder="Phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          prefixIcon={<Phone className="w-[14px] h-[14px]" />}
        />
        <Input
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          prefixIcon={<Mail className="w-[14px] h-[14px]" />}
        />
      </div>
      <div className="flex items-center justify-end gap-1">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSubmit} className="gap-[4px]" loading={isSaving}>
          <Save className="w-[13px] h-[13px]" />
          Add
        </Button>
      </div>
    </div>
  );
}

// ─── Copied Feedback ─────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={handleCopy}
      className="p-[4px] rounded text-text-disabled hover:text-text-secondary transition-colors"
      title="Copy"
    >
      {copied ? (
        <Check className="w-[13px] h-[13px] text-status-success" />
      ) : (
        <Copy className="w-[13px] h-[13px]" />
      )}
    </button>
  );
}

// ─── Loading Skeleton ────────────────────────────────────────────────────────

function DetailLoadingSkeleton() {
  return (
    <div className="space-y-3 max-w-[1000px] animate-pulse">
      <div className="flex items-start gap-2">
        <div className="w-[40px] h-[40px] rounded bg-background-elevated shrink-0" />
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-1.5">
            <div className="w-[52px] h-[52px] rounded-full bg-background-elevated" />
            <div className="space-y-1 flex-1">
              <div className="h-[24px] bg-background-elevated rounded w-1/3" />
              <div className="h-[14px] bg-background-elevated rounded w-1/4" />
            </div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
        <div className="space-y-2">
          <div className="h-[200px] bg-background-card border border-border rounded-lg" />
          <div className="h-[120px] bg-background-card border border-border rounded-lg" />
          <div className="h-[150px] bg-background-card border border-border rounded-lg" />
        </div>
        <div className="lg:col-span-2">
          <div className="h-[300px] bg-background-card border border-border rounded-lg" />
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function ClientDetailPage() {
  const router = useRouter();
  const params = useParams();
  const clientId = params.id as string;

  // Data hooks
  const { data: clientData, isLoading: clientLoading } = useClient(clientId);
  const { data: subClientsData, isLoading: subClientsLoading } = useSubClients(clientId);
  const { data: projectsData, isLoading: projectsLoading } = useProjects({ clientId });

  // Mutation hooks
  const updateClient = useUpdateClient();
  const deleteClient = useDeleteClient();
  const createSubClient = useCreateSubClient();
  const deleteSubClient = useDeleteSubClient();

  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showAddSubClient, setShowAddSubClient] = useState(false);

  // Editable fields
  const [editName, setEditName] = useState("");
  const [editCompany, setEditCompany] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editNotes, setEditNotes] = useState("");

  // Sync edit fields when clientData loads
  useEffect(() => {
    if (clientData) {
      setEditName(clientData.name ?? "");
      setEditCompany("");
      setEditEmail(clientData.email ?? "");
      setEditPhone(clientData.phoneNumber ?? "");
      setEditAddress(clientData.address ?? "");
      setEditNotes(clientData.notes ?? "");
    }
  }, [clientData]);

  // Loading state
  if (clientLoading) {
    return <DetailLoadingSkeleton />;
  }

  // Not found
  if (!clientData) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <h2 className="font-mohave text-display text-text-primary">Client Not Found</h2>
        <p className="font-kosugi text-caption text-text-tertiary mt-1">
          This client may have been deleted or doesn&apos;t exist.
        </p>
        <Button className="mt-3" onClick={() => router.push("/clients")}>
          Back to Clients
        </Button>
      </div>
    );
  }

  // Derived data
  const subClients = (subClientsData ?? clientData.subClients ?? []).filter(
    (sc) => !sc.deletedAt
  );
  const clientProjects: Project[] = (projectsData?.projects ?? []).filter(
    (p) => !p.deletedAt
  );
  const activeProjects = clientProjects.filter(
    (p) =>
      p.status !== "Completed" && p.status !== "Closed" && p.status !== "Archived"
  );
  const completedProjects = clientProjects.filter(
    (p) => p.status === "Completed" || p.status === "Closed" || p.status === "Archived"
  );

  const mapUrl = clientData.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(clientData.address)}`
    : null;

  function handleSaveEdit() {
    updateClient.mutate(
      {
        id: clientId,
        data: {
          name: editName.trim() || clientData!.name,
          email: editEmail.trim() || null,
          phoneNumber: editPhone.trim() || null,
          address: editAddress.trim() || null,
          notes: editNotes.trim() || null,
        },
      },
      {
        onSuccess: () => {
          toast.success("Client updated successfully");
          setIsEditing(false);
        },
        onError: () => {
          toast.error("Failed to update client");
        },
      }
    );
  }

  function handleCancelEdit() {
    setEditName(clientData!.name ?? "");
    setEditCompany("");
    setEditEmail(clientData!.email ?? "");
    setEditPhone(clientData!.phoneNumber ?? "");
    setEditAddress(clientData!.address ?? "");
    setEditNotes(clientData!.notes ?? "");
    setIsEditing(false);
  }

  function handleDelete() {
    deleteClient.mutate(clientId, {
      onSuccess: () => {
        toast.success("Client deleted");
        router.push("/clients");
      },
      onError: () => {
        toast.error("Failed to delete client");
        setShowDeleteDialog(false);
      },
    });
  }

  function handleAddSubClient(data: { name: string; title: string; phone: string; email: string }) {
    createSubClient.mutate(
      {
        name: data.name,
        title: data.title || null,
        phoneNumber: data.phone || null,
        email: data.email || null,
        clientId,
      },
      {
        onSuccess: () => {
          toast.success("Sub-client added");
          setShowAddSubClient(false);
        },
        onError: () => {
          toast.error("Failed to add sub-client");
        },
      }
    );
  }

  function handleDeleteSubClient(subClientId: string) {
    deleteSubClient.mutate(
      { id: subClientId, clientId },
      {
        onSuccess: () => {
          toast.success("Sub-client removed");
        },
        onError: () => {
          toast.error("Failed to remove sub-client");
        },
      }
    );
  }

  return (
    <div className="space-y-3 max-w-[1000px]">
      {/* Header */}
      <div className="flex items-start gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push("/clients")}
          className="shrink-0 mt-[4px]"
        >
          <ArrowLeft className="w-[20px] h-[20px]" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-1.5">
            <div className="w-[52px] h-[52px] rounded-full bg-ops-accent-muted flex items-center justify-center shrink-0">
              <span className="font-mohave text-display text-ops-accent">
                {getInitials(clientData.name) || "?"}
              </span>
            </div>
            <div>
              {isEditing ? (
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="font-mohave text-display-lg h-auto py-[4px] px-1"
                />
              ) : (
                <h1 className="font-mohave text-display-lg text-text-primary">
                  {clientData.name}
                </h1>
              )}
              {isEditing && (
                <Input
                  value={editCompany}
                  onChange={(e) => setEditCompany(e.target.value)}
                  placeholder="Company name (optional)"
                  className="mt-1 h-auto py-[4px] px-1"
                />
              )}
              {!isEditing && (
                <p className="font-kosugi text-caption-sm text-text-tertiary mt-[2px]">
                  {clientProjects.length} projects
                  {clientData.createdAt && (
                    <>
                      {" "}| Client since{" "}
                      {new Date(clientData.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        year: "numeric",
                      })}
                    </>
                  )}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          {isEditing ? (
            <>
              <Button variant="ghost" size="sm" onClick={handleCancelEdit} disabled={updateClient.isPending}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSaveEdit} className="gap-[4px]" loading={updateClient.isPending}>
                <Save className="w-[14px] h-[14px]" />
                Save
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="secondary"
                size="sm"
                className="gap-[6px]"
                onClick={() => setIsEditing(true)}
              >
                <Edit3 className="w-[14px] h-[14px]" />
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDeleteDialog(true)}
                className="text-ops-error hover:text-ops-error"
              >
                <Trash2 className="w-[14px] h-[14px]" />
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
        {/* ─── Left Column: Contact + Notes + Sub-Clients ─────────────── */}
        <div className="space-y-2">
          {/* Contact Info Card */}
          <Card>
            <CardHeader>
              <CardTitle>Contact Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-0">
              {/* Email */}
              {(clientData.email || isEditing) && (
                <div className="flex items-center gap-1 py-1.5 border-b border-border-subtle">
                  <Mail className="w-[16px] h-[16px] text-ops-accent shrink-0" />
                  {isEditing ? (
                    <Input
                      type="email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      placeholder="Email address"
                      className="h-auto py-[3px] px-1"
                    />
                  ) : (
                    <div className="flex items-center gap-1 flex-1 min-w-0">
                      <a
                        href={`mailto:${clientData.email}`}
                        className="font-mono text-data-sm text-ops-accent hover:underline truncate"
                      >
                        {clientData.email}
                      </a>
                      <CopyButton text={clientData.email!} />
                    </div>
                  )}
                </div>
              )}

              {/* Phone */}
              {(clientData.phoneNumber || isEditing) && (
                <div className="flex items-center gap-1 py-1.5 border-b border-border-subtle">
                  <Phone className="w-[16px] h-[16px] text-ops-accent shrink-0" />
                  {isEditing ? (
                    <Input
                      type="tel"
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      placeholder="Phone number"
                      className="h-auto py-[3px] px-1"
                    />
                  ) : (
                    <div className="flex items-center gap-1 flex-1 min-w-0">
                      <a
                        href={`tel:${clientData.phoneNumber}`}
                        className="font-mono text-data-sm text-text-primary hover:text-ops-accent transition-colors"
                      >
                        {clientData.phoneNumber}
                      </a>
                      <CopyButton text={clientData.phoneNumber!} />
                    </div>
                  )}
                </div>
              )}

              {/* Address */}
              {(clientData.address || isEditing) && (
                <div className="flex items-start gap-1 py-1.5">
                  <MapPin className="w-[16px] h-[16px] text-ops-accent shrink-0 mt-[2px]" />
                  {isEditing ? (
                    <Input
                      value={editAddress}
                      onChange={(e) => setEditAddress(e.target.value)}
                      placeholder="Address"
                      className="h-auto py-[3px] px-1"
                    />
                  ) : (
                    <div className="flex items-start gap-1 flex-1 min-w-0">
                      <span className="font-mohave text-body-sm text-text-secondary flex-1">
                        {clientData.address}
                      </span>
                      <div className="flex items-center gap-[2px] shrink-0">
                        <CopyButton text={clientData.address!} />
                        {mapUrl && (
                          <a
                            href={mapUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-[4px] rounded text-text-disabled hover:text-ops-accent transition-colors"
                            title="Open in Maps"
                          >
                            <Navigation className="w-[13px] h-[13px]" />
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Notes Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-[6px]">
                <StickyNote className="w-[14px] h-[14px] text-text-tertiary" />
                <CardTitle>Notes</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {isEditing ? (
                <Textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Add notes about this client..."
                  className="min-h-[100px]"
                />
              ) : clientData.notes ? (
                <p className="font-mohave text-body-sm text-text-secondary leading-relaxed whitespace-pre-wrap">
                  {clientData.notes}
                </p>
              ) : (
                <p className="font-mohave text-body-sm text-text-disabled italic">
                  No notes added
                </p>
              )}
            </CardContent>
          </Card>

          {/* Sub-Clients Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-[6px]">
                  <Users className="w-[14px] h-[14px] text-text-tertiary" />
                  <CardTitle>Sub-Clients</CardTitle>
                  {subClients.length > 0 && (
                    <Badge variant="info" className="text-[10px] px-[6px] py-[1px]">
                      {subClients.length}
                    </Badge>
                  )}
                  {subClientsLoading && (
                    <Loader2 className="w-[12px] h-[12px] text-text-disabled animate-spin" />
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-[4px]"
                  onClick={() => setShowAddSubClient(!showAddSubClient)}
                >
                  {showAddSubClient ? (
                    <>
                      <X className="w-[14px] h-[14px]" />
                      Close
                    </>
                  ) : (
                    <>
                      <Plus className="w-[14px] h-[14px]" />
                      Add
                    </>
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {/* Inline add form */}
              {showAddSubClient && (
                <div className="mb-1.5">
                  <AddSubClientForm
                    onSave={handleAddSubClient}
                    onCancel={() => setShowAddSubClient(false)}
                    isSaving={createSubClient.isPending}
                  />
                </div>
              )}

              {subClients.length === 0 && !showAddSubClient ? (
                <p className="font-mohave text-body-sm text-text-disabled italic">
                  No sub-clients added
                </p>
              ) : (
                <div className="space-y-0">
                  {subClients.map((sc) => (
                    <div
                      key={sc.id}
                      className="flex items-center justify-between py-1 border-b border-border-subtle last:border-0 group"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1">
                          <div className="w-[28px] h-[28px] rounded-full bg-background-elevated flex items-center justify-center shrink-0">
                            <span className="font-mohave text-[11px] text-text-secondary">
                              {getInitials(sc.name)}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="font-mohave text-body-sm text-text-primary truncate">
                              {sc.name}
                            </p>
                            {sc.title && (
                              <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider">
                                {sc.title}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 ml-1">
                        <div className="flex flex-col items-end gap-[2px]">
                          {sc.phoneNumber && (
                            <a
                              href={`tel:${sc.phoneNumber}`}
                              className="font-mono text-[10px] text-text-tertiary hover:text-ops-accent transition-colors"
                            >
                              {sc.phoneNumber}
                            </a>
                          )}
                          {sc.email && (
                            <a
                              href={`mailto:${sc.email}`}
                              className="font-mono text-[10px] text-ops-accent hover:underline truncate max-w-[140px]"
                            >
                              {sc.email}
                            </a>
                          )}
                        </div>
                        <button
                          onClick={() => handleDeleteSubClient(sc.id)}
                          className="p-[3px] rounded text-text-disabled opacity-0 group-hover:opacity-100 hover:text-ops-error transition-all"
                          title="Remove sub-client"
                        >
                          <Trash2 className="w-[12px] h-[12px]" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ─── Right Column: Projects ─────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-2">
          {/* Active Projects */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-[6px]">
                  <FolderKanban className="w-[14px] h-[14px] text-text-tertiary" />
                  <CardTitle>Active Projects</CardTitle>
                  {activeProjects.length > 0 && (
                    <Badge variant="info" className="text-[10px] px-[6px] py-[1px]">
                      {activeProjects.length}
                    </Badge>
                  )}
                  {projectsLoading && (
                    <Loader2 className="w-[12px] h-[12px] text-text-disabled animate-spin" />
                  )}
                </div>
                <Button
                  size="sm"
                  className="gap-[6px]"
                  onClick={() => router.push("/projects/new")}
                >
                  <Plus className="w-[14px] h-[14px]" />
                  New Project
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {!projectsLoading && activeProjects.length === 0 ? (
                <div className="text-center py-4">
                  <FolderKanban className="w-[36px] h-[36px] text-text-disabled mx-auto mb-1" />
                  <p className="font-mohave text-body text-text-tertiary">
                    No active projects
                  </p>
                  <p className="font-kosugi text-caption-sm text-text-disabled mt-[4px]">
                    Create a project to start tracking work for this client
                  </p>
                </div>
              ) : (
                <div className="space-y-[4px]">
                  {activeProjects.map((project) => {
                    const status = statusConfig[project.status] || statusConfig.RFQ;
                    return (
                      <div
                        key={project.id}
                        onClick={() => router.push(`/projects/${project.id}`)}
                        className="flex items-center justify-between px-1.5 py-1 rounded border border-border-subtle hover:border-ops-accent/50 hover:bg-background-elevated cursor-pointer transition-all group"
                      >
                        <div className="flex items-center gap-1 min-w-0">
                          <FolderKanban className="w-[16px] h-[16px] text-text-tertiary shrink-0" />
                          <span className="font-mohave text-body text-text-primary truncate">
                            {project.title}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {project.teamMemberIds && project.teamMemberIds.length > 0 && (
                            <span className="font-mono text-[10px] text-text-disabled">
                              {project.teamMemberIds.length} crew
                            </span>
                          )}
                          {project.startDate && (
                            <span className="font-mono text-[10px] text-text-disabled">
                              {new Date(project.startDate).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                              })}
                            </span>
                          )}
                          <span className={cn("ops-badge", status.color, status.bg)}>
                            {status.label}
                          </span>
                          <ExternalLink className="w-[14px] h-[14px] text-text-disabled opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Completed Projects */}
          {completedProjects.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-[6px]">
                  <FolderKanban className="w-[14px] h-[14px] text-text-disabled" />
                  <CardTitle className="text-text-tertiary">Completed</CardTitle>
                  <Badge variant="info" className="text-[10px] px-[6px] py-[1px] opacity-60">
                    {completedProjects.length}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-[4px]">
                  {completedProjects.map((project) => {
                    const status = statusConfig[project.status] || statusConfig.Completed;
                    return (
                      <div
                        key={project.id}
                        onClick={() => router.push(`/projects/${project.id}`)}
                        className="flex items-center justify-between px-1.5 py-1 rounded border border-border-subtle hover:border-ops-accent/30 hover:bg-background-elevated cursor-pointer transition-all opacity-70 hover:opacity-100"
                      >
                        <div className="flex items-center gap-1 min-w-0">
                          <FolderKanban className="w-[16px] h-[16px] text-text-disabled shrink-0" />
                          <span className="font-mohave text-body text-text-tertiary truncate">
                            {project.title}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className={cn("ops-badge", status.color, status.bg)}>
                            {status.label}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        title="Delete Client"
        description={`Are you sure you want to delete "${clientData.name}"? This will also remove all sub-clients. This action cannot be undone.`}
        confirmLabel="Delete Client"
        variant="destructive"
        onConfirm={handleDelete}
        loading={deleteClient.isPending}
      />
    </div>
  );
}
