"use client";

import { useState } from "react";
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
  Building2,
  StickyNote,
  Copy,
  Check,
  X,
  Save,
  Navigation,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ops/confirm-dialog";

// ─── Placeholder Data ────────────────────────────────────────────────────────

const clientsDatabase: Record<
  string,
  {
    id: string;
    name: string;
    company: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    notes: string | null;
    profileImageURL: string | null;
    createdAt: string;
  }
> = {
  c1: {
    id: "c1",
    name: "John Smith",
    company: "Smith & Associates",
    email: "john@smithassociates.com",
    phone: "(555) 123-4567",
    address: "123 Main St, Springfield, IL 62701",
    notes:
      "Prefers morning appointments between 8-10am. Dog in backyard - use front entrance. Has a gate code: 4521.",
    profileImageURL: null,
    createdAt: "2025-09-15",
  },
  c2: {
    id: "c2",
    name: "Meridian Properties LLC",
    company: "Meridian Properties",
    email: "contact@meridianprops.com",
    phone: "(555) 234-5678",
    address: "456 Oak Ave, Shelbyville, IL 62565",
    notes: "Commercial property management company. Net-30 payment terms. Invoice to accounting@meridianprops.com.",
    profileImageURL: null,
    createdAt: "2025-11-02",
  },
};

const clientProjectsData: Record<
  string,
  { id: string; name: string; status: string; startDate: string; teamCount: number }[]
> = {
  c1: [
    { id: "p1", name: "Kitchen Renovation", status: "in-progress", startDate: "2026-02-01", teamCount: 3 },
    { id: "p2", name: "Bathroom Remodel", status: "completed", startDate: "2025-12-10", teamCount: 2 },
    { id: "p3", name: "Deck Repair", status: "rfq", startDate: "2026-03-01", teamCount: 0 },
  ],
  c2: [
    { id: "p4", name: "Office HVAC Replacement", status: "in-progress", startDate: "2026-01-15", teamCount: 4 },
    { id: "p5", name: "Parking Lot Resurfacing", status: "accepted", startDate: "2026-03-01", teamCount: 2 },
    { id: "p6", name: "Lobby Renovation", status: "estimated", startDate: "2026-04-01", teamCount: 0 },
    { id: "p7", name: "Plumbing Upgrade - Bldg B", status: "completed", startDate: "2025-10-01", teamCount: 3 },
    { id: "p8", name: "Roof Inspection", status: "rfq", startDate: "2026-03-15", teamCount: 0 },
  ],
};

const subClientsData: Record<
  string,
  { id: string; name: string; title: string | null; phone: string | null; email: string | null }[]
> = {
  c1: [
    { id: "sc1", name: "Sarah Smith", title: "Spouse", phone: "(555) 123-4568", email: "sarah@smithassociates.com" },
  ],
  c2: [
    { id: "sc2", name: "Jane Doe", title: "Property Manager", phone: "(555) 234-5679", email: "jane@meridianprops.com" },
    { id: "sc3", name: "Carlos Ruiz", title: "Maintenance Lead", phone: "(555) 234-5680", email: null },
  ],
};

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  rfq: { label: "RFQ", color: "text-status-rfq", bg: "bg-status-rfq/15" },
  estimated: { label: "ESTIMATED", color: "text-status-estimated", bg: "bg-status-estimated/15" },
  accepted: { label: "ACCEPTED", color: "text-status-accepted", bg: "bg-status-accepted/15" },
  "in-progress": { label: "IN PROGRESS", color: "text-status-in-progress", bg: "bg-status-in-progress/15" },
  completed: { label: "COMPLETED", color: "text-status-completed", bg: "bg-status-completed/15" },
};

// ─── Sub-Client Inline Form ──────────────────────────────────────────────────

function AddSubClientForm({
  onSave,
  onCancel,
}: {
  onSave: (data: { name: string; title: string; phone: string; email: string }) => void;
  onCancel: () => void;
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
    setName("");
    setTitle("");
    setPhone("");
    setEmail("");
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
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSubmit} className="gap-[4px]">
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

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function ClientDetailPage() {
  const router = useRouter();
  const params = useParams();
  const clientId = params.id as string;

  // TODO: Replace with useClient(clientId) when API connected
  const clientData = clientsDatabase[clientId] || clientsDatabase.c1;
  const clientProjects = clientProjectsData[clientId] || clientProjectsData.c1 || [];
  const subClients = subClientsData[clientId] || subClientsData.c1 || [];

  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showAddSubClient, setShowAddSubClient] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Editable fields
  const [editName, setEditName] = useState(clientData.name);
  const [editCompany, setEditCompany] = useState(clientData.company || "");
  const [editEmail, setEditEmail] = useState(clientData.email || "");
  const [editPhone, setEditPhone] = useState(clientData.phone || "");
  const [editAddress, setEditAddress] = useState(clientData.address || "");
  const [editNotes, setEditNotes] = useState(clientData.notes || "");

  function handleSaveEdit() {
    // TODO: call useUpdateClient mutation
    setIsEditing(false);
  }

  function handleCancelEdit() {
    setEditName(clientData.name);
    setEditCompany(clientData.company || "");
    setEditEmail(clientData.email || "");
    setEditPhone(clientData.phone || "");
    setEditAddress(clientData.address || "");
    setEditNotes(clientData.notes || "");
    setIsEditing(false);
  }

  function handleDelete() {
    setIsDeleting(true);
    // TODO: call useDeleteClient mutation
    setTimeout(() => {
      setIsDeleting(false);
      setShowDeleteDialog(false);
      router.push("/clients");
    }, 800);
  }

  function handleAddSubClient(data: { name: string; title: string; phone: string; email: string }) {
    // TODO: call useCreateSubClient mutation
    setShowAddSubClient(false);
  }

  const activeProjects = clientProjects.filter(
    (p) => p.status !== "completed" && p.status !== "archived"
  );
  const completedProjects = clientProjects.filter(
    (p) => p.status === "completed" || p.status === "archived"
  );

  const mapUrl = clientData.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(clientData.address)}`
    : null;

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
                {clientData.name
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .slice(0, 2)}
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
              {clientData.company && !isEditing && (
                <div className="flex items-center gap-[4px] mt-[2px]">
                  <Building2 className="w-[13px] h-[13px] text-text-disabled" />
                  <p className="font-kosugi text-caption-sm text-text-tertiary">
                    {clientData.company}
                  </p>
                </div>
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
                  {clientProjects.length} projects | Client since{" "}
                  {new Date(clientData.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    year: "numeric",
                  })}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          {isEditing ? (
            <>
              <Button variant="ghost" size="sm" onClick={handleCancelEdit}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSaveEdit} className="gap-[4px]">
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
              {(clientData.phone || isEditing) && (
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
                        href={`tel:${clientData.phone}`}
                        className="font-mono text-data-sm text-text-primary hover:text-ops-accent transition-colors"
                      >
                        {clientData.phone}
                      </a>
                      <CopyButton text={clientData.phone!} />
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
                      className="flex items-center justify-between py-1 border-b border-border-subtle last:border-0"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1">
                          <div className="w-[28px] h-[28px] rounded-full bg-background-elevated flex items-center justify-center shrink-0">
                            <span className="font-mohave text-[11px] text-text-secondary">
                              {sc.name
                                .split(" ")
                                .map((n) => n[0])
                                .join("")}
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
                      <div className="flex flex-col items-end gap-[2px] shrink-0 ml-1">
                        {sc.phone && (
                          <a
                            href={`tel:${sc.phone}`}
                            className="font-mono text-[10px] text-text-tertiary hover:text-ops-accent transition-colors"
                          >
                            {sc.phone}
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
              {activeProjects.length === 0 ? (
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
                    const status = statusConfig[project.status] || statusConfig.rfq;
                    return (
                      <div
                        key={project.id}
                        onClick={() => router.push(`/projects/${project.id}`)}
                        className="flex items-center justify-between px-1.5 py-1 rounded border border-border-subtle hover:border-ops-accent/50 hover:bg-background-elevated cursor-pointer transition-all group"
                      >
                        <div className="flex items-center gap-1 min-w-0">
                          <FolderKanban className="w-[16px] h-[16px] text-text-tertiary shrink-0" />
                          <span className="font-mohave text-body text-text-primary truncate">
                            {project.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {project.teamCount > 0 && (
                            <span className="font-mono text-[10px] text-text-disabled">
                              {project.teamCount} crew
                            </span>
                          )}
                          <span className="font-mono text-[10px] text-text-disabled">
                            {new Date(project.startDate).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
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
                    const status = statusConfig[project.status] || statusConfig.completed;
                    return (
                      <div
                        key={project.id}
                        onClick={() => router.push(`/projects/${project.id}`)}
                        className="flex items-center justify-between px-1.5 py-1 rounded border border-border-subtle hover:border-ops-accent/30 hover:bg-background-elevated cursor-pointer transition-all opacity-70 hover:opacity-100"
                      >
                        <div className="flex items-center gap-1 min-w-0">
                          <FolderKanban className="w-[16px] h-[16px] text-text-disabled shrink-0" />
                          <span className="font-mohave text-body text-text-tertiary truncate">
                            {project.name}
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
        loading={isDeleting}
      />
    </div>
  );
}
